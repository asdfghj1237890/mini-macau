// School-overlay helpers shared by MapView (the extrusion layer) and the
// legend (the colour key). The colour table lives here exactly once so the
// blocks on the map and the swatches in the legend can never disagree.
//
// Why we draw our own extrusions instead of tinting the basemap: the
// OpenFreeMap building tiles merge same-height buildings into one
// multipolygon feature (a z14 tile holds ~8,000 buildings in ~120 features),
// so a feature-state tint on `3d-buildings` would colour every building that
// happens to share a height. schools.json therefore ships the footprints
// themselves, pre-buffered and raised half a metre by the pipeline.
import type { Translations } from './i18n'
import type { School, SchoolLevel } from './types'

// Level → block colour (user-specified). Kindergarten red, primary pink,
// secondary blue, university green, all-through purple.
export const SCHOOL_COLORS: Record<SchoolLevel, string> = {
  kindergarten: '#ef4444',
  primary: '#f472b6',
  secondary: '#3b82f6',
  university: '#22c55e',
  all_through: '#a855f7',
}

// Display order of the legend's colour key: the teaching stages in ascending
// order, with the all-through combination last.
export const SCHOOL_LEVEL_ORDER: readonly SchoolLevel[] = [
  'kindergarten', 'primary', 'secondary', 'university', 'all_through',
] as const

// The feature property MapView promotes to the GeoJSON feature id
// (`promoteId`). Every building of a school carries the same value, so ONE
// setFeatureState call lights up the whole campus — see MapView's schools
// source.
export const SCHOOL_FEATURE_ID_PROPERTY = 'schoolId'

// ---------------------------------------------------------------------------
// Per-level visibility. The legend's SCHOOLS row toggles individual teaching
// stages, so App filters the school array before it reaches MapView (the map
// layer itself stays a single source rebuilt on array identity change).
// ---------------------------------------------------------------------------

export type SchoolLevelSet = ReadonlySet<SchoolLevel>

// Every level enabled — the default, and the fallback for missing/corrupt
// storage.
export const ALL_SCHOOL_LEVELS: SchoolLevelSet = new Set(SCHOOL_LEVEL_ORDER)

// localStorage key for the enabled levels (a JSON array of level names).
const LS_SCHOOL_LEVELS_KEY = 'mini-macau-school-levels-on'

// Schools whose level is switched on. When every level is enabled the input
// array is returned as-is, so the caller's memo keeps its identity and MapView
// skips a needless setData.
export function filterSchoolsByLevel(schools: School[], levelsOn: SchoolLevelSet): School[] {
  if (SCHOOL_LEVEL_ORDER.every(level => levelsOn.has(level))) return schools
  return schools.filter(school => levelsOn.has(school.level))
}

// How many schools carry each level, for the legend's per-type counts. Always
// has all five keys, so a level with no schools reads 0 rather than undefined.
export function countSchoolsByLevel(schools: School[]): Record<SchoolLevel, number> {
  const counts = Object.fromEntries(
    SCHOOL_LEVEL_ORDER.map(level => [level, 0])
  ) as Record<SchoolLevel, number>
  for (const school of schools) {
    if (school.level in counts) counts[school.level] += 1
  }
  return counts
}

// Restore the enabled levels. Anything unreadable, non-array, or holding
// unknown level names degrades to "all on" rather than hiding the layer.
export function loadSchoolLevelsOn(): SchoolLevelSet {
  try {
    const raw = localStorage.getItem(LS_SCHOOL_LEVELS_KEY)
    if (!raw) return ALL_SCHOOL_LEVELS
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return ALL_SCHOOL_LEVELS
    return new Set(
      SCHOOL_LEVEL_ORDER.filter(level => arr.includes(level))
    )
  } catch {
    return ALL_SCHOOL_LEVELS
  }
}

// Persist the enabled levels, in SCHOOL_LEVEL_ORDER so the stored value is
// stable. Storage can throw (private mode, quota) — losing the preference is
// never worth breaking the toggle.
export function saveSchoolLevelsOn(levels: SchoolLevelSet): void {
  try {
    localStorage.setItem(
      LS_SCHOOL_LEVELS_KEY,
      JSON.stringify(SCHOOL_LEVEL_ORDER.filter(level => levels.has(level)))
    )
  } catch { /* ignore */ }
}

// UI label for a level, for the legend's colour key. Uses the normalised enum
// (not the school's own name) so the three UI languages stay consistent.
export function schoolLevelLabel(t: Translations, level: SchoolLevel): string {
  switch (level) {
    case 'kindergarten': return t.schoolLevelKindergarten
    case 'primary': return t.schoolLevelPrimary
    case 'secondary': return t.schoolLevelSecondary
    case 'university': return t.schoolLevelUniversity
    default: return t.schoolLevelAllThrough
  }
}

// UI label for the ownership/system field. `system` is a free-form string in
// schools.json ('private' | 'public' | 'tertiary'); anything unexpected falls
// back to the private wording, which is what the DSEDJ register is
// overwhelmingly made of.
export function schoolSystemLabel(t: Translations, system: string): string {
  switch (system) {
    case 'public': return t.schoolSystemPublic
    case 'tertiary': return t.schoolSystemTertiary
    default: return t.schoolSystemPrivate
  }
}

// The DSEDJ register number behind a `dsedj:[002]` id — "002", without the
// brackets. Tertiary institutions come straight from OSM (`osm:w123`) and
// carry no register number, so they get null.
export function schoolDsedjCode(id: string): string | null {
  const m = /^dsedj:\[(.+)]$/.exec(id)
  return m ? m[1] : null
}

// One Polygon feature per building footprint, coloured by its school's level.
// Buildings with no usable ring are skipped rather than emitted as empty
// geometry (MapLibre would warn on every tile). `color` is baked into the
// feature so the paint expression stays a plain ['get', 'color'], and
// `schoolId` (SCHOOL_FEATURE_ID_PROPERTY) doubles as the promoted feature id
// used for the selection highlight.
export function buildSchoolFeatures(schools: School[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const school of schools) {
    const color = SCHOOL_COLORS[school.level] ?? SCHOOL_COLORS.all_through
    for (const building of school.buildings) {
      const rings = building.coordinates
      if (!rings?.length || !rings[0]?.length) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: rings },
        properties: {
          schoolId: school.id,
          level: school.level,
          color,
          height: building.height,
          minHeight: building.minHeight,
          name: building.name,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
