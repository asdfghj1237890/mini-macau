// Public-toilet (IAM 公廁) helpers shared by MapView (the marker layer), the
// legend and the info panel. The variant rule and its colour table live here
// exactly once so the markers, the swatch and the panel header can never
// disagree.
//
// The overlay is time-independent: unlike road works there is no "in force
// today" notion, so nothing here takes a clock.
import type { Lang } from './i18n'
import type { Toilet, ToiletText } from './types'

// Which of the three marker images a toilet gets. `closed` outranks
// `accessible`: a suspended toilet is greyed out whatever cubicles it has.
export type ToiletVariant = 'normal' | 'accessible' | 'closed'

// Registration order for the marker images (also the legend's reading order).
export const TOILET_VARIANT_ORDER: readonly ToiletVariant[] = [
  'normal', 'accessible', 'closed',
] as const

// Marker colours: teal = ordinary toilet, blue = has a barrier-free cubicle,
// grey = temporarily closed (drawn translucent on top of this).
export const TOILET_COLORS: Record<ToiletVariant, string> = {
  normal: '#14b8a6',
  accessible: '#3b82f6',
  closed: '#6b7280',
}

// Name of the registered MapLibre image for a variant. Kept next to the colour
// table so MapView's `map.addImage` loop and the symbol layer's `['get','icon']`
// read the same strings.
export function toiletIconName(variant: ToiletVariant): string {
  return `toilet-${variant}`
}

export function toiletVariant(toilet: Toilet): ToiletVariant {
  if (toilet.closed) return 'closed'
  if (toilet.accessible) return 'accessible'
  return 'normal'
}

// Localised field text. The IAM feed IS trilingual, so English readers get the
// English string — deliberately NOT the road-works `en → pt` rule, which only
// exists because that feed has no English at all. The chained fallbacks cover
// a field that is blank in one language (upstream `phone` can be empty).
export function pickToiletText(field: ToiletText | undefined, lang: Lang): string {
  if (!field) return ''
  if (lang === 'zh') return field.zh || field.en || field.pt || ''
  if (lang === 'pt') return field.pt || field.en || field.zh || ''
  return field.en || field.pt || field.zh || ''
}

// One Point feature per toilet. `variant` drives the icon image and the
// closed-marker dimming, `id` is what the click handler looks the toilet up
// by. Records with no usable coordinate pair are skipped rather than emitted
// as broken geometry (MapLibre would warn on every tile).
export function buildToiletFeatures(toilets: Toilet[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const toilet of toilets) {
    const coords = toilet.coordinates
    if (!coords || coords.length < 2) continue
    const variant = toiletVariant(toilet)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties: {
        id: toilet.id,
        variant,
        icon: toiletIconName(variant),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}
