# 06 · Realtime (RT) Mode

RT mode 是**唯一**走真實 live feed 的路徑，**僅針對巴士**。LRT、航班、渡輪永遠在 simulated 模式。它是 opt-in 的：

- Build flag：`VITE_ENABLE_RT=1` 才會在 UI 出現 RT toggle
- LocalStorage：toggle 狀態存 `mm_rt_enabled` / `mm_rt_unlocked`

開啟後，巴士的 sim 部分被丟掉、用 DSAT 真實位置覆蓋；LRT/航班/渡輪不變。如果 DSAT 對某條路線沒回 plate（例如夜路收班），那條路線就沒有車。

## 整體 data flow

```
                   /api/dsat/batch?routes=1:0,1A:0,...
                                        │
              ┌────── nginx (OpenResty) │ ──── Vite dev plugin
              │                         │      （configureServer middleware）
              │  ngx.location.capture_multi
              │  → /api/dsat/routestation/bus?routeName=...&dir=...
              │  → 8s shared cache (proxy_cache_path)
              ▼
              bis.dsat.gov.mo (real DSAT API)
                              ▲
                              │
                              │ 15s tick
                              │
              BusRealtimeBatcher（ realtimeClient.ts）
                              ▲
                              │ subscribe
                              │
                  RouteRealtimePoller × N
                              │ obs[]
                              ▼
                          BusTracker
                              │ TrackedBusState[]
                              ▼
                          MapView 渲染
```

## Server side：`/api/dsat/batch`

兩個實作對齊：

### Production — OpenResty / nginx

[`docker/nginx.conf`](../../docker/nginx.conf)。關鍵：

- **`proxy_cache_path /var/cache/nginx/dsat ... keys_zone=dsat_cache:10m max_size=100m inactive=10m`**：8 秒 TTL 的共享 cache，多瀏覽器 / 多分頁的請求自動 coalesce。
- **`/api/dsat/`** 直接 reverse proxy 到 `bis.dsat.gov.mo/macauweb/`。剝掉 CORS、加 `Referer`（DSAT 會檢查）、藏掉 upstream Cookie/Cache-Control。
- **`/api/dsat/batch`** 用 OpenResty 的 Lua 腳本 + `ngx.location.capture_multi`，把單一 batch 請求 fan-out 成多個 nginx 內部子請求，平行打 DSAT，全部 200 後合併成一個 JSON 陣列回傳。
- **Cache key 必須是 `$uri$is_args$args` 而非 `$request_uri`**：nginx 子請求會繼承 parent 的 `$request_uri`（也就是 batch 的長 URL），用 `$request_uri` 當 key 會讓所有子請求 collision 到同一個 cache entry。`$uri$is_args$args` 才是子請求自己的 URL。

### Dev — Vite middleware

[`vite.config.ts`](../../vite.config.ts) 的 `dsatBatchDevPlugin` 在本機重現一樣的 fan-out 行為（用 `Promise.all + fetch`）。dev 不做 cache，每個 tick 直接打 DSAT。

兩邊的 response shape 完全一致：

```json
[
  { "key": "1:0", "status": 200, "data": { "data": { "routeInfo": [...] }, "header": "000" } },
  { "key": "1:1", "status": 200, "data": null }
]
```

## Client side：[`realtimeClient.ts`](../../src/services/realtimeClient.ts)

### `RouteRealtimePoller`

每條路線 × 方向（`routeName:dir`，dir ∈ {0, 1}）一個 poller，subscribe 後拿 `BusObservation[]`。

### `BusRealtimeBatcher`（單例）

把所有 active poller 的 key 集中、每 15 s 打一次 `/api/dsat/batch`。

兩個適應性節流：

- **First kick delay 500 ms**：第一個 poller register 後，先等 500 ms 再發第一個 batch。讓啟動時的一連串 `register()`（每條 route 一次）合併成一次請求，而不是某個中途時刻意外觸發 mid-startup 的 fetch。
- **Adaptive cadence**：如果某 poller 連續 3 個 tick 拿到 0 隻車（夜路、休班路），就降到每 4 個 tick 才參與一次 batch。各 poller 用 hash 算自己的 `slowOffset ∈ {0..3}`，把空 slot 散開。
- **`document.hidden` 時不發 fetch**：分頁背景就停。

### `BusTracker`

DSAT 的 raw observation 只有「目前在第幾站、速度、方向」，沒有連續 GPS。`BusTracker` 負責把離散的 stop observation 轉成可繪的連續 progress（沿 route polyline 的 0..1）：

```ts
estimateProgress(state, now): number
```

兩階段：

**Phase 1: Transition tween（最近 2.5 s）**

每次 stop 從 N 變成 N+1（或更後面），記錄當下的「估計 progress」當 from，把新的 stop progress 當 to，2.5 s 內 linear tween 過去。這吸收掉 dead-reckoning 累積的誤差。環狀路線 wraparound 也在這裡處理：如果 `to - from < -0.5` 就把 from 減 1，避免從 95% 倒退到 5%。

**Phase 2: Dead reckoning**

Tween 結束後，從 last stop 的 progress 用 `(speed × 0.4) × age` 推進。幾個保險：

- **`DR_SPEED_CAP_KMH = 60`**：DSAT 偶爾回 99 之類的垃圾值，截掉。
- **`DR_SPEED_SCALE = 0.4`**：DSAT 的 instantaneous speed 沒考慮紅燈、塞車、停靠，照面值用會讓地圖上的車衝太快、提前「到」下一站。0.4 把 DR 巴士壓在真巴士後面。
- **`DR_MAX_AGE_MS = 45_000`**：超過 45 秒沒新觀測就凍結位置，避免飛離天涯海角。
- **`DR_STOP_EPSILON = 0.0005`**：DR 永遠不會跨過下一站；留一點點 ε，沒有實際觀測確認就不會「到站」。
- **`STALE_MS = 60_000`**：60 秒沒看到的 plate 從 tracker 刪掉。

**為什麼同站再被觀測時要 commit DR progress**：如果同一站連續觀測，把 `lastProgress` 重置回該 stop 的 progress 會讓地圖上的車「往後 snap」一次。所以當 `o.stopIndex === existing.lastStopIdx` 時，把當下的 DR estimate 寫回 `lastProgress`，`lastAt = now`，DR 從這個位置繼續往前推。

## 跟 sim 的整合

RT mode 開啟時，`computeVehiclePositions` 用 `{ skipBuses: true }` 呼叫，巴士部分整批跳過（[`simulationEngine.ts:1300`](../../src/engines/simulationEngine.ts)）：

> "In RT mode the bus layer is driven entirely from DSAT observations; every sim bus is thrown away upstream. Skip the per-route schedule rollup (~90 routes × ~10 vehicles each) so RT ticks don't pay for work whose output is discarded."

MapView 把 `BusTracker.getStates()` 轉成跟 sim 同樣 shape 的 `VehiclePosition[]`（多帶一個 `rt: { plate, speed, stopIndex, dir, observedAt }`），喂給 `Bus3DLayer.setData()`。

## 失敗模式

| 症狀 | 可能原因 |
|------|----------|
| RT toggle 沒出現 | `VITE_ENABLE_RT` 沒設、build 時沒帶到 |
| Toggle 開了沒車 | 對應路線 DSAT 真的沒在跑（夜路時段）；或 nginx 沒起來、`/api/dsat/batch` 502 |
| 車衝過頭 / 提前到站 | `DR_SPEED_SCALE` 過大；DSAT 速度欄位垃圾 |
| 車從進度 95% 倒退到 5% | 環狀路線 wrap 沒處理（檢查 `BusTracker.estimateProgress` 的 `to - from < -0.5` 分支） |
| 同一站重觀測時車輛 snap 一下 | `lastProgress` 沒寫回 currentEstimate，被 reset 回 stop progress |
