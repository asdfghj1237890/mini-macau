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
   │  - flights.json                      │
   │  - ferry-schedules.json              │
   │  - road-works.json                   │
   │  - schools.json                      │
   │  - toilets.json                      │
   │  - car-parks.json                    │
   │  - water-facilities.json             │
   │  - water-distribution.json           │
   └───────┬──────────────────────────────┘
           │ fetch on page load
           ▼
   ┌────────────────────────────────────────┐
   │  Browser runtime                        │
   │  - simulationEngine.ts (timetable)      │
   │  - 3D layers + React UI                 │
   └────────────────────────────────────────┘
```

> LRT trips（`src/data/trips-*.json`）刻意不放 `public/data/`：Vite 把它們打包成匿名 hash chunk，`useTransitData` 用 `import.meta.glob` 按 scheduleType lazy import，所以 MLM 時刻表沒有可猜的 `/data/` URL。其餘資料集仍以 `/data/*.json` 直接提供，但帶 `X-Robots-Tag: noindex`（`public/_headers`）。

## 三個階段各自負責什麼

### Stage 1 — 外部資料源

**特性**：每個源頭格式、頻率、可靠度都不一樣。Pipeline 的工作就是把它們 normalize 成 runtime 能直接用的同一種形狀。

| 源頭 | 內容 | 取得方式 |
|------|------|----------|
| OSM Overpass | LRT 軌道幾何、巴士路線幾何、巴士站位置 | `data/scripts/extract_*.py`，手動觸發 |
| MLM | 輕軌每站逐分鐘時刻表 | 官方 PDF/JPG → 手 transcribe 進 [`generate_timetable.py`](../../data/scripts/generate_timetable.py) |
| DSAT 頻率 | 各路線發車間隔、服務時段 | `fetch_dsat_stops.py` + `patch_service_hours*.py` |
| AviationStack | MFM 機場每日航班 | `fetch_flights.py`（需 API key） |
| TurboJET / CotaiJet | 港澳渡輪月度時刻表 | `fetch_ferry_schedules.py`（直接 scrape HTML） |
| data.gov.mo | DSAT 工程改道消息（道路封閉/交通改道公告） | `fetch_road_works.py`（下載 ZIP 內 XML，含重試） |
| DSEDJ + OSM Overpass | 學校清單（核准級別）與校舍建築足跡 | `fetch_schools.py`（手動執行，name matching） |
| data.gov.mo | IAM 公共廁所 / 無障礙公廁名單 | `fetch_toilets.py`（下載 ZIP 內 JSON，含重試） |
| data.gov.mo | DSAT 停車場資料（車位詳情 + 即時空位） | `fetch_car_parks.py`（API gateway，APPCODE header，含重試） |
| 澳門自來水 + OSM Overpass | 22 個供水設施（＋黑沙水庫）清單與建築足跡／水體、示意管網 | `fetch_water_facilities.py`（手動執行，清單寫死在腳本裡） |
| OSM Overpass | 澳門境內可行車道路（給供水配水層當底稿，裁到 SAR 邊界） | `fetch_water_distribution.py`（手動執行） |

### Stage 2 — Python pipeline

詳見 [05-data-pipeline.md](05-data-pipeline.md)。重點是：

- **`uv` 管 Python 環境**（pyproject.toml in `data/`）
- **產出物 commit 進 git**（`public/data/*.json`）。runtime 沒有 build-time fetch，全部都是 static asset。
- **三個 GitHub Actions 處理週期性更新**：航班每日、渡輪每月、巴士服務狀態每日。詳見 [07-ci-and-data-sync.md](07-ci-and-data-sync.md)。

### Stage 3 — Browser runtime

```
App.tsx
├─ useSimulationClock      ─ 模擬時鐘（offset-based wall clock）
├─ useTransitData          ─ 漸進載入 6 份核心 JSON
├─ useServiceStatus        ─ 從 service-status.json 拿當天停駛清單
└─ MapView.tsx             ─ 包 maplibre-gl
   ├─ simulationEngine     ─ 純函數：(transitData, time) → VehiclePosition[]
   ├─ Bus3DLayer           ─ fill-extrusion 巴士車身（5 種 polygon）
   ├─ LRT3DLayer           ─ fill-extrusion 雙節列車
   ├─ Flight3DLayer        ─ fill-extrusion 機身/機翼/尾翼
   ├─ Ferry3DLayer         ─ fill-extrusion 噴射船（8 種 polygon）
   └─ VehicleLayer         ─ 2D circle layer（zoom out 時 fallback）
```

關鍵設計選擇：

- **simulation engine 是 pure function**：給它 `(TransitData, Date)`，它回 `VehiclePosition[]`。沒有副作用，方便單元測試（[10-testing.md](10-testing.md)）。
- **時鐘是 offset-based 而非 RAF-summed**：背景分頁 RAF 被 throttle 仍能保持時間正確。[`useSimulationClock.ts:11`](../../src/hooks/useSimulationClock.ts) 的 docstring 有完整論證。
- **3D 車輛全部用 fill-extrusion**：不引入 Three.js 或 deck.gl。每台車就是 5–8 個小 polygon，用 maplibre 原生 layer 畫。詳見 [04-3d-layers.md](04-3d-layers.md)。

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
│   └── FerryInfoPanel.tsx
├── engines/
│   ├── simulationEngine.ts  # 純運算核心（~1300 行）
│   ├── ferryBerths.ts       # 渡輪泊位幾何
│   └── ferryRoutes.ts       # 海上航線 waypoint
├── hooks/
│   ├── useSimulationClock.ts
│   ├── useTransitData.ts
│   └── useServiceStatus.ts
├── layers/                  # MapLibre 自訂 fill-extrusion 層
│   ├── Bus3DLayer.ts
│   ├── LRT3DLayer.ts
│   ├── Flight3DLayer.ts
│   ├── Ferry3DLayer.ts
│   └── VehicleLayer.ts      # 2D circle fallback
├── analytics/
│   └── ga.ts                # GA4 event taxonomy
├── routeGroups.ts           # 巴士路線分組規則
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
│   ├── fetch_water_facilities.py    # manual; Macao Water 的 22 個設施 + OSM → water-facilities.json
│   ├── fetch_water_distribution.py  # manual; 澳門境內道路（裁到 SAR 邊界）→ water-distribution.json
│   ├── osm_footprints.py            # 上面兩支共用的 Overpass / basemap tile footprint helper
│   ├── fetch_toilets.py             # daily via update-toilets.yml
│   ├── fetch_car_parks.py           # daily via update-car-parks.yml
│   ├── osrm_route.py
│   ├── patch_bus_bridges.py
│   ├── patch_service_hours.py
│   └── generate_timetable.py
├── bus_reference/           # 從 motransportinfo.com 抓的 reference JSON
├── timetable_images/        # MLM 官方時刻表圖片
├── timetable_verified/      # 手 transcribe 後的 .md
└── raw/                     # extract_*.py 的中間產物
```
