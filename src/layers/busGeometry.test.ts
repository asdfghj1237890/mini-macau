import { describe, expect, it } from 'vitest'
import type { VehiclePosition } from '../types'
import { buildBusFeatures, busesInBounds } from './busGeometry'
import { createBusMesh, BUS_VERTEX_FLOATS, BUS_HALF_LENGTH_M, BUS_HALF_WIDTH_M, BUS_HEIGHT_M } from './busMesh'
import { vehicleInstances } from './InstancedVehicleModelLayer'

const bus: VehiclePosition = {
  id: 'bus-1', type: 'bus', lineId: '1', coordinates: [113.57, 22.16], bearing: 0, progress: 0, color: '#e74c3c',
}

describe('Macau bus model', () => {
  it('culls distant buses but keeps an apron around pitched viewport edges', () => {
    const bounds = { getWest: () => 113.569, getEast: () => 113.571, getSouth: () => 22.159, getNorth: () => 22.161 }
    const edge = { ...bus, id: 'edge', coordinates: [113.572, 22.16] as [number, number] }
    const distant = { ...bus, id: 'distant', coordinates: [113.61, 22.2] as [number, number] }
    expect(busesInBounds([bus, edge, distant], bounds).map(v => v.id)).toEqual(['bus-1', 'edge'])
    expect(busesInBounds([], bounds)).toEqual([])
  })
  it('has bounded, finite, non-degenerate geometry within the shared mesh budget', () => {
    const mesh = createBusMesh(), stride = BUS_VERTEX_FLOATS
    expect(mesh.length % (stride * 3)).toBe(0)
    expect(mesh.length / (stride * 3)).toBeLessThan(1500)
    for (let i = 0; i < mesh.length; i += stride) {
      expect(Array.from(mesh.slice(i, i + stride)).every(Number.isFinite)).toBe(true)
      expect(Math.abs(mesh[i])).toBeLessThanOrEqual(BUS_HALF_WIDTH_M)
      expect(Math.abs(mesh[i + 1])).toBeLessThanOrEqual(BUS_HALF_LENGTH_M)
      expect(mesh[i + 2]).toBeGreaterThanOrEqual(0)
      expect(mesh[i + 2]).toBeLessThanOrEqual(BUS_HEIGHT_M)
      expect(Math.hypot(mesh[i + 3], mesh[i + 4], mesh[i + 5])).toBeCloseTo(1, 5)
    }
    for (let i = 0; i < mesh.length; i += stride * 3) {
      const u = [0, 1, 2].map(j => mesh[i + stride + j] - mesh[i + j])
      const v = [0, 1, 2].map(j => mesh[i + stride * 2 + j] - mesh[i + j])
      expect(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])).toBeGreaterThan(.001)
    }
  })

  it('retains independent route colours while the roof, glass and lights stay fixed', () => {
    const mesh = createBusMesh(), materials = Array.from({ length: mesh.length / BUS_VERTEX_FLOATS }, (_, i) => mesh[i * BUS_VERTEX_FLOATS + 9])
    expect(materials.some(a => a === 1)).toBe(true)
    expect(materials.some(a => a === 0)).toBe(true)
    expect(materials.some(a => a < 0)).toBe(true)
    const instances = vehicleInstances([bus, { ...bus, id: 'bus-2', color: '#3498db' }])
    expect(Array.from(instances.slice(6, 9))).toEqual([expect.closeTo(231 / 255), expect.closeTo(76 / 255), expect.closeTo(60 / 255)])
    expect(Array.from(instances.slice(15, 18))).toEqual([expect.closeTo(52 / 255), expect.closeTo(152 / 255), expect.closeTo(219 / 255)])
  })

  it('uses one closed picking volume per bus with matching heading, scale and altitude', () => {
    const north = buildBusFeatures([bus])[0]
    const east = buildBusFeatures([{ ...bus, bearing: 90, scale: .5, altitude: 12 }])[0]
    for (const feature of [north, east]) {
      const ring = feature.geometry.coordinates[0]
      expect(ring[0]).toEqual(ring.at(-1))
      expect(ring.flat().every(Number.isFinite)).toBe(true)
      expect(feature.properties!.vehicleId).toBe(bus.id)
    }
    const n = north.geometry.coordinates[0], e = east.geometry.coordinates[0]
    expect(n[0][1]).toBeGreaterThan(n[2][1])
    expect(e[0][0]).toBeGreaterThan(e[2][0])
    const widthMetres = (Math.max(...e.map(p => p[1])) - Math.min(...e.map(p => p[1]))) * 111320
    expect(widthMetres).toBeCloseTo(2.6)
    expect(east.properties!.baseM).toBe(12)
    expect(east.properties!.heightM).toBeCloseTo(12 + BUS_HEIGHT_M * .5)
    expect(vehicleInstances([{ ...bus, scale: .5, altitude: 12 }])[2]).toBeCloseTo(12)
    expect(buildBusFeatures([bus, { ...bus, id: 'bus-2' }])).toHaveLength(2)
    expect(buildBusFeatures([])).toEqual([])
  })
})
