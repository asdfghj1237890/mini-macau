// Public-housing overlay helpers shared by MapView (the extrusion layer), the
// legend (the colour key) and the info panel. Same shape as src/schools.ts and
// for the same reason: the colour table lives here exactly once, so the blocks
// on the map and the swatches in the legend can never disagree.
//
// The overlay draws every 社會房屋 (social, rental) and 經濟房屋 (economic,
// subsidised-sale) estate on the Housing Bureau's (房屋局, IH) two 位置分佈
// lists as its own fill-extrusion footprints — the OpenFreeMap basemap merges
// same-height buildings into one feature, so a basemap building cannot be
// tinted on its own (see the header of src/schools.ts). Colour carries two
// facts: the HUE is the housing type, the SHADE is the decade the block was
// first occupied (IH's per-block 入伙日期) — oldest darkest, newest lightest.
import type { Lang, Translations } from './i18n'
import type {
  PublicHousingCategory,
  PublicHousingDistrict,
  PublicHousingEstate,
  PublicHousingStatus,
  PublicHousingType,
  PublicHousingYearKind,
} from './types'

// Legend / toggle order: rental first, then sale, then the programmes outside
// IH's two lists (elderly apartments, urban-renewal replacement / temporary
// housing, sandwich-class housing).
export const PUBLIC_HOUSING_TYPE_ORDER: readonly PublicHousingType[] = ['social', 'economic', 'other'] as const

// Decade stops of the shade ramp. IH's oldest listed estate is 台山平民新邨
// (occupied 1985), so 1980 is the first stop; the 新城A區 lots being handed
// over now fall in the last one. Anything outside clamps to the nearest end.
export const PUBLIC_HOUSING_DECADES = [1980, 1990, 2000, 2010, 2020] as const
export type PublicHousingDecade = (typeof PUBLIC_HOUSING_DECADES)[number]

// Type → decade → block colour (literal data colours, like the school levels).
// Social housing is the orange family, economic housing the teal family and
// the other programmes the violet family: orange/teal/violet stay
// distinguishable for the common colour-vision deficiencies and none is a hue
// the vehicles use. Within a family the five stops step from a deep shade for
// the 1980s to a pale tint for the 2020s.
export const PUBLIC_HOUSING_COLORS: Record<PublicHousingType, Record<PublicHousingDecade, string>> = {
  social: {
    1980: '#7a2e0e',
    1990: '#a63f10',
    2000: '#d45b1a',
    2010: '#f38a3e',
    2020: '#fbc08a',
  },
  economic: {
    1980: '#0e3f3b',
    1990: '#145d58',
    2000: '#1b8a80',
    2010: '#33b9ab',
    2020: '#86e3d6',
  },
  other: {
    1980: '#3b1f6b',
    1990: '#56309a',
    2000: '#7a48c9',
    2010: '#a381e6',
    2020: '#cdbcf3',
  },
}

// The ramp's middle stop doubles as the type's identity colour (legend
// glyphs, badges, the row's per-type dot) so a single swatch still reads as
// "that family".
export const PUBLIC_HOUSING_TYPE_COLOR: Record<PublicHousingType, string> = {
  social: PUBLIC_HOUSING_COLORS.social[2000],
  economic: PUBLIC_HOUSING_COLORS.economic[2000],
  other: PUBLIC_HOUSING_COLORS.other[2000],
}

// The feature property MapView promotes to the GeoJSON feature id
// (`promoteId`). Every building of an estate carries the same value, so ONE
// setFeatureState call lights up the whole estate — same trick as the schools.
export const PUBLIC_HOUSING_FEATURE_ID_PROPERTY = 'estateId'

// The decade stop a year falls in. `null` (an estate not yet occupied — under
// construction, or handed over without a published date) is treated as the
// newest decade: those are by definition the latest buildings.
export function publicHousingDecade(year: number | null | undefined): PublicHousingDecade {
  if (year == null || !Number.isFinite(year)) return PUBLIC_HOUSING_DECADES[PUBLIC_HOUSING_DECADES.length - 1]
  let decade: PublicHousingDecade = PUBLIC_HOUSING_DECADES[0]
  for (const stop of PUBLIC_HOUSING_DECADES) {
    if (year >= stop) decade = stop
  }
  return decade
}

// Block colour for a type + occupation year.
export function publicHousingColor(type: PublicHousingType, year: number | null | undefined): string {
  const family = PUBLIC_HOUSING_COLORS[type] ?? PUBLIC_HOUSING_COLORS.economic
  return family[publicHousingDecade(year)]
}

// The five stops of a type's ramp in decade order, for the legend's gradient
// strip (dark → light, left → right).
export function publicHousingRamp(type: PublicHousingType): string[] {
  const family = PUBLIC_HOUSING_COLORS[type] ?? PUBLIC_HOUSING_COLORS.economic
  return PUBLIC_HOUSING_DECADES.map(decade => family[decade])
}

// ---------------------------------------------------------------------------
// Per-type visibility. The legend's HOUSING row toggles the two types
// individually, so App filters the estate array before it reaches MapView (the
// map layer itself stays a single source rebuilt on array identity change).
// ---------------------------------------------------------------------------

export type PublicHousingTypeSet = ReadonlySet<PublicHousingType>

// Both types enabled — the default, and the fallback for missing/corrupt
// storage.
export const ALL_PUBLIC_HOUSING_TYPES: PublicHousingTypeSet = new Set(PUBLIC_HOUSING_TYPE_ORDER)

// localStorage key for the types switched OFF (a JSON array of type names).
// The OFF list is stored rather than the ON list so that a type added later
// is visible to returning users: `other` shipped after social/economic, and a
// stored ON list of ["social","economic"] would have hidden it for everyone
// who had ever touched the toggles. (The first version's ON-list key is
// removed on the next save and otherwise ignored.)
const LS_PUBLIC_HOUSING_TYPES_OFF_KEY = 'mini-macau-public-housing-types-off'
const LS_PUBLIC_HOUSING_TYPES_LEGACY_KEY = 'mini-macau-public-housing-types-on'

// Estates whose type is switched on. When every type is enabled the input
// array is returned as-is, so the caller's memo keeps its identity and MapView
// skips a needless setData.
export function filterPublicHousingByType(
  estates: PublicHousingEstate[],
  typesOn: PublicHousingTypeSet,
): PublicHousingEstate[] {
  if (PUBLIC_HOUSING_TYPE_ORDER.every(type => typesOn.has(type))) return estates
  return estates.filter(estate => typesOn.has(estate.type))
}

// How many estates carry each type, for the legend's per-type counts. Always
// has both keys, so a type with no estates reads 0 rather than undefined.
export function countPublicHousingByType(estates: PublicHousingEstate[]): Record<PublicHousingType, number> {
  const counts = Object.fromEntries(
    PUBLIC_HOUSING_TYPE_ORDER.map(type => [type, 0])
  ) as Record<PublicHousingType, number>
  for (const estate of estates) {
    if (estate.type in counts) counts[estate.type] += 1
  }
  return counts
}

// Restore the enabled types: every type minus the stored OFF list. Anything
// unreadable, non-array, or naming only unknown types degrades to "all on"
// rather than hiding the layer.
export function loadPublicHousingTypesOn(): PublicHousingTypeSet {
  try {
    const raw = localStorage.getItem(LS_PUBLIC_HOUSING_TYPES_OFF_KEY)
    if (!raw) return ALL_PUBLIC_HOUSING_TYPES
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return ALL_PUBLIC_HOUSING_TYPES
    const on = PUBLIC_HOUSING_TYPE_ORDER.filter(type => !arr.includes(type))
    if (on.length === PUBLIC_HOUSING_TYPE_ORDER.length) return ALL_PUBLIC_HOUSING_TYPES
    return new Set(on)
  } catch {
    return ALL_PUBLIC_HOUSING_TYPES
  }
}

// Persist the disabled types, in PUBLIC_HOUSING_TYPE_ORDER so the stored value
// is stable. Storage can throw (private mode, quota) — losing the preference
// is never worth breaking the toggle.
export function savePublicHousingTypesOn(types: PublicHousingTypeSet): void {
  try {
    localStorage.setItem(
      LS_PUBLIC_HOUSING_TYPES_OFF_KEY,
      JSON.stringify(PUBLIC_HOUSING_TYPE_ORDER.filter(type => !types.has(type)))
    )
    localStorage.removeItem(LS_PUBLIC_HOUSING_TYPES_LEGACY_KEY)
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// GeoJSON for the extrusion layer.
// ---------------------------------------------------------------------------

// The data stores each footprint at the height the basemap draws it; our block
// is rendered this much taller so its roof always wins the depth test against
// the basemap's roof underneath (same margin and reasoning as the schools).
export const PUBLIC_HOUSING_HEIGHT_MARGIN_M = 2

// One Polygon feature per building footprint, coloured by its estate's type
// and the decade its block was occupied. A building's own `year` (its block's
// 入伙 date) wins over the estate's; both null means "newest shade". Buildings
// with no usable ring are skipped rather than emitted as empty geometry
// (MapLibre would warn on every tile). `color` is baked into the feature so
// the paint expression stays a plain ['get', 'color'], and `estateId`
// (PUBLIC_HOUSING_FEATURE_ID_PROPERTY) doubles as the promoted feature id used
// for the selection highlight.
export function buildPublicHousingFeatures(estates: PublicHousingEstate[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const estate of estates) {
    for (const building of estate.buildings) {
      const rings = building.coordinates
      if (!rings?.length || !rings[0]?.length) continue
      const year = building.year ?? estate.year
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: rings },
        properties: {
          [PUBLIC_HOUSING_FEATURE_ID_PROPERTY]: estate.id,
          type: estate.type,
          year,
          decade: publicHousingDecade(year),
          color: publicHousingColor(estate.type, year),
          height: building.height + PUBLIC_HOUSING_HEIGHT_MARGIN_M,
          minHeight: building.minHeight,
          name: building.name,
          block: building.block,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

// ---------------------------------------------------------------------------
// Labels. IH publishes both lists in Chinese and Portuguese only, so the UI
// text is keyed on the normalised enum rather than on the upstream wording —
// the same rule schoolLevelLabel follows, and the only way the three UI
// languages can stay consistent.
// ---------------------------------------------------------------------------

export function publicHousingTypeLabel(t: Translations, type: PublicHousingType): string {
  switch (type) {
    case 'social': return t.publicHousingSocial
    case 'other': return t.publicHousingOther
    default: return t.publicHousingEconomic
  }
}

// Which programme an `other` estate belongs to. null (a social/economic
// estate) has no category line, so callers get an empty string.
export function publicHousingCategoryLabel(t: Translations, category: PublicHousingCategory | null): string {
  switch (category) {
    case 'elderly': return t.publicHousingCategoryElderly
    case 'replacement': return t.publicHousingCategoryReplacement
    case 'temporary': return t.publicHousingCategoryTemporary
    case 'sandwich': return t.publicHousingCategorySandwich
    default: return ''
  }
}

export function publicHousingDistrictLabel(t: Translations, district: PublicHousingDistrict): string {
  switch (district) {
    case 'taipa': return t.publicHousingDistrictTaipa
    case 'coloane': return t.publicHousingDistrictColoane
    default: return t.publicHousingDistrictMacau
  }
}

export function publicHousingStatusLabel(t: Translations, status: PublicHousingStatus): string {
  switch (status) {
    case 'completed': return t.publicHousingStatusCompleted
    case 'under_construction': return t.publicHousingStatusUnderConstruction
    default: return t.publicHousingStatusOccupied
  }
}

// The LABEL of the year row — what that number actually means. A record with no
// year at all keeps the neutral "year" wording, so the row still reads as a
// date field rather than claiming an occupation date it does not have.
export function publicHousingYearLabel(t: Translations, kind: PublicHousingYearKind | null): string {
  switch (kind) {
    case 'completion': return t.publicHousingCompletedLabel
    case 'expected': return t.publicHousingExpectedLabel
    case 'occupation': return t.publicHousingOccupiedLabel
    default: return t.publicHousingYearLabel
  }
}

// Estate name in the reading language. No official English form exists — IH's
// own English pages print the Chinese names — so `en` reads the Portuguese one
// and the panel shows the Chinese underneath, the rule the other zh/pt-only
// feeds already use (see pickText in src/roadWorks.ts).
export function publicHousingName(estate: PublicHousingEstate, lang: Lang): string {
  if (lang === 'zh') return estate.name.zh || estate.name.pt || ''
  return estate.name.pt || estate.name.zh || ''
}
