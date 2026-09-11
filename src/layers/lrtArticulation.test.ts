import { describe, expect, it } from 'vitest'
import type { Feature, LineString } from 'geojson'
import type { VehiclePosition } from '../types'
import { interpolateOnLineSmooth, sampleLineAtOffset } from '../engines/simulationEngine'
import { articulatedLrtPoint, lrtArticulation, STRAIGHT_LRT } from './lrtArticulation'
import { buildLrtFeatures } from './lrtGeometry'
import { createLrtMesh, LRT_JOINT_HALF_M, LRT_VERTEX_FLOATS } from './lrtMesh'
import { vehicleInstances } from './InstancedVehicleModelLayer'

const origin: [number, number] = [113.57, 22.16]
const lngUnit = 111320 * Math.cos(origin[1] * Math.PI / 180)
const coordinate = (x: number, y: number): [number, number] => [origin[0] + x / lngUnit, origin[1] + y / 111320]
const line = (points: [number, number][]): Feature<LineString> => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(([x, y]) => coordinate(x, y)) } })
const curve = (radius: number, side = 1) => line(Array.from({ length: 241 }, (_, i): [number, number] => {
  const angle = (i - 120) / 100
  return [side * radius * (1 - Math.cos(angle)), radius * Math.sin(angle)]
}))
const vehicle = (track: Feature<LineString>, progress = .5, reversed = false): VehiclePosition => {
  const p = interpolateOnLineSmooth(track, progress)
  return { id: 'curve-test', type: 'lrt', lineId: 'test', coordinates: p.coordinates, bearing: p.bearing + (reversed ? 180 : 0), progress, color: '#8cc63f' }
}

describe('articulated LRT', () => {
  it('keeps both cars straight at line ends, including duplicate endpoint coordinates', () => {
    const track = line([[0, -100], [0, -100], [0, 100], [0, 100]])
    for (const progress of [0, .5, 1]) {
      const v = vehicle(track, progress)
      const pose = lrtArticulation(v, track)
      for (const car of [pose.front, pose.rear]) {
        expect(car[0]).toBeCloseTo(0, 4)
        expect(Math.abs(car[1])).toBeLessThan(.04)
        expect(car[2]).toBeCloseTo(1, 4)
        expect(car[3]).toBeCloseTo(0, 4)
      }
    }
    expect(sampleLineAtOffset(track, 0, -20)[1]).toBeLessThan(track.geometry.coordinates[0][1])
    expect(sampleLineAtOffset(track, 1, 20)[1]).toBeGreaterThan(track.geometry.coordinates.at(-1)![1])
  })

  it.each([-1, 1])('follows each car’s wheel chord on a bend (side=%s)', side => {
    const track = curve(100, side), v = vehicle(track), pose = lrtArticulation(v, track)
    expect(pose.front[3] * side).toBeGreaterThan(.1)
    expect(pose.rear[3] * side).toBeLessThan(-.1)
    for (const [y, weight] of [[6.5, 1], [22, 1], [-6.5, 0], [-22, 0]]) {
      const [x, py] = articulatedLrtPoint(0, y, weight, pose)
      const expected = sampleLineAtOffset(track, v.progress, y)
      expect(Math.hypot(x - (expected[0] - v.coordinates[0]) * lngUnit, py - (expected[1] - v.coordinates[1]) * 111320)).toBeLessThan(.1)
    }
  })

  it('keeps rigid car lengths while the accordion attaches to both transformed ends', () => {
    const track = curve(45), pose = lrtArticulation(vehicle(track), track)
    for (const weight of [0, 1]) {
      const a = articulatedLrtPoint(-4, 10, weight, pose), b = articulatedLrtPoint(4, 25, weight, pose)
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(17, 8)
      const y = weight ? LRT_JOINT_HALF_M : -LRT_JOINT_HALF_M
      const car = weight ? pose.front : pose.rear
      for (const x of [-3.275, 3.275]) {
        expect(articulatedLrtPoint(x, y, weight, pose)).toEqual([car[0] + x * car[2] + y * car[3], car[1] - x * car[3] + y * car[2]])
      }
    }
    // The inner body corners still have clearance on a tight turn.
    const front = articulatedLrtPoint(-4.32, 1.3, 1, pose), rear = articulatedLrtPoint(-4.32, -1.3, 0, pose)
    expect(front[1] - rear[1]).toBeGreaterThanOrEqual(.19)
    const mesh = createLrtMesh()
    let blended = 0
    for (let i = 0; i < mesh.length; i += LRT_VERTEX_FLOATS) {
      const weight = mesh[i + 10]
      expect(weight).toBeGreaterThanOrEqual(0)
      expect(weight).toBeLessThanOrEqual(1)
      if (Math.abs(mesh[i + 1]) > LRT_JOINT_HALF_M) expect(weight).toBe(mesh[i + 1] > 0 ? 1 : 0)
      if (weight > 0 && weight < 1) blended++
    }
    expect(blended).toBeGreaterThan(0)
  })

  it('keeps picking volumes and GPU car transforms together in either travel heading', () => {
    const track = curve(80)
    for (const reverse of [false, true]) {
      const v = vehicle(track, .5, reverse), pose = lrtArticulation(v, track)
      const values = vehicleInstances([v], 7.2, [pose])
      expect(values).toHaveLength(17)
      for (let i = 0; i < 4; i++) {
        expect(values[9 + i]).toBeCloseTo(pose.front[i], 5)
        expect(values[13 + i]).toBeCloseTo(pose.rear[i], 5)
      }
      const feature = buildLrtFeatures([v], [pose])[0]
      const angle = v.bearing * Math.PI / 180
      for (const [index, weight, sign] of [[0, 0, -1], [1, 1, 1]]) {
        const [x, y] = articulatedLrtPoint(4.32, sign * 30.5, weight, pose)
        const corner = feature.geometry.coordinates[index][0][2]
        expect(corner[0]).toBeCloseTo(v.coordinates[0] + (x * Math.cos(angle) + y * Math.sin(angle)) / lngUnit, 8)
        expect(corner[1]).toBeCloseTo(v.coordinates[1] + (-x * Math.sin(angle) + y * Math.cos(angle)) / 111320, 8)
      }
    }
  })

  it('changes continuously through an S curve and supports jumps without history', () => {
    const track = line(Array.from({ length: 241 }, (_, i): [number, number] => [25 * Math.sin((i - 120) / 40), i - 120]))
    let previous: ReturnType<typeof lrtArticulation> | undefined
    for (let i = 5; i <= 95; i++) {
      const pose = lrtArticulation(vehicle(track, i / 100), track)
      expect([...pose.front, ...pose.rear].every(Number.isFinite)).toBe(true)
      if (previous) {
        expect(Math.abs(pose.front[3] - previous.front[3])).toBeLessThan(.1)
        expect(Math.abs(pose.rear[3] - previous.rear[3])).toBeLessThan(.1)
      }
      previous = pose
    }
    const first = lrtArticulation(vehicle(track, .35), track)
    lrtArticulation(vehicle(track, .8), track)
    expect(lrtArticulation(vehicle(track, .35), track)).toEqual(first)
    expect(lrtArticulation(vehicle(track))).toBe(STRAIGHT_LRT)
    expect(lrtArticulation(vehicle(track), line([[0, 0], [0, 0]]))).toBe(STRAIGHT_LRT)
  })
})
