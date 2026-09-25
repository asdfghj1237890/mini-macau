# 04 · 3D Layers

四種交通工具（巴士、輕軌、航班、渡輪）的**可見模型**都由 TypeScript 程式化產生 triangle mesh，再由 MapLibre custom 3D layer 在地圖既有的 WebGL2 context 裡做 instanced rendering。不引入 Three.js / deck.gl，也不載入 glTF、OBJ 或貼圖檔；車窗反光、輪拱、車門、燈具、船艙和引擎等細節都是幾何或頂點材質。

每種車型只有一份 immutable mesh。每台車每次更新只傳位置、方向、比例和塗裝顏色；同一車型的整批車輛由 `drawArraysInstanced` 畫出。這個取捨換來：

- bundle 不多一個 GL 框架或模型 loader（`vendor-maplibre` 本身已經很大）
- 沿用 MapLibre 的相機、projection、depth buffer 與 render order；建築物可以正常遮擋車輛
- 同一份高細節 mesh 可以重用在整個車隊，不需要為每台車重建幾何或 GPU vertex buffer
- 代價是自行維護 shader、buffer lifecycle、Mercator 精度與 context rebuild

舊有的 GeoJSON 幾何沒有完全刪掉：每台車仍有少量、`fill-extrusion-opacity: 0` 的粗略 volume，專門讓 `queryRenderedFeatures`、delegated click／hover 和 selection 繼續工作。它們是**透明 picking volumes**，不是畫面上看見的模型。唯一仍以可見 `fill-extrusion` 組裝的移動車型是 GRAND PRIX 的單一賽車。

## 共同模式

[`InstancedVehicleModelLayer.ts`](../../src/layers/InstancedVehicleModelLayer.ts) 是四種交通工具共用的 renderer。mesh 的 interleaved vertex format 是：

```text
position.xyz + normal.xyz + material.rgb + liveryWeight
```

LRT 多一個 `frontWeight`，讓同一個 vertex 在前後車廂 transform 之間選擇或漸變。各 `*Mesh.ts` 用 `tri`、`quad`、`face`、`box`、`cylinder`、`loft` 等小 helper 直接產生 `Float32Array`；材質 alpha 通道不是透明度，而是「混入路線／營運商顏色的權重」，負值代表不受光照衰減的車燈。

每個 `*3DLayer` wrapper 大致長這樣：

```ts
class XLayer {
  attach(map): void              // transparent picking source/layers + custom model layer
  setVehicles(vehicles): void    // instance buffer + low-detail picking volumes
  detach(): void
}
```

共同 renderer 的工作：

1. `vehicleInstances()` 用 `MercatorCoordinate.fromLngLat` 把 `VehiclePosition` 轉成 instance offset、`cos/sin(bearing)`、map scale 與 RGB livery。
2. 座標先相對澳門附近的固定 origin 表示；matrix 在 CPU 端把 origin 折回去，避免把絕對 Mercator 座標塞進 32-bit float 後讓靜止車輛抖動。
3. vertex shader 旋轉、縮放和定位共享 mesh；LRT 另套用前／後車廂 transform。fragment shader 用法線算簡單的方向光與天光。
4. mesh vertex buffer 使用 `STATIC_DRAW`。車隊 instance buffer 只在容量增長時重新 `bufferData`，其餘 pose 用 `bufferSubData` 覆寫；一般車隊與 tracked 航班最多兩個 instanced draw。
5. renderer 使用 MapLibre 已有的 WebGL2 context 和 depth buffer，不建立額外 canvas 或 context。

## [`Bus3DLayer.ts`](../../src/layers/Bus3DLayer.ts) + [`busMesh.ts`](../../src/layers/busMesh.ts)

巴士是參考澳門三門中通 11.3 m 輪廓手工建出的 triangle mesh：圓角車頂、斜前擋、真正挖開的輪拱、12 段圓柱輪胎與輪圈、左側三道車門、分片車窗、倒後鏡、頭尾燈、目的地燈點和車頂 HVAC 都是幾何。固定材質負責白色車身、玻璃、橡膠與金屬；路線顏色只混進指定的 livery surface，所以不用為每條線建立另一份 mesh。

mesh 以 2× 尺寸編寫，simulation 的 `BUS_MAP_SCALE = 0.5` 還原到道路尺度。`Bus3DLayer` 只把 viewport 附近的巴士送進 instance batch；移動鏡頭時每 100 ms 至多重算一次可見集合，pause 時平移地圖仍能顯示剛進入畫面的巴士。`bus-3d-source` 現在每台車只留一個透明 body envelope 作 picking。可見模型的 `MIN_ZOOM` 是行動裝置 16、桌面 16.9。

## [`LRT3DLayer.ts`](../../src/layers/LRT3DLayer.ts) + [`lrtMesh.ts`](../../src/layers/lrtMesh.ts) — 有關節的雙節列車

兩節車廂、風琴位、圓角車殼、駕駛室玻璃、滑門、窗柱、轉向架、輪胎、屋頂設備、燈光和固定的銀／銅飾線都在同一份 mesh。列車以 `LRT_VIADUCT_TOP_M = 7.2` 為預設地面高度。

[`lrtArticulation.ts`](../../src/layers/lrtArticulation.ts) 不只使用車身中心的一個 bearing：它沿目前方向的軌道取樣兩節車廂各自的 bogie 位置，求出 front／rear rigid transform；車廂頂點的 weight 固定為 0 或 1，中間風琴位則沿長度從 0 漸變到 1。vertex shader 因此能在彎道上保持兩節車廂剛性，同時讓接縫連續；很急的彎再只增加必要的縱向 clearance，避免內側白色車角互相穿插。透明 picking volumes 使用同一套 articulation transform。

## [`Flight3DLayer.ts`](../../src/layers/Flight3DLayer.ts) + [`aircraftMesh.ts`](../../src/layers/aircraftMesh.ts)

飛機機身由一串圓形截面 `loft` 出來，再加入有厚度的後掠翼、水平尾翼、垂直尾翼、翼尖、引擎 nacelle／內凹進氣口／spinner、沿圓筒貼合的窗列，以及細分後貼合機鼻曲面的 cockpit 玻璃。每班航班的顏色經 livery weight 混到翼尖與尾翼等指定表面；模型在 simulation 端以 `scale: 0.25` 顯示。

**為什麼仍有 tracked + 普通兩套**：普通航班使用 fleet instance batch；正在 follow 的航班移到獨立 tracked batch，能跟 camera target 同步更新而不重送整個機隊。兩個 GeoJSON source 只保存低細節透明 picking volumes；tracked source 可以較高頻率更新自己的小集合。

## [`Ferry3DLayer.ts`](../../src/layers/Ferry3DLayer.ts) + [`ferryMesh.ts`](../../src/layers/ferryMesh.ts)

渡輪是程式化的高速雙體船：兩條獨立刀形船體保留真正的中央水道，上方有連續斜面船艙、分片側窗、上層客艙、環繞駕駛台、登船平台與欄杆、排氣罩、屋頂設備、雷達桅杆和紅／綠航行燈。營運商顏色由 instance livery 套到指定船身表面。GeoJSON picking geometry 只用幾個分離的船體／船艙 volume，不會用一個高方盒遮住中央空隙。arrival 沿反向 path 行駛，所以 simulation 仍將 path bearing 加 180°。

## [`RaceCar3DLayer.ts`](../../src/layers/RaceCar3DLayer.ts) — 大賽車的車（12 個方塊，差異更新）

GRAND PRIX 圖層的單一賽車：body、nose、兩個 sidepod、airbox、cockpit、前後翼、四個輪子共 12 個 fill-extrusion 方塊，顏色／底高／高度都是 feature property，整台車一個 source。位置由 [`grandPrix.ts`](../../src/grandPrix.ts) 的 `grandPrixCarState` 依模擬時鐘與速度曲線算出，`grandPrixCarScale` 隨 zoom 放大。跟其他車輛層不同的是 `setPose()`：車出現時整包 `setData` 一次，之後每個 feature 用固定 id（0–11）走 `updateData` 差異更新，MapLibre 只重載車碰到的一兩片 tile；尾跡（`grandprix-wake`，`lineMetrics` + `line-gradient`）與時速標籤（`grandprix-car-label`）在 `MapView` 裡用同樣的模式。

## [`VehicleLayer.ts`](../../src/layers/VehicleLayer.ts) — 2D circle fallback

縮太遠看不到 3D 細節時、或 zoom 低於各模型的 `MIN_ZOOM` 時，由 2D circle layer 接手。每台車一個 circle + 一個 text label（route ID）。

`addVehicleLayers(map, lang)` 一次性註冊，`updateVehicleData(map, vehicles)` 在上傳節奏（桌機 33 ms、手機 100 ms、地圖移動中 160 ms）餵新的 FeatureCollection——不是每個 RAF frame。source 的 `maxzoom` 是 `VEHICLE_SOURCE_MAXZOOM`（15）；巴士／輕軌／渡輪的**透明 picking source** 也共用這個值。`updateVehicleLabelLang(map, lang)` 切語言時更新 label 的 `text-field` 表達式。

## 城市資料層（非車輛）── 學校 / 道路工程 / 公廁 / 停車場 / 供水 / 垃圾回收

這四層跟上面的車輛 layer 不是同一類東西：不隨 sim tick 動，資料是靜態或準靜態的點/面。各自的 helper 集中在 [`src/schools.ts`](../../src/schools.ts)、[`src/roadWorks.ts`](../../src/roadWorks.ts)、[`src/toilets.ts`](../../src/toilets.ts)、[`src/carParks.ts`](../../src/carParks.ts)，`MapView.tsx` 只管 addSource/addLayer 跟 setData。WATER／POWER／WASTE 帶示意網路、設施建築與較多子圖層，另成一類，見下面各自的小節；它們跟其他圖層一樣是獨立開關（2026-09-20 起沒有專注模式），可以同時開，也能與交通圖層並存。

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

### 垃圾回收：沒有自己的街道網

九種收集點型別（垃圾房、壓縮式垃圾收集點、垃圾站、智能回收機、三色資源回收點、電腦及通訊設備回收點、光管及電池回收點、玻璃樽回收點、衣物回收點）、DSPA 環保加Fun站（10 個回收站，`eco_station` 一列）、「處理設施」一列（焚化中心＋特殊和危險廢物處理站＋兩個堆填區，四個一起開關，`facility`）、以及「污水處理廠」一列（5 座 DSPA 污水處理廠，`wwtp`，跟處理設施分開一列，因為讀者想知道「垃圾去哪」不該連帶把處理污水的廠也關掉）——一共十二個 key 列——是一個獨立的城市圖層：開關只改 `wasteOn`，不會收起、也不會事後還原其他圖層，時間控制是否顯示也與它無關（只看有沒有交通圖層開著，見 [09-frontend-ui.md](09-frontend-ui.md)）。

跟 WATER／POWER 的差異：**垃圾回收沒有自己的街道網**。WATER／POWER 的示意管網、電網與配水／配電 layer 由 [`MapView.tsx`](../../src/components/MapView.tsx) 的 `applyNetworkVisibility(m, water, power, data)` 依各自的開關切 layout visibility（共用 [`src/layerVisibility.ts`](../../src/layerVisibility.ts) 的 `applyOverlayVisibility`，換底圖後重套一次）；WASTE 沒有這種常駐 layer 群——垃圾點、堆填區、焚化廠建築全部是「資料陣列一清空就消失」的機制，開關全靠 [`src/waste.ts`](../../src/waste.ts) 的 `visibleWasteSites`／`visibleWasteEcoStations`／`visibleWasteFacilities`／`visibleWasteIncinerator` 過濾出來，不需要另外切 layer visibility。

**焚化中心是借來的，不是重新抓的**：澳門垃圾焚化中心早就是 `power-facilities.json` 的一筆 `incinerator` 記錄（POWER 層把它當發電站畫，因為它把電賣給澳電）。與其為 WASTE 再管一份重複的 11 棟足跡，`wasteIncinerator(transitData.powerFacilities)` 直接在已經載入的電力設施清單裡按 `id==='incinerator' && type==='incinerator'` 雙重比對找那一筆，找不到（`power-facilities.json` 還沒到齊）就回 `null`；這個查找不看 `wasteOn`、只看 POWER 資料是否已經進 `TransitData`，POWER 開關與否不影響 WASTE 找不找得到它。找到之後 `buildWasteBuildingFeatures` 用跟 `buildPowerBuildingFeatures` 一樣的寫法，另開一個獨立的 `waste-buildings` fill-extrusion source／layer 畫它——同一個 `firstSymbolId` 插入點、同一套 +2 m 高度餘量（`WASTE_BUILDING_HEIGHT_MARGIN_M`），同一顆 `#a3e635`（POWER 畫它用的顏色，兩邊寫死同一個常數，不會走鐘）——選取時整組 `setFeatureState({selected:true})` 變白（`#ffffff`），跟 SCHOOLS 同招，不疊高亮圈。焚化中心的**月度統計**（收/處理量、發電、回收金屬）不再放 waste.json——那塊搬進獨立的 `dspa-stats.json`（見 [05-data-pipeline.md](05-data-pipeline.md)），waste.json 完全不帶 `incinerator` 欄位了；座標與建築一律問 POWER 要，統計一律問 `dspa-stats.json` 要。

**兩個堆填區是新的一種圖層**：建築廢料堆填區（OSM way `552848944`）與九澳飛灰堆填區（way `552740242`）的外環存進 `WasteFacility.polygon`，`buildWasteAreaFeatures` 轉成 `waste-areas`（fill，`#a8a29e`、`WASTE_AREA_FILL_OPACITY = 0.35`）＋`waste-areas-outline`（line，同色 1.5 px）兩個 layer，一樣掛在 `firstSymbolId`（底圖填色之上、所有 label 之下），一樣是空陣列即消失、`facility` 列關掉就沒有；選取同樣用 `setFeatureState` 整片變白，不是圈。特殊和危險廢物處理站沒有輪廓——位置只是約略（`approximate: true`），畫外框等於捏造事實——因此只給一個 marker。建築廢料堆填區與危廢站都帶 `statsKey`（分別是 `"landfill"`、`"hazardous"`），九澳飛灰堆填區沒有——DSPA 沒公開它的數字，面板就老實說沒有。

**五座污水處理廠是第三種足跡來源**：跟焚化中心（借 POWER 的記錄）、堆填區（面）都不一樣，五座廠（澳門半島、氹仔、路環——含路環再生水站、跨境工業區、機場）的 `buildings[]` **直接存在 `WasteFacility` 自己身上**（跟 `PowerFacility.buildings` 同一種形狀：OSM 足跡比照水／電廠房切基圖圖磚），不用再借別的檔案。`buildWasteBuildingFeatures(incinerator, facilities)` 因此收兩路輸入：焚化中心的 11 棟（來自 POWER）用 `#a3e635`（萊姆綠）、每座污水廠自己的足跡（機場廠沒有）用 `wasteFacilityColor()` 決定的顏色——`wwtp` 一律 `#a78bfa`（紫）——全部畫進同一個 `waste-buildings` source／layer，`facilityId` 當 promoted id，選取一樣整組變白。五座廠裡機場廠 DSPA 完全沒公開數字（`statsKey: null`），其餘四座各自的 `statsKey`（`"wwtp.macau"`／`"wwtp.taipa"`／`"wwtp.coloane"`／`"wwtp.crossborder"`）指去 `dspa-stats.json` 裡 `wwtp` 底下同名的欄位——用點分隔的字串一個 `seriesForKey()` 就查得到，面板不用另外維護一張對照表。

Marker 畫法比照 WC／P：`drawWasteIcon(type)` 現畫九種 `ImageData`（垃圾房＝加蓋垃圾桶、壓縮式收集點＝垃圾桶配向下箭頭、垃圾站＝無蓋垃圾桶、智能回收機＝帶投入口的箱子、三色資源回收點＝三條直條紋、藍黃棕對應 [`WASTE_THREE_COLOUR_BINS`](../../src/waste.ts)、電腦及通訊設備回收點＝顯示器、光管及電池回收點＝電池、玻璃樽回收點＝玻璃樽、衣物回收點＝衣服），另外五個 draw 函式給非收集點的標記：`drawWasteIncineratorIcon()`（煙囪加火焰）、`drawWasteEcoStationIcon(approximate)`、`drawWasteHazardousIcon(approximate)`、`drawWasteLandfillIcon()`（土丘，疊在堆填區形心）、`drawWasteWwtpIcon()`（水滴配箭頭，疊在污水廠足跡形心）——環保加Fun站與危廢站的約略位置變體用 `-approx` 圖名畫成空心，跟供水／電力標記分辨「精確 vs 約略」同一套視覺語言，全部包在 `hasImage` guard 裡每次 style load 重註冊。單一 source `waste`＋一個 symbol layer `waste-icon` 收全部收集點、環保站、危廢站、堆填區與污水廠中心點，`symbol-sort-key` 用 [`WASTE_SORT_KEY`](../../src/waste.ts)（稀有型別優先：玻璃樽與衣物回收點排最前，智能回收機接著，光管及電池回收點最後；垃圾站排在垃圾房與壓縮式收集點中間）；環保站與處理設施（含污水廠）額外給負的 sort key（`WASTE_FACILITY_SORT_KEY = -2`、`WASTE_ECO_STATION_SORT_KEY = -1`），比所有收集點都優先——~1,176 個標記裡只有 19 個屬於這兩類，隨便被一個光管回收點擠掉就是整張地圖唯一的一個消失。`closed`（IAM `tempClose`）站點 icon 透明度降到 0.45。另一個 `waste-selected` circle layer 疊在點狀圖示下面，`filter` 換 selected id，跟 WORKS/WC/P 的高亮圈同一招；面狀與建築類的選取則如上用 `setFeatureState` 整片變白。

點擊依 `WasteSelection`（`{kind:'site'}` / `{kind:'incinerator'}` / `{kind:'ecoStation'}` / `{kind:'facility'}` 的 tagged union）分派到四個面板之一，全部從同一個檔案 [`WasteSiteInfoPanel.tsx`](../../src/components/WasteSiteInfoPanel.tsx) 各自 `lazy()` 匯出（一個 chunk，四個具名 export）：`WasteSiteInfoPanel`／`WasteIncineratorInfoPanel`／`WasteEcoStationInfoPanel`／`WasteFacilityInfoPanel`。危廢站、堆填區、污水廠都是同一種 `WasteFacility`，共用同一個 `WasteFacilityInfoPanel`——面板內部按 `facility.kind` 切三種圖表標題與 chip 排法（污水廠：基本／生物／總處理量三個 chip；堆填區：堆埋體積一個 chip；危廢站：接收／處理量兩個 chip），圖表數字則透過 `facility.statsKey` 從 `dspaStats` 現查，沒有新開一個面板元件。選取仍跟其他 selection 互斥。

### 供水設施：色塊 + 水面 + 標記 + 管線

WATER 一層有九個 layer，全部在 `addCustomLayers` 建、換底圖後重建，可見性跟著 App 傳入的 `waterVisible`（即 `waterOn`；管網類 layer 由 `applyNetworkVisibility` 切換，[`src/water.ts`](../../src/water.ts) 出 feature，[`MapView.tsx`](../../src/components/MapView.tsx) 管 layer）：

- `water-surfaces`（fill，三個自來水水塘＋黑沙水庫的水面，半透明藍）、`water-buildings`（fill-extrusion，水廠建築、高位水池、石排灣泵房；跟學校同一套 promoteId／選取變白／2 m 餘量／插入點）、`water-icon`（canvas 水滴，依類型上色；約略位置畫成空心；珠海原水輸入口是另一個圖示並帶 `text-field` 標籤，語言切換時只換 `text-field`，不重建 source）、`water-selected`。
- 主幹管四層：`water-pipes-glow`（寬、半透明）、`water-pipes-dashed`（原水與 `fallback` 管段——`line-dasharray` 一層只能烤一種花紋，所以虛線自成一層）、`water-pipes`（淨水實線）、`water-pipes-flow`（淨水實線上的白色粗點，約核心線寬的 0.75 倍，表現流向）。幾何來自 `water-facilities.json` 的 `network`（OSRM 沿路，同址短接為直線 `direct`，頂點順序一律 from→to，流動方向才對）。**動畫不能改 `line-dasharray`**：它是 cross-faded 屬性，任何 `setPaintProperty` 都會讓整個 source 重切瓦片（`Style._updateLayer` → source `reload`），4,910 段道路每秒重切十幾次畫面就會閃（`visibility` 切換也一樣會重載；`sourcedata` 的 `content` 事件看不到 GeoJSON 重載，要看 `style._updatedSources`）。所以每個會動的群組（原水虛線、淨水流點、配水流點）都預先建好 K 個相位圖層（主幹 8、配水網 6），各自固定一組 dasharray，唯一的 ~70 ms interval 每 tick 只把上一相位的 `line-opacity` 設 0、下一相位設回原值——常數對常數的 paint 變更不重切圖，而 MapLibre 對 opacity 0 的線圖層直接跳過繪製，所以隱藏的相位沒有 draw call。實測穩態零次重載、85 fps。主幹管刻意比配水路網粗很多（核心約 4.5→7 px 對 0.8→1.6 px），層級才分得出來。
- 配水路網：`water-distribution-glow` / `water-distribution`，來源是延遲載入的 `water-distribution.json`（澳門邊界內的 OSM 道路，每條路一個 LineString，線寬依道路等級，透明度 0.7），疊在主幹管之下、底圖道路之上；不在 RAF tick 裡碰它。桌面版（`min-width: 640px`）另有 `water-distribution-flow`：白色細點沿全部道路流動，由同一個 interval 推進；窄視口不建這一層。流向是真的：`fetch_water_distribution.py` 把道路接成圖，從每個自來水的水廠／高位水池／泵站（吸附到最近頂點）做多源 Dijkstra，再把每條路的頂點順序改成「離水源近→遠」（碰到兩個水源的路在最低點切開），並附 `dist`／`distEnd`（公尺，未連通的為 null）；前端只要沿頂點順序推 dash offset，水就從廠站往最遠的街道流。

點擊順序：`water-buildings` 先註冊、`water-icon` 後註冊——同址的約略標記疊在廠區色塊上，兩層都會命中，最後註冊的贏，所以點到的是標記。

### 電力：同一套機制，換成琥珀色與電壓分級

POWER 一層完全照供水那套：`power-buildings`（路環發電廠、焚化中心、變電站的 OSM 輪廓依類型上色）、`power-icon`（閃電圖示，約略者空心；三個廣東電網輸入口有自己的圖示與標籤）、`power-selected`、示意高壓網的相位圖層群（`power-lines-*`，線寬與顏色依 220／110／66 kV 分級，流點從輸入口與電廠往外走）、配電網 `power-distribution-*`（與供水共用同一份澳門道路，但另一份 `power-distribution.json` 是以全部變電站為源頭重新定向的）。資料來自 `power-facilities.json`（澳電 2025 年營運頁的設施清單＋OSM 幾何；高壓電纜幾乎全在地下，OSM 沒有線路，所以電網是我們自己的示意邊表：輸入口→落地的 220 kV 站→主幹環→電廠，110／66 kV 站各接最近的上一級站，路徑走 OSRM）。動畫規則同上：只切相位圖層的透明度。

## 大型優化：單一 `bus-routes` source

巴士 92 條路線曾經是 92 個 `addSource` + 92 個 `addLayer`。每次 zoom MapLibre 都要對每個 source 各做一輪 worker tile-index rebuild + postMessage。合成單一 source 後，per-route 的 dim/highlight 改用 `setFeatureState({ source: 'bus-routes', id }, { inService })` 配合 paint expression `['case', ['==', ['feature-state', 'inService'], false], DIM, FULL]`。

關鍵差別：**`setFeatureState` 不重編 paint，`setPaintProperty` 會**。前者幾乎免費，後者每次都丟掉 GPU 上的 paint program。

完整原由與 trade-off 見 [08-performance-notes.md](08-performance-notes.md)。

## Layer 順序疑問

3D layer 依序在 `MapView.tsx` attach。底建築物（OpenFreeMap `BUILDINGS_LAYER_ID`）通常在車輛 custom layers 之下；每個 model layer 宣告 `renderingMode: '3d'`，開啟 MapLibre 共用的 depth test，因此三角形和建築的前後關係由 depth buffer 決定，不靠 wheel／body／roof 的 layer 排序。透明 picking layers 的排序只影響 delegated event 命中，不提供可見外觀。航班 label 在 model attach 後再 `moveLayer` 到最上方，避免機身蓋住自己的航班號。

## 加新車型的工作量

1. 寫 `xMesh.ts`：以公尺為 local unit，用 triangle helpers 產生 position／normal／material 的 interleaved `Float32Array`；決定哪些 surface 接受 instance livery。
2. 寫 `xGeometry.ts`：只建立足以點擊的低細節 polygon envelope，帶 `vehicleId`、`baseM`、`heightM`；不要把可見細節重複放進 GeoJSON。
3. 寫 `X3DLayer` wrapper：attach 透明 picking source/layer，再建立一個 `InstancedVehicleModelLayer`；zoom、viewport culling 和 empty-update guard 在這層處理。
4. 若車體有關節，為 mesh 增加 blend weight，並透過 `ModelArticulation` 傳 front／rear transform；不要為每節車廂各開一個完整 draw path。
5. 在 `MapView.tsx` attach、detach，並把 simulation engine 的對應 `vehicle.type` 送入 `setVehicles()`。
6. 加 `vehicle.type` 到 `VehiclePosition['type']` union，並為 mesh geometry、picking geometry、instance data 和 wrapper lifecycle 加 targeted tests；最後仍需在真實 MapLibre camera 下做視覺 QA。
