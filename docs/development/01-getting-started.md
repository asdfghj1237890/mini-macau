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

- **`/api/dsat/batch` 由 Vite plugin 模擬**：[`vite.config.ts`](../../vite.config.ts) 有一個 `dsatBatchDevPlugin`，把 prod nginx 用 `ngx.location.capture_multi` 做的「fan-out 多路 DSAT 請求 → 合併成單一 JSON 陣列」在 dev 也跑一次。這代表你在本機就能測 RT mode，不用起 docker。
- **RT mode 要 build flag 才會出現**：UI 上的 RT toggle 由 `import.meta.env.VITE_ENABLE_RT === '1'` 決定（[`MapView.tsx:16`](../../src/components/MapView.tsx)）。dev 預設沒開；要本機跑 RT，把 `.env.development` 設 `VITE_ENABLE_RT=1` 再 restart vite。
- **trips 是 lazy 載的，而且不走 `/data/`**：LRT 時刻表放在 `src/data/trips-*.json`，由 `import.meta.glob` 按 schedule type（mon_thu / friday / sat_sun）打包成各自的匿名 hash chunk。頁面初次載入只 import 今天對應的那個，其餘兩個在主資料完成後才背景 prefetch。見 [`useTransitData.ts`](../../src/hooks/useTransitData.ts) 的 `loadTrips`。

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

## Production via Docker

`npm run dev` 跑出的不是 prod stack。Prod 用 `docker-compose.yml`（OpenResty + 編好的 dist）：

```bash
docker compose up --build
```

Image base：`node:22-alpine` build → `openresty/openresty:1.27.1.2-alpine` runtime。OpenResty 用 Lua 把 `/api/dsat/batch` 做 nginx 內部子請求 fan-out，並以 `proxy_cache` 8 秒共享 cache。詳見 [06-realtime-mode.md](06-realtime-mode.md) 跟 [`docker/nginx.conf`](../../docker/nginx.conf)。

## Data pipeline 的環境（選用）

如果你要重跑 Python ETL：

```bash
cd data
uv sync
uv run python scripts/fetch_flights.py            # 需 AVIATIONSTACK_API_KEY
uv run python scripts/fetch_ferry_schedules.py    # 直接 scrape 官網
uv run python scripts/generate_timetable.py       # 純資料、無外部依賴
```

完整流程見 [05-data-pipeline.md](05-data-pipeline.md)。
