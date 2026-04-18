import type { ScheduleType } from '../types'

// Real departures/hour (all bus routes + all LRT lines), normalized to global peak.
// Computed from data/bus_reference/routes.json + LRT official timetable.
export const HOUR_DENSITY: Record<ScheduleType, ReadonlyArray<number>> = {
  mon_thu: [
    0.25, 0.12, 0.04, 0.04, 0.04, 0.04,
    0.45, 0.97, 1.00, 0.91, 0.66, 0.66,
    0.66, 0.67, 0.67, 0.85, 0.91, 0.95,
    0.96, 0.88, 0.60, 0.57, 0.54, 0.46,
  ],
  friday: [
    0.25, 0.12, 0.04, 0.04, 0.04, 0.04,
    0.45, 0.97, 1.00, 0.91, 0.66, 0.66,
    0.66, 0.67, 0.67, 0.86, 0.91, 0.95,
    0.96, 0.88, 0.60, 0.57, 0.54, 0.47,
  ],
  sat_sun: [
    0.22, 0.10, 0.02, 0.02, 0.02, 0.02,
    0.38, 0.73, 0.74, 0.72, 0.62, 0.62,
    0.62, 0.62, 0.62, 0.71, 0.73, 0.75,
    0.75, 0.71, 0.54, 0.53, 0.51, 0.45,
  ],
}

export interface ScheduleDensityInfo {
  first: string
  last: string
  firstFrac: number
  lastFrac: number
  density: ReadonlyArray<number>
}

export const SCHEDULE_DENSITY: Record<ScheduleType, ScheduleDensityInfo> = {
  mon_thu: { first: '06:30', last: '23:15', firstFrac: 6.5 / 24, lastFrac: 23.25 / 24, density: HOUR_DENSITY.mon_thu },
  friday:  { first: '06:30', last: '23:59', firstFrac: 6.5 / 24, lastFrac: (23 + 59 / 60) / 24, density: HOUR_DENSITY.friday },
  sat_sun: { first: '06:30', last: '23:59', firstFrac: 6.5 / 24, lastFrac: (23 + 59 / 60) / 24, density: HOUR_DENSITY.sat_sun },
}

export function getScheduleDensity(day: number): ScheduleDensityInfo {
  if (day === 5) return SCHEDULE_DENSITY.friday
  if (day === 0 || day === 6) return SCHEDULE_DENSITY.sat_sun
  return SCHEDULE_DENSITY.mon_thu
}
