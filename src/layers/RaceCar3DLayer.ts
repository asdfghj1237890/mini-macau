// The GRAND PRIX layer's car: a single open-wheel single-seater built from
// fill-extrusion boxes the way the buses are (src/layers/Bus3DLayer.ts) — a
// low monocoque with a nose, two sidepods, an airbox behind the cockpit, a
// front wing on the floor, a rear wing held up on its own base height, and
// four exposed wheels. One GeoJSON source, one fill-extrusion layer: every box
// carries its own colour, base and height, so the whole car is one setData per
// tick and one layer to show or hide.
//
// Dimensions are in metres before `pose.scale` — deliberately about three
// times a real car (a real 5.5 m single-seater is a pixel at the zoom that
// shows the circuit), the same exaggeration the bus model uses. The scale on
// top of that comes from the zoom (see grandPrixCarScale) so the car keeps a
// readable screen size as the map zooms out.

import type { Map as MapLibreMap } from 'maplibre-gl'
import type { GrandPrixCarPose } from '../grandPrix'

export const GRAND_PRIX_CAR_SOURCE_ID = 'grandprix-car'
export const GRAND_PRIX_CAR_LAYER_ID = 'grandprix-car'

export interface RaceCarColors {
  body: string
  accent: string // the wings
  wheel: string
  cockpit: string
}

type RaceCarPart = 'body' | 'nose' | 'sidepod' | 'airbox' | 'cockpit' | 'frontWing' | 'rearWing' | 'wheel'

type RaceCarFeature = GeoJSON.Feature<GeoJSON.Polygon, {
  part: RaceCarPart
  color: string
  base: number
  height: number
}>

const METERS_PER_DEG_LAT = 111320

// One box of the car: its footprint in car-local metres (x across, y forward;
// the centre of the box at cx, cy) and the vertical slab it occupies.
interface CarBox {
  part: RaceCarPart
  cx: number
  cy: number
  length: number // along y
  width: number // along x
  base: number
  height: number
}

// The car, nose towards +y. About 19 m long and 7.4 m wide at scale 1.
const CAR_BOXES: readonly CarBox[] = [
  // Monocoque, floor to shoulder.
  { part: 'body', cx: 0, cy: -0.5, length: 13, width: 2.4, base: 0.5, height: 2.2 },
  // Nose cone, ahead of the tub.
  { part: 'nose', cx: 0, cy: 8.0, length: 4.5, width: 1.2, base: 0.6, height: 1.5 },
  // Sidepods either side of the tub.
  { part: 'sidepod', cx: 2.05, cy: -1.6, length: 6.2, width: 1.7, base: 0.5, height: 1.9 },
  { part: 'sidepod', cx: -2.05, cy: -1.6, length: 6.2, width: 1.7, base: 0.5, height: 1.9 },
  // Airbox and engine cover behind the driver.
  { part: 'airbox', cx: 0, cy: -3.2, length: 5.5, width: 1.8, base: 2.2, height: 3.3 },
  // Cockpit opening and halo.
  { part: 'cockpit', cx: 0, cy: 1.4, length: 2.6, width: 1.7, base: 2.2, height: 3.0 },
  // Front wing, low and wide.
  { part: 'frontWing', cx: 0, cy: 9.6, length: 1.6, width: 7.4, base: 0.25, height: 0.85 },
  // Rear wing, up on its pylons (a base above the floor is what makes it float).
  { part: 'rearWing', cx: 0, cy: -7.8, length: 1.8, width: 6.4, base: 2.4, height: 3.4 },
  // Four exposed wheels.
  { part: 'wheel', cx: 2.95, cy: 6.0, length: 2.6, width: 1.6, base: 0, height: 2.5 },
  { part: 'wheel', cx: -2.95, cy: 6.0, length: 2.6, width: 1.6, base: 0, height: 2.5 },
  { part: 'wheel', cx: 2.95, cy: -6.0, length: 2.6, width: 1.6, base: 0, height: 2.5 },
  { part: 'wheel', cx: -2.95, cy: -6.0, length: 2.6, width: 1.6, base: 0, height: 2.5 },
]

function partColor(part: RaceCarPart, colors: RaceCarColors): string {
  switch (part) {
    case 'wheel': return colors.wheel
    case 'cockpit': return colors.cockpit
    case 'frontWing':
    case 'rearWing': return colors.accent
    default: return colors.body
  }
}

// A box's footprint as a closed ring of [lng, lat], rotated to the heading
// (0 = north, clockwise — the engine's bearing convention) about the car's
// position. Same construction as the bus body.
function boxRing(
  lng: number, lat: number, bearingDeg: number, box: CarBox, scale: number,
): [number, number][] {
  const theta = (bearingDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const mLat = 1 / METERS_PER_DEG_LAT
  const mLng = 1 / (METERS_PER_DEG_LAT * Math.max(cosLat, 1e-6))
  const hw = (box.width / 2) * scale
  const hl = (box.length / 2) * scale
  const cx = box.cx * scale
  const cy = box.cy * scale
  const local: [number, number][] = [
    [cx - hw, cy + hl],
    [cx + hw, cy + hl],
    [cx + hw, cy - hl],
    [cx - hw, cy - hl],
    [cx - hw, cy + hl],
  ]
  return local.map(([lx, ly]) => {
    const rx = lx * cos + ly * sin
    const ry = -lx * sin + ly * cos
    return [lng + rx * mLng, lat + ry * mLat]
  })
}

// Every box of the car at a pose. Exported for the tests; the layer calls it
// per tick.
export function buildRaceCarFeatures(pose: GrandPrixCarPose, colors: RaceCarColors): RaceCarFeature[] {
  const scale = pose.scale > 0 ? pose.scale : 1
  return CAR_BOXES.map(box => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [boxRing(pose.lng, pose.lat, pose.bearing, box, scale)] },
    properties: {
      part: box.part,
      color: partColor(box.part, colors),
      base: box.base * scale,
      height: box.height * scale,
    },
  }))
}

export class RaceCar3DLayer {
  private map: MapLibreMap | null = null
  private isEmpty = true
  private colors: RaceCarColors

  constructor(colors: RaceCarColors) {
    this.colors = colors
  }

  attach(map: MapLibreMap): void {
    this.map = map
    if (!map.getSource(GRAND_PRIX_CAR_SOURCE_ID)) {
      map.addSource(GRAND_PRIX_CAR_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
    if (!map.getLayer(GRAND_PRIX_CAR_LAYER_ID)) {
      map.addLayer({
        id: GRAND_PRIX_CAR_LAYER_ID,
        type: 'fill-extrusion',
        source: GRAND_PRIX_CAR_SOURCE_ID,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-opacity': 1,
        },
      })
    }
    this.isEmpty = true
  }

  detach(): void {
    const map = this.map
    if (!map) return
    if (map.getLayer(GRAND_PRIX_CAR_LAYER_ID)) map.removeLayer(GRAND_PRIX_CAR_LAYER_ID)
    if (map.getSource(GRAND_PRIX_CAR_SOURCE_ID)) map.removeSource(GRAND_PRIX_CAR_SOURCE_ID)
    this.map = null
  }

  // The theme's colours for the next pose; the car repaints on its next tick
  // (every ~33 ms while the layer is on), so no rebuild is needed here.
  setColors(colors: RaceCarColors): void {
    this.colors = colors
  }

  // Null takes the car off the map — once: an already-empty source is not
  // re-sent on every tick the layer stays off.
  setPose(pose: GrandPrixCarPose | null): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(GRAND_PRIX_CAR_SOURCE_ID) as unknown as
      { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    if (!pose) {
      if (this.isEmpty) return
      src.setData({ type: 'FeatureCollection', features: [] })
      this.isEmpty = true
      return
    }
    src.setData({ type: 'FeatureCollection', features: buildRaceCarFeatures(pose, this.colors) })
    this.isEmpty = false
  }
}
