import type { TransitData } from '../src/types'
import { LRT_WINDOW_MS, lrtWindowStart, type LrtStateWindow, type LrtStateVehicle } from '../src/lrtState'
import { MACAU_OFFSET_MS } from '../src/macauTime'
import { getScheduleType } from '../src/engines/simulationEngine'
import { getLrtDepartureMinutes } from '../src/engines/lrtTimetable'
import { compileLrtTrip } from './lrt-simulation'

type LrtData = Pick<TransitData, 'lrtLines' | 'stations' | 'trips'>
const DAY = 86_400_000

// Created once per dataset/isolate. Candidate bounds avoid fleet scans per frame.
// The cache is only a CPU optimization, never an authorization/rate-limit store.
export function createLrtWindowProvider(data: LrtData): (start: number) => LrtStateWindow {
  const indexed = data.trips.flatMap((trip, index) => trip.entries.length < 2 ? [] : [{
    trip, index, sample: compileLrtTrip(data, trip), start: Math.round(trip.entries[0].arrivalMinutes * 60_000),
    end: Math.round(getLrtDepartureMinutes(trip.entries[trip.entries.length - 1]) * 60_000),
  }])
  const cache = new Map<number, LrtStateWindow>()
  return (start: number) => {
    if (!Number.isSafeInteger(start) || start !== lrtWindowStart(start)) throw new Error('Invalid window start')
    const cached = cache.get(start)
    if (cached) return cached
    const end = start + LRT_WINDOW_MS
    const window: LrtStateWindow = { version: 1, start, end, vehicles: [], service: [] }
    const midnight = Math.floor((start + MACAU_OFFSET_MS) / DAY) * DAY - MACAU_OFFSET_MS
    // Include yesterday's overnight tail and a possible boundary at tomorrow.
    for (const day of [midnight - DAY, midnight, midnight + DAY]) {
      const scheduleType = getScheduleType(new Date(day))
      const service = new Map<string, [number, number]>()
      for (const item of indexed) {
        const { trip } = item
        if (trip.scheduleType && trip.scheduleType !== scheduleType) continue
        const bounds = service.get(trip.lineId) ?? [Infinity, -Infinity]
        bounds[0] = Math.min(bounds[0], day + item.start)
        bounds[1] = Math.max(bounds[1], day + item.end)
        service.set(trip.lineId, bounds)
        if (day + item.start > end || day + item.end < start) continue
        const from = Math.max(start, day + item.start), to = Math.min(end, day + item.end)
        const instants = new Set<number>([from, to])
        for (let t = Math.ceil(from / 1000) * 1000; t <= to; t += 1000) instants.add(t)
        const stops: LrtStateVehicle['stops'] = []
        trip.entries.forEach((entry, i) => {
          const arrival = day + Math.round(entry.arrivalMinutes * 60_000)
          const departure = day + Math.round(getLrtDepartureMinutes(entry) * 60_000)
          for (const t of [arrival, departure]) if (t >= from && t <= to) instants.add(t)
          if (arrival > end || departure < start) return
          stops.push({ stationId: entry.stationId,
            arrival: arrival >= start ? arrival : null,
            departure: departure <= end ? departure : null,
            atStart: arrival <= start && departure >= start,
            terminal: i === trip.entries.length - 1,
          })
        })
        // No original trip identifiers or out-of-window timestamps in the wire format.
        const frames: LrtStateVehicle['frames'] = []
        for (const t of [...instants].sort((a, b) => a - b)) {
          const pose = item.sample((t - day) / 60_000)
          if (!pose) continue
          frames.push([(t - start) / 1000, Math.round(pose.progress * 1e8) / 1e8,
            Math.round(pose.speedKmh * 1000) / 1000, pose.phase])
        }
        if (frames.length) window.vehicles.push({ id: `lrt-${Math.floor((day + MACAU_OFFSET_MS) / DAY)}-${item.index}`, lineId: trip.lineId,
          direction: trip.direction, destination: trip.entries[trip.entries.length - 1].stationId, frames, stops })
      }
      for (const [lineId, [from, to]] of service) {
        if (from <= end && to >= start) window.service.push({ lineId, start: Math.max(from, start), end: Math.min(to, end) })
      }
    }
    cache.set(start, window)
    if (cache.size > 8) cache.delete(cache.keys().next().value!)
    return window
  }
}
