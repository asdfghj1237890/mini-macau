import type { VehiclePosition } from '../types'

type Point = [number, number]
// Separate pontoons preserve the open water between the bows. Higher picking
// volumes follow the cabin/bridge, rather than a tall box over the whole boat.
const ENVELOPES: { base: number; top: number; outline: Point[] }[] = [
  ...[-1, 1].map(side => ({ base: 0, top: 3.3, outline: [
    [side * 5.1, 25], [side * 7, 12], [side * 7, -24], [side * 3.2, -24], [side * 3.2, 12],
  ] as Point[] })),
  { base: 2.5, top: 7.5, outline: [[-2.8, 20], [2.8, 20], [6.6, 7], [6.6, -21], [-6.6, -21], [-6.6, 7]] },
  { base: 7.5, top: 10.7, outline: [[-2.7, 14], [2.7, 14], [4.8, 8], [4.8, -15], [-4.8, -15], [-4.8, 8]] },
]

export function buildFerryFeatures(ferries: VehiclePosition[]): GeoJSON.Feature<GeoJSON.Polygon>[] {
  return ferries.flatMap(v => {
    const [lng, lat] = v.coordinates
    const scale = v.scale ?? 1, altitude = v.altitude ?? 0
    const a = v.bearing * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a)
    const latUnit = scale / 111320, lngUnit = latUnit / Math.max(Math.cos(lat * Math.PI / 180), 1e-6)
    return ENVELOPES.map(part => ({
      type: 'Feature',
      properties: { vehicleId: v.id, baseM: altitude + part.base * scale, heightM: altitude + part.top * scale },
      geometry: { type: 'Polygon', coordinates: [[...part.outline, part.outline[0]].map(([x, y]) => [
        lng + (x * cos + y * sin) * lngUnit, lat + (-x * sin + y * cos) * latUnit,
      ])] },
    }))
  })
}
