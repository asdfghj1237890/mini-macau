# 04 · 3D Layers

四種交通工具（巴士、輕軌、航班、渡輪）都用 **MapLibre 原生的 `fill-extrusion` layer** 畫，不引入 Three.js / deck.gl。每台「車」就是一組薄薄的 polygon、各自被 extrude 到不同高度，靠不同 `kind` filter 分到不同 layer。

這個取捨換來：

- bundle 不多一個 GL 框架（vendor-maplibre 已經是 1 MB）
- 完全沿用 maplibre 的相機、光照、render order
- camera underneath / 上方建築遮擋 maplibre 自然處理
- 代價：每台車要重算多個 polygon、每 frame `setData()` 一個大 FeatureCollection（見 [08-performance-notes.md](08-performance-notes.md) 的 throttle 章節）

## 共同模式

每個 `*3DLayer` class 大致長這樣：

```ts
class XLayer {
  attach(map): void              // 一次性 addSource + 多個 addLayer
  setData(vehicles): void        // 重建 feature collection、map.setData
  detach(map): void
}
```

幾何模式都一樣：

1. 給定 `(lng, lat, bearing)`，先用 `rectanglePolygon()` 算出車身在「以 bearing 為 y 軸的 local 平面」上的四個角，再投影回 lng/lat。
2. 用 `METERS_PER_DEG_LAT = 111320` 換算南北、用 `cos(lat)` 修正東西。每個 layer 自己 const 一份這個常數。
3. 各個小零件（窗、輪、尾翼、機翼）用 `offsetInBus()` 之類在 local 座標系裡先位移再投影。

## [`Bus3DLayer.ts`](../../src/layers/Bus3DLayer.ts) — 5 種 polygon

| `kind` | 內容 | base / height (m) | filter |
|--------|------|-------------------|--------|
| `wheel` | 4 顆輪子（前後兩軸 × 左右） | 0 → 2.0 | 黑色 |
| `body` | 主車身矩形 | 1.8 → 6.5 | 線路顏色 |
| `roof` | 略小的車頂 | 6.5 → 7.0 | 線路顏色 |
| `window` | 兩側帶狀車窗 | 3.2 → 5.8 | 暗藍灰 |
| `windshield` | 前擋風 | 0 → 6.5 | 同 window |

單一 source `bus-3d-source` + 5 layers，全部用 `kind` 篩。`MIN_ZOOM` 行動裝置 16 / 桌面 16.9，zoom 不夠就完全不畫（節省繪圖成本，遠的時候反正也看不到）。

## [`LRT3DLayer.ts`](../../src/layers/LRT3DLayer.ts) — 雙節列車 (~57 m)

7 個 layer：bogie（轉向架）、body、gangway（兩節間連結）、window、windshield、roof。`bearing` 來自 `interpolateOnLineSmooth` 的平滑值（見 [03-simulation-engine.md](03-simulation-engine.md)），避免 LRT 過彎時車身在 segment 邊界 snap。

## [`Flight3DLayer.ts`](../../src/layers/Flight3DLayer.ts) — 7 種 polygon × 2 sources

7 layer：fuselage、wing、tail、engine、vtail、window、nose。

**為什麼有 tracked + 普通 兩套**：被 user 點 follow 的航班需要 `setData` 的觸發頻率高（每 RAF 一次），其他航班則跟 sim tick 走（30 Hz）。把 tracked 拉到自己的 source `flight-3d-tracked-source`，就只 redraw 那一台，省掉重建整個 FeatureCollection 的成本。所以 layer ID 有 `FLIGHT_3D_*` 跟 `FLIGHT_3D_TRACKED_*` 兩組。

Window 用 `windowDots()` 算法分布：根據機身長度沿著 fuselage 長軸排列小點，模擬機窗。

## [`Ferry3DLayer.ts`](../../src/layers/Ferry3DLayer.ts) — 噴射船 8 layers

8 layer：hull、hull_red（船腹紅帶）、white_band（TurboJET 白帶）、cabin、window、upper、wheelhouse、roof。船型是基於 jetfoil 的剖面分層 extrude。bearing 從 `interpolatePath` 拿，arrival 會把 bearing 加 180° 因為走的是反方向。

## [`VehicleLayer.ts`](../../src/layers/VehicleLayer.ts) — 2D circle fallback

縮太遠看不到 3D 細節時、或 zoom 低於 `MIN_ZOOM` 時，由 2D circle layer 接手。每台車一個 circle + 一個 text label（route ID）。

`addVehicleLayers(map, lang)` 一次性註冊，`updateVehicleData(map, vehicles)` 每 sim tick 餵新的 FeatureCollection。`updateVehicleLabelLang(map, lang)` 切語言時更新 label 的 `text-field` 表達式。

## 大型優化：單一 `bus-routes` source

巴士 92 條路線曾經是 92 個 `addSource` + 92 個 `addLayer`。每次 zoom MapLibre 都要對每個 source 各做一輪 worker tile-index rebuild + postMessage。合成單一 source 後，per-route 的 dim/highlight 改用 `setFeatureState({ source: 'bus-routes', id }, { inService })` 配合 paint expression `['case', ['==', ['feature-state', 'inService'], false], DIM, FULL]`。

關鍵差別：**`setFeatureState` 不重編 paint，`setPaintProperty` 會**。前者幾乎免費，後者每次都丟掉 GPU 上的 paint program。

完整原由與 trade-off 見 [08-performance-notes.md](08-performance-notes.md)。

## Layer 順序疑問

3D layer 依序在 `MapView.tsx` attach。底建築物（OpenFreeMap `BUILDINGS_LAYER_ID`）通常在所有車輛 layer 之下；車輛 layer 之間的順序是 wheel → body → roof → window → windshield，這樣大致符合「下方部件先畫、上方覆蓋」的視覺直覺，雖然 fill-extrusion 本身有 z-buffer，順序問題其實不大。

## 加新車型的工作量

1. 寫一份 `XGeometry.ts`（或直接寫死在 layer 檔），定義零件大小常數、`buildXFeatures(vehicles)` 把 `VehiclePosition[]` 轉成 `Feature<Polygon>[]`，每個 feature 帶 `kind` 屬性。
2. 寫 `XLayer` class：`attach()` 註冊一個 source 跟 N 個 fill-extrusion layer，每層按 `kind` filter；`setData()` 餵新 FeatureCollection。
3. 在 `MapView.tsx` attach、把 sim engine 出來的對應 `vehicle.type` filter 給它。
4. 加 `vehicle.type` 到 `VehiclePosition['type']` union。
