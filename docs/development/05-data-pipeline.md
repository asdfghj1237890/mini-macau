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
├── fetch_water_facilities.py  # manual; 澳門自來水的 22 個設施 + OSM → water-facilities.json
├── fetch_water_distribution.py # manual; 澳門境內道路，流向由清水設施定 → water-distribution.json
├── fetch_power_facilities.py  # manual; 澳電的 33 座變電站 + 兩座電廠 + OSM → power-facilities.json
├── fetch_power_distribution.py # manual; 同一份道路底稿，流向由變電站定 → power-distribution.json
├── road_network.py            # 上面兩支 *_distribution 共用：道路底稿 + 多源 Dijkstra 流向場
├── osm_footprints.py          # 學校／供水／供電共用：Overpass 存取 + basemap tile 足跡重切
├── fetch_toilets.py           # data.gov.mo (IAM) → toilets.json
├── fetch_car_parks.py         # data.gov.mo (DSAT) → car-parks.json
├── fetch_waste.py             # data.gov.mo (IAM+DSPA) → waste.json
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

> 上面這整套（Overpass 存取、OSM 輪廓 → footprint、拿底圖圖磚重切）放在 [`osm_footprints.py`](../../data/scripts/osm_footprints.py)，跟 `fetch_water_facilities.py` 共用；`fetch_schools.py` 只負責「哪些建築屬於哪所學校」。

> `overpass()` 依序輪替 overpass-api.de → overpass.kumi.systems → maps.mail.ru 三個端點（連線失敗或 5xx 換下一個，429 留在原站退避），最多重試 8 次，退避時間 `min(5 * 2^i, 60)` 秒；每次成功呼叫之間也固定停 2 秒。回應以查詢字串的 SHA-1 快取在系統暫存目錄（`mini-macau-overpass-cache/`，24 小時有效），中途斷線後重跑不用重打已完成的查詢。整趟通常 5–15 分鐘，時間幾乎都花在 429 退避上。

跟其他 `fetch_*.py` 不一樣，這支**純手動跑**、沒有排程 workflow——學校清單跟 OSM 建築不會常常變，需要時才重跑：

```bash
cd data && uv run python scripts/fetch_schools.py
```

跑完要過 `validate_output.py schools`。

### 供水設施 — `fetch_water_facilities.py`

**清單是澳門自來水的，幾何是 OSM 的。** 名單來自澳門自來水「[供水設施](https://www.macaowater.com/about-macao-water/water-supply-facilities)」頁：22 個編號設施（4 座水廠、3 個水塘／水庫、4 個高位水池、4 個原水泵站、7 個泵站）。那頁的示意圖（`Facilities.jpg`）**有版權而且沒有地理座標**，所以一點都不描它——只取「有哪些設施、編號、名字」這些事實，座標一律來自 OpenStreetMap。上游沒有機器可讀的清單（整頁是散文加一張圖），因此 22 筆連同各自對應的 OSM element id 直接寫死在腳本的 `FACILITIES` 表裡；每次跑都會重新查一次那些 id（`out geom`），查不到就中止，OSM 的 `name:pt` / `name:en` 只要不比表裡的名字籠統就蓋過表值（`r10266785` 只標成「水塘 / Reservatório」，指的是那片湖而不是「大水塘」這個設施，所以表值留著）。

四種幾何取法：**水廠**用 `man_made=water_works` 的廠區輪廓，把落在裡面的 `building` way/relation 全部認領；**高位水池**本身就是一棟 `man_made=water_tower` 建築；**水塘／水庫**取水體多邊形，存進 `water[]`（只有環，沒有高度，前端畫半透明填充）；石排灣原水泵站則是 `w945543066`「水塘泵房 Bombagem de Agua」那塊 landuse 多邊形，比照廠區處理。認領到的足跡一律再拿底圖圖磚重切（跟學校同一套 `osm_footprints.py`，見上一節），`kind` 記成 `building`（OSM 建築，已對齊底圖部件）／`tile`（OSM 沒建築，直接切底圖部件）／`outline`（底圖也沒有，退化成輪廓色塊）。三個高位水池的 OSM `height` 是 58.3／81.4／58.4——那是海拔（水池蓋在松山跟氹仔大潭山上），不是樓高，所以只有退化成 `outline` 時才會用到並砍到 20 m 上限；底圖有畫部件時仍照底圖高度，跟其他足跡一致。

22 個裡只有 11 個在 OSM 找得到（4 水廠 + 3 水塘 + 3 個高位水池 + 石排灣泵房）。**其餘 11 個 OSM 根本沒畫**，只給一個 marker 並標 `approximate: true`：座標取「與它同址的那個設施」的 marker 往外推 `APPROX_OFFSET_M` = **70 m**（方向用編號乘黃金角 137.5° 決定，所以同址的兩個 marker 不會疊在同一個像素上）；同址設施也不知道的，退到 district anchor——回力（`回力酒店 Hotel Jai Alai`）、西灣湖（`Lago Sai Van`，取湖岸東北角，即民國大馬路那側，marker 落在湖中央會看起來像 bug）、二龍喉公園（`Jardim da Flora`）——這三個都是**按名字**查 OSM、取面積最大的多邊形，查到的 element 寫進輸出的 `anchors` 供對帳。錨在水體上的泵站（九澳原水泵站）會先被推到水塘岸邊再外推，泵房不會浮在水面上。

推 70 m 而不是原本的 25 m，是因為 25 m 在「看得到管網」的縮放層級還是疊在一起；同址的泵站本來就是廠區裡另一棟建築，不是插在廠房屋頂上的針。代價是黃金角可能把 marker 推下水——17 號（大水塘泵站）的方位角剛好正南，正好是大水塘湖面——所以 `first_dry_bearing` 會以 30° 為級距左右輪流試（0°、+30°、−30°、+60°…），取第一個不落在任何水體環裡的方位角；大水塘泵站因此從 177.5° 改成 207.5°。

#### 第 23 個設施：黑沙水庫（不是自來水公司的）

清單之外還多放一個 **黑沙水庫 Hac Sa Reservoir**（OSM `w108309153`）：它**不在**澳門自來水那 22 個編號裡，是**海事及水務局（DSAMA）**的原水水庫，但它供水給路環水廠，畫在圖上才說得通。因此每筆設施都多了一個 `operator` 欄位——22 個是 `"macao_water"`、黑沙水庫是 `"dsama"`——而黑沙水庫的 `no` 是 `null`（沒有上游編號就不要在 UI 印一個假的）。`sources.hacSa` 也寫明它的來源與歸屬。它的 marker 不取水體重心，而是取**離路環水廠最近的岸邊頂點**（`marker="shore:wtp-coloane"`），因為取水口跟管線都在那一側。管網也跟著多一條 raw 管 `raw-res-hac-sa-wtp-coloane`，共 23 條。

#### 管網是「示意」，不是自來水公司的管線

輸出還帶一段 `network`：`nodes`（兩個非設施節點：珠海原水輸入 `inlet-zhuhai`，放在鴨涌河澳門這岸、青洲水廠北邊約 190 m 的陸地上，在 OSM 澳門邊界 relation `1867188` 內、緊鄰鴨涌馬路好讓 OSRM 有路可貼；以及第四條珠澳原水管的 `inlet-lotus`——有紀錄的是 2019-10-17 通水、新增「從氹仔方向進入澳門」的管路、經橫琴供應石排灣水廠，但實際過河位置沒有公開，所以座標借用 POWER 圖層的蓮花大橋澳門端海濱圓形地那一點，標 `approximate: true` 並帶三語 `note` 說明「位置為示意」，面板會顯示）與 `pipes`（26 條）。**那份 edge list 是我們自己編的**——澳門自來水沒有公開管線走向，`fetch_water_facilities.py` 的 `PIPES` 就是照設施清單推出來的合理管路（原水從珠海與三個水塘進廠、清水經泵站送到高位水池），設施本身即是隱含節點，用 id 互相引用。**只有幾何是真的**：每條管線是兩端 marker 之間的一次 OSRM `route/v1/driving`（`overview=full&geometries=geojson`），所以管線沿著街道走、過海走橋，像 Cities: Skylines 的管線，而不是穿樓的直線。沿用 [`osrm_route.py`](../../data/scripts/osrm_route.py) 的 Hengqin 排除區與重試；路不通就退化成直線並標 `fallback: true`（超過 3 條就當 OSRM 掛了，整個 run 中止）。OSRM 會把端點吸到最近的道路上（水塘的 marker 在水面中央，離路可以幾百公尺），所以輸出會把兩端 marker 的原座標補回頭尾——管線一定起訖於設施本身。**同址短接則根本不問 OSRM**：兩端直線距離 < 150 m，或是直線 < 600 m 而 OSRM 走出超過 3 倍的路（廠區裡 70 m 的一步，OSRM 會叫車繞 1.2 km），就直接畫成兩點的直線段並標 `direct: true`——那是刻意的短接，所以 `fallback` 仍是 `false`（`fallback` 只代表 OSRM 失敗）。目前 26 條裡 14 條是 `direct`、12 條是實走路網的幹管，實走管線最大繞行倍率 3.58×（路環水廠→石排灣泵站，跨山的幹管刻意保留沿路）。`lengthM` 是沿著**輸出的**折線量的（含補回去的頭尾），不是 OSRM 自己的 `distance`。OSRM 回應跟 Overpass 一樣快取在 OS temp dir（`OSRM_CACHE_DIR`，7 天），重跑不會再打一次。

跟 `fetch_schools.py` 一樣**純手動跑**、沒有排程 workflow：

```bash
cd data && uv run python scripts/fetch_water_facilities.py
```

產出 `public/data/water-facilities.json`，跑完要過 `validate_output.py water-facilities`（守門條件：剛好 23 筆、其中 `operator` 為 `macao_water` 的剛好 22 筆且 `no` 是不重複的 1–22、`dsama` 的剛好 1 筆且 `no` 為 `null`、`id` 不重複、`type` 與 `operator` 都在列舉內、座標在澳門範圍內、至少 8 個有 `buildings`、4 個有 `water`；`network` 則是剛好 23 條管線、`id` 不重複、`from`／`to` 都能對到設施 id 或節點 id、`kind` 是 `raw`／`treated`、`lengthM` 是 ≥ 0 的整數、`direct` 與 `fallback` 都是布林值且不會同時為真、`direct` 的剛好 2 個座標、其餘至少 2 個且都在澳門範圍內、`fallback` 最多 3 條）。只打 3 次 Overpass、每條非 `direct` 管線 1 次 OSRM，兩邊的快取讓重跑幾乎免費。`node scripts/inspect.mjs water-facilities` 會把設施摘要（含 operator 分組）跟管網（依 `kind` 分組、direct／routed 數、總公里數、fallback 數、最長的一條、每條的繞行倍率）一起印出來。

#### 配水底稿 — `fetch_water_distribution.py`（另一支腳本、另一個檔）

配水層要「沿著每一條路」畫，但**不能**靠改底圖樣式做：OpenFreeMap 的圖磚涵蓋整個珠三角，把 `transportation` layer 重新上色的話，珠海跟橫琴會跟澳門一樣亮——而這一層的意思就是「**澳門的**配水網」。裁切只能發生在做資料的地方，所以道路自己出一個小檔案。

`fetch_water_distribution.py` 打一次 Overpass，用 `area(3601867188)`（＝ OSM relation `1867188` 澳門，area id 是 relation id + 3600000000）圈出範圍，抓 `highway` 為 `motorway`／`trunk`／`primary`／`secondary`／`tertiary`／`unclassified`／`residential`／`living_street`／`service` 的 way（regex 有錨點，所以 `*_link` 不會混進來），再丟掉 `service=parking_aisle|driveway|drive-through`（那是停車場家具，不是街道）。**注意 Overpass 的 `(area)` 對 way 是「只要有一個節點在範圍內」**，`out geom` 會把整條 way 給你——港珠澳口岸人工島的珠海側、蓮花大橋往橫琴口岸的引道就這樣混進來（實測 4.7 km 的珠海道路），所以每條 way 都會再拿邊界多邊形 `intersection` 裁一次，跨境的 way 會被切成一段或多段澳門側。那個邊界**包含**澳大橫琴校區（租借地，OSM 邊界照法定界線走）、**不包含**橫琴鎮，已驗證。

裁完在公尺投影下用 6 m 容差 `simplify`（在經緯度上做會被 cos(lat) 壓扁），座標留 5 位小數（約 1.1 m）。**簡化時會保護「兩條 way 共用的頂點」**：Douglas-Peucker 只保證頭尾不被砍，砍掉一個共用頂點就等於把 T 字路口拆成兩條互不相連的街，整個街區會被下面的流向場漏掉，所以每條 way 是以共用頂點為界一段一段簡化。短於 25 m 的碎段**只從輸出拿掉、仍留在圖裡**——12 m 的小連接往往正是兩個街廓之間唯一的路。

**流向**：每條路的座標順序是有意義的，從「離清水源近的一端」指向「遠的一端」，前端的虛線動畫就會像水從水廠往外流。作法是拿簡化後的幾何建圖（節點＝座標，邊＝相鄰頂點、權重是公尺），以 `water-facilities.json` 裡 `operator=macao_water` 且 `type` 為 `plant`／`tank`／`pumping` 的 15 個**清水側**設施當種子（原水側的水塘與 `raw_pumping` 刻意不放，原水是流「進」水廠的，放了會讓半個城市看起來往大水塘倒流；黑沙水庫也因 operator 過濾一併排除），各自吸附到最近的圖節點（最遠 133.8 m，是松山 50 米水池——山上本來就沒有路），再跑一次多源 Dijkstra（純 `heapq`，沒加相依套件）。每條路依兩端 `dist` 決定要不要反轉；若中間出現局部極小值（例如一條路兩頭各碰到一個水源），就在極小值處切成兩條，兩半各自往外流。輸出多了 `dist`／`distEnd`（起訖端離水源的公尺數，整數）、`flowSources`（用到的設施 id；叫 `flowSources` 是因為 `sources` 已經是 provenance 區塊）、`unreached`（沒有任何水源能走到的路的條數，這些維持原順序、`dist` 為 `null`）與 `splits`。

輸出 `public/data/water-distribution.json`（compact JSON，沒有 id，只有 `class` / `dist` / `distEnd` / `coordinates`），目前 4,910 條（4,767 有流向、143 unreached、219 條被切）、587.6 km、621 KiB（預算 700 KiB）。跑完要過 `validate_output.py water-distribution`（守門條件：頂層欄位齊、每條 `class` 在檔案自己宣告的 `classes` 內、`dist`／`distEnd` 是 `null` 或 ≥ 0 的整數且**要嘛都有要嘛都沒有**、有值時 `distEnd >= dist`、`unreached` 與實際 `dist: null` 的條數一致、每條至少 2 點、每點在澳門範圍內、至少 2,000 條）。`node scripts/inspect.mjs water-distribution` 印分級統計、總公里數、bbox、檔案大小，以及流向摘要（有流向／unreached、最大距離、切段數、反向的條數應為 0）。

> 上面這整套道路底稿（Overpass 抓路、裁邊界、保護路口頂點的簡化、多源 Dijkstra、往外定向、守門與寫檔）實作在 [`road_network.py`](../../data/scripts/road_network.py) 的 `build_distribution()`，跟 `fetch_power_distribution.py` 共用；兩支腳本各自只負責「用什麼當種子」。兩個檔案吃同一份 Overpass 快取，所以第二支跑起來不用再打 Overpass。

### 電力 — `fetch_power_facilities.py` / `fetch_power_distribution.py`

**清單是澳電的，幾何是 OSM 的，電網是我們畫的。** 名單與數字來自澳電「[營運](https://www.cem-macau.com/zh/about-cem/company-profile/operation/)」頁：頁上的「輸電及接駁網絡圖」圖例與 66／110／220 kV 三張表列出變電站名稱，散文則給了 2025 年的數字（用電量 6,259.7 GWh、本地發電 582.9 GWh 佔 9%、由廣東輸入 5,676.8 GWh 佔 91%、「29 座高壓變電站、8 座高壓開關站」、1,088 公里高壓電纜）與粵澳聯網沿革（1984 年首條 110 kV 線路；2008／2012／2022 年三條通道分別隨鴨涌河、蓮花、北安變電站投運，現為 8 回 220 kV 主供加 4 回 110 kV 備用，對澳輸電能力 1,700 MW）。那頁的網絡圖**有版權而且沒有地理座標**，一點都不描它——只取事實，座標一律來自 OpenStreetMap。

**為什麼是 33 座而不是 29 座。** 澳電的標題數字是「29 座高壓變電站、8 座高壓開關站」，但頁上從沒說哪一座算哪一邊——好幾座名字就叫「開關站及變電站」，兩邊都算。頁上**真正列得出來的是名字**：三張電壓表合計 33 個不重複的變電站名（澳北 A 與澳北 B 在表上是兩列，OSM 只有一個 `澳北變電站` w713089729，所以在這裡併成一筆設施），加上散文裡的北安變電站。腳本的 `SUBSTATIONS` 表就是這 33 筆，檔案裡的 `facts` 則原樣保留澳電自己的 29／8 標題數字，不去逆推它的分類。`type` 取**最高**電壓（澳北是 110/66，算 `sub110`；路氹是 110/66，也算 `sub110`），`voltageKv` 必須跟 `type` 對得起來。

**名稱比對。** 每個澳電名字用「中文主名」去對 OSM 的 `power=substation` 面：取 OSM `name` 的第一個空白分隔 token，去掉尾綴的括號註記，再去掉 `變電站`／`開關站及變電站`／`開關站` 後綴，然後**比相等，絕不比包含**——`焚化爐` 不可以命中 `新焚化爐變電站`（那是另一座 110 kV 站）、`氹仔` 不可以命中 `新氹仔`、`路氹` 不可以命中 `路氹醫院變電站`。兩筆跟 OSM 寫法不同的（澳電寫「青州」、OSM 寫「青洲」；澳北 A/B）在表上寫死 `osm_name`。同名兩條 way 時（大橋變電站被畫了兩次，其中一條沒標 `voltage`）取有標 `voltage` 的、再取面積大的。

比對後 28 筆有 OSM 面、**5 筆 OSM 根本沒有**：巴黎人、上葡京、外港、威尼斯人、喜來登。這 5 筆只出 marker、標 `approximate: true`，位置取一個具名地標多邊形的 representative point（澳門巴黎人 / 澳門上葡京 / 外港客運碼頭 / 澳門威尼斯人 / 澳門倫敦人——喜來登金沙城中心就在倫敦人那一塊裡），用哪個 OSM element 記在輸出的 `anchors`。**變電站的足跡不去查 `building`**：賭場那幾座就在裙樓裡面，一查會把整座度假村認領進來；改成拿底圖圖磚部件重切（`TilePartIndex.within` 要求部件本身 ≥ 50% 落在輪廓內，度假村大小的量體自然被擋掉），底圖也沒有的就退化成上限 20 m 的輪廓色塊。發電廠與焚化中心則比照水廠當「廠區」處理，把落在裡面的 `building` 全部認領（62 + 11 棟）。

**`network` 是我們的示意圖，不是澳電的電纜走向。** 那 1,088 公里高壓電纜幾乎全在地下，OSM 沒有，沒有東西可以描。`nodes` 是三個粵澳輸入點，都放在澳門這一側、在陸地上、離路夠近讓 OSRM 有得貼，都用 OSM 澳門邊界 relation `1867188` 驗過在境內：北通道（珠河線，珠海拱北變電站→鴨涌河，2008）放在鴨涌河對岸、鴨涌馬路旁 34.6 m；南通道（琴蓮線，橫琴琴韻變電站→蓮花，2011）放在蓮花大橋橋頭底下的海濱圓形地（OSM way `108771106`，橋段在它西邊 100 m 結束）；中通道（第三通道，珠海煙墩變電站→北安，約 10.3 km 電纜，2022）依公開資料「穿越馬騮洲、匯金灣及十字門三條水道」從橫琴那側跨十字門入澳，所以放在氹仔西北角、海洋花園變電站（110 kV，OSM way `321628441`）西北側岸邊約 40 m——登陸點沒有公開，這一點標 `approximate: true`（面板會寫「約略位置」）；220 kV 線從輸入點直接接北安，不經那座 110 kV 站。來源：澳電新聞稿 598、橫琴粵澳深度合作區「粵澳聯網40載」。`lines` 共 37 條：220 kV 骨幹 6 條是寫死的 edge list（三個輸入點各進一座落地變電站，鴨涌河→北安→蓮花→路環發電廠；蓮花往發電廠那條會經過廠區裡的路環B變電站 `w321628440`），14 座 110 kV 各接**路程上**最近的一座 220 kV 站或澳北，16 座 66 kV 各接最近的 110／220 kV 站，焚化中心再接焚化爐變電站（它把電賣給澳電）。「路程上最近」是先用直線距離挑 3 個候選再各跑一次 OSRM 取最短（純直線在被兩座橋切開的半島上常常挑到對岸），失敗的候選永遠輸給有路的候選。每條線正、反兩個方向都問 OSRM，取較短的那條再翻轉成 from→to——電纜不理單行道，而海洋花園那一小塊在 OSRM 裡開車出來要繞半島一圈 11 km，開進去只有 5.6 km。

幾何跟供水管網同一套規則：一次 `route/v1/driving`（`overview=full&geometries=geojson`），沿用 [`osrm_route.py`](../../data/scripts/osrm_route.py) 的 Hengqin 排除區；兩端 marker 的原座標補回頭尾（線一定起訖於站本身）；直線 < 150 m，或直線 < 600 m 而路徑繞出 3 倍以上，就畫成兩點直線並標 `direct: true`（`fallback` 仍為 `false`——`fallback` 只代表 OSRM 失敗，超過 3 條就中止）。多一道供水沒有的處理：OSRM 一條 7 km 的路會回 ~370 個頂點，而這個檔案是 `indent=2`，一個頂點就要 ~50 bytes，所以 routed 幾何再用 10 m 容差在公尺投影下 Douglas-Peucker 一次（頭尾必留），檔案從 427 KiB 降到 183 KiB。目前 37 條、89.9 km、6 條 `direct`、0 條 fallback。

```bash
cd data && uv run python scripts/fetch_power_facilities.py
cd data && uv run python scripts/fetch_power_distribution.py   # 要先有 power-facilities.json
```

產出 `public/data/power-facilities.json`（183 KiB，預算 400 KiB）與 `public/data/power-distribution.json`（622 KiB，預算 700 KiB）。前者跑完要過 `validate_output.py power-facilities`（守門條件：剛好 35 筆設施＝33 座變電站＋發電廠＋焚化中心、`id` 不重複、`type`／`operator`／`source` 都在列舉內、`voltageKv` 與 `type` 一致（發電側必須是 `null`）、座標在澳門範圍內、`approximate` 與 `anchor`／`osm` 互相自洽（近似的不得引 OSM id、精確的至少要引一個）、近似最多 8 筆、至少 20 筆有 `buildings`、發電廠的 `details` 有 `capacityMw` 與三語機組說明、`facts` 的兩個百分比加起來是 100；`network` 則是剛好 3 個 inlet 節點與 37 條線、`id` 不重複、`from`／`to` 都對得到設施或節點且不自環、`voltageKv` 在 220/110/66 內、`direct` 與 `fallback` 不會同時為真、`direct` 的剛好 2 個座標、其餘至少 2 個、**每一筆設施與節點都至少落在一條線上**、`fallback` 最多 3 條）。後者跟 `water-distribution` 共用同一個 validator（`v_distribution`）。

配水底稿那一支（`fetch_power_distribution.py`）除了種子不同以外，跟 `fetch_water_distribution.py` 是同一段程式（`road_network.build_distribution()`）：種子是 `power-facilities.json` 裡**全部 33 座**變電站（220／110／66 都算，那是電網真正降壓進到街道底下 11 kV 饋線的地方），發電廠與焚化中心刻意不放——它們是把電**送進**輸電網，放了會讓路環的街道看起來自己餵自己。最遠吸附 88.4 m（喜來登，近似 marker 落在倫敦人裙樓裡），4,970 條（4,924 有流向、46 unreached、275 條被切）。`node scripts/inspect.mjs power-facilities` 印設施摘要（依 type／operator 分組、精確 vs 近似＋anchor、足跡 kind、2025 年數字）與電網摘要（依電壓分組的條數與公里數、direct／routed、inlet 節點、fallback、最長的一條、最大繞行倍率、**沒有連上任何線的設施數應為 0**）；`node scripts/inspect.mjs power-distribution` 跟 `water-distribution` 同格式。

### 公廁 — `fetch_toilets.py`

從 data.gov.mo 抓 IAM（市政署）兩個 dataset：「公共廁所」（~198 筆，名稱/地址/電話/開放時間都有 zh/pt/en 欄位，另帶 `hasDwc`／`hasFwc`／`tempClose`，座標放在 `location`，是 `"lat,lng"` 字串）與「無障礙公廁」（前者的子集，只用來交叉驗證 `accessible`）。跟 `fetch_road_works.py` 一樣，下載端點回的是免 token 的 ZIP，偶爾會回 `{"msg":"內部錯誤"}` 而不是 ZIP，因此也帶重試。

名稱前面掛的 IAM 編號（例如「AM01 食品資訊站」）會被拆出來當 `id`（同編號多筆時加 `-2` 後綴；少數沒編號的退回用名稱 slug），顯示用的 `name` 則把編號剝掉；`location` 的 `"lat,lng"` 字串解析後改成 GeoJSON 慣例的 `[lng, lat]` 順序存進 `coordinates`。產出 `public/data/toilets.json`，跑完要過 `validate_output.py toilets`。

### 停車場 — `fetch_car_parks.py`

DSAT 的停車場資料分兩個 dataset，都掛在 dsat.apigateway.data.gov.mo 這個 API gateway 後面，用同一把「公開」APPCODE（dataset 頁面直接印給每個訪客看，不用登入）當 `Authorization: APPCODE <key>` header：「車位詳情」（car_park_detail，88 個公共停車場，靜態、每日更新——這支腳本抓的）與「即時空位」（car_park_maintance，~87 筆，每 10 秒更新一次）。後者 CORS 開 `*`，直接由瀏覽器輪詢（且只在模擬時鐘顯示「現在」（1× 且與真實時間同步）時才打），不進這條 pipeline。兩者都回 XML：單一 `<CarPark>` root，每筆記錄是一個 `<Car_park_info ATTR="..." />`，欄位全部放在 ATTRIBUTES 裡。

比較特別的欄位對應：`X_coords`其實是緯度、`Y_coords`才是經度（跟命名反著來），`coordinates` 要組成 `[float(Y_coords), float(X_coords)]`。收費／備註等多行欄位用字面 `"##"` 黏成一行，轉回 `"\n"` 時要把頭尾因為多餘分隔符產生的空行修掉；單一 `"-"` 是「不適用」的佔位符，轉成 `""`。`height`（限高，公尺）在沒有限高的車位是 `"--"`／`"---"`／空字串，parse 不出來就存 `null`。APPCODE 雖然公開，仍然不寫進任何檔案：從 `DATAGOVMO_APPCODE` 環境變數讀（CI 是 GitHub secret，本機手動 export），沒設就直接以 exit code 2 中止。產出 `public/data/car-parks.json`，跑完要過 `validate_output.py car-parks`。

### 垃圾回收 — `fetch_waste.py`

八個上游、四種抓法。市政署（IAM）三個：「垃圾房」（`57964cb5-…`，114 筆，1 筆 `tempClose`）與「壓縮式垃圾收集點」（`e49ac4a5-…`，140 筆）是免 token 的 ZIP 下載，跟 `fetch_toilets.py` 同一套；「全澳垃圾收集設施的資訊列表」（`6c7617b7-…`，`GET https://iam.apigateway.data.gov.mo/macaohygiene_allgarbage`，APPCODE header）回 296 筆，三種 `typeZh`（垃圾房 114、壓縮式垃圾桶 140、垃圾站 42）混在同一份清單裡，**只取 `typeZh=="垃圾站"` 的 42 筆**——另外兩種跟前兩個 ZIP dataset 重複，丟掉不要。三個 IAM 端點都偶爾回 `{"msg":"內部錯誤"}` 而不是預期格式，因此共用同一套重試邏輯。環境保護局（DSPA）五個收集點 dataset，都是 `POST https://dspa.apigateway.data.gov.mo/T_Bas_POI_Basic/{plasticNCanRecycle,recycleBin,electronicRecycling,lightBulb,battery}`，跟 `fetch_car_parks.py` 一樣用同一把公開 APPCODE 當 `Authorization: APPCODE <key>` header（從 `DATAGOVMO_APPCODE` 讀，沒設就 exit 2，不寫進 repo）：智能回收機（`12d42ec3-…`，67 筆）、三色資源回收點（`db6f226e-…`，311 筆，9 筆 `status` 為 `"2"`）、電腦及通訊設備回收點（`d358a990-…`，56 筆）、光管回收點（`33264820-…`）與電池回收點（`a536616e-…`）——後兩個 dataset 回傳的是同一份 406 筆清單（id／名稱／座標全部相同），因此合併成一種 `lamp_battery` 型別，但兩個 dataset 都記進 `sources`。

IAM 記錄用 `nameZh/namePt/nameEn`、`location`（`"lat,lng"` 字串，緯度在前）、`photo`（iam.gov.mo 的 https URL）、`tempClose`；名稱開頭的分區代碼（`M12`／`T3`／`C1` = 澳門／氹仔／路環）保留在 `name` 裡，不像 `fetch_toilets.py` 那樣剝掉，因為 IAM 就是這樣標示的。DSPA 回傳的是 `{ID, name_tc, name_pt, address_tc, address_pt, status, latitude, longitude}`（字串），沒有英文名（`name.en` 留空，前端 en→pt→zh fallback）；`status` 欄位官方沒說明用途（三色資源回收點裡 9 筆是 `"2"`，其餘全部 `"1"`），原樣存成整數 `upstreamStatus`，**不**當成 closed 判斷。`closed` 只有 IAM 的 `tempClose: true` 會設為 true，DSPA 的站點一律 `false`。

除了九種收集點（玻璃樽與衣物回收點來自市政署環境資訊網地圖背後的 `facility_c.json`——不在 data.gov.mo 上、直接 GET、1,457 筆全帶 `mapLink` 座標——只取「玻璃樽公共回收點」5 筆與「全澳衣物公共回收點」16 筆），`waste.json` 還帶兩塊額外資料。**`facilities[]`**（8 筆）——特殊和危險廢物處理站是手放的（`approximate: true`，位置抄自 DSPA「[處理設施](https://www.dspa.gov.mo/place1_3.aspx)」頁的文字描述，沒有座標可查）；兩個堆填區（建築廢料堆填區 way `552848944`、九澳飛灰堆填區 way `552740242`）用 [`osm_footprints.overpass()`](../../data/scripts/osm_footprints.py)（跟學校／供水／供電共用的同一個快取／鏡像／backoff helper）查 `way(id:552848944,552740242); out geom;` 拿外環，存進 `polygon`；五座污水處理廠（澳門半島、氹仔、路環——路環再生水站算進同一筆——跨境工業區、機場）比照水／電廠房那套抓法：查 OSM 建築、拿基圖圖磚重切，`buildings[]` 直接存在各自的 facility 記錄裡，不像焚化中心要借別的檔案。除了九澳飛灰堆填區與機場廠，每筆 facility 多帶一個 `statsKey` 欄位（`"hazardous"`／`"landfill"`／`"wwtp.macau"` 等），指去新的 `dspa-stats.json`（下一節）；沒有數字的那兩筆 `statsKey` 是 `null`。**`ecoStations[]`**（10 筆）——DSPA 環保加Fun站沒有開放資料，清單像水／電設施表一樣寫死在腳本裡（石排灣、青洲、巴波沙、祐漢、下環、黑橋、望廈、官也街、林茂塘、慕拉士；2024 年 6 月關閉的台山站不收），座標抄地址對應的 OSM 建築，抄不到門牌級只抄到屋苑範圍的標 `approximate: true`。**焚化中心的月度統計不再進這個檔案**：舊版 `incinerator` 區塊整個搬去 `fetch_dspa_stats.py` 產的 `dspa-stats.json`，這支腳本現在只管收集點、環保站跟三種處理設施的位置／建築，不打統計 API 了；焚化中心本身的座標與建築足跡也還是不在 `waste.json` 裡——那是 `power-facilities.json` 已有的 `incinerator` 記錄，前端直接借用（見 [04-3d-layers.md](04-3d-layers.md)），這支腳本不重抓一次。

產出 `public/data/waste.json`（九型別、≈1,157 筆收集點、10 個 `sources`、8 筆 `facilities`（含 5 座污水處理廠）、10 筆 `ecoStations`），跑完要過 `validate_output.py waste`。

### DSPA 月度統計 — `fetch_dspa_stats.py`

八條 series、五種上游，全部 best-effort（單一 series 打不到就存 `null`，不讓整個 run 失敗）。第五種上游是環保局自己的 GIS 網站：機場污水站（`wwtp.mia`）不在 data.gov.mo 的 API gateway 上，`fetch_gis()` 重放 apps.dspa.gov.mo 那個公開頁面自己送出的 DataTables 請求（`common/Service.svc/getDataByPeriodServerProcessing/V_T_Bas_WWTP_Approved`，`initFilter: " Category='mia' "`，Basic auth 用該站 util.js 寫死給所有訪客的 `public` 帳號）——這不是開放 API，隨時可能失效，所以一樣 best-effort，面板連結指向該 GIS 頁而不是 dataset。`incinerator`（`POST …/T_Bas_MRIP_Approved`，跟舊版一樣的 198 筆月度數字：受量、發電、回收金屬）是唯一在 data.gov.mo 有 dataset 的（`8142c05e-…`）；`hazardous`（`T_Bas_MHWTP_Approved`：受量／處理量）跟 `landfill`（`T_Bas_Landfill_Approved`：每月堆埋體積）只在 DSPA 自己的 GIS 公開資料頁（apps.dspa.gov.mo/gis/publicData.html）查得到，data.gov.mo 上沒有對應 dataset，`datasetId` 因此存 `null`（`url` 改指那個 GIS 頁）。四座污水處理廠各自一個 endpoint：`wwtp.macau`（`T_Bas_WWTP_Macau_Approved`，`9c555082-…`）比較特別——回傳的是**逐日**列（6,390 筆），腳本自己按月加總（`MDTOverflow`→`basicM3` 基本污水處理、`Influent_ProcessFlow`→`biologicalM3` 生物處理，兩者相加＝`totalM3`；2026-06 加總 6,073,401 m³，跟 GIS 頁對得上）；`wwtp.taipa`（endpoint 名字很怪，寫成 `V_T_Bas_MRIP_Approved_2`，`9d257556-…`）、`wwtp.coloane`（`V_T_Bas_WWTP_Approved/coloane`，`a5a05d0e-…`）、`wwtp.crossborder`（`V_T_Bas_WWTP_Approved/crossborder`，`4a57b120-…`）都是現成的月度總量，不用加總。機場廠 `wwtp.mia` 沒有任何公開資料，那個 series 直接是 `null`。

輸出 `public/data/dspa-stats.json`（約 11 KB）：`{fetchedAtUtc, incinerator, hazardous, landfill, wwtp: {macau, taipa, coloane, crossborder, mia}}`，每個非空 series 是 `{datasetId, url, unit, latest, months}`（`unit` 是 `"t"` 或 `"m3"`，`months` 近 12 個月由舊到新，`period` 一律正規化成 `YYYY-MM`——上游格式亂七八糟，「2010/1」「2026/6」「2026/06」都出現過）；`incinerator` 多帶一個 `facts`（三期 1992／2008／2024、8 條焚化線、約 3,000 t/日、滿載 56.7 MW——手打自 [dspa.gov.mo/place1_2.aspx](https://www.dspa.gov.mo/place1_2.aspx)，從舊版 `waste.json` 的 `incinerator.facts` 搬過來）。跑完要過 `validate_output.py dspa-stats`。

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
