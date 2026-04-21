import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'

export const FLIGHT_3D_SOURCE_ID = 'flight-3d-source'
export const FLIGHT_3D_TRACKED_SOURCE_ID = 'flight-3d-tracked-source'
export const FLIGHT_3D_FUSELAGE_LAYER = 'flight-3d-fuselage'
export const FLIGHT_3D_WING_LAYER = 'flight-3d-wing'
export const FLIGHT_3D_TAIL_LAYER = 'flight-3d-tail'
export const FLIGHT_3D_ENGINE_LAYER = 'flight-3d-engine'
export const FLIGHT_3D_VTAIL_LAYER = 'flight-3d-vtail'
export const FLIGHT_3D_WINDOW_LAYER = 'flight-3d-window'
export const FLIGHT_3D_NOSE_LAYER = 'flight-3d-nose'

export const FLIGHT_3D_TRACKED_FUSELAGE_LAYER = 'flight-3d-tracked-fuselage'
export const FLIGHT_3D_TRACKED_WING_LAYER = 'flight-3d-tracked-wing'
export const FLIGHT_3D_TRACKED_TAIL_LAYER = 'flight-3d-tracked-tail'
export const FLIGHT_3D_TRACKED_ENGINE_LAYER = 'flight-3d-tracked-engine'
export const FLIGHT_3D_TRACKED_VTAIL_LAYER = 'flight-3d-tracked-vtail'
export const FLIGHT_3D_TRACKED_WINDOW_LAYER = 'flight-3d-tracked-window'
export const FLIGHT_3D_TRACKED_NOSE_LAYER = 'flight-3d-tracked-nose'

export const ALL_FLIGHT_3D_LAYERS = [
  FLIGHT_3D_VTAIL_LAYER,
  FLIGHT_3D_ENGINE_LAYER,
  FLIGHT_3D_NOSE_LAYER,
  FLIGHT_3D_WINDOW_LAYER,
  FLIGHT_3D_WING_LAYER,
  FLIGHT_3D_TAIL_LAYER,
  FLIGHT_3D_FUSELAGE_LAYER,
  FLIGHT_3D_TRACKED_VTAIL_LAYER,
  FLIGHT_3D_TRACKED_ENGINE_LAYER,
  FLIGHT_3D_TRACKED_NOSE_LAYER,
  FLIGHT_3D_TRACKED_WINDOW_LAYER,
  FLIGHT_3D_TRACKED_WING_LAYER,
  FLIGHT_3D_TRACKED_TAIL_LAYER,
  FLIGHT_3D_TRACKED_FUSELAGE_LAYER,
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
const MIN_ZOOM = IS_MOBILE ? 14.5 : 15.6
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

// Reduced from 24 to 6: the vertical fin is tessellated as a stack of N
// rectangular slices so fill-extrusion can fake its taper. 24 × N planes × per-RAF
// updates saturated the MapLibre worker on 240 Hz displays; 6 is visually
// indistinguishable at airport zoom but cuts 3D-flight feature count by ~33%.
const VTAIL_SLICES = 6

function vtailSlices(
  lng: number, lat: number, b: number, sc = 1,
  baseAlt: number, topAlt: number,
): { coords: [number, number][]; baseM: number; heightM: number }[] {
  const rootFwd = VTAIL_Y + VTAIL_ROOT / 2
  const rootAft = VTAIL_Y - VTAIL_ROOT / 2
  const rootHalfW = 3.5
  const tipHalfW = 0.6
  const tipFwd = VTAIL_Y + VTAIL_TIP_CHORD / 2 - 18
  const tipAft = VTAIL_Y - VTAIL_TIP_CHORD / 2 - 8
  const sliceH = (topAlt - baseAlt) / VTAIL_SLICES
  const slices: { coords: [number, number][]; baseM: number; heightM: number }[] = []

  for (let i = 0; i < VTAIL_SLICES; i++) {
    const t0 = i / VTAIL_SLICES
    const t1 = (i + 1) / VTAIL_SLICES
    const tMid = (t0 + t1) / 2

    const hw = rootHalfW + (tipHalfW - rootHalfW) * tMid
    const fwd = rootFwd + (tipFwd - rootFwd) * tMid
    const aft = rootAft + (tipAft - rootAft) * tMid

    const t = xf(lng, lat, b, sc)
    slices.push({
      coords: [
        t(-hw, fwd),
        t(hw, fwd),
        t(hw, aft),
        t(-hw, aft),
        t(-hw, fwd),
      ],
      baseM: baseAlt + i * sliceH,
      heightM: baseAlt + (i + 1) * sliceH,
    })
  }
  return slices
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
      out.push(mk(wingPolygon(lng, lat, b, side, sc), 'wing', c, id,
        alt + bh * 0.28, alt + bh * 0.42))
    }

    for (const side of [-1, 1] as const) {
      out.push(mk(htailPolygon(lng, lat, b, side, sc), 'tail', c, id,
        alt + bh * 0.65, alt + bh * 0.8))
    }

    for (const slice of vtailSlices(lng, lat, b, sc, alt + bh, alt + bh + vh)) {
      out.push(mk(slice.coords, 'vtail', c, id, slice.baseM, slice.heightM))
    }

    for (const side of [-1, 1] as const) {
      out.push(mk(enginePolygon(lng, lat, b, side, sc), 'engine', c, id,
        alt - 4 * sc, alt + bh * 0.28))
    }
  }
  return out
}

// Layer paint definitions are identical for the main source (all planes) and
// the tracked source (at most one plane). We list them once and stamp out two
// copies — the second points at the tracked source and sits above the main
// layers so the tracked plane always paints on top of itself while it's still
// in the main source during the one-frame handover.
type LayerSpec = {
  idMain: string
  idTracked: string
  kind: PartKind
  color: string | ['get', string]
  opacity: number
}

const LAYER_SPECS: LayerSpec[] = [
  { idMain: FLIGHT_3D_FUSELAGE_LAYER, idTracked: FLIGHT_3D_TRACKED_FUSELAGE_LAYER, kind: 'fuselage', color: '#f8fafc', opacity: 0.97 },
  { idMain: FLIGHT_3D_WING_LAYER,     idTracked: FLIGHT_3D_TRACKED_WING_LAYER,     kind: 'wing',     color: '#e2e8f0', opacity: 0.94 },
  { idMain: FLIGHT_3D_TAIL_LAYER,     idTracked: FLIGHT_3D_TRACKED_TAIL_LAYER,     kind: 'tail',     color: '#e2e8f0', opacity: 0.94 },
  { idMain: FLIGHT_3D_ENGINE_LAYER,   idTracked: FLIGHT_3D_TRACKED_ENGINE_LAYER,   kind: 'engine',   color: '#94a3b8', opacity: 0.95 },
  { idMain: FLIGHT_3D_WINDOW_LAYER,   idTracked: FLIGHT_3D_TRACKED_WINDOW_LAYER,   kind: 'window',   color: '#334155', opacity: 0.85 },
  { idMain: FLIGHT_3D_NOSE_LAYER,     idTracked: FLIGHT_3D_TRACKED_NOSE_LAYER,     kind: 'nose',     color: '#1e293b', opacity: 0.88 },
  { idMain: FLIGHT_3D_VTAIL_LAYER,    idTracked: FLIGHT_3D_TRACKED_VTAIL_LAYER,    kind: 'vtail',    color: ['get', 'color'], opacity: 0.96 },
]

export class Flight3DLayer {
  private map: MapLibreMap | null = null
  private isEmpty = true
  private trackedEmpty = true
  // Tracked plane lives in a dedicated 1-feature source so its setData round
  // trip through the MapLibre worker is sub-frame. The 160-plane main source
  // takes ~37 ms per tessellation cycle, which at 10× sim speed produced the
  // 前後抖動 — camera moved per-RAF but mesh moved per-worker-cycle. Putting
  // the tracked plane in its own source lets camera and tracked mesh advance
  // in lockstep every frame without dragging the 160-plane mesh along.
  private trackedId: string | null = null
  private lastFlights: VehiclePosition[] = []

  attach(map: MapLibreMap): void {
    this.map = map

    map.addSource(FLIGHT_3D_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addSource(FLIGHT_3D_TRACKED_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    for (const spec of LAYER_SPECS) {
      map.addLayer({
        id: spec.idMain,
        type: 'fill-extrusion',
        source: FLIGHT_3D_SOURCE_ID,
        filter: ['==', ['get', 'kind'], spec.kind],
        minzoom: MIN_ZOOM,
        paint: {
          'fill-extrusion-color': spec.color,
          'fill-extrusion-base': ['get', 'baseM'],
          'fill-extrusion-height': ['get', 'heightM'],
          'fill-extrusion-opacity': spec.opacity,
        },
      })
    }

    for (const spec of LAYER_SPECS) {
      map.addLayer({
        id: spec.idTracked,
        type: 'fill-extrusion',
        source: FLIGHT_3D_TRACKED_SOURCE_ID,
        filter: ['==', ['get', 'kind'], spec.kind],
        minzoom: MIN_ZOOM,
        paint: {
          'fill-extrusion-color': spec.color,
          'fill-extrusion-base': ['get', 'baseM'],
          'fill-extrusion-height': ['get', 'heightM'],
          'fill-extrusion-opacity': spec.opacity,
        },
      })
    }
  }

  detach(): void {
    const map = this.map
    if (!map) return
    for (const id of ALL_FLIGHT_3D_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(FLIGHT_3D_SOURCE_ID)) map.removeSource(FLIGHT_3D_SOURCE_ID)
    if (map.getSource(FLIGHT_3D_TRACKED_SOURCE_ID)) map.removeSource(FLIGHT_3D_TRACKED_SOURCE_ID)
    this.map = null
  }

  setVehicles(flights: VehiclePosition[]): void {
    this.lastFlights = flights
    const map = this.map
    if (!map) return
    const src = map.getSource(FLIGHT_3D_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    const belowMin = map.getZoom() < MIN_ZOOM - 0.5
    const filtered = this.trackedId
      ? flights.filter(f => f.id !== this.trackedId)
      : flights
    if (belowMin || filtered.length === 0) {
      if (this.isEmpty) return
      src.setData({ type: 'FeatureCollection', features: [] })
      this.isEmpty = true
      return
    }
    src.setData({ type: 'FeatureCollection', features: buildFlightFeatures(filtered) })
    this.isEmpty = false
  }

  // Called every RAF while a flight is being tracked. `flight` is the tracked
  // plane with a freshly computed position; pass null to clear. Because the
  // tracked source holds only this one plane, the worker finishes in well
  // under a frame, so callers can setCenter immediately after and camera +
  // mesh stay in lockstep.
  setTrackedVehicle(flight: VehiclePosition | null): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(FLIGHT_3D_TRACKED_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return

    const newId = flight?.id ?? null
    const idChanged = newId !== this.trackedId

    if (!flight) {
      this.trackedId = null
      if (!this.trackedEmpty) {
        src.setData({ type: 'FeatureCollection', features: [] })
        this.trackedEmpty = true
      }
      // Plane went back into the main source — rebuild so it reappears there
      // instead of winking out until the next heavy tick.
      if (idChanged) this.setVehicles(this.lastFlights)
      return
    }

    this.trackedId = newId
    const belowMin = map.getZoom() < MIN_ZOOM - 0.5
    if (belowMin) {
      if (!this.trackedEmpty) {
        src.setData({ type: 'FeatureCollection', features: [] })
        this.trackedEmpty = true
      }
      return
    }

    src.setData({ type: 'FeatureCollection', features: buildFlightFeatures([flight]) })
    this.trackedEmpty = false
    // On track-change, refresh the main source immediately so the newly
    // tracked plane is excluded (avoids a 1-heavy-tick window where it would
    // render in both sources, producing a double image).
    if (idChanged) this.setVehicles(this.lastFlights)
  }
}
