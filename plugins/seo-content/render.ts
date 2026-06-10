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
