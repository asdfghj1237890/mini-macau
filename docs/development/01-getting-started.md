# 01 · Getting Started

## 先決條件

- **Node.js 22+**（CI 用 22；18+ 也能跑，但對齊比較省事）
- **npm**（package-lock.json 是 npm 產的，用其他 package manager 會 lock 噪音）
- **uv**（只有要重跑 Python data pipeline 才需要；只動前端的話不用裝）

## Install & dev server

```bash
npm install
npm run dev
```

Dev server 起在 `http://localhost:5173`。MapView 是 lazy-import 的（[App.tsx:21](../../src/App.tsx)），第一次 paint 會看到 `<MapSplash/>`，等 maplibre-gl bundle parse 完才換成地圖。

## 重要的 dev 設定

- **trips 已經不在這個 repo 裡，執行期也不走 `/data/`**：LRT 時刻表現在維護在一個私有的資料 repo，瀏覽器改成打 `GET /api/lrt/<scheduleType>`（mon_thu / friday / sat_sun）這個 Cloudflare Pages Function（`functions/api/lrt/[stype].ts`，部署時才從私有 repo 灌進 git-ignored 的 `functions/_lrt/`）。頁面初次載入只 fetch 今天對應的那個 scheduleType，其餘兩個在主資料完成後才背景 prefetch。本機 `npm run dev`：`src/data/trips-<scheduleType>.json` 若有一份自己的（git-ignored）副本，[`plugins/lrt-dev-api.ts`](../../plugins/lrt-dev-api.ts) 會直接讀那份；沒有的話 Vite 的 `/api` proxy 轉發到正式站；兩者都沒有 LRT 圖層就是空的。見 [`useTransitData.ts`](../../src/hooks/useTransitData.ts) 的 `loadTrips`。

## Build

```bash
npm run build      # tsc -b && vite build (output → dist/)
npm run preview    # local preview of dist/
```

`tsc -b` 會 type-check 整個 `src/`（含測試檔），所以 build 失敗的訊息也涵蓋型別錯誤。

## Lint & test

```bash
npm run lint           # eslint . （flat config，eslint.config.js）
npm test               # vitest run（一次性）
npm run test:watch     # vitest 互動模式
```

測試只覆蓋 [`simulationEngine.ts`](../../src/engines/simulationEngine.ts) 的純函數，詳見 [10-testing.md](10-testing.md)。

## Data pipeline 的環境（選用）

如果你要重跑 Python ETL：

```bash
cd data
uv sync
uv run python scripts/fetch_flights.py            # 需 AVIATIONSTACK_API_KEY
uv run python scripts/fetch_ferry_schedules.py    # 直接 scrape 官網
```

LRT 時刻表的產生器不在這個 repo 裡（維護在一個私有的資料 repo），流程另外記在那邊。

完整流程見 [05-data-pipeline.md](05-data-pipeline.md)。
