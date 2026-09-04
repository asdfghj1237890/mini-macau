# 07 · CI 與自動資料同步

`.github/workflows/` 一共 9 個 workflow：

| Workflow | Trigger | 做什麼 |
|----------|---------|--------|
| [`ci.yml`](../../.github/workflows/ci.yml) | 每個 PR、`push` to `master` | lint → test → build（Node 22）＋ `validate_output.py all`（bare Python） |
| [`deploy.yml`](../../.github/workflows/deploy.yml) | `push` to `master` | Build → Cloudflare Pages |
| [`update-flights.yml`](../../.github/workflows/update-flights.yml) | daily 20:00 UTC（澳門 04:00） | AviationStack → `flights.json` |
| [`update-flights-timetable.yml`](../../.github/workflows/update-flights-timetable.yml) | daily 03:23 UTC（澳門 11:23） | AviationStack 未來 7 天 → `flights-timetable.json` |
| [`update-ferry-schedules.yml`](../../.github/workflows/update-ferry-schedules.yml) | 月初 00:00 UTC | Scrape TurboJET / CotaiJet → `ferry-schedules.json` |
| [`service-status.yml`](../../.github/workflows/service-status.yml) | daily 23:00 UTC（澳門 07:00） | Scrape DSAT 公告 → `service-status.json` |
| [`update-road-works.yml`](../../.github/workflows/update-road-works.yml) | daily 18:20 UTC（澳門 02:20） | data.gov.mo → `road-works.json` |
| [`update-toilets.yml`](../../.github/workflows/update-toilets.yml) | daily 18:40 UTC（澳門 02:40） | data.gov.mo → `toilets.json` |
| [`update-car-parks.yml`](../../.github/workflows/update-car-parks.yml) | daily 18:50 UTC（澳門 02:50） | DSAT API gateway → `car-parks.json` |

`schools.json` 沒有對應的排程 workflow：`fetch_schools.py` 純手動執行（見 [05-data-pipeline.md](05-data-pipeline.md)）；跑完一樣要過 `validate_output.py schools`，沒過就不 commit。

## `deploy.yml` — Cloudflare Pages

每次 push 到 master：

1. `npm ci && npm run build` → `dist/`
2. `wrangler pages project create mini-map-macau --production-branch=master || true`（idempotent）
3. `wrangler pages deploy dist/ --project-name=mini-map-macau`

需要的 secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 資料 sync workflow 的共同骨架

七個資料 workflow 長得一樣：

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

每日 18:40 UTC（澳門 02:40）。上游（data.gov.mo 的 IAM 公廁 dataset）大約澳門時間 10:00 更新，抓的時間點其實沒那麼要緊，這個時段只是跟其他每日/每夜的資料 job 錯開。跑完 `fetch_toilets.py` 後還要過 `validate_output.py toilets`，沒過就不 commit。

### `update-car-parks.yml`

每日 18:50 UTC（澳門 02:50）。上游（DSAT car_park_detail，經 data.gov.mo 的 API gateway）是個變動很少的靜態清單，抓的時間點同樣不要緊，這個時段只是跟其他每日/每夜的資料 job 錯開。Fetch 這步需要 `DATAGOVMO_APPCODE` secret（DSAT 印在 dataset 頁面上給所有訪客看的公開 APPCODE，當 `Authorization: APPCODE <key>` header 送出；雖然公開，一樣不寫進 repo，只透過 secret / 環境變數傳遞）。跑完 `fetch_car_parks.py` 後還要過 `validate_output.py car-parks`，沒過就不 commit。

## `ci.yml` — lint / test / build / 資料驗證

每個 PR 與每次 push 到 master 都跑，兩個 job 平行：

- **`frontend`**（Node 22）：`npm ci` → `npm run lint` → `npm test` → `npm run build`（`tsc -b` 在 build 裡做 type check）。
- **`data`**（Python 3.13，不裝 scraper 依賴）：`python scripts/validate_output.py all`，把 `public/data/*.json` 全部過一遍驗證器。

本機要對齊的就是同一組指令（`npm run lint && npm test && npm run build`，加 `uv run python scripts/validate_output.py all`），詳見 [10-testing.md](10-testing.md)。deploy.yml 本身不跑測試，靠的是這支 CI 在同一次 push 上把關。
