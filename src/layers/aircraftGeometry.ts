import type { VehiclePosition } from '../types'

export type AircraftPartKind = 'fuselage' | 'wing' | 'tail' | 'vtail'
type Point = [number, number]
type Part = { kind: AircraftPartKind; base: number; top: number; outlines: Point[][] }
const mirror = (points: Point[]): Point[][] => [points, points.map(([x, y]): Point => [-x, y]).reverse()]

// Low-detail picking volumes only. The visible aircraft is the shared GPU mesh;
// keeping these in GeoJSON preserves MapLibre's existing click/hover handlers.
const PARTS: Part[] = [
  { kind: 'fuselage', base: 1, top: 35, outlines: [[
    [0, 138], [10, 128], [17, 100], [17, -60], [10, -101], [0, -132],
    [-10, -101], [-17, -60], [-17, 100], [-10, 128],
  ]] },
  { kind: 'wing', base: 13, top: 22, outlines: mirror([
    [12, 35], [45, 15], [116, -45], [116, -53], [46, -26], [24, -43], [12, -44],
  ]) },
  { kind: 'wing', base: 1, top: 19, outlines: mirror([[35, 40], [53, 40], [53, 4], [35, 4]]) },
  { kind: 'wing', base: 21, top: 37, outlines: mirror([[104, -40], [113, -45], [116, -53], [110, -50]]) },
  { kind: 'tail', base: 26, top: 32, outlines: mirror([[4, -84], [41, -106], [45, -119], [4, -106]]) },
  { kind: 'vtail', base: 31, top: 76, outlines: [[[-2.6, -66], [2.6, -66], [2.6, -124], [-2.6, -124]]] },
]

export function buildFlightFeatures(flights: VehiclePosition[]): GeoJSON.Feature<GeoJSON.MultiPolygon>[] {
  return flights.flatMap(v => {
    const [lng, lat] = v.coordinates
    const scale = v.scale ?? 1, altitude = v.altitude ?? 0
    const theta = v.bearing * Math.PI / 180
    const cos = Math.cos(theta), sin = Math.sin(theta)
    const latUnit = scale / 111320
    const lngUnit = latUnit / Math.max(Math.cos(lat * Math.PI / 180), 1e-6)
    return PARTS.map(part => ({
      type: 'Feature',
      properties: { kind: part.kind, vehicleId: v.id, baseM: altitude + part.base * scale, heightM: altitude + part.top * scale },
      geometry: {
        type: 'MultiPolygon',
        coordinates: part.outlines.map(outline => [[...outline, outline[0]].map(([x, y]): Point => [
          lng + (x * cos + y * sin) * lngUnit,
          lat + (-x * sin + y * cos) * latUnit,
        ])]),
      },
    }))
  })
}
