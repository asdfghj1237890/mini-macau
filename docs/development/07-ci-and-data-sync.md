# 07 · CI 與自動資料同步

`.github/workflows/` 一共 13 個 workflow：

| Workflow | Trigger | 做什麼 |
|----------|---------|--------|
| [`ci.yml`](../../.github/workflows/ci.yml) | 每個 PR、`push` to `master` | lint → test → build → check:lrt-boundary（Node 22）＋ `validate_output.py all`（bare Python） |
| [`deploy.yml`](../../.github/workflows/deploy.yml) | `push` to `master`；也可被下面的資料 workflow 透過 `workflow_call` 呼叫 | Build → Cloudflare Pages |
| [`update-flights.yml`](../../.github/workflows/update-flights.yml) | daily 23:07 UTC（澳門 07:07，含 jitter 到 07:57） | AviationStack → `flights.json` |
| [`update-flights-timetable.yml`](../../.github/workflows/update-flights-timetable.yml) | daily 03:23 UTC（澳門 11:23） | AviationStack 未來 7 天 → `flights-timetable.json` |
| [`update-ferry-schedules.yml`](../../.github/workflows/update-ferry-schedules.yml) | 月初 00:00 UTC | Scrape TurboJET / CotaiJet → `ferry-schedules.json` |
| [`service-status.yml`](../../.github/workflows/service-status.yml) | daily 23:00 UTC（澳門 07:00） | Scrape DSAT 公告 → `service-status.json` |
| [`update-road-works.yml`](../../.github/workflows/update-road-works.yml) | daily 18:20 UTC（澳門 02:20） | data.gov.mo → `road-works.json` |
| [`update-toilets.yml`](../../.github/workflows/update-toilets.yml) | 每月 1 日 18:40 UTC（澳門 02:40） | data.gov.mo → `toilets.json` |
| [`update-car-parks.yml`](../../.github/workflows/update-car-parks.yml) | daily 18:50 UTC（澳門 02:50） | DSAT API gateway → `car-parks.json` |
| [`update-waste.yml`](../../.github/workflows/update-waste.yml) | 每月 1 日 19:10 UTC（澳門 03:10） | data.gov.mo（IAM ZIP + DSPA API gateway）→ `waste.json` |
| [`update-dspa-stats.yml`](../../.github/workflows/update-dspa-stats.yml) | 每月 1 日 19:20 UTC（澳門 03:20） | DSPA API gateway → `dspa-stats.json` |
| [`update-power-facilities.yml`](../../.github/workflows/update-power-facilities.yml) | 每年 3/1、9/1 19:30 UTC（澳門 03:30） | CEM 營運頁 + OSM + OSRM → `power-facilities.json` |
| [`update-water-facilities.yml`](../../.github/workflows/update-water-facilities.yml) | 每年 3/1、9/1 19:50 UTC（澳門 03:50） | 澳門自來水網站 + OSM + OSRM → `water-facilities.json` |

`schools.json` 沒有對應的排程 workflow：`fetch_schools.py` 純手動執行（見 [05-data-pipeline.md](05-data-pipeline.md)）；跑完一樣要過 `validate_output.py schools`，沒過就不 commit。`water-facilities.json` 現在由上面的 `update-water-facilities.yml` 每年 3 月、9 月各自動更新一次。`public-housing.json`、`parishes.json`、`religion.json`、`grand-prix.json`、`water-distribution.json`、`power-distribution.json` 跟歷史地圖的圖版同樣是純手動觸發，沒有排程 workflow（見 [05-data-pipeline.md](05-data-pipeline.md)）。

## `deploy.yml` — Cloudflare Pages

`push` 到 `master` 觸發；也能被下面每個資料 workflow 在 commit 之後透過 `workflow_call` 帶 `ref: master` 明確呼叫——用預設 `GITHUB_TOKEN` 推的 commit 不會觸發 `on: push`，不這樣呼叫的話資料更新後網站不會重新部署。

實際步驟：

1. Checkout 要部署的 ref（`workflow_call` 呼叫時吃 `inputs.ref`，一般 push 就用觸發當下的 `github.sha`）。
2. 第二個 checkout 以 sparse-checkout 取得時刻表部署輸入（`trips/`），放到本機路徑 `lrt-data/`；來源由 repository secrets 設定。
3. 把三份 `trips-*.json` 複製到 gitignored 的 `functions/_lrt/`，供 Pages Function 打包時讀取。
4. `npm ci`。
5. `npm run typecheck:functions`——用剛 staging 好的部署輸入對 Pages Function 做型別檢查。
6. `npm run lint`。
7. `npm test`（`LRT_TRIPS_DIR=functions/_lrt`，讓 trips schema 測試吃到真正的時刻表；壞資料在這步就會讓 job 失敗）。
8. `npm run build`。
9. `npm run check:lrt-boundary`。
10. `python data/scripts/validate_output.py all`（同樣帶 `LRT_TRIPS_DIR=functions/_lrt`，含 LRT 方向一致性檢查）。
11. 本機起一個 `wrangler pages dev dist`，用 `node scripts/verify-lrt-api.mjs` 打它，驗證打包後的 Pages Function 行為。
12. `wrangler pages project create mini-map-macau --production-branch=master || true`（idempotent）。
13. `wrangler pages deploy dist/ --project-name=mini-map-macau --branch=master --commit-dirty=true`——固定 `--branch=master` 是必要的：在裸 sha checkout 是 detached HEAD，沒這個旗標 wrangler 會回報成 `head` 分支，Cloudflare 會把這次部署當成 PREVIEW 而不是 production。
14. `node scripts/verify-lrt-api.mjs --allow-edge-challenge https://mini-map-macau.app https://mini-map-macau.pages.dev` 驗證正式站與 pages.dev；hosted runner 有時會先撞到 Cloudflare 的瀏覽器挑戰，這個旗標讓腳本明確回報那個特例，其他失敗仍會讓 job 失敗，且至少要有一個入口完整驗證通過。

需要的 secrets：

- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` — 建立與部署 Pages 專案用。
- 時刻表部署輸入的來源設定（見 workflow 的 checkout 步驟）。

## 資料 sync workflow 的共同骨架

十一個資料 workflow 長得一樣：

```yaml
on:
  schedule: [...]
  workflow_dispatch:

jobs:
  update:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: <random jitter>                       # schedule 時錯開，workflow_dispatch 跳過
      - run: until uv run python scripts/<fetch>.py; do ...; done   # 外層重試
      - run: uv run python scripts/validate_output.py <dataset>      # 硬性 gate
      - id: commit
        uses: ./.github/actions/commit-data        # 變更偵測 + commit + push（含 rebase 重試）
        with: { file: public/data/<output>.json, message: 'chore: ...' }

  deploy:
    needs: update
    if: needs.update.outputs.changed == 'true'
    uses: ./.github/workflows/deploy.yml           # GITHUB_TOKEN 的 push 不會觸發 on: push，所以明確呼叫
```

變更偵測、commit 與 push-with-rebase（兩個排程同時落在 master 的競態）集中在 composite action [`.github/actions/commit-data`](../../.github/actions/commit-data/action.yml)，不要在 workflow 裡重新內聯那段迴圈。`workflow_dispatch` 允許在 GitHub UI 手動跑，方便除錯。

### `update-flights.yml`

額外有外層 retry：fetch_flights 自己已經有 in-process 3 次重試，但偶發整段 upstream 倒（2026-04-21 那次就是這樣），所以再加一層 60 秒間隔的 2 次外層重試。`fetch_flights.py` 內部還有「safety guard」：解析出 0 row 就 exit non-zero，避免把 `flights.json` 蓋成 `[]`。

### `update-flights-timetable.yml`

每日 03:23 UTC（澳門 11:23）。同樣打 AviationStack，但抓「未來 7 天」的時刻表（`fetch_flights.py <date> --days 7`）寫進 `public/data/flights-timetable.json`，過 `validate_output.py flights-timetable` 後才 commit。

### `update-ferry-schedules.yml`

每月 1 日 00:00 UTC（澳門 08:00）。CotaiJet 跟 TurboJET 月度更新時刻表，所以 cadence 對齊。

### `service-status.yml`

每日 23:00 UTC = 澳門早上 07:00，比一般早班巴士運行還早一點點，能在用戶醒來前更新今日的停駛清單。

### `update-road-works.yml`

每日 18:20 UTC（澳門 02:20），排在上游 00:30 匯出、平台 01:09 更新之後，確保抓到當天最新的公告。跑完 `fetch_road_works.py` 後還要過 `validate_output.py road-works`，沒過就不 commit。

### `update-toilets.yml`

每月 1 日 18:40 UTC（澳門 02:40）。公廁清單不常變，跟車位一樣不需要每天抓，因此比照渡輪時刻表改成月度；上游（data.gov.mo 的 IAM 公廁 dataset）大約澳門時間 10:00 更新，抓的時間點其實沒那麼要緊，這個時段只是跟其他資料 job 錯開。跑完 `fetch_toilets.py` 後還要過 `validate_output.py toilets`，沒過就不 commit。

### `update-car-parks.yml`

每日 18:50 UTC（澳門 02:50）。上游（DSAT car_park_detail，經 data.gov.mo 的 API gateway）是個變動很少的靜態清單，抓的時間點同樣不要緊，這個時段只是跟其他每日/每夜的資料 job 錯開。Fetch 這步需要 `DATAGOVMO_APPCODE` secret（DSAT 印在 dataset 頁面上給所有訪客看的公開 APPCODE，當 `Authorization: APPCODE <key>` header 送出；雖然公開，一樣不寫進 repo，只透過 secret / 環境變數傳遞）。跑完 `fetch_car_parks.py` 後還要過 `validate_output.py car-parks`，沒過就不 commit。

### `update-waste.yml`

每月 1 日 19:10 UTC（澳門 03:10）。垃圾房／回收點清單跟公廁一樣是近乎靜態的設施名冊，同樣改成月度。同一個 job 內 `fetch_waste.py` 依序打：IAM 兩個 ZIP dataset、IAM 一個 API gateway GET（垃圾站）、IAM 環境資訊網自家 JSON（玻璃樽／衣物回收點，非 data.gov.mo）、DSPA 五個 API gateway POST（收集點）、Overpass 兩個 way（堆填區外環）、五座污水處理廠的 OSM 建築足跡（比照水／電廠房切圖磚，走 `osm_footprints.py` 的快取）。跟 `update-car-parks.yml` 一樣需要 `DATAGOVMO_APPCODE` secret（同一把公開 APPCODE，一樣不寫進 repo）。焚化中心的月度統計不在這支腳本裡了，見下面 `update-dspa-stats.yml`。跑完後要過 `validate_output.py waste`，沒過就不 commit。

### `update-dspa-stats.yml`

每月 1 日 19:20 UTC（澳門 03:20），緊接在 `update-waste.yml` 後面十分鐘——`dspa-stats.json` 的 `statsKey` 是指到 `waste.json` 的 facility id，順序上讓 waste 先落地比較合理，雖然兩個檔案其實互相獨立、誰先誰後都能各自 commit。`fetch_dspa_stats.py` 打七個 DSPA 上游（焚化中心、危廢站、堆填區、四座有公開資料的污水廠），全部同一把 `DATAGOVMO_APPCODE` secret。七條 series 各自 best-effort：任一個端點打不到只讓那條 series 存 `null`，不會讓整個 run 失敗，其餘照常 commit。跑完要過 `validate_output.py dspa-stats`，沒過就不 commit。

### `update-power-facilities.yml`

每年 3 月 1 日、9 月 1 日 19:30 UTC（澳門 03:30）——CEM 的營運頁大概一年更新一次年度發電／進口數字，變電站名單變動更慢，一年兩次抓法足以在幾個月內跟上新年度數字，又不會太常打 CEM／Overpass／OSRM demo server。`fetch_power_facilities.py` 讀 CEM 營運頁（中＋英）核對手寫的變電站表：任何一座變電站在頁面上出現、消失或改變電壓等級，直接 exit non-zero 且不寫檔，讓這次 run 失敗——這是要人手改表（找 OSM 對應點、排進 schematic 網格的位置），不是重試能解決的；下面的外層重試只是為了扛 Overpass 429 跟 OSRM 偶發問題。這支不重新產生 `power-distribution.json`：那份是從變電站座標當種子畫出來的，變電站集合在這個 job 裡改不了（改了直接讓 run 失敗），足跡幾公尺的偏移也不會讓一條路轉向。跑完要過 `validate_output.py power-facilities`，沒過就不 commit。

### `update-water-facilities.yml`

每年 3 月 1 日、9 月 1 日 19:50 UTC（澳門 03:50），排在電力那支 job 後面 20 分鐘，避免兩個 Overpass／OSRM session 撞在一起。澳門自來水的統計數據跟 22 個設施清單同樣一年才變一次，抓法跟電力那支一樣是一年兩次。`fetch_water_facilities.py` 讀澳門自來水網站的供水設施（zh/en/pt）、供澳原水與統計數據頁，核對手寫的設施表：四座水廠的三語名稱、統計裡的水廠數量，還有 `Facilities.jpg`（22 項清單的圖片來源）的 SHA-256，任何一項不符就 exit non-zero 且不寫檔——這是要人手核對圖片重抄清單，不是重試能解決的；下面的外層重試同樣只扛 Overpass／OSRM 偶發問題。跟電力那支一樣，這支不重新產生 `water-distribution.json`：設施集合在這個 job 裡改不了，足跡偏移不影響道路走向。跑完要過 `validate_output.py water-facilities`，沒過就不 commit。

## `ci.yml` — lint / test / build / 資料驗證

每個 PR 與每次 push 到 master 都跑，兩個 job 平行：

- **`frontend`**（Node 22）：`npm ci` → `npm run lint` → `npm test` → `npm run build`（`tsc -b` 在 build 裡做 type check）→ `npm run check:lrt-boundary`。
- **`data`**（Python 3.13，不裝 scraper 依賴）：`python scripts/validate_output.py all`，把 `public/data/*.json` 全部過一遍驗證器。

本機要對齊的就是同一組指令（`npm run lint && npm test && npm run build && npm run check:lrt-boundary`，加在 `data/` 目錄下執行的 `uv run python scripts/validate_output.py all`），詳見 [10-testing.md](10-testing.md)。`deploy.yml` 部署前也會重跑同一組 lint/test/build/check:lrt-boundary/validate_output（見上面的 `deploy.yml` 小節），兩邊刻意重複：`ci.yml` 在每個 PR／push 給快速回饋，`deploy.yml` 則帶著 `LRT_TRIPS_DIR` 在部署前多做一次含時刻表資料的完整檢查。
