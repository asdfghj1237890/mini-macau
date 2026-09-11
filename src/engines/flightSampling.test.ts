import { describe, expect, it } from 'vitest'
import type { Flight, TransitData } from '../types'
import { computeFlightOnly, computeSingleFlight, computeVehiclePositions } from './simulationEngine'
import { macauWallToInstant } from '../macauTime'

const flights: Flight[] = ['arrival', 'departure'].map((type, i) => ({
  id: `synthetic-${i}`, flightNumber: `TEST${i}`, type: type as Flight['type'],
  airline: { name: 'Test', iata: 'ZZ' }, scheduledTime: 600,
}))
const data = { flights, trips: [], lrtLines: [], stations: [], busRoutes: [], busStops: [], ferries: [] } as unknown as TransitData

describe('shared flight sampling', () => {
  it('keeps fleet and individual sampling identical across phases and time jumps', () => {
    const phases = new Set()
    for (const seconds of [-3600, -600, -60, 0, 60, 600, 3600, -60, 5, -5]) {
      const time = macauWallToInstant(2026, 4, 4, 10, 0, seconds)
      const fleet = computeFlightOnly(data, time)
      expect(computeVehiclePositions(data, time)).toEqual(fleet)
      expect(computeVehiclePositions(data, time, { includeFlights: false })).toEqual([])
      for (const flight of flights) expect(computeSingleFlight(flight, time)).toEqual(fleet.find(v => v.id === flight.id) ?? null)
      for (const v of fleet) phases.add(v.flightPhase)
    }
    expect(phases.size).toBeGreaterThan(2)
  })
})
