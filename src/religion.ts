// RELIGION overlay helpers shared by MapView (the marker layer), the legend
// and the info panel. The kind rule, the colour table and the icon names live
// here exactly once so the markers, the swatch and the panel header can never
// disagree.
//
// The first (and so far only) category is 土地公 / Tou Tei: the Earth God's
// temples (土地廟 / 福德祠) and the small street shrines (土地神壇). The
// overlay is time-independent — nothing here takes a clock.
import type { Lang } from './i18n'
import type { ReligionKind, ReligionSite, ReligionText } from './types'

// Drawing order for the marker images (also the legend's reading order):
// temples are the rarer, bigger thing, so they come first.
export const RELIGION_KIND_ORDER: readonly ReligionKind[] = ['temple', 'shrine'] as const

// Marker colours: vermilion for a temple, orange for a street shrine. Data
// colours, so literal hex like the other overlays (not theme tokens).
export const RELIGION_COLORS: Record<ReligionKind, string> = {
  temple: '#ef4444',
  shrine: '#fb923c',
}

// A site whose position is a street-level geocode (the Macau Memory map
// carries street names, not surveyed points) is drawn at this opacity so it
// reads as "somewhere on this street" rather than "exactly here".
export const RELIGION_APPROXIMATE_OPACITY = 0.55

// Name of the registered MapLibre image for a kind. Kept next to the colour
// table so MapView's `map.addImage` loop and the symbol layer's
// `['get','icon']` read the same strings.
export function religionIconName(kind: ReligionKind): string {
  return `religion-${kind}`
}

// Localised name. Only the Chinese form is guaranteed (OSM and Macau Memory
// names are Chinese-only); the IC-classified sites carry official English and
// Portuguese names, which English/Portuguese readers get when present. The
// fallback is deliberately the CHINESE name, not a translation: a shrine's
// name is the inscription on its tablet.
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

// One Point feature per site. `kind` drives the icon image, `approximate` the
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
        kind: site.kind,
        icon: religionIconName(site.kind),
        approximate: site.approximate,
        // Temples sort above shrines when markers collide, and exact points
        // above street-level guesses.
        rank: (site.kind === 'temple' ? 2 : 0) + (site.approximate ? 0 : 1),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// Register size and kind breakdown for the legend row and the panel's
// coverage note. Cheap enough to recompute per render.
export function countReligionByKind(sites: ReligionSite[]): Record<ReligionKind, number> {
  const counts: Record<ReligionKind, number> = { temple: 0, shrine: 0 }
  for (const site of sites) counts[site.kind]++
  return counts
}
