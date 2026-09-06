import { describe, it, expect } from 'vitest'
import { clockMinuteMs } from './useSimulationClock'

// The minute snapshot is what keeps App (and every panel that decides by the
// time) from re-rendering on the ~10 Hz tick: useSyncExternalStore compares
// snapshots with Object.is, so the number must be identical for every instant
// inside a simulated minute and change exactly at the boundary.
describe('clockMinuteMs', () => {
  it('is the same value for every instant inside a minute', () => {
    const start = Date.UTC(2026, 8, 7, 12, 34, 0)
    expect(clockMinuteMs(start)).toBe(start)
    expect(clockMinuteMs(start + 1)).toBe(start)
    expect(clockMinuteMs(start + 59_999)).toBe(start)
  })

  it('changes exactly at the next minute', () => {
    const start = Date.UTC(2026, 8, 7, 12, 34, 0)
    expect(clockMinuteMs(start + 60_000)).toBe(start + 60_000)
  })

  it('lands on Macau minute boundaries too (a whole-hour offset)', () => {
    // 2026-09-07 00:00:30 Macau = 2026-09-06 16:00:30 UTC.
    const macauMidnightPlus30s = Date.UTC(2026, 8, 6, 16, 0, 30)
    const floored = new Date(clockMinuteMs(macauMidnightPlus30s))
    expect(floored.getUTCSeconds()).toBe(0)
    expect(floored.getUTCMinutes()).toBe(0)
    expect(floored.getUTCHours()).toBe(16)
  })
})
