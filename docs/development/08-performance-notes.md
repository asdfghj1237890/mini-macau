# 08 · Performance Notes

模擬 300–400 台同時移動的車輛、每秒重算 30 次、加上 MapLibre 不停 redraw 3D fill-extrusion，是這個專案最容易卡頓的地方。下面是幾個明確的優化點。

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

## 3. 上傳節奏：GPU 付的是每一次 `setData`，不是每一次位置計算

**問題**：把 300+ 台巴士當 3D fill-extrusion polygon 畫很重（每台車 5 個矩形 × 4 個角的 lat/lng 數學）。但真正貴的不是算位置，而是 GeoJSON source 的每一次 `setData`：worker 會把該 source 畫面內的每一片 tile 重切一次，main thread 再把 buffer 全部重新上傳。2D 標記 source 曾經每個 RAF frame 寫一次——每秒 60 次重切一個每 33 ms 才變一次的 source——在 iPhone X 上是每秒 450 次 tile 重載，最後 WebGL context 直接 lost。

**Fix**：位置照 30 Hz 算，但所有上傳共用一個節奏：

```
SIM_TICK_MS          = 33   // 30 Hz：位置計算；桌機的上傳也用這個
HEAVY_TICK_MS_PHONE  = 100  // 手機（viewport < 640 px）：3D 車輛、2D 標記、大賽車三個 source 的上傳節奏
HEAVY_TICK_MS_BUSY   = 160  // 地圖移動中（movestart / moveend 設 mapBusyRef）：所有上傳退到這個
```

pinch zoom 中上傳退到約 6 Hz，把 main thread 讓給 MapLibre 的 zoom 渲染；zoom 結束立刻回到原節奏。航班的 3D 模型也在這個節奏上傳，2D 的航班點在同一次上傳裡合併進去，所以兩者不會分離。

**再往下一層：每次 `setData` 重切幾片 tile。** 節奏修好後 iPhone X 仍是每秒 450 次，`?debug=1` 面板把最忙的 source 列出來才看見原因：pitch 45 的 zoom 16 畫面裡每個 source 約有 20 片 z16 tile，成本是「tile 數 × source 數 × 節奏」。於是：

- 2D 標記與巴士／輕軌／渡輪的 3D source 只切到 z15（[`VehicleLayer.ts`](../../src/layers/VehicleLayer.ts) 的 `VEHICLE_SOURCE_MAXZOOM`）：zoom 16 的畫面變成約 5 片，每再放大一級再少 4 倍；座標量化約 0.14 m，zoom 18 時半個像素。
- 大賽車的車（12 個方塊，id 0–11）、尾跡（id `wake`）、時速標籤（id `label`）出現時整包寫一次，之後用 `GeoJSONSource.updateData` 差異更新：MapLibre 只重載被舊／新幾何碰到的一兩片 tile（`shouldReloadTile` / `affectedBounds`）。
- MapLibre 6 的 `zoomLevelsToOverscale` 預設 4，會把向量 source 超過 maxzoom 的 z14 tile 切成子 tile 一路到 z18；同一畫面量到 44 次 tile 載入對 8 次、存活的 GPU buffer 2.3 倍。`MapView` 傳 `undefined`（官方的關閉值，即 v5 行為）。

同一台 iPhone X、同一個畫面：每秒 457 → 110 次 tile 重載，60 fps，shader 不再失敗。

> Source: [`MapView.tsx`](../../src/components/MapView.tsx) 的 `mapBusyRef`、`SIM_TICK_MS` / `HEAVY_TICK_MS_PHONE` / `HEAVY_TICK_MS_BUSY`、`writeGrandPrixWake` / `writeGrandPrixCarLabel`、`zoomLevelsToOverscale`；[`RaceCar3DLayer.ts`](../../src/layers/RaceCar3DLayer.ts) 的 `setPose`。量測工具見 [01-getting-started.md](01-getting-started.md) 的「在裝置上診斷」。

## 4. Decouple zoom HUD from React re-renders

**問題**：HUD 上有個 zoom 顯示（"z = 14.3"）。原本是 `useState(zoom)`，每次 `map.on('zoom', e => setZoom(e.target.getZoom()))` 觸發 → 整個 `<MapView>` re-render。`<MapView>` 是巨型 component（map ref、ETA panel、layer toggle、route group state），re-render 不是免費的。

**Fix**：zoom 搬到 module-level 的 external store，用 [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore) 訂閱，只把一個小小 `<ZoomText>` leaf 拉進訂閱。`<MapView>` 在 pinch / scroll zoom 時不再 re-render。

```ts
const z = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
// MapView.tsx:1594
```

> Source: [`MapView.tsx`](../../src/components/MapView.tsx)（搜 `useSyncExternalStore`）。

## 5. Per-tick caches in simulationEngine

`computeVehiclePositions` 跑 30 Hz；transit data 派生出來的 map 不該每 tick 重建：

- `cachedProgressMap`（LRT 站 → 線上 progress）
- `cachedBusStopMap`（stopId → BusStop）
- `cachedFilteredTrips` × `cachedFilteredScheduleType`（避免每 tick 重 filter ~10k trips）

只要 `transitData` reference 不變、`scheduleType` 不變，就重用上次。`resetTransitCachesIfStale` 在 reference 換掉時清掉所有 cache（lazy load 完成新 trips 會觸發）。

> Source: [`simulationEngine.ts`](../../src/engines/simulationEngine.ts) 行 1101 起的 cache slot。

## 7. 漸進載入 + lazy bundle split

- **MapView lazy import**：[`App.tsx:21`](../../src/App.tsx)。`<MapSplash/>` 先撐住 LCP，後台 parse maplibre-gl bundle（~1 MB）。
- **每個 InfoPanel 各自 lazy**：點到車輛才載入 `VehicleInfoPanel`、點到站才載入 `StationInfoPanel`，等等。
- **Vendor chunk split** in [`vite.config.ts`](../../vite.config.ts)：
  - `vendor-react`
  - `vendor-maplibre`（最大塊，CDN 緩存特別有用）
- **Trips 按 scheduleType 載入**：透過 `GET /api/lrt/<scheduleType>` 先 fetch 今天的時刻表，剩下兩個在主資料完成後背景 prefetch，避免其他日期的資料阻擋初次載入。見 [`useTransitData.ts`](../../src/hooks/useTransitData.ts) 的 `loadTrips` 與 [05-data-pipeline.md](05-data-pipeline.md)。

## 8. 漸進 setState 而非 `Promise.all`

`useTransitData` 6 個核心 fetch 都並行發出，但**每個 response 到了就立刻 commit**，不等 `Promise.all`。

> "spreads the big JSON.parse cost — bus-routes.json alone is ~2.7 MB, and the day's trips file is ~900 KB — across multiple React commits so the browser can paint/interact between them rather than freeze on one fat setState."
> — [`useTransitData.ts:158`](../../src/hooks/useTransitData.ts)

否則 ~3.6 MB 的 JSON 會集中在一個 commit 裡 parse + setState，main thread 卡 1–2 秒。

## 9. Ferry path 長度 cache + 2D circle for 遠景

- `ferryPathMinutesCache` 把 `(routeId:terminal:berthIndex)` → 巡航分鐘數的計算 cache 掉（[`simulationEngine.ts:1184`](../../src/engines/simulationEngine.ts)）。
- 渡輪在大 zoom out 時跟 vehicle layer 一樣退到 circle。

## 10. `flightOnly` per-frame 補償

**問題**：飛機在高倍速（≥5×）下視覺會「前後抖動」。原因：sim engine 30 Hz 步進、飛機在 climb 階段每 tick 走 3–25 m，當 sim speed 5× 時每 tick 走 15–125 m，畫面看到的位置是 hold 一個 tick 的長度。

**Fix**：新增 `computeFlightOnly(transitData, time)` 只算航班，從 MapView 的 RAF render loop 每 frame 呼叫，讓飛機位置跟連續時間走、不被 sim tick 量化。

> Source: [`simulationEngine.ts:1351`](../../src/engines/simulationEngine.ts)。
