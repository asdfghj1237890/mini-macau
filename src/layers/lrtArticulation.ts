import type { Feature, LineString } from 'geojson'
import type { VehiclePosition } from '../types'
import { sampleLineAtOffset } from '../engines/simulationEngine'
import { LRT_HALF_WIDTH_M } from './lrtMesh'
import { getLrtTrack } from '../lrtTracks'
import type { ModelArticulation } from './InstancedVehicleModelLayer'

// Translation (metres in the train's local frame), cos/sin of clockwise yaw.
export type CarTransform = [number, number, number, number]
export type LrtArticulation = ModelArticulation
export const STRAIGHT_LRT: LrtArticulation = { front: [0, 0, 1, 0], rear: [0, 0, 1, 0] }

// This is also the GPU skinning rule. Cars use a constant weight (0 or 1);
// the accordion interpolates between their transforms across its length.
export function articulatedLrtPoint(x: number, y: number, weight: number, pose: LrtArticulation): [number, number] {
  const transform = (p: CarTransform): [number, number] => [p[0] + x * p[2] + y * p[3], p[1] - x * p[3] + y * p[2]]
  const rear = transform(pose.rear), front = transform(pose.front)
  return [rear[0] + (front[0] - rear[0]) * weight, rear[1] + (front[1] - rear[1]) * weight]
}

export function lrtArticulation(vehicle: VehiclePosition, line?: Feature<LineString>): LrtArticulation {
  if (!line) return STRAIGHT_LRT
  const track = vehicle.lrtDirection ? getLrtTrack(line, vehicle.lrtDirection) : line
  const scale = vehicle.scale ?? 1
  if (scale <= 0) return STRAIGHT_LRT
  const angle = vehicle.bearing * Math.PI / 180
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const lngUnit = 111320 * Math.cos(vehicle.coordinates[1] * Math.PI / 180)
  function local(offset: number): [number, number] {
    const point = sampleLineAtOffset(track, vehicle.progress, offset * scale)
    const east = (point[0] - vehicle.coordinates[0]) * lngUnit / scale
    const north = (point[1] - vehicle.coordinates[1]) * 111320 / scale
    return [east * cos - north * sin, east * sin + north * cos]
  }
  const before = local(-1), after = local(1)
  if (Math.hypot(after[0] - before[0], after[1] - before[1]) < .001) return STRAIGHT_LRT
  const direction = after[1] >= before[1] ? 1 : -1
  function car(sign: number): CarTransform {
    // The model's two bogies sit 6.5 m and 22 m from the coupling pivot.
    const a = local(direction * (sign === 1 ? 6.5 : -22))
    const b = local(direction * (sign === 1 ? 22 : -6.5))
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    if (length < .001) return [0, 0, 1, 0]
    const yawCos = dy / length, yawSin = dx / length, centreY = sign * 14.25
    return [(a[0] + b[0]) / 2 - centreY * yawSin, (a[1] + b[1]) / 2 - centreY * yawCos, yawCos, yawSin]
  }
  const pose = { front: car(1), rear: car(-1) }
  // Very tight source curves can make the inner white body corners overlap.
  // Open only the required longitudinal clearance; car lengths stay rigid.
  const ax = pose.front[3] + pose.rear[3], ay = pose.front[2] + pose.rear[2]
  const length = Math.hypot(ax, ay)
  const x = length > .001 ? ax / length : 0, y = length > .001 ? ay / length : 1
  const frontEnd = articulatedLrtPoint(0, 1.3, 1, pose)
  const rearEnd = articulatedLrtPoint(0, -1.3, 0, pose)
  const gap = (frontEnd[0] - rearEnd[0]) * x + (frontEnd[1] - rearEnd[1]) * y
  const clearance = .2 + LRT_HALF_WIDTH_M * (
    Math.abs(pose.front[2] * x - pose.front[3] * y) + Math.abs(pose.rear[2] * x - pose.rear[3] * y)
  )
  const extend = Math.max(0, clearance - gap) / 2
  pose.front[0] += x * extend; pose.front[1] += y * extend
  pose.rear[0] -= x * extend; pose.rear[1] -= y * extend
  return pose
}
