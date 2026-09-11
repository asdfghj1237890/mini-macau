import { expect, it } from 'vitest'
import { getLrtDepartureMinutes, LRT_DEFAULT_DWELL_SEC } from './lrtTimetable'

it('adds the uniform default without mutating single-timestamp records', () => {
  const entry = Object.freeze({ stationId: 'A', arrivalMinutes: 600 })
  expect(LRT_DEFAULT_DWELL_SEC).toBe(20)
  expect((getLrtDepartureMinutes(entry) - 600) * 60).toBeCloseTo(20, 8)
  expect(getLrtDepartureMinutes({ ...entry, departureMinutes: 600 })).toBe(getLrtDepartureMinutes(entry))
  expect(entry.arrivalMinutes).toBe(600)
})

it('retains a separately specified departure time', () => {
  expect(getLrtDepartureMinutes({ stationId: 'A', arrivalMinutes: 600, departureMinutes: 600.5 })).toBe(600.5)
})

it('allows the final dwell to extend past midnight', () => {
  expect(getLrtDepartureMinutes({ stationId: 'A', arrivalMinutes: 1439.9 })).toBeCloseTo(1440 + 14 / 60, 8)
})
