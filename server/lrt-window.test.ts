import { describe, expect, it } from 'vitest'
import type { TransitData } from '../src/types'
import { createLrtWindowProvider } from './lrt-window'
import { computeLRTVehicle } from './lrt-simulation'
import { sampleLrtVehicles, getLineLength } from '../src/engines/simulationEngine'
import { getLrtTrack } from '../src/lrtTracks'
import { LrtStateWindowSchema, lrtWindowStart } from '../src/lrtState'
import { assertLrtBrowserModule } from '../plugins/lrt-dev-api'

const start = Date.parse('2026-05-04T10:00:00+08:00')
const fixture = (): Pick<TransitData, 'lrtLines' | 'stations' | 'trips'> => ({
  lrtLines: [{ id: 'line', name: 'Line', nameCn: '測試', color: '#fff', stations: ['a', 'b', 'c'],
    geometry: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[113.5, 22.1], [113.503, 22.105], [113.5, 22.11]] } } }],
  stations: ['a', 'b', 'c'].map((id, i) => ({ id, name: id, nameCn: id, namePt: id, lineIds: ['line'],
    coordinates: [i === 1 ? 113.503 : 113.5, 22.1 + i * .005] })),
  trips: [{ id: 'original-identifier', lineId: 'line', direction: 'forward', scheduleType: 'mon_thu', entries: [
    { stationId: 'a', arrivalMinutes: 600 }, { stationId: 'b', arrivalMinutes: 602 }, { stationId: 'c', arrivalMinutes: 604 },
  ] }],
})

describe('bounded LRT playback', () => {
  it('only publishes poses, service spans and stop events within two minutes', () => {
    const window = createLrtWindowProvider(fixture())(start)
    expect(LrtStateWindowSchema.safeParse(window).success).toBe(true)
    expect(window.end - window.start).toBe(120_000)
    expect(window.vehicles[0].stops.map(s => s.stationId)).toEqual(['a', 'b'])
    expect(window.vehicles[0].stops[1].departure).toBeNull()
    const body = JSON.stringify(window)
    for (const forbidden of ['entries', 'arrivalMinutes', 'departureMinutes', 'scheduleType', 'original-identifier']) {
      expect(body).not.toContain(forbidden)
    }
  })

  it.each(['forward', 'backward'] as const)('matches scheduled motion on the %s track, including dwells and curve placement', direction => {
    const data = fixture()
    data.trips[0].direction = direction
    if (direction === 'backward') data.trips[0].entries = data.trips[0].entries.map((e, i) => ({ ...e, stationId: ['c', 'b', 'a'][i] }))
    const provide = createLrtWindowProvider(data)
    const meters = getLineLength(getLrtTrack(data.lrtLines[0].geometry, direction)) * 1000
    for (let seconds = 0; seconds < 260; seconds += .25) {
      const time = start + seconds * 1000
      const window = provide(lrtWindowStart(time))
      const actual = sampleLrtVehicles({ ...data, lrtWindows: [window] }, time)[0]
      const expected = computeLRTVehicle(data, data.trips[0], new Date(time))!
      expect(actual).toBeDefined()
      expect(Math.abs(actual.progress - expected.progress) * meters).toBeLessThan(.2)
      expect(Math.abs(actual.lrtMotion!.speedKmh - expected.lrtMotion!.speedKmh)).toBeLessThan(.1)
      expect(actual.lrtMotion!.speedKmh).toBeLessThanOrEqual(80)
      if (expected.lrtMotion!.phase === 'stopped') expect(actual.lrtMotion!.speedKmh).toBe(0)
    }
  })

  it('clips ongoing dwell timestamps rather than inventing an arrival or leaking a future departure', () => {
    const data = fixture()
    data.trips[0].entries[0] = { stationId: 'a', arrivalMinutes: 590, departureMinutes: 603 }
    data.trips[0].entries[1].arrivalMinutes = 605
    data.trips[0].entries[2].arrivalMinutes = 607
    const window = createLrtWindowProvider(data)(start)
    expect(window.vehicles[0].stops).toEqual([{ stationId: 'a', arrival: null, departure: null, atStart: true, terminal: false }])
    expect(window.vehicles[0].frames.every(f => f[2] === 0)).toBe(true)
  })

  it.each(['2026-05-08', '2026-05-09', '2026-05-11'])('retains yesterday’s tail across the %s service-type boundary', date => {
    const time = Date.parse(`${date}T00:00:00+08:00`)
    const data = fixture()
    const day = new Date(time - 86400000 + 8 * 3600000).getUTCDay()
    data.trips[0].scheduleType = day === 5 ? 'friday' : day === 0 || day === 6 ? 'sat_sun' : 'mon_thu'
    data.trips[0].entries = [{ stationId: 'a', arrivalMinutes: 1439 }, { stationId: 'b', arrivalMinutes: 1441 }]
    const provide = createLrtWindowProvider(data)
    const before = sampleLrtVehicles({ ...data, lrtWindows: [provide(time - 60000)] }, time - 1)[0]
    const after = sampleLrtVehicles({ ...data, lrtWindows: [provide(time)] }, time)[0]
    expect(after.id).toBe(before.id)
    expect(Math.abs(after.progress - before.progress)).toBeLessThan(.001)
    expect(sampleLrtVehicles({ ...data, lrtWindows: [provide(time)] }, time + 80_001)).toHaveLength(0)
  })

  it('never extrapolates stale windows, and ignores whole trips supplied to browser playback', () => {
    const data = fixture(), window = createLrtWindowProvider(data)(start)
    expect(sampleLrtVehicles(data, start)).toEqual([])
    expect(sampleLrtVehicles({ ...data, lrtWindows: [window] }, window.end)).toEqual([])
  })

  it('rejects expanded responses and stops outside the declared window', () => {
    const window = createLrtWindowProvider(fixture())(start)
    expect(LrtStateWindowSchema.safeParse({ ...window, end: start + 86400000 }).success).toBe(false)
    window.vehicles[0].stops[0].departure = window.end + 1
    expect(LrtStateWindowSchema.safeParse(window).success).toBe(false)
  })

  it('blocks server computations and timetable inputs from every browser chunk', () => {
    for (const id of ['/app/server/lrt-window.ts', 'C:\\app\\functions\\_lrt\\data.json', '/app/src/data/trips-friday.json']) {
      expect(() => assertLrtBrowserModule(id)).toThrow('Server-only')
    }
    expect(() => assertLrtBrowserModule('/app/src/lrtState.ts')).not.toThrow()
  })
})
