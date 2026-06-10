# SEO 單頁強化(靜態資訊面板)實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不新增 URL 的前提下,為單頁 WebGL app 加入爬蟲可讀的靜態資訊面板(h1+簡介、輕軌/巴士/渡輪清單、三語 FAQ、FAQPage JSON-LD),清單由 Vite plugin 於 build 時自資料 JSON 注入。

**Architecture:** 靜態面板 HTML 寫死在 `index.html`(`#root` 之外,預設 `hidden`,inline vanilla JS 控制開關與三語分頁);路線/車站清單由新 plugin `plugins/seo-content/` 在 `transformIndexHtml` 讀 `public/data/*.json`、以 `src/dataSchemas.ts` 的 zod schema 驗證、用 `src/routeGroups.ts` 分組後替換佔位符;React 端僅在 `MapView.tsx` 抽屜加一個 DrawerRow 呼叫 `window.miniMacauInfo?.open()`。

**Tech Stack:** Vite 8(transformIndexHtml hook)、zod 4、vitest 4、React 19(僅一行入口)、vanilla JS/CSS(面板本體)。

**規格文件:** `docs/superpowers/specs/2026-06-11-seo-single-page-info-panel-design.md`

**與規格的三處實作勘誤**(Task 0 會把這些改回規格文件):
1. 漢堡選單抽屜實際位於 `src/components/MapView.tsx`(規格誤寫 LineLegend)。
2. 佔位符改用 `<!-- SEO:TRANSIT_LISTS -->`(不含 `%`):Vite 會把 index.html 中的 `%VAR%` 當 env 變數替換並對未定義者發出警告。
3. plugin 不重用 `parseData`(其失敗路徑讀 `import.meta.env.DEV`,在 node/vite.config 執行環境會拋 TypeError),改直接用 zod schema `safeParse` 並一律 throw 使 build 失敗。

另一處實作簡化(不改規格):規格的「機場航班——固定說明文字(每語言一份)」由各語言簡介段內的航班描述滿足,不另設獨立 `<h2>` 章節(獨立章節只會重複簡介的一句話)。

---

## 背景知識(給零上下文的執行者)

- 專案是 Vite + React 19 SPA,`npm run build` = `tsc -b && vite build`;`npm test` = `vitest run`;`npm run lint` = `eslint .`。
- `tsc -b` 走 project references:`tsconfig.app.json`(include `src`,types `vite/client`)與 `tsconfig.node.json`(include 僅 `vite.config.ts`,types `node`)。新的 `plugins/` 目錄由 vite.config.ts import,**必須**加進 `tsconfig.node.json` 的 include;且因其傳遞性 import `src/dataSchemas.ts`(內含 `import.meta.env`),node 專案的 types 需加 `vite/client`。
- 兩個 tsconfig 都開 `strict`、`verbatimModuleSyntax`(type-only import 必須寫 `import type`)、`noUnusedLocals`。
- `public/data/` 的 JSON 由排程 bot 更新,每次資料 commit 會觸發 `.github/workflows/deploy.yml` 重新 build + 部署,因此 build-time 注入的清單會自動保持同步。
- 現有資料形狀(欄位)以 `src/dataSchemas.ts` 為準:`BusRoutesSchema`(91 條,`name` 為路線號、`nameCn` 為「關閘 - 媽閣」式起訖點)、`StationsSchema`(15 站,`name`/`nameCn`/`namePt?`)、`LRTLinesSchema`(3 線)、`FerryScheduleFileSchema`(`routes[].nameZh/nameEn/journeyMinutes`)。
- 語言偏好存 `localStorage['mm_lang']`,值 `'zh' | 'pt' | 'en'`(見 `src/i18n.tsx:24`)。
- Esc 鍵已被 `MapView.tsx`(`window.addEventListener('keydown', …)` bubble phase)用於切換選單;面板的 Esc 處理需掛 **capture** phase 並在面板開啟時 `stopPropagation()`,避免關面板時順帶開選單。
- 不要把 Tailwind class 用在 build-time 注入的 HTML 上(Tailwind 掃描的是源碼,不保證看得到注入後的 class);面板一律用自帶 `<style>` 的 `si-*` class。

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `plugins/seo-content/render.ts` | 新增 | 純函式 `renderTransitLists(data): string`,無 I/O,可單測 |
| `plugins/seo-content/render.test.ts` | 新增 | vitest 單元測試(真實資料 + 合成資料) |
| `plugins/seo-content/index.ts` | 新增 | Vite plugin:讀檔 → zod 驗證 → 替換佔位符 |
| `vite.config.ts` | 修改 | 掛上 `seoContentPlugin()` |
| `tsconfig.node.json` | 修改 | include 加 `plugins`,types 加 `vite/client` |
| `src/routeGroups.ts` | 修改 | `getRouteGroup` 參數放寬為 `Pick<BusRoute, 'id'>` |
| `index.html` | 修改 | 面板 `<aside>` + `<style>` + inline script + FAQPage JSON-LD + 佔位符 |
| `src/i18n.tsx` | 修改 | 新增 `about` 翻譯 key(3 語言 + interface,共 4 處) |
| `src/components/MapView.tsx` | 修改 | 抽屜加「關於」DrawerRow + `declare global` |
| `docs/superpowers/specs/2026-06-11-seo-single-page-info-panel-design.md` | 修改 | Task 0 勘誤 |

---

### Task 0: 規格勘誤

**Files:**
- Modify: `docs/superpowers/specs/2026-06-11-seo-single-page-info-panel-design.md`

- [x] **Step 1: 修正規格文件中的三處與實作不符**

對規格檔做三個替換:

1. 把架構圖與細節中的佔位符 `<!-- %SEO_TRANSIT_LISTS% -->`(兩處)全部改為 `<!-- SEO:TRANSIT_LISTS -->`,並在「Build-time 注入」一節末尾加一行:
   > 註:佔位符不用 `%…%` 語法,避免 Vite 內建的 index.html env 變數替換(`%VAR%`)發出未定義警告。
2. 「以 `dataSchemas.ts` 的對應 zod schema 驗證(重用 `parseData`)」改為「以 `dataSchemas.ts` 的對應 zod schema 以 `safeParse` 驗證(不重用 `parseData`:其失敗路徑讀 `import.meta.env.DEV`,在 node 環境執行會拋 TypeError)」。
3. 全文把選單入口所在的 `LineLegend` / `LineLegend.tsx` 改為 `MapView`/`MapView.tsx`(漢堡選單抽屜實際在 MapView;範圍表格那行也要改)。

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-11-seo-single-page-info-panel-design.md
git commit -m "docs: errata for SEO info panel spec (MapView entry, placeholder syntax, safeParse)"
```

---

### Task 1: `renderTransitLists` 純渲染函式(TDD)

**Files:**
- Create: `plugins/seo-content/render.ts`
- Create: `plugins/seo-content/render.test.ts`
- Modify: `src/routeGroups.ts:20`

- [x] **Step 1: 放寬 `getRouteGroup` 參數型別**

`src/routeGroups.ts` 只用到 `route.id`,把簽名改成可接受最小物件(現有呼叫端傳完整 `BusRoute`,不受影響):

```ts
export function getRouteGroup(route: Pick<BusRoute, 'id'>): GroupKey {
```

- [x] **Step 2: 寫失敗測試**

建立 `plugins/seo-content/render.test.ts`,內容如下(完整檔案):

```ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderTransitLists, type SeoTransitData } from './render'

function loadJson(rel: string): unknown {
  const p = fileURLToPath(new URL(`../../public/data/${rel}`, import.meta.url))
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

type RawRoute = { id: string; name: string; nameCn: string }
type RawStation = { id: string; name: string; nameCn: string; namePt?: string }
type RawLine = { id: string; name: string; nameCn: string; namePt?: string; stations: string[] }
type RawFerryFile = { routes: Array<{ nameZh: string; nameEn: string; journeyMinutes: number | null }> }

function realData(): SeoTransitData {
  const ferry = loadJson('ferry-schedules.json') as RawFerryFile
  return {
    busRoutes: loadJson('bus-routes.json') as RawRoute[],
    stations: loadJson('stations.json') as RawStation[],
    lrtLines: loadJson('lrt-lines.json') as RawLine[],
    ferryRoutes: ferry.routes,
  }
}

describe('renderTransitLists', () => {
  it('lists every bus route number and Chinese endpoints', () => {
    const data = realData()
    const html = renderTransitLists(data)
    for (const r of data.busRoutes) {
      expect(html).toContain(`>${r.name}</`)
      expect(html).toContain(r.nameCn)
    }
  })

  it('renders bus groups in GROUP_ORDER order', () => {
    const html = renderTransitLists(realData())
    const labels = ['澳門半島', '跨海路線', '氹仔/路氹', '夜間巴士', '特班/特定服務']
    const positions = labels.map(l => html.indexOf(l))
    for (const pos of positions) expect(pos).toBeGreaterThan(-1)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
  })

  it('lists every LRT station with Chinese and English names', () => {
    const data = realData()
    const html = renderTransitLists(data)
    for (const s of data.stations) {
      expect(html).toContain(s.nameCn)
      expect(html).toContain(s.name)
    }
    for (const line of data.lrtLines) {
      expect(html).toContain(line.nameCn)
      expect(html).toContain(line.name)
    }
  })

  it('lists every ferry route in both languages', () => {
    const data = realData()
    const html = renderTransitLists(data)
    for (const f of data.ferryRoutes) {
      expect(html).toContain(f.nameZh)
      expect(html).toContain(f.nameEn)
    }
  })

  it('escapes HTML in all interpolated fields', () => {
    const data: SeoTransitData = {
      busRoutes: [{ id: 'X1', name: '<script>', nameCn: 'a & "b"' }],
      stations: [{ id: 'S', name: '<i>', nameCn: '站', namePt: "p'" }],
      lrtLines: [{ id: 'L', name: '<line>', nameCn: '線', stations: ['S'] }],
      ferryRoutes: [{ nameZh: '航<線>', nameEn: 'Route & Co', journeyMinutes: 60 }],
    }
    const html = renderTransitLists(data)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<i>')
    expect(html).not.toContain('<line>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; &quot;b&quot;')
    expect(html).toContain('航&lt;線&gt;')
  })

  it('shows Portuguese station name only when it differs from English', () => {
    const data: SeoTransitData = {
      busRoutes: [],
      stations: [
        { id: 'A', name: 'Barra', nameCn: '媽閣', namePt: 'Barra' },
        { id: 'B', name: 'Ocean', nameCn: '海洋', namePt: 'Oceano' },
      ],
      lrtLines: [{ id: 'L', name: 'Test Line', nameCn: '測試線', stations: ['A', 'B'] }],
      ferryRoutes: [],
    }
    const html = renderTransitLists(data)
    expect(html).toContain('海洋 Ocean / Oceano')
    expect(html).toContain('媽閣 Barra')
    expect(html).not.toContain('Barra / Barra')
  })
})
```

- [x] **Step 3: 跑測試確認失敗**

Run: `npx vitest run plugins/seo-content/render.test.ts`
Expected: FAIL — `Cannot find module './render'`(或同義的解析錯誤)

- [x] **Step 4: 實作 `render.ts`**

建立 `plugins/seo-content/render.ts`(完整檔案):

```ts
// Renders the crawlable transit lists injected into index.html at build
// time (see ./index.ts). Pure string-in/string-out so it can be unit
// tested without touching the filesystem or Vite.
//
// Output uses only `si-*` classes styled by the inline <style> block in
// index.html — never Tailwind classes, which are only generated for
// class names visible in source files, not build-time-injected HTML.
import { getRouteGroup, GROUP_ORDER, type GroupKey } from '../../src/routeGroups'

export interface SeoTransitData {
  busRoutes: Array<{ id: string; name: string; nameCn: string }>
  stations: Array<{ id: string; name: string; nameCn: string; namePt?: string }>
  lrtLines: Array<{ id: string; name: string; nameCn: string; namePt?: string; stations: string[] }>
  ferryRoutes: Array<{ nameZh: string; nameEn: string; journeyMinutes: number | null }>
}

// The lists are shared across the three language tabs, so labels carry
// Chinese + English inline instead of being swapped per language.
const GROUP_LABELS: Record<GroupKey, string> = {
  peninsula: '澳門半島 · Peninsula',
  crossHarbour: '跨海路線 · Cross-Harbour',
  taipaCotai: '氹仔/路氹 · Taipa & Cotai',
  night: '夜間巴士 · Night',
  special: '特班/特定服務 · Special',
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function stationLabel(s: { name: string; nameCn: string; namePt?: string }): string {
  const pt = s.namePt && s.namePt !== s.name ? ` / ${esc(s.namePt)}` : ''
  return `${esc(s.nameCn)} ${esc(s.name)}${pt}`
}

function renderLrt(data: SeoTransitData): string {
  const byId = new Map(data.stations.map(s => [s.id, s]))
  const lines = data.lrtLines.map(line => {
    const pt = line.namePt && line.namePt !== line.name ? ` / ${esc(line.namePt)}` : ''
    const items = line.stations
      .map(id => byId.get(id))
      .filter(s => s !== undefined)
      .map(s => `<li>${stationLabel(s)}</li>`)
      .join('')
    return `<h3>${esc(line.nameCn)} ${esc(line.name)}${pt}</h3><ol class="si-stations">${items}</ol>`
  }).join('')
  return `<section class="si-block" id="si-lrt">
<h2>澳門輕軌路線與車站 · Macau LRT Lines &amp; Stations · Metro Ligeiro de Macau</h2>
${lines}
</section>`
}

function renderBus(data: SeoTransitData): string {
  const groups = new Map<GroupKey, string[]>()
  for (const r of data.busRoutes) {
    const g = getRouteGroup(r)
    const list = groups.get(g) ?? []
    list.push(`<li><b>${esc(r.name)}</b> ${esc(r.nameCn)}</li>`)
    groups.set(g, list)
  }
  const sections = GROUP_ORDER
    .filter(g => (groups.get(g) ?? []).length > 0)
    .map(g => `<h3>${GROUP_LABELS[g]}</h3><ul class="si-routes">${(groups.get(g) ?? []).join('')}</ul>`)
    .join('')
  return `<section class="si-block" id="si-bus">
<h2>澳門巴士路線一覽 · Macau Bus Routes · Autocarros de Macau</h2>
${sections}
</section>`
}

function renderFerry(data: SeoTransitData): string {
  const items = data.ferryRoutes.map(f => {
    const mins = f.journeyMinutes != null
      ? ` — 約 ${f.journeyMinutes} 分鐘 / ~${f.journeyMinutes} min`
      : ''
    return `<li>${esc(f.nameZh)} · ${esc(f.nameEn)}${mins}</li>`
  }).join('')
  return `<section class="si-block" id="si-ferry">
<h2>渡輪航線 · Ferry Routes · Rotas de Ferry</h2>
<ul class="si-ferries">${items}</ul>
</section>`
}

export function renderTransitLists(data: SeoTransitData): string {
  return [renderLrt(data), renderBus(data), renderFerry(data)].join('\n')
}
```

- [x] **Step 5: 跑測試確認通過**

Run: `npx vitest run plugins/seo-content/render.test.ts`
Expected: PASS(6 tests)

注意:此時 `npm run lint` 與 `npm test` 也應通過;`tsc -b` 尚未涵蓋 plugins(Task 2 處理),先不擋。

- [x] **Step 6: Commit**

```bash
git add plugins/seo-content/render.ts plugins/seo-content/render.test.ts src/routeGroups.ts
git commit -m "feat(seo): add pure renderer for crawlable transit lists"
```

---

### Task 2: Vite plugin + 佔位符 + tsconfig

**Files:**
- Create: `plugins/seo-content/index.ts`
- Modify: `vite.config.ts`
- Modify: `tsconfig.node.json`
- Modify: `index.html`(僅加佔位符,先放在 noscript 之後;Task 3 會把它移進面板)

- [x] **Step 1: 建立 plugin**

建立 `plugins/seo-content/index.ts`(完整檔案):

```ts
// Injects crawlable transit lists into index.html at build/dev time.
// Data bots already trigger a rebuild+deploy on every data commit
// (.github/workflows/deploy.yml), so the injected lists can never drift
// from public/data/*.json. Validation failures throw: a malformed data
// file must fail the build, not silently ship an empty list.
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import type { z } from 'zod'
import {
  BusRoutesSchema,
  LRTLinesSchema,
  StationsSchema,
  FerryScheduleFileSchema,
} from '../../src/dataSchemas'
import { renderTransitLists } from './render'

export const SEO_PLACEHOLDER = '<!-- SEO:TRANSIT_LISTS -->'

// Not src/dataSchemas.parseData: its failure path reads import.meta.env.DEV,
// which is undefined when this runs under node (vite.config context).
function parseOrThrow<S extends z.ZodType>(schema: S, raw: unknown, label: string): z.infer<S> {
  const res = schema.safeParse(raw)
  if (!res.success) {
    const summary = res.error.issues
      .slice(0, 5)
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join(' | ')
    throw new Error(`[seo-content] ${label} failed schema validation: ${summary}`)
  }
  return res.data
}

function loadJson(root: string, rel: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(root, rel), 'utf8'))
}

export function seoContentPlugin(): Plugin {
  let root = process.cwd()
  return {
    name: 'seo-content',
    configResolved(config) {
      root = config.root
    },
    transformIndexHtml(html) {
      if (!html.includes(SEO_PLACEHOLDER)) {
        throw new Error(`[seo-content] placeholder ${SEO_PLACEHOLDER} not found in index.html`)
      }
      const busRoutes = parseOrThrow(BusRoutesSchema, loadJson(root, 'public/data/bus-routes.json'), 'bus-routes.json')
      const stations = parseOrThrow(StationsSchema, loadJson(root, 'public/data/stations.json'), 'stations.json')
      const lrtLines = parseOrThrow(LRTLinesSchema, loadJson(root, 'public/data/lrt-lines.json'), 'lrt-lines.json')
      const ferry = parseOrThrow(FerryScheduleFileSchema, loadJson(root, 'public/data/ferry-schedules.json'), 'ferry-schedules.json')
      return html.replace(
        SEO_PLACEHOLDER,
        renderTransitLists({ busRoutes, stations, lrtLines, ferryRoutes: ferry.routes }),
      )
    },
  }
}
```

(dev server 每次重載 index.html 都會重讀 4 個 JSON,其中 bus-routes 約 2.7 MB;這只發生在整頁載入,不在 HMR 熱路徑,可接受,不做快取。)

- [x] **Step 2: 掛進 vite.config.ts**

`vite.config.ts` 加 import 與 plugin:

```ts
import { seoContentPlugin } from './plugins/seo-content'
```

```ts
  plugins: [react(), tailwindcss(), dsatBatchDevPlugin(), seoContentPlugin()],
```

- [x] **Step 3: 更新 tsconfig.node.json**

兩處修改(其餘不動):

```json
    "types": ["node", "vite/client"],
```

```json
  "include": ["vite.config.ts", "plugins"]
```

理由:`plugins/` 被 vite.config import,必須納入 node 專案型別檢查;`vite/client` 提供 `import.meta.env` 型別,因為 plugin 傳遞性 import 了 `src/dataSchemas.ts`。

- [x] **Step 4: 在 index.html 放佔位符**

`index.html` 中 `<div id="root"></div>` 之後加一行(Task 3 會把它移進面板的 `.si-shared` 容器內):

```html
    <!-- SEO:TRANSIT_LISTS -->
```

- [x] **Step 5: 驗證 build 注入**

Run: `npm run build`
Expected: 成功(`tsc -b` 含 plugins 無誤,vite build 完成)

Run(PowerShell): `Select-String -Path dist/index.html -Pattern 'si-bus' -Quiet; Select-String -Path dist/index.html -Pattern 'SEO:TRANSIT_LISTS' -Quiet`
Expected: 第一個輸出 `True`(已注入清單),第二個輸出 `False`(佔位符已被替換)

Run: `npm run lint && npm test`
Expected: 皆 PASS

- [x] **Step 6: Commit**

```bash
git add plugins/seo-content/index.ts vite.config.ts tsconfig.node.json index.html
git commit -m "feat(seo): inject transit lists into index.html at build time"
```

---

### Task 3: index.html 靜態面板(骨架、三語內容、樣式、inline script)

**Files:**
- Modify: `index.html`

- [x] **Step 1: 在 `</head>` 前加入面板樣式**

`index.html` 的 GA `<script>` 之後、`</head>` 之前插入:

```html
    <style>
      /* Site info panel — self-contained styles (si-*). Deliberately not
         Tailwind: the transit lists are injected at build time and Tailwind
         only generates classes it can see in source files. */
      #site-info-backdrop {
        position: fixed; inset: 0; z-index: 80;
        background: rgba(0, 0, 0, 0.65);
      }
      #site-info {
        position: fixed; z-index: 81;
        top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: min(720px, calc(100vw - 24px));
        height: min(85dvh, 900px);
        background: #0b0b0d; color: #eaeaea;
        border: 1px solid rgba(252, 196, 65, 0.25);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.8);
        display: flex; flex-direction: column;
        font-family: 'Noto Sans HK', 'Noto Sans TC', -apple-system, sans-serif;
      }
      #site-info[hidden], #site-info-backdrop[hidden] { display: none; }
      .si-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; border-bottom: 1px solid rgba(252, 196, 65, 0.2);
        flex-shrink: 0;
      }
      .si-tabs { display: flex; gap: 6px; }
      .si-tab {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 11px; letter-spacing: 0.12em;
        padding: 5px 12px; cursor: pointer;
        background: rgba(255, 255, 255, 0.02); color: rgba(255, 255, 255, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      .si-tab[aria-selected="true"] {
        background: rgba(252, 196, 65, 0.1); color: #fde68a;
        border-color: rgba(252, 196, 65, 0.5);
      }
      .si-close {
        width: 30px; height: 30px; cursor: pointer;
        background: transparent; color: rgba(255, 255, 255, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.15); font-size: 13px;
      }
      .si-close:hover { color: #fde68a; border-color: rgba(252, 196, 65, 0.5); }
      .si-scroll { overflow-y: auto; padding: 14px 16px 28px; }
      #site-info h1 { font-size: 18px; line-height: 1.4; color: #fde68a; margin: 0 0 10px; }
      #site-info h2 {
        font-size: 14px; color: #fcd34d; margin: 22px 0 8px;
        padding-bottom: 4px; border-bottom: 1px solid rgba(252, 196, 65, 0.15);
      }
      #site-info h3 { font-size: 12.5px; color: rgba(255, 255, 255, 0.85); margin: 14px 0 6px; }
      #site-info p, #site-info dd { font-size: 12.5px; line-height: 1.7; color: rgba(255, 255, 255, 0.7); margin: 0 0 8px; }
      #site-info dt { font-size: 12.5px; font-weight: 700; color: rgba(255, 255, 255, 0.9); margin: 12px 0 2px; }
      #site-info dl { margin: 0; }
      #site-info a { color: #fcd34d; }
      .si-stations, .si-routes, .si-ferries {
        margin: 0 0 6px; padding-left: 20px;
        font-size: 12px; line-height: 1.8; color: rgba(255, 255, 255, 0.65);
      }
      .si-routes { list-style: none; padding-left: 2px; column-width: 200px; column-gap: 18px; }
      .si-routes b {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        color: #fde68a; font-weight: 700; margin-right: 6px;
      }
      /* Language tabs: only the active language block is shown; the shared
         transit lists below are always visible. */
      #site-info [data-si-lang] { display: none; }
      #site-info[data-lang="zh"] [data-si-lang="zh"],
      #site-info[data-lang="en"] [data-si-lang="en"],
      #site-info[data-lang="pt"] [data-si-lang="pt"] { display: block; }
    </style>
```

- [x] **Step 2: 在 `<div id="root"></div>` 之後插入面板骨架與三語內容**

把 Task 2 放的孤立佔位符 `<!-- SEO:TRANSIT_LISTS -->` 移除,改為插入整個面板(佔位符在 `.si-shared` 內)。完整插入內容:

```html
    <div id="site-info-backdrop" hidden></div>
    <aside id="site-info" hidden data-lang="zh" role="dialog" aria-modal="true" aria-labelledby="si-title">
      <header class="si-head">
        <div class="si-tabs" role="tablist" aria-label="language">
          <button type="button" class="si-tab" data-lang-tab="zh" aria-selected="true">繁中</button>
          <button type="button" class="si-tab" data-lang-tab="en" aria-selected="false">EN</button>
          <button type="button" class="si-tab" data-lang-tab="pt" aria-selected="false">PT</button>
        </div>
        <button type="button" id="site-info-close" class="si-close" aria-label="close">✕</button>
      </header>
      <div class="si-scroll">

        <div data-si-lang="zh" lang="zh-Hant">
          <h1 id="si-title">Mini Map Macau · 澳門公共交通 3D 即時模擬地圖</h1>
          <p>Mini Map Macau 是一個互動式澳門公共交通 3D 地圖,以官方時刻表驅動的方式,模擬澳門輕軌(氹仔線、石排灣線、橫琴線)、90+ 條巴士路線(含跨海線與夜間巴士)、港澳/深圳渡輪航線,以及澳門國際機場(MFM)的真實航班動態。點擊任一車輛或車站,即可查看預計到站時間(ETA)、路線詳情與服務狀態;支援 3D/2D 視角、深淺色地圖、時間控制(暫停、1×–60× 加速、任意日期時間)與車輛追蹤。</p>
          <h2>常見問題</h2>
          <dl>
            <dt>地圖上的車輛是即時數據嗎?</dt>
            <dd>預設為時刻表驅動的模擬:車輛按官方時刻表與班距沿真實路線幾何行駛,並非真實 GPS 位置。巴士可於選單開啟 RT 模式,改用交通事務局(DSAT)即時數據顯示巴士位置;輕軌、航班與渡輪維持模擬。</dd>
            <dt>如何查詢巴士或輕軌的到站時間?</dt>
            <dd>點擊地圖上任一車站或車輛,面板會顯示預計到站時間(ETA)、下一班車與路線詳情。</dd>
            <dt>澳門輕軌有哪些路線和車站?</dt>
            <dd>共 3 條線:氹仔線、石排灣線與橫琴線,合計 15 個車站,涵蓋媽閣、機場、氹仔碼頭等交通樞紐。完整列表見下方「澳門輕軌路線與車站」。</dd>
            <dt>網站支援哪些語言?</dt>
            <dd>繁體中文、英文(English)與葡萄牙文(Português),可於選單切換;站名、路線與航班資訊會同步切換語言。</dd>
            <dt>資料來源是什麼?</dt>
            <dd>巴士路線與車站來自澳門交通事務局(DSAT)公開資料;輕軌資訊來自澳門輕軌(MLM);航班時刻來自 AviationStack;渡輪時刻來自 TurboJET 與 CotaiJet 官方網站。</dd>
            <dt>手機可以使用嗎?需要安裝 App 嗎?</dt>
            <dd>不需安裝。任何支援 WebGL 的現代瀏覽器(手機或電腦)直接開啟網站即可使用,介面已針對手機觸控優化。</dd>
            <dt>為什麼有些巴士路線沒有顯示?</dt>
            <dd>預設「自動模式」只顯示目前營運中的路線,深夜時段日間路線會自動隱藏;可在圖層面板手動開啟任何路線。</dd>
            <dt>這是澳門政府的官方網站嗎?</dt>
            <dd>不是。本站為個人開源專案,與澳門特別行政區政府、DSAT、澳門輕軌及各營運商均無從屬關係;資訊僅供參考,實際班次以官方公布為準。</dd>
          </dl>
          <h2>資料來源與聲明</h2>
          <p>本站為開源的非官方專案。巴士資料來自 <a href="https://www.dsat.gov.mo/" target="_blank" rel="noopener noreferrer">DSAT</a>、輕軌資料來自 <a href="https://www.mlm.com.mo/" target="_blank" rel="noopener noreferrer">澳門輕軌</a>、航班資料來自 <a href="https://aviationstack.com/" target="_blank" rel="noopener noreferrer">AviationStack</a>、渡輪時刻來自 <a href="https://www2.turbojet.com.hk/" target="_blank" rel="noopener noreferrer">TurboJET</a> 與 <a href="https://www.cotaiwaterjet.com/" target="_blank" rel="noopener noreferrer">CotaiJet</a>。地圖為時刻表驅動之模擬,僅供參考。</p>
        </div>

        <div data-si-lang="en" lang="en">
          <h2>Mini Map Macau — Real-time 3D Macau Public Transport Map</h2>
          <p>Mini Map Macau is an interactive 3D map of Macau's public transport network. A timetable-driven simulation animates the Macau LRT (Taipa, Seac Pai Van and Hengqin lines), 90+ bus routes including cross-harbour and night services, HK/Shenzhen–Macau ferry routes, and real flights at Macau International Airport (MFM). Click any vehicle or station for live ETAs, route details and service status; switch 3D/2D views, dark/light styles, control time (pause, 1×–60× speed, any date/time) and track vehicles.</p>
          <h2>FAQ</h2>
          <dl>
            <dt>Is the vehicle data real-time?</dt>
            <dd>By default it is a timetable-driven simulation: vehicles follow real route geometry according to official timetables and headways, not live GPS. An opt-in RT mode replaces simulated bus positions with the DSAT live feed; LRT, flights and ferries remain simulated.</dd>
            <dt>How do I check arrival times (ETA)?</dt>
            <dd>Click any station or vehicle on the map to see estimated arrivals, the next departures and route details.</dd>
            <dt>Which LRT lines and stations are covered?</dt>
            <dd>All 3 lines — Taipa, Seac Pai Van and Hengqin — with 15 stations including Barra, Airport and Taipa Ferry Terminal. See the full list below.</dd>
            <dt>Which languages are supported?</dt>
            <dd>Traditional Chinese, English and Portuguese; station names, routes and flight info all switch with the language.</dd>
            <dt>What are the data sources?</dt>
            <dd>Bus routes and stops from Macau's Transport Bureau (DSAT) open data; LRT information from Macao LRT (MLM); flight schedules from AviationStack; ferry timetables from TurboJET and CotaiJet.</dd>
            <dt>Does it work on mobile? Do I need an app?</dt>
            <dd>No install needed — any modern browser with WebGL works, and the UI is optimised for touch.</dd>
            <dt>Why are some bus routes not shown?</dt>
            <dd>The default auto mode shows only routes currently in service; daytime routes hide late at night. Any route can be enabled manually in the layers panel.</dd>
            <dt>Is this an official government website?</dt>
            <dd>No. This is a personal open-source project, unaffiliated with the Macau SAR Government, DSAT, Macao LRT or any operator. For reference only — actual schedules are as officially published.</dd>
          </dl>
          <h2>Sources &amp; Disclaimer</h2>
          <p>An open-source, unofficial project. Bus data from <a href="https://www.dsat.gov.mo/" target="_blank" rel="noopener noreferrer">DSAT</a>, LRT data from <a href="https://www.mlm.com.mo/" target="_blank" rel="noopener noreferrer">Macao LRT</a>, flights from <a href="https://aviationstack.com/" target="_blank" rel="noopener noreferrer">AviationStack</a>, ferry timetables from <a href="https://www2.turbojet.com.hk/" target="_blank" rel="noopener noreferrer">TurboJET</a> and <a href="https://www.cotaiwaterjet.com/" target="_blank" rel="noopener noreferrer">CotaiJet</a>. The map is a timetable-driven simulation, for reference only.</p>
        </div>

        <div data-si-lang="pt" lang="pt">
          <h2>Mini Map Macau — Mapa 3D do Transporte Público de Macau</h2>
          <p>O Mini Map Macau é um mapa 3D interactivo da rede de transportes públicos de Macau. Uma simulação baseada em horários anima o Metro Ligeiro de Macau (linhas da Taipa, de Seac Pai Van e de Hengqin), mais de 90 rotas de autocarro incluindo linhas transfronteiriças e nocturnas, rotas de ferry Hong Kong/Shenzhen–Macau e voos reais do Aeroporto Internacional de Macau (MFM). Clique em qualquer veículo ou estação para ver tempos de chegada (ETA), detalhes da rota e estado do serviço.</p>
          <h2>Perguntas Frequentes</h2>
          <dl>
            <dt>Os dados dos veículos são em tempo real?</dt>
            <dd>Por defeito é uma simulação baseada em horários: os veículos seguem a geometria real das rotas segundo os horários oficiais, não posições GPS reais. O modo RT (opcional) substitui as posições simuladas dos autocarros pelos dados em tempo real da DSAT; o metro ligeiro, os voos e os ferries permanecem simulados.</dd>
            <dt>Como consultar os tempos de chegada (ETA)?</dt>
            <dd>Clique em qualquer estação ou veículo no mapa para ver as próximas chegadas e os detalhes da rota.</dd>
            <dt>Quais são as linhas e estações do Metro Ligeiro?</dt>
            <dd>As 3 linhas — Taipa, Seac Pai Van e Hengqin — com 15 estações, incluindo Barra, Aeroporto e Terminal Marítimo da Taipa. Veja a lista completa abaixo.</dd>
            <dt>Que línguas são suportadas?</dt>
            <dd>Chinês tradicional, inglês e português; os nomes das estações, rotas e voos mudam com a língua.</dd>
            <dt>Quais são as fontes de dados?</dt>
            <dd>Rotas e paragens de autocarro dos dados abertos da DSAT; informação do metro ligeiro da MLM; horários de voos da AviationStack; horários de ferry da TurboJET e CotaiJet.</dd>
            <dt>Funciona no telemóvel? É preciso instalar uma app?</dt>
            <dd>Não é preciso instalar — funciona em qualquer navegador moderno com WebGL, com interface optimizada para ecrã táctil.</dd>
            <dt>Porque é que algumas rotas de autocarro não aparecem?</dt>
            <dd>O modo automático mostra apenas as rotas actualmente em serviço; as rotas diurnas ficam ocultas durante a madrugada. Qualquer rota pode ser activada manualmente no painel de camadas.</dd>
            <dt>É um site oficial do Governo?</dt>
            <dd>Não. É um projecto pessoal de código aberto, sem afiliação com o Governo da RAEM, a DSAT, o Metro Ligeiro de Macau ou qualquer operador. Apenas para referência.</dd>
          </dl>
          <h2>Fontes e Aviso</h2>
          <p>Projecto não oficial de código aberto. Dados de autocarros da <a href="https://www.dsat.gov.mo/" target="_blank" rel="noopener noreferrer">DSAT</a>, metro ligeiro da <a href="https://www.mlm.com.mo/" target="_blank" rel="noopener noreferrer">MLM</a>, voos da <a href="https://aviationstack.com/" target="_blank" rel="noopener noreferrer">AviationStack</a>, ferries da <a href="https://www2.turbojet.com.hk/" target="_blank" rel="noopener noreferrer">TurboJET</a> e <a href="https://www.cotaiwaterjet.com/" target="_blank" rel="noopener noreferrer">CotaiJet</a>. O mapa é uma simulação baseada em horários, apenas para referência.</p>
        </div>

        <div class="si-shared">
          <!-- SEO:TRANSIT_LISTS -->
        </div>

      </div>
    </aside>
```

- [x] **Step 3: 在 `</body>` 前加入 inline 控制 script**

放在 `<script type="module" src="/src/main.tsx"></script>` 之後、`</body>` 之前:

```html
    <script>
      // Site info panel controls. Plain JS on purpose: the panel must work
      // independently of the React bundle, and React only ever calls
      // window.miniMacauInfo.open().
      (function () {
        var panel = document.getElementById('site-info');
        var backdrop = document.getElementById('site-info-backdrop');
        var closeBtn = document.getElementById('site-info-close');
        if (!panel || !backdrop || !closeBtn) return;

        function setLang(l) {
          panel.setAttribute('data-lang', l);
          var tabs = panel.querySelectorAll('.si-tab');
          for (var i = 0; i < tabs.length; i++) {
            tabs[i].setAttribute('aria-selected',
              tabs[i].getAttribute('data-lang-tab') === l ? 'true' : 'false');
          }
        }
        function open() {
          var saved = null;
          try { saved = localStorage.getItem('mm_lang'); } catch (e) { /* private mode */ }
          setLang(saved === 'en' || saved === 'pt' ? saved : 'zh');
          panel.hidden = false;
          backdrop.hidden = false;
          closeBtn.focus();
        }
        function close() {
          panel.hidden = true;
          backdrop.hidden = true;
        }

        panel.addEventListener('click', function (e) {
          var t = e.target && e.target.closest ? e.target.closest('[data-lang-tab]') : null;
          if (t) setLang(t.getAttribute('data-lang-tab'));
        });
        closeBtn.addEventListener('click', close);
        backdrop.addEventListener('click', close);
        // Capture phase + stopPropagation so Esc closes the panel without
        // also toggling the app drawer (MapView listens on window bubble).
        window.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && !panel.hidden) {
            e.stopPropagation();
            close();
          }
        }, true);

        window.miniMacauInfo = { open: open, close: close };
      })();
    </script>
```

- [x] **Step 4: 驗證**

Run: `npm run build`
Expected: 成功;`dist/index.html` 同時含面板內容與注入清單

Run(PowerShell):
```powershell
Select-String -Path dist/index.html -Pattern '常見問題' -Quiet
Select-String -Path dist/index.html -Pattern 'Perguntas Frequentes' -Quiet
Select-String -Path dist/index.html -Pattern 'si-bus' -Quiet
```
Expected: 三個都 `True`

手動(preview 工具或瀏覽器開 dev server):在 console 執行 `window.miniMacauInfo.open()` → 面板開啟、預設繁中、三個 tab 可切換、✕ /背景/Esc 可關閉、Esc 關閉時**不會**順帶打開左側選單;面板內可捲動;手機視口(375px)無水平溢出。

- [x] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(seo): add static trilingual site-info panel to index.html"
```

---

### Task 4: FAQPage JSON-LD

**Files:**
- Modify: `index.html`

- [x] **Step 1: 在既有 WebApplication JSON-LD `<script>` 之後加入**

內容必須與面板繁中 FAQ 逐字一致(Google 要求 schema 與可見內容相符):

```html
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "地圖上的車輛是即時數據嗎?",
            "acceptedAnswer": { "@type": "Answer", "text": "預設為時刻表驅動的模擬:車輛按官方時刻表與班距沿真實路線幾何行駛,並非真實 GPS 位置。巴士可於選單開啟 RT 模式,改用交通事務局(DSAT)即時數據顯示巴士位置;輕軌、航班與渡輪維持模擬。" }
          },
          {
            "@type": "Question",
            "name": "如何查詢巴士或輕軌的到站時間?",
            "acceptedAnswer": { "@type": "Answer", "text": "點擊地圖上任一車站或車輛,面板會顯示預計到站時間(ETA)、下一班車與路線詳情。" }
          },
          {
            "@type": "Question",
            "name": "澳門輕軌有哪些路線和車站?",
            "acceptedAnswer": { "@type": "Answer", "text": "共 3 條線:氹仔線、石排灣線與橫琴線,合計 15 個車站,涵蓋媽閣、機場、氹仔碼頭等交通樞紐。" }
          },
          {
            "@type": "Question",
            "name": "網站支援哪些語言?",
            "acceptedAnswer": { "@type": "Answer", "text": "繁體中文、英文(English)與葡萄牙文(Português),可於選單切換;站名、路線與航班資訊會同步切換語言。" }
          },
          {
            "@type": "Question",
            "name": "資料來源是什麼?",
            "acceptedAnswer": { "@type": "Answer", "text": "巴士路線與車站來自澳門交通事務局(DSAT)公開資料;輕軌資訊來自澳門輕軌(MLM);航班時刻來自 AviationStack;渡輪時刻來自 TurboJET 與 CotaiJet 官方網站。" }
          },
          {
            "@type": "Question",
            "name": "手機可以使用嗎?需要安裝 App 嗎?",
            "acceptedAnswer": { "@type": "Answer", "text": "不需安裝。任何支援 WebGL 的現代瀏覽器(手機或電腦)直接開啟網站即可使用,介面已針對手機觸控優化。" }
          },
          {
            "@type": "Question",
            "name": "為什麼有些巴士路線沒有顯示?",
            "acceptedAnswer": { "@type": "Answer", "text": "預設「自動模式」只顯示目前營運中的路線,深夜時段日間路線會自動隱藏;可在圖層面板手動開啟任何路線。" }
          },
          {
            "@type": "Question",
            "name": "這是澳門政府的官方網站嗎?",
            "acceptedAnswer": { "@type": "Answer", "text": "不是。本站為個人開源專案,與澳門特別行政區政府、DSAT、澳門輕軌及各營運商均無從屬關係;資訊僅供參考,實際班次以官方公布為準。" }
          }
        ]
      }
    </script>
```

- [x] **Step 2: 驗證 JSON 合法**

Run(**用 Bash 工具執行**,PowerShell 雙引號跳脫會壞):

```bash
node -e 'const m=require("fs").readFileSync("index.html","utf8").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g); m.forEach((s,i)=>{JSON.parse(s.replace(/<\/?script[^>]*>/g,"")); console.log("ld+json #"+i+" OK")})'
```

Expected: `ld+json #0 OK` 與 `ld+json #1 OK`

- [x] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(seo): add FAQPage structured data matching visible FAQ"
```

---

### Task 5: React 選單入口

**Files:**
- Modify: `src/i18n.tsx`(3 個語言物件 + `Translations` interface,共 4 處)
- Modify: `src/components/MapView.tsx`

- [x] **Step 1: i18n 加 `about` key**

`src/i18n.tsx` 四處插入(放在各自的 `simDisclaimer` 行之前):

英文物件(約 line 100 附近):
```ts
    about: 'About this site',
```
中文物件(約 line 232 附近):
```ts
    about: '關於本站',
```
葡文物件(約 line 356 附近):
```ts
    about: 'Sobre o site',
```
`Translations` interface(約 line 482 附近):
```ts
  about: string
```

- [x] **Step 2: MapView 加 `declare global` 與 DrawerRow**

`src/components/MapView.tsx` 在 import 區塊之後、第一個常數宣告之前加:

```ts
declare global {
  interface Window {
    miniMacauInfo?: { open: () => void; close: () => void }
  }
}
```

抽屜「Map settings」清單(`MapView.tsx` 約 line 1395,`onToggleTimeBar` 那個 `DrawerRow` 之後、`RT_BUILD` 條件列之前)插入:

```tsx
              <DrawerRow
                code="NFO"
                label={t.about}
                active={false}
                onClick={() => { window.miniMacauInfo?.open(); setMenuOpen(false) }}
              />
```

- [x] **Step 3: 驗證**

Run: `npm run lint && npm test && npm run build`
Expected: 全部 PASS

手動(preview):開漢堡選單 → 看到「關於本站」(切 EN 顯示 "About this site"、PT 顯示 "Sobre o site")→ 點擊後選單關閉、資訊面板打開;面板 tab 預設語言跟隨 app 語言設定。

- [x] **Step 4: Commit**

```bash
git add src/i18n.tsx src/components/MapView.tsx
git commit -m "feat(seo): add About menu entry that opens the site-info panel"
```

---

### Task 6: 整體驗證

**Files:** 無新修改(驗證與收尾)

- [x] **Step 1: 完整回歸**

Run: `npm run lint && npm test && npm run build`
Expected: 全部 PASS

- [x] **Step 2: dist 內容抽查**

Run(PowerShell):
```powershell
(Select-String -Path dist/index.html -Pattern 'SEO:TRANSIT_LISTS' -Quiet)            # False — 佔位符已替換
(Select-String -Path dist/index.html -Pattern '氹仔線' -Quiet)                        # True — LRT 注入
(Select-String -Path dist/index.html -Pattern 'FAQPage' -Quiet)                       # True — JSON-LD
(Select-String -Path dist/index.html -Pattern '夜間巴士' -Quiet)                      # True — 分組
```

- [x] **Step 3: 瀏覽器行為驗證(preview 工具)**

1. 載入首頁:地圖正常、無 console error、面板不可見。
2. 漢堡選單 → 「關於本站」→ 面板開啟,內容完整(簡介、FAQ、輕軌 15 站、巴士分組清單、渡輪)。
3. 切 EN / PT tab:語言區塊切換、共用清單仍在。
4. Esc 關閉面板,且左側選單**沒有**因此打開;再按 Esc 選單才開(原行為不變)。
5. 手機視口(375×667):面板不水平溢出、可捲動。
6. 暗/亮地圖切換、時間控制等原功能無回歸。

- [x] **Step 4: 結構化資料與效能驗證(部署後,需使用者或外部工具)**

- Google Rich Results Test(https://search.google.com/test/rich-results)檢查 https://mini-map-macau.app/ — FAQPage 與 WebApplication 皆應無錯誤。
- Lighthouse(Chrome DevTools 或 PageSpeed Insights)確認 LCP/CLS 與改動前相當(面板為隱藏純文字,理論上無影響;此為規格要求的回歸確認)。

此步驟依賴外部服務,留待部署後執行,不擋本地完成。

- [x] **Step 5: 標記計畫完成**

把本計畫檔所有 checkbox 勾選,commit:

```bash
git add docs/superpowers/plans/2026-06-11-seo-single-page-info-panel.md
git commit -m "docs: mark SEO info panel plan complete"
```
