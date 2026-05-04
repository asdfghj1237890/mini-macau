# 09 · Frontend UI

UI 層相對直觀，主要是 i18n、路線分組、響應式、車輛追蹤鏡頭。重要的非顯而易見的東西集中在這裡。

## i18n

[`src/i18n.tsx`](../../src/i18n.tsx)。三語：`'en' | 'zh' | 'pt'`，預設 `'zh'`（繁體中文）。

```ts
const HTML_LANG_TAG = { zh: 'zh-Hant', pt: 'pt-PT', en: 'en' }
```

寫到 `document.documentElement.lang`，對應 `index.html` 的 hreflang，方便 SEO + screen reader + browser auto-translate。

切換循環：`zh → pt → en → zh`（`LANG_CYCLE`）。LocalStorage key `mm_lang`。

**Translation table 是 nested object，function value 處理參數化**（例如 `routesActive: (n) => '${n} routes active'`）。沒有引入 i18next 之類的庫；直接 inline，因為 string 量在可掌握範圍內。

## 路線分組

[`src/routeGroups.ts`](../../src/routeGroups.ts)。把 92 條路線分成 5 組：

| Group | 範例 | 規則 |
|-------|------|------|
| `night` | N1A、N2、N5 | 硬編碼集合 `NIGHT_ROUTES` |
| `special` | AP1、H1、701X | 機場、醫院、貴賓 |
| `taipaCotai` | MT1、11、35 | 氹仔/路氹境內 |
| `crossHarbour` | 21A、25、28A | 跨海大橋 |
| `peninsula` | 其餘所有 | default fallback |

加新路線時，新路線預設會掉到 `peninsula`。要進其他組要手加進對應的 Set。

`GROUP_ORDER` 控制 LineLegend 顯示順序，`GROUP_LABEL_KEYS` 對應到 i18n 字串。

## 響應式 layout

行動裝置（`(max-width: 639px)`）有專屬處理：

- **3D layer minzoom 行動 16，桌面 16.9**（[`Bus3DLayer.ts:30`](../../src/layers/Bus3DLayer.ts) 的 `IS_MOBILE`）：手機螢幕窄，得早一點看到 3D 細節。
- **漢堡選單**：`<MapView>` 自帶 `<HamburgerMenu>`，集中放控制項。
- **LineLegend** 在桌面是側邊長條、行動是底部 LRT/Bus 兩顆按鈕，按了才展開。
- **safe-area inset**：用 `env(safe-area-inset-*)` 處理 iPhone notch / home indicator。

## 車輛追蹤鏡頭

點任一車輛 → MapView 把該車設為 `trackedVehicleId`，之後每 sim tick 把鏡頭 `easeTo` 到該車位置。

要點：

- **保留 zoom / pitch / bearing**：tracking 期間 user 還是能 pinch zoom / 旋轉，鏡頭只追位置不搶其他控制。
- **車輛離開模擬時自動取消**：`commit e567a5f` 處理過 — 如果 tracked vehicle 不在當下的 `vehicles[]` 裡，清掉 selection。

## DateTimePicker / 時間軸

時間控制有兩條入口：

- **`<TimeDisplay>`** 一行 HH:mm，點擊開 `<DateTimePicker>` 浮層。
- **時間軸（time bar）**：localStorage key `mm_timebar` 記憶開關狀態。

按 spacebar = pause/play、Esc = 切換 sidebar、`syncToNow()` = 跳回 live。詳見 [`useSimulationClock.ts`](../../src/hooks/useSimulationClock.ts)。

## ServiceStatus integration

[`useServiceStatus.ts`](../../src/hooks/useServiceStatus.ts) 從 `/service-status.json` 拿當天停駛路線清單（由 [07-ci-and-data-sync.md](07-ci-and-data-sync.md) 的 `service-status.yml` 每天 00:00 UTC 產生）。

UI 用法：把 `inactive: Set<string>` 拿來 dim 對應路線（透過 [08-performance-notes.md](08-performance-notes.md) 第 2 節提到的 `setFeatureState`），讓使用者一眼看出哪些路線今天有狀況。

## 主題切換

兩種 basemap：CARTO Dark Matter / Positron。切換沒有專屬 hook，直接由 MapView 內 state 控制 `map.setStyle()`。

## Analytics

[`src/analytics/ga.ts`](../../src/analytics/ga.ts)。GA4 透過 `gtag.js`，只記匿名使用事件（語言切換、模擬倍率變更、time jump 距離、RT toggle、追蹤車輛 type）。`startEngagementTracker()` 在 [App.tsx:79](../../src/App.tsx) 啟動，會用 `document.visibilitychange` + idle timer 判定有效互動時長。

## 鍵盤捷徑

| 鍵 | 行為 |
|----|------|
| `Space` | Toggle pause |
| `Esc` | Toggle 漢堡選單 |
| 點車輛 | Track 該車 |
| 再點同車 | 取消 track |

## 加新語言的工作量

1. `i18n.tsx`：擴 `Lang` union、加 `LANG_CYCLE`、加 `HTML_LANG_TAG`。
2. 在 `translations` 物件加完整一份新語言的 entry（function value 也要包到）。
3. `index.html` 的 hreflang 加新 entry。
4. 確保所有 station / route / flight 資料 JSON 有對應語言欄位（目前 `namePt` 是 optional，runtime fall back 到 English）。
