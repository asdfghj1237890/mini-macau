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

- **3D model minzoom 行動 16，桌面 16.9**（[`Bus3DLayer.ts`](../../src/layers/Bus3DLayer.ts) 的 `IS_MOBILE`／`MIN_ZOOM`）：手機螢幕窄，得早一點看到 instanced mesh 細節；透明 picking layer 使用同一門檻。
- **漢堡選單**：`<MapView>` 自帶 `<HamburgerMenu>`，集中放控制項。
- **LineLegend** 桌面是右上角固定面板（TRANSIT/CITY 兩頁）、行動是右側 chip 疊，點 chip 開共用的圖層抽屜；細節見下一節。
- **safe-area inset**：用 `env(safe-area-inset-*)` 處理 iPhone notch / home indicator。

## 圖層面板（LAYERS）與城市資料層

[`src/components/LineLegend.tsx`](../../src/components/LineLegend.tsx)。桌面版是右上角固定寬度（240px）面板，行動版是右側一疊 chip + 一個共用的圖層抽屜（[`MobileLayerSheet.tsx`](../../src/components/MobileLayerSheet.tsx)，原生 `<dialog>`）。

### 桌面：TRANSIT / CITY 兩頁

面板頭下方有兩個分頁（`LAYERS_TABS = ['transit', 'city']`，state `layersTab`，寫回 `mm-layers-tab`）：**TRANSIT** 放原本就有的 LRT / BUS / AIR / SEA，**CITY** 放城市資料層，分兩組：「城市日常」（`t.layerEveryday`：堂區、道路工程、停車場、公廁、宗教、學校）與「城市專題」（`t.layerFocus`：歷史地圖、居屋、供水、供電、垃圾回收、大賽車）。列的定義是 `LineLegend.tsx` 的 `cityLayerRows`，`thematic` 旗標只決定放在哪一組，不帶任何互斥行為。分頁與分組都不影響地圖畫什麼，純粹是面板分類。

CITY 頁裡除 SCHOOLS 外每一列都固定五欄：圖示 → hatch 色塊 → 標籤 → 數字 → ON/OFF，欄寬是寫死的 class（不是 flex 自動撐開），所以任兩列的「數字」和「ON/OFF」永遠對在同一條垂直線上，不管標籤多長。加新城市圖層列時照抄這個五欄結構。

### SCHOOLS：複合列

SCHOOLS 打破「一列一開關」：一列拆成本體 + 開關兩個獨立 `<button>`。點本體（圖示到數字那段）展開/收合下面五個 per-level 子列（`schoolsLegendOpen`，存 `mm-schools-legend-open`，預設展開）；最右邊的 ON/OFF 才是整層總開關（`onToggleSchools`），跟本體點擊互不干擾。沒有 chevron——底下露出來的子列本身就是「已展開」的視覺線索。每個子列自己也是「色塊、標籤、EN 縮寫、數量、ON/OFF」，數量是該教育階段的學校總數（未過濾）。行動版 SCHOOLS modal 把同一組子列直接攤平（modal 本來就是全展開狀態，用不著桌面版那層可收合殼）。

### WASTE：複合列，但數字會動

垃圾回收列是第二個複合列，同一招：本體展開/收合、右側 ON/OFF 是總開關（`onToggleWaste`，和其他圖層一樣只切自己；展開/收合狀態是另一個獨立的 `wasteLegendOpen`，存 `mm-waste-legend-open`，預設展開）。跟 SCHOOLS 的差異：十二個子列只在 `wasteOn && wasteLegendOpen` 都成立時才渲染，不是本體一展開就看得到——WASTE 預設關，關著的時候看子列沒有意義。列本身的數字也會動：十二列全開時顯示總數 1,176，只要關掉任一列就換成 `可見/總數`，提醒使用者現在看到的不是全部（`wasteTypesAllOn` 判斷）。子列同樣是「色塊、標籤、數量、ON/OFF」，順序固定為 [`WASTE_LAYER_TYPES`](../../src/waste.ts)——九種收集點（[`WASTE_TYPES`](../../src/waste.ts)：垃圾房、壓縮式垃圾收集點、垃圾站、智能回收機、三色資源回收點、電腦及通訊設備回收點、光管及電池回收點、玻璃樽回收點、衣物回收點）之後接環保加Fun站（`eco_station`，10 個 DSPA 回收站）、處理設施（`facility`，焚化中心＋特殊和危險廢物處理站＋兩個堆填區合計 4 個）、污水處理廠（`wwtp`，5 座 DSPA 污水處理廠——跟處理設施分開一列，而且**預設顯示**，因為污水不是垃圾，不該讓「垃圾去哪了」這個問題順手把處理污水的廠也關掉）。後三列不是收集點，`countWasteByType` 用單獨的算式湊數（`facilities[]` 先按 `kind` 拆成 `wwtp` 跟其餘，`facility` 再加上焚化中心那 1 筆）。隱藏的列存進同一把 `mini-macau-waste-types`（[`loadHiddenWasteTypes`/`saveHiddenWasteTypes`](../../src/waste.ts)，JSON 陣列，壞資料或沒有存檔一律退回預設——七個回收/環保站列隱藏，垃圾房、壓縮式垃圾收集點、垃圾站、處理設施、污水處理廠預設顯示）。新增預設隱藏列時的遷移另用一把 `mini-macau-waste-types-seen` 記這個瀏覽器已經套用過哪些預設隱藏 id：`DEFAULT_HIDDEN_WASTE_TYPES` 之後如果再多一個，沒看過的訪客會被自動補上一次（且僅一次）隱藏，訪客自己切過的列永遠不會被這套遷移覆蓋——`wwtp` 不在預設隱藏清單裡，不會觸發這套遷移，單純跟垃圾房一樣一開始就顯示。行動版 WASTE modal 跟 SCHOOLS 一樣把十二個子列直接攤平。

每個處理設施／污水廠面板的統計圖表共用同一個 [`StatsChart`](../../src/components/StatsChart.tsx) 元件（title、latest-month chip、12 根月度長條、y 軸 0／一半／取整最大值三個刻度、gridline、逐條 tooltip、最新一根特別標示），換算與軸刻度規則在 [`src/dspaStats.ts`](../../src/dspaStats.ts)：`statsAxisMax`／`statsAxisStep` 把峰值無條件進位到 1／2／5 × 10ⁿ 的「整數」刻度（噸級抓萬、立方米級抓十萬到百萬），避免十二根高度相近的柱子被放大成鋸齒狀假趨勢——這幾個 series 本來就是月月差不多的平穩量，軸不能跟著資料範圍縮放。沒有 published series 的設施（九澳飛灰堆填區、機場污水廠）走 `StatsUnavailable`，印一行「沒有公開統計」而不是空白圖表或缺角的軸線。

### 行動版：chip 疊 + 共用圖層抽屜

`sm:hidden landscape:block` 疊出一排 36px chip：LRT、BUS、海空（航班與渡輪合成一顆），再接一顆 **CITY** chip（建築物圖示，任一城市圖層開著就亮）。點任一顆都打開同一個 `MobileLayerSheet`，上方是 LRT／巴士／海空／城市四個分頁。城市分頁先是索引（`MobileCityIndex`，同樣分「城市日常」「城市專題」兩組，只有背後有資料的圖層才出現一列）：列右邊的數字 + 開關原地切換；點列名換成同一個抽屜裡的詳情頁（`MobileCityDetail`，返回鍵回索引），SCHOOLS／WASTE 等複合列的子列在詳情頁直接攤平。詳情頁頂端的卡片（`.mm-mobile-layer-actions`）把「在地圖上顯示」開關與「單獨顯示」放在一起：先是開關列，再是強調色的單獨顯示列與灰色提示 `t.layerShowOnlyHint`（「關閉其他圖層」）。所有城市圖層都跟桌面版共用同一組 `onToggle*` 與 `onIsolateCityLayer` handler。

`showModal()` 會把焦點交給第一個控制項——抽屜的拖曳把手——而 iOS 會把那個焦點畫成抽屜頂端的一圈強調色外框。所以 `MobileLayerSheet` 在 `showModal()` 之後立刻把焦點移到標題（`h2`，`tabIndex={-1}`），`.mm-mobile-sheet-header h2:focus` 不畫外框（2026-09-24）。不要再讓把手成為第一個焦點目標。

### Info panel 互斥

除了歷史地圖（圖說與來源就在圖層面板裡），每個城市圖層各自有面板，全部由 [`App.tsx`](../../src/App.tsx) lazy import（`RoadWorkInfoPanel` / `SchoolInfoPanel` / `PublicHousingInfoPanel` / `ParishInfoPanel` / `ToiletInfoPanel` / `ReligionInfoPanel` / `CarParkInfoPanel` / 供水、供電、大賽車各自的面板），其中 WASTE 有四個——`WasteSiteInfoPanel` / `WasteIncineratorInfoPanel` / `WasteEcoStationInfoPanel` / `WasteFacilityInfoPanel`，全部從同一個檔案 [`WasteSiteInfoPanel.tsx`](../../src/components/WasteSiteInfoPanel.tsx) 各自 `lazy()` 匯出（一個 chunk，四個具名 export）。WASTE 仍只佔一個 selection slot：`selectedWasteSite` 存的是 `WasteSelection`（`{kind:'site'|'incinerator'|'ecoStation'|'facility'}` 的 tagged union），點哪一種就存哪一種、開對應的面板，但對外仍是「一個 selection」。點地圖上任一 marker/block，對應的 `on*Click` handler 會把其餘各種 selection（車輛、車站與各城市圖層）全部清空——同一時間只有一個 info panel 開著。關掉某個城市圖層也連帶清掉它的 selection（`useEffect(() => { if (!roadWorksOn) setSelectedRoadWork(null) }, [roadWorksOn])` 這個 pattern 每個城市圖層各一個，SCHOOLS 多一層 `schoolLevelsOn` 版本），因為對應的 marker 已經從地圖上消失了。

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
| `mini-macau-religion-on` | RELIGION 總開關 | 關 |
| `mini-macau-religion-categories-on` | 五個宗教類別（土地公／廟宇／教堂／清真寺／其他）個別開關 | 全開 |
| `mm-religion-legend-open` | RELIGION 圖例子列展開 | 開 |
| `mini-macau-oldmaps-on` | HISTORICAL MAPS（歷史地圖）總開關 | 關 |
| `mini-macau-oldmaps-selected` | 目前畫出的那一張歷史地圖（選項列 id，1912 地圖集為 `atlas-1912`）；2026-09-23 起一次只畫一張 | 無（沿用舊 `mini-macau-oldmaps-hidden` 留下的第一張，否則 `heitor-1889`） |
| `mini-macau-oldmaps-opacity` | 歷史地圖不透明度（0.2–1） | 0.85 |
| `mm-oldmaps-legend-open` | HISTORICAL MAPS 圖例子列展開 | 開 |
| `mini-macau-carparks-on` | P 總開關 | 關 |
| `mini-macau-waste-on` | WASTE 總開關 | 關 |
| `mini-macau-waste-types` | 隱藏的垃圾回收子類型（十二選，key 為 type id） | 回收類預設隱藏：`smart_machine`、`three_colour`、`e_waste`、`lamp_battery`、`glass`、`clothing`、`eco_station`；垃圾房、壓縮式垃圾收集點、垃圾站、處理設施、污水處理廠預設顯示 |
| `mini-macau-waste-types-seen` | 這個瀏覽器已經套用過的預設隱藏列 id；之後新增的預設隱藏列（例如第三輪的玻璃樽／衣物）對舊訪客也會先隱藏一次，訪客自己切過的不動 | 無（第一次載入時寫入） |
| `mini-macau-water-on` | WATER 總開關 | 關 |
| `mini-macau-power-on` | POWER 總開關 | 關 |
| `mini-macau-public-housing-on` | HOUSING（居屋）總開關 | 關 |
| `mini-macau-public-housing-types-off` | 關掉的居屋型別（JSON 陣列；存「關」而不是「開」，之後新增的型別對舊訪客預設可見；舊的 `-types-on` 下次儲存時移除） | 無（全開） |
| `mm-public-housing-legend-open` | HOUSING 圖例子列展開 | 開 |
| `mini-macau-parishes-on` | PARISHES（堂區）總開關 | 關 |
| `mini-macau-grandprix-on` | GRAND PRIX 總開關 | 關 |
| `mini-macau-time-bar` | 時間軸展開/收合（`0` = 收合） | 展開 |
| `mini-macau-theme` | 深色／淺色主題（[`src/theme.ts`](../../src/theme.ts)） | `dark` |

**圖層組合（2026-09-20 起，取代舊的專注模式）**：每個城市與交通圖層都是獨立開關，開或關一個圖層只改它自己，不會收起、也不會事後還原其他圖層；舊版 `src/focusMode.ts` 的快照、互斥與豁免規則已全部移除，舊的 `mini-macau-*-focus-snapshot` 不再讀寫。需要清掉雜訊時用明確的一次性動作 **單獨顯示**（`t.layerShowOnly`）：App 的 `isolateCityLayer` 呼叫 [`src/layerVisibility.ts`](../../src/layerVisibility.ts) 的 `showOnlyCityLayer`，關掉全部交通圖層（LRT、巴士含自動模式、航班、渡輪）與其他城市圖層，只留選中的那一層；之後使用者再開任何圖層都不會被覆蓋，也沒有「還原」。桌面在城市列的說明行、手機在詳情頁卡片提供這個動作。地圖端由 `MapView` 的 `applyNetworkVisibility` 依各自開關切換共用 source 的 layer（供水／供電網、巴士路線、LRT 車站），換底圖後重套一次。

**時間控制只跟交通圖層走**：`hasTransport = lrtOn.size > 0 || visibleRoutes.size > 0 || isAutoMode || flightsOn || ferriesOn`（[`App.tsx`](../../src/App.tsx)）。有任一交通圖層開著才顯示上方時鐘與下方播放控制，Space 快捷鍵也只在這時作用；全部交通圖層關掉時兩者都隱藏，倍速重設為 1×，但使用者選的模擬時間與時間軸展開偏好都保留。判斷看的是圖層是否開啟，不是當下有沒有車——開著但這個時段沒有班次的服務仍需要時間控制。城市圖層（包括沒有時間維度的歷史地圖、居屋、供水、供電、垃圾回收）不影響時鐘；大賽車的車雖然跟著模擬時鐘跑，但它也不算交通圖層。

**HISTORICAL MAPS（歷史地圖，2026-09-23 前稱「古地圖」）**是一般的獨立圖層，放在「城市專題」組第一列，可與任何城市或交通圖層疊加（2026-09-18 到 09-20 之間它曾是保留宗教的專注模式，已隨專注模式一起移除）。一次只畫一個選項列，見本文最後的單選面板一節。**古地圖放大會變清楚（瓦片金字塔，2026-09-19）**：`old-maps.json` 裡有 `tiles` 的圖版（最早是 1796、1889、1893；現在 15 筆裡只有 1792 仍是單張圖）不再是一張 `image` source，而是 raster 瓦片 source——[`src/oldMaps.ts`](../../src/oldMaps.ts) 的純函式 `oldMapSourceSpec(map, origin)` 決定交給 `addSource` 的內容：有 `tiles` 就是 `{ type: 'raster', tiles: [origin + url], tileSize: 512, minzoom, maxzoom, bounds }`，沒有就是原本的 `{ type: 'image', url, coordinates }`；`syncOldMapLayers` 只是呼叫它，raster 圖層本身（`raster-opacity`、`raster-fade-duration: 0`、插在 `3d-buildings` 之下）完全沒變，所以透明度滑桿與地圖選擇都不用改。瓦片 URL 用 `window.location.origin` 補成絕對路徑：樣板字串不能過 `new URL`（大括號會被跳脫），而根相對路徑只有在請求剛好由主執行緒發出時才安全。`bounds` 讓 MapLibre 只要格網內的瓦片，建置腳本又保證格網內每一塊都存在（空的是透明瓦片），所以不會有 404 觸發地圖的 error 事件。超過 `maxzoom`（各圖 z14–z17，由建置腳本依掃描解析度決定）之後就是最高一級瓦片放大，低於 `minzoom`（z9，圖版只剩約 20 px 寬）不畫。對顯存是好事：以前每張開著的圖版都是一整張常駐貼圖（1796 那張 2655×3205 約 34 MB），現在總覽（z12.6）每張圖只有 4–9 塊 512 px 瓦片，放大到舊城區 z17.3 是 12 塊、傾斜 50° 是 33 塊（遠處自動用低一級的瓦片）。2D 相容模式（`RasterMapFallback`）照舊用單張 `plate.image`，那是給弱裝置的路徑。瀏覽器實測（背景分頁走真實程式路徑）：三個 source 都是 raster、瓦片狀態全部 `loaded`、0 個 `errored`、沒有地圖 error 事件；1889 的空白角落（透明瓦片）與 z12.6 總覽三張疊放都正常。**古地圖上的 3D 建築**（2026-09-19，使用者從樣稿選了「紙色半透明」）：底圖的 `3d-buildings` 平常是主題色的近實心方塊（深色 `#2a2d33`／淺色 `#d8d8dc`，不透明度 0.85），深色方塊壓在米色的圖上會把舊城區——古地圖上資訊最密的地方——整片蓋掉。所以只要有任何一張古地圖正在畫（`transitData.oldMaps.length > 0`，2026-09-23 起一次只畫一個選項列（1912 地圖集那列是三張），總開關開著就一定有圖），建築就換成紙色 `#e9dfc8`、不透明度 0.5 的「白模」：今日的城市還讀得出體積，底下刻的街道與岸線也透得出來。兩個主題用同一組值，因為建築底下都是同一張米色的圖。規則是 [`src/oldMaps.ts`](../../src/oldMaps.ts) 的純函式 `basemapBuildingsPaint(dark, overOldMap)`（有測試），`MapView` 的 `syncOldMapLayers` 在同步圖版的同時 `setPaintProperty` 建築的顏色與不透明度（值沒變時 MapLibre 會直接略過），`addCustomLayers` 建立建築圖層時也用同一個函式取初值，所以開著古地圖切主題（整個 `setStyle`）不會先閃一下灰色。樣稿比過而沒採用的：維持深色實心（蓋住圖）、深灰半透明（把圖壓成灰霧）、完全隱藏、只留貼地輪廓線、紙色實心。圖版範圍以外的建築（例如只開 1889 時的氹仔）也會一起變成紙色半透明，疊在深色底圖上是偏灰的米色，可以接受。圖層列與卡片的說明是 `t.oldMapsLayerNote`（「對照不同年代，可疊加城市與交通圖層」）。

WATER 開啟時列下方會展開一個靜態圖例（`WaterKey`，手機版在 WATER modal 內）：設施類型（水廠、水塘、高位水池、原水泵站、泵站、約略位置空心水滴）與管線（原水管深藍虛線、淨水管淺藍實線、示意直線灰虛線——只在資料有 `fallback` 管段時出現、配水管網細線、珠海原水輸入口圖示），標題註明「管網為示意」。它是獨立區塊，不影響上下各列的欄位對齊。面板會標示營運者：澳門自來水設施，或黑沙水庫的「政府原水水庫（海事及水務局）· 非自來水公司設施」，並列出該設施接了幾條示意管線；點珠海原水輸入口開的是 `WaterInletInfoPanel`。配水路網（`water-distribution.json`，約 550 KiB）由 `useWaterDistribution` 在第一次開 WATER 時才抓一次，之後開關不再重抓。

WORKS 預設開、SCHOOLS/WC/P 預設關：道路工程改道是大家都想看的即時資訊，後三層是空間密度高的靜態圖層（全開會蓋掉地圖），留給想找的人自己開。歷史地圖、居屋、堂區、宗教、供水、供電、垃圾回收與大賽車同樣預設關：它們是給想看某個主題的人疊上去的，一進站就全部疊在交通圖層上只會互相蓋住。

## 車輛追蹤鏡頭

點任一車輛 → MapView 把該車設為 `trackedVehicleId`，之後每 sim tick 把鏡頭 `easeTo` 到該車位置。

要點：

- **保留 zoom / pitch / bearing**：tracking 期間 user 還是能 pinch zoom / 旋轉，鏡頭只追位置不搶其他控制。
- **車輛離開模擬時自動取消**：`commit e567a5f` 處理過 — 如果 tracked vehicle 不在當下的 `vehicles[]` 裡，清掉 selection。

## DateTimePicker / 時間軸

時間控制有兩條入口：

- **`<TimeDisplay>`** 一行 HH:mm，點擊開 `<DateTimePicker>` 浮層。
- **時間軸（time bar）**：localStorage key `mini-macau-time-bar` 記憶展開/收合。

兩者都只在有交通圖層開著時出現（見上面「時間控制只跟交通圖層走」）。

按 spacebar = pause/play（焦點在輸入框、按鈕等控制項上時不作用）、Esc = 切換漢堡選單、`syncToNow()` = 跳回 live。詳見 [`useSimulationClock.ts`](../../src/hooks/useSimulationClock.ts)。

## ServiceStatus integration

[`useServiceStatus.ts`](../../src/hooks/useServiceStatus.ts) 從 `/service-status.json` 拿當天停駛路線清單（由 [07-ci-and-data-sync.md](07-ci-and-data-sync.md) 的 `service-status.yml` 每天 23:00 UTC（澳門 07:00）產生，另有兩次補跑）。

UI 用法：把 `inactive: Set<string>` 拿來 dim 對應路線（透過 [08-performance-notes.md](08-performance-notes.md) 第 2 節提到的 `setFeatureState`），讓使用者一眼看出哪些路線今天有狀況。

## 主題切換

[`src/theme.ts`](../../src/theme.ts) 是一個小的 external store：把 `dark`／`light` 存進 `mini-macau-theme`，在 `<html>` 寫 `data-theme`（面板的 `--mm-*` 色票跟著換），MapView 訂閱它並以 `map.setStyle()` 換 CARTO Dark Matter／Positron。屬性在模組載入時就寫好，所以存了淺色主題的人重新整理不會先閃一下深色。

## Analytics

[`src/analytics/ga.ts`](../../src/analytics/ga.ts)。GA4 透過 `gtag.js`，只記匿名使用事件（語言切換、模擬倍率變更、time jump 距離、追蹤車輛 type）。`startEngagementTracker()` 在 [App.tsx:210](../../src/App.tsx) 啟動，會用 `document.visibilitychange` + idle timer 判定有效互動時長。

## 鍵盤捷徑

| 鍵 | 行為 |
|----|------|
| `Space` | Toggle pause（只在有交通圖層開著時） |
| `Esc` | Toggle 漢堡選單 |
| 點車輛 | Track 該車 |
| 再點同車 | 取消 track |

## 加新語言的工作量

1. `i18n.tsx`：擴 `Lang` union、加 `LANG_CYCLE`、加 `HTML_LANG_TAG`。
2. 在 `translations` 物件加完整一份新語言的 entry（function value 也要包到）。
3. `index.html` 的 hreflang 加新 entry。
4. 確保所有 station / route / flight 資料 JSON 有對應語言欄位（目前 `namePt` 是 optional，runtime fall back 到 English）。

**2026-09-23 歷史地圖單選面板**：桌面與手機共用 `OldMapControls`：不透明度滑桿在最上，選項依 18／19／20 世紀分組，每列是原生 radio（方向鍵可切換），一次只畫一張；副標與「圖說與來源」只在選中列展開。選擇存於 `mini-macau-oldmaps-selected`，由 `resolveOldMapSelection` 決定（沿用已存選擇 → 舊 hidden 集合留下的第一張 → `heitor-1889` → 第一列），`selectOldMaps` 取出該列的全部圖版。

**2026-09-23 手機歷史地圖介面**：`OldMapSwitcher`（`src/components/OldMapSwitcher.tsx`）是手機專用的地圖上年代切換鍵「‹ 年份 名稱 ›」：左右箭頭依年代順序切到上一張／下一張（1912 地圖集算一站，首尾停用），點中間直接打開圖層面板的歷史地圖頁（LineLegend 的 `setMobilePanel('oldmaps')`）。只在 `oldMapsOn`、已有選中圖且面板關閉時顯示，`sm:hidden landscape:block` 與其他手機介面相同。沒有交通圖層時停在底部時間列的位置（`bottom: 40px + safe area`）；有交通圖層、時間列占用底部時（App 傳入 `timeBarShown={hasTransport}`）改停在頂部第二排（`top: 64px`，右側讓出縮放鍵），不會與時間列、資訊面板或安裝提示（168 px）重疊。手機詳情頁的歷史地圖改用精簡標頭（`MobileCityDetail` 的 `current`），以目前地圖的年份與名稱取代固定的「1/N」，說明文字移到標頭的 title；共用的開關卡片列高收緊（54／46 px）。選中列的副標與「圖說與來源」同一行，觸控裝置不再殘留 hover 底色，「圖說與來源」點擊高度 44 px。

**2026-09-23 輕軌、海空一鍵開關**：比照巴士，輕軌與海空也有「全部顯示／全部隱藏」。桌面：輕軌標題下一排兩鍵；航班與渡輪上方新增「AIR + SEA · 海空」標題（顯示 n/2）與同樣兩鍵。手機：輕軌控制台與海空頁標題下各一排（共用 `.mm-mobile-all-actions`，樣式同巴士那排），輕軌軌道最小高度改為 170 px 讓控制台仍一頁放得下。App 的 `setAllLrt(on)` 一次設定全部輕軌線，`setAirSea(on)` 同時設定航班與渡輪，GA 事件為 `layer_toggled` 的 `lrt_all`／`air_sea`。手機「全部顯示／全部隱藏」的文字 key 由 `mobileBusShowAll`／`mobileBusHideAll` 改名為通用的 `mobileShowAll`／`mobileHideAll`。
