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
