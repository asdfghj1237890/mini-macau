# 02 · Architecture Overview

整個系統乾乾淨淨地分三層：**外部資料源 → Python pipeline 產出 versioned JSON → 瀏覽器 runtime 在模擬時鐘上回放**。RT mode 是巴士唯一一條走真實 live feed 的旁路。

```
┌──────────────────────────────┐
│  External sources            │
│  - OpenStreetMap (Overpass)  │
│  - MLM 輕軌時刻表             │
│  - DSAT 巴士頻率              │
│  - AviationStack (MFM 航班)  │
│  - TurboJET / CotaiJet 時刻表 │
│  - DSAT 即時巴士 feed         │
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
   │  - lrt-lines / stations / trips-*    │
   │  - bus-routes / bus-stops            │
   │  - flights.json                      │
   │  - ferry-schedules.json              │
   └───────┬──────────────────────────────┘
           │ fetch on page load
           ▼
   ┌────────────────────────────────────────┐
   │  Browser runtime                        │
   │  - simulationEngine.ts (timetable)      │
   │  - realtimeClient.ts   (DSAT live)──┐  │
   │  - 3D layers + React UI             │  │
   └─────────────────────────────────────┼──┘
                                         │
                            opt-in toggle│
   ┌───────────────────────────────┐     │
   │  /api/dsat/batch (nginx/Vite) │◄────┘
   │  → bis.dsat.gov.mo            │
   │  · 8s shared cache            │
   │  · 15s client poll            │
   └───────────────────────────────┘
```

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
| DSAT realtime | 每車當前 stop / 速度 / 方向 | 瀏覽器（RT mode 才會 fetch） |

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
   ├─ VehicleLayer         ─ 2D circle layer（zoom out 時 fallback）
   └─ realtimeClient       ─ RT mode 的 DSAT polling + dead-reckoning
```

關鍵設計選擇：

- **simulation engine 是 pure function**：給它 `(TransitData, Date)`，它回 `VehiclePosition[]`。沒有副作用，方便單元測試（[10-testing.md](10-testing.md)）。
- **時鐘是 offset-based 而非 RAF-summed**：背景分頁 RAF 被 throttle 仍能保持時間正確。[`useSimulationClock.ts:11`](../../src/hooks/useSimulationClock.ts) 的 docstring 有完整論證。
- **3D 車輛全部用 fill-extrusion**：不引入 Three.js 或 deck.gl。每台車就是 5–8 個小 polygon，用 maplibre 原生 layer 畫。詳見 [04-3d-layers.md](04-3d-layers.md)。
- **RT mode 是 opt-in 旁路**：sim engine 永遠在跑；RT 只是把 sim 的巴士部分丟掉、用真資料覆蓋。LRT、航班、渡輪不受影響。

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
├── services/
│   └── realtimeClient.ts    # DSAT batcher + BusTracker
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
│   ├── osrm_route.py
│   ├── patch_bus_bridges.py
│   ├── patch_service_hours.py
│   └── generate_timetable.py
├── bus_reference/           # 從 motransportinfo.com 抓的 reference JSON
├── timetable_images/        # MLM 官方時刻表圖片
├── timetable_verified/      # 手 transcribe 後的 .md
├── raw/                     # extract_*.py 的中間產物
└── output/                  # 最終 JSON，手動 copy 到 public/data/
```
