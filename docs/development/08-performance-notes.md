# 08 · Performance Notes

模擬 300–400 台同時移動的車輛、每秒重算 30 次、更新 instanced WebGL2 車輛模型，再同步 MapLibre 的 2D 標記與透明 picking sources，是這個專案最容易卡頓的地方。下面是幾個明確的優化點。

每一節最後都標註：**屬於哪一個檔案 / 哪一條 sim path**，方便日後 profile 對得上。

## 1. Polyline progress lookup — `cumKm` + binary search

**問題**：`simulationEngine` 每 sim tick 對每台車問同一個問題：「給我這條路線的 progress ∈ [0,1]，告訴我這台車該畫在哪裡、面向哪邊。」

原本用 turf [`along()`](https://turfjs.org/docs/api/along) 做兩次（一次取座標、一次取下一公尺位置算 bearing）。`along()` 從 `coords[0]` 開始走、累加 haversine 直到累積長度等於目標 km — 每呼叫一次就 O(n) 個 haversine。換算下來：

```
~400 台車 × 2 次 × 30 Hz × 100 點/路線
= ~2.4M haversine 呼叫 / 秒
```

全部在 main thread 上跑、每個 haversine 還有 `sin`、`cos`、`asin`、`sqrt`，這是當時 main thread 的最大 CPU 黑洞。

**Fix**：每條路線的幾何不變，per-segment 的工作只做一次。第一次用到時 cache：

- `cumKm[i]` — `coords[0]` → `coords[i]` 的累積 km（`Float64Array`）
- `segBearing[i]` — segment `coords[i] → coords[i+1]` 的 heading（`Float64Array`）

每次呼叫的成本變成：

- 在 `cumKm` 上做 binary search 找對應 segment（150 點路線 ≈ 8 次比較）
- 兩個 lat/lng 之間做線性內插
- `segBearing[i]` 直接 table lookup

熱迴圈裡沒有 trig、沒有走陣列、沒有第二次 `along()`。

**為什麼不 cache 「上次 i 的 hint」**：多台車共用同一條 polyline 但 progress 散在各地，shared hint 會 thrash。`O(log n)` 已經夠便宜，per-vehicle state 不值得。

> Source: [`simulationEngine.ts` `getLineCache` / `interpolateOnLine`](../../src/engines/simulationEngine.ts)。Cross-link [03-simulation-engine.md](03-simulation-engine.md)。

## 2. 一個 `bus-routes` source vs 92 個

**問題**：MapLibre 的 GeoJSON source 是在 worker 裡 tile 化的：worker 把 source 切成 tile boundary、把線拆成 triangle strip、把 vertex buffer 傳回 main thread。原本 92 條巴士路線各是 `addSource('bus-route-1')` + `addLayer('bus-route-1')`、合計 92 個 source。每次 zoom 變 → MapLibre 要 reindex → 92 次 worker postMessage、92 次獨立 tile-index rebuild。

**Fix 1**：合成單一 source `bus-routes`，所有 92 條路線是這個 source 裡的 92 個 feature。reindex 變一次。

**Fix 2**：per-route 的 dim / highlight 改用 `setFeatureState` 配 paint expression：

```ts
map.setFeatureState({ source: 'bus-routes', id: route.id }, { inService })

paint: {
  'line-opacity': [
    'case',
    ['==', ['feature-state', 'inService'], false],
    BUS_LINE_OPACITY_DIM,
    BUS_LINE_OPACITY,
  ],
}
```

vs 舊寫法 `setPaintProperty('bus-route-${id}', 'line-opacity', x)`。

關鍵差異：**`setFeatureState` 不重編 paint，`setPaintProperty` 會。** 後者每次都 invalidate 一次 GPU 上的 paint program，前者只更新 vertex 屬性。

> Source: 邏輯散在 [`MapView.tsx`](../../src/components/MapView.tsx)（搜 `setFeatureState`、`bus-routes`）。Cross-link [04-3d-layers.md](04-3d-layers.md)。

## 3. 上傳節奏：GeoJSON `setData` 會重切 tiles，instance buffer 不會

**問題**：早期版本把可見車身做成 3D fill-extrusion polygon；目前巴士、LRT、飛機與渡輪已改成共享的程式化 triangle mesh，由 `InstancedVehicleModelLayer` 直接更新 instance buffer。這拿掉了可見模型的 GeoJSON re-tiling，但 MapLibre 仍有兩類會動的 GeoJSON：低 zoom 的 2D marker，以及高 zoom 給 click／hover 用的透明 picking volume。它們每次 `setData` 都會讓 worker 把該 source 畫面內的每一片 tile 重切，再把 buffer 傳回 main thread。2D 標記 source 曾經每個 RAF frame 寫一次——每秒 60 次重切一個每 33 ms 才變一次的 source——在 iPhone X 上是每秒 450 次 tile 重載，最後 WebGL context 直接 lost。

**Fix**：位置照 30 Hz 算，但所有上傳共用一個節奏：

```text
simulation / desktop upload = 33 ms   // 約 30 Hz
phone upload                = 100 ms  // viewport < 640 px
map-moving upload           = 160 ms  // movestart → moveend 期間
```

pinch zoom 中上傳退到約 6 Hz，把 main thread 讓給 MapLibre 的 zoom 渲染；zoom 結束立刻回到原節奏。四種 3D model 的 instance buffer、透明 picking volumes 和 2D marker 在同一個 upload frame 更新，所以兩種表示不會分離。唯一例外是正在追蹤的航班：它使用獨立 tracked instance batch，能跟 camera target 同步更新；自己的小 picking source 仍按需要／upload cadence 更新。

**再往下一層：每次 `setData` 重切幾片 tile。** 節奏修好後 iPhone X 仍是每秒 450 次，`?debug=1` 面板把最忙的 source 列出來才看見原因：pitch 45 的 zoom 16 畫面裡每個 source 約有 20 片 z16 tile，成本是「tile 數 × source 數 × 節奏」。於是：

- 2D 標記與巴士／輕軌／渡輪的透明 picking source 只切到 z15（[`VehicleLayer.ts`](../../src/layers/VehicleLayer.ts) 的 `VEHICLE_SOURCE_MAXZOOM`）：zoom 16 的畫面變成約 5 片，每再放大一級再少 4 倍；座標量化約 0.14 m，zoom 18 時半個像素。可見 triangle mesh 不經 MapLibre GeoJSON tiler。
- [`InstancedVehicleModelLayer.ts`](../../src/layers/InstancedVehicleModelLayer.ts) 每種車型只上傳一次 immutable mesh；CPU instance array 長度相同時原地重用，GPU storage 只有 batch 變大時 `bufferData`，其餘 pose 走 `bufferSubData`。一般 fleet 一個 draw；航班至多再加一個 tracked draw。context removal 會把 capacity 歸零，重建時重新配置。
- 巴士 model 只送 viewport 附近的 instance；鏡頭移動但可見車輛 identity 沒變時，mesh 和 picking source 都不重送。pause 時 camera move 仍會觸發這個可見集合更新。
- 大賽車的車（12 個方塊，id 0–11）、尾跡（id `wake`）、時速標籤（id `label`）出現時整包寫一次，之後用 `GeoJSONSource.updateData` 差異更新：MapLibre 只重載被舊／新幾何碰到的一兩片 tile（`shouldReloadTile` / `affectedBounds`）。
- MapLibre 6 的 `zoomLevelsToOverscale` 預設 4，會把向量 source 超過 maxzoom 的 z14 tile 切成子 tile 一路到 z18；同一畫面量到 44 次 tile 載入對 8 次、存活的 GPU buffer 2.3 倍。`MapView` 傳 `undefined`（官方的關閉值，即 v5 行為）。

先前單次 iPhone X 測試記錄為每秒 457 → 110 次 tile 重載、60 fps，當次沒有 shader 失敗；這不是持續穩定的保證。2026-09-08 同一裝置連 v5／v6 純底圖、DPR 1 都會 context lost，故不再把上述負載調整當成此故障的修正。失敗復原與 2D 備援見 [11-webgl-recovery.md](11-webgl-recovery.md)。

> Source: [`MapView.tsx`](../../src/components/MapView.tsx) 傳入 `VehicleFrame` 的 `uploadInterval`、`mapBusyRef`、`writeGrandPrixWake` / `writeGrandPrixCarLabel`、`zoomLevelsToOverscale`；[`InstancedVehicleModelLayer.ts`](../../src/layers/InstancedVehicleModelLayer.ts) 的 batch upload／draw；[`Bus3DLayer.ts`](../../src/layers/Bus3DLayer.ts) 的 viewport filtering；[`RaceCar3DLayer.ts`](../../src/layers/RaceCar3DLayer.ts) 的 `setPose`。量測工具見 [01-getting-started.md](01-getting-started.md) 的「在裝置上診斷」。

## 4. Decouple zoom HUD from React re-renders

**問題**：HUD 上有個 zoom 顯示（"z = 14.3"）。原本是 `useState(zoom)`，每次 `map.on('zoom', e => setZoom(e.target.getZoom()))` 觸發 → 整個 `<MapView>` re-render。`<MapView>` 是巨型 component（map ref、ETA panel、layer toggle、route group state），re-render 不是免費的。

**Fix**：zoom 搬到 module-level 的 external store，用 [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore) 訂閱，只把一個小小 `<ZoomText>` leaf 拉進訂閱。`<MapView>` 在 pinch / scroll zoom 時不再 re-render。

```ts
const z = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
// MapView.tsx:5593
```

> Source: [`MapView.tsx`](../../src/components/MapView.tsx)（搜 `useSyncExternalStore`）。

## 5. Per-tick caches in simulationEngine

前端按幾何身分重用累積長度與站點 map；LRT 站點投影與運動曲線改在伺服器初始化後重用。狀態請求只取窗內的 progress／速度，不需要為每一秒建立地圖座標。伺服器最多快取 8 個回應，瀏覽器最多保留兩個重疊窗。

## 7. 漸進載入 + lazy bundle split

- **MapView lazy import**：[`App.tsx:21`](../../src/App.tsx)。`<MapSplash/>` 先撐住 LCP，後台 parse maplibre-gl bundle（~1 MB）。
- **每個 InfoPanel 各自 lazy**：點到車輛才載入 `VehicleInfoPanel`、點到站才載入 `StationInfoPanel`，等等。
- **Vendor chunk split** in [`vite.config.ts`](../../vite.config.ts)：
  - `vendor-react`
  - `vendor-maplibre`（最大塊，CDN 緩存特別有用）
- **LRT 短窗預取**：`GET /api/lrt/state?at=<epoch-ms>` 回傳固定 120 秒，前端以 60 秒步進預取下一窗。60× 連續播放正常約每秒一個請求；暫停不預取，網路錯誤退避重試。見 [lrtStateStore.ts](../../src/lrtStateStore.ts)。

## 8. 漸進 setState 而非 `Promise.all`

公開幾何與巴士資料各自完成後即更新，LRT 狀態獨立載入，不阻擋其他圖層的初始化。每次收到新時間窗才通知 React，逐幀姿態仍由地圖迴圈沿軌道內插。

## 9. Ferry path 長度 cache + 2D circle for 遠景

- `ferryPathMinutesCache` 把 `(routeId:terminal:berthIndex)` → 巡航分鐘數的計算 cache 掉（[`simulationEngine.ts:1286`](../../src/engines/simulationEngine.ts)）。
- 渡輪在大 zoom out 時跟 vehicle layer 一樣退到 circle。

## 10. `flightOnly` per-frame 補償

**問題**：飛機在高倍速（≥5×）下視覺會「前後抖動」。原因：sim engine 30 Hz 步進、飛機在 climb 階段每 tick 走 3–25 m，當 sim speed 5× 時每 tick 走 15–125 m，畫面看到的位置是 hold 一個 tick 的長度。

**Fix**：新增 `computeFlightOnly(transitData, time)` 只算航班，最初從 MapView 的 RAF render loop 每 frame 呼叫，讓飛機位置跟連續時間走、不被 sim tick 量化。

**現況**：整批航班改跟上傳節奏走——[`VehicleFrame`](../../src/engines/vehicleFrame.ts) 每個 frame 取樣，但只在上傳時（33／100／160 ms）重算整批；上傳之間只以 `computeSingleFlight` 重算被追蹤的那一架，機身與鏡頭仍用同一個時刻。

> Source: [`simulationEngine.ts:1429`](../../src/engines/simulationEngine.ts)。
