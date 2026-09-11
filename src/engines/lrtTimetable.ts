import type { TimetableEntry } from '../types'

// Simulation default for records with a single station timestamp. An explicit
// later departure remains authoritative. Arrival timestamps are never shifted.
export const LRT_DEFAULT_DWELL_SEC = 20

export function getLrtDepartureMinutes(entry: TimetableEntry, defaultDwellSec = LRT_DEFAULT_DWELL_SEC): number {
  return entry.departureMinutes !== undefined && entry.departureMinutes > entry.arrivalMinutes
    ? entry.departureMinutes
    : entry.arrivalMinutes + defaultDwellSec / 60
}
