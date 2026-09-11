import { describe, expect, it } from 'vitest'
import type { VehiclePosition } from '../types'
import { buildLrtFeatures } from './lrtGeometry'
import { createLrtMesh, LRT_HALF_LENGTH_M, LRT_HALF_WIDTH_M, LRT_HEIGHT_M, LRT_VIADUCT_TOP_M, LRT_VERTEX_FLOATS } from './lrtMesh'
import { vehicleInstances } from './InstancedVehicleModelLayer'

const train: VehiclePosition = {
  id: 'test-train', type: 'lrt', lineId: 'taipa', coordinates: [113.57, 22.16],
  bearing: 0, progress: 0, color: '#8cc63f',
}

describe('LRT mesh and picking geometry', () => {
  it('keeps all triangles finite, non-degenerate and inside the picking envelope', () => {
    const mesh = createLrtMesh()
    expect(mesh.length % (LRT_VERTEX_FLOATS * 3)).toBe(0)
    expect(mesh.length / (LRT_VERTEX_FLOATS * 3)).toBeLessThan(2400)
    expect([...mesh].every(Number.isFinite)).toBe(true)
    for (let i = 0; i < mesh.length; i += LRT_VERTEX_FLOATS) {
      expect(Math.hypot(mesh[i + 3], mesh[i + 4], mesh[i + 5])).toBeCloseTo(1, 5)
      expect(Math.abs(mesh[i])).toBeLessThanOrEqual(LRT_HALF_WIDTH_M + .001)
      expect(Math.abs(mesh[i + 1])).toBeLessThanOrEqual(LRT_HALF_LENGTH_M + .001)
      expect(mesh[i + 2]).toBeGreaterThanOrEqual(0)
      expect(mesh[i + 2]).toBeLessThanOrEqual(LRT_HEIGHT_M)
    }
    for (let i = 0; i < mesh.length; i += LRT_VERTEX_FLOATS * 3) {
      const a = mesh.slice(i, i + 3), b = mesh.slice(i + LRT_VERTEX_FLOATS, i + LRT_VERTEX_FLOATS + 3), c = mesh.slice(i + LRT_VERTEX_FLOATS * 2, i + LRT_VERTEX_FLOATS * 2 + 3)
      const u = b.map((n, j) => n - a[j]), v = c.map((n, j) => n - a[j])
      expect(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])).toBeGreaterThan(.001)
    }
  })

  it('uses the same fixed livery on all routes and has visible lamps at both cabs', () => {
    const mesh = createLrtMesh()
    const litEnds = new Set<number>()
    for (let i = 0; i < mesh.length; i += LRT_VERTEX_FLOATS) {
      // A positive material flag would substitute a route colour into the body.
      expect(mesh[i + 9]).toBeLessThanOrEqual(0)
      if (mesh[i + 9] < 0) litEnds.add(Math.sign(mesh[i + 1]))
    }
    expect([...litEnds].sort()).toEqual([-1, 1])
  })

  it('places the mesh and picking volumes on the viaduct without scaling its elevation', () => {
    const values = vehicleInstances([{ ...train, scale: .5 }], LRT_VIADUCT_TOP_M)
    expect(values[2]).toBeCloseTo(LRT_VIADUCT_TOP_M, 4)
    expect(values[5]).toBeCloseTo(.5)
    const features = buildLrtFeatures([{ ...train, scale: .5 }])
    expect(features[0].properties!.baseM).toBe(LRT_VIADUCT_TOP_M)
    expect(features[0].properties!.heightM).toBeCloseTo(LRT_VIADUCT_TOP_M + LRT_HEIGHT_M * .5)
    const elevated = vehicleInstances([{ ...train, altitude: 15 }], LRT_VIADUCT_TOP_M)
    expect(elevated[2]).toBeCloseTo(15, 4)
    expect(buildLrtFeatures([{ ...train, altitude: 15 }])[0].properties!.baseM).toBe(15)
  })

  it('keeps both cars pickable with closed rings, the vehicle id and geographic heading', () => {
    for (const bearing of [0, 90, 180, 270]) {
      const vehicle = { ...train, bearing }
      const features = buildLrtFeatures([vehicle])
      expect(features).toHaveLength(2)
      expect(features[0].geometry.coordinates).toHaveLength(2)
      for (const feature of features) {
        expect(feature.properties!.vehicleId).toBe(train.id)
        for (const [ring] of feature.geometry.coordinates) {
          expect(ring[0]).toEqual(ring.at(-1))
          expect(ring.flat().every(Number.isFinite)).toBe(true)
        }
      }
      const front = features[0].geometry.coordinates[1][0][2]
      const pose = vehicleInstances([vehicle], LRT_VIADUCT_TOP_M)
      const east = (front[0] - train.coordinates[0]) * 111320 * Math.cos(train.coordinates[1] * Math.PI / 180)
      const north = (front[1] - train.coordinates[1]) * 111320
      expect(east).toBeCloseTo(LRT_HALF_WIDTH_M * pose[3] + LRT_HALF_LENGTH_M * pose[4], 3)
      expect(north).toBeCloseTo(-LRT_HALF_WIDTH_M * pose[4] + LRT_HALF_LENGTH_M * pose[3], 3)
    }
    expect(buildLrtFeatures([])).toEqual([])
  })
})
