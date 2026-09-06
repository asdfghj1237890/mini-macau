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

- **LRT 按日期載入**：瀏覽器透過 `GET /api/lrt/<scheduleType>`（mon_thu / friday / sat_sun）取得時刻表。頁面先載入今天的 scheduleType，其餘兩個在主資料完成後背景 prefetch。本機 `npm run dev` 時，[`plugins/lrt-dev-api.ts`](../../plugins/lrt-dev-api.ts) 優先讀取 git-ignored 的 `src/data/trips-<scheduleType>.json`；未設定本機資料時，Vite 的 `/api` proxy 轉發到正式站。來源無法使用時，該類型的 LRT 圖層為空。見 [`useTransitData.ts`](../../src/hooks/useTransitData.ts) 的 `loadTrips`。

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

測試以純函數為主（[`simulationEngine.ts`](../../src/engines/simulationEngine.ts)、各城市圖層 helper、`grandPrix.ts`、schema），詳見 [10-testing.md](10-testing.md)。

## 在裝置上診斷（`?debug=1`）

手機沒有 console，所以 app 自帶一個。任何網址加上 `?debug=1`（或 localStorage `mini-macau-debug` 設 `1`），頁面底部會釘一個面板（[`src/debugOverlay.ts`](../../src/debugOverlay.ts)）：

- 瀏覽器能力：UA、viewport／dpr、WebGL 1/2 與顯示晶片、GL 上限（varyings、uniform 向量數）、OffscreenCanvas、module worker 探測。
- 每一個 window error、unhandled rejection、`console.error`／`warn`、MapLibre 的 `error` 事件（附 source 與 tile）；連續相同的行會摺成一行加 `×N`，洗版擠不掉前面的歷史。
- 每 3 秒一行心跳：`alive` 秒數、canvas 尺寸、`shaders`／`programs` 編譯數、`frames`、`tiles` 重載數與最忙的四個 source。
- 底部的紅色釘選區：最先出現的 `SHADER FAIL`（附 info log 與是否 context lost）、`webglcontextlost`、`GPUInitializationError`。
- 上一次載入的尾巴存在 localStorage `mini-macau-debug-log`，下次載入先印出來——被系統砍掉的頁面也留得下痕跡。時間戳是 UTC。

縮小範圍的開關，不用重新部署：`&layers=none`（只剩底圖，不加任何自家 source／layer）、`&nosim=1`（不跑模擬 tick）、`&no3d=1`（平面、無建築）、`&maxdpr=2`（限制 pixel ratio）、`&nowebgl2=1`（假裝沒有 WebGL 2，看地圖區的失敗訊息）。

[`public/gltest.html`](../../public/gltest.html) 是一個完全不含 app 程式的頁面：從 CDN 載 MapLibre 5.23 或 6.7（`?v=5|6`）、同一個 CARTO 底圖與鏡頭，加上合成的 fill-extrusion 與 circle `setData` 負載（`&veh=150&hz=30&circles=300`；`&veh=0&circles=0` 只留底圖；`&theme=light`、`&dpr=2`、`&buildings=1`、`&overscale=off`）。用它分辨「MapLibre 在這台裝置上」與「我們的 app」。兩個頁面都 `noindex`（`public/_headers`）。

## Data pipeline 的環境（選用）

如果你要重跑 Python ETL：

```bash
cd data
uv sync
uv run python scripts/fetch_flights.py            # 需 AVIATIONSTACK_API_KEY
uv run python scripts/fetch_ferry_schedules.py    # 直接 scrape 官網
```

LRT 的本機資料與部署輸入設定見 [時刻表](05-data-pipeline.md#時刻表)。

完整流程見 [05-data-pipeline.md](05-data-pipeline.md)。
