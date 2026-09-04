# 10 · Testing

## 現況

`npm test`（[Vitest](https://vitest.dev/)）現在跑 **10 個測試檔、151 個 `it`**，< 1s。`ls src/**/*.test.ts*` 能看到其中 8 個：[`engines/simulationEngine.test.ts`](../../src/engines/simulationEngine.test.ts)、[`macauTime.test.ts`](../../src/macauTime.test.ts)、[`dataSchemas.test.ts`](../../src/dataSchemas.test.ts)、[`roadWorks.test.ts`](../../src/roadWorks.test.ts)、[`schools.test.ts`](../../src/schools.test.ts)、[`toilets.test.ts`](../../src/toilets.test.ts)、[`carParks.test.ts`](../../src/carParks.test.ts)、[`hooks/useTransitData.test.ts`](../../src/hooks/useTransitData.test.ts)。另外 2 個在 `src/` 之外的 `plugins/seo-content/`——SEO 注入外掛自己的既有測試，跟這裡的城市資料更新無關，CLAUDE.md 已經另外提過。

```bash
npm test            # 一次性
npm run test:watch  # 互動模式
```

## 為什麼只測 `simulationEngine.ts`

這個專案的「核心」分兩半：

- **算術層**（`simulationEngine.ts`）— deterministic、純函數、容易構造小 fixture、邊界情況多（跨午夜、循環 vs 雙向、cycle wrap、staggered 車輛）。值得測。
- **視覺層**（`*3DLayer.ts`、MapView render loop、UI panel）— 主要驗證是「看起來對不對」、「巴士有沒有從橋上掉下去」。寫單元測試成本高、訊息密度低，肉眼開 dev server 看反而更可靠。

所以 testing 範圍刻意縮在算術層，不追求覆蓋率數字。

## 測試覆蓋了什麼

| 函數 | 測試重點 |
|------|----------|
| `getScheduleType` | Mon / Thu / Fri / Sat / Sun 邊界 |
| `interpolateOnLine` | progress 0/0.5/1、超出範圍 clamp、單段直線、多段折線、退化 (n<2)、bearing 慣例（東 ⇒ 90°、北 ⇒ 0°） |
| `interpolateOnLineSmooth` | 端點 fallback、L-bend smoothing window |
| `progressAtCycle` | 環狀 cycle wrap、雙向 forward/backward、dwell hold、負值 input |
| `computeBusDirSec` | circular vs bilateral 兩條分支 |
| `computeBusCycleSec` | 服務時段內、開始前、跨午夜 wrap、Sunday bucket、staggered 車輛 lag |
| `getBusSchedule` | bilateral / circular、過短 polyline 回 null、`WeakMap` cache 行為 |

## 城市資料 helper（`roadWorks` / `schools` / `toilets` / `carParks`）

跟 `simulationEngine.ts` 同一套邏輯：這四個 helper 都是 pure function（notice/school/toilet/car-park 陣列 in，feature/count/label 陣列 out），不摸 DOM、不摸網路，容易上 fixture，所以也測了。

| 檔案 | 測試重點 |
|------|----------|
| `roadWorks.test.ts` | `roadWorkStatus` 的 active/upcoming/hidden 邊界、`daysBetween` 跨月跨年、`pickText` 語言 fallback |
| `schools.test.ts` | `buildSchoolFeatures` 的顏色/skip 規則、`filterSchoolsByLevel` 全開時保留 array identity、`loadSchoolLevelsOn`/`saveSchoolLevelsOn` round-trip 與壞資料容錯 |
| `toilets.test.ts` | `toiletVariant` 優先權（closed 蓋過 accessible）、`pickToiletText` 三語 fallback、`buildToiletFeatures` 的座標 skip |
| `carParks.test.ts` | `parseCarParkVacancyXml` / `parseCarParkTime` 解析 DSAT XML 與美式日期時間、`buildCarParkFeatures` 的 vacancy 標籤規則 |

`dataSchemas.test.ts` 是另一種測試：拿 zod schema（[`dataSchemas.ts`](../../src/dataSchemas.ts)）去 parse `public/data/*.json` 實際檔案內容，包括新的 `road-works.json` / `schools.json` / `toilets.json` / `car-parks.json`——保證 commit 進來的資料本身合法，不是測程式邏輯。

## 沒測什麼

刻意略過：

- **Orchestrator `computeVehiclePositions`** — 需要構造完整 `TransitData`，整合測試成本高。
- **`computeFlightVehicles`** — 大量 hard-coded waypoint（apron stand、taxi route、landing route、holding center），測下去基本上是把座標常數重抄一遍。
- **`computeFerryVehicles`** — 同樣理由：泊位 + 海上航線 waypoint hard-coded。
- **`*3DLayer.ts`** — 視覺驗證為主。
- **`useSimulationClock` / `useTransitData` 的 hook 本體** — 要 jsdom + `@testing-library/react`，目前不值得加依賴（`useTransitData.test.ts` 測的是它匯出的 pure helper——`buildFlightIndex`、`ymdMacau`、`weekdayOf`——不是 hook 本身）。
- **`realtimeClient.ts`** — `BusTracker` 的 dead-reckoning 邏輯實際上**很值得測**（同站 commit、wrap-around、speed cap 等等）。是 backlog 第一名，但目前是 hand-tested。

## 測試 fixture pattern

```ts
const line = (coords: [number, number][]): Feature<LineString> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: coords },
})

const minimalRoute = (over: Partial<BusRoute> = {}): BusRoute => ({
  id: 'test-route',
  name: 'Test',
  nameCn: '測試',
  color: '#000',
  stopsForward: [],
  stopsBackward: [],
  geometry: line([[113.5, 22.1], [113.6, 22.2]]),
  frequency: 10,
  serviceHoursStart: 6,
  serviceHoursEnd: 22,
  routeType: 'bilateral',
  ...over,
})
```

兩個 helper 把 fixture 構造從個別 test 移開。所有測試直接套 + 用 `over` 覆蓋差異欄位，可讀性比 inline literal 高很多。

## 浮點比較

`toBeCloseTo(value, precision)` 而非 `toBe`。`precision = 4` 對應約 1e-4 的容差，對 sim 的進度 / 角度比較足夠。

## 時區陷阱

`getScheduleType(date)` 內部用 `date.getDay()`，是 **local time** 的星期幾。所以測試用：

```ts
new Date(2026, 4, 4)   // 2026-05-04 local time = Monday
```

而不是 `new Date('2026-05-04T00:00:00Z')` — 後者在 UTC-X 時區會變成週日。

## 加新測試的工作流

1. 把要測的東西從 `simulationEngine.ts` `export` 出來（如果還沒）。
2. 在 `simulationEngine.test.ts` 開新 `describe`。
3. 用上面的 fixture helper 構造輸入。
4. `npm test` 確認綠燈。

## CI 整合

`deploy.yml` 還沒跑 `npm test`。要加的話最小變更是新增 `.github/workflows/test.yml`：

```yaml
name: Test
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

跟 deploy 解耦，因為 deploy 只在 master push，但 test 想在 PR 也跑。

## 將來最值得補測試的東西

依優先序：

1. **`BusTracker` (realtimeClient.ts)** — 同站再觀測時的 progress commit、環狀路線 wraparound、speed cap、stale 60 s drop。這是純函數 + 容易 fixture，但邏輯密度高、目前完全靠手測。
2. **`computeFlightVehicles` 的 holding pattern** — `isRunwayBusy` 條件、orbit 多圈後 exit、`postTime` 邊界。
3. **`computeBusVehicles` 的 queue 邏輯** — 同站多車排隊、端點 clamp 後的 perpendicular nudge。
4. **`flattenFerrySchedules`** ([`useTransitData.ts:59`](../../src/hooks/useTransitData.ts)) — 把 raw schedule 攤平成 Ferry[]、berth 分配、跨日。

這些都是純資料 in / 純資料 out，理論上不需要 mock 任何東西。
