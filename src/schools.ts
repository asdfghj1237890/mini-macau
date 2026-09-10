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
//
// Colour carries two facts, the same way the public-housing blocks do: the
// HUE is the teaching stage, the SHADE is the era the school was founded
// (its own 校史 year, from schools.json `founded`) — oldest darkest, newest
// lightest.
import type { Translations } from './i18n'
import type { School, SchoolLevel } from './types'

// Display order of the legend's colour key: the teaching stages in ascending
// order, with the all-through combination last.
export const SCHOOL_LEVEL_ORDER: readonly SchoolLevel[] = [
  'kindergarten', 'primary', 'secondary', 'university', 'all_through',
] as const

// Era stops of the shade ramp, by founding year: before 1900 (the oldest
// schools on the register trace back to the 1800s), the first half of the
// twentieth century, the post-war decades, the 1980s–90s, and 2000 onwards.
// `0` stands for "before 1900".
export const SCHOOL_ERAS = [0, 1900, 1950, 1980, 2000] as const
export type SchoolEra = (typeof SCHOOL_ERAS)[number]

// Level → era → block colour (literal data colours). The five hue families
// deliberately stay clear of the public-housing ones (orange, teal, violet),
// because the two overlays can be on together: kindergarten fuchsia, primary
// crimson, secondary blue, university leaf green, all-through gold. Within a
// family the five stops step from a deep shade (founded before 1900) to a
// pale tint (founded 2000 or later).
export const SCHOOL_COLORS: Record<SchoolLevel, Record<SchoolEra, string>> = {
  kindergarten: {
    0: '#701a4b',
    1900: '#a1256b',
    1950: '#d43d90',
    1980: '#ec7ab8',
    2000: '#f8c2dd',
  },
  primary: {
    0: '#7a1b28',
    1900: '#a8283a',
    1950: '#d63c4f',
    1980: '#ef7c8a',
    2000: '#f9c0c7',
  },
  secondary: {
    0: '#1e3a8a',
    1900: '#1d4ed8',
    1950: '#3b82f6',
    1980: '#7fb2fa',
    2000: '#c3dafd',
  },
  university: {
    0: '#1f4d12',
    1900: '#2f7a1c',
    1950: '#46a428',
    1980: '#7fcc5f',
    2000: '#c0e8ad',
  },
  all_through: {
    0: '#5c4a0e',
    1900: '#8a6d12',
    1950: '#c49a1a',
    1980: '#e2bd4a',
    2000: '#f3e0a0',
  },
}

// The ramp's middle stop doubles as the level's identity colour (legend
// glyphs, the panel badge) so a single swatch still reads as "that family".
export const SCHOOL_LEVEL_COLOR: Record<SchoolLevel, string> = {
  kindergarten: SCHOOL_COLORS.kindergarten[1950],
  primary: SCHOOL_COLORS.primary[1950],
  secondary: SCHOOL_COLORS.secondary[1950],
  university: SCHOOL_COLORS.university[1950],
  all_through: SCHOOL_COLORS.all_through[1950],
}

// The era stop a founding year falls in. A school with no known founding
// year (`null`) takes the MIDDLE stop — the level's identity colour — rather
// than either end, because "unknown" is neither the oldest nor the newest and
// the legend must not read a missing fact as a date.
export function schoolEra(founded: number | null | undefined): SchoolEra {
  if (founded == null || !Number.isFinite(founded)) return 1950
  let era: SchoolEra = SCHOOL_ERAS[0]
  for (const stop of SCHOOL_ERAS) {
    if (founded >= stop) era = stop
  }
  return era
}

// Block colour for a level + founding year.
export function schoolColor(level: SchoolLevel, founded: number | null | undefined): string {
  const family = SCHOOL_COLORS[level] ?? SCHOOL_COLORS.all_through
  return family[schoolEra(founded)]
}

// The five stops of a level's ramp in era order, for the legend's gradient
// strip (dark → light, left → right).
export function schoolRamp(level: SchoolLevel): string[] {
  const family = SCHOOL_COLORS[level] ?? SCHOOL_COLORS.all_through
  return SCHOOL_ERAS.map(era => family[era])
}

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

// One Polygon feature per building footprint, coloured by its school's level
// and founding era. Buildings with no usable ring are skipped rather than
// emitted as empty geometry (MapLibre would warn on every tile). `color` is
// baked into the feature so the paint expression stays a plain
// ['get', 'color'], and `schoolId` (SCHOOL_FEATURE_ID_PROPERTY) doubles as the
// promoted feature id used for the selection highlight.
// The data stores each footprint at the height the basemap draws it. Our block
// is rendered this much taller so its roof always wins the depth test against
// the basemap's roof underneath: 0.5 m was not enough — large, low roofs
// (a 5 m school hall seen at 60° pitch) z-fought into white streaks, and the
// z14→15.5 height ramp scales any margin down with it.
export const SCHOOL_HEIGHT_MARGIN_M = 2

export function buildSchoolFeatures(schools: School[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const school of schools) {
    const founded = school.founded ?? null
    const color = schoolColor(school.level, founded)
    for (const building of school.buildings) {
      const rings = building.coordinates
      if (!rings?.length || !rings[0]?.length) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: rings },
        properties: {
          schoolId: school.id,
          level: school.level,
          founded,
          era: schoolEra(founded),
          color,
          height: building.height + SCHOOL_HEIGHT_MARGIN_M,
          minHeight: building.minHeight,
          name: building.name,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
