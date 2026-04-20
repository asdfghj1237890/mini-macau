import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'

export const BUS_3D_SOURCE_ID = 'bus-3d-source'
export const BUS_3D_WHEEL_LAYER_ID = 'bus-3d-wheel'
export const BUS_3D_BODY_LAYER_ID = 'bus-3d-body'
export const BUS_3D_ROOF_LAYER_ID = 'bus-3d-roof'
export const BUS_3D_WINDOW_LAYER_ID = 'bus-3d-window'
export const BUS_3D_WINDSHIELD_LAYER_ID = 'bus-3d-windshield'

const BUS_LENGTH_M = 22
const BUS_WIDTH_M = 6
const BUS_BODY_BASE_M = 1.8
const BUS_HEIGHT_M = 6.5
const BUS_ROOF_HEIGHT_M = 7
const BUS_WINDOW_LOW_M = 3.2
const BUS_WINDOW_HIGH_M = 5.8
const BUS_WHEEL_HEIGHT_M = 2.0

const WHEEL_LENGTH_M = 3.5
const WHEEL_WIDTH_M = 1.6
const WHEEL_OVERHANG_M = 0.4
const WHEEL_AXLE_FROM_END_M = 4.5

const WINDSHIELD_THICKNESS_M = 0.4
const WINDSHIELD_WIDTH_M = 5.8
const WINDSHIELD_OVERHANG_M = 0.25

const IS_MOBILE = window.matchMedia('(max-width: 639px)').matches
const MIN_ZOOM = IS_MOBILE ? 16 : 16.9

const METERS_PER_DEG_LAT = 111320

type BusFeatureKind = 'body' | 'roof' | 'window' | 'wheel' | 'windshield'

type BusFeature = GeoJSON.Feature<GeoJSON.Polygon, { color: string; kind: BusFeatureKind; vehicleId: string }>

function rectanglePolygon(
  lng: number,
  lat: number,
  bearingDeg: number,
  lengthM: number,
  widthM: number
): [number, number][] {
  const theta = (bearingDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  const cosLat = Math.cos((lat * Math.PI) / 180)
  const mLat = 1 / METERS_PER_DEG_LAT
  const mLng = 1 / (METERS_PER_DEG_LAT * Math.max(cosLat, 1e-6))

  const half_L = lengthM / 2
  const half_W = widthM / 2

  const corners: [number, number][] = [
    [-half_W, half_L],
    [half_W, half_L],
    [half_W, -half_L],
    [-half_W, -half_L],
    [-half_W, half_L],
  ]

  return corners.map(([lx, ly]) => {
    const rx = lx * cos + ly * sin
    const ry = -lx * sin + ly * cos
    return [lng + rx * mLng, lat + ry * mLat]
  })
}

function offsetInBus(
  lng: number,
  lat: number,
  bearingDeg: number,
  localX: number,
  localY: number
): [number, number] {
  const theta = (bearingDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  const cosLat = Math.cos((lat * Math.PI) / 180)
  const mLat = 1 / METERS_PER_DEG_LAT
  const mLng = 1 / (METERS_PER_DEG_LAT * Math.max(cosLat, 1e-6))

  const rx = localX * cos + localY * sin
  const ry = -localX * sin + localY * cos
  return [lng + rx * mLng, lat + ry * mLat]
}

const WHEEL_OFFSETS_LOCAL: [number, number][] = [
  [BUS_WIDTH_M / 2 + WHEEL_OVERHANG_M, BUS_LENGTH_M / 2 - WHEEL_AXLE_FROM_END_M],
  [-(BUS_WIDTH_M / 2 + WHEEL_OVERHANG_M), BUS_LENGTH_M / 2 - WHEEL_AXLE_FROM_END_M],
  [BUS_WIDTH_M / 2 + WHEEL_OVERHANG_M, -(BUS_LENGTH_M / 2 - WHEEL_AXLE_FROM_END_M)],
  [-(BUS_WIDTH_M / 2 + WHEEL_OVERHANG_M), -(BUS_LENGTH_M / 2 - WHEEL_AXLE_FROM_END_M)],
]

function buildBusFeatures(buses: VehiclePosition[]): BusFeature[] {
  const features: BusFeature[] = []
  for (const v of buses) {
    const [lng, lat] = v.coordinates
    const vid = v.id
    const body = rectanglePolygon(lng, lat, v.bearing, BUS_LENGTH_M, BUS_WIDTH_M)
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [body] },
      properties: { color: v.color, kind: 'body', vehicleId: vid },
    })
    const roof = rectanglePolygon(lng, lat, v.bearing, BUS_LENGTH_M - 1.2, BUS_WIDTH_M - 0.6)
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [roof] },
      properties: { color: v.color, kind: 'roof', vehicleId: vid },
    })
    const window = rectanglePolygon(lng, lat, v.bearing, BUS_LENGTH_M - 3.6, BUS_WIDTH_M + 0.2)
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [window] },
      properties: { color: v.color, kind: 'window', vehicleId: vid },
    })
    for (const [ox, oy] of WHEEL_OFFSETS_LOCAL) {
      const [wLng, wLat] = offsetInBus(lng, lat, v.bearing, ox, oy)
      const wheel = rectanglePolygon(wLng, wLat, v.bearing, WHEEL_LENGTH_M, WHEEL_WIDTH_M)
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [wheel] },
        properties: { color: v.color, kind: 'wheel', vehicleId: vid },
      })
    }

    const [wsLng, wsLat] = offsetInBus(
      lng,
      lat,
      v.bearing,
      0,
      BUS_LENGTH_M / 2 + WINDSHIELD_OVERHANG_M - WINDSHIELD_THICKNESS_M / 2
    )
    const windshield = rectanglePolygon(wsLng, wsLat, v.bearing, WINDSHIELD_THICKNESS_M, WINDSHIELD_WIDTH_M)
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [windshield] },
      properties: { color: v.color, kind: 'windshield', vehicleId: vid },
    })
  }
  return features
}

export class Bus3DLayer {
  private map: MapLibreMap | null = null
  private isEmpty = true

  attach(map: MapLibreMap): void {
    this.map = map

    map.addSource(BUS_3D_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    map.addLayer({
      id: BUS_3D_WHEEL_LAYER_ID,
      type: 'fill-extrusion',
      source: BUS_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'wheel'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#0a0a0a',
        'fill-extrusion-base': 0,
        'fill-extrusion-height': BUS_WHEEL_HEIGHT_M,
        'fill-extrusion-opacity': 1,
      },
    })

    map.addLayer({
      id: BUS_3D_BODY_LAYER_ID,
      type: 'fill-extrusion',
      source: BUS_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'body'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-base': BUS_BODY_BASE_M,
        'fill-extrusion-height': BUS_HEIGHT_M,
        'fill-extrusion-opacity': 1,
      },
    })

    map.addLayer({
      id: BUS_3D_WINDOW_LAYER_ID,
      type: 'fill-extrusion',
      source: BUS_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'window'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#1a1e2a',
        'fill-extrusion-base': BUS_WINDOW_LOW_M,
        'fill-extrusion-height': BUS_WINDOW_HIGH_M,
        'fill-extrusion-opacity': 1,
      },
    })

    map.addLayer({
      id: BUS_3D_WINDSHIELD_LAYER_ID,
      type: 'fill-extrusion',
      source: BUS_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'windshield'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#0f121a',
        'fill-extrusion-base': BUS_WINDOW_LOW_M,
        'fill-extrusion-height': BUS_WINDOW_HIGH_M,
        'fill-extrusion-opacity': 1,
      },
    })

    map.addLayer({
      id: BUS_3D_ROOF_LAYER_ID,
      type: 'fill-extrusion',
      source: BUS_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'roof'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-base': BUS_HEIGHT_M,
        'fill-extrusion-height': BUS_ROOF_HEIGHT_M,
        'fill-extrusion-opacity': 1,
      },
    })
  }

  detach(): void {
    const map = this.map
    if (!map) return
    if (map.getLayer(BUS_3D_ROOF_LAYER_ID)) map.removeLayer(BUS_3D_ROOF_LAYER_ID)
    if (map.getLayer(BUS_3D_WINDSHIELD_LAYER_ID)) map.removeLayer(BUS_3D_WINDSHIELD_LAYER_ID)
    if (map.getLayer(BUS_3D_WINDOW_LAYER_ID)) map.removeLayer(BUS_3D_WINDOW_LAYER_ID)
    if (map.getLayer(BUS_3D_BODY_LAYER_ID)) map.removeLayer(BUS_3D_BODY_LAYER_ID)
    if (map.getLayer(BUS_3D_WHEEL_LAYER_ID)) map.removeLayer(BUS_3D_WHEEL_LAYER_ID)
    if (map.getSource(BUS_3D_SOURCE_ID)) map.removeSource(BUS_3D_SOURCE_ID)
    this.map = null
  }

  setVehicles(buses: VehiclePosition[]): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(BUS_3D_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    const belowMin = map.getZoom() < MIN_ZOOM - 0.5
    if (belowMin || buses.length === 0) {
      // Skip the setData storm: if the source is already empty, don't spam
      // the worker with empty-FC postMessages every heavy tick.
      if (this.isEmpty) return
      src.setData({ type: 'FeatureCollection', features: [] })
      this.isEmpty = true
      return
    }
    src.setData({ type: 'FeatureCollection', features: buildBusFeatures(buses) })
    this.isEmpty = false
  }
}
