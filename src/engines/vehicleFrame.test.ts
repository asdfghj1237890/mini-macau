import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Flight, TransitData } from '../types'
import { VehicleFrame } from './vehicleFrame'
import { computeFlightOnly, computeSingleFlight, computeVehiclePositions } from './simulationEngine'

vi.mock('./simulationEngine', () => ({
  computeVehiclePositions: vi.fn(() => [{ id: 'bus', type: 'bus' }]),
  computeFlightOnly: vi.fn((data: TransitData, time: Date) => data.flights.map(f => ({ id: f.id, type: 'flight', progress: time.getTime() }))),
  computeSingleFlight: vi.fn((flight: Flight, time: Date) => ({ id: flight.id, type: 'flight', progress: time.getTime() })),
}))
const data = { flights: [{ id: 'a' }, { id: 'b' }] } as TransitData
const renderer = {}
const input = { now: 0, simMs: 1000, data, zoom: 18, renderer, trackedId: null as string | null, uploadInterval: 33 }
beforeEach(() => vi.clearAllMocks())

describe('vehicle frame scheduling', () => {
  it('does no simulation or upload work while paused with unchanged data and view', () => {
    const frames = new VehicleFrame(), first = frames.sample(input)
    expect(first.upload).toBe(true)
    for (let now = 10; now < 6000; now += 10) {
      const next = frames.sample({ ...input, now })
      expect(next.upload).toBe(false)
      expect(next.trackedUpdated).toBe(false)
      expect(next.vehicles).toBe(first.vehicles)
    }
    expect(computeVehiclePositions).toHaveBeenCalledTimes(1)
    expect(computeVehiclePositions).toHaveBeenCalledWith(data, new Date(1000), { includeFlights: false })
    expect(computeFlightOnly).toHaveBeenCalledTimes(1)
    expect(computeSingleFlight).not.toHaveBeenCalled()
  })

  it.each([33, 100, 160])('samples the flight fleet only at the %i ms upload cadence', uploadInterval => {
    const frames = new VehicleFrame()
    let writes = 0
    for (let now = 0; now <= 960; now += 8) {
      const frame = frames.sample({ ...input, now, simMs: 1000 + now * 60, uploadInterval })
      if (frame.upload) writes++
    }
    expect(computeFlightOnly).toHaveBeenCalledTimes(writes)
    expect(writes).toBeLessThanOrEqual(1 + Math.floor(960 / uploadInterval))
    expect(computeSingleFlight).not.toHaveBeenCalled()
  })

  it('reuses the fleet result on upload frames and samples only the tracked plane between them', () => {
    const frames = new VehicleFrame()
    const first = frames.sample({ ...input, trackedId: 'a', uploadInterval: 100 })
    expect(first.trackedFlight).toBe(first.flights[0])
    for (let now = 10; now <= 90; now += 10) {
      const frame = frames.sample({ ...input, trackedId: 'a', now, simMs: 1000 + now, uploadInterval: 100 })
      expect(frame.trackedFlight?.progress).toBe(1000 + now)
      expect(frame.upload).toBe(false)
    }
    const next = frames.sample({ ...input, trackedId: 'a', now: 100, simMs: 1100, uploadInterval: 100 })
    expect(next.trackedFlight).toBe(next.flights[0])
    expect(computeFlightOnly).toHaveBeenCalledTimes(2)
    expect(computeSingleFlight).toHaveBeenCalledTimes(9)
    expect(vi.mocked(computeSingleFlight).mock.calls.every(([flight]) => flight.id === 'a')).toBe(true)
  })

  it('flushes pending paused updates after throttling, including small seeks and new data', () => {
    const frames = new VehicleFrame()
    frames.sample({ ...input, uploadInterval: 100 })
    frames.sample({ ...input, now: 40, simMs: 1200, uploadInterval: 100 })
    expect(frames.sample({ ...input, now: 80, simMs: 1200, uploadInterval: 100 }).upload).toBe(false)
    expect(frames.sample({ ...input, now: 100, simMs: 1200, uploadInterval: 100 }).upload).toBe(true)
    const sought = frames.sample({ ...input, now: 200, simMs: 800, uploadInterval: 100 })
    expect(sought.flights[0].progress).toBe(800)
    expect(sought.upload).toBe(true)
    const filtered = { ...data, flights: [] }
    const hidden = frames.sample({ ...input, now: 300, simMs: 800, data: filtered, uploadInterval: 100 })
    expect(hidden.flights).toEqual([])
    expect(hidden.upload).toBe(true)
    expect(frames.sample({ ...input, now: 400, simMs: 800, data: filtered }).upload).toBe(false)
  })

  it('restores models after paused zoom or style/context changes without recomputing vehicles', () => {
    const frames = new VehicleFrame()
    const first = frames.sample(input)
    for (const change of [{ now: 100, zoom: 13 }, { now: 200, zoom: 18 }, { now: 300, renderer: {} }]) {
      const next = frames.sample({ ...input, ...change })
      expect(next.upload).toBe(true)
      expect(next.vehicles).toBe(first.vehicles)
    }
    expect(computeVehiclePositions).toHaveBeenCalledTimes(1)
    expect(computeFlightOnly).toHaveBeenCalledTimes(1)
  })

  it('handles paused selection, switching and hiding the tracked flight', () => {
    const frames = new VehicleFrame()
    frames.sample(input)
    const tracked = frames.sample({ ...input, now: 100, trackedId: 'a' })
    expect(tracked.trackedFlight?.id).toBe('a')
    expect(tracked.trackedUpdated).toBe(true)
    const stable = frames.sample({ ...input, now: 200, trackedId: 'a' })
    expect(stable.upload).toBe(false)
    expect(stable.trackedUpdated).toBe(false)
    expect(frames.sample({ ...input, now: 300, trackedId: 'b' }).trackedFlight?.id).toBe('b')
    expect(frames.sample({ ...input, now: 400, trackedId: 'b', data: { ...data, flights: [] } }).trackedFlight).toBeNull()
    expect(frames.sample({ ...input, now: 500 }).trackedFlight).toBeNull()
  })

  it('does not return an old tracked position after the flight leaves service', () => {
    const frames = new VehicleFrame()
    frames.sample({ ...input, trackedId: 'a' })
    vi.mocked(computeSingleFlight).mockReturnValueOnce(null)
    expect(frames.sample({ ...input, now: 10, simMs: 1010, trackedId: 'a' }).trackedFlight).toBeNull()
  })
})
