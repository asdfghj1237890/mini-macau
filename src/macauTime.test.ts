import { describe, it, expect } from 'vitest'
import {
  MACAU_OFFSET_MS,
  macauParts,
  macauWeekday,
  macauHours,
  macauMinutes,
  macauMinutesOfDay,
  macauYmd,
  macauWallToInstant,
} from './macauTime'

// All assertions use absolute UTC instants so they are independent of the
// machine/CI timezone the suite runs in — which is the whole point of the
// module.

describe('macauParts', () => {
  it('reads Macau wall-clock fields from a UTC instant (+8h, no DST)', () => {
    // 2026-05-08T18:00:00Z is 2026-05-09 02:00 in Macau → Saturday.
    const p = macauParts(new Date('2026-05-08T18:00:00Z'))
    expect(p).toEqual({
      year: 2026,
      month: 4, // May (0-based)
      day: 9,
      weekday: 6, // Saturday
      hours: 2,
      minutes: 0,
      seconds: 0,
      ms: 0,
    })
  })

  it('crosses the date boundary forward relative to UTC', () => {
    // 23:30Z → 07:30 next day in Macau.
    const p = macauParts(new Date('2026-01-01T23:30:00Z'))
    expect(p.year).toBe(2026)
    expect(p.month).toBe(0)
    expect(p.day).toBe(2)
    expect(p.hours).toBe(7)
    expect(p.minutes).toBe(30)
  })
})

describe('weekday / hour / minute readers', () => {
  it('returns the Macau weekday, not the UTC one', () => {
    // Friday 20:00Z is already Saturday 04:00 in Macau.
    const instant = new Date('2026-05-08T20:00:00Z')
    expect(instant.getUTCDay()).toBe(5) // Friday in UTC
    expect(macauWeekday(instant)).toBe(6) // Saturday in Macau
  })

  it('macauHours / macauMinutes track Macau local time', () => {
    const instant = new Date('2026-05-08T06:15:00Z') // 14:15 Macau
    expect(macauHours(instant)).toBe(14)
    expect(macauMinutes(instant)).toBe(15)
  })
})

describe('macauMinutesOfDay', () => {
  it('counts minutes since Macau midnight including the fractional tail', () => {
    // 14:15:30.000 Macau → 855.5 minutes.
    const instant = new Date('2026-05-08T06:15:30Z')
    expect(macauMinutesOfDay(instant)).toBeCloseTo(14 * 60 + 15 + 0.5, 6)
  })

  it('is 0 at Macau midnight', () => {
    const instant = new Date('2026-05-07T16:00:00Z') // 00:00 Macau May 8
    expect(macauMinutesOfDay(instant)).toBeCloseTo(0, 6)
  })
})

describe('macauYmd', () => {
  it('formats the Macau calendar date, which can differ from the UTC date', () => {
    // 2026-05-08T17:30:00Z is already 2026-05-09 in Macau.
    expect(macauYmd(new Date('2026-05-08T17:30:00Z'))).toBe('2026-05-09')
  })
})

describe('macauWallToInstant', () => {
  it('is the inverse of macauParts', () => {
    const instant = macauWallToInstant(2026, 4, 9, 2, 0)
    expect(instant.toISOString()).toBe('2026-05-08T18:00:00.000Z')
  })

  it('round-trips through macauParts for an arbitrary moment', () => {
    const original = new Date('2026-11-23T09:47:12Z')
    const p = macauParts(original)
    const rebuilt = macauWallToInstant(p.year, p.month, p.day, p.hours, p.minutes, p.seconds, p.ms)
    expect(rebuilt.getTime()).toBe(original.getTime())
  })
})

describe('MACAU_OFFSET_MS', () => {
  it('is exactly +8h', () => {
    expect(MACAU_OFFSET_MS).toBe(28800000)
  })
})
