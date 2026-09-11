import type { VehiclePosition } from '../types'
import { LRT_HALF_LENGTH_M, LRT_HALF_WIDTH_M, LRT_HEIGHT_M, LRT_VIADUCT_TOP_M, LRT_JOINT_HALF_M } from './lrtMesh'
import { articulatedLrtPoint, STRAIGHT_LRT, type LrtArticulation } from './lrtArticulation'

type Point = [number, number]
type WeightedPoint = [number, number, number]
const w = LRT_HALF_WIDTH_M, l = LRT_HALF_LENGTH_M
// Two car envelopes and the narrower joint. These are only used for picking;
// rounded surfaces, lights, glazing and undercarriage live in the GPU mesh.
const PARTS = [
  { kind: 'body', base: 0, top: LRT_HEIGHT_M, outlines: [-1, 1].map(direction =>
    ([[-w, 1.3], [w, 1.3], [w, l], [-w, l]] as Point[]).map(([x, y]): WeightedPoint => [x, direction * y, direction === 1 ? 1 : 0]),
  ) },
  { kind: 'gangway', base: 3, top: 10.15, outlines: [[
    [-3.43, -LRT_JOINT_HALF_M, 0], [3.43, -LRT_JOINT_HALF_M, 0],
    [3.43, LRT_JOINT_HALF_M, 1], [-3.43, LRT_JOINT_HALF_M, 1],
  ] as WeightedPoint[]] },
]

export function buildLrtFeatures(vehicles: VehiclePosition[], poses?: LrtArticulation[]): GeoJSON.Feature<GeoJSON.MultiPolygon>[] {
  return vehicles.flatMap((vehicle, index) => {
    const pose = poses?.[index] ?? STRAIGHT_LRT
    const [lng, lat] = vehicle.coordinates
    const scale = vehicle.scale ?? 1, altitude = vehicle.altitude ?? LRT_VIADUCT_TOP_M
    const angle = vehicle.bearing * Math.PI / 180
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const latUnit = scale / 111320
    const lngUnit = latUnit / Math.max(Math.cos(lat * Math.PI / 180), 1e-6)
    return PARTS.map(part => ({
      type: 'Feature',
      properties: { kind: part.kind, vehicleId: vehicle.id, baseM: altitude + part.base * scale, heightM: altitude + part.top * scale },
      geometry: {
        type: 'MultiPolygon',
        coordinates: part.outlines.map(outline => [[...outline, outline[0]].map(([x, y, weight]): Point => {
          const [px, py] = articulatedLrtPoint(x, y, weight, pose)
          return [lng + (px * cos + py * sin) * lngUnit, lat + (-px * sin + py * cos) * latUnit]
        })]),
      },
    }))
  })
}
