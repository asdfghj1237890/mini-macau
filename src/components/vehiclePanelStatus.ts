import type { TimetableEntry } from '../types'
import { getLrtDepartureMinutes } from '../engines/lrtTimetable'

export type StopStatus = 'past' | 'dwelling' | 'arriving' | 'future'

export function lrtStopStatus(entry: TimetableEntry, nowMinutes: number): StopStatus {
  const departure = getLrtDepartureMinutes(entry)
  if (nowMinutes > departure) return 'past'
  if (nowMinutes >= entry.arrivalMinutes) return 'dwelling'
  return nowMinutes >= entry.arrivalMinutes - 5 ? 'arriving' : 'future'
}

export interface TimedStop {
  status: StopStatus
  arrivalMinutes: number
  departureMinutes: number
}

export function nextStopSummary(rows: TimedStop[], nowMinutes: number, active = true): {
  index: number; seconds: number; phase: 'dwell' | 'arr'
} | null {
  if (!active) return null
  const index = rows.findIndex(row => row.status !== 'past')
  if (index < 0) return null
  const row = rows[index]
  const dwelling = row.status === 'dwelling'
  const target = dwelling ? row.departureMinutes : row.arrivalMinutes
  return { index, seconds: Math.max(0, (target - nowMinutes) * 60), phase: dwelling ? 'dwell' : 'arr' }
}

export function formatCountdown(seconds: number): string {
  // Remove floating-point tails at exact second boundaries before rounding up.
  const whole = Math.max(0, Math.ceil(seconds - 1e-7))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}
