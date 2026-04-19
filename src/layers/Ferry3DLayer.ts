import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'

export const FERRY_3D_SOURCE_ID = 'ferry-3d-source'
export const FERRY_3D_HULL_LAYER = 'ferry-3d-hull'
export const FERRY_3D_HULL_RED_LAYER = 'ferry-3d-hull-red'
export const FERRY_3D_WHITE_BAND_LAYER = 'ferry-3d-white-band'
export const FERRY_3D_CABIN_LAYER = 'ferry-3d-cabin'
export const FERRY_3D_WINDOW_LAYER = 'ferry-3d-window'
export const FERRY_3D_UPPER_LAYER = 'ferry-3d-upper'
export const FERRY_3D_WHEELHOUSE_LAYER = 'ferry-3d-wheelhouse'
export const FERRY_3D_ROOF_LAYER = 'ferry-3d-roof'

export const ALL_FERRY_3D_LAYERS = [
  FERRY_3D_HULL_LAYER,
  FERRY_3D_HULL_RED_LAYER,
  FERRY_3D_WHITE_BAND_LAYER,
  FERRY_3D_CABIN_LAYER,
  FERRY_3D_WINDOW_LAYER,
  FERRY_3D_UPPER_LAYER,
  FERRY_3D_WHEELHOUSE_LAYER,
  FERRY_3D_ROOF_LAYER,
]

// TurboJET Universal MK 2005 — scaled ~1.15× for visibility.
const LOA = 50             // length overall
const BEAM_OUTER = 7.0     // pontoon outer edge (total beam ~14m)
const BEAM_INNER = 3.2
const HULL_TAIL_Y = -LOA / 2
const HULL_SHOULDER_Y = LOA / 2 - 16   // where straight hull starts to taper
const HULL_NECK_Y = LOA / 2 - 5        // where the bow narrows down sharply
const HULL_TIP_Y = LOA / 2             // pointed knife-bow tip

// Vertical stack (meters above waterline)
const HULL_TOP = 1.9            // top of dark pontoon belt
const RED_LOWER_TOP = 3.3       // lower red hull belt
const WHITE_BAND_TOP = 3.9      // white TurboJET stripe
const CABIN_TOP = 6.8           // main cabin top
const WIN_BASE = 4.3
const WIN_TOP = 6.2
const UPPER_BACK_TOP = 8.7      // rear of upper deck (flat high)
const UPPER_FRONT_TOP = 7.8     // front of upper deck (stepped lower)
const WHEEL_TOP = 9.9           // wheelhouse main body
const WHEEL_VISOR_TOP = 9.2     // slightly-lower front of wheelhouse

// Cabin planform (shorter than hull, with a more slab-like shape)
const CABIN_LEN = 42
const CABIN_TAIL_Y = -CABIN_LEN / 2
const CABIN_SHOULDER_Y = CABIN_LEN / 2 - 7
const CABIN_TIP_Y = CABIN_LEN / 2
const CABIN_HALF_W = 6.6
const CABIN_TIP_HALF_W = 2.2

// Upper deck (centered, narrower)
const UPPER_LEN = 30
const UPPER_HALF_W = 4.8
const UPPER_FWD_OFFSET = 2
const UPPER_STEP_Y = 5           // where rear flat-top transitions to lower front

// Wheelhouse (at the bow of the upper deck)
const WHEEL_HALF_W = 3.4
const WHEEL_VISOR_LEN = 2.2      // length of the lower visor section in front

const IS_MOBILE = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
const MIN_ZOOM = IS_MOBILE ? 16 : 16.9
const M_PER_DEG = 111320

type PartKind =
  | 'hull' | 'hull_red' | 'white_band' | 'cabin' | 'window'
  | 'upper_back' | 'upper_front' | 'wheelhouse' | 'wheel_visor' | 'roof'

type FF = GeoJSON.Feature<GeoJSON.Polygon, {
  color: string; kind: PartKind; vehicleId: string; baseM: number; heightM: number
}>

function xf(lng: number, lat: number, bearingDeg: number) {
  const th = (bearingDeg * Math.PI) / 180
  const c = Math.cos(th), s = Math.sin(th)
  const cl = Math.cos((lat * Math.PI) / 180)
  const ml = 1 / M_PER_DEG
  const mg = 1 / (M_PER_DEG * Math.max(cl, 1e-6))
  return (lx: number, ly: number): [number, number] => {
    // local y = forward (bow is +y when bearing=0/north). local x = starboard.
    const rx = lx * c + ly * s
    const ry = -lx * s + ly * c
    return [lng + rx * mg, lat + ry * ml]
  }
}

// One pontoon with a long straight section, then a sharp knife-bow that
// tapers almost to a point (TurboJet's distinctive blade profile).
function pontoonPolygon(lng: number, lat: number, b: number, side: 1 | -1): [number, number][] {
  const t = xf(lng, lat, b)
  const xi = side * BEAM_INNER
  const xo = side * BEAM_OUTER
  const tipX = side * 0.25
  const neckOuter = side * (BEAM_OUTER - 2.2)
  const neckInner = side * (BEAM_INNER + 0.3)
  return [
    t(xi, HULL_TAIL_Y),
    t(xo, HULL_TAIL_Y),
    t(xo, HULL_SHOULDER_Y),
    t(neckOuter, HULL_NECK_Y),
    t(tipX, HULL_TIP_Y),
    t(neckInner, HULL_NECK_Y),
    t(xi, HULL_SHOULDER_Y),
    t(xi, HULL_TAIL_Y),
  ]
}

// The main hull planform (spans both pontoons) — used for the lower red belt
// and the white band. Has a distinct pointed bow.
function hullPlanform(lng: number, lat: number, b: number): [number, number][] {
  const t = xf(lng, lat, b)
  return [
    t(-BEAM_OUTER, HULL_TAIL_Y),
    t(BEAM_OUTER, HULL_TAIL_Y),
    t(BEAM_OUTER, HULL_SHOULDER_Y),
    t(BEAM_OUTER - 2.2, HULL_NECK_Y),
    t(0, HULL_TIP_Y + 0.5),
    t(-(BEAM_OUTER - 2.2), HULL_NECK_Y),
    t(-BEAM_OUTER, HULL_SHOULDER_Y),
    t(-BEAM_OUTER, HULL_TAIL_Y),
  ]
}

function cabinPolygon(
  lng: number, lat: number, b: number,
  halfW: number, tipHalfW: number, tailY: number, shoulderY: number, tipY: number,
): [number, number][] {
  const t = xf(lng, lat, b)
  return [
    t(-halfW, tailY),
    t(halfW, tailY),
    t(halfW, shoulderY),
    t(tipHalfW, tipY),
    t(-tipHalfW, tipY),
    t(-halfW, shoulderY),
    t(-halfW, tailY),
  ]
}

// Rectangular slab in local coords (with optional nose taper).
function rectSlab(
  lng: number, lat: number, b: number,
  halfW: number, tailY: number, tipY: number, tipHalfW = halfW,
): [number, number][] {
  const t = xf(lng, lat, b)
  return [
    t(-halfW, tailY),
    t(halfW, tailY),
    t(tipHalfW, tipY),
    t(-tipHalfW, tipY),
    t(-halfW, tailY),
  ]
}

// Thin longitudinal window band hugging the outer cabin wall.
function windowStrip(lng: number, lat: number, b: number, side: 1 | -1): [number, number][] {
  const t = xf(lng, lat, b)
  const outer = side * (CABIN_HALF_W - 0.15)
  const inner = side * (CABIN_HALF_W - 0.75)
  const tailY = CABIN_TAIL_Y + 2
  const fwdY = CABIN_SHOULDER_Y - 1.5
  return [
    t(inner, tailY),
    t(outer, tailY),
    t(outer, fwdY),
    t(inner, fwdY),
    t(inner, tailY),
  ]
}

function mk(
  coords: [number, number][], kind: PartKind, color: string,
  vid: string, baseM: number, heightM: number,
): FF {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: { color, kind, vehicleId: vid, baseM, heightM },
  }
}

function darken(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = Math.round(((n >> 16) & 0xff) * factor)
  const g = Math.round(((n >> 8) & 0xff) * factor)
  const bl = Math.round((n & 0xff) * factor)
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`
}

function buildFerryFeatures(ferries: VehiclePosition[]): FF[] {
  const out: FF[] = []
  const DARK_HULL = '#111827'
  const WHITE = '#f1f5f9'
  const WINDOW_DARK = '#0b1220'

  for (const v of ferries) {
    const [lng, lat] = v.coordinates
    const id = v.id
    const b = v.bearing
    // Roof equipment slab: a darker shade of the operator's hull colour so
    // both red (TurboJet) and blue (Cotai) ferries read as the right brand.
    const ROOF_DARK = darken(v.color, 0.5)

    // 1. Twin pontoon dark hulls (with pointed knife-bows)
    for (const side of [-1, 1] as const) {
      out.push(mk(pontoonPolygon(lng, lat, b, side), 'hull', DARK_HULL, id, 0, HULL_TOP))
    }

    // 2. Unified red lower hull belt (bridges the two pontoons)
    const hull = hullPlanform(lng, lat, b)
    out.push(mk(hull, 'hull_red', v.color, id, HULL_TOP, RED_LOWER_TOP))

    // 3. White TurboJet band
    out.push(mk(hull, 'white_band', WHITE, id, RED_LOWER_TOP, WHITE_BAND_TOP))

    // 4. Main red cabin (slightly inset from hull sides)
    const cabinShape = cabinPolygon(
      lng, lat, b,
      CABIN_HALF_W, CABIN_TIP_HALF_W,
      CABIN_TAIL_Y, CABIN_SHOULDER_Y, CABIN_TIP_Y,
    )
    out.push(mk(cabinShape, 'cabin', v.color, id, WHITE_BAND_TOP, CABIN_TOP))

    // 5. Dark window strips on each side of the main cabin
    for (const side of [-1, 1] as const) {
      out.push(mk(windowStrip(lng, lat, b, side), 'window', WINDOW_DARK, id, WIN_BASE, WIN_TOP))
    }

    // 6. Upper deck — rear (flat high) and front (stepped down) to fake a slope
    const upperTail = -UPPER_LEN / 2 + UPPER_FWD_OFFSET
    const upperStep = UPPER_STEP_Y + UPPER_FWD_OFFSET
    const upperTip  = UPPER_LEN / 2 + UPPER_FWD_OFFSET
    const upperBack = rectSlab(lng, lat, b, UPPER_HALF_W, upperTail, upperStep)
    out.push(mk(upperBack, 'upper_back', v.color, id, CABIN_TOP, UPPER_BACK_TOP))

    const upperFront = cabinPolygon(
      lng, lat, b,
      UPPER_HALF_W, 1.4,
      upperStep, upperTip - 3, upperTip,
    )
    out.push(mk(upperFront, 'upper_front', v.color, id, CABIN_TOP, UPPER_FRONT_TOP))

    // Dark "roof" on the rear upper deck (a thin strip to imply equipment)
    const roof = rectSlab(lng, lat, b, UPPER_HALF_W - 0.4, upperTail + 1, upperStep - 0.5)
    out.push(mk(roof, 'roof', ROOF_DARK, id, UPPER_BACK_TOP, UPPER_BACK_TOP + 0.4))

    // 7. Wheelhouse — red, at the bow of the upper deck
    const whTail = upperStep + 0.3
    const whTip  = upperTip - 1.2
    const wheelhouse = cabinPolygon(
      lng, lat, b,
      WHEEL_HALF_W, 2.0,
      whTail, whTip - WHEEL_VISOR_LEN, whTip,
    )
    out.push(mk(wheelhouse, 'wheelhouse', v.color, id, UPPER_FRONT_TOP, WHEEL_TOP))

    // Visor — a lower forward lip on the wheelhouse
    const visor = cabinPolygon(
      lng, lat, b,
      WHEEL_HALF_W - 0.1, 0.9,
      whTip - WHEEL_VISOR_LEN, whTip - 0.6, whTip + 0.5,
    )
    out.push(mk(visor, 'wheel_visor', v.color, id, WHEEL_VISOR_TOP, WHEEL_TOP - 0.2))
  }
  return out
}

function makeExtrusion(id: string, kind: PartKind, opacity: number) {
  return {
    id,
    type: 'fill-extrusion' as const,
    source: FERRY_3D_SOURCE_ID,
    filter: ['==', ['get', 'kind'], kind],
    minzoom: MIN_ZOOM,
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-base': ['get', 'baseM'],
      'fill-extrusion-height': ['get', 'heightM'],
      'fill-extrusion-opacity': opacity,
    },
  } as Parameters<MapLibreMap['addLayer']>[0]
}

export class Ferry3DLayer {
  private map: MapLibreMap | null = null

  attach(map: MapLibreMap): void {
    this.map = map

    map.addSource(FERRY_3D_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    // Order matters for painter's order on overlapping extrusions.
    map.addLayer(makeExtrusion(FERRY_3D_HULL_LAYER, 'hull', 0.97))
    map.addLayer(makeExtrusion(FERRY_3D_HULL_RED_LAYER, 'hull_red', 0.97))
    map.addLayer(makeExtrusion(FERRY_3D_WHITE_BAND_LAYER, 'white_band', 0.98))
    map.addLayer(makeExtrusion(FERRY_3D_CABIN_LAYER, 'cabin', 0.96))
    map.addLayer(makeExtrusion(FERRY_3D_WINDOW_LAYER, 'window', 0.94))
    map.addLayer(makeExtrusion('ferry-3d-upper-back', 'upper_back', 0.96))
    map.addLayer(makeExtrusion(FERRY_3D_UPPER_LAYER, 'upper_front', 0.96))
    map.addLayer(makeExtrusion(FERRY_3D_ROOF_LAYER, 'roof', 0.9))
    map.addLayer(makeExtrusion(FERRY_3D_WHEELHOUSE_LAYER, 'wheelhouse', 0.95))
    map.addLayer(makeExtrusion('ferry-3d-wheel-visor', 'wheel_visor', 0.95))
  }

  detach(): void {
    const map = this.map
    if (!map) return
    const ids = [
      ...ALL_FERRY_3D_LAYERS,
      'ferry-3d-upper-back',
      'ferry-3d-wheel-visor',
    ]
    for (const id of ids) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(FERRY_3D_SOURCE_ID)) map.removeSource(FERRY_3D_SOURCE_ID)
    this.map = null
  }

  setVehicles(ferries: VehiclePosition[]): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(FERRY_3D_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    if (map.getZoom() < MIN_ZOOM - 0.5) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    src.setData({ type: 'FeatureCollection', features: buildFerryFeatures(ferries) })
  }
}
