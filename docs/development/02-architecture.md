# 02 · Architecture Overview

整個系統乾乾淨淨地分三層：**外部資料源 → Python pipeline 產出 versioned JSON → 瀏覽器 runtime 在模擬時鐘上回放**。

```
┌──────────────────────────────┐
│  External sources            │
│  - OpenStreetMap (Overpass)  │
│  - MLM 輕軌時刻表             │
│  - DSAT 巴士頻率              │
│  - AviationStack (MFM 航班)  │
│  - TurboJET / CotaiJet 時刻表 │
└──────────┬───────────────────┘
           │
   ┌───────▼────────────────────────────────┐
   │  Python pipeline                        │
   │  - data/scripts/*.py（手動 / on-demand）│
   │  - GitHub Actions（每日 / 每月）        │
   └───────┬────────────────────────────────┘
           │ static JSON
           ▼
   ┌──────────────────────────────────────┐
   │  public/data/                         │
   │  - lrt-lines / stations              │
   │  - bus-routes / bus-stops            │
   │  - bus-junctions（啟動後才載入）     │
   │  - flights.json                      │
   │  - ferry-schedules.json              │
   │  - road-works.json                   │
   │  - schools.json                      │
   │  - toilets.json                      │
   │  - car-parks.json                    │
   │  - waste.json                        │
   │  - dspa-stats.json                   │
   │  - water-facilities.json             │
   │  - water-distribution.json           │
   │  - power-facilities.json             │
   │  - power-distribution.json           │
   │  - flights-timetable.json            │
   │  - public-housing.json               │
   │  - parishes.json                     │
   │  - religion.json                     │
   │  - grand-prix.json                   │
   │  - old-maps.json + old-maps/         │
   └───────┬──────────────────────────────┘
           │ fetch on page load
           ▼
   ┌────────────────────────────────────────┐
   │  Browser runtime                        │
   │  - simulationEngine.ts (playback)      │
   │  - 3D layers + React UI                 │
   └────────────────────────────────────────┘
```

> LRT 運動由 Pages Function 計算，瀏覽器從 `/api/lrt/state?at=<epoch-ms>` 載入固定 120 秒的狀態窗，預取下一個重疊窗。Function 依模擬時間處理日期、跨午夜及到離站事件；地圖與面板共用窗內狀態。來源檢查維持，回應為 `Cache-Control: private, no-store`。其餘資料集由 `/data/*.json` 載入。

## 三個階段各自負責什麼

### Stage 1 — 外部資料源

**特性**：每個源頭格式、頻率、可靠度都不一樣。Pipeline 的工作就是把它們 normalize 成 runtime 能直接用的同一種形狀。

| 源頭 | 內容 | 取得方式 |
|------|------|----------|
| OSM Overpass | LRT 軌道幾何、巴士路線幾何、巴士站位置 | `data/scripts/extract_*.py`，手動觸發 |
| MLM | 輕軌每站逐分鐘時刻表 | 官方 PDF/JPG → 人工轉錄與校對 → 按 scheduleType 載入 |
| DSAT 頻率 | 各路線發車間隔、服務時段 | `fetch_dsat_stops.py` + `patch_service_hours*.py` |
| AviationStack | MFM 機場每日航班 | `fetch_flights.py`（需 API key） |
| TurboJET / CotaiJet | 港澳渡輪月度時刻表 | `fetch_ferry_schedules.py`（直接 scrape HTML） |
| data.gov.mo | DSAT 工程改道消息（道路封閉/交通改道公告） | `fetch_road_works.py`（下載 ZIP 內 XML，含重試） |
| DSEDJ + OSM Overpass | 學校清單（核准級別）與校舍建築足跡 | `fetch_schools.py`（手動執行，name matching） |
| 房屋局（IH）+ 其他政府房屋公告 + OSM Overpass | 社會房屋／經濟房屋位置分佈、長者公寓／置換房／暫住房，各屋苑樓宇足跡與入伙年份 | `fetch_public_housing.py`（手動；清單在 Next.js RSC payload 裡，氹仔、路環要加 `?ioc=T`／`?ioc=C`；比對不到的屋苑列入 `unmatched`） |
| OSM + DSEC | 七個堂區與路氹填海區的邊界、2021 年人口普查人口與土地面積 | `fetch_parishes.py`（手動） |
| OSM + 澳門格蘭披治大賽車官網 | 東望洋跑道賽車線（OSM relation 8877949）、維修區、九個官方彎道名稱 | `fetch_grand_prix.py`（手動；彎道位置由規則推導，一律標 `approximate`） |
| data.gov.mo | IAM 公共廁所 / 無障礙公廁名單 | `fetch_toilets.py`（下載 ZIP 內 JSON，含重試） |
| data.gov.mo + OSM + 澳門記憶 | 文化局「文化遺產資料」API（被評定的不動產，端點尾斜線必加）＋ OSM 的土地廟／福德祠／土地神壇＋澳門記憶《社區守護神》展覽嵌的 Google My Maps | `fetch_religion.py`（手動；My Maps 的 KML 只有街名沒座標，改讀檢視頁 `_pageData` 的 geocode，標 `approximate`） |
| 哈佛地圖館、Internet Archive（Getty Research Institute）、美國國會圖書館、Barry Lawrence Ruderman（後四者多經 Wikimedia Commons）、里斯本海外歷史檔案館 DigitArq（CC BY-SA 4.0）、葡萄牙國家圖書館 BNP（Public Domain Mark 1.0）、Mindat | 15 筆歷史地圖（13 個選項列，1912 年地圖集三張共用一列）：貝林 1749、霍格版 1780 年代航海草圖、小德金 1792／1808、貝克 1796、英國海軍部 1290 號海圖 1858 修訂版、Heitor 1889 1:5,000、Sauvage 1893 手稿、1912 年《Atlas de Macau》半島／氹仔／路環三張、Alves／Pires 1927（含規劃）、約 1953 年《澳門市全圖》、Lemos de Sousa 1963 地質略圖、地圖繪製暨地籍司 1990 1:5,000 與 1991 1:20,000 | `scripts/build-old-maps.mjs`（Node + sharp，手動；配方分在 `old-maps-early／islands／lemos／dscc.mjs`，BNP 的 IIIF 區塊由 `old-maps-source.mjs` 組圖）。多數圖版以地標與岸線控制點做薄板樣條配準，岸線對應點在 `scripts/old-maps-coast/`；1990／1991 兩張改用圖上印的澳門坐標網格做一次仿射。輸出 `old-maps.json`、`public/data/old-maps/*.webp` 與部分圖版的瓦片金字塔 |
| data.gov.mo | DSAT 停車場資料（車位詳情 + 即時空位） | `fetch_car_parks.py`（API gateway，APPCODE header，含重試） |
| data.gov.mo + IAM 自家頁面 + OSM Overpass | IAM 垃圾房 / 壓縮式垃圾收集點 / 垃圾站 + IAM 環境資訊網（玻璃樽／衣物回收點，非 data.gov.mo）+ DSPA 智能回收機 / 三色資源回收點 / 電腦及通訊設備回收點 / 光管回收點 / 電池回收點（八個 dataset + 1 個 IAM 自家 JSON），另加手放的環保加Fun站 10 個、特殊和危險廢物處理站、兩個堆填區的 OSM 輪廓，以及五座污水處理廠（OSM 足跡，比照水／電廠房切圖磚，機場廠除外沒有 buildings 的以 statsKey 帶月度數字）；焚化中心本身的座標/建築借 `power-facilities.json` 現成的 | `fetch_waste.py`（IAM 四個走 ZIP／API gateway／自家 JSON，DSPA 六個走 API gateway，OSM 兩個 way 走 Overpass，APPCODE header 都含重試） |
| data.gov.mo（4 個 dataset）+ DSPA GIS 頁面（3 個，無 dataset id） | 垃圾焚化中心／特殊和危險廢物處理站／建築廢料堆填區／四座污水處理廠（機場廠沒有公開數字）的月度統計：收/處理量、發電量、回收金屬、堆埋體積、處理水量 | `fetch_dspa_stats.py`（API gateway，APPCODE header，含重試；每條 series 各自 best-effort，單一端點失敗只讓那個 series 存 null，不中止整個 run） |
| 澳門自來水 + OSM Overpass | 22 個供水設施（＋黑沙水庫）清單與建築足跡／水體、示意管網、當年供水統計與原水數字 | `fetch_water_facilities.py`（半年一次，`update-water-facilities.yml`；清單寫死在腳本裡，但每次執行由 `macao_water.py` 讀澳門自來水的 API 核對四座水廠名稱與示意圖 hash，數字也是每次從網站讀） |
| 澳電 (CEM) + OSM Overpass | 33 座高壓變電站、路環發電廠、垃圾焚化中心的清單與建築足跡、示意電網 | `fetch_power_facilities.py`（半年一次，`update-power-facilities.yml`；清單寫死在腳本裡，但每次執行由 `cem_operation.py` 讀澳電中、英文頁核對名單，數字也是每次從頁面讀） |
| OSM Overpass | 澳門境內可行車道路（給供水／供電配水層當底稿，裁到 SAR 邊界） | `fetch_water_distribution.py`／`fetch_power_distribution.py`（手動執行，共用 `road_network.py`） |

### Stage 2 — Python pipeline

詳見 [05-data-pipeline.md](05-data-pipeline.md)。重點是：

- **`uv` 管 Python 環境**（pyproject.toml in `data/`）
- **產出物 commit 進 git**（`public/data/*.json`）。runtime 沒有 build-time fetch，全部都是 static asset。
- **GitHub Actions 處理週期性更新**：航班、航班時刻表、道路工程、停車場與巴士服務狀態每日；渡輪、公廁、垃圾回收與 DSPA 統計每月；供水與供電設施每半年（3 月、9 月）。學校、居屋、堂區、宗教、大賽車、配水／配電路網與歷史地圖都是手動更新。詳見 [07-ci-and-data-sync.md](07-ci-and-data-sync.md)。

### Stage 3 — Browser runtime

```
App.tsx
├─ useSimulationClock      ─ 模擬時鐘（offset-based wall clock）
├─ useTransitData          ─ 4 份核心 JSON（LRT 線／站、巴士路線／站）決定 loading；航班、航班時刻表、渡輪背景載入；城市圖層資料由 cityData 的 store 在圖層第一次開啟時才抓（ensureCityLayerLoaded）
├─ useServiceStatus        ─ 從 service-status.json 拿當天停駛清單
└─ MapView.tsx             ─ 包 maplibre-gl 6；GPU 失敗重建一次，仍失敗則 lazy-load Leaflet 2D 相容地圖（見 11-webgl-recovery）
   ├─ simulationEngine     ─ 純函數：(transitData, time) → VehiclePosition[]
   ├─ Bus3DLayer           ─ 程式化 triangle mesh + instanced WebGL2 巴士
   ├─ LRT3DLayer           ─ instanced 雙節列車（GPU articulation）
   ├─ Flight3DLayer        ─ instanced 機身／機翼／引擎，tracked 獨立 batch
   ├─ Ferry3DLayer         ─ instanced 高速雙體船 mesh
   ├─ RaceCar3DLayer       ─ fill-extrusion 大賽車（12 個方塊，差異更新）
   └─ VehicleLayer         ─ 2D circle layer（zoom out 時 fallback）
```

關鍵設計選擇：

- **simulation engine 是 pure function**：給它 `(TransitData, Date)`，它回 `VehiclePosition[]`。沒有副作用，方便單元測試（[10-testing.md](10-testing.md)）。
- **時鐘是 offset-based 而非 RAF-summed**：背景分頁 RAF 被 throttle 仍能保持時間正確。[`useSimulationClock.ts:11`](../../src/hooks/useSimulationClock.ts) 的 docstring 有完整論證。
- **主要 3D 車輛使用共享的程式化 instanced mesh**：不引入 Three.js、deck.gl、glTF 或貼圖。巴士、輕軌、航班與渡輪各自共享一份 triangle mesh，instance buffer 只帶 pose 與塗裝；透明 `fill-extrusion` volume 只負責 MapLibre picking。GRAND PRIX 賽車是仍以 12 個可見 extrusion 方塊組裝的例外。詳見 [04-3d-layers.md](04-3d-layers.md)。

## 目錄結構（runtime）

```
src/
├── App.tsx                  # 根節點：state + 各 Provider
├── components/              # UI 面板（lazy-loaded）
│   ├── MapView.tsx          # 主畫布；最大、最熱
│   ├── ControlPanel.tsx
│   ├── TimeDisplay.tsx
│   ├── DateTimePicker.tsx
│   ├── LineLegend.tsx
│   ├── VehicleInfoPanel.tsx
│   ├── StationInfoPanel.tsx
│   ├── FlightInfoPanel.tsx
│   ├── FerryInfoPanel.tsx
│   ├── *InfoPanel.tsx       # 各城市圖層的詳情面板（學校、居屋、堂區、宗教、公廁、停車場、垃圾、供水、供電、大賽車…）
│   ├── MobileLayerSheet.tsx # 手機的圖層抽屜：LRT／巴士／海空／城市四個分頁共用同一個 <dialog>
│   ├── OldMapControls.tsx   # 歷史地圖單選面板（桌面與手機共用）
│   ├── OldMapSwitcher.tsx   # 手機地圖上的 ‹ 年份 › 切換器
│   └── RasterMapFallback.tsx # WebGL 失敗時的 Leaflet 2D 相容地圖
├── engines/
│   ├── simulationEngine.ts  # 純運算核心（~1450 行）
│   ├── busTraffic.ts        # BusTrafficController：排隊、跟車、路口通行權（在 worker 裡跑）
│   ├── ferryBerths.ts       # 渡輪泊位幾何
│   └── ferryRoutes.ts       # 海上航線 waypoint
├── hooks/
│   ├── useSimulationClock.ts
│   ├── useTransitData.ts
│   └── useServiceStatus.ts
├── layers/                  # MapLibre custom WebGL2 車輛 mesh、picking geometry 與靜態 extrusion 層
│   ├── Bus3DLayer.ts
│   ├── LRT3DLayer.ts
│   ├── Flight3DLayer.ts
│   ├── Ferry3DLayer.ts
│   ├── RaceCar3DLayer.ts    # 大賽車的車（差異更新）
│   └── VehicleLayer.ts      # 2D circle fallback；VEHICLE_SOURCE_MAXZOOM
├── analytics/
│   └── ga.ts                # GA4 event taxonomy
├── routeGroups.ts           # 巴士路線分組規則
├── cityData.ts              # 城市圖層 → 資料集對照與按需載入的 store
├── layerVisibility.ts       # 各圖層獨立開關 + 一次性的「單獨顯示」
├── oldMaps.ts / oldMapGroups.ts # 歷史地圖單選、分組（1912 地圖集三張一列）、raster source 規格
├── schools.ts / publicHousing.ts / parishes.ts / religion.ts / water.ts / power.ts / waste.ts / grandPrix.ts … # 各城市圖層的純函式 helper
├── mapRecovery.ts           # WebGL context loss／shader 失敗的重建與 2D 退路
├── debugOverlay.ts          # ?debug=1 螢幕診斷面板（手機沒有 console）；見 01-getting-started
├── i18n.tsx                 # EN / zh-Hant / pt
└── types.ts                 # shared TypeScript interfaces
```

## 目錄結構（pipeline）

```
data/
├── main.py                  # placeholder entrypoint
├── pyproject.toml
├── scripts/
│   ├── extract_lrt_osm.py
│   ├── extract_bus_data.py
│   ├── fetch_bus_data.py
│   ├── fetch_bridge_geometry.py
│   ├── fetch_flights.py             # daily via update-flights.yml
│   ├── fetch_ferry_schedules.py     # monthly via update-ferry-schedules.yml
│   ├── fetch_service_status.py      # daily via service-status.yml
│   ├── fetch_road_works.py          # daily via update-road-works.yml
│   ├── fetch_schools.py             # manual; DSEDJ list + OSM footprints → schools.json
│   ├── fetch_public_housing.py      # manual; IH 社會／經濟房屋清單 + OSM footprints → public-housing.json
│   ├── fetch_parishes.py            # manual; OSM 堂區邊界 + DSEC 人口普查 → parishes.json
│   ├── fetch_grand_prix.py          # manual; OSM relation 8877949 + 官方彎道名稱 → grand-prix.json
│   ├── fetch_water_facilities.py    # 半年一次; Macao Water 的 22 個設施 + OSM → water-facilities.json
│   ├── macao_water.py               # 讀澳門自來水網站 API：當年統計、原水數字、四座水廠三語名稱（給上面那支核對）
│   ├── fetch_water_distribution.py  # manual; 澳門境內道路（裁到 SAR 邊界）→ water-distribution.json
│   ├── fetch_power_facilities.py    # 半年一次; CEM 的 33 座變電站 + 發電廠 + OSM → power-facilities.json
│   ├── cem_operation.py             # 讀澳電「營運」頁：當年數字 + 中英文變電站名單（給上面那支核對）
│   ├── fetch_power_distribution.py  # manual; 同一份道路底稿，改由變電站定流向 → power-distribution.json
│   ├── road_network.py              # 上面兩支 *_distribution 共用的道路底稿（裁邊界、簡化、流向場）
│   ├── osm_footprints.py            # 學校／供水／供電共用的 Overpass / basemap tile footprint helper
│   ├── fetch_toilets.py             # monthly via update-toilets.yml
│   ├── fetch_religion.py            # manual; 所有宗教場所（五個類別）→ religion.json
│   ├── fetch_car_parks.py           # daily via update-car-parks.yml
│   ├── fetch_waste.py               # monthly via update-waste.yml
│   ├── fetch_dspa_stats.py          # monthly via update-dspa-stats.yml
│   ├── osrm_route.py
│   ├── patch_bus_bridges.py
│   ├── fetch_dsat_stops.py
│   ├── patch_service_hours.py
│   ├── patch_service_hours_by_day.py
│   └── validate_output.py           # CI gate：純 stdlib 檢查 public/data/*.json
├── bus_reference/           # 從 motransportinfo.com 抓的 reference JSON
└── raw/                     # extract_*.py 的中間產物

scripts/                     # Node 工具（不在 Python pipeline 裡）
├── inspect.mjs              # 查 public/data 的 CLI（取代臨時的 node -e）
├── build-old-maps.mjs       # 歷史地圖配準與輸出；配方在 old-maps-{early,islands,lemos,dscc}.mjs
├── old-maps-coast/          # 各圖版的岸線對應點
├── capture-route-paths.mjs  # 抓 MO Transport 公布的 GPX 參考軌跡（另外手動執行）
├── patch-amaral-terminal.mjs / patch-route-guides.mjs / build-bus-road-profile.mjs / build-bus-terminal-map.mjs # 巴士幾何後處理，npm run data:routes 依序執行
└── check-lrt-boundary.mjs   # 確認 LRT 時刻表沒有進 Git 或靜態產物
```

### Layer composition

City and transport switches are independent. `App.tsx` changes only the selected layer; the explicit **Show only** action calls `showOnlyCityLayer` in `layerVisibility.ts` to clear the others once, without snapshot restoration. `MapView` applies each utility mesh, bus overlay and LRT line visibility independently, including after style reloads. The clock panel, playback controls and clock shortcuts are available only while a transport layer is enabled (including automatic bus selection); with all transport off, playback speed returns to 1×. This follows layer selection, not the instantaneous vehicle count. Historical rasters sit below the parish tint, buildings and data overlays. Historical maps are single-selection: exactly one selector row is drawn at a time (the 1912 atlas row draws its three sheets). `OldMapControls` is the shared desktop/mobile panel — opacity first, rows under century headings as native radio inputs, notes and sources only under the chosen row; on phones `OldMapSwitcher` steps to the previous/next row on the map itself.
