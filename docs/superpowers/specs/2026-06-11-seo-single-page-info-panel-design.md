# 單頁 SEO 強化 — 靜態資訊面板設計

- **日期**:2026-06-11
- **狀態**:已與使用者確認設計,待實作
- **範圍**:`index.html`、`vite.config.ts`(新增 plugin)、`src/components/LineLegend.tsx`(選單入口一行)、新增 plugin 原始碼與測試

## 背景與目標

Mini Map Macau 是單一 URL 的全螢幕 WebGL SPA(`html/body/#root` 皆 `overflow: hidden`,所有 UI 為浮層)。`index.html` 的 SEO 基礎已完整(title、description、canonical、hreflang、OG、Twitter Card、WebApplication JSON-LD、noscript、robots.txt、sitemap.xml),但頁面渲染後**幾乎沒有可被索引的文字內容**——整個 app 沒有任何 `<h1>`,「澳門 25B 巴士路線」「輕軌氹仔線 時間表」「媽閣站」這類長尾搜尋沒有任何文字可以對應。

本設計在**不新增 URL** 的前提下,為現有單頁補上可索引的靜態內容。

### 已確認的四個決策

| 決策點 | 結論 |
|---|---|
| 目標 | 強化現有單頁(不做多 URL 預渲染頁) |
| 呈現方式 | 資訊面板:靜態 HTML 寫在 `index.html`、`#root` 之外,預設隱藏,從選單打開 |
| 語言策略 | 三語分頁籤(繁中/EN/PT),全部內容靜態存在於 HTML |
| 清單產生 | Build-time 注入:Vite plugin 於 `transformIndexHtml` 讀資料 JSON 渲染 |

### 非目標(YAGNI)

- 不做每路線/每車站的獨立 URL 預渲染頁(留待未來)
- 不改 noscript 區塊、既有 WebApplication JSON-LD、robots.txt、sitemap.xml
- 不做 SSR/prerender 框架引入
- 不處理站外 SEO(Search Console、反向連結)

## 架構

```
index.html
├─ <head>
│   ├─ 既有 meta / JSON-LD(不動)
│   └─ 新增 FAQPage JSON-LD(內容與可見 FAQ 一致)
└─ <body>
    ├─ <div id="root">(React app,不動)
    ├─ <aside id="site-info" hidden>   ← 新增:靜態資訊面板
    │   ├─ 語言分頁籤(繁中 / EN / PT)
    │   ├─ 每語言區塊 ×3:h1*/簡介、各節說明、FAQ
    │   ├─ 共用區塊 ×1:輕軌車站表(三語並列)、巴士路線清單、渡輪航線
    │   │   └─ 由 <!-- %SEO_TRANSIT_LISTS% --> 佔位符在 build 時注入
    │   └─ 關閉鈕
    ├─ 既有 noscript(不動)
    └─ inline <script>:面板開關 + 分頁切換(數十行 vanilla JS,不進 React bundle)

plugins/seo-content/
├─ render.ts        ← 純函式 renderTransitLists(data): string(可單測)
├─ index.ts         ← Vite plugin:讀 public/data/*.json → zod 驗證 → 替換佔位符
└─ render.test.ts   ← vitest

src/components/LineLegend.tsx
└─ 選單新增「關於 / About」項目 → window 事件或 getElementById toggle(耦合僅此)
```

註:`<h1>` 僅在預設語言(繁中)區塊使用一次,EN/PT 區塊用 `<h2>`/`<p class="...">` 呈現同等標題文字,避免一頁多個 `<h1>`。

## 各部分細節

### 1. 面板內容章節

1. **標題與簡介** — `<h1>Mini Map Macau · 澳門公共交通 3D 即時模擬地圖</h1>` + 介紹段(模擬性質、涵蓋輕軌/巴士/渡輪/航班、RT 模式說明)
2. **輕軌一覽** — 3 條線(氹仔線/石排灣線/橫琴線)各列車站;車站以單一表格三語並列(`nameCn` / `name` / `namePt`,來自 `stations.json`),三個語言分頁共用
3. **巴士路線一覽** — 91 條路線按 `routeGroups.ts` 分組(半島/跨海/氹仔路環/夜間/特班),每條列「路線號(`name`)+ 中文起訖點(`nameCn`)」;資料無英/葡起訖點名,三語共用此清單
4. **渡輪航線** — 由 `ferry-schedules.json` 的 `routes` 渲染起訖港口(欄位以 `dataSchemas.ts` 的 `FerryScheduleFileSchema` 為準)
5. **機場航班** — 固定說明文字(每語言一份),不列航班明細(資料每日變動、對 SEO 無長尾價值)
6. **FAQ** — 8 題(見下),每語言一份
7. **資料來源與聲明** — DSAT、AviationStack、TurboJET/CotaiJet 時刻表等來源;「非官方網站、時刻表驅動模擬」免責

### 2. 三語分頁籤

- 面板頂部三個 tab 按鈕(繁中/EN/PT),inline vanilla JS 切換 `data-lang` / class,僅顯示選中語言的 per-language 區塊;共用區塊(車站表、路線清單、渡輪)永遠顯示
- 預設語言:讀取 app 既有的語言 localStorage key `mm_lang`(值為 `'zh' | 'pt' | 'en'`,見 `src/i18n.tsx`);無或值非法則預設繁中(`'zh'`)
- 所有三語內容皆存在於原始 HTML(隱藏用 CSS),爬蟲全部可讀;per-language 區塊以 `lang="zh-Hant" / "en" / "pt"` 屬性標注

### 3. 開啟入口與互動

- index.html 的 inline script 定義 `window.miniMacauInfo = { open(), close() }`;`LineLegend` 漢堡選單新增「關於 / About」項目,點擊呼叫 `window.miniMacauInfo?.open()`(React 端耦合僅此一行 + 一個 `declare global` 型別)
- 面板為全螢幕 overlay:`role="dialog"`、`aria-modal="true"`、`aria-labelledby` 指向標題;右上關閉鈕、Esc 關閉、點背景關閉
- 面板內部可捲動(`overflow-y: auto`),不影響 `body` 的 `overflow: hidden` 模型
- 樣式沿用現有視覺:深色底(`#0a0a0a` 系)、`mm-han`/`mm-mono` 字型 class、與既有面板一致的邊框/圓角;面板樣式寫在 `index.html` 內的 `<style>` 區塊,與靜態面板內聚(不進 `src/index.css`,確保無 JS/無 React 時面板仍完整可用)

### 4. Build-time 注入(Vite plugin)

- `plugins/seo-content/index.ts` 匯出 Vite plugin,`transformIndexHtml` hook:
  1. 讀 `public/data/bus-routes.json`、`stations.json`、`lrt-lines.json`、`ferry-schedules.json`
  2. 以 `src/dataSchemas.ts` 的對應 zod schema 驗證(重用 `parseData`)
  3. 以 `src/routeGroups.ts` 的 `getRouteGroup` / `GROUP_ORDER` 分組
  4. 呼叫 `renderTransitLists(data)` 產生 HTML 字串,替換 `<!-- %SEO_TRANSIT_LISTS% -->`
- `renderTransitLists` 為純函式,所有插值經 HTML escape
- dev server 同樣生效(`transformIndexHtml` 於 dev 也會執行),開發所見即所得
- 分組標題等 UI 字串由 plugin 自帶小型三語字典(不 import `i18n.tsx`,避免把 React/JSX 拉進 build 設定)
- 資料 bot 每次 commit 已會觸發 deploy 重 build(見 `.github/workflows/deploy.yml`),清單自動與資料同步

**錯誤處理**:資料缺檔或 zod 驗證失敗時,plugin 直接 throw 使 build 失敗(與現有「資料先驗證再上線」的 CI 哲學一致),不靜默產出空清單。

### 5. 結構化資料

- `<head>` 新增一個 `FAQPage` JSON-LD `<script>`,Question/Answer 與可見 FAQ 文字一致(以繁中版為準)
- 已知限制:2023 年後 Google 的 FAQ rich result 幾乎僅展示於政府/醫療網站,**不期待**搜尋結果出現 FAQ 摺疊;價值在於關鍵字相關性與 AI 搜尋引擎(LLM crawler)對網站的理解
- 既有 WebApplication JSON-LD 不動

### 6. FAQ 題目(繁中版定稿,EN/PT 實作時翻譯)

1. 這是即時數據嗎?——時刻表驅動模擬;巴士可開啟 RT 模式使用 DSAT 即時數據
2. 如何查詢巴士或輕軌的到站時間?——點車站/車輛看 ETA
3. 澳門輕軌有哪些路線和車站?——3 線 15 站,點名列出
4. 網站支援哪些語言?——繁中/英/葡
5. 資料來源是什麼?——DSAT、AviationStack、船公司時刻表等
6. 手機可以使用嗎?需要安裝 App 嗎?——響應式網頁,免安裝
7. 為什麼有些巴士路線沒有顯示?——預設 auto 模式只顯示營運中路線,可手動開啟
8. 這是澳門政府的官方網站嗎?——否,個人專案,附官方連結

### 7. 效能與 SEO 風險評估

- 新增 HTML 估 25–35 KB(gzip 後 6–9 KB):純文字、無圖片、預設 `hidden`,不參與首屏 layout/paint,LCP/CLS 不受影響
- 隱藏內容屬 tab/accordion 模式:mobile-first indexing 下 Google 正常計入權重;內容使用者可從選單開啟,**無 cloaking 疑慮**
- 一頁僅一個 `<h1>`(繁中區塊);EN/PT 同等標題不用 h1
- inline script 數十行,無外部依賴,不影響既有 GA/字型載入時序

### 8. 測試

- **單元測試**(`plugins/seo-content/render.test.ts`,vitest):
  - 91 條路線號全數出現於輸出
  - 分組順序與歸屬符合 `GROUP_ORDER` / `getRouteGroup`
  - 15 站三語名稱皆出現
  - 含特殊字元的名稱正確 HTML escape
- **Build 驗證**:`npm run build` 後 `dist/index.html` 不含佔位符、包含注入清單(測試或手動 grep)
- **手動驗證**(preview):選單開面板、三 tab 切換、Esc/背景關閉、面板內捲動;手機視口檢查
- **結構化資料**:Google Rich Results Test 驗 FAQPage 無錯誤
- **回歸**:`npm run lint`、`npm test`、Lighthouse 確認 LCP/CLS 無退步
