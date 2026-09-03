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
├── fetch_road_works.py        # data.gov.mo (DSAT) → road-works.json
├── fetch_schools.py           # manual; DSEDJ list + OSM footprints → schools.json
├── fetch_toilets.py           # data.gov.mo (IAM) → toilets.json
├── fetch_car_parks.py         # data.gov.mo (DSAT) → car-parks.json
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
                           public/data/{lrt-lines,stations,
                                        bus-routes,bus-stops}.json
                           src/data/trips-*.json
                           （腳本直接寫入使用位置，沒有中繼副本）
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

### 工程改道消息 — `fetch_road_works.py`

從 data.gov.mo 抓 DSAT「工程改道消息」dataset，upstream 每日更新一次，下載回來的是包著一份 XML 的 ZIP。HTML 格式的公告內文會被剝成純文字段落，標題裡的限制用語對應成 `restriction` 欄位（`closed` / `limited` / `one_way` / `no_parking` / `other`）。產出 `public/data/road-works.json`，跑完要過 `validate_output.py road-works`。

> 下載端點偶爾會回 `{"msg":"內部錯誤","code":1}` 而不是 ZIP，`fetch_road_works.py` 因此帶重試。

### 學校建築 — `fetch_schools.py`

底圖建築來自 OpenFreeMap 向量圖磚，但圖磚把同高度的建築合併成一個 multipolygon 特徵（一張 z14 圖磚 ~8,000 個建築只有 ~120 個特徵），沒辦法用 feature-state 幫單一棟建築上色。因此改為自己從 OSM 撈校舍足跡，前端另外疊一層 `fill-extrusion` 依級別上色。

級別判定看 DSEDJ 非高等教育學校清單的核准階段旗標（幼稚園／小學／中學）：三個階段都有 → `all_through`；否則取最高階段（中 > 小 > 幼）；沒有旗標的回歸教育夜校算 `secondary`。DSEDJ 名冊與 OSM `amenity=school/kindergarten/college/university` 特徵用中文校名比對（完全比對或子字串，OSM 名字通常是校區層級，例如「勞校中學附屬小學」⊂「勞校中學」），比不上的再用葡文名比對，另加一張別名表處理少數例外；比對不到的 DSEDJ 學校記進 `unmatchedDsedj`，比對不到高等院校也不在名冊上的 OSM 教育特徵（如消防／警察等專門學校、托兒所）記進 `droppedOsm` 並丟棄。

Overpass 查詢分兩層：先在 Macau bbox 內抓齊所有教育特徵——`amenity=school/kindergarten/college/university`，加上只標成建築的學校（`building=school`、`building=kindergarten`、名稱含「學校／中學／小學／幼稚園／書院」的 `building=*`；澳門不少學校在 OSM 只有這種標法）（`out geom` 而非 tags-only，因為大學校區是 multipolygon relation，tags-only 會丟 member），比對出實際學校後，再依學校座標或所屬 relation 逐一撈校內的 `building` ways（每批最多 20 校）。校區輪廓有時畫到整個街區，所以 `building=apartments/hotel/office/…` 這類明顯不是校舍的建築會被排除（大學宿舍保留）；OSM 只負責決定「哪些建築屬於哪所學校」；**幾何與高度一律改用底圖自己的圖磚**：抓 OpenFreeMap z14 圖磚，把底圖合併過的建築 multipolygon 拆成部件，凡是有 ≥ 50% 面積落在某棟認領建築輪廓內的部件，就以該部件的形狀與 `render_height` 取代 OSM 輪廓（裙樓＋塔樓會各成一筆，`osmId` 加 `#p1`、`#p2` 後綴）。這樣不管 OSM 有沒有標高度、有沒有 `building:part`、圖磚怎麼取整，我們畫的都跟底圖同形同高；輪廓再外擴 0.5 m 避免牆面 z-fighting，高度則存底圖的原值，由前端建圖層時加 2 m 餘量（`SCHOOL_HEIGHT_MARGIN_M`，見 `src/schools.ts`）——餘量放在前端是因為縮放高度漸變也在前端算，資料側 0.5 m 曾在大面積低矮平頂上出現屋頂 z-fighting。校區內完全撈不到 `building` way 的（校舍以 relation 或 `building:part` 標示、或根本沒畫），直接用校區輪廓去切圖磚部件（`kind: "tile"`）；連圖磚也沒有建築時才退化成校區輪廓的低矮色塊（`kind: "outline"`）。圖磚裡沒有對應部件的 OSM 輪廓（極小的建築被量化掉）才用 OpenMapTiles 規則自己算高度（`height` → `building:levels × 3.66` → 預設 5 m，無條件進位到整數後加 0.5 m）。

> `overpass()` 依序輪替 overpass-api.de → overpass.kumi.systems → maps.mail.ru 三個端點（連線失敗或 5xx 換下一個，429 留在原站退避），最多重試 8 次，退避時間 `min(5 * 2^i, 60)` 秒；每次成功呼叫之間也固定停 2 秒。回應以查詢字串的 SHA-1 快取在系統暫存目錄（`mini-macau-overpass-cache/`，24 小時有效），中途斷線後重跑不用重打已完成的查詢。整趟通常 5–15 分鐘，時間幾乎都花在 429 退避上。

跟其他 `fetch_*.py` 不一樣，這支**純手動跑**、沒有排程 workflow——學校清單跟 OSM 建築不會常常變，需要時才重跑：

```bash
cd data && uv run python scripts/fetch_schools.py
```

跑完要過 `validate_output.py schools`。

### 公廁 — `fetch_toilets.py`

從 data.gov.mo 抓 IAM（市政署）兩個 dataset：「公共廁所」（~198 筆，名稱/地址/電話/開放時間都有 zh/pt/en 欄位，另帶 `hasDwc`／`hasFwc`／`tempClose`，座標放在 `location`，是 `"lat,lng"` 字串）與「無障礙公廁」（前者的子集，只用來交叉驗證 `accessible`）。跟 `fetch_road_works.py` 一樣，下載端點回的是免 token 的 ZIP，偶爾會回 `{"msg":"內部錯誤"}` 而不是 ZIP，因此也帶重試。

名稱前面掛的 IAM 編號（例如「AM01 食品資訊站」）會被拆出來當 `id`（同編號多筆時加 `-2` 後綴；少數沒編號的退回用名稱 slug），顯示用的 `name` 則把編號剝掉；`location` 的 `"lat,lng"` 字串解析後改成 GeoJSON 慣例的 `[lng, lat]` 順序存進 `coordinates`。產出 `public/data/toilets.json`，跑完要過 `validate_output.py toilets`。

### 停車場 — `fetch_car_parks.py`

DSAT 的停車場資料分兩個 dataset，都掛在 dsat.apigateway.data.gov.mo 這個 API gateway 後面，用同一把「公開」APPCODE（dataset 頁面直接印給每個訪客看，不用登入）當 `Authorization: APPCODE <key>` header：「車位詳情」（car_park_detail，88 個公共停車場，靜態、每日更新——這支腳本抓的）與「即時空位」（car_park_maintance，~87 筆，每 10 秒更新一次）。後者 CORS 開 `*`，直接由瀏覽器輪詢（且只在模擬時鐘顯示「現在」（1× 且與真實時間同步）時才打），不進這條 pipeline。兩者都回 XML：單一 `<CarPark>` root，每筆記錄是一個 `<Car_park_info ATTR="..." />`，欄位全部放在 ATTRIBUTES 裡。

比較特別的欄位對應：`X_coords`其實是緯度、`Y_coords`才是經度（跟命名反著來），`coordinates` 要組成 `[float(Y_coords), float(X_coords)]`。收費／備註等多行欄位用字面 `"##"` 黏成一行，轉回 `"\n"` 時要把頭尾因為多餘分隔符產生的空行修掉；單一 `"-"` 是「不適用」的佔位符，轉成 `""`。`height`（限高，公尺）在沒有限高的車位是 `"--"`／`"---"`／空字串，parse 不出來就存 `null`。APPCODE 雖然公開，仍然不寫進任何檔案：從 `DATAGOVMO_APPCODE` 環境變數讀（CI 是 GitHub secret，本機手動 export），沒設就直接以 exit code 2 中止。產出 `public/data/car-parks.json`，跑完要過 `validate_output.py car-parks`。

### 巴士停駛公告 — `fetch_service_status.py`

每天早上跑（GitHub Actions 23:00 UTC），scrape DSAT 公告找今天「全線停駛」「特定路線停駛」的清單，產出 `public/service-status.json`：

```json
{ "date": "2026-05-05", "dayCategory": "weekday", "isHoliday": false, "inactive": ["19", "26A"] }
```

Runtime 由 [`useServiceStatus.ts`](../../src/hooks/useServiceStatus.ts) 讀進來，UI 上把對應路線 dim 掉。

## 常見維護任務

- **修一條路線的幾何錯誤**：改 `bus_reference/`（或 `extract_bus_data.py` 的 override）、跑 `_regenerate_specific.py`，它直接改寫 `public/data/bus-routes.json`；用 `git diff` 檢視後跑 `validate_output.py bus-routes bus-stops`。
- **加新巴士路線**：DSAT 開新線時，先在 `bus_reference/` 加 reference data、跑全套 extract → osrm → patch、最後在 `routeGroups.ts` 把它分到對的 group。
- **改服務時段**：`patch_service_hours.py` / `patch_service_hours_by_day.py`，在腳本裡硬編碼新的小時數，重跑。`patch_service_hours_by_day.py` 會把週六或週日的「不設服務」寫成對應的 `serviceHoursStartSat/Sun: null` / `serviceHoursEndSat/Sun: null`。
- **新增 LRT 班次**：MLM 改點時刻表後，更新 `data/timetable_verified/*.md`，跑 `generate_timetable.py` 三種 scheduleType。

## 自動化

三個 GitHub Actions 處理週期性更新（航班每日、渡輪每月、服務狀態每日），詳見 [07-ci-and-data-sync.md](07-ci-and-data-sync.md)。其餘腳本都是**手動觸發**，因為它們的 input（OSM、MLM 圖片、bus_reference）不會自動變。
