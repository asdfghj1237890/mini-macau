# 07 · CI、Docker、自動資料同步

`.github/workflows/` 一共 6 個 workflow：

| Workflow | Trigger | 做什麼 |
|----------|---------|--------|
| [`deploy.yml`](../../.github/workflows/deploy.yml) | `push` to `master` | Build → Cloudflare Pages |
| [`docker-release.yml`](../../.github/workflows/docker-release.yml) | tag push `v*` 或 manual | Build & push multi-arch image to GHCR |
| [`update-flights.yml`](../../.github/workflows/update-flights.yml) | daily 20:00 UTC（澳門 04:00） | AviationStack → `flights.json` |
| [`update-ferry-schedules.yml`](../../.github/workflows/update-ferry-schedules.yml) | 月初 00:00 UTC | Scrape TurboJET / CotaiJet → `ferry-schedules.json` |
| [`service-status.yml`](../../.github/workflows/service-status.yml) | daily 23:00 UTC（澳門 07:00） | Scrape DSAT 公告 → `service-status.json` |
| [`update-road-works.yml`](../../.github/workflows/update-road-works.yml) | daily 18:20 UTC（澳門 02:20） | data.gov.mo → `road-works.json` |

`schools.json` 沒有對應的排程 workflow：`fetch_schools.py` 純手動執行（見 [05-data-pipeline.md](05-data-pipeline.md)）；跑完一樣要過 `validate_output.py schools`，沒過就不 commit。

## `deploy.yml` — Cloudflare Pages

每次 push 到 master：

1. `npm ci && npm run build` → `dist/`
2. `wrangler pages project create mini-map-macau --production-branch=master || true`（idempotent）
3. `wrangler pages deploy dist/ --project-name=mini-map-macau`

需要的 secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

注意：deploy 不開 `VITE_ENABLE_RT`，所以 Cloudflare Pages 上的 build **沒有 RT toggle**。要 RT 必須用 docker image。

## `docker-release.yml` — GHCR multi-arch image

只在 tag `v*` 或手動觸發時跑。產出 `ghcr.io/<owner>/mini-macau-rt:<tag>`，支援 `linux/amd64` + `linux/arm64`。

關鍵步驟：

- `docker/setup-qemu-action@v3` 提供 cross-platform emulation
- `docker/setup-buildx-action@v3` 啟用 buildx multi-platform build
- `docker/build-push-action@v6` with `cache-from/to: type=gha`（GitHub Actions cache，能省可觀的 build time）
- 開 `VITE_ENABLE_RT=1`（在 [`Dockerfile`](../../Dockerfile) build stage 寫死）

Tag 規則（由 `docker/metadata-action@v5` 處理）：
- `v1.2.3` → `1.2.3`、`latest`
- 任何 push → `sha-<short>`
- 手動 dispatch with `tag` input → 該 tag 名

## 三個資料 sync workflow 的共同骨架

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
      - run: uv run python scripts/<fetch>.py
      - run: git diff --quiet <output>.json && echo "changed=false" >> $GITHUB_OUTPUT || echo "changed=true" >> $GITHUB_OUTPUT
      - if: steps.diff.outputs.changed == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "..."
          git add <output>.json
          git commit -m "chore: ..."
          git push
```

`workflow_dispatch` 允許在 GitHub UI 手動跑，方便除錯。

### `update-flights.yml`

額外有外層 retry：fetch_flights 自己已經有 in-process 3 次重試，但偶發整段 upstream 倒（2026-04-21 那次就是這樣），所以再加一層 60 秒間隔的 2 次外層重試。`fetch_flights.py` 內部還有「safety guard」：解析出 0 row 就 exit non-zero，避免把 `flights.json` 蓋成 `[]`。

### `update-ferry-schedules.yml`

每月 1 日 00:00 UTC（澳門 08:00）。CotaiJet 跟 TurboJET 月度更新時刻表，所以 cadence 對齊。

### `service-status.yml`

每日 23:00 UTC = 澳門早上 07:00，比一般早班巴士運行還早一點點，能在用戶醒來前更新今日的停駛清單。

### `update-road-works.yml`

每日 18:20 UTC（澳門 02:20），排在上游 00:30 匯出、平台 01:09 更新之後，確保抓到當天最新的公告。跑完 `fetch_road_works.py` 後還要過 `validate_output.py road-works`，沒過就不 commit。

## 沒有 CI test job

目前 deploy 沒跑 `npm test`、也沒有獨立的 PR test workflow。`tsc -b`（在 `npm run build` 裡）會做 type check；vitest 要在本機跑或之後加進 deploy.yml 的 build step 之前。

加一個 test workflow 的最小變更：

```yaml
# .github/workflows/test.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

詳見 [10-testing.md](10-testing.md)。
