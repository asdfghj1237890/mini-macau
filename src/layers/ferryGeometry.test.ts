import { describe, expect, it } from 'vitest'
import type { VehiclePosition } from '../types'
import { createFerryMesh, FERRY_VERTEX_FLOATS } from './ferryMesh'
import { buildFerryFeatures } from './ferryGeometry'
import { vehicleInstances } from './InstancedVehicleModelLayer'

const ferry: VehiclePosition = { id: 'ferry-test', type: 'ferry', lineId: 'test', coordinates: [113.57, 22.16], bearing: 0, progress: 0, color: '#ee3344' }

describe('ferry model geometry', () => {
  it('has finite, non-degenerate triangles and unit normals in a bounded shared mesh', () => {
    const mesh = createFerryMesh(), stride = FERRY_VERTEX_FLOATS
    expect(mesh.length % (stride * 3)).toBe(0)
    expect(mesh.length / (stride * 3)).toBeLessThan(2400)
    expect([...mesh].every(Number.isFinite)).toBe(true)
    for (let i = 0; i < mesh.length; i += stride) {
      expect(Math.hypot(mesh[i + 3], mesh[i + 4], mesh[i + 5])).toBeCloseTo(1, 5)
      expect(Math.abs(mesh[i])).toBeLessThanOrEqual(7.01)
      expect(Math.abs(mesh[i + 1])).toBeLessThanOrEqual(25)
      expect(mesh[i + 2]).toBeGreaterThanOrEqual(0)
      expect(mesh[i + 2]).toBeLessThan(14.2)
    }
    for (let i = 0; i < mesh.length; i += stride * 3) {
      const a = mesh.slice(i, i + 3), b = mesh.slice(i + stride, i + stride + 3), c = mesh.slice(i + stride * 2, i + stride * 2 + 3)
      const u = b.map((n, j) => n - a[j]), v = c.map((n, j) => n - a[j])
      expect(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])).toBeGreaterThan(.00001)
    }
  })

  it('keeps both bows separated and rotates closed picking rings with the model', () => {
    const north = buildFerryFeatures([ferry]), east = buildFerryFeatures([{ ...ferry, bearing: 90 }])
    expect(north).toHaveLength(4)
    expect(north[0].geometry.coordinates[0].every(([x]) => x < ferry.coordinates[0])).toBe(true)
    expect(north[1].geometry.coordinates[0].every(([x]) => x > ferry.coordinates[0])).toBe(true)
    for (const feature of [...north, ...east]) {
      const ring = feature.geometry.coordinates[0]
      expect(ring[0]).toEqual(ring.at(-1))
      expect(feature.properties!.vehicleId).toBe(ferry.id)
    }
    const n = north[0].geometry.coordinates[0][0], e = east[0].geometry.coordinates[0][0]
    expect(n[1]).toBeGreaterThan(ferry.coordinates[1])
    expect(e[0]).toBeGreaterThan(ferry.coordinates[0])
  })

  it('scales picking and mesh together while preserving altitude and operator colours', () => {
    const small = { ...ferry, scale: .5, altitude: 2 }
    const full = buildFerryFeatures([ferry]), scaled = buildFerryFeatures([small])
    full.forEach((f, i) => {
      expect(scaled[i].properties!.heightM).toBeCloseTo(2 + f.properties!.heightM / 2)
      expect(scaled[i].geometry.coordinates[0][0][1] - ferry.coordinates[1]).toBeCloseTo((f.geometry.coordinates[0][0][1] - ferry.coordinates[1]) / 2, 8)
    })
    const instances = vehicleInstances([small, { ...ferry, color: '#0088ff' }])
    expect(instances[2]).toBeCloseTo(2)
    expect(instances[5]).toBeCloseTo(.5)
    expect(Array.from(instances.slice(15, 18))).toEqual([0, expect.closeTo(136 / 255), 1])
    expect(buildFerryFeatures([])).toEqual([])
  })
})
