import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'

const LRT_3D_SOURCE_ID = 'lrt-3d-source'
const LRT_3D_BOGIE_LAYER = 'lrt-3d-bogie'
const LRT_3D_BODY_LAYER = 'lrt-3d-body'
const LRT_3D_WINDOW_LAYER = 'lrt-3d-window'
const LRT_3D_WINDSHIELD_LAYER = 'lrt-3d-windshield'
const LRT_3D_ROOF_LAYER = 'lrt-3d-roof'
const LRT_3D_GANGWAY_LAYER = 'lrt-3d-gangway'

const ALL_LAYERS = [
  LRT_3D_ROOF_LAYER,
  LRT_3D_WINDSHIELD_LAYER,
  LRT_3D_WINDOW_LAYER,
  LRT_3D_GANGWAY_LAYER,
  LRT_3D_BODY_LAYER,
  LRT_3D_BOGIE_LAYER,
]

const IS_MOBILE = window.matchMedia('(max-width: 639px)').matches
const MIN_ZOOM = IS_MOBILE ? 16 : 16.9
const METERS_PER_DEG_LAT = 111320

// Viaduct top surface from MapView constants
const VIADUCT_TOP_M = 7.2

// Car dimensions (scaled x1.3 for map visibility)
const CAR_LENGTH_M = 27.04
const CAR_WIDTH_M = 8.45
const CAR_GAP_M = 3.38
// Vertical dimensions (absolute, on top of viaduct) — scaled x1.8 * x1.3
const BOGIE_BASE_M = VIADUCT_TOP_M
const BOGIE_HEIGHT_M = VIADUCT_TOP_M + 2.81
const BODY_BASE_M = VIADUCT_TOP_M + 2.34
const BODY_HEIGHT_M = VIADUCT_TOP_M + 10.53
const WINDOW_LOW_M = VIADUCT_TOP_M + 5.85
const WINDOW_HIGH_M = VIADUCT_TOP_M + 9.36
const WINDSHIELD_LOW_M = VIADUCT_TOP_M + 3.51
const WINDSHIELD_HIGH_M = VIADUCT_TOP_M + 9.83
const ROOF_BASE_M = BODY_HEIGHT_M
const ROOF_HEIGHT_M = VIADUCT_TOP_M + 12.17
const GANGWAY_BASE_M = VIADUCT_TOP_M + 3.51
const GANGWAY_HEIGHT_M = VIADUCT_TOP_M + 9.36

// Bogie dimensions
const BOGIE_LENGTH_M = 6.76
const BOGIE_WIDTH_M = 6.5
const BOGIE_AXLE_FROM_END_M = 6.76

// Windshield dimensions
const WINDSHIELD_THICKNESS_M = 0.65
const WINDSHIELD_WIDTH_M = 8.06
const WINDSHIELD_OVERHANG_M = 0.39

type LRTFeatureKind = 'body' | 'roof' | 'window' | 'windshield' | 'bogie' | 'gangway'
type LRTFeature = GeoJSON.Feature<GeoJSON.Polygon, { color: string; kind: LRTFeatureKind; vehicleId: string }>

function rectanglePolygon(
  lng: number,
  lat: number,
  bearingDeg: number,
  lengthM: number,
  widthM: number,
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

function offsetLocal(
  lng: number,
  lat: number,
  bearingDeg: number,
  localX: number,
  localY: number,
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

function buildLRTFeatures(vehicles: VehiclePosition[]): LRTFeature[] {
  const features: LRTFeature[] = []

  for (const v of vehicles) {
    const [lng, lat] = v.coordinates
    const b = v.bearing
    const color = '#f0f2f5'
    const vid = v.id

    const frontCarY = (CAR_LENGTH_M + CAR_GAP_M) / 2
    const rearCarY = -(CAR_LENGTH_M + CAR_GAP_M) / 2

    for (const carY of [frontCarY, rearCarY]) {
      const [cLng, cLat] = offsetLocal(lng, lat, b, 0, carY)

      const body = rectanglePolygon(cLng, cLat, b, CAR_LENGTH_M, CAR_WIDTH_M)
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [body] },
        properties: { color, kind: 'body', vehicleId: vid },
      })

      const roof = rectanglePolygon(cLng, cLat, b, CAR_LENGTH_M - 1.69, CAR_WIDTH_M - 0.78)
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [roof] },
        properties: { color, kind: 'roof', vehicleId: vid },
      })

      const window = rectanglePolygon(cLng, cLat, b, CAR_LENGTH_M - 6.76, CAR_WIDTH_M + 0.26)
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [window] },
        properties: { color, kind: 'window', vehicleId: vid },
      })

      const bogieOffsets: [number, number][] = [
        [0, CAR_LENGTH_M / 2 - BOGIE_AXLE_FROM_END_M],
        [0, -(CAR_LENGTH_M / 2 - BOGIE_AXLE_FROM_END_M)],
      ]
      for (const [bx, by] of bogieOffsets) {
        const [bLng, bLat] = offsetLocal(cLng, cLat, b, bx, by)
        const bogie = rectanglePolygon(bLng, bLat, b, BOGIE_LENGTH_M, BOGIE_WIDTH_M)
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [bogie] },
          properties: { color, kind: 'bogie', vehicleId: vid },
        })
      }
    }

    const [fwLng, fwLat] = offsetLocal(
      lng, lat, b, 0,
      frontCarY + CAR_LENGTH_M / 2 + WINDSHIELD_OVERHANG_M - WINDSHIELD_THICKNESS_M / 2,
    )
    const frontWs = rectanglePolygon(fwLng, fwLat, b, WINDSHIELD_THICKNESS_M, WINDSHIELD_WIDTH_M)
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [frontWs] },
      properties: { color, kind: 'windshield', vehicleId: vid },
    })

    const [rwLng, rwLat] = offsetLocal(
      lng, lat, b, 0,
      rearCarY - CAR_LENGTH_M / 2 - WINDSHIELD_OVERHANG_M + WINDSHIELD_THICKNESS_M / 2,
    )
    const rearWs = rectanglePolygon(rwLng, rwLat, b, WINDSHIELD_THICKNESS_M, WINDSHIELD_WIDTH_M)
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [rearWs] },
      properties: { color, kind: 'windshield', vehicleId: vid },
    })

    const gangway = rectanglePolygon(lng, lat, b, CAR_GAP_M + 1.69, CAR_WIDTH_M - 2.08)
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [gangway] },
      properties: { color, kind: 'gangway', vehicleId: vid },
    })
  }

  return features
}

export class LRT3DLayer {
  private map: MapLibreMap | null = null
  private isEmpty = true

  attach(map: MapLibreMap): void {
    this.map = map

    map.addSource(LRT_3D_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    map.addLayer({
      id: LRT_3D_BOGIE_LAYER,
      type: 'fill-extrusion',
      source: LRT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'bogie'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#1a1a1a',
        'fill-extrusion-base': BOGIE_BASE_M,
        'fill-extrusion-height': BOGIE_HEIGHT_M,
        'fill-extrusion-opacity': 1,
      },
    })

    map.addLayer({
      id: LRT_3D_BODY_LAYER,
      type: 'fill-extrusion',
      source: LRT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'body'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#f0f2f5',
        'fill-extrusion-base': BODY_BASE_M,
        'fill-extrusion-height': BODY_HEIGHT_M,
        'fill-extrusion-opacity': 1,
      },
    })

    map.addLayer({
      id: LRT_3D_GANGWAY_LAYER,
      type: 'fill-extrusion',
      source: LRT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'gangway'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#303030',
        'fill-extrusion-base': GANGWAY_BASE_M,
        'fill-extrusion-height': GANGWAY_HEIGHT_M,
        'fill-extrusion-opacity': 1,
      },
    })

    map.addLayer({
      id: LRT_3D_WINDOW_LAYER,
      type: 'fill-extrusion',
      source: LRT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'window'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#1a2030',
        'fill-extrusion-base': WINDOW_LOW_M,
        'fill-extrusion-height': WINDOW_HIGH_M,
        'fill-extrusion-opacity': 1,
      },
    })

    map.addLayer({
      id: LRT_3D_WINDSHIELD_LAYER,
      type: 'fill-extrusion',
      source: LRT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'windshield'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#0f1520',
        'fill-extrusion-base': WINDSHIELD_LOW_M,
        'fill-extrusion-height': WINDSHIELD_HIGH_M,
        'fill-extrusion-opacity': 1,
      },
    })

    map.addLayer({
      id: LRT_3D_ROOF_LAYER,
      type: 'fill-extrusion',
      source: LRT_3D_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'roof'],
      minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': '#d8dce3',
        'fill-extrusion-base': ROOF_BASE_M,
        'fill-extrusion-height': ROOF_HEIGHT_M,
        'fill-extrusion-opacity': 1,
      },
    })
  }

  detach(): void {
    const map = this.map
    if (!map) return
    for (const id of ALL_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(LRT_3D_SOURCE_ID)) map.removeSource(LRT_3D_SOURCE_ID)
    this.map = null
  }

  setVehicles(lrts: VehiclePosition[]): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(LRT_3D_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    const belowMin = map.getZoom() < MIN_ZOOM - 0.5
    if (belowMin || lrts.length === 0) {
      if (this.isEmpty) return
      src.setData({ type: 'FeatureCollection', features: [] })
      this.isEmpty = true
      return
    }
    src.setData({ type: 'FeatureCollection', features: buildLRTFeatures(lrts) })
    this.isEmpty = false
  }
}
