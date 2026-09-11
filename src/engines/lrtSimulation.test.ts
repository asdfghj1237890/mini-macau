import { describe, expect, it, vi } from 'vitest'
import type { ScheduleType, TransitData, Trip } from '../types'
import { macauWallToInstant } from '../macauTime'
import { computeVehiclePositions } from './simulationEngine'

// Entirely synthetic track and timetable; no service data is embedded here.
function fixture(trips?: Trip[]): TransitData {
  return {
    lrtLines: [{
      id: 'test', name: 'Test', nameCn: '測試', color: '#80bd43', stations: ['A', 'B', 'C'],
      geometry: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[113.5, 22.1], [113.5, 22.12]] } },
    }],
    stations: ['A', 'B', 'C'].map((id, i) => ({ id, name: id, nameCn: id, namePt: id, lineIds: ['test'], coordinates: [113.5, 22.1 + i * .01] })),
    trips: trips ?? [{ id: 'test-trip', lineId: 'test', direction: 'forward', entries: [
      { stationId: 'A', arrivalMinutes: 600, departureMinutes: 600.5 },
      { stationId: 'B', arrivalMinutes: 602.5, departureMinutes: 603 },
      { stationId: 'C', arrivalMinutes: 605 },
    ] }],
    busRoutes: [], busStops: [], flights: [], ferries: [], roadWorks: [], schools: [], publicHousing: [],
    parishes: [], toilets: [], carParks: [], waste: [], wasteSources: [], wasteFacilities: [], wasteEcoStations: [],
    dspaStats: null, waterFacilities: [], waterNetwork: null, waterFacts: null, powerFacilities: [], powerNetwork: null,
    powerFacts: null, grandPrix: null, grandPrixSources: [], loading: false,
  }
}

const at = (data: TransitData, seconds: number) => computeVehiclePositions(data, macauWallToInstant(2026, 4, 4, 10, 0, seconds))

describe('LRT timetable-anchored motion', () => {
  it('holds explicit arrival/departure intervals and reaches every station at its timestamp', () => {
    const data = fixture()
    for (const [seconds, latitude] of [[0, 22.1], [15, 22.1], [30, 22.1], [150, 22.11], [165, 22.11], [180, 22.11], [300, 22.12]]) {
      const [v] = at(data, seconds)
      expect(v.coordinates[1]).toBeCloseTo(latitude, 6)
      expect(v.lrtMotion).toEqual({ speedKmh: 0, phase: 'stopped' })
    }
    expect(at(data, -1)).toHaveLength(0)
    expect(at(data, 319)[0].lrtMotion!.phase).toBe('stopped')
    expect(at(data, 321)).toHaveLength(0)
  })

  it('accelerates after departure and slows down before arrival without arriving early', () => {
    const data = fixture()
    const start = at(data, 31)[0], cruise = at(data, 90)[0], approach = at(data, 149)[0]
    expect(start.lrtMotion!.phase).toBe('accelerating')
    expect(cruise.lrtMotion!.phase).toBe('cruising')
    expect(approach.lrtMotion!.phase).toBe('braking')
    expect(start.lrtMotion!.speedKmh).toBeLessThan(cruise.lrtMotion!.speedKmh)
    expect(approach.lrtMotion!.speedKmh).toBeLessThan(cruise.lrtMotion!.speedKmh)
    expect(start.coordinates[1]).toBeGreaterThan(22.1)
    expect(approach.coordinates[1]).toBeLessThan(22.11)
    for (let second = 0; second <= 300; second++) {
      expect(at(data, second)[0].lrtMotion!.speedKmh).toBeLessThanOrEqual(80)
    }
  })

  it('defaults to twenty seconds at each station while retaining every arrival timestamp', () => {
    const data = fixture()
    data.trips[0].entries = data.trips[0].entries.map(({ stationId, arrivalMinutes }) => ({ stationId, arrivalMinutes }))
    expect(at(data, 150)[0].lrtMotion!.speedKmh).toBe(0)
    expect(at(data, 149)[0].lrtMotion!.phase).toBe('braking')
    for (const second of [150, 151, 160, 169, 170]) {
      expect(at(data, second)[0].lrtMotion!.speedKmh).toBe(0)
      expect(at(data, second)[0].coordinates[1]).toBeCloseTo(22.11, 6)
    }
    expect(at(data, 171)[0].lrtMotion!.phase).toBe('accelerating')
    expect(at(data, 171)[0].coordinates[1]).toBeGreaterThan(22.11)
    expect(at(data, 300)[0].coordinates[1]).toBeCloseTo(22.12, 6)
  })

  it('faces the travel direction on return trips and uses the same speed law', () => {
    const forward = fixture(), backward = fixture()
    backward.trips[0].direction = 'backward'
    backward.trips[0].entries.forEach((e, i) => { e.stationId = ['C', 'B', 'A'][i] })
    const f = at(forward, 90)[0], b = at(backward, 90)[0]
    expect(f.bearing).toBeCloseTo(0)
    expect(b.bearing).toBeCloseTo(180)
    expect(b.lrtMotion!.speedKmh).toBeCloseTo(f.lrtMotion!.speedKmh, 3)
    expect(at(backward, 91)[0].progress).toBeLessThan(b.progress)
    expect(at(backward, 150)[0].coordinates[1]).toBeCloseTo(22.11, 6)
  })

  it('seeking or reversing the simulation clock cannot accumulate arrival drift', () => {
    const data = fixture()
    const initial = at(data, 117)
    for (const second of [290, 0, 301, 181, 30, 149]) at(data, second)
    expect(at(data, 117)).toEqual(initial)
    expect(at(data, 150)[0].lrtMotion!.speedKmh).toBe(0)
  })

  it('keeps simultaneous opposing trains on their own tracks while moving and stopped', () => {
    const data = fixture()
    data.trips.push({ ...data.trips[0], id: 'return-trip', direction: 'backward', entries:
      data.trips[0].entries.map((e, i) => ({ ...e, stationId: ['C', 'B', 'A'][i] })),
    })
    for (const second of [0, 31, 90, 149, 150, 165, 180, 181, 250, 300, 20, 165]) {
      const [f, b] = at(data, second)
      expect(f.lrtDirection).toBe('forward')
      expect(b.lrtDirection).toBe('backward')
      expect(f.coordinates[0]).toBeLessThan(113.5)
      expect(b.coordinates[0]).toBeGreaterThan(113.5)
      const separation = (b.coordinates[0] - f.coordinates[0]) * 111320 * Math.cos(22.1 * Math.PI / 180)
      expect(separation).toBeCloseTo(15, 4)
    }
    const stopped = at(data, 165)
    expect(stopped.every(v => v.lrtMotion!.speedKmh === 0)).toBe(true)
    expect(stopped[0].coordinates[1]).toBeCloseTo(stopped[1].coordinates[1], 6)
  })

  it('reports an impossible movement once and never compensates with overspeed', () => {
    const data = fixture()
    data.trips[0].entries = [{ stationId: 'A', arrivalMinutes: 600 }, { stationId: 'C', arrivalMinutes: 600.5 }]
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(at(data, 21)).toHaveLength(0)
      expect(at(data, 25)).toHaveLength(0)
      expect(warning).toHaveBeenCalledTimes(1)
      expect(at(data, 30)[0].coordinates[1]).toBeCloseTo(22.12, 6)
    } finally { warning.mockRestore() }
  })
})

describe('LRT service day across Macau midnight', () => {
  const types: ScheduleType[] = ['mon_thu', 'friday', 'sat_sun']
  const trips: Trip[] = types.flatMap(scheduleType => [{
    id: `${scheduleType}-tail`, lineId: 'test', direction: 'forward' as const, scheduleType,
    entries: [{ stationId: 'A', arrivalMinutes: 1439 }, { stationId: 'B', arrivalMinutes: 1441 }],
  }, {
    id: `${scheduleType}-morning`, lineId: 'test', direction: 'forward' as const, scheduleType,
    entries: [{ stationId: 'A', arrivalMinutes: 600 }, { stationId: 'B', arrivalMinutes: 602 }],
  }])

  it.each([[8, 'mon_thu', 'friday'], [9, 'friday', 'sat_sun'], [11, 'sat_sun', 'mon_thu']] as const)(
    'keeps the previous service day on May %i, then selects the correct new-day trips', (day, previous, current) => {
      const data = fixture(trips)
      const before = computeVehiclePositions(data, macauWallToInstant(2026, 4, day - 1, 23, 59, 59, 999))
      const midnight = computeVehiclePositions(data, macauWallToInstant(2026, 4, day))
      expect(before.map(v => v.id)).toEqual([`${previous}-tail`])
      expect(midnight.map(v => v.id)).toEqual([`${previous}-tail`])
      expect(midnight[0].progress).toBeCloseTo(before[0].progress, 4)
      expect(computeVehiclePositions(data, macauWallToInstant(2026, 4, day, 0, 1))[0].lrtMotion!.speedKmh).toBe(0)
      expect(computeVehiclePositions(data, macauWallToInstant(2026, 4, day, 0, 1, 19))[0].lrtMotion!.speedKmh).toBe(0)
      expect(computeVehiclePositions(data, macauWallToInstant(2026, 4, day, 0, 1, 21))).toHaveLength(0)
      const morning = computeVehiclePositions(data, macauWallToInstant(2026, 4, day, 10, 1))
      expect(morning.map(v => v.id)).toEqual([`${current}-morning`])
    },
  )

  it('does not duplicate an overnight trip when both days use the same timetable', () => {
    const vehicles = computeVehiclePositions(fixture(trips), macauWallToInstant(2026, 4, 5))
    expect(vehicles.map(v => v.id)).toEqual(['mon_thu-tail'])
  })

  it('keeps the final dwell visible when arrival is before midnight and departure after it', () => {
    const data = fixture([{ id: 'dwell-tail', lineId: 'test', direction: 'forward', scheduleType: 'mon_thu', entries: [
      { stationId: 'A', arrivalMinutes: 1437 }, { stationId: 'B', arrivalMinutes: 1439.9 },
    ] }])
    const tail = computeVehiclePositions(data, macauWallToInstant(2026, 4, 8, 0, 0, 5))
    expect(tail.map(v => v.id)).toEqual(['dwell-tail'])
    expect(tail[0].lrtMotion!.phase).toBe('stopped')
    expect(computeVehiclePositions(data, macauWallToInstant(2026, 4, 8, 0, 0, 15))).toHaveLength(0)
  })
})
