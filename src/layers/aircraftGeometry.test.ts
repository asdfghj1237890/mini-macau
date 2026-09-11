import { describe, expect, it } from 'vitest'
import type { VehiclePosition } from '../types'
import { buildFlightFeatures } from './aircraftGeometry'
import { AIRCRAFT_VERTEX_FLOATS, createAircraftMesh } from './aircraftMesh'
import { aircraftInstances } from './AircraftModelLayer'

const flight: VehiclePosition = {
  id: 'test-flight', type: 'flight', lineId: 'NX1', coordinates: [113.57, 22.16],
  bearing: 0, progress: 0, color: '#38bdf8',
}

describe('aircraft model', () => {
  it('has finite, non-degenerate triangles and unit normals within a small shared mesh', () => {
    const mesh = createAircraftMesh()
    expect(mesh.length % (AIRCRAFT_VERTEX_FLOATS * 3)).toBe(0)
    expect(mesh.length / (AIRCRAFT_VERTEX_FLOATS * 3)).toBeLessThan(2000)
    expect([...mesh].every(Number.isFinite)).toBe(true)
    for (let i = 0; i < mesh.length; i += AIRCRAFT_VERTEX_FLOATS) {
      expect(Math.hypot(mesh[i + 3], mesh[i + 4], mesh[i + 5])).toBeCloseTo(1, 5)
      expect(mesh[i + 2]).toBeGreaterThanOrEqual(0)
    }
    for (let i = 0; i < mesh.length; i += AIRCRAFT_VERTEX_FLOATS * 3) {
      const a = mesh.slice(i, i + 3), b = mesh.slice(i + 10, i + 13), c = mesh.slice(i + 20, i + 23)
      const u = b.map((n, j) => n - a[j]), v = c.map((n, j) => n - a[j])
      expect(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])).toBeGreaterThan(.001)
    }
  })

  it('keeps the local origin precise and uses clockwise geographic bearings', () => {
    const north = aircraftInstances([flight])
    expect(Array.from(north.slice(0, 3))).toEqual([0, 0, 0])
    expect(north[3]).toBe(1)
    expect(north[4]).toBe(0)
    const east = aircraftInstances([{ ...flight, bearing: 90 }])
    expect(east[3]).toBeCloseTo(0)
    expect(east[4]).toBeCloseTo(1)
  })

  it('scales the aircraft without scaling its flight altitude', () => {
    const full = aircraftInstances([{ ...flight, altitude: 1000 }])
    const small = aircraftInstances([{ ...flight, scale: .25, altitude: 1000 }])
    expect(small[2]).toBeCloseTo(full[2])
    expect(small[2]).toBeCloseTo(1000, 3)
    expect(small[5]).toBeCloseTo(full[5] / 4)
    const hits = buildFlightFeatures([{ ...flight, scale: .25, altitude: 1000 }])
    expect(hits.every(f => f.properties!.baseM >= 1000 && f.properties!.heightM <= 1019)).toBe(true)
  })

  it('keeps picking rings closed and rotates their nose into the same heading', () => {
    const north = buildFlightFeatures([flight])
    const east = buildFlightFeatures([{ ...flight, bearing: 90 }])
    for (const feature of [...north, ...east]) {
      expect(feature.properties!.vehicleId).toBe(flight.id)
      for (const [ring] of feature.geometry.coordinates) {
        expect(ring[0]).toEqual(ring.at(-1))
        expect(ring.flat().every(Number.isFinite)).toBe(true)
      }
    }
    expect(north[0].geometry.coordinates[0][0][0][1]).toBeGreaterThan(flight.coordinates[1])
    expect(east[0].geometry.coordinates[0][0][0][0]).toBeGreaterThan(flight.coordinates[0])
  })

  it('keeps flight identity colours independent across instances and clears empty fleets', () => {
    const values = aircraftInstances([flight, { ...flight, id: 'other', color: '#ff0000' }])
    expect(Array.from(values.slice(15, 18))).toEqual([1, 0, 0])
    expect(aircraftInstances([])).toHaveLength(0)
    expect(buildFlightFeatures([])).toEqual([])
  })
})
