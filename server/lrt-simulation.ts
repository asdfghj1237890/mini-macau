// Timetable-driven motion runs only in the server module graph.
import nearestPointOnLine from '@turf/nearest-point-on-line'
import type { Feature, LineString } from 'geojson'
import type { TransitData, VehiclePosition, Trip, LRTLine, ScheduleType } from '../src/types'
import { getLineLength, interpolateOnLineSmooth, getScheduleType } from '../src/engines/simulationEngine'
import { macauMinutesOfDay as timeToMinutes } from '../src/macauTime'
import { createLrtMotionProfile, sampleLrtMotion, type LrtMotionProfile } from '../src/engines/lrtMotion'
import { getLrtDepartureMinutes } from '../src/engines/lrtTimetable'
import { getLrtTrack, LRT_DIRECTIONS } from '../src/lrtTracks'
type LrtData = Pick<TransitData, 'lrtLines' | 'stations' | 'trips'>

// Prepare station projections and acceleration profiles once per isolate. A
// state request samples progress only: no per-frame Date objects or map poses.
export function compileLrtTrip(data: LrtData, trip: Trip) {
  const line = data.lrtLines.find(l => l.id === trip.lineId)
  if (!line) return () => undefined
  const track = getLrtTrack(line.geometry, trip.direction)
  const projections = getStationProgressMap(data)
  const entries = trip.entries
  const progress = (i: number) => projections.get(`${trip.lineId}:${trip.direction}:${entries[i].stationId}`)?.progress
    ?? (trip.direction === 'backward' ? 1 - i / (entries.length - 1) : i / (entries.length - 1))
  const stops = entries.map((entry, i) => ({
    arrival: entry.arrivalMinutes, departure: getLrtDepartureMinutes(entry), progress: progress(i),
    motion: i + 1 < entries.length
      ? getLrtMotionProfile(track, progress(i), progress(i + 1), (entries[i + 1].arrivalMinutes - getLrtDepartureMinutes(entry)) * 60)
      : null,
  }))
  return (minutes: number): { progress: number; speedKmh: number; phase: NonNullable<VehiclePosition['lrtMotion']>['phase'] } | undefined => {
    let lo = 0, hi = stops.length - 1
    if (!stops.length || minutes < stops[0].arrival || minutes > stops[hi].departure) return undefined
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (stops[mid].arrival <= minutes) lo = mid
      else hi = mid - 1
    }
    const stop = stops[lo]
    if (minutes <= stop.departure) return { progress: stop.progress, speedKmh: 0, phase: 'stopped' }
    if (!stop.motion || !stops[lo + 1]) return undefined
    const motion = sampleLrtMotion(stop.motion, (minutes - stop.departure) * 60)
    return { ...motion, progress: stop.progress + (stops[lo + 1].progress - stop.progress) * motion.progress }
  }
}
const lrtMotionCache = new WeakMap<Feature<LineString>, Map<string, LrtMotionProfile | null>>()

function getLrtMotionProfile(line: Feature<LineString>, from: number, to: number, durationSec: number): LrtMotionProfile | null {
  let profiles = lrtMotionCache.get(line)
  if (!profiles) { profiles = new Map(); lrtMotionCache.set(line, profiles) }
  const key = `${from}:${to}:${durationSec}`
  if (!profiles.has(key)) {
    const profile = createLrtMotionProfile(Math.abs(to - from) * getLineLength(line) * 1000, durationSec)
    profiles.set(key, profile)
    if (!profile) console.warn('LRT segment cannot fit its scheduled duration within the speed limit; skipping this movement.')
  }
  return profiles.get(key) ?? null
}

// Timetable minutes may extend beyond midnight. Keep panels and map movement
// on the same clock for an active overnight trip.
export function getLrtTripMinutes(trip: Trip, nowMinutes: number): number {
  const firstArr = trip.entries[0]?.arrivalMinutes ?? Infinity
  const last = trip.entries.at(-1)
  const lastDep = last ? getLrtDepartureMinutes(last) : -Infinity
  return nowMinutes < firstArr && nowMinutes + 1440 >= firstArr && nowMinutes + 1440 <= lastDep
    ? nowMinutes + 1440 : nowMinutes
}

function computeLRTVehicles(
  trips: Trip[],
  lines: LRTLine[],
  stationProgressMap: Map<string, { progress: number }>,
  nowMinutes: number,
  scheduleType: ScheduleType,
  previousScheduleType: ScheduleType,
): VehiclePosition[] {
  const vehicles: VehiclePosition[] = []
  const lineMap = new Map(lines.map(l => [l.id, l]))

  for (const trip of trips) {
    const line = lineMap.get(trip.lineId)
    if (!line) continue

    const entries = trip.entries
    if (entries.length < 2) continue

    const firstArr = entries[0].arrivalMinutes
    const lastDep = getLrtDepartureMinutes(entries[entries.length - 1])

    const effective = getLrtTripMinutes(trip, nowMinutes)
    const serviceType = effective === nowMinutes ? scheduleType : previousScheduleType
    if (trip.scheduleType && trip.scheduleType !== serviceType) continue
    if (effective < firstArr || effective > lastDep) continue

    const track = getLrtTrack(line.geometry, trip.direction)
    const stationProgress = (index: number) => stationProgressMap.get(
      `${trip.lineId}:${trip.direction}:${entries[index].stationId}`,
    )?.progress ?? (trip.direction === 'backward' ? 1 - index / (entries.length - 1) : index / (entries.length - 1))
    let overallProgress: number | null = null
    let motion: NonNullable<VehiclePosition['lrtMotion']> = { speedKmh: 0, phase: 'stopped' }

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const dep = getLrtDepartureMinutes(e)

      if (effective >= e.arrivalMinutes && effective <= dep) {
        overallProgress = stationProgress(i)
        break
      }

      if (i < entries.length - 1) {
        const next = entries[i + 1]
        if (effective > dep && effective < next.arrivalMinutes) {
          const fromP = stationProgress(i), toP = stationProgress(i + 1)
          const profile = getLrtMotionProfile(track, fromP, toP, (next.arrivalMinutes - dep) * 60)
          if (!profile) break
          const state = sampleLrtMotion(profile, (effective - dep) * 60)
          overallProgress = fromP + (toP - fromP) * state.progress
          motion = { speedKmh: state.speedKmh, phase: state.phase }
          break
        }
      }
    }

    if (overallProgress === null) continue

    overallProgress = Math.max(0, Math.min(1, overallProgress))
    const pos = interpolateOnLineSmooth(track, overallProgress)
    vehicles.push({
      id: trip.id,
      lineId: trip.lineId,
      type: 'lrt',
      coordinates: pos.coordinates,
      bearing: (pos.bearing + (trip.direction === 'backward' ? 180 : 0) + 360) % 360,
      progress: overallProgress,
      color: line.color,
      lrtMotion: motion,
      lrtDirection: trip.direction,
    })
  }

  return vehicles
}

// Flight/date/visibility updates replace TransitData without changing track
// geometry. Cache projections by their actual inputs, including per-line
// identity so rebuilding a filtered line array never repeats Turf scans.
const stationProgressMaps = new WeakMap<TransitData['stations'], WeakMap<LRTLine, Map<string, { progress: number }>>>()
let stationView: { stations: TransitData['stations']; lines: LRTLine[]; map: Map<string, { progress: number }> } | undefined
function getStationProgressMap(transitData: LrtData): Map<string, { progress: number }> {
  if (stationView?.stations === transitData.stations && stationView.lines === transitData.lrtLines) return stationView.map
  let lines = stationProgressMaps.get(transitData.stations)
  if (!lines) { lines = new WeakMap(); stationProgressMaps.set(transitData.stations, lines) }

  const stationCoordsMap = new Map<string, [number, number]>()
  for (const s of transitData.stations) {
    stationCoordsMap.set(s.id, s.coordinates as [number, number])
  }

  const progressMap = new Map<string, { progress: number }>()
  for (const line of transitData.lrtLines) {
    const cached = lines.get(line)
    if (cached) {
      for (const [key, value] of cached) progressMap.set(key, value)
      continue
    }
    const projections = new Map<string, { progress: number }>()
    for (const direction of LRT_DIRECTIONS) {
      const track = getLrtTrack(line.geometry, direction)
      const totalLen = getLineLength(track)
      for (const sid of line.stations) {
        const coords = stationCoordsMap.get(sid)
        if (!coords || totalLen === 0) {
          projections.set(`${line.id}:${direction}:${sid}`, { progress: 0 })
          continue
        }
        const pt = nearestPointOnLine(track, coords, { units: 'kilometers' })
        const dist = pt.properties.location ?? 0
        projections.set(`${line.id}:${direction}:${sid}`, {
          progress: Math.max(0, Math.min(1, dist / totalLen)),
        })
      }
    }
    lines.set(line, projections)
    for (const [key, value] of projections) progressMap.set(key, value)
  }
  stationView = { stations: transitData.stations, lines: transitData.lrtLines, map: progressMap }
  return progressMap
}

// A selected vehicle panel reads only this trip, using the map's cached
// station projections and motion profile. No fleet recompute or stale click
// snapshot is needed when its clock subscription updates.
export function computeLRTVehicle(transitData: LrtData, trip: Trip, time: Date): VehiclePosition | undefined {
  return computeLRTVehicles(
    [trip], transitData.lrtLines, getStationProgressMap(transitData), timeToMinutes(time),
    getScheduleType(time), getScheduleType(new Date(time.getTime() - 86400000)),
  )[0]
}

export function computeScheduledLrt(data: LrtData, time: Date): VehiclePosition[] {
  return computeLRTVehicles(data.trips, data.lrtLines, getStationProgressMap(data), timeToMinutes(time),
    getScheduleType(time), getScheduleType(new Date(time.getTime() - 86400000)))
}
