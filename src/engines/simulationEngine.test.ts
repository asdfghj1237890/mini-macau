import { describe, it, expect } from 'vitest'
import type { Feature, LineString } from 'geojson'
import type { BusRoute, BusStop, TransitData } from '../types'
import {
  computeVehiclePositions,
  getScheduleType,
  getBusServiceWindow,
  interpolateOnLine,
  interpolateOnLineSmooth,
  progressAtCycle,
  computeBusDirSec,
  computeBusCycleSec,
  getBusSchedule,
  DWELL_SEC,
  type BusSchedule,
  type BusStopScheduleEntry,
} from './simulationEngine'
import { macauWallToInstant } from '../macauTime'

const line = (coords: [number, number][]): Feature<LineString> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: coords },
})

describe('getScheduleType', () => {
  // 2026-05-04 = Monday, 2026-05-08 = Friday, 2026-05-10 = Sunday.
  // Build explicit Macau-noon instants so the day-type is independent of the
  // machine timezone the suite runs in (the engine reads Macau wall time).
  it('returns mon_thu for Monday', () => {
    expect(getScheduleType(macauWallToInstant(2026, 4, 4, 12, 0))).toBe('mon_thu')
  })
  it('returns mon_thu for Thursday', () => {
    expect(getScheduleType(macauWallToInstant(2026, 4, 7, 12, 0))).toBe('mon_thu')
  })
  it('returns friday for Friday', () => {
    expect(getScheduleType(macauWallToInstant(2026, 4, 8, 12, 0))).toBe('friday')
  })
  it('returns sat_sun for Saturday', () => {
    expect(getScheduleType(macauWallToInstant(2026, 4, 9, 12, 0))).toBe('sat_sun')
  })
  it('returns sat_sun for Sunday', () => {
    expect(getScheduleType(macauWallToInstant(2026, 4, 10, 12, 0))).toBe('sat_sun')
  })

  it('uses Macau time, not the host timezone, at the day boundary', () => {
    // 2026-05-08T20:00Z is Friday evening in UTC but Saturday 04:00 in Macau.
    expect(getScheduleType(new Date('2026-05-08T20:00:00Z'))).toBe('sat_sun')
    // 2026-05-09T15:30Z is Saturday in UTC but Sunday 23:30 in Macau.
    expect(getScheduleType(new Date('2026-05-09T15:30:00Z'))).toBe('sat_sun')
    // 2026-05-10T17:00Z is Sunday in UTC but Monday 01:00 in Macau.
    expect(getScheduleType(new Date('2026-05-10T17:00:00Z'))).toBe('mon_thu')
  })
})

describe('interpolateOnLine', () => {
  it('returns first coord at progress=0', () => {
    const r = interpolateOnLine(line([[113.5, 22.1], [113.6, 22.2]]), 0)
    expect(r.coordinates[0]).toBeCloseTo(113.5, 6)
    expect(r.coordinates[1]).toBeCloseTo(22.1, 6)
  })

  it('returns last coord at progress=1', () => {
    const r = interpolateOnLine(line([[113.5, 22.1], [113.6, 22.2]]), 1)
    expect(r.coordinates[0]).toBeCloseTo(113.6, 6)
    expect(r.coordinates[1]).toBeCloseTo(22.2, 6)
  })

  it('returns midpoint at progress=0.5 on a single-segment line', () => {
    const r = interpolateOnLine(line([[113.5, 22.1], [113.6, 22.2]]), 0.5)
    expect(r.coordinates[0]).toBeCloseTo(113.55, 4)
    expect(r.coordinates[1]).toBeCloseTo(22.15, 4)
  })

  it('clamps progress > 1 to the endpoint', () => {
    const r = interpolateOnLine(line([[113.5, 22.1], [113.6, 22.2]]), 5)
    expect(r.coordinates[0]).toBeCloseTo(113.6, 6)
    expect(r.coordinates[1]).toBeCloseTo(22.2, 6)
  })

  it('clamps progress < 0 to the start', () => {
    const r = interpolateOnLine(line([[113.5, 22.1], [113.6, 22.2]]), -1)
    expect(r.coordinates[0]).toBeCloseTo(113.5, 6)
    expect(r.coordinates[1]).toBeCloseTo(22.1, 6)
  })

  it('uses the engine bearing convention: due-east segment ⇒ 90°', () => {
    // bearing = atan2(dx, dy) where dx = Δlng, dy = Δlat (engine convention).
    const r = interpolateOnLine(line([[113.5, 22.15], [113.6, 22.15]]), 0.5)
    expect(r.bearing).toBeCloseTo(90, 4)
  })

  it('uses the engine bearing convention: due-north segment ⇒ 0°', () => {
    const r = interpolateOnLine(line([[113.5, 22.1], [113.5, 22.2]]), 0.5)
    expect(r.bearing).toBeCloseTo(0, 4)
  })

  it('picks the correct segment bearing on a multi-segment line', () => {
    // Two roughly-equal haversine segments: east leg, then north leg.
    // progress just into the second segment must report the north bearing.
    const fc = line([
      [113.5, 22.1],
      [113.5 + 0.001, 22.1],         // east leg
      [113.5 + 0.001, 22.1 + 0.001], // north leg
    ])
    const r = interpolateOnLine(fc, 0.9)
    expect(r.bearing).toBeCloseTo(0, 4)
  })

  it('handles a degenerate single-point line without throwing', () => {
    const r = interpolateOnLine(line([[113.5, 22.1]]), 0.5)
    expect(r.coordinates).toEqual([113.5, 22.1])
    expect(r.bearing).toBe(0)
  })
})

describe('interpolateOnLineSmooth', () => {
  it('matches interpolateOnLine position at midpoint', () => {
    const fc = line([[113.5, 22.1], [113.6, 22.2]])
    const a = interpolateOnLine(fc, 0.5)
    const b = interpolateOnLineSmooth(fc, 0.5)
    expect(b.coordinates[0]).toBeCloseTo(a.coordinates[0], 4)
    expect(b.coordinates[1]).toBeCloseTo(a.coordinates[1], 4)
  })

  it('produces a smoothed bearing across a kink within the smoothing window', () => {
    // Tight L-bend: smoothing window (default 15 m, ±) straddles the corner,
    // so the reported bearing must lie strictly between the two leg bearings.
    const fc = line([
      [113.5, 22.15],
      [113.5 + 0.0001, 22.15],          // ~10 m east
      [113.5 + 0.0001, 22.15 + 0.0001], // ~11 m north
    ])
    const r = interpolateOnLineSmooth(fc, 0.5)
    expect(r.bearing).toBeGreaterThan(0)
    expect(r.bearing).toBeLessThan(90)
  })

  it('falls back to a finite bearing at the very end of the line', () => {
    const fc = line([[113.5, 22.1], [113.6, 22.2]])
    const r = interpolateOnLineSmooth(fc, 1)
    expect(Number.isFinite(r.bearing)).toBe(true)
  })
})

const stop = (id: string, p: number, arriveSec: number, departSec: number): BusStopScheduleEntry =>
  ({ stopId: id, progress: p, arriveSec, departSec })

describe('progressAtCycle', () => {
  const circular: BusSchedule = {
    tripDurationSec: 1800, // 30 min
    cycleSec: 1800,
    isCircular: true,
    totalLenKm: 5,
    forwardStops: [
      stop('A', 0.0, 0, DWELL_SEC),
      stop('B', 0.5, 900, 900 + DWELL_SEC),
    ],
    backwardStops: [],
  }

  const bilateral: BusSchedule = {
    tripDurationSec: 1800, // 30-min one-way
    cycleSec: 3600,        // 60-min round trip
    isCircular: false,
    totalLenKm: 5,
    forwardStops: [
      stop('A', 0.0, 0, DWELL_SEC),
      stop('B', 1.0, 1800 - DWELL_SEC, 1800),
    ],
    backwardStops: [
      stop('B', 1.0, 0, DWELL_SEC),
      stop('A', 0.0, 1800 - DWELL_SEC, 1800),
    ],
  }

  it('circular: returns 0 at cycle start', () => {
    expect(progressAtCycle(circular, 0)).toBeCloseTo(0, 4)
  })

  it('circular: wraps a value beyond cycleSec back into the same cycle', () => {
    const a = progressAtCycle(circular, 600)
    const b = progressAtCycle(circular, 600 + circular.cycleSec)
    expect(b).toBeCloseTo(a, 4)
  })

  it('circular: returns a non-negative progress for a negative input', () => {
    const p = progressAtCycle(circular, -100)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
  })

  it('bilateral: forward leg progresses from 0 toward 1', () => {
    const start = progressAtCycle(bilateral, 0)
    const mid = progressAtCycle(bilateral, 900)
    const end = progressAtCycle(bilateral, 1800 - 1)
    expect(start).toBeLessThan(mid)
    expect(mid).toBeLessThan(end)
    expect(end).toBeGreaterThan(0.9)
  })

  it('bilateral: returning leg progresses from 1 back toward 0', () => {
    const justReturning = progressAtCycle(bilateral, 1801)
    const nearEnd = progressAtCycle(bilateral, 3600 - 1)
    expect(justReturning).toBeGreaterThan(nearEnd)
    expect(nearEnd).toBeLessThan(0.1)
  })

  it('bilateral: dwelling at a stop holds progress flat across the dwell window', () => {
    // forward stop A dwells [0, DWELL_SEC]: anywhere inside should pin to 0.
    expect(progressAtCycle(bilateral, 0)).toBeCloseTo(0, 4)
    expect(progressAtCycle(bilateral, DWELL_SEC / 2)).toBeCloseTo(0, 4)
    expect(progressAtCycle(bilateral, DWELL_SEC)).toBeCloseTo(0, 4)
  })
})

describe('computeBusDirSec', () => {
  const circular: BusSchedule = {
    tripDurationSec: 1800, cycleSec: 1800, isCircular: true, totalLenKm: 5,
    forwardStops: [], backwardStops: [],
  }
  const bilateral: BusSchedule = {
    tripDurationSec: 1800, cycleSec: 3600, isCircular: false, totalLenKm: 5,
    forwardStops: [], backwardStops: [],
  }

  it('circular: dirSec = cycleSec, never returning', () => {
    expect(computeBusDirSec(0, circular)).toEqual({ dirSec: 0, returning: false })
    expect(computeBusDirSec(900, circular)).toEqual({ dirSec: 900, returning: false })
  })

  it('bilateral: forward leg when cycleSec ≤ tripDurationSec', () => {
    expect(computeBusDirSec(0, bilateral)).toEqual({ dirSec: 0, returning: false })
    expect(computeBusDirSec(1800, bilateral)).toEqual({ dirSec: 1800, returning: false })
  })

  it('bilateral: returning leg when cycleSec > tripDurationSec', () => {
    expect(computeBusDirSec(1801, bilateral)).toEqual({ dirSec: 1, returning: true })
    expect(computeBusDirSec(3600, bilateral)).toEqual({ dirSec: 1800, returning: true })
  })
})

const minimalRoute = (over: Partial<BusRoute> = {}): BusRoute => ({
  id: 'test-route',
  name: 'Test',
  nameCn: '測試',
  color: '#000',
  stopsForward: [],
  stopsBackward: [],
  stopOffsets: [],
  directionSplitIndex: 0,
  geometry: line([[113.5, 22.1], [113.6, 22.2]]),
  frequency: 10,
  serviceHoursStart: 6,
  serviceHoursEnd: 22,
  routeType: 'bilateral',
  ...over,
})

describe('computeBusCycleSec', () => {
  const schedule: BusSchedule = {
    tripDurationSec: 1800, cycleSec: 3600, isCircular: false, totalLenKm: 5,
    forwardStops: [], backwardStops: [],
  }
  // 6:00 = 360 min, 22:00 = 1320 min.
  const route = minimalRoute({ frequency: 10 })

  it('returns 0 before service starts (vehicle 0 not yet dispatched)', () => {
    expect(computeBusCycleSec('test-route-0', schedule, route, 5 * 60)).toBe(0)
  })

  it('vehicle 0 at startMin gives elapsed=0 ⇒ cycleSec=0', () => {
    expect(computeBusCycleSec('test-route-0', schedule, route, 6 * 60)).toBe(0)
  })

  it('vehicle 0 30 min after start ⇒ 1800 sec into cycle', () => {
    expect(computeBusCycleSec('test-route-0', schedule, route, 6 * 60 + 30)).toBe(1800)
  })

  it('vehicle 0 60 min after start wraps back to 0 (cycleSec = 3600)', () => {
    expect(computeBusCycleSec('test-route-0', schedule, route, 6 * 60 + 60)).toBeCloseTo(0, 4)
  })

  it('staggered: vehicle 1 lags vehicle 0 by frequency*60 sec', () => {
    const v0 = computeBusCycleSec('test-route-0', schedule, route, 6 * 60 + 60)
    const v1 = computeBusCycleSec('test-route-1', schedule, route, 6 * 60 + 60)
    // v1 is dispatched 10 min later, so at the same wall time it's 600 s "behind"
    // — i.e. its elapsed wraps to (cycleSec - 600) within the cycle.
    expect(v1).toBeCloseTo((schedule.cycleSec - 10 * 60) % schedule.cycleSec, 4)
    expect(v0).toBeCloseTo(0, 4)
  })

  it('handles a route that crosses midnight (end < start treated as +24h)', () => {
    // Service 22:00 → 02:00 next day. The startMin > endMin path is the one
    // we want to hit; pick 22:30 (30 min in) so we're well clear of cycle wrap.
    const overnight = minimalRoute({
      serviceHoursStart: 22,
      serviceHoursEnd: 2,
      frequency: 10,
    })
    expect(computeBusCycleSec('test-route-0', schedule, overnight, 22 * 60 + 30)).toBe(1800)
    // 01:00 next day = nowMinutes 60. effectiveNow becomes 60 + 1440 = 1500;
    // startMin = 1320; elapsed_min = 180; elapsedSec = 10800;
    // 10800 % 3600 = 0, so we're back at the cycle start.
    expect(computeBusCycleSec('test-route-0', schedule, overnight, 60)).toBeCloseTo(0, 4)
  })

  it('Sunday bucket overrides weekday hours when both are defined', () => {
    const sunRoute = minimalRoute({
      serviceHoursStart: 6,
      serviceHoursEnd: 22,
      serviceHoursStartSun: 8,
      serviceHoursEndSun: 20,
      frequency: 10,
    })
    // 7:00 — inside weekday window, before Sunday window. With isSunBucket=true,
    // vehicle 0 hasn't been dispatched yet, so cycle = 0.
    expect(computeBusCycleSec('test-route-0', schedule, sunRoute, 7 * 60, true)).toBe(0)
    // 8:00 Sunday: dispatched right now.
    expect(computeBusCycleSec('test-route-0', schedule, sunRoute, 8 * 60, true)).toBe(0)
    // 8:30 Sunday: 30 min in.
    expect(computeBusCycleSec('test-route-0', schedule, sunRoute, 8 * 60 + 30, true)).toBe(1800)
  })

  it('treats an explicit null Sunday bucket as no service', () => {
    const noSundayRoute = minimalRoute({
      serviceHoursStartSun: null,
      serviceHoursEndSun: null,
    })

    expect(getBusServiceWindow(noSundayRoute, false)).toEqual({ start: 6, end: 22 })
    expect(getBusServiceWindow(noSundayRoute, true)).toBeNull()
    expect(computeBusCycleSec('test-route-0', schedule, noSundayRoute, 10 * 60, true)).toBe(0)
  })

  it('treats an explicit null Saturday bucket as no service', () => {
    const noSaturdayRoute = minimalRoute({
      serviceHoursStartSat: null,
      serviceHoursEndSat: null,
    })

    expect(getBusServiceWindow(noSaturdayRoute, 'weekday')).toEqual({ start: 6, end: 22 })
    expect(getBusServiceWindow(noSaturdayRoute, 'sat')).toBeNull()
    expect(computeBusCycleSec('test-route-0', schedule, noSaturdayRoute, 10 * 60, 'sat')).toBe(0)
  })

  it('supports a weekend-only route with no weekday service window', () => {
    const weekendOnly = minimalRoute({
      serviceHoursStart: null,
      serviceHoursEnd: null,
      serviceHoursStartSat: 11,
      serviceHoursEndSat: 19.5,
      serviceHoursStartSun: 11,
      serviceHoursEndSun: 19.5,
    })
    expect(getBusServiceWindow(weekendOnly, 'weekday')).toBeNull()
    expect(getBusServiceWindow(weekendOnly, 'sat')).toEqual({ start: 11, end: 19.5 })
    expect(getBusServiceWindow(weekendOnly, 'sun')).toEqual({ start: 11, end: 19.5 })
  })

  it('does not generate buses on Sunday when the Sunday bucket has no service', () => {
    const noSundayRoute = minimalRoute({
      serviceHoursStartSun: null,
      serviceHoursEndSun: null,
    })
    const transitData: TransitData = {
      lrtLines: [],
      stations: [],
      trips: [],
      busRoutes: [noSundayRoute],
      busStops: [],
      flights: [],
      ferries: [],
      roadWorks: [],
      schools: [],
      toilets: [],
      carParks: [],
      waste: [],
      wasteSources: [],
      waterFacilities: [],
      waterNetwork: null,
      powerFacilities: [],
      powerNetwork: null,
      loading: false,
    }

    const sunday = computeVehiclePositions(transitData, macauWallToInstant(2026, 4, 10, 10, 0))
    const monday = computeVehiclePositions(transitData, macauWallToInstant(2026, 4, 11, 10, 0))
    expect(sunday.filter(v => v.type === 'bus')).toHaveLength(0)
    expect(monday.filter(v => v.type === 'bus').length).toBeGreaterThan(0)
  })

  it('does not generate buses on Saturday when the Saturday bucket has no service', () => {
    const noSaturdayRoute = minimalRoute({
      serviceHoursStartSat: null,
      serviceHoursEndSat: null,
    })
    const transitData: TransitData = {
      lrtLines: [],
      stations: [],
      trips: [],
      busRoutes: [noSaturdayRoute],
      busStops: [],
      flights: [],
      ferries: [],
      roadWorks: [],
      schools: [],
      toilets: [],
      carParks: [],
      waste: [],
      wasteSources: [],
      waterFacilities: [],
      waterNetwork: null,
      powerFacilities: [],
      powerNetwork: null,
      loading: false,
    }

    const saturday = computeVehiclePositions(transitData, macauWallToInstant(2026, 4, 9, 10, 0))
    const monday = computeVehiclePositions(transitData, macauWallToInstant(2026, 4, 11, 10, 0))
    expect(saturday.filter(v => v.type === 'bus')).toHaveLength(0)
    expect(monday.filter(v => v.type === 'bus').length).toBeGreaterThan(0)
  })
})

describe('getBusSchedule', () => {
  const stops: Map<string, BusStop> = new Map([
    ['s1', { id: 's1', name: 'A', nameCn: '甲', coordinates: [113.5, 22.1], routeIds: ['test-route'] }],
    ['s2', { id: 's2', name: 'B', nameCn: '乙', coordinates: [113.55, 22.15], routeIds: ['test-route'] }],
    ['s3', { id: 's3', name: 'C', nameCn: '丙', coordinates: [113.6, 22.2], routeIds: ['test-route'] }],
  ])

  it('builds a forward + backward schedule for a bilateral route', () => {
    const route = minimalRoute({
      stopsForward: ['s1', 's2', 's3'],
      stopsBackward: ['s3', 's2', 's1'],
      routeType: 'bilateral',
    })
    const schedule = getBusSchedule(route, stops)
    expect(schedule).not.toBeNull()
    expect(schedule!.isCircular).toBe(false)
    expect(schedule!.forwardStops).toHaveLength(3)
    expect(schedule!.backwardStops).toHaveLength(3)
    // cycleSec is two trips for a bilateral route.
    expect(schedule!.cycleSec).toBe(schedule!.tripDurationSec * 2)
  })

  it('builds a single-direction schedule for a circular route', () => {
    const route = minimalRoute({
      stopsForward: ['s1', 's2', 's3', 's1'],
      stopsBackward: [],
      routeType: 'circular',
    })
    const schedule = getBusSchedule(route, stops)
    expect(schedule).not.toBeNull()
    expect(schedule!.isCircular).toBe(true)
    expect(schedule!.backwardStops).toHaveLength(0)
    expect(schedule!.cycleSec).toBe(schedule!.tripDurationSec)
  })

  it('uses published offsets to disambiguate a repeated stop on a loop', () => {
    const route = minimalRoute({
      geometry: line([
        [113.5, 22.1],
        [113.55, 22.15],
        [113.6, 22.2],
        [113.55, 22.15],
        [113.5, 22.1],
      ]),
      stopsForward: ['s1', 's2', 's1'],
      stopOffsets: [0, 3, 4],
      directionSplitIndex: 3,
      routeType: 'circular',
    })
    const schedule = getBusSchedule(route, stops)
    expect(schedule).not.toBeNull()
    expect(schedule!.forwardStops[1].progress).toBeGreaterThan(0.5)
  })

  it('returns null for a route whose polyline is too short', () => {
    const route = minimalRoute({
      geometry: line([[113.5, 22.1]]),
    })
    expect(getBusSchedule(route, stops)).toBeNull()
  })

  it('caches the schedule per route reference (returns the same instance)', () => {
    const route = minimalRoute({
      stopsForward: ['s1', 's3'],
      stopsBackward: ['s3', 's1'],
    })
    const a = getBusSchedule(route, stops)
    const b = getBusSchedule(route, stops)
    expect(a).toBe(b)
  })
})
