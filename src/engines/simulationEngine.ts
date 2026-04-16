import along from '@turf/along'
import length from '@turf/length'
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
  stations: Map<string, { progress: number }>,
  nowMinutes: number
): VehiclePosition[] {
  const vehicles: VehiclePosition[] = []
  const lineMap = new Map(lines.map(l => [l.id, l]))

  for (const trip of trips) {
    const line = lineMap.get(trip.lineId)
    if (!line) continue

    const entries = trip.entries
    if (entries.length < 2) continue

    const firstDeparture = entries[0].arrivalMinutes
    const lastArrival = entries[entries.length - 1].arrivalMinutes
    if (nowMinutes < firstDeparture || nowMinutes > lastArrival) continue

    let segIdx = 0
    for (let i = 0; i < entries.length - 1; i++) {
      if (nowMinutes >= entries[i].arrivalMinutes && nowMinutes <= entries[i + 1].arrivalMinutes) {
        segIdx = i
        break
      }
    }

    const fromEntry = entries[segIdx]
    const toEntry = entries[segIdx + 1]
    const segDuration = toEntry.arrivalMinutes - fromEntry.arrivalMinutes
    const segProgress = segDuration > 0
      ? (nowMinutes - fromEntry.arrivalMinutes) / segDuration
      : 0

    const fromProgress = stations.get(fromEntry.stationId)?.progress ?? 0
    const toProgress = stations.get(toEntry.stationId)?.progress ?? 1
    const overallProgress = fromProgress + (toProgress - fromProgress) * segProgress

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

export function computeVehiclePositions(
  transitData: TransitData,
  time: Date
): VehiclePosition[] {
  const nowMinutes = timeToMinutes(time)

  const stationProgressMap = new Map<string, { progress: number }>()
  for (const line of transitData.lrtLines) {
    const stationCount = line.stations.length
    line.stations.forEach((sid, i) => {
      stationProgressMap.set(`${line.id}:${sid}`, {
        progress: stationCount > 1 ? i / (stationCount - 1) : 0,
      })
    })
  }

  const tripStationMap = new Map<string, { progress: number }>()
  for (const trip of transitData.trips) {
    for (const entry of trip.entries) {
      const key = `${trip.lineId}:${entry.stationId}`
      const val = stationProgressMap.get(key)
      if (val) tripStationMap.set(key, val)
    }
  }

  const lrtVehicles = computeLRTVehicles(
    transitData.trips,
    transitData.lrtLines,
    tripStationMap,
    nowMinutes
  )

  const busVehicles = computeBusVehicles(
    transitData.busRoutes,
    nowMinutes
  )

  return [...lrtVehicles, ...busVehicles]
}
