// Macau wall-clock helpers.
//
// The simulation clock works in true instants (epoch milliseconds). The
// schedules it replays — bus service windows, LRT timetables, the day-type
// (Mon–Thu / Friday / Sat–Sun) split — are all authored against Macau local
// time. Reading `Date#getHours()` / `getDay()` etc. on an instant returns the
// *viewer's browser* wall clock, so a visitor in Lisbon used to see Macau's
// 21:00 night service while the on-screen clock read 14:00. Pinning every
// wall-clock read to Asia/Macau makes the simulation identical for every
// viewer regardless of their timezone.
//
// Macau observes UTC+8 year-round and has never used daylight saving, so a
// fixed offset is exact (no Intl / tz-database lookup needed in the hot path).
export const MACAU_OFFSET_MS = 8 * 60 * 60 * 1000

// A Date whose UTC fields equal Macau's wall-clock fields. Its `getTime()` is
// shifted +8h and is NOT a valid instant — only read it through the getUTC*
// wrappers below, never pass it back into epoch math.
function macauShifted(instant: Date): Date {
  return new Date(instant.getTime() + MACAU_OFFSET_MS)
}

export interface MacauParts {
  year: number
  month: number // 0–11, matching Date#getMonth()
  day: number // 1–31
  weekday: number // 0=Sun … 6=Sat
  hours: number
  minutes: number
  seconds: number
  ms: number
}

export function macauParts(instant: Date): MacauParts {
  const w = macauShifted(instant)
  return {
    year: w.getUTCFullYear(),
    month: w.getUTCMonth(),
    day: w.getUTCDate(),
    weekday: w.getUTCDay(),
    hours: w.getUTCHours(),
    minutes: w.getUTCMinutes(),
    seconds: w.getUTCSeconds(),
    ms: w.getUTCMilliseconds(),
  }
}

// Day of week in Macau, 0=Sun … 6=Sat (matches Date#getDay()).
export function macauWeekday(instant: Date): number {
  return macauShifted(instant).getUTCDay()
}

export function macauHours(instant: Date): number {
  return macauShifted(instant).getUTCHours()
}

export function macauMinutes(instant: Date): number {
  return macauShifted(instant).getUTCMinutes()
}

export function macauSeconds(instant: Date): number {
  return macauShifted(instant).getUTCSeconds()
}

// Minutes since Macau midnight, including the fractional seconds/ms tail.
// Same shape as the engine's old `timeToMinutes`, but pinned to Macau.
export function macauMinutesOfDay(instant: Date): number {
  const w = macauShifted(instant)
  return (
    w.getUTCHours() * 60 +
    w.getUTCMinutes() +
    w.getUTCSeconds() / 60 +
    w.getUTCMilliseconds() / 60000
  )
}

// YYYY-MM-DD calendar date in Macau. Matches the `date` field shape written
// by the Python flight/ferry pipeline (which records Macau-local dates).
export function macauYmd(instant: Date): string {
  const w = macauShifted(instant)
  const y = w.getUTCFullYear()
  const mo = String(w.getUTCMonth() + 1).padStart(2, '0')
  const d = String(w.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

// The instant at which Macau's wall clock reads the given fields. Inverse of
// `macauParts`. `month` is 0–11. Used when the user picks a date/time (which
// they mean in Macau time) and we need the epoch instant to drive the clock.
export function macauWallToInstant(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0,
): Date {
  return new Date(Date.UTC(year, month, day, hours, minutes, seconds, ms) - MACAU_OFFSET_MS)
}
