import { z } from 'zod'

export const LRT_WINDOW_MS = 120_000
export const LRT_WINDOW_STEP_MS = 60_000
export const lrtWindowStart = (time: number) => Math.floor(time / LRT_WINDOW_STEP_MS) * LRT_WINDOW_STEP_MS

const time = z.number().int().nonnegative()
const id = z.string().min(1).max(100)
const phase = z.enum(['stopped', 'accelerating', 'cruising', 'braking'])
export const LrtStateWindowSchema = z.object({
  version: z.literal(1),
  start: time,
  end: time,
  vehicles: z.array(z.object({
    id, lineId: id, direction: z.enum(['forward', 'backward']), destination: id,
    // Seconds from window start, track progress, km/h, motion phase.
    frames: z.array(z.tuple([z.number().min(0).max(120), z.number().min(0).max(1), z.number().min(0).max(80), phase])).min(1).max(256),
    stops: z.array(z.object({
      stationId: id, arrival: time.nullable(), departure: time.nullable(),
      atStart: z.boolean(), terminal: z.boolean(),
    }).strict()).max(32),
  }).strict()).max(128),
  service: z.array(z.object({ lineId: id, start: time, end: time }).strict()).max(16),
}).strict().superRefine((window, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'Invalid LRT state window' })
  if (window.start !== lrtWindowStart(window.start) || window.end - window.start !== LRT_WINDOW_MS) invalid()
  if (new Set(window.vehicles.map(v => v.id)).size !== window.vehicles.length) invalid()
  for (const vehicle of window.vehicles) {
    if (vehicle.frames.some((f, i) => i > 0 && f[0] <= vehicle.frames[i - 1][0])) invalid()
    for (const stop of vehicle.stops) {
      for (const t of [stop.arrival, stop.departure]) if (t !== null && (t < window.start || t > window.end)) invalid()
      if (stop.arrival !== null && stop.departure !== null && stop.arrival > stop.departure) invalid()
    }
  }
  for (const span of window.service) if (span.start < window.start || span.end > window.end || span.end < span.start) invalid()
})

export type LrtStateWindow = z.infer<typeof LrtStateWindowSchema>
export type LrtStateVehicle = LrtStateWindow['vehicles'][number]

// Prefer the newest covering window, but use the overlap while a fetch is late.
// Never extrapolate into an interval the server has not supplied.
export function lrtWindowAt(windows: readonly LrtStateWindow[] | undefined, time: number): LrtStateWindow | undefined {
  return windows?.findLast(w => time >= w.start && time < w.end)
}
