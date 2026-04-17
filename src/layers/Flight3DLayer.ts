import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'

export const FLIGHT_3D_SOURCE_ID = 'flight-3d-source'
export const FLIGHT_3D_FUSELAGE_LAYER = 'flight-3d-fuselage'
export const FLIGHT_3D_WING_LAYER = 'flight-3d-wing'
export const FLIGHT_3D_TAIL_LAYER = 'flight-3d-tail'
export const FLIGHT_3D_ENGINE_LAYER = 'flight-3d-engine'
export const FLIGHT_3D_VTAIL_LAYER = 'flight-3d-vtail'
export const FLIGHT_3D_WINDOW_LAYER = 'flight-3d-window'
export const FLIGHT_3D_NOSE_LAYER = 'flight-3d-nose'

export const ALL_FLIGHT_3D_LAYERS = [
  FLIGHT_3D_VTAIL_LAYER,
  FLIGHT_3D_ENGINE_LAYER,
  FLIGHT_3D_NOSE_LAYER,
  FLIGHT_3D_WINDOW_LAYER,
  FLIGHT_3D_WING_LAYER,
  FLIGHT_3D_TAIL_LAYER,
  FLIGHT_3D_FUSELAGE_LAYER,
]

const FUSE_LEN = 220
const FUSE_W = 28
const BODY_H = 28

const WING_ROOT = 60
const WING_TIP = 18
const WING_HALF_SPAN = 104
const WING_SWEEP = 36
const WING_Y = 0

const HTAIL_ROOT = 28
const HTAIL_TIP = 10
const HTAIL_HALF_SPAN = 36
const HTAIL_SWEEP = 20
const HTAIL_Y = -(FUSE_LEN / 2 - 16)

const VTAIL_ROOT = 44
const VTAIL_TIP_CHORD = 20
const VTAIL_Y = HTAIL_Y + 4
const VTAIL_H = 76

const ENG_LEN = 32
const ENG_W = 14
const ENG_X = 48
const ENG_Y = WING_Y + 8

const IS_MOBILE = window.matchMedia('(max-width: 639px)').matches
const MIN_ZOOM = IS_MOBILE ? 11 : 12
const M_PER_DEG = 111320

type PartKind = 'fuselage' | 'wing' | 'tail' | 'engine' | 'vtail' | 'window' | 'nose'
type FF = GeoJSON.Feature<GeoJSON.Polygon, {
  color: string; kind: PartKind; vehicleId: string; baseM: number; heightM: number
}>

function xf(lng: number, lat: number, bearingDeg: number, sc = 1) {
  const th = (bearingDeg * Math.PI) / 180
  const c = Math.cos(th), s = Math.sin(th)
  const cl = Math.cos((lat * Math.PI) / 180)
  const ml = sc / M_PER_DEG
  const mg = sc / (M_PER_DEG * Math.max(cl, 1e-6))
  return (lx: number, ly: number): [number, number] => {
    const rx = lx * c + ly * s
    const ry = -lx * s + ly * c
    return [lng + rx * mg, lat + ry * ml]
  }
}

function fuselagePolygon(lng: number, lat: number, b: number, sc = 1): [number, number][] {
  const t = xf(lng, lat, b, sc)
  const halfL = FUSE_LEN / 2
  const halfW = FUSE_W / 2
  const pts: [number, number][] = []
  const N = 8

  // right side from nose to tail
  // nose cone - smooth elliptical
  for (let i = 0; i <= N; i++) {
    const a = Math.PI / 2 - (i / N) * (Math.PI / 2)
    pts.push(t(Math.sin(a) * halfW, halfL + Math.cos(a) * 36))
  }
  // straight body right
  pts.push(t(halfW, halfL))
  pts.push(t(halfW, -halfL + 52))
  // tail cone - gradual taper
  pts.push(t(halfW * 0.7, -halfL + 32))
  pts.push(t(halfW * 0.35, -halfL + 12))
  pts.push(t(4, -halfL - 20))
  // tail tip center
  pts.push(t(0, -halfL - 28))
  // left tail cone
  pts.push(t(-4, -halfL - 20))
  pts.push(t(-halfW * 0.35, -halfL + 12))
  pts.push(t(-halfW * 0.7, -halfL + 32))
  pts.push(t(-halfW, -halfL + 52))
  // straight body left
  pts.push(t(-halfW, halfL))
  // nose left
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * (Math.PI / 2)
    pts.push(t(-Math.sin(a) * halfW, halfL + Math.cos(a) * 36))
  }

  pts.push(pts[0])
  return pts
}

function wingPolygon(lng: number, lat: number, b: number, side: 1 | -1, sc = 1): [number, number][] {
  const t = xf(lng, lat, b, sc)
  const rootFwd = WING_Y + WING_ROOT / 2
  const rootAft = WING_Y - WING_ROOT / 2
  const tipFwd = WING_Y + WING_TIP / 2 - WING_SWEEP
  const tipAft = WING_Y - WING_TIP / 2 - WING_SWEEP * 0.4

  return [
    t(side * (FUSE_W / 2 - 2), rootFwd),
    t(side * (WING_HALF_SPAN - 8), tipFwd),
    t(side * WING_HALF_SPAN, tipFwd - 4),
    t(side * WING_HALF_SPAN, tipAft + 2),
    t(side * (WING_HALF_SPAN - 8), tipAft),
    t(side * (FUSE_W / 2 - 2), rootAft),
    t(side * (FUSE_W / 2 - 2), rootFwd),
  ]
}

function htailPolygon(lng: number, lat: number, b: number, side: 1 | -1, sc = 1): [number, number][] {
  const t = xf(lng, lat, b, sc)
  const rootFwd = HTAIL_Y + HTAIL_ROOT / 2
  const rootAft = HTAIL_Y - HTAIL_ROOT / 2
  const tipFwd = HTAIL_Y + HTAIL_TIP / 2 - HTAIL_SWEEP
  const tipAft = HTAIL_Y - HTAIL_TIP / 2 - HTAIL_SWEEP * 0.3

  return [
    t(side * 3, rootFwd),
    t(side * HTAIL_HALF_SPAN, tipFwd),
    t(side * HTAIL_HALF_SPAN, tipAft),
    t(side * 3, rootAft),
    t(side * 3, rootFwd),
  ]
}

function vtailPolygon(lng: number, lat: number, b: number, sc = 1): [number, number][] {
  const t = xf(lng, lat, b, sc)
  const rootFwd = VTAIL_Y + VTAIL_ROOT / 2
  const tipFwd = VTAIL_Y + VTAIL_TIP_CHORD / 2 - 24
  const tipAft = VTAIL_Y - VTAIL_TIP_CHORD / 2 - 12

  return [
    t(-4, rootFwd),
    t(4, rootFwd),
    t(3, tipFwd),
    t(2, tipAft),
    t(-2, tipAft),
    t(-3, tipFwd),
    t(-4, rootFwd),
  ]
}

function enginePolygon(lng: number, lat: number, b: number, side: 1 | -1, sc = 1): [number, number][] {
  const t = xf(lng, lat, b, sc)
  const cx = side * ENG_X
  const cy = ENG_Y
  const hL = ENG_LEN / 2, hW = ENG_W / 2
  const S = 6
  const pts: [number, number][] = []
  for (let i = 0; i <= S * 2; i++) {
    const a = (Math.PI * 2 * i) / (S * 2)
    pts.push(t(cx + Math.cos(a) * hW, cy + Math.sin(a) * hL))
  }
  pts.push(pts[0])
  return pts
}

function windowDots(
  lng: number, lat: number, b: number, side: 1 | -1, sc = 1,
): [number, number][][] {
  const t = xf(lng, lat, b, sc)
  const halfL = FUSE_LEN / 2
  const wx = side * (FUSE_W / 2 - 1.6)
  const winStart = halfL - 8
  const winEnd = -halfL + 60
  const dotLen = 7
  const gap = 4.0
  const dotW = 3.6
  const polys: [number, number][][] = []

  let y = winStart
  while (y - dotLen > winEnd) {
    const y1 = y, y2 = y - dotLen
    polys.push([
      t(wx - dotW / 2, y1),
      t(wx + dotW / 2, y1),
      t(wx + dotW / 2, y2),
      t(wx - dotW / 2, y2),
      t(wx - dotW / 2, y1),
    ])
    y -= dotLen + gap
  }
  return polys
}

function cockpitWindshield(lng: number, lat: number, b: number, sc = 1): [number, number][] {
  const t = xf(lng, lat, b, sc)
  const noseY = FUSE_LEN / 2
  return [
    t(-9, noseY + 4),
    t(9, noseY + 4),
    t(6, noseY + 20),
    t(-6, noseY + 20),
    t(-9, noseY + 4),
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

function buildFlightFeatures(flights: VehiclePosition[]): FF[] {
  const out: FF[] = []
  for (const v of flights) {
    const [lng, lat] = v.coordinates
    const alt = v.altitude ?? 0
    const id = v.id, b = v.bearing, c = v.color
    const sc = v.scale ?? 1
    const bh = BODY_H * sc
    const vh = VTAIL_H * sc

    out.push(mk(fuselagePolygon(lng, lat, b, sc), 'fuselage', c, id, alt, alt + bh))

    out.push(mk(cockpitWindshield(lng, lat, b, sc), 'nose', c, id,
      alt + bh * 0.4, alt + bh * 0.75))

    for (const side of [-1, 1] as const) {
      for (const poly of windowDots(lng, lat, b, side, sc)) {
        out.push(mk(poly, 'window', c, id,
          alt + bh * 0.5, alt + bh * 0.72))
      }
    }

    for (const side of [-1, 1] as const) {
      out.push(mk(wingPolygon(lng, lat, b, side, sc), 'wing', c, id,
        alt + bh * 0.28, alt + bh * 0.42))
    }

    for (const side of [-1, 1] as const) {
      out.push(mk(htailPolygon(lng, lat, b, side, sc), 'tail', c, id,
        alt + bh * 0.65, alt + bh * 0.8))
    }

    out.push(mk(vtailPolygon(lng, lat, b, sc), 'vtail', c, id,
      alt + bh, alt + bh + vh))

    for (const side of [-1, 1] as const) {
      out.push(mk(enginePolygon(lng, lat, b, side, sc), 'engine', c, id,
        alt - 4 * sc, alt + bh * 0.28))
    }
  }
  return out
}

export class Flight3DLayer {
  private map: MapLibreMap | null = null

  attach(map: MapLibreMap): void {
    this.map = map

    map.addSource(FLIGHT_3D_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    map.addLayer({
      id: FLIGHT_3D_FUSELAGE_LAYER,
      type: 'fill-extrusion',
      source: FLIGHT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'fuselage'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#f8fafc',
        'fill-extrusion-base': ['get', 'baseM'],
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-opacity': 0.97,
      },
    })

    map.addLayer({
      id: FLIGHT_3D_WING_LAYER,
      type: 'fill-extrusion',
      source: FLIGHT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'wing'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#e2e8f0',
        'fill-extrusion-base': ['get', 'baseM'],
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-opacity': 0.94,
      },
    })

    map.addLayer({
      id: FLIGHT_3D_TAIL_LAYER,
      type: 'fill-extrusion',
      source: FLIGHT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'tail'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#e2e8f0',
        'fill-extrusion-base': ['get', 'baseM'],
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-opacity': 0.94,
      },
    })

    map.addLayer({
      id: FLIGHT_3D_ENGINE_LAYER,
      type: 'fill-extrusion',
      source: FLIGHT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'engine'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#94a3b8',
        'fill-extrusion-base': ['get', 'baseM'],
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-opacity': 0.95,
      },
    })

    map.addLayer({
      id: FLIGHT_3D_WINDOW_LAYER,
      type: 'fill-extrusion',
      source: FLIGHT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'window'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#334155',
        'fill-extrusion-base': ['get', 'baseM'],
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-opacity': 0.85,
      },
    })

    map.addLayer({
      id: FLIGHT_3D_NOSE_LAYER,
      type: 'fill-extrusion',
      source: FLIGHT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'nose'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#1e293b',
        'fill-extrusion-base': ['get', 'baseM'],
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-opacity': 0.88,
      },
    })

    map.addLayer({
      id: FLIGHT_3D_VTAIL_LAYER,
      type: 'fill-extrusion',
      source: FLIGHT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'vtail'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-base': ['get', 'baseM'],
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-opacity': 0.96,
      },
    })
  }

  detach(): void {
    const map = this.map
    if (!map) return
    for (const id of ALL_FLIGHT_3D_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(FLIGHT_3D_SOURCE_ID)) map.removeSource(FLIGHT_3D_SOURCE_ID)
    this.map = null
  }

  setVehicles(flights: VehiclePosition[]): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(FLIGHT_3D_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    if (map.getZoom() < MIN_ZOOM - 0.5) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    src.setData({ type: 'FeatureCollection', features: buildFlightFeatures(flights) })
  }
}
