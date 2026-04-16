import along from '@turf/along'
import length from '@turf/length'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import type { Feature, LineString } from 'geojson'
import type { TransitData, VehiclePosition, Trip, LRTLine, BusRoute } from '../types'

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

    const totalLen = length(route.geometry, { units: 'kilometers' })
    if (totalLen < 0.01) continue

    const tripDuration = totalLen < 5 ? 30 : 60
    const minutesSinceStart = nowMinutes - route.serviceHoursStart * 60
    const numVehicles = Math.max(1, Math.floor(tripDuration / route.frequency))

    for (let v = 0; v < numVehicles; v++) {
      const offset = (v * route.frequency)
      const elapsed = minutesSinceStart - offset
      if (elapsed < 0) continue

      const cycleTime = tripDuration * 2
      const cyclePos = elapsed % cycleTime
      let progress: number
      if (cyclePos <= tripDuration) {
        progress = cyclePos / tripDuration
      } else {
        progress = 1 - (cyclePos - tripDuration) / tripDuration
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

  const lrtVehicles = computeLRTVehicles(
    transitData.trips,
    transitData.lrtLines,
    stationProgressMap,
    nowMinutes
  )

  const busVehicles = computeBusVehicles(
    transitData.busRoutes,
    nowMinutes
  )

  return [...lrtVehicles, ...busVehicles]
}
