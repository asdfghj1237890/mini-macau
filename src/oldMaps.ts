import type { Lang } from './i18n'
import type { OldMap, OldMapText } from './types'

// HISTORICAL MAPS overlay helpers. The plates themselves are MapLibre `image`
// sources (see `syncOldMapLayers` in MapView); this module is the pure part —
// source/layer ids, names, the hidden set and the opacity, both persisted.

export const OLD_MAPS_DEFAULT_OPACITY = 0.85
export const OLD_MAPS_MIN_OPACITY = 0.2
// The legend swatch for a plate that is drawn: parchment. A data colour, like
// the category swatches, not chrome.
export const OLD_MAP_SWATCH_COLOR = '#d2b27a'

const SOURCE_PREFIX = 'oldmap-'
const LAYER_SUFFIX = '-raster'

export function oldMapSourceId(id: string): string {
  return `${SOURCE_PREFIX}${id}`
}

export function oldMapLayerId(id: string): string {
  return `${SOURCE_PREFIX}${id}${LAYER_SUFFIX}`
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

// "1792", or "1792 · 1808" when the plate was published later than drawn.
export function oldMapYears(map: OldMap): string {
  return map.published && map.published !== map.year ? `${map.year} · ${map.published}` : String(map.year)
}

export type OldMapSet = ReadonlySet<string>
export const NO_HIDDEN_OLD_MAPS: OldMapSet = new Set()

// The maps to draw. Same identity contract as the other overlays: when nothing
// listed is hidden the input array comes back as is, so MapView's
// array-identity effect does not re-add the sources.
export function filterOldMaps(maps: OldMap[], hidden: OldMapSet): OldMap[] {
  if (hidden.size === 0 || !maps.some(map => hidden.has(map.id))) return maps
  return maps.filter(map => !hidden.has(map.id))
}

export const LS_OLD_MAPS_HIDDEN = 'mini-macau-oldmaps-hidden'
export const LS_OLD_MAPS_OPACITY = 'mini-macau-oldmaps-opacity'

// Stored as the HIDDEN set so a map added to the file later shows by default.
export function loadHiddenOldMaps(): OldMapSet {
  try {
    const raw = localStorage.getItem(LS_OLD_MAPS_HIDDEN)
    if (!raw) return NO_HIDDEN_OLD_MAPS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return NO_HIDDEN_OLD_MAPS
    return new Set(parsed.filter((v): v is string => typeof v === 'string' && v.length > 0))
  } catch {
    return NO_HIDDEN_OLD_MAPS
  }
}

export function saveHiddenOldMaps(hidden: OldMapSet): void {
  try {
    localStorage.setItem(LS_OLD_MAPS_HIDDEN, JSON.stringify([...hidden]))
  } catch { /* private mode */ }
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
