import along from '@turf/along'
import length from '@turf/length'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import type { Feature, LineString } from 'geojson'
import type { TransitData, VehiclePosition, Trip, LRTLine, BusRoute, BusStop, Flight, Ferry, ScheduleType } from '../types'
import { FERRY_BERTHS_BY_TERMINAL, FERRY_COLOR_BY_OPERATOR } from './ferryBerths'
import { FERRY_ROUTES, interpolatePath, pathLengthMeters } from './ferryRoutes'

function getScheduleType(date: Date): ScheduleType {
  const day = date.getDay()
  if (day === 5) return 'friday'
  if (day === 0 || day === 6) return 'sat_sun'
  return 'mon_thu'
}

export { getScheduleType }

function timeToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000
}

const lineLengthCache = new WeakMap<Feature<LineString>, number>()

function getLineLength(line: Feature<LineString>): number {
  let len = lineLengthCache.get(line)
  if (len === undefined) {
    len = length(line, { units: 'kilometers' })
    lineLengthCache.set(line, len)
  }
  return len
}

export function interpolateOnLine(
  line: Feature<LineString>,
  progress: number
): { coordinates: [number, number]; bearing: number } {
  const totalLen = getLineLength(line)
  const dist = Math.max(0, Math.min(totalLen, progress * totalLen))
  const point = along(line, dist, { units: 'kilometers' })
  const coords = point.geometry.coordinates as [number, number]

  const epsilon = 0.001
  const distAhead = Math.min(totalLen, dist + epsilon)
  const pointAhead = along(line, distAhead, { units: 'kilometers' })
  const dx = pointAhead.geometry.coordinates[0] - coords[0]
  const dy = pointAhead.geometry.coordinates[1] - coords[1]
  const bearing = (Math.atan2(dx, dy) * 180) / Math.PI

  return { coordinates: coords, bearing }
}

function computeLRTVehicles(
  trips: Trip[],
  lines: LRTLine[],
  stationProgressMap: Map<string, { progress: number }>,
  nowMinutes: number
): VehiclePosition[] {
  const vehicles: VehiclePosition[] = []
  const lineMap = new Map(lines.map(l => [l.id, l]))

  for (const trip of trips) {
    const line = lineMap.get(trip.lineId)
    if (!line) continue

    const entries = trip.entries
    if (entries.length < 2) continue

    const firstArr = entries[0].arrivalMinutes
    const lastDep = entries[entries.length - 1].departureMinutes ?? entries[entries.length - 1].arrivalMinutes

    let effective = nowMinutes
    if (nowMinutes < firstArr && nowMinutes + 1440 >= firstArr && nowMinutes + 1440 <= lastDep) {
      effective = nowMinutes + 1440
    }
    if (effective < firstArr || effective > lastDep) continue

    let overallProgress: number | null = null

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const dep = e.departureMinutes ?? e.arrivalMinutes

      if (effective >= e.arrivalMinutes && effective <= dep) {
        const key = `${trip.lineId}:${e.stationId}`
        overallProgress = stationProgressMap.get(key)?.progress ?? (i / (entries.length - 1))
        break
      }

      if (i < entries.length - 1) {
        const next = entries[i + 1]
        if (effective > dep && effective < next.arrivalMinutes) {
          const travelDuration = next.arrivalMinutes - dep
          const segProgress = travelDuration > 0
            ? (effective - dep) / travelDuration
            : 0

          const fromKey = `${trip.lineId}:${e.stationId}`
          const toKey = `${trip.lineId}:${next.stationId}`
          const fromP = stationProgressMap.get(fromKey)?.progress ?? (i / (entries.length - 1))
          const toP = stationProgressMap.get(toKey)?.progress ?? ((i + 1) / (entries.length - 1))
          overallProgress = fromP + (toP - fromP) * segProgress
          break
        }
      }
    }

    if (overallProgress === null) continue

    overallProgress = Math.max(0, Math.min(1, overallProgress))
    const pos = interpolateOnLine(line.geometry, overallProgress)
    vehicles.push({
      id: trip.id,
      lineId: trip.lineId,
      type: 'lrt',
      coordinates: pos.coordinates,
      bearing: pos.bearing,
      progress: overallProgress,
      color: line.color,
    })
  }

  return vehicles
}

export const DWELL_SEC = 8

export interface BusStopScheduleEntry {
  stopId: string
  progress: number
  arriveSec: number
  departSec: number
}

export interface BusSchedule {
  tripDurationSec: number
  cycleSec: number
  isCircular: boolean
  totalLenKm: number
  forwardStops: BusStopScheduleEntry[]
  backwardStops: BusStopScheduleEntry[]
}

function projectPointOnSegment(
  a: [number, number],
  b: [number, number],
  p: [number, number],
): { alongKm: number; distKm: number; segLenKm: number } {
  const midLatRad = ((a[1] + b[1]) / 2) * Math.PI / 180
  const kmPerDegLat = 110.574
  const kmPerDegLon = 111.32 * Math.cos(midLatRad)
  const ax = a[0] * kmPerDegLon, ay = a[1] * kmPerDegLat
  const bx = b[0] * kmPerDegLon, by = b[1] * kmPerDegLat
  const px = p[0] * kmPerDegLon, py = p[1] * kmPerDegLat
  const dx = bx - ax, dy = by - ay
  const segLenKm = Math.sqrt(dx * dx + dy * dy)
  let t = 0
  if (segLenKm > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / (segLenKm * segLenKm)
    t = Math.max(0, Math.min(1, t))
  }
  const cx = ax + t * dx, cy = ay + t * dy
  const distKm = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
  return { alongKm: t * segLenKm, distKm, segLenKm }
}

function projectStopsOrdered(
  coords: [number, number][],
  cumKm: number[],
  totalLenKm: number,
  stopIds: string[],
  busStopMap: Map<string, BusStop>,
): number[] {
  const out: number[] = new Array(stopIds.length).fill(0)
  if (totalLenKm <= 0 || coords.length < 2) return out
  const N = stopIds.length
  const firstEqualsLast = N > 1 && stopIds[0] === stopIds[N - 1]

  // Window: a self-crossing polyline can pass near a stop in multiple
  // places. Constrain each ordered pickup to "a few segment-spacings
  // ahead" so one globally-nearest late-loop projection doesn't push
  // the cursor past all remaining stops.
  const avgStepKm = totalLenKm / Math.max(1, N - 1)
  const windowKm = Math.max(avgStepKm * 3, 1.0)

  let cursorKm = 0
  for (let idx = 0; idx < N; idx++) {
    const stop = busStopMap.get(stopIds[idx])
    if (!stop) { out[idx] = cursorKm / totalLenKm; continue }
    if (idx === 0 && firstEqualsLast) { out[0] = 0; cursorKm = 0; continue }
    if (idx === N - 1 && firstEqualsLast) { out[idx] = 1; cursorKm = totalLenKm; continue }

    const hiKm = cursorKm + windowKm
    let bestDist = Infinity
    let bestKm = cursorKm
    for (let i = 1; i < coords.length; i++) {
      if (cumKm[i] < cursorKm) continue
      if (cumKm[i - 1] > hiKm) break
      const { alongKm, distKm } = projectPointOnSegment(coords[i - 1], coords[i], stop.coordinates)
      let candidateKm = cumKm[i - 1] + alongKm
      if (candidateKm < cursorKm) candidateKm = cursorKm
      if (candidateKm > hiKm) candidateKm = hiKm
      if (distKm < bestDist) { bestDist = distKm; bestKm = candidateKm }
    }
    // Fallback: no segment within the window got close (> 300m). Scan
    // all remaining and take the globally nearest — better than stuck.
    if (bestDist > 0.3) {
      for (let i = 1; i < coords.length; i++) {
        if (cumKm[i] < cursorKm) continue
        const { alongKm, distKm } = projectPointOnSegment(coords[i - 1], coords[i], stop.coordinates)
        let candidateKm = cumKm[i - 1] + alongKm
        if (candidateKm < cursorKm) candidateKm = cursorKm
        if (distKm < bestDist) { bestDist = distKm; bestKm = candidateKm }
      }
    }
    out[idx] = bestKm / totalLenKm
    cursorKm = bestKm
  }
  return out
}

function projectStopsUnordered(
  routeGeom: Feature<LineString>,
  totalLenKm: number,
  stopIds: string[],
  busStopMap: Map<string, BusStop>,
): number[] {
  const out: number[] = new Array(stopIds.length).fill(0)
  if (totalLenKm <= 0) return out
  for (let idx = 0; idx < stopIds.length; idx++) {
    const stop = busStopMap.get(stopIds[idx])
    if (!stop) continue
    const projected = nearestPointOnLine(routeGeom, stop.coordinates, { units: 'kilometers' })
    const dist = (projected.properties.location ?? 0) as number
    out[idx] = Math.max(0, Math.min(1, dist / totalLenKm))
  }
  return out
}

function buildDirectionSchedule(
  stopIds: string[],
  stopProgs: number[],
  tripDurationSec: number,
  sign: 1 | -1,
  startProgress: number,
): BusStopScheduleEntry[] {
  const EPS = 0.0001
  const cleaned: { stopId: string; progress: number }[] = []
  let prev = startProgress - sign * EPS
  for (let i = 0; i < stopIds.length; i++) {
    let p = Math.max(0, Math.min(1, stopProgs[i]))
    if ((p - prev) * sign <= EPS) p = prev + sign * EPS
    p = Math.max(0, Math.min(1, p))
    cleaned.push({ stopId: stopIds[i], progress: p })
    prev = p
  }

  const N = cleaned.length
  if (N === 0) return []

  const dwellTotal = N * DWELL_SEC
  const moveTimeSec = Math.max(1, tripDurationSec - dwellTotal)

  const endProgress = sign === 1 ? 1 : 0
  const gaps: number[] = []
  let cur = startProgress
  for (const s of cleaned) { gaps.push(Math.abs(s.progress - cur)); cur = s.progress }
  gaps.push(Math.abs(endProgress - cur))
  const totalGap = gaps.reduce((a, b) => a + b, 0) || 1
  const scale = moveTimeSec / totalGap

  const result: BusStopScheduleEntry[] = []
  let cursorTime = 0
  for (let i = 0; i < N; i++) {
    cursorTime += gaps[i] * scale
    const arriveSec = cursorTime
    const departSec = arriveSec + DWELL_SEC
    cursorTime = departSec
    result.push({ stopId: cleaned[i].stopId, progress: cleaned[i].progress, arriveSec, departSec })
  }
  return result
}

const busScheduleCache = new WeakMap<BusRoute, BusSchedule>()

export function getBusSchedule(route: BusRoute, busStopMap: Map<string, BusStop>): BusSchedule | null {
  const cached = busScheduleCache.get(route)
  if (cached) return cached

  const coords = (route.geometry.geometry?.coordinates ?? []) as [number, number][]
  if (coords.length < 2) return null
  const totalLenKm = getLineLength(route.geometry)
  if (totalLenKm < 0.01) return null

  const cumKm: number[] = [0]
  for (let i = 1; i < coords.length; i++) {
    const { segLenKm } = projectPointOnSegment(coords[i - 1], coords[i], coords[i])
    cumKm.push(cumKm[i - 1] + segLenKm)
  }

  const isCircular = route.routeType === 'circular'
  const tripDurationSec = (totalLenKm < 5 ? 30 : 60) * 60
  const cycleSec = isCircular ? tripDurationSec : tripDurationSec * 2

  const stopProgFwd = isCircular
    ? projectStopsOrdered(coords, cumKm, totalLenKm, route.stopsForward, busStopMap)
    : projectStopsUnordered(route.geometry, totalLenKm, route.stopsForward, busStopMap)
  const stopProgBwd = !isCircular
    ? projectStopsUnordered(route.geometry, totalLenKm, route.stopsBackward, busStopMap)
    : []

  const forwardStops = buildDirectionSchedule(route.stopsForward, stopProgFwd, tripDurationSec, 1, 0)
  const backwardStops = !isCircular
    ? buildDirectionSchedule(route.stopsBackward, stopProgBwd, tripDurationSec, -1, 1)
    : []

  const schedule: BusSchedule = {
    tripDurationSec, cycleSec, isCircular, totalLenKm, forwardStops, backwardStops,
  }
  busScheduleCache.set(route, schedule)
  return schedule
}

function progressAtDirection(
  stops: BusStopScheduleEntry[],
  startProgress: number,
  endProgress: number,
  tripDurationSec: number,
  dirSec: number,
): number {
  const t = Math.max(0, Math.min(tripDurationSec, dirSec))

  if (stops.length === 0) {
    if (tripDurationSec <= 0) return startProgress
    return startProgress + (endProgress - startProgress) * (t / tripDurationSec)
  }

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    if (t <= s.departSec) {
      if (t <= s.arriveSec) {
        const prevDepart = i > 0 ? stops[i - 1].departSec : 0
        const prevProg = i > 0 ? stops[i - 1].progress : startProgress
        const seg = s.arriveSec - prevDepart
        if (seg <= 0) return s.progress
        const f = (t - prevDepart) / seg
        return prevProg + (s.progress - prevProg) * f
      }
      return s.progress
    }
  }

  const last = stops[stops.length - 1]
  const seg = tripDurationSec - last.departSec
  if (seg <= 0) return endProgress
  const f = (t - last.departSec) / seg
  return last.progress + (endProgress - last.progress) * f
}

export function progressAtCycle(schedule: BusSchedule, cycleSec: number): number {
  const wrapped = ((cycleSec % schedule.cycleSec) + schedule.cycleSec) % schedule.cycleSec
  if (schedule.isCircular) {
    return progressAtDirection(schedule.forwardStops, 0, 1, schedule.tripDurationSec, wrapped)
  }
  if (wrapped <= schedule.tripDurationSec) {
    return progressAtDirection(schedule.forwardStops, 0, 1, schedule.tripDurationSec, wrapped)
  }
  return progressAtDirection(
    schedule.backwardStops, 1, 0, schedule.tripDurationSec, wrapped - schedule.tripDurationSec
  )
}

export function computeBusCycleSec(
  vehicleId: string,
  schedule: BusSchedule,
  route: BusRoute,
  nowMinutes: number,
): number {
  const vIndex = parseInt(vehicleId.split('-').pop() ?? '0', 10) || 0
  const elapsed = nowMinutes - route.serviceHoursStart * 60 - vIndex * route.frequency
  if (elapsed < 0) return 0
  const elapsedSec = elapsed * 60
  return ((elapsedSec % schedule.cycleSec) + schedule.cycleSec) % schedule.cycleSec
}

export function computeBusDirSec(
  cycleSec: number,
  schedule: BusSchedule,
): { dirSec: number; returning: boolean } {
  if (schedule.isCircular) return { dirSec: cycleSec, returning: false }
  if (cycleSec <= schedule.tripDurationSec) return { dirSec: cycleSec, returning: false }
  return { dirSec: cycleSec - schedule.tripDurationSec, returning: true }
}

const QUEUE_OFFSET_KM = 0.015 // ~15m gap per queued bus at a shared stop

function computeBusVehicles(
  busRoutes: BusRoute[],
  busStopMap: Map<string, BusStop>,
  nowMinutes: number
): VehiclePosition[] {
  type Raw = {
    route: BusRoute
    schedule: BusSchedule
    id: string
    progress: number
    returning: boolean
    dwellStopId: string | null
    dwellTimeIntoSec: number
  }
  const raws: Raw[] = []

  for (const route of busRoutes) {
    const schedule = getBusSchedule(route, busStopMap)
    if (!schedule) continue

    const tripDurationMin = schedule.tripDurationSec / 60
    const cycleMin = schedule.cycleSec / 60

    const startMin = route.serviceHoursStart * 60
    let endMin = route.serviceHoursEnd * 60
    // Route crosses midnight (serviceHoursEnd may be >24 or <start)
    if (endMin <= startMin) endMin += 1440
    // Pick the effective "now" that falls inside the window; wrap-around
    // takes `nowMinutes + 1440` when the service started yesterday.
    let effectiveNow = nowMinutes
    if (effectiveNow < startMin && effectiveNow + 1440 <= endMin + cycleMin) {
      effectiveNow += 1440
    }
    if (effectiveNow < startMin || effectiveNow > endMin + cycleMin) continue

    const minutesSinceStart = effectiveNow - startMin
    const numVehicles = Math.max(1, Math.floor(tripDurationMin / route.frequency))

    for (let v = 0; v < numVehicles; v++) {
      const offset = v * route.frequency
      const elapsed = minutesSinceStart - offset
      if (elapsed < 0) continue

      if (effectiveNow > endMin) {
        const cycleStart = startMin + offset + Math.floor(elapsed / cycleMin) * cycleMin
        if (cycleStart > endMin) continue
      }

      const elapsedSec = elapsed * 60
      const wrapped = ((elapsedSec % schedule.cycleSec) + schedule.cycleSec) % schedule.cycleSec
      const { dirSec, returning } = computeBusDirSec(wrapped, schedule)
      const progress = Math.max(0, Math.min(1, progressAtCycle(schedule, elapsedSec)))

      const stops = returning ? schedule.backwardStops : schedule.forwardStops
      let dwellStopId: string | null = null
      let dwellTimeIntoSec = 0
      for (const s of stops) {
        if (dirSec >= s.arriveSec && dirSec <= s.departSec) {
          dwellStopId = s.stopId
          dwellTimeIntoSec = dirSec - s.arriveSec
          break
        }
      }

      raws.push({
        route, schedule, id: `${route.id}-${v}`, progress, returning,
        dwellStopId, dwellTimeIntoSec,
      })
    }
  }

  // Queue dwellers sharing a stop so their sprites don't overlap.
  // Front of queue (largest dwellTimeIntoSec = arrived earliest) stays put;
  // later arrivals shift backward along their own route direction.
  const byStop = new Map<string, Raw[]>()
  for (const r of raws) {
    if (!r.dwellStopId) continue
    const arr = byStop.get(r.dwellStopId)
    if (arr) arr.push(r)
    else byStop.set(r.dwellStopId, [r])
  }
  const queueIdx = new Map<string, number>()
  for (const group of byStop.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => b.dwellTimeIntoSec - a.dwellTimeIntoSec)
    for (let i = 0; i < group.length; i++) queueIdx.set(group[i].id, i)
  }

  const QUEUE_PERP_M = 4 // small right-of-travel nudge so clamped endpoint queues still separate

  const vehicles: VehiclePosition[] = []
  for (const r of raws) {
    let finalProgress = r.progress
    const qi = queueIdx.get(r.id) ?? 0
    if (qi > 0) {
      const delta = (QUEUE_OFFSET_KM * qi) / r.schedule.totalLenKm
      finalProgress = r.returning
        ? Math.min(1, r.progress + delta)
        : Math.max(0, r.progress - delta)
    }

    const pos = interpolateOnLine(r.route.geometry, finalProgress)
    let [lng, lat] = pos.coordinates
    if (qi > 0) {
      const bearingRad = (pos.bearing * Math.PI) / 180
      const eastM = Math.cos(bearingRad) * QUEUE_PERP_M * qi
      const northM = -Math.sin(bearingRad) * QUEUE_PERP_M * qi
      const latRad = lat * Math.PI / 180
      lng += eastM / (111320 * Math.cos(latRad))
      lat += northM / 110574
    }

    vehicles.push({
      id: r.id,
      lineId: r.route.id,
      type: 'bus',
      coordinates: [lng, lat],
      bearing: pos.bearing,
      progress: finalProgress,
      color: r.route.color,
    })
  }

  return vehicles
}

const FLIGHT_VISIBLE_MINUTES = 15
const DEPARTURE_CLIMB_MINUTES = 8
const FLIGHT_MAX_DISTANCE_KM = 30
const FLIGHT_MAX_ALTITUDE_M = 3000
const FLIGHT_COLOR = '#38bdf8'
const DEG_PER_KM_LAT = 1 / 111.32

type TaxiWaypoint = { pos: [number, number]; noseTarget: [number, number] }

// Landing approach routes with waypoints: { pos: [lng, lat], noseTarget: [lng, lat] }
// Route 1: From north — descend southward along the runway, turn, taxi to apron
const LANDING_ROUTE_SOUTH: TaxiWaypoint[] = [
  { pos: [113.58617746739547, 22.163612095293683], noseTarget: [113.59661639803325, 22.135252811158846] },
  { pos: [113.59661639803325, 22.135252811158846], noseTarget: [113.59573637190391, 22.13488739162877] },
  { pos: [113.59573637190391, 22.13488739162877], noseTarget: [113.59461357994577, 22.13570255697138] },
  { pos: [113.59461357994577, 22.13570255697138], noseTarget: [113.59024379502763, 22.14733923049094] },
  { pos: [113.59024379502763, 22.14733923049094], noseTarget: [113.57667925434424, 22.155714791453473] },
  { pos: [113.57667925434424, 22.155714791453473], noseTarget: [113.57667925434424, 22.155714791453473] },
]

// Route 2: From south — land heading north along the runway, turn to apron
const LANDING_ROUTE_NORTH: TaxiWaypoint[] = [
  { pos: [113.59652536084747, 22.135309029463954], noseTarget: [113.58678438196743, 22.161953979300034] },
  { pos: [113.58678438196743, 22.161953979300034], noseTarget: [113.58302151162125, 22.16268467689253] },
  { pos: [113.58302151162125, 22.16268467689253], noseTarget: [113.57856068951732, 22.161223277911876] },
  { pos: [113.57856068951732, 22.161223277911876], noseTarget: [113.57856068951732, 22.161223277911876] },
]

// Holding pattern center above the airport for go-arounds
const HOLDING_CENTER: [number, number] = [113.585, 22.152]
const HOLDING_RADIUS_DEG = 0.018
const HOLDING_ALTITUDE_M = 600
const HOLDING_CIRCLE_MINUTES = 2
const HOLD_TRANSITION_MINUTES = 0.8
const RUNWAY_BUSY_BUFFER_MINUTES = 0.8

const APRON_STANDS: [number, number][] = [
  [113.57296247130137, 22.155734815822715],
  [113.5735298224446, 22.156080223561954],
  [113.57405681042064, 22.15623040046111],
  [113.57465381777813, 22.15658536340373],
  [113.57511447160334, 22.15702223964229],
  [113.57545351284965, 22.157534202263445],
  [113.57578149837322, 22.158131489627372],
  [113.57611685435795, 22.158680991762665],
  [113.57615714826129, 22.159292084371216],
  [113.57634435144236, 22.159958431996046],
  [113.57662402849351, 22.160693708475325],
  [113.57685408539844, 22.161487468535842],
]
const APRON_TARGET: [number, number] = [113.56229310185826, 22.167971582336254]
const APRON_LOOKAHEAD_MINUTES = 240
const TAXI_MINUTES = 3

const TAXI_ROUTE_SOUTH: TaxiWaypoint[] = [
  { pos: [113.57846893201933, 22.161205178260285], noseTarget: [113.5861293203778, 22.163669348178995] },
  { pos: [113.5861293203778, 22.163669348178995], noseTarget: [113.59651483316301, 22.135547426147557] },
]
const TAKEOFF_SOUTH: [number, number] = [113.59651483316301, 22.135547426147557]

const TAXI_ROUTE_NORTH: TaxiWaypoint[] = [
  { pos: [113.57665948112424, 22.15577473693072], noseTarget: [113.59027110500244, 22.14725668004919] },
  { pos: [113.59027110500244, 22.14725668004919], noseTarget: [113.59458354434732, 22.135724664946018] },
  { pos: [113.59458354434732, 22.135724664946018], noseTarget: [113.59584660181989, 22.134955830373045] },
  { pos: [113.59584660181989, 22.134955830373045], noseTarget: [113.59659541446433, 22.135281749889227] },
  { pos: [113.59659541446433, 22.135281749889227], noseTarget: [113.5857744315255, 22.164838365489818] },
]
const TAKEOFF_NORTH: [number, number] = [113.5857744315255, 22.164838365489818]

function bearingTo(fromLon: number, fromLat: number, toLon: number, toLat: number): number {
  const dLon = (toLon - fromLon) * Math.PI / 180
  const lat1 = fromLat * Math.PI / 180
  const lat2 = toLat * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

function isSouthbound(bearing: number): boolean {
  return bearing >= 90 && bearing < 270
}

function distDeg(a: [number, number], b: [number, number]): number {
  const dLon = a[0] - b[0], dLat = a[1] - b[1]
  return Math.sqrt(dLon * dLon + dLat * dLat)
}

function buildTaxiPath(apronPos: [number, number], route: TaxiWaypoint[], takeoffPt: [number, number]): [number, number][] {
  return [apronPos, ...route.map(w => w.pos), takeoffPt]
}

function taxiPathTotalDist(path: [number, number][]): number {
  let d = 0
  for (let i = 1; i < path.length; i++) d += distDeg(path[i - 1], path[i])
  return d
}

function interpolateTaxiPath(
  path: [number, number][],
  route: TaxiWaypoint[],
  t: number,
): { pos: [number, number]; bearing: number } {
  const totalDist = taxiPathTotalDist(path)
  let targetDist = t * totalDist
  for (let i = 1; i < path.length; i++) {
    const segDist = distDeg(path[i - 1], path[i])
    if (targetDist <= segDist || i === path.length - 1) {
      const segT = segDist > 0 ? Math.min(1, targetDist / segDist) : 0
      const lon = path[i - 1][0] + (path[i][0] - path[i - 1][0]) * segT
      const lat = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * segT

      let bearing: number
      if (i - 1 === 0) {
        bearing = route.length > 0
          ? bearingTo(lon, lat, route[0].noseTarget[0], route[0].noseTarget[1])
          : bearingTo(path[0][0], path[0][1], path[1][0], path[1][1])
      } else {
        const waypointIdx = i - 2
        if (waypointIdx >= 0 && waypointIdx < route.length) {
          bearing = bearingTo(lon, lat, route[waypointIdx].noseTarget[0], route[waypointIdx].noseTarget[1])
        } else {
          bearing = bearingTo(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1])
        }
      }
      return { pos: [lon, lat], bearing }
    }
    targetDist -= segDist
  }
  const last = path[path.length - 1]
  return { pos: last, bearing: bearingTo(path[path.length - 2][0], path[path.length - 2][1], last[0], last[1]) }
}

function interpolateLandingRoute(
  route: TaxiWaypoint[],
  t: number,
): { pos: [number, number]; bearing: number } {
  const path = route.map(w => w.pos)
  const totalDist = taxiPathTotalDist(path)
  let targetDist = t * totalDist

  for (let i = 1; i < path.length; i++) {
    const segDist = distDeg(path[i - 1], path[i])
    if (targetDist <= segDist || i === path.length - 1) {
      const segT = segDist > 0 ? Math.min(1, targetDist / segDist) : 0
      const lon = path[i - 1][0] + (path[i][0] - path[i - 1][0]) * segT
      const lat = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * segT
      const wp = route[i - 1]
      const bearing = bearingTo(lon, lat, wp.noseTarget[0], wp.noseTarget[1])
      return { pos: [lon, lat], bearing }
    }
    targetDist -= segDist
  }

  const last = route[route.length - 1]
  return {
    pos: last.pos,
    bearing: bearingTo(last.pos[0], last.pos[1], last.noseTarget[0], last.noseTarget[1]),
  }
}

function isRunwayBusy(flights: Flight[], nowMinutes: number): boolean {
  for (const f of flights) {
    if (f.type !== 'departure') continue
    const until = f.scheduledTime - nowMinutes
    const elapsed = nowMinutes - f.scheduledTime
    if (until > 0 && until <= TAXI_MINUTES) return true
    if (elapsed >= 0 && elapsed <= RUNWAY_BUSY_BUFFER_MINUTES) return true
  }
  return false
}

function holdingPosition(fraction: number): { lon: number; lat: number; bearing: number } {
  const angle = fraction * Math.PI * 2
  const degPerKmLon = DEG_PER_KM_LAT / Math.cos((HOLDING_CENTER[1] * Math.PI) / 180)
  const lonScale = degPerKmLon / DEG_PER_KM_LAT
  const lon = HOLDING_CENTER[0] + Math.cos(angle) * HOLDING_RADIUS_DEG * lonScale
  const lat = HOLDING_CENTER[1] + Math.sin(angle) * HOLDING_RADIUS_DEG
  const bearing = ((Math.atan2(
    -Math.sin(angle) * lonScale,
    Math.cos(angle),
  ) * 180) / Math.PI + 360) % 360
  return { lon, lat, bearing }
}

// Arrival phases after APPROACH_END_MIN:
//   Hold (if runway busy): circle repeatedly
//   Transition: fly from circle exit point to first waypoint of landing route
//   Landing: follow waypoint route (descend + taxi)
const APPROACH_END_MIN = 7
const LANDING_ROUTE_MINUTES = 3

function computeFlightVehicles(
  flights: Flight[],
  nowMinutes: number,
): VehiclePosition[] {
  const vehicles: VehiclePosition[] = []

  const departures = flights
    .filter(f => f.type === 'departure')
    .sort((a, b) => a.scheduledTime - b.scheduledTime)

  const taxiStart = TAXI_MINUTES
  const apronEnd = APRON_LOOKAHEAD_MINUTES

  const pendingDepartures = departures.filter(f => {
    const until = f.scheduledTime - nowMinutes
    return until > taxiStart && until <= apronEnd
  })

  for (let i = 0; i < pendingDepartures.length && i < APRON_STANDS.length; i++) {
    const flight = pendingDepartures[i]
    const [lon, lat] = APRON_STANDS[i]
    const heading = bearingTo(lon, lat, APRON_TARGET[0], APRON_TARGET[1])
    vehicles.push({
      id: flight.id,
      lineId: flight.flightNumber,
      type: 'flight',
      coordinates: [lon, lat],
      bearing: heading,
      progress: 0,
      color: FLIGHT_COLOR,
      altitude: 0,
      scale: 0.25,
      flightData: flight,
    })
  }

  for (const flight of flights) {
    if (flight.type === 'departure') {
      const until = flight.scheduledTime - nowMinutes
      const elapsed = nowMinutes - flight.scheduledTime

      if (until > 0 && until <= taxiStart) {
        const destBearing = flight.destination?.bearing ?? 0
        const southbound = isSouthbound(destBearing)
        const route = southbound ? TAXI_ROUTE_SOUTH : TAXI_ROUTE_NORTH
        const takeoffPt = southbound ? TAKEOFF_SOUTH : TAKEOFF_NORTH

        const apronPos = APRON_STANDS[0]
        const path = buildTaxiPath(apronPos, route, takeoffPt)
        const t = 1 - until / taxiStart

        const { pos, bearing } = interpolateTaxiPath(path, route, t)

        vehicles.push({
          id: flight.id,
          lineId: flight.flightNumber,
          type: 'flight',
          coordinates: pos,
          bearing,
          progress: 0,
          color: FLIGHT_COLOR,
          altitude: 0,
          scale: 0.25,
          flightData: flight,
        })
        continue
      }

      if (elapsed < 0 || elapsed > DEPARTURE_CLIMB_MINUTES) continue
      const progress = Math.max(0, Math.min(1, elapsed / DEPARTURE_CLIMB_MINUTES))

      const destBearing = flight.destination?.bearing ?? 0
      const southbound = isSouthbound(destBearing)
      const takeoffPt = southbound ? TAKEOFF_SOUTH : TAKEOFF_NORTH
      const flyBearing = destBearing

      const bearingRad = (flyBearing * Math.PI) / 180
      const dist = progress * FLIGHT_MAX_DISTANCE_KM
      const degPerKmLon = DEG_PER_KM_LAT / Math.cos((takeoffPt[1] * Math.PI) / 180)
      const lat = takeoffPt[1] + Math.cos(bearingRad) * dist * DEG_PER_KM_LAT
      const lon = takeoffPt[0] + Math.sin(bearingRad) * dist * degPerKmLon
      const altitude = progress * FLIGHT_MAX_ALTITUDE_M

      vehicles.push({
        id: flight.id,
        lineId: flight.flightNumber,
        type: 'flight',
        coordinates: [lon, lat],
        bearing: flyBearing,
        progress,
        color: FLIGHT_COLOR,
        altitude,
        flightData: flight,
      })
    } else {
      const untilArrival = flight.scheduledTime - nowMinutes
      const landingDuration = LANDING_ROUTE_MINUTES
      const maxExtraTime = HOLDING_CIRCLE_MINUTES * 10 + HOLD_TRANSITION_MINUTES + landingDuration
      if (untilArrival > FLIGHT_VISIBLE_MINUTES) continue
      if (untilArrival < -maxExtraTime) continue

      const elapsedMin = FLIGHT_VISIBLE_MINUTES - untilArrival
      const airport = flight.origin
      const originBearing = airport?.bearing ?? 180
      const fromSouth = isSouthbound(originBearing)
      const landingRoute = fromSouth ? LANDING_ROUTE_NORTH : LANDING_ROUTE_SOUTH
      const firstWp = landingRoute[0].pos
      const holdExit = holdingPosition(0)

      if (elapsedMin < APPROACH_END_MIN) {
        // Phase 1: Fly from far away toward the hold circle start point
        const phaseProgress = elapsedMin / APPROACH_END_MIN

        const bearingRad = (originBearing * Math.PI) / 180
        const dist = (1 - phaseProgress) * FLIGHT_MAX_DISTANCE_KM
        const degPerKmLon = DEG_PER_KM_LAT / Math.cos((holdExit.lat * Math.PI) / 180)
        const lon = holdExit.lon + Math.sin(bearingRad) * dist * degPerKmLon
        const lat = holdExit.lat + Math.cos(bearingRad) * dist * DEG_PER_KM_LAT
        const altitude = (1 - phaseProgress) * FLIGHT_MAX_ALTITUDE_M + phaseProgress * HOLDING_ALTITUDE_M

        const noseBearing = bearingTo(lon, lat, holdExit.lon, holdExit.lat)

        vehicles.push({
          id: flight.id,
          lineId: flight.flightNumber,
          type: 'flight',
          coordinates: [lon, lat],
          bearing: noseBearing,
          progress: phaseProgress * 0.6,
          color: FLIGHT_COLOR,
          altitude,
          flightData: flight,
        })
      } else {
        const timeAfterApproach = elapsedMin - APPROACH_END_MIN

        const C = HOLDING_CIRCLE_MINUTES
        const T = HOLD_TRANSITION_MINUTES
        const orbitFraction = ((timeAfterApproach % C) + C) % C / C

        // Find the deterministic exit time: the first orbit boundary
        // (n*C, n>=1) where the runway is clear.
        const orbitStartAbsolute = nowMinutes - timeAfterApproach
        let exitOrbitN = 1
        const maxOrbits = 20
        while (exitOrbitN < maxOrbits) {
          const boundaryTime = orbitStartAbsolute + exitOrbitN * C
          if (!isRunwayBusy(flights, boundaryTime)) break
          exitOrbitN++
        }
        const exitTimeAbsolute = orbitStartAbsolute + exitOrbitN * C
        const postTime = nowMinutes - exitTimeAbsolute

        if (postTime < 0) {
          // Still in orbit (mandatory or waiting for runway)
          const hp = holdingPosition(orbitFraction)
          vehicles.push({
            id: flight.id,
            lineId: flight.flightNumber,
            type: 'flight',
            coordinates: [hp.lon, hp.lat],
            bearing: hp.bearing,
            progress: 0.6,
            color: FLIGHT_COLOR,
            altitude: HOLDING_ALTITUDE_M,
            flightData: flight,
          })
        } else if (postTime < T) {
          const t = postTime / T
          const lon = holdExit.lon + (firstWp[0] - holdExit.lon) * t
          const lat = holdExit.lat + (firstWp[1] - holdExit.lat) * t
          const noseBearing = bearingTo(lon, lat, firstWp[0], firstWp[1])

          vehicles.push({
            id: flight.id,
            lineId: flight.flightNumber,
            type: 'flight',
            coordinates: [lon, lat],
            bearing: noseBearing,
            progress: 0.6,
            color: FLIGHT_COLOR,
            altitude: HOLDING_ALTITUDE_M,
            flightData: flight,
          })
        } else {
          const landingElapsed = postTime - T
          const phaseProgress = landingElapsed / landingDuration
          if (phaseProgress >= 1) continue

          const { pos, bearing } = interpolateLandingRoute(landingRoute, phaseProgress)

          const touchdownT = 0.35
          const altitude = phaseProgress < touchdownT
            ? (1 - phaseProgress / touchdownT) * HOLDING_ALTITUDE_M
            : 0
          const scale = phaseProgress >= touchdownT ? 0.25 : undefined

          vehicles.push({
            id: flight.id,
            lineId: flight.flightNumber,
            type: 'flight',
            coordinates: pos,
            bearing,
            progress: 0.6 + phaseProgress * 0.4,
            color: FLIGHT_COLOR,
            altitude,
            scale,
            flightData: flight,
          })
        }
      }
    }
  }

  return vehicles
}

let cachedProgressMap: Map<string, { progress: number }> | null = null
let cachedBusStopMap: Map<string, BusStop> | null = null
let cachedTransitRef: TransitData | null = null

function resetTransitCachesIfStale(transitData: TransitData) {
  if (cachedTransitRef !== transitData) {
    cachedProgressMap = null
    cachedBusStopMap = null
    cachedTransitRef = transitData
  }
}

function getBusStopMap(transitData: TransitData): Map<string, BusStop> {
  resetTransitCachesIfStale(transitData)
  if (cachedBusStopMap) return cachedBusStopMap
  const map = new Map<string, BusStop>()
  for (const s of transitData.busStops) map.set(s.id, s)
  cachedBusStopMap = map
  return map
}

function getStationProgressMap(transitData: TransitData): Map<string, { progress: number }> {
  resetTransitCachesIfStale(transitData)
  if (cachedProgressMap) return cachedProgressMap

  const stationCoordsMap = new Map<string, [number, number]>()
  for (const s of transitData.stations) {
    stationCoordsMap.set(s.id, s.coordinates as [number, number])
  }

  const progressMap = new Map<string, { progress: number }>()
  for (const line of transitData.lrtLines) {
    const totalLen = getLineLength(line.geometry)
    for (const sid of line.stations) {
      const coords = stationCoordsMap.get(sid)
      if (!coords || totalLen === 0) {
        progressMap.set(`${line.id}:${sid}`, { progress: 0 })
        continue
      }
      const pt = nearestPointOnLine(line.geometry, coords, { units: 'kilometers' })
      const dist = pt.properties.location ?? 0
      progressMap.set(`${line.id}:${sid}`, {
        progress: Math.max(0, Math.min(1, dist / totalLen)),
      })
    }
  }

  cachedProgressMap = progressMap
  return progressMap
}

// How long before its scheduled departure a ferry is visible at the berth.
const FERRY_DWELL_BEFORE_DEP_MIN = 20
// How long a just-arrived ferry remains at the berth before vanishing.
const FERRY_DWELL_AFTER_ARR_MIN = 20
// Visible cruise speed along the waypoint path (km/h). Faster than buses
// (~20 km/h) and a bit below the flight cruise segment (~120 km/h).
const FERRY_CRUISE_KMH = 80

// Minutes to traverse the visible path at FERRY_CRUISE_KMH, cached per
// (route, berth) pair — the berth prefix segment varies per ferry.
const ferryPathMinutesCache = new Map<string, number>()
function ferryPathMinutes(key: string, path: [number, number][]): number {
  const cached = ferryPathMinutesCache.get(key)
  if (cached !== undefined) return cached
  const km = pathLengthMeters(path) / 1000
  const mins = (km / FERRY_CRUISE_KMH) * 60
  ferryPathMinutesCache.set(key, mins)
  return mins
}

const M_PER_DEG_LAT = 111320

function ferryBowToward(
  from: [number, number],
  to: [number, number],
): number {
  const cosLat = Math.cos((from[1] * Math.PI) / 180)
  const dx = (to[0] - from[0]) * M_PER_DEG_LAT * cosLat
  const dy = (to[1] - from[1]) * M_PER_DEG_LAT
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360
}

function computeFerryVehicles(
  ferries: Ferry[],
  nowMinutes: number,
): VehiclePosition[] {
  if (ferries.length === 0) return []
  const vehicles: VehiclePosition[] = []

  for (const f of ferries) {
    const route = FERRY_ROUTES[f.routeId]
    const berths = FERRY_BERTHS_BY_TERMINAL[f.terminal]
    const berth = berths[f.berthIndex % berths.length]

    // Ferry visibility around scheduledTime T:
    //   departure: berth dwell [T - dwellBefore, T), then cruise [T, T + pathMin)
    //   arrival:   cruise [T - pathMin, T),          then berth dwell [T, T + dwellAfter)
    // The cruise path prepends the berth coord so the ferry glides smoothly
    // out of / into its slip instead of teleporting to the first waypoint.
    // Routes without a path only have the berth dwell window (Cotai/Taipa).
    const effectivePath: [number, number][] | null = route
      ? [berth.coord, ...route.waypoints]
      : null
    const pathMin = effectivePath
      ? ferryPathMinutes(`${f.routeId}:${f.terminal}:${f.berthIndex % berths.length}`, effectivePath)
      : 0
    const offsets = [0, -1440, 1440]
    let phase: 'berth' | 'journey' | null = null
    let journeyFrac = 0
    for (const off of offsets) {
      const t = f.scheduledTime + off
      if (f.type === 'departure') {
        if (nowMinutes >= t - FERRY_DWELL_BEFORE_DEP_MIN && nowMinutes < t) {
          phase = 'berth'; break
        }
        if (effectivePath && nowMinutes >= t && nowMinutes < t + pathMin) {
          phase = 'journey'
          journeyFrac = (nowMinutes - t) / pathMin
          break
        }
      } else {
        if (effectivePath && nowMinutes >= t - pathMin && nowMinutes < t) {
          phase = 'journey'
          // Arrivals travel the reverse path; convert fraction accordingly.
          journeyFrac = 1 - (nowMinutes - (t - pathMin)) / pathMin
          break
        }
        if (nowMinutes >= t && nowMinutes < t + FERRY_DWELL_AFTER_ARR_MIN) {
          phase = 'berth'; break
        }
      }
    }
    if (!phase) continue

    let coord: [number, number]
    let bearing: number
    let progress = 0
    if (phase === 'berth') {
      coord = [berth.coord[0], berth.coord[1]]
      // Departures turn to face outbound (first waypoint); arrivals keep the
      // original docked orientation (NW toward shore) from ferryBerths.
      bearing = route && f.type === 'departure'
        ? ferryBowToward(berth.coord, route.waypoints[0])
        : berth.bearing
    } else {
      // journey along path (berth → waypoints for departures, reversed for arrivals)
      const { point, bearing: pathBearing } = interpolatePath(effectivePath!, journeyFrac)
      coord = point
      // Arrivals travel the reverse direction of the path, so flip the bow 180°.
      bearing = f.type === 'arrival' ? (pathBearing + 180) % 360 : pathBearing
      progress = journeyFrac
    }

    vehicles.push({
      id: f.id,
      lineId: f.routeId,
      type: 'ferry',
      coordinates: coord,
      bearing,
      progress,
      color: FERRY_COLOR_BY_OPERATOR[f.operator],
      ferryData: f,
    })
  }
  return vehicles
}

export function computeVehiclePositions(
  transitData: TransitData,
  time: Date
): VehiclePosition[] {
  const nowMinutes = timeToMinutes(time)
  const stationProgressMap = getStationProgressMap(transitData)
  const scheduleType = getScheduleType(time)

  const filteredTrips = transitData.trips.filter(
    t => !t.scheduleType || t.scheduleType === scheduleType
  )

  const lrtVehicles = computeLRTVehicles(
    filteredTrips,
    transitData.lrtLines,
    stationProgressMap,
    nowMinutes
  )

  const busStopMap = getBusStopMap(transitData)
  const busVehicles = computeBusVehicles(
    transitData.busRoutes,
    busStopMap,
    nowMinutes
  )

  const flightVehicles = computeFlightVehicles(
    transitData.flights,
    nowMinutes
  )

  const ferryVehicles = computeFerryVehicles(
    transitData.ferries,
    nowMinutes
  )

  return [...lrtVehicles, ...busVehicles, ...flightVehicles, ...ferryVehicles]
}
