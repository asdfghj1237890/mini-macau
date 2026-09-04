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

## 城市資料層（非車輛）── 學校 / 道路工程 / 公廁 / 停車場 / 供水

這四層跟上面的車輛 layer 不是同一類東西：不隨 sim tick 動，資料是靜態或準靜態的點/面。各自的 helper 集中在 [`src/schools.ts`](../../src/schools.ts)、[`src/roadWorks.ts`](../../src/roadWorks.ts)、[`src/toilets.ts`](../../src/toilets.ts)、[`src/carParks.ts`](../../src/carParks.ts)，`MapView.tsx` 只管 addSource/addLayer 跟 setData。

### 學校：自己畫 extrusion，不吃 basemap

OpenFreeMap 的建築 tile 會把同高度的建築合併成一個 multipolygon feature（一個 z14 tile 裡 ~8000 棟樓只有 ~120 個 feature），沒辦法對單一建築做 `setFeatureState` 染色——那個 feature 底下可能塞了十幾棟不相干的房子。`schools.json` 因此自己帶 footprint（`buildSchoolFeatures`），MapView 開一個獨立的 `school-buildings` source + layer。

插入點刻意跟 `3d-buildings` 同一個 anchor（`firstSymbolId`），緊接在它後面加，所以校舍色塊穩穩疊在灰色 basemap 建築正上方，又還在所有 label/車輛 layer 下面。高度比 basemap 同一棟樓多 `SCHOOL_HEIGHT_MARGIN_M = 2`（公尺）——原本試過 0.5m，大片低矮屋頂（操場旁 5m 禮堂、60° pitch 看）會跟 basemap 自己的屋頂 z-fight 出白色條紋，z14→15.5 的高度 ramp 又會把 margin 一起縮小，所以拉到 2m。

### 道路工程：跟著模擬曆日，不是牆鐘時間

`road-works` source 的 FeatureCollection 只在模擬曆日變動、或 notice 陣列 identity 變動（資料到齊/面板開關）時重建（`roadWorksRenderRef`，比對 `macauDayIndex(simTime)`），其餘每 frame 只是一次整數比較。`roadWorkStatus` 回 `'active'`（在 `startDate`–`endDate` 內）或 `'upcoming'`（`ROAD_WORKS_UPCOMING_DAYS = 7` 天內即將開始），upcoming 的 icon `icon-opacity` 降到 0.5 跟 active 的 1 區分開。

### 公廁 / 停車場：canvas 畫圖示，不用 emoji

WC 跟 P 的 marker 都是 `drawToiletIcon` / `drawCarParkIcon` 現畫成 `ImageData`，`pixelRatio: 2` 註冊成 `map.addImage`。刻意不用 emoji：廁所 emoji 在每個平台長得不一樣，而且沒辦法重新上色——canvas 版本可以照 `TOILET_COLORS[variant]` 換色，還能跟其他城市圖層的視覺語言（同樣的圓角方框 + 白邊）對齊。`setStyle({diff:false})` 換 basemap 主題時圖片會被一起丟掉，所以圖片註冊包在 `hasImage` guard 裡，每次 style load 都重跑一次。

### Selected-highlight 層

WORKS / WC / P 三層各自多一個 `*-selected` circle layer，疊在 icon 下面，`filter: ['==', ['get','id'], selectedXId ?? '']`，白色 14% 透明填色 + 75% 透明白邊，半徑隨 zoom 內插（10→9px，15→17px，18→22px）。SCHOOLS 不用這招——building 面積夠大，直接用 `setFeatureState({selected: true})` 把整棟樓換成白色（`SCHOOL_SELECTED_COLOR`），不需要額外畫一個高亮圈。

### 停車場空位標籤

`vacancy` 屬性只在「有即時列、沒被標記維護中、車位數不是 null」時才附上（`buildCarParkFeatures`），所以 `text-field: ['get','vacancy']` 在未知/維護中/沒在 polling 時自然不顯示，不用另外判斷。標籤彼此會搶位置（同一棟樓兩個出入口只隔幾公尺），所以 `text-optional: true` 讓圖示贏、標籤讓位，`symbol-sort-key` 用遞增的數字 id 當優先權，避免地圖一動兩個標籤互相閃爍。z14 以下 `text-size` 直接是 0——城市尺度只看得到「P」牌，看不到數字。

即時數字只在 `carParksOn && clock.isLive`（1× 播放速度、在「現在」附近）時才 poll（[`useCarParkVacancy.ts`](../../src/hooks/useCarParkVacancy.ts)），規則一變 false 就立刻把 `vacancy` 設回 `null`，不會讓舊數字停在畫面上冒充即時。

### 供水設施：色塊 + 水面 + 標記 + 管線，只在專注模式出現

WATER 一層有九個 layer，全部在 `addCustomLayers` 建、換底圖後重建，可見性跟著 `waterFocus`（[`src/water.ts`](../../src/water.ts) 出 feature，[`MapView.tsx`](../../src/components/MapView.tsx) 管 layer）：

- `water-surfaces`（fill，三個自來水水塘＋黑沙水庫的水面，半透明藍）、`water-buildings`（fill-extrusion，水廠建築、高位水池、石排灣泵房；跟學校同一套 promoteId／選取變白／2 m 餘量／插入點）、`water-icon`（canvas 水滴，依類型上色；約略位置畫成空心；珠海原水輸入口是另一個圖示並帶 `text-field` 標籤，語言切換時只換 `text-field`，不重建 source）、`water-selected`。
- 主幹管四層：`water-pipes-glow`（寬、半透明）、`water-pipes-dashed`（原水與 `fallback` 管段——`line-dasharray` 一層只能烤一種花紋，所以虛線自成一層）、`water-pipes`（淨水實線）、`water-pipes-flow`（淨水實線上的白色粗點，約核心線寬的 0.75 倍，表現流向）。幾何來自 `water-facilities.json` 的 `network`（OSRM 沿路，同址短接為直線 `direct`，頂點順序一律 from→to，流動方向才對）。**動畫不能改 `line-dasharray`**：它是 cross-faded 屬性，任何 `setPaintProperty` 都會讓整個 source 重切瓦片（`Style._updateLayer` → source `reload`），4,910 段道路每秒重切十幾次畫面就會閃（`visibility` 切換也一樣會重載；`sourcedata` 的 `content` 事件看不到 GeoJSON 重載，要看 `style._updatedSources`）。所以每個會動的群組（原水虛線、淨水流點、配水流點）都預先建好 K 個相位圖層（主幹 8、配水網 6），各自固定一組 dasharray，唯一的 ~70 ms interval 每 tick 只把上一相位的 `line-opacity` 設 0、下一相位設回原值——常數對常數的 paint 變更不重切圖，而 MapLibre 對 opacity 0 的線圖層直接跳過繪製，所以隱藏的相位沒有 draw call。實測穩態零次重載、85 fps。主幹管刻意比配水路網粗很多（核心約 4.5→7 px 對 0.8→1.6 px），層級才分得出來。
- 配水路網：`water-distribution-glow` / `water-distribution`，來源是延遲載入的 `water-distribution.json`（澳門邊界內的 OSM 道路，每條路一個 LineString，線寬依道路等級，透明度 0.7），疊在主幹管之下、底圖道路之上；不在 RAF tick 裡碰它。桌面版（`min-width: 640px`）另有 `water-distribution-flow`：白色細點沿全部道路流動，由同一個 interval 推進；窄視口不建這一層。流向是真的：`fetch_water_distribution.py` 把道路接成圖，從每個自來水的水廠／高位水池／泵站（吸附到最近頂點）做多源 Dijkstra，再把每條路的頂點順序改成「離水源近→遠」（碰到兩個水源的路在最低點切開），並附 `dist`／`distEnd`（公尺，未連通的為 null）；前端只要沿頂點順序推 dash offset，水就從廠站往最遠的街道流。

點擊順序：`water-buildings` 先註冊、`water-icon` 後註冊——同址的約略標記疊在廠區色塊上，兩層都會命中，最後註冊的贏，所以點到的是標記。

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
