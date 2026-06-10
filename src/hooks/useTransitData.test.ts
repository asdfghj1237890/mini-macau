import { describe, it, expect } from 'vitest'
import type { Flight } from '../types'
import { buildFlightIndex, ymdMacau, weekdayOf } from './useTransitData'

const fl = (id: string, opts: Partial<Flight> = {}): Flight => ({
  id,
  flightNumber: id.split('-')[0],
  airline: { name: '', iata: id.slice(0, 2) },
  type: 'departure',
  scheduledTime: 0,
  destination: { iata: 'HKG', name: 'Hong Kong', bearing: 90 },
  ...opts,
})

describe('ymdMacau', () => {
  it('formats local-zone Date in Macau time as YYYY-MM-DD', () => {
    // 2026-05-06 12:00 in any zone west of UTC+12 lands on 2026-05-06
    // Macau-side as well; pick noon to stay clear of midnight edge.
    const d = new Date(Date.UTC(2026, 4, 6, 4, 0)) // 12:00 Macau
    expect(ymdMacau(d)).toBe('2026-05-06')
  })

  it('returns the Macau calendar date even when viewer-local date differs', () => {
    // Instant: 2026-05-06 23:30 UTC = 2026-05-07 07:30 Macau.
    // A UTC viewer sees calendar 5/6, but the upstream MFM data is
    // labelled 5/7. ymdMacau must align with the upstream contract.
    const d = new Date(Date.UTC(2026, 4, 6, 23, 30))
    expect(ymdMacau(d)).toBe('2026-05-07')
  })
})

describe('weekdayOf', () => {
  it('returns Wed for 2026-05-06', () => {
    expect(weekdayOf('2026-05-06')).toBe(3)
  })
  it('returns Sat for 2026-05-09', () => {
    expect(weekdayOf('2026-05-09')).toBe(6)
  })
})

describe('buildFlightIndex', () => {
  // 2026-05-06 = Wed. Window: today + Thu..Wed+7 from timetable.
  const today = '2026-05-06'

  // Modern realtime carries `date` on every record.
  const realtimeToday: Flight[] = [
    fl('R1-arr-0500', { date: today }),
    fl('R2-dep-0700', { date: today }),
  ]

  // Timetable covers 2026-05-07 (Thu) → 2026-05-13 (Wed).
  const timetableFlights: Flight[] = [
    fl('T1-2026-05-07-0800', { date: '2026-05-07' }),
    fl('T2-2026-05-08-0900', { date: '2026-05-08' }),
    fl('T3-2026-05-13-1000', { date: '2026-05-13' }),
    fl('T4-2026-05-13-1100', { date: '2026-05-13' }),
  ]

  it('exact-date hit: today bucket is realtime when its claimed date matches today', () => {
    const idx = buildFlightIndex(realtimeToday, timetableFlights, today)
    expect(idx.byDate.get(today)).toEqual(realtimeToday)
  })

  it('exact-date hit: future day returns timetable bucket for that day', () => {
    const idx = buildFlightIndex(realtimeToday, timetableFlights, today)
    const wed13 = idx.byDate.get('2026-05-13')
    expect(wed13!.map(f => f.id)).toEqual([
      'T3-2026-05-13-1000',
      'T4-2026-05-13-1100',
    ])
  })

  it('weekday fallback prefers latest matching date in window', () => {
    const idx = buildFlightIndex(realtimeToday, timetableFlights, today)
    // Wednesday → 2026-05-13 wins over today (later within window).
    const wed = idx.byWeekday.get(3)
    expect(wed!.map(f => f.id)).toEqual([
      'T3-2026-05-13-1000',
      'T4-2026-05-13-1100',
    ])
  })

  // ─────────── Codex adversarial review fix #1 ───────────
  // Stale realtime file (still yesterday's content because the morning
  // workflow hasn't refreshed it yet) must NOT shadow today's timetable
  // bucket. It should land in yesterday's bucket per its claimed date.
  describe('stale realtime trust rule', () => {
    const yesterday = '2026-05-05'
    const realtimeStale: Flight[] = [
      fl('S1-arr-0500', { date: yesterday }),
      fl('S2-dep-0700', { date: yesterday }),
    ]
    // Timetable run from previous day already covers today (5/6).
    const timetableWithToday: Flight[] = [
      fl('T0-2026-05-06-0800', { date: today }),
      ...timetableFlights,
    ]

    it('stale realtime goes under its claimed date, NOT under today', () => {
      const idx = buildFlightIndex(realtimeStale, timetableWithToday, today)
      expect(idx.byDate.get(yesterday)).toEqual(realtimeStale)
    })

    it('today bucket keeps the timetable record when realtime is stale', () => {
      const idx = buildFlightIndex(realtimeStale, timetableWithToday, today)
      const todayBucket = idx.byDate.get(today)
      expect(todayBucket!.map(f => f.id)).toEqual(['T0-2026-05-06-0800'])
    })

    it('fresh realtime DOES overwrite today timetable bucket', () => {
      const idx = buildFlightIndex(realtimeToday, timetableWithToday, today)
      expect(idx.byDate.get(today)).toEqual(realtimeToday)
    })
  })

  // Legacy realtime file lacking `date` field — possible during the
  // deploy → next CI run window.
  describe('legacy realtime (no `date` field)', () => {
    const realtimeLegacy: Flight[] = [
      fl('L1-arr-0500'), // no `date`
      fl('L2-dep-0700'),
    ]
    const timetableWithToday: Flight[] = [
      fl('T0-2026-05-06-0800', { date: today }),
    ]

    it('does NOT shadow a trusted timetable bucket for today', () => {
      const idx = buildFlightIndex(realtimeLegacy, timetableWithToday, today)
      expect(idx.byDate.get(today)!.map(f => f.id)).toEqual([
        'T0-2026-05-06-0800',
      ])
    })

    it('falls back to today bucket when timetable lacks one', () => {
      const idx = buildFlightIndex(realtimeLegacy, [], today)
      expect(idx.byDate.get(today)).toEqual(realtimeLegacy)
    })
  })

  it('falls back to realtime when timetable is empty', () => {
    const idx = buildFlightIndex(realtimeToday, [], today)
    expect(idx.byDate.get(today)).toEqual(realtimeToday)
    expect(idx.fallback).toEqual(realtimeToday)
  })

  it('falls back to first timetable bucket when realtime is empty', () => {
    const idx = buildFlightIndex([], timetableFlights, today)
    expect(idx.byDate.has(today)).toBe(false)
    expect(idx.fallback.map(f => f.id)).toContain('T1-2026-05-07-0800')
  })

  it('returns empty fallback when both inputs are empty', () => {
    const idx = buildFlightIndex([], [], today)
    expect(idx.byDate.size).toBe(0)
    expect(idx.byWeekday.size).toBe(0)
    expect(idx.fallback).toEqual([])
  })

  it('skips timetable entries that have no `date` field', () => {
    const orphan = fl('NX1-arr-0900') // no `date`
    const idx = buildFlightIndex([], [orphan, ...timetableFlights], today)
    const allBucketed = Array.from(idx.byDate.values()).flat()
    expect(allBucketed.find(f => f.id === 'NX1-arr-0900')).toBeUndefined()
    expect(allBucketed.find(f => f.id === 'T1-2026-05-07-0800')).toBeDefined()
  })
})
