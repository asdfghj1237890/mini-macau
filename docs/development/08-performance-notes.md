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

## 3. Two-tier animation throttle

**問題**：把 300+ 台巴士當 3D fill-extrusion polygon 畫很重（每台車 5 個矩形 × 4 個角的 lat/lng 數學）。當 2D circle 畫近乎免費（只是個 Point FeatureCollection 的 `setData`）。

**Fix**：把它們拆成兩個節流頻率：

```
SIM_TICK_MS         = 33   // ~30 Hz：模擬 + 2D circle 永遠用這個
HEAVY_TICK_MS_BUSY  = 160  // map 在動的時候，3D rebuild 改用這個
```

`mapBusyRef` 由 MapLibre 的 `movestart` / `moveend` 控制。pinch zoom 中：

- 2D circle 仍 30 Hz 更新 → 視覺上車輛還是流暢移動
- 3D polygon rebuild 退到 6 Hz → 把 main thread 讓給 MapLibre 的 zoom 渲染

zoom 結束 → 3D 立刻回到 30 Hz。

> Source: [`MapView.tsx`](../../src/components/MapView.tsx) 的 `mapBusyRef` + `SIM_TICK_MS` / `HEAVY_TICK_MS_BUSY`（行 810、872 附近）。

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

## 6. RT mode skip bus sim

RT mode 開時，sim 算出來的所有巴士會被 RT 的 BusTracker 結果覆蓋掉。所以根本不必算。`computeVehiclePositions(transitData, time, { skipBuses: true })` 跳過整個 `computeBusVehicles`（90 路 × ~10 車 × per-tick 算 progress + queue + interpolation 不便宜）。

> Source: [`simulationEngine.ts:1300`](../../src/engines/simulationEngine.ts) 的 `ComputeOptions`。Cross-link [06-realtime-mode.md](06-realtime-mode.md)。

## 7. 漸進載入 + lazy bundle split

- **MapView lazy import**：[`App.tsx:21`](../../src/App.tsx)。`<MapSplash/>` 先撐住 LCP，後台 parse maplibre-gl bundle（~1 MB）。
- **每個 InfoPanel 各自 lazy**：點到車輛才載入 `VehicleInfoPanel`、點到站才載入 `StationInfoPanel`，等等。
- **Vendor chunk split** in [`vite.config.ts`](../../vite.config.ts)：
  - `vendor-react`
  - `vendor-maplibre`（最大塊，CDN 緩存特別有用）
- **Trips 按 scheduleType lazy**：`src/data/trips-*.json` 經 `import.meta.glob` 各自成為一個 chunk，先 import 今天的，剩下兩個在主資料完成後背景 prefetch（[`useTransitData.ts`](../../src/hooks/useTransitData.ts) 的 `loadTrips`）。

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
