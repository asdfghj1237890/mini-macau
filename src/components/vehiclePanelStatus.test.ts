import { describe, expect, it } from 'vitest'
import type { TimetableEntry } from '../types'
import { getLrtDepartureMinutes } from '../engines/lrtTimetable'
import { formatCountdown, lrtStopStatus, nextStopSummary } from './vehiclePanelStatus'

describe('live vehicle panel timing', () => {
  const entry = { stationId: 'test', arrivalMinutes: 600, departureMinutes: 600.25 }

  it('marks approach and departure precisely, without a false dwell buffer', () => {
    expect(lrtStopStatus(entry, 599.999)).toBe('arriving')
    expect(lrtStopStatus(entry, 600)).toBe('dwelling')
    expect(lrtStopStatus(entry, 600.25)).toBe('dwelling')
    expect(lrtStopStatus(entry, 600.251)).toBe('past')
    expect(lrtStopStatus({ stationId: 'test', arrivalMinutes: 600 }, 600.3)).toBe('dwelling')
    expect(lrtStopStatus({ stationId: 'test', arrivalMinutes: 600 }, 600.334)).toBe('past')
  })

  it('counts down to departure while dwelling, then switches to the next arrival', () => {
    const entries: TimetableEntry[] = [entry, { stationId: 'next', arrivalMinutes: 602 }]
    const summary = (now: number) => nextStopSummary(entries.map(e => ({
      arrivalMinutes: e.arrivalMinutes, departureMinutes: getLrtDepartureMinutes(e),
      status: lrtStopStatus(e, now),
    })), now)
    expect(summary(600)).toEqual({ index: 0, seconds: 15, phase: 'dwell' })
    expect(summary(600.25)).toEqual({ index: 0, seconds: 0, phase: 'dwell' })
    expect(summary(600.5)).toEqual({ index: 1, seconds: 90, phase: 'arr' })
    expect(summary(602.34)).toBeNull()
  })

  it('does not show a NEXT countdown for an inactive vehicle', () => {
    expect(nextStopSummary([{ arrivalMinutes: 600, departureMinutes: 600, status: 'future' }], 599, false)).toBeNull()
  })

  it.each([[0, '00:00'], [.1, '00:01'], [59.01, '01:00'], [60, '01:00'], [60.000000000001, '01:00'], [125, '02:05']])(
    'formats %s seconds as %s', (seconds, expected) => {
      expect(formatCountdown(Number(seconds))).toBe(expected)
    },
  )
})
