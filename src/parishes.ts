// Parish-overlay helpers shared by MapView (fill + outline + label layers),
// the legend (the colour key) and the info panel. The colour table lives here
// exactly once so the map and the legend can never disagree.
//
// PARISHES · 堂區 is a context layer, not a data overlay: Macau's seven civil
// parishes (freguesias) plus the Cotai reclamation zone, which the government's
// own maps show as an eighth area although it belongs to no parish. It draws a
// faint tint and a thin outline per area with the area's name, and stacks with
// every other layer (it is not a focus mode).
import type { Parish, ParishSlug } from './types'

// Legend order: the peninsula's five parishes north → south, then the islands.
export const PARISH_ORDER: readonly ParishSlug[] = [
  'fatima', 'santo-antonio', 'sao-lazaro', 'se', 'sao-lourenco', 'carmo', 'sao-francisco', 'cotai',
] as const

// Slug → tint (literal data colours). Deliberately muted pastels: they are
// painted at PARISH_FILL_OPACITY under everything else, so they must read as
// a wash the buildings, vehicles and the other overlays sit on, never as a
// colour of their own — and none is the orange / teal / violet of the housing
// blocks or a school-stage hue. Cotai, the one non-parish, is the neutral grey.
export const PARISH_COLORS: Record<ParishSlug, string> = {
  'fatima': '#d4a373',
  'santo-antonio': '#b5838d',
  'sao-lazaro': '#a3b18a',
  'se': '#8d99ae',
  'sao-lourenco': '#b39bc8',
  'carmo': '#9fc5e8',
  'sao-francisco': '#b8b07a',
  'cotai': '#bcb8b1',
}

// Fill and outline strengths. The fill is a tint (the user asked for a light
// wash), the outline carries the boundary; labels are the symbol layer's.
export const PARISH_FILL_OPACITY = 0.16
export const PARISH_LINE_OPACITY = 0.65
export const PARISH_LINE_WIDTH_PX = 1.2

// Labels show at overview zooms and step out once the map is close enough for
// buildings to matter — a parish name across a street block is noise.
export const PARISH_LABEL_MAX_ZOOM = 15.5

// The feature property MapView promotes to the GeoJSON feature id
// (`promoteId`), so a selection highlight is one setFeatureState per area.
export const PARISH_FEATURE_ID_PROPERTY = 'parishId'

// Tint for an area, with a grey fallback for a slug the table does not know
// (a future ninth area would still draw rather than crash the layer).
export function parishColor(slug: ParishSlug | string): string {
  return (PARISH_COLORS as Record<string, string>)[slug] ?? PARISH_COLORS.cotai
}

// Area name in the reading language. All three exist upstream (zh/pt are OSM's
// official names, en is OSM's or the government's English form), so this is a
// plain pick with zh as the last resort.
export function parishName(parish: Parish, lang: 'en' | 'zh' | 'pt'): string {
  if (lang === 'zh') return parish.name.zh || parish.name.pt || ''
  if (lang === 'pt') return parish.name.pt || parish.name.zh || ''
  return parish.name.en || parish.name.pt || parish.name.zh || ''
}

// Residents per km². The pipeline's figure wins when it carries one — the
// census population and the land-area table do not always share a
// denominator (Coloane's count includes Cotai, whose area is a separate row)
// — else the plain quotient, or null when either figure is missing.
export function parishDensity(parish: Parish): number | null {
  if (parish.densityPerKm2 != null) return Math.round(parish.densityPerKm2)
  if (parish.population == null || parish.areaKm2 == null || parish.areaKm2 <= 0) return null
  return Math.round(parish.population / parish.areaKm2)
}

// One MultiPolygon feature per area for the fill and outline layers. `color`
// is baked in so the paint stays a plain ['get', 'color']; all three names
// ride along so the label layer can switch language with a layout property
// instead of a rebuild. Areas with no usable ring are skipped rather than
// emitted as empty geometry.
export function buildParishFeatures(parishes: Parish[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const parish of parishes) {
    const polygons = parish.geometry.filter(rings => rings?.length && rings[0]?.length >= 4)
    if (!polygons.length) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: polygons },
      properties: {
        [PARISH_FEATURE_ID_PROPERTY]: parish.id,
        slug: parish.slug,
        kind: parish.kind,
        color: parishColor(parish.slug),
        name_zh: parish.name.zh,
        name_pt: parish.name.pt,
        name_en: parish.name.en,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// One Point feature per area at its label anchor (the pipeline's
// representative point, always inside the polygon), for the symbol layer.
export function buildParishLabelFeatures(parishes: Parish[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: parishes.map(parish => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: parish.coordinates },
      properties: {
        [PARISH_FEATURE_ID_PROPERTY]: parish.id,
        slug: parish.slug,
        kind: parish.kind,
        color: parishColor(parish.slug),
        name_zh: parish.name.zh,
        name_pt: parish.name.pt,
        name_en: parish.name.en,
      },
    })),
  }
}
