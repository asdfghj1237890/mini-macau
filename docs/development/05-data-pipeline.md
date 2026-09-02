# 05 · Data Pipeline

`data/` 底下的 Python 腳本負責把外部資料 normalize 成 runtime 直接用的 JSON。產出物 commit 進 git（`public/data/*.json`），runtime 沒有 build-time fetch。

## 環境

```bash
cd data
uv sync
```

`uv` 是必要的（不接受 `pip install`）。我的偏好設定是任何 Python 都走 `uv run python ...`，因為 Windows 上 `python` / `python3` 會被 Windows Store shim 攔截。

## 腳本一覽

```
data/scripts/
├── extract_lrt_osm.py         # 從 OSM 抓 railway=light_rail relations 跟站點
├── extract_bus_data.py        # 把 bus_reference/ + OSM 整成 bus-routes/stops
├── fetch_bus_data.py          # 抓 motransportinfo.com 的站點清單作為 reference
├── fetch_bridge_geometry.py   # 從 OSM 撈跨海大橋幾何（澳氹、西灣、友誼、港珠澳）
├── fetch_dsat_stops.py        # DSAT 官網的站點清單
├── osrm_route.py              # 把巴士路線吐給 OSRM 做 road-snap
├── patch_bus_bridges.py       # 把 OSRM 結果裡的橋段換成 fetch_bridge_geometry 的精確幾何
├── patch_service_hours.py     # 套 DSAT 服務時段
├── patch_service_hours_by_day.py  # Sun/PH 獨立的服務時段
├── generate_timetable.py      # 從 MLM 圖片轉錄出來的時刻表 → trips-*.json
├── fetch_flights.py           # AviationStack → flights.json
├── fetch_ferry_schedules.py   # TurboJET / CotaiJet → ferry-schedules.json
└── fetch_service_status.py    # 每天 scrape 巴士停駛公告 → service-status.json
```

加底線開頭的 `_*.py` / `_*.ps1` / `_*.txt` 是除錯/中間檔，不在主流程裡。

## 整體流程（手動觸發）

```
OSM Overpass ──> extract_lrt_osm.py ─────────> raw/lrt-*.json ──┐
                                                                 │
OSM Overpass ──> extract_bus_data.py ────────> raw/bus-*.json ──┤
motransportinfo ─> fetch_bus_data.py ──────────────────────────┤
OSM (大橋) ──> fetch_bridge_geometry.py ──> raw/bridges.json ──┤
                                                                 ▼
                              osrm_route.py + patch_bus_bridges.py
                                            │
                              patch_service_hours{,_by_day}.py
                                            │
                                            ▼
MLM 圖片 ──> 手轉 timetable_verified/*.md ──> generate_timetable.py
                                            │
                                            ▼
                           output/{lrt-lines,stations,trips-*,
                                   bus-routes,bus-stops}.json
                                            │
                              手動 cp：trips-* → src/data/，其餘 → public/data/
```

> `data/main.py` 目前只是個 placeholder（[`main.py`](../../data/main.py)），實際工作都是個別腳本獨立跑。

## 腳本執行細節

### LRT geometry — `extract_lrt_osm.py`

從 OSM Overpass 抓 `railway=light_rail` 的 relation（Taipa / Seac Pai Van / Hengqin 三線），合成 `Feature<LineString>`，並對應 stations。

### 巴士幾何 — `extract_bus_data.py` + `osrm_route.py` + `patch_bus_bridges.py`

巴士路線比 LRT 麻煩，因為：

1. **OSM 的 bus relation 不夠完整**：很多路線 segments 缺、或順序亂。
2. **要 road-snap**：拿到的路線 way 序列需要送 OSRM 變成連續的 polyline。
3. **大橋幾何要 override**：OSRM 對大橋的處理不夠精確（例如澳氹大橋有 7 號路線專用入口的彎道），所以從 OSM 直接撈大橋幾何，跑完 OSRM 後 splice 進去。`patch_bus_bridges.py` 負責這個。

如果你只改了某一條路線，可以用 `_regenerate_specific.py` 跑單條重生成。

### 時刻表 — `generate_timetable.py`

LRT 沒有公開 API。MLM 提供的是每站獨立、HH:MM 一行的時刻表 PDF/JPG。流程：

1. 把官方 PDF/JPG 放進 `data/timetable_images/`。
2. 人工轉錄到 `data/timetable_verified/*.md`（一行一站、HH:MM 列出當日所有發車）。
3. `generate_timetable.py` 把 `.md` 解析成 per-station `dict[hour, list[minute]]`，再用 time-proximity matching 把不同站的同一班車對起來，產出每筆 `Trip { lineId, direction, scheduleType, entries[] }`。

三種 scheduleType（Mon-Thu / Friday / Sat-Sun）各跑一次，產出 `trips-mon_thu.json` / `trips-friday.json` / `trips-sat_sun.json`。這三檔放 `src/data/`（不是 `public/data/`）：Vite 會把它們打包成匿名 hash chunk，runtime 按需 lazy import，不會以 `/data/*.json` 的形式公開。

### 航班 — `fetch_flights.py`

```bash
AVIATIONSTACK_API_KEY=... uv run python scripts/fetch_flights.py
AVIATIONSTACK_API_KEY=... uv run python scripts/fetch_flights.py 2026-04-19
```

AviationStack `flights` endpoint，filter `arr_iata=MFM` + `dep_iata=MFM`，吐出當日的 arrivals + departures。落地時間 normalize 為 Macau local（UTC+8）的「當日 minutes since midnight」。

> Aircraft type code 會驗證為 ICAO 格式（`A320`、`B738` 之類），無法解析的記為 unknown。

### 渡輪 — `fetch_ferry_schedules.py`

直接 scrape TurboJET 跟 CotaiJet 官網（沒有 API）。產出單一 `ferry-schedules.json`，內含所有 6 條航線（`hkg-outer`、`hkg-taipa`、`hkia`、`shenzhen-airport`、`shekou`、`cotaijet`）。每筆 record 帶 `fetchedAtUtc` + `effectiveAs`，方便看資料新不新鮮。

### 巴士停駛公告 — `fetch_service_status.py`

每天早上跑（GitHub Actions 23:00 UTC），scrape DSAT 公告找今天「全線停駛」「特定路線停駛」的清單，產出 `public/service-status.json`：

```json
{ "date": "2026-05-05", "dayCategory": "weekday", "isHoliday": false, "inactive": ["19", "26A"] }
```

Runtime 由 [`useServiceStatus.ts`](../../src/hooks/useServiceStatus.ts) 讀進來，UI 上把對應路線 dim 掉。

## 常見維護任務

- **修一條路線的幾何錯誤**：改 `bus_reference/`、跑 `_regenerate_specific.py`、手動 diff `output/bus-routes.json`，OK 後 cp 到 `public/data/`。
- **加新巴士路線**：DSAT 開新線時，先在 `bus_reference/` 加 reference data、跑全套 extract → osrm → patch、最後在 `routeGroups.ts` 把它分到對的 group。
- **改服務時段**：`patch_service_hours.py` / `patch_service_hours_by_day.py`，在腳本裡硬編碼新的小時數，重跑。`patch_service_hours_by_day.py` 會把週六或週日的「不設服務」寫成對應的 `serviceHoursStartSat/Sun: null` / `serviceHoursEndSat/Sun: null`。
- **新增 LRT 班次**：MLM 改點時刻表後，更新 `data/timetable_verified/*.md`，跑 `generate_timetable.py` 三種 scheduleType。

## 自動化

三個 GitHub Actions 處理週期性更新（航班每日、渡輪每月、服務狀態每日），詳見 [07-ci-and-data-sync.md](07-ci-and-data-sync.md)。其餘腳本都是**手動觸發**，因為它們的 input（OSM、MLM 圖片、bus_reference）不會自動變。
