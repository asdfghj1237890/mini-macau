// RELIGION overlay helpers shared by MapView (the marker layer), the legend
// and the info panel. The category and kind rules, the colour table and the
// icon names live here exactly once so the markers, the swatches and the panel
// header can never disagree.
//
// Two axes: `category` is the faith or group the legend toggles (土地公, the
// other Chinese temples, churches, the mosque, other faiths) and carries the
// COLOUR; `kind` is the building type (temple / street shrine / church /
// mosque) and carries the icon SHAPE. The overlay is time-independent —
// nothing here takes a clock.
import type { Lang, Translations } from './i18n'
import type { ReligionCategory, ReligionCategoryId, ReligionKind, ReligionSite, ReligionText } from './types'

// Legend order for the categories (also the order religion.json lists them).
export const RELIGION_CATEGORY_ORDER: readonly ReligionCategoryId[] = [
  'tudigong', 'temple', 'church', 'mosque', 'other',
] as const

// Drawing order for the marker shapes: the bigger, rarer things first.
export const RELIGION_KIND_ORDER: readonly ReligionKind[] = ['temple', 'church', 'mosque', 'shrine'] as const

// Marker colours, one per category. Data colours, so literal hex like the
// other overlays (not theme tokens). Orange for Tou Tei and red for the other
// Chinese temples keep the two Chinese groups near each other; violet,
// emerald and teal are clear of both and of the schools' hues.
export const RELIGION_CATEGORY_COLORS: Record<ReligionCategoryId, string> = {
  tudigong: '#fb923c',
  temple: '#ef4444',
  church: '#a78bfa',
  mosque: '#34d399',
  other: '#2dd4bf',
}

// The colour a site is drawn in: its category's.
export function religionColor(site: Pick<ReligionSite, 'category'>): string {
  return RELIGION_CATEGORY_COLORS[site.category]
}

// A site whose position is a street-level geocode (the Macau Memory map
// carries street names, not surveyed points) is drawn at this opacity so it
// reads as "somewhere on this street" rather than "exactly here".
export const RELIGION_APPROXIMATE_OPACITY = 0.55

// Name of the registered MapLibre image for a category × kind pair. Kept next
// to the colour table so MapView's `map.addImage` loop and the symbol layer's
// `['get','icon']` read the same strings.
export function religionIconName(category: ReligionCategoryId, kind: ReligionKind): string {
  return `religion-${category}-${kind}`
}

// Every image MapView registers: the full category × kind grid (20 tiny
// canvases), so a pairing the data has not used yet still draws.
export const RELIGION_ICON_VARIANTS: readonly { category: ReligionCategoryId; kind: ReligionKind }[] =
  RELIGION_CATEGORY_ORDER.flatMap(category => RELIGION_KIND_ORDER.map(kind => ({ category, kind })))

// Localised name. Only the Chinese form is guaranteed (OSM and Macau Memory
// names are Chinese-only); the IC-classified sites and the bilingual OSM
// churches carry English and/or Portuguese names, which English/Portuguese
// readers get when present. The fallback is deliberately the CHINESE name, not
// a translation: a shrine's name is the inscription on its tablet.
export function pickReligionText(field: ReligionText | null | undefined, lang: Lang): string {
  if (!field) return ''
  if (lang === 'en') return field.en || field.pt || field.zh || ''
  if (lang === 'pt') return field.pt || field.en || field.zh || ''
  return field.zh || field.en || field.pt || ''
}

// The classified-heritage description is trilingual by construction (the IC
// API is queried once per language), so the chain only matters for a blank.
export function pickHeritageText(
  field: { zh: string; en: string; pt: string } | null | undefined,
  lang: Lang,
): string {
  if (!field) return ''
  if (lang === 'en') return field.en || field.pt || field.zh || ''
  if (lang === 'pt') return field.pt || field.en || field.zh || ''
  return field.zh || field.en || field.pt || ''
}

// UI label for a category, from the i18n table (not the file's own names) so
// the legend reads before religion.json has loaded and stays consistent with
// the panel's other labels.
export function religionCategoryLabel(t: Translations, category: ReligionCategoryId): string {
  switch (category) {
    case 'tudigong': return t.religionCategoryTudigong
    case 'temple': return t.religionCategoryTemple
    case 'church': return t.religionCategoryChurch
    case 'mosque': return t.religionCategoryMosque
    case 'other': return t.religionCategoryOther
  }
}

// UI label for a building kind.
export function religionKindLabel(t: Translations, kind: ReligionKind): string {
  switch (kind) {
    case 'temple': return t.religionKindTemple
    case 'shrine': return t.religionKindShrine
    case 'church': return t.religionKindChurch
    case 'mosque': return t.religionKindMosque
  }
}

// The file's own trilingual category name when it has loaded, else the i18n
// label — the panel prefers the file (it is the dataset's wording).
export function religionCategoryName(
  categories: ReligionCategory[], category: ReligionCategoryId, lang: Lang, t: Translations,
): string {
  const found = categories.find(c => c.id === category)
  return (found && pickReligionText(found.name, lang)) || religionCategoryLabel(t, category)
}

// One Point feature per site. `icon` drives the image, `approximate` the
// dimming, `id` is what the click handler looks the site up by. Records with
// no usable coordinate pair are skipped rather than emitted as broken
// geometry (MapLibre would warn on every tile).
export function buildReligionFeatures(sites: ReligionSite[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const site of sites) {
    const coords = site.coordinates
    if (!coords || coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties: {
        id: site.id,
        category: site.category,
        kind: site.kind,
        icon: religionIconName(site.category, site.kind),
        approximate: site.approximate,
        // Buildings sort above street shrines when markers collide, and exact
        // points above street-level guesses.
        rank: (site.kind === 'shrine' ? 0 : 2) + (site.approximate ? 0 : 1),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// Register size and kind breakdown for the panel's coverage note. Cheap
// enough to recompute per render.
export function countReligionByKind(sites: ReligionSite[]): Record<ReligionKind, number> {
  const counts: Record<ReligionKind, number> = { temple: 0, shrine: 0, church: 0, mosque: 0 }
  for (const site of sites) counts[site.kind]++
  return counts
}

// ---------------------------------------------------------------------------
// Per-category visibility. The legend's RELIGION row toggles individual
// categories, so App filters the site array before it reaches MapView (the map
// layer itself stays a single source rebuilt on array identity change) — the
// same contract as the schools' teaching stages.
// ---------------------------------------------------------------------------

export type ReligionCategorySet = ReadonlySet<ReligionCategoryId>

// Every category enabled — the default, and the fallback for missing/corrupt
// storage.
export const ALL_RELIGION_CATEGORIES: ReligionCategorySet = new Set(RELIGION_CATEGORY_ORDER)

// localStorage key for the enabled categories (a JSON array of ids).
const LS_RELIGION_CATEGORIES_KEY = 'mini-macau-religion-categories-on'

// Sites whose category is switched on. When every category is enabled the
// input array is returned as-is, so the caller's memo keeps its identity and
// MapView skips a needless setData.
export function filterReligionByCategory(sites: ReligionSite[], on: ReligionCategorySet): ReligionSite[] {
  if (RELIGION_CATEGORY_ORDER.every(category => on.has(category))) return sites
  return sites.filter(site => on.has(site.category))
}

// How many sites each category has, for the legend's per-row counts. Always
// has all five keys, so an empty category reads 0 rather than undefined.
export function countReligionByCategory(sites: ReligionSite[]): Record<ReligionCategoryId, number> {
  const counts = Object.fromEntries(
    RELIGION_CATEGORY_ORDER.map(category => [category, 0]),
  ) as Record<ReligionCategoryId, number>
  for (const site of sites) {
    if (site.category in counts) counts[site.category] += 1
  }
  return counts
}

// Restore the enabled categories. Anything unreadable, non-array, or holding
// unknown ids degrades to "all on" rather than hiding the layer.
export function loadReligionCategoriesOn(): ReligionCategorySet {
  try {
    const raw = localStorage.getItem(LS_RELIGION_CATEGORIES_KEY)
    if (!raw) return ALL_RELIGION_CATEGORIES
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return ALL_RELIGION_CATEGORIES
    return new Set(RELIGION_CATEGORY_ORDER.filter(category => arr.includes(category)))
  } catch {
    return ALL_RELIGION_CATEGORIES
  }
}

// Persist the enabled categories, in RELIGION_CATEGORY_ORDER so the stored
// value is stable. Storage can throw (private mode, quota) — losing the
// preference is never worth breaking the toggle.
export function saveReligionCategoriesOn(on: ReligionCategorySet): void {
  try {
    localStorage.setItem(
      LS_RELIGION_CATEGORIES_KEY,
      JSON.stringify(RELIGION_CATEGORY_ORDER.filter(category => on.has(category))),
    )
  } catch { /* ignore */ }
}
