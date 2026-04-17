import along from '@turf/along'
import length from '@turf/length'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import type { Feature, LineString } from 'geojson'
import type { TransitData, VehiclePosition, Trip, LRTLine, BusRoute, Flight, ScheduleType } from '../types'

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

function interpolateOnLine(
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
    if (nowMinutes < firstArr || nowMinutes > lastDep) continue

    let overallProgress: number | null = null

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const dep = e.departureMinutes ?? e.arrivalMinutes

      if (nowMinutes >= e.arrivalMinutes && nowMinutes <= dep) {
        const key = `${trip.lineId}:${e.stationId}`
        overallProgress = stationProgressMap.get(key)?.progress ?? (i / (entries.length - 1))
        break
      }

      if (i < entries.length - 1) {
        const next = entries[i + 1]
        if (nowMinutes > dep && nowMinutes < next.arrivalMinutes) {
          const travelDuration = next.arrivalMinutes - dep
          const segProgress = travelDuration > 0
            ? (nowMinutes - dep) / travelDuration
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

function computeBusVehicles(
  busRoutes: BusRoute[],
  nowMinutes: number
): VehiclePosition[] {
  const vehicles: VehiclePosition[] = []

  for (const route of busRoutes) {
    if (nowMinutes < route.serviceHoursStart * 60 || nowMinutes > route.serviceHoursEnd * 60) continue
    if (!route.geometry?.geometry?.coordinates?.length) continue

    const totalLen = getLineLength(route.geometry)
    if (totalLen < 0.01) continue

    const tripDuration = totalLen < 5 ? 30 : 60
    const minutesSinceStart = nowMinutes - route.serviceHoursStart * 60
    const numVehicles = Math.max(1, Math.floor(tripDuration / route.frequency))

    const isCircular = route.routeType === 'circular'

    for (let v = 0; v < numVehicles; v++) {
      const offset = (v * route.frequency)
      const elapsed = minutesSinceStart - offset
      if (elapsed < 0) continue

      let progress: number
      if (isCircular) {
        // Circular routes: direction-0 geometry is a full M -> T -> M
        // loop already, so buses just advance forward and wrap. Bouncing
        // here would traverse the east Y-arm upward (wrong direction)
        // and the west Y-arm downward (wrong direction).
        progress = (elapsed % tripDuration) / tripDuration
      } else {
        // Bilateral routes: direction-0 geometry is one-way. Simulate the
        // return trip by bouncing back through the same geometry.
        const cycleTime = tripDuration * 2
        const cyclePos = elapsed % cycleTime
        if (cyclePos <= tripDuration) {
          progress = cyclePos / tripDuration
        } else {
          progress = 1 - (cyclePos - tripDuration) / tripDuration
        }
      }
      progress = Math.max(0, Math.min(1, progress))

      const pos = interpolateOnLine(route.geometry, progress)
      vehicles.push({
        id: `${route.id}-${v}`,
        lineId: route.id,
        type: 'bus',
        coordinates: pos.coordinates,
        bearing: pos.bearing,
        progress,
        color: route.color,
      })
    }
  }

  return vehicles
}

const MFM_LAT = 22.1494
const MFM_LON = 113.5914
const FLIGHT_VISIBLE_MINUTES = 15
const FLIGHT_MAX_DISTANCE_KM = 30
const FLIGHT_MAX_ALTITUDE_M = 3000
const FLIGHT_COLOR = '#38bdf8'
const DEG_PER_KM_LAT = 1 / 111.32

const APRON_STANDS: [number, number][] = [
  [113.5735298224446, 22.156080223561954],
  [113.57405681042064, 22.15623040046111],
  [113.57465381777813, 22.15658536340373],
  [113.57511447160334, 22.15702223964229],
  [113.57545351284965, 22.157534202263445],
  [113.57578149837322, 22.158131489627372],
  [113.57611685435795, 22.158680991762665],
]
const APRON_TARGET: [number, number] = [113.56823689628482, 22.16647817410933]
const APRON_LOOKAHEAD_MINUTES = 120

function bearingTo(fromLon: number, fromLat: number, toLon: number, toLat: number): number {
  const dLon = (toLon - fromLon) * Math.PI / 180
  const lat1 = fromLat * Math.PI / 180
  const lat2 = toLat * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

function computeFlightVehicles(
  flights: Flight[],
  nowMinutes: number,
): VehiclePosition[] {
  const vehicles: VehiclePosition[] = []

  const departures = flights
    .filter(f => f.type === 'departure')
    .sort((a, b) => a.scheduledTime - b.scheduledTime)

  const pendingDepartures = departures.filter(f => {
    const untilDepart = f.scheduledTime - nowMinutes
    return untilDepart > 0 && untilDepart <= APRON_LOOKAHEAD_MINUTES
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
      const elapsed = nowMinutes - flight.scheduledTime
      if (elapsed < 0 || elapsed > FLIGHT_VISIBLE_MINUTES) continue
      const progress = Math.max(0, Math.min(1, elapsed / FLIGHT_VISIBLE_MINUTES))

      const airport = flight.destination
      const bearingDeg = airport?.bearing ?? 0
      const bearingRad = (bearingDeg * Math.PI) / 180
      const dist = progress * FLIGHT_MAX_DISTANCE_KM
      const degPerKmLon = DEG_PER_KM_LAT / Math.cos((MFM_LAT * Math.PI) / 180)
      const lat = MFM_LAT + Math.cos(bearingRad) * dist * DEG_PER_KM_LAT
      const lon = MFM_LON + Math.sin(bearingRad) * dist * degPerKmLon
      const altitude = progress * FLIGHT_MAX_ALTITUDE_M

      vehicles.push({
        id: flight.id,
        lineId: flight.flightNumber,
        type: 'flight',
        coordinates: [lon, lat],
        bearing: bearingDeg,
        progress,
        color: FLIGHT_COLOR,
        altitude,
        flightData: flight,
      })
    } else {
      const untilArrival = flight.scheduledTime - nowMinutes
      if (untilArrival < 0 || untilArrival > FLIGHT_VISIBLE_MINUTES) continue
      const progress = Math.max(0, Math.min(1, 1 - untilArrival / FLIGHT_VISIBLE_MINUTES))

      const airport = flight.origin
      const bearingDeg = airport?.bearing ?? 180
      const bearingRad = (bearingDeg * Math.PI) / 180
      const dist = (1 - progress) * FLIGHT_MAX_DISTANCE_KM
      const degPerKmLon = DEG_PER_KM_LAT / Math.cos((MFM_LAT * Math.PI) / 180)
      const lat = MFM_LAT + Math.cos(bearingRad) * dist * DEG_PER_KM_LAT
      const lon = MFM_LON + Math.sin(bearingRad) * dist * degPerKmLon
      const altitude = (1 - progress) * FLIGHT_MAX_ALTITUDE_M

      vehicles.push({
        id: flight.id,
        lineId: flight.flightNumber,
        type: 'flight',
        coordinates: [lon, lat],
        bearing: (bearingDeg + 180) % 360,
        progress,
        color: FLIGHT_COLOR,
        altitude,
        flightData: flight,
      })
    }
  }

  return vehicles
}

let cachedProgressMap: Map<string, { progress: number }> | null = null
let cachedTransitRef: TransitData | null = null

function getStationProgressMap(transitData: TransitData): Map<string, { progress: number }> {
  if (cachedProgressMap && cachedTransitRef === transitData) return cachedProgressMap

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
  cachedTransitRef = transitData
  return progressMap
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

  const busVehicles = computeBusVehicles(
    transitData.busRoutes,
    nowMinutes
  )

  const flightVehicles = computeFlightVehicles(
    transitData.flights,
    nowMinutes
  )

  return [...lrtVehicles, ...busVehicles, ...flightVehicles]
}
