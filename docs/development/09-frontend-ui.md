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
- **LineLegend** 桌面是右上角固定面板（TRANSIT/CITY 兩頁）、行動是右側 chip 疊 + CITY chip 開 modal；細節見下一節。
- **safe-area inset**：用 `env(safe-area-inset-*)` 處理 iPhone notch / home indicator。

## 圖層面板（LAYERS）與城市資料層

[`src/components/LineLegend.tsx`](../../src/components/LineLegend.tsx)。桌面版是右上角固定寬度（240px）面板，行動版是右側一疊 chip + 置中 modal。

### 桌面：TRANSIT / CITY 兩頁

面板頭下方有兩個分頁（`LAYERS_TABS = ['transit', 'city']`，state `layersTab`，寫回 `mm-layers-tab`）：**TRANSIT** 放原本就有的 LRT / BUS / AIR / SEA，**CITY** 放 WORKS / SCHOOLS / WC / P 這幾次 commit 加的城市資料層。分頁不影響地圖畫什麼，純粹是面板分類——城市圖層清單以後還會繼續長。

CITY 頁裡除 SCHOOLS 外每一列都固定五欄：圖示 → hatch 色塊 → 標籤 → 數字 → ON/OFF，欄寬是寫死的 class（不是 flex 自動撐開），所以任兩列的「數字」和「ON/OFF」永遠對在同一條垂直線上，不管標籤多長。加新城市圖層列時照抄這個五欄結構。

### SCHOOLS：複合列

SCHOOLS 打破「一列一開關」：一列拆成本體 + 開關兩個獨立 `<button>`。點本體（圖示到數字那段）展開/收合下面五個 per-level 子列（`schoolsLegendOpen`，存 `mm-schools-legend-open`，預設展開）；最右邊的 ON/OFF 才是整層總開關（`onToggleSchools`），跟本體點擊互不干擾。沒有 chevron——底下露出來的子列本身就是「已展開」的視覺線索。每個子列自己也是「色塊、標籤、EN 縮寫、數量、ON/OFF」，數量是該教育階段的學校總數（未過濾）。行動版 SCHOOLS modal 把同一組子列直接攤平（modal 本來就是全展開狀態，用不著桌面版那層可收合殼）。

### WASTE：複合列，但數字會動

垃圾回收列是第二個複合列，同一招：本體展開/收合、右側 ON/OFF 是總開關（`onToggleWaste`——這顆開關同時是 WASTE 專注模式的進出開關，見下面「localStorage key」之後的專注模式說明；展開/收合狀態是另一個獨立的 `wasteLegendOpen`，存 `mm-waste-legend-open`，預設展開）。跟 SCHOOLS 的差異：七個 per-type 子列（六種站點加垃圾焚化中心）只在 `wasteOn && wasteLegendOpen` 都成立時才渲染，不是本體一展開就看得到——WASTE 預設關，關著的時候看子列沒有意義。列本身的數字也會動：七個子列全開時顯示總數（1,095，含焚化中心），只要關掉任一種就換成 `可見/總數`（例如 `800/1094`），提醒使用者現在看到的不是全部（`wasteTypesAllOn` 判斷）。子列同樣是「色塊、標籤、數量、ON/OFF」，順序固定為 [`WASTE_TYPES`](../../src/waste.ts)：垃圾房、壓縮式垃圾收集點、智能回收機、三色資源回收點、電腦及通訊設備回收點、光管及電池回收點、垃圾焚化中心；隱藏的類型存進 `mini-macau-waste-types`（[`loadHiddenWasteTypes`/`saveHiddenWasteTypes`](../../src/waste.ts)，JSON 陣列，壞資料一律退回「全部顯示」）。行動版 WASTE modal 跟 SCHOOLS 一樣把七個子列直接攤平。

### 行動版：chip 疊 + CITY chip

`sm:hidden` 疊出一排 36px chip：LRT / BUS / AIR / SEA 不變，接一條 hairline，再接一顆 **CITY** chip（建築物圖示，任一城市圖層開著就亮）。點開是一個列表 modal（`cityLayerRows`，只有背後有資料的圖層才出現一列）：列名（左半）點下去換成那個圖層自己的 modal（SCHOOLS 換成上面攤平版），列右邊的數字 + ON/OFF 原地切換，不用先進子 modal。四個城市圖層的 modal 都跟桌面版共用同一組 `onToggle*` handler。

### Info panel 互斥

五個新圖層各自有 `RoadWorkInfoPanel` / `SchoolInfoPanel` / `ToiletInfoPanel` / `CarParkInfoPanel` / `WasteSiteInfoPanel`（[`src/components/`](../../src/components/)，由 [`App.tsx`](../../src/App.tsx) lazy import）。點地圖上任一 marker/block，對應的 `on*Click` handler 會把其餘六種 selection（vehicle、station、road-work、school、toilet、car-park、waste）全部清空——同一時間只有一個 info panel 開著。關掉某個城市圖層也連帶清掉它的 selection（`useEffect(() => { if (!roadWorksOn) setSelectedRoadWork(null) }, [roadWorksOn])` 這個 pattern 五層各一個，SCHOOLS 多一層 `schoolLevelsOn` 版本），因為對應的 marker 已經從地圖上消失了。

### localStorage key

| Key | 存什麼 | 預設 |
|---|---|---|
| `mm-layers-tab` | TRANSIT / CITY 分頁 | `transit` |
| `mm-layers-desktop-open` | 桌面面板展開/收合 | 展開 |
| `mm-layers-collapsed-groups` | BUS 分組收合狀態 | 全部收合 |
| `mm-schools-legend-open` | SCHOOLS 子列展開/收合 | 展開 |
| `mm-waste-legend-open` | WASTE 子列展開/收合 | 展開 |
| `mini-macau-lrt-on` | 哪些 LRT 線可見 | 全開（資料到齊後寫入） |
| `mini-macau-visible-routes` | 哪些巴士路線可見 | 未設定 = auto-by-time |
| `mini-macau-flights-on` | AIR 總開關 | 開 |
| `mini-macau-ferries-on` | SEA 總開關 | 開 |
| `mini-macau-roadworks-on` | WORKS 總開關 | 開 |
| `mini-macau-schools-on` | SCHOOLS 總開關 | 關 |
| `mini-macau-school-levels-on` | 五個教育階段個別開關 | 全開 |
| `mini-macau-toilets-on` | WC 總開關 | 關 |
| `mini-macau-carparks-on` | P 總開關 | 關 |
| `mini-macau-waste-on` | WASTE 總開關（專注模式） | 關 |
| `mini-macau-waste-focus-snapshot` | WASTE 開啟前其他圖層的可見狀態快照（JSON） | 無 |
| `mini-macau-waste-types` | 隱藏的垃圾回收子類型（七選，key 為 type id，含 `incinerator`） | 全部顯示 |
| `mini-macau-water-on` | WATER 總開關（專注模式） | 關 |
| `mini-macau-water-focus-snapshot` | WATER 開啟前其他圖層的可見狀態快照（JSON） | 無 |
| `mini-macau-power-on` | POWER 總開關（專注模式） | 關 |
| `mini-macau-power-focus-snapshot` | POWER 開啟前其他圖層的可見狀態快照（JSON） | 無 |

**WATER／POWER／WASTE 是同一套專注模式**（[`src/focusMode.ts`](../../src/focusMode.ts) 共用 capture／apply／persist 這一半：`FocusLayer = 'water' | 'power' | 'waste'`）：開啟其中一個時，先把其他所有圖層的可見狀態（LRT 線集合、巴士可見路線與自動模式旗標、AIR、SEA、WORKS、SCHOOLS、WC、P）存成快照，再全部關掉（連 LRT 路軌與巴士路線軌跡也不畫），地圖只剩該圖層自己的東西；關閉時原樣還原快照——中途手動改過的圖層也以快照為準——然後清掉快照。快照放 localStorage（`mini-macau-<layer>-focus-snapshot`），重新整理後再關閉仍能還原。專注模式期間時間控制整個消失（上方時鐘與下方的播放／暫停、倍速、時間軸、「現在」都不渲染，對應的鍵盤快捷鍵也不作用，判斷式是 `focusOn = waterOn || powerOn || wasteOn`）——這三層都沒有時間維度；模擬時鐘在背景照走，關閉任一個即原樣回來。

**三者互斥**：開其中一個時會先把當時開著的另一個關掉並還原它的快照，再對其餘圖層重新做一次快照與隱藏——這個「交接」寫在 [`focusHandoffSnapshot`](../../src/focusMode.ts) 裡，直接把舊快照過戶給新的一層，不會真的走「先還原、再重新隱藏」兩次 render；`activeFocusPeer` 負責在三者裡找出當下唯一開著的那個（storage 萬一同時存了兩個 on，`FOCUS_LAYERS` 陣列順序 `water → power → waste` 的第一個贏）。三層各自的差異只在開啟後多畫什麼：WATER 多畫供水設施（色塊＋水面＋管線）、POWER 多畫電網（設施類型、220／110／66 kV 線路、配電網、廣東電網輸入口，標題「電網為示意」）、WASTE 沒有額外的街道網——`MapView.tsx` 的 `applyFocusVisibility(m, water, power, waste)` 對 WASTE 只用來湊隱藏 `bus-routes`／`stations-*` 那組共用旗標，垃圾點本身跟 WC／P 一樣是資料陣列清空即消失，見 [04-3d-layers.md](04-3d-layers.md)「垃圾回收」一節。

WATER 開啟時列下方會展開一個靜態圖例（`WaterKey`，手機版在 WATER modal 內）：設施類型（水廠、水塘、高位水池、原水泵站、泵站、約略位置空心水滴）與管線（原水管深藍虛線、淨水管淺藍實線、示意直線灰虛線——只在資料有 `fallback` 管段時出現、配水管網細線、珠海原水輸入口圖示），標題註明「管網為示意」。它是獨立區塊，不影響上下各列的欄位對齊。面板會標示營運者：澳門自來水設施，或黑沙水庫的「政府原水水庫（海事及水務局）· 非自來水公司設施」，並列出該設施接了幾條示意管線；點珠海原水輸入口開的是 `WaterInletInfoPanel`。配水路網（`water-distribution.json`，約 550 KiB）由 `useWaterDistribution` 在第一次開 WATER 時才抓一次，之後開關不再重抓。

WORKS 預設開、SCHOOLS/WC/P 預設關：道路工程改道是大家都想看的即時資訊，後三層是空間密度高的靜態圖層（全開會蓋掉地圖），留給想找的人自己開。WATER/POWER/WASTE 三個專注模式圖層同樣預設關，理由不同——開啟會把整個地圖清空只留自己，不該一進站就把使用者丟進某個專注模式。

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

[`src/analytics/ga.ts`](../../src/analytics/ga.ts)。GA4 透過 `gtag.js`，只記匿名使用事件（語言切換、模擬倍率變更、time jump 距離、追蹤車輛 type）。`startEngagementTracker()` 在 [App.tsx:79](../../src/App.tsx) 啟動，會用 `document.visibilitychange` + idle timer 判定有效互動時長。

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
