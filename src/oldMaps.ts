import type { Lang } from './i18n'
import type { OldMap, OldMapText } from './types'
import { OLD_MAP_SELECTION_GROUPS as SELECTION_GROUPS, oldMapSelectionId } from './oldMapGroups'

// HISTORICAL MAPS overlay helpers. The plates themselves are MapLibre sources
// (see `syncOldMapLayers` in MapView) — a raster tile pyramid where the plate
// has one, its single image otherwise; this module is the pure part — the
// source spec, source/layer ids, names, the hidden set and the opacity, both
// persisted.

export const OLD_MAPS_DEFAULT_OPACITY = 0.85
export const OLD_MAPS_MIN_OPACITY = 0.2
// The legend swatch for a plate that is drawn: parchment. A data colour, like
// the category swatches, not chrome.
export const OLD_MAP_SWATCH_COLOR = '#d2b27a'

// The basemap's 3D buildings. On the ordinary map they are near-solid blocks in
// the theme's grey; while a plate is drawn they stand ON the plate, and a dark
// solid block hides exactly the part of an old plan that has the most on it —
// the walled town. So over a plate they turn into a paper-toned, half-see-through
// massing model: today's city stays readable as volume, and the streets and
// shoreline engraved underneath show through it. One colour for both themes,
// because what lies under the buildings is the same parchment either way.
export interface BasemapBuildingsPaint {
  color: string
  opacity: number
}

export const OLD_MAP_BUILDINGS_PAINT: BasemapBuildingsPaint = { color: '#e9dfc8', opacity: 0.5 }

export function basemapBuildingsPaint(dark: boolean, overOldMap: boolean): BasemapBuildingsPaint {
  if (overOldMap) return OLD_MAP_BUILDINGS_PAINT
  return { color: dark ? '#2a2d33' : '#d8d8dc', opacity: 0.85 }
}

const SOURCE_PREFIX = 'oldmap-'
const LAYER_SUFFIX = '-raster'

export function oldMapSourceId(id: string): string {
  return `${SOURCE_PREFIX}${id}`
}

export function oldMapLayerId(id: string): string {
  return `${SOURCE_PREFIX}${id}${LAYER_SUFFIX}`
}

// What MapView hands to `addSource` for a plate. A plate that ships a tile
// pyramid is a `raster` source — the map then loads only the tiles in view at
// the zoom in view, so zooming in brings the scan's own resolution without one
// huge texture — and `bounds` keeps it from asking for tiles the pyramid does
// not have. Every other plate is its single north-up WebP as an `image` source.
// The tile URL is made absolute with the page's origin: a template cannot go
// through `new URL` (the braces would be escaped), and a root-relative one is
// only safe where the request happens to be made from the main thread.
export type OldMapSourceSpec =
  | { type: 'raster'; tiles: [string]; tileSize: number; minzoom: number; maxzoom: number; bounds: [number, number, number, number]; attribution?: string }
  | { type: 'image'; url: string; coordinates: OldMap['coordinates'] }

export function oldMapSourceSpec(map: OldMap, origin: string): OldMapSourceSpec {
  if (map.remoteTiles) {
    const { url, tileSize, minzoom, maxzoom } = map.remoteTiles
    const { west, south, east, north } = map.bounds
    return { type: 'raster', tiles: [url], tileSize, minzoom, maxzoom,
      bounds: [west, south, east, north], attribution: map.attribution }
  }
  if (!map.tiles) return { type: 'image', url: map.image, coordinates: map.coordinates }
  const { west, south, east, north } = map.bounds
  return {
    type: 'raster',
    tiles: [`${origin.replace(/\/+$/, '')}${map.tiles.url}`],
    tileSize: map.tiles.tileSize,
    minzoom: map.tiles.minzoom,
    maxzoom: map.tiles.maxzoom,
    bounds: [west, south, east, north],
  }
}

// The map id a raster layer belongs to, or null for any other layer (the
// source id alone is not a layer id).
export function oldMapIdFromLayer(layerId: string): string | null {
  if (!layerId.startsWith(SOURCE_PREFIX) || !layerId.endsWith(LAYER_SUFFIX)) return null
  const id = layerId.slice(SOURCE_PREFIX.length, layerId.length - LAYER_SUFFIX.length)
  return id ? id : null
}

function pick(text: OldMapText, lang: Lang): string {
  const value = lang === 'zh' ? text.zh : lang === 'pt' ? text.pt : text.en
  return value || text.en || text.zh
}

// The short name for the legend row, and the plate's full title.
export function oldMapName(map: OldMap, lang: Lang): string {
  return pick(map.name, lang)
}

export function oldMapTitle(map: OldMap, lang: Lang): string {
  return pick(map.title, lang)
}

// What the plate shows and how well the georeference can be trusted — the
// legend row's tooltip.
export function oldMapNotes(map: OldMap, lang: Lang): string {
  return pick(map.notes, lang)
}

function oldMapDate(map: OldMap): string {
  return `${map.yearApproximate ? '≈ ' : ''}${map.year}${map.yearPrecision === 'decade' ? 's' : ''}`
}

// "1780s", "1792", or "1792 · 1808" when published later than drawn.
export function oldMapYears(map: OldMap): string {
  const year = oldMapDate(map)
  return map.published && map.published !== map.year ? `${year} · ${map.published}` : year
}

// Reading labels, separate from the catalogue titles and provenance. Keep the
// main date unambiguous; a later publication date belongs in the second line.
const LEGEND_LABELS: Record<string, { title: OldMapText; detail: OldMapText }> = {
  'bellin-1749': {
    title: { zh: '貝林・澳門城廓與內港', en: 'Bellin · walled Macao and Inner Harbour', pt: 'Bellin · Macau muralhada e Porto Interior' },
    detail: { zh: '法荷雙語銅版圖 · 近似定位', en: 'French–Dutch engraving · approximate position', pt: 'Gravura franco-neerlandesa · posição aproximada' },
  },
  'hogg-1780s': {
    title: { zh: '霍格版・澳門與離島航道', en: 'Hogg edition · Macao and island channels', pt: 'Edição Hogg · Macau e canais das ilhas' },
    detail: { zh: '1780 年代航海草圖 · 近似定位', en: '1780s navigation sketch · approximate position', pt: 'Esboço náutico da década de 1780 · posição aproximada' },
  },
  'guignes-1792': {
    title: { zh: '小德金・清代澳門城廓', en: 'de Guignes · walled Macao', pt: 'de Guignes · Macau muralhada' },
    detail: { zh: '城牆、炮台與聚落', en: 'Walls, forts and settlements', pt: 'Muralhas, fortalezas e povoações' },
  },
  'baker-1796': {
    title: { zh: '貝克・澳門港灣海圖', en: 'Baker · Macao harbour chart', pt: 'Baker · carta do porto de Macau' },
    detail: { zh: '內港與南灣水深', en: 'Inner Harbour and Praia Grande soundings', pt: 'Sondagens do Porto Interior e Praia Grande' },
  },
  'admiralty-1858': {
    title: { zh: '英國海軍・澳門航道海圖', en: 'Admiralty · Macao navigation chart', pt: 'Almirantado · carta náutica de Macau' },
    detail: { zh: '第 1290 號 · 1804 測繪、1858 修訂', en: 'No. 1290 · surveyed 1804, corrected 1858', pt: 'N.º 1290 · levantamento 1804, correcções 1858' },
  },
  'heitor-1889': {
    title: { zh: '海托爾・澳門街道詳圖', en: 'Heitor · detailed street survey', pt: 'Heitor · levantamento das ruas' },
    detail: { zh: '公物局測繪 · 1:5,000', en: 'Public Works survey · 1:5,000', pt: 'Obras Públicas · 1:5.000' },
  },
  'sauvage-1893': {
    title: { zh: '索瓦熱・澳門測繪手稿', en: 'Sauvage · manuscript survey', pt: 'Sauvage · levantamento manuscrito' },
    detail: { zh: '33 處地標圖例 · 1:10,000', en: 'Key to 33 landmarks · 1:10,000', pt: 'Legenda de 33 locais · 1:10.000' },
  },
  'atlas-1912': {
    title: { zh: '《澳門地圖集》三地合覽', en: 'Macau Atlas · three sheets', pt: 'Atlas de Macau · três folhas' },
    detail: { zh: '葡萄牙製圖委員會 · 半島、氹仔、路環', en: 'Cartography Commission · peninsula, Taipa, Coloane', pt: 'Comissão de Cartografia · península, Taipa e Coloane' },
  },
  'cartografia-1912': {
    title: { zh: '澳門半島・街道與炮台', en: 'Macau peninsula · streets and forts', pt: 'Península de Macau · ruas e fortalezas' },
    detail: { zh: '《澳門地圖集》半島篇 · 1:10,000', en: 'Macau Atlas, peninsula sheet · 1:10,000', pt: 'Atlas de Macau, folha da península · 1:10.000' },
  },
  'taipa-1912': {
    title: { zh: '大氹與小氹・岸線與村落', en: 'Taipa Grande & Pequena · shores and villages', pt: 'Taipa Grande e Pequena · costas e aldeias' },
    detail: { zh: '《澳門地圖集》氹仔篇 · 1:10,000', en: 'Macau Atlas, Taipa sheet · 1:10,000', pt: 'Atlas de Macau, folha da Taipa · 1:10.000' },
  },
  'coloane-1912': {
    title: { zh: '路環全島・地形與聚落', en: 'Coloane · relief and settlements', pt: 'Coloane · relevo e povoações' },
    detail: { zh: '《澳門地圖集》路環篇 · 含聚落附圖', en: 'Macau Atlas, Coloane sheet · settlement inset', pt: 'Atlas de Macau, folha de Coloane · inserção da povoação' },
  },
  'alves-1927': {
    title: { zh: '澳門新港與填海規劃', en: 'Macau new harbour & reclamation plans', pt: 'Macau · novo porto e aterros projectados' },
    detail: { zh: '阿爾維斯／皮雷斯 · 含擬建工程', en: 'Alves / Pires · includes proposed works', pt: 'Alves / Pires · inclui obras propostas' },
  },
  'aomen-1953': {
    title: { zh: '《澳門市全圖》中文街道版', en: 'Aomen Shi quan tu · Chinese street map', pt: 'Aomen Shi quan tu · ruas em chinês' },
    detail: { zh: '編目估年 · 1956 圖書館日期章', en: 'Catalogue estimate · library stamp dated 1956', pt: 'Data estimada no catálogo · carimbo de 1956' },
  },
  'lemos-1963': {
    title: { zh: '澳門地質略圖・岩層與海岸', en: 'Macau geology · rocks and coastline', pt: 'Geologia de Macau · rochas e costa' },
    detail: { zh: 'Lemos de Sousa · 1:25,000', en: 'Lemos de Sousa · 1:25,000', pt: 'Lemos de Sousa · 1:25.000' },
  },
  'dscc-1990': {
    title: { zh: '地圖繪製暨地籍司・半島建築詳圖', en: 'Cartography and Cadastre · peninsula buildings', pt: 'Cartografia e Cadastro · edifícios da península' },
    detail: { zh: '澳門格網配準 · 1:5,000', en: 'Registered on the Macau grid · 1:5,000', pt: 'Quadrícula de Macau · 1:5000' },
  },
  'dscc-1991': {
    title: { zh: '地圖繪製暨地籍司・澳門地區全圖', en: 'Cartography and Cadastre · Territory of Macau', pt: 'Cartografia e Cadastro · Território de Macau' },
    detail: { zh: '澳門格網配準 · 1:20,000', en: 'Registered on the Macau grid · 1:20,000', pt: 'Quadrícula de Macau · 1:20 000' },
  },
}

export function oldMapLegendLabel(map: OldMap, lang: Lang): { year: string; title: string; detail: string } {
  const label = LEGEND_LABELS[map.id]
  const published = map.published && map.published !== map.year
    ? (lang === 'zh' ? `${map.published} 年刊印` : lang === 'pt' ? `publicado em ${map.published}` : `published ${map.published}`)
    : ''
  return {
    year: oldMapDate(map),
    title: label ? pick(label.title, lang) : oldMapName(map, lang),
    detail: [label ? pick(label.detail, lang) : map.author, published].filter(Boolean).join(' · '),
  }
}

export type OldMapSet = ReadonlySet<string>
export const NO_HIDDEN_OLD_MAPS: OldMapSet = new Set()

export interface OldMapGroup { id: string; maps: OldMap[] }

// One selector row may draw several separately registered sheets. Preserve
// catalogue order and original records, including each sheet's source credit.
export function groupOldMaps(maps: OldMap[]): OldMapGroup[] {
  const groups = new Map<string, OldMapGroup>()
  for (const map of maps) {
    const id = oldMapSelectionId(map.id)
    if (!groups.has(id)) groups.set(id, { id, maps: [] })
    groups.get(id)!.maps.push(map)
  }
  return [...groups.values()]
}

export function oldMapGroupLabel(group: OldMapGroup, lang: Lang) {
  return oldMapLegendLabel({ ...group.maps[0], id: group.id }, lang)
}

// The selector files its rows under the century of their main date
// (1749 → 18th, 1996 → 20th): centuries in order, catalogue order within each.
export function groupOldMapsByCentury(groups: OldMapGroup[]): { century: number; groups: OldMapGroup[] }[] {
  const centuries = new Map<number, OldMapGroup[]>()
  for (const group of groups) {
    const century = Math.ceil(group.maps[0].year / 100)
    centuries.set(century, [...(centuries.get(century) ?? []), group])
  }
  return [...centuries].sort(([a], [b]) => a - b).map(([century, rows]) => ({ century, groups: rows }))
}

export function isOldMapHidden(hidden: OldMapSet, id: string): boolean {
  const selection = oldMapSelectionId(id)
  return hidden.has(selection) || (SELECTION_GROUPS[selection]?.every(member => hidden.has(member)) ?? false)
}

// Migrate old individual switches: an atlas with any sheet showing stays on;
// an entirely hidden atlas stays off. Unrelated saved preferences survive.
function normalizeHiddenOldMaps(hidden: OldMapSet): Set<string> {
  const next = new Set(hidden)
  for (const [id, members] of Object.entries(SELECTION_GROUPS)) {
    const off = isOldMapHidden(hidden, id)
    members.forEach(member => next.delete(member))
    if (off) next.add(id)
  }
  return next
}

// A first visit starts on the 1889 Public Works survey: the most reliable
// registration in the catalogue, and the finest tiles.
export const DEFAULT_OLD_MAP_SELECTION = 'heitor-1889'

// One selector row is drawn at a time (the 1912 atlas row draws its three
// sheets). The saved choice wins while the catalogue still has it; before
// anything is saved, the first row the former multi-select left visible
// carries over; otherwise the default, then the first row.
export function resolveOldMapSelection(groupIds: readonly string[], saved: string | null, legacyHidden: OldMapSet): string | null {
  const choice = saved === null ? null : oldMapSelectionId(saved)
  if (choice !== null && groupIds.includes(choice)) return choice
  if (legacyHidden.size > 0) {
    const kept = groupIds.find(id => !isOldMapHidden(legacyHidden, id))
    if (kept) return kept
  }
  if (groupIds.includes(DEFAULT_OLD_MAP_SELECTION)) return DEFAULT_OLD_MAP_SELECTION
  return groupIds[0] ?? null
}

// The maps to draw: every sheet of the selected row, in catalogue order.
export function selectOldMaps(maps: OldMap[], selection: string | null): OldMap[] {
  return selection === null ? [] : maps.filter(map => oldMapSelectionId(map.id) === selection)
}

export const LS_OLD_MAPS_SELECTED = 'mini-macau-oldmaps-selected'
// The former multi-select's hidden set, read only to carry a choice over.
export const LS_OLD_MAPS_HIDDEN = 'mini-macau-oldmaps-hidden'
export const LS_OLD_MAPS_OPACITY = 'mini-macau-oldmaps-opacity'

export function loadSelectedOldMap(): string | null {
  try {
    const raw = localStorage.getItem(LS_OLD_MAPS_SELECTED)
    return raw ? oldMapSelectionId(raw) : null
  } catch {
    return null
  }
}

export function saveSelectedOldMap(id: string): void {
  try {
    localStorage.setItem(LS_OLD_MAPS_SELECTED, id)
  } catch { /* private mode */ }
}

export function loadHiddenOldMaps(): OldMapSet {
  try {
    const raw = localStorage.getItem(LS_OLD_MAPS_HIDDEN)
    if (!raw) return NO_HIDDEN_OLD_MAPS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return NO_HIDDEN_OLD_MAPS
    return normalizeHiddenOldMaps(new Set(parsed.filter((v): v is string => typeof v === 'string' && v.length > 0)))
  } catch {
    return NO_HIDDEN_OLD_MAPS
  }
}

export function clampOldMapsOpacity(value: number): number {
  if (!Number.isFinite(value)) return OLD_MAPS_DEFAULT_OPACITY
  return Math.min(1, Math.max(OLD_MAPS_MIN_OPACITY, value))
}

export function loadOldMapsOpacity(): number {
  try {
    const raw = localStorage.getItem(LS_OLD_MAPS_OPACITY)
    return raw === null ? OLD_MAPS_DEFAULT_OPACITY : clampOldMapsOpacity(Number(raw))
  } catch {
    return OLD_MAPS_DEFAULT_OPACITY
  }
}

export function saveOldMapsOpacity(value: number): void {
  try {
    localStorage.setItem(LS_OLD_MAPS_OPACITY, String(clampOldMapsOpacity(value)))
  } catch { /* private mode */ }
}
