# Mini Map Macau — Developer Documentation

這份文件把專案拆成主題式的開發筆記。每篇都聚焦在一個面向，篇幅控制在能在 5–10 分鐘內讀完，並在關鍵實作細節處 link 回原始碼。

對外行銷與功能總覽請看根目錄 [README.md](../../README.md)。

## Table of Contents

| # | 主題 | 適合在什麼時候讀 |
|---|------|-----------------|
| [01](01-getting-started.md) | Getting started | 第一次 clone repo、跑 dev server、build production |
| [02](02-architecture.md) | Architecture overview | 想理解 Source → Pipeline → Static JSON → Runtime 的整體 data flow |
| [03](03-simulation-engine.md) | Simulation engine | 要碰 [`simulationEngine.ts`](../../src/engines/simulationEngine.ts)、改 ETA / schedule / 車輛位置算法 |
| [04](04-3d-layers.md) | 3D layers (Bus / LRT / Flight / Ferry) | 要動 fill-extrusion 幾何、車身造型、自訂車輛 layer |
| [05](05-data-pipeline.md) | Python data pipeline | 要重新生成 LRT / 巴士 / 時刻表 JSON、改 OSM extraction、改 OSRM road snap |
| [06](06-realtime-mode.md) | Realtime (RT) mode | 要動 DSAT live feed、`/api/dsat/batch` proxy、dead-reckoning |
| [07](07-ci-and-data-sync.md) | CI 與自動資料同步 | 要改 GitHub Actions、deploy、定期 scrape job |
| [08](08-performance-notes.md) | Performance notes（深度解析） | 想理解為什麼某些寫法不直覺、效能優化的權衡 |
| [09](09-frontend-ui.md) | Frontend UI（i18n / 路線分組 / 響應式） | 要動 UI、加新語言、改路線分組規則 |
| [10](10-testing.md) | Testing | 要寫測試、跑 vitest、知道哪些 pure function 已覆蓋 |

## 推薦閱讀順序

新人 onboarding：**01 → 02 → 03 → 06 → 04**。把 runtime 的整體骨架建立起來再進到細節。

要動效能：**08 → 03 → 04**。

要動 data pipeline：**02 → 05 → 07**。

## 關於文件本身

- 程式碼路徑都用 markdown link，可直接點到 source。
- 大型優化（cumKm、單一 source、tier throttle、`useSyncExternalStore`）有自己的專屬章節（08），同時也會在相關主題中 cross-link 過去。
- 文件以中文為主、保留程式識別字、檔案名與 commit 訊息為英文。
