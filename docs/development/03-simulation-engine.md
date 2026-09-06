# 03 · Simulation Engine

[`src/engines/simulationEngine.ts`](../../src/engines/simulationEngine.ts) 是整個 runtime 的算術核心。它純函數、無副作用：

```ts
computeVehiclePositions(transitData: TransitData, time: Date): VehiclePosition[]
```

每個 sim tick 餵 `(transitData, time)` 進去，吐出當下 LRT + 巴士 + 航班 + 渡輪四種車輛的座標、bearing、progress。MapView 拿這個陣列推進到各個 layer。

## 模擬時鐘（`useSimulationClock`）

[`src/hooks/useSimulationClock.ts`](../../src/hooks/useSimulationClock.ts)。

設計重點：**時間是 offset-based wall clock，不是 RAF delta 累加**。

```
baseWall  = 上次 rebase 時的 Date.now()
baseSim   = 上次 rebase 時的 sim 時間
speed     = 模擬倍率（1 = realtime、60 = 60×）
paused    = bool

simNow = paused ? baseSim
                : baseSim + (Date.now() - baseWall) * speed
```

每次 user 按 pause / 改 speed / `setTime`，就 `rebase()`：把當下的 `simNow` snapshot 進 `baseSim`，把 `baseWall` 對齊 `Date.now()`。這樣後續推進不會 jump。

**為什麼不用 RAF delta 累加**：背景分頁 RAF 會被 browser throttle 到 ~1 Hz 甚至完全停。如果用 delta sum，前景時跟 wall clock 對齊，背景一段時間後就明顯落後。Offset-based 每次重算都從 `Date.now()` 出發，回到前景的瞬間即正確。

**`syncToNow()` 是 "live" 的定義**：sim = wall、speed = 1、未暫停。任何「回到現在」的按鈕都應該呼叫這個。

## Schedule Type

```ts
getScheduleType(date: Date): 'mon_thu' | 'friday' | 'sat_sun'
```

[`simulationEngine.ts:7`](../../src/engines/simulationEngine.ts)。MLM 三線都是這三種班表，週五因為晚班加密所以獨立。

`useTransitData` 用這個決定要載入哪個 scheduleType：`GET /api/lrt/<scheduleType>`，先 fetch 今日對應的，剩下兩個在主資料載完後背景 prefetch。資料格式見 [05-data-pipeline.md](05-data-pipeline.md)。

## LRT 模擬（`computeLRTVehicles`）

對每個 `Trip`：

1. 用 `arrivalMinutes`/`departureMinutes` 找出當下這個 trip 處於哪個 stop dwell 或哪個 segment（含跨午夜 wrap，[`simulationEngine.ts:196`](../../src/engines/simulationEngine.ts)）。
2. 從 `stationProgressMap`（每站事先 `nearestPointOnLine` 得到 0..1 progress）內插出整個路線的 progress。
3. 餵 `interpolateOnLineSmooth(line.geometry, progress)` 取座標 + bearing。

**`interpolateOnLineSmooth` vs `interpolateOnLine`**：LRT 是 57 m 的雙節列車，per-segment 的 piecewise-constant bearing 在彎道會肉眼看到車身在每個 segment 邊界 snap 一下。Smooth 版本用 ±15 m 的 chord 平滑掉這個 step。詳見 [08-performance-notes.md](08-performance-notes.md) 的 `cumKm` 章節。

## Bus 模擬（`computeBusVehicles`）

複雜度集中在這裡，因為要處理：

- **環狀 vs 雙向**（`routeType: 'circular' | 'bilateral'`）
- **服務時段跨午夜**（`serviceHoursEnd <= serviceHoursStart` 視為 +1440 min）
- **週六、週日獨立窗口**（`serviceHoursStartSat` / `serviceHoursEndSat` 與 `serviceHoursStartSun` / `serviceHoursEndSun`；`null/null` 代表該 bucket 明確不設服務）
- **多輛車間隔發車**：同一條路線同時有 N 輛車，間隔 `route.frequency` 分鐘，車輛 ID `routeId-0..N-1`。
- **同站排隊**：兩台車同時 dwell 在同一站時，後到的會沿行進方向往後 shift `QUEUE_OFFSET_KM ≈ 28 m`（[`simulationEngine.ts:534`](../../src/engines/simulationEngine.ts)）。如果端點 clamp 了就改成側向 perpendicular nudge。

### `getBusSchedule` — 一次性 per-route 的 schedule build

對每條路線，根據幾何長度、停靠點清單、`tripDurationSec`（短於 5 km 是 30 min、否則 60 min）：

1. **把停靠點投影到路線上**得到每站的 progress：
   - `circular` 用 `projectStopsOrdered`：cursor 沿 polyline 走、每個下一站只在前方 window 內找最近，避免自交路線把 cursor 推過頭。
   - `bilateral` 用 `projectStopsUnordered`：直接 turf `nearestPointOnLine`，順序由 `stopsForward` / `stopsBackward` 決定。
2. **配時間**：總路程時間扣掉所有 dwell（`DWELL_SEC = 8` × stop 數），剩下按相鄰 stop 距離分配旅行時間。
3. 結果 cache 在 `WeakMap<BusRoute, BusSchedule>`。

`getBusSchedule` 是熱路徑函數中最重的，但 cache 命中後 < 1 µs。

### `progressAtCycle` — 給 cycleSec 算出當前路線 progress

```ts
progressAtCycle(schedule: BusSchedule, cycleSec: number): number
```

把 cycleSec mod `schedule.cycleSec`（環狀：cycleSec = tripDurationSec；雙向：2 × tripDurationSec），然後在 forward / backward 兩段裡找對應的 stop dwell 或 segment interpolation。dwell 期間 progress 不動；segment 內線性內插。

## Flight 模擬（`computeFlightVehicles`）

依航班類型分階段。座標都是 hard-coded 的機場 waypoint（apron / taxi / 跑道兩端 / holding pattern 圓心）。

**Departure timeline**：

```
[ T - 240, T - TAXI_MINUTES )  apron       ─ 12 個 stand 排隊
[ T - TAXI_MINUTES, T )        taxi        ─ 跑 TAXI_ROUTE_{NORTH,SOUTH}
[ T, T + DEPARTURE_CLIMB_MINUTES ]  climb  ─ 沿 destination.bearing 爬升 0→3000 m
```

跑道方向（南向起飛 vs 北向起飛）依目的地 bearing 決定。`isSouthbound(bearing)` 把東半球（90°–270°）視為南。

**Arrival timeline**：

```
[ T - FLIGHT_VISIBLE_MINUTES, T - APPROACH_END_MIN )
   approach    ─ 從 30 km 外朝 holding pattern 入口飛
[ APPROACH_END_MIN ... )
   hold        ─ 環狀 holding（半徑 ≈ 0.02°、2 min/orbit）
                  每圈 50% 處檢查 isRunwayBusy；不忙就 exit
   inbound     ─ HOLD_INBOUND_MINUTES 直線飛到 landing route 第一個 waypoint
   landing     ─ 沿 LANDING_ROUTE_{NORTH,SOUTH} 下降+滑行
                  touchdownT = 0.35：之前是空中、之後縮 scale 表示落地
```

`isRunwayBusy(flights, t)` 看任何 departure 是否在 t 前後 `TAXI_MINUTES` 或 `RUNWAY_BUSY_BUFFER_MINUTES` 內，是的話 holding 就再轉一圈。

每 RAF frame 另外呼叫 `computeFlightOnly`（[`simulationEngine.ts:1351`](../../src/engines/simulationEngine.ts)）只算航班，避免 sim tick 的 33 ms 步進讓飛機在高倍速下抖動。

## Ferry 模擬（`computeFerryVehicles`）

[`simulationEngine.ts:1206`](../../src/engines/simulationEngine.ts)。

每艘渡輪有兩個階段：

```
departure: [T - FERRY_DWELL_BEFORE_DEP_MIN, T)  berth dwell（90 min）
           [T, T + pathMin)                     沿 waypoint 巡航
arrival:   [T - pathMin, T)                     從反向 waypoint 巡航
           [T, T + 0)                           無 post-arrival dwell
```

`pathMin` 由 `pathLengthMeters / FERRY_CRUISE_KMH`（80 km/h）算得，cache 在 `(routeId:terminal:berthIndex)`。

**有些渡輪沒有航線幾何**（Cotai/Taipa 短程）：`route` 為 null 時只有 berth dwell window，看不到出海段。

**Departure 在 cast-off 前 1 min 才轉向**：渡輪靠泊整段 90 min 都用 berth 預設 bearing（mooring 幾何），到最後 1 分鐘才把船頭轉向第一個 waypoint，視覺上預告「即將出發」。

## Per-tick caches

`computeVehiclePositions` 跑 ~30 Hz，所以 transit data 派生出來的東西能 cache 就 cache：

- `cachedProgressMap`（LRT 站 → 線上 progress）
- `cachedBusStopMap`（stopId → BusStop）
- `cachedFilteredTrips` × `cachedFilteredScheduleType`（避免每 tick 重 filter ~10k trips）

只要 `transitData` reference 不變、scheduleType 不變，就重用上次。reference 變了（lazy load 完成新 trips）時 `resetTransitCachesIfStale` 會清掉。

## 測試

37 個 vitest 測試覆蓋以下 pure function（詳見 [10-testing.md](10-testing.md)）：

- `getScheduleType` — 邊界日
- `interpolateOnLine` / `interpolateOnLineSmooth` — 端點、clamp、bearing 慣例
- `progressAtCycle` — 環狀 vs 雙向、dwell hold、cycle wrap
- `computeBusDirSec`、`computeBusCycleSec` — 服務時段、跨午夜、週日 bucket、staggered 車輛
- `getBusSchedule` — bilateral / circular、過短 polyline 回 null、cache 行為
