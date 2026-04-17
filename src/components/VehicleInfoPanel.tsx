import type { VehiclePosition, TransitData, SimulationClock, Trip, BusRoute, BusStop } from '../types'
import { useI18n, localName } from '../i18n'
import { useMemo } from 'react'
import length from '@turf/length'
import nearestPointOnLine from '@turf/nearest-point-on-line'

interface Props {
  vehicle: VehiclePosition | null
  transitData: TransitData
  clock: SimulationClock
  onClose: () => void
}

const LINE_TERMINALS: Record<string, { forward: string; backward: string }> = {
  taipa: { forward: 'Taipa_Ferry_Terminal', backward: 'Barra' },
  seac_pai_van: { forward: 'Seac_Pai_Van', backward: 'Union_Hospital' },
  hengqin: { forward: 'Hengqin', backward: 'Lotus' },
}

function formatMinutes(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = Math.floor(wrapped % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

interface BusStopETA {
  stopId: string
  stopName: string
  stopNameCn: string
  etaMinutes: number
  status: 'past' | 'dwelling' | 'future'
}

const busStopListCache = new WeakMap<BusRoute, { totalLenKm: number; stopProgress: Map<string, number> }>()

function getBusRouteCache(route: BusRoute, busStopMap: Map<string, BusStop>) {
  let entry = busStopListCache.get(route)
  if (entry) return entry
  const totalLenKm = length(route.geometry, { units: 'kilometers' })
  const stopProgress = new Map<string, number>()
  if (totalLenKm > 0) {
    for (const stopId of route.stops) {
      const stop = busStopMap.get(stopId)
      if (!stop) continue
      const projected = nearestPointOnLine(route.geometry, stop.coordinates, { units: 'kilometers' })
      const dist = (projected.properties.location ?? 0) as number
      stopProgress.set(stopId, dist / totalLenKm)
    }
  }
  entry = { totalLenKm, stopProgress }
  busStopListCache.set(route, entry)
  return entry
}

function computeBusStopETAs(
  vehicle: VehiclePosition,
  route: BusRoute,
  busStopMap: Map<string, BusStop>,
  nowMinutes: number,
): BusStopETA[] {
  const cache = getBusRouteCache(route, busStopMap)
  if (cache.totalLenKm < 0.01) return []
  const tripDuration = cache.totalLenKm < 5 ? 30 : 60
  const isCircular = route.routeType === 'circular'

  const seen = new Set<string>()
  const result: BusStopETA[] = []
  for (const stopId of route.stops) {
    if (seen.has(stopId)) continue
    seen.add(stopId)
    const stopProg = cache.stopProgress.get(stopId)
    if (stopProg === undefined) continue
    const stop = busStopMap.get(stopId)
    if (!stop) continue

    let delta = stopProg - vehicle.progress
    if (isCircular && delta < -0.005) delta += 1
    const etaSeconds = delta * tripDuration * 60

    let status: 'past' | 'dwelling' | 'future'
    if (Math.abs(etaSeconds) < 30) status = 'dwelling'
    else if (delta > 0) status = 'future'
    else status = 'past'

    result.push({
      stopId,
      stopName: stop.name,
      stopNameCn: stop.nameCn,
      etaMinutes: nowMinutes + delta * tripDuration,
      status,
    })
  }
  return result
}

export function VehicleInfoPanel({ vehicle, transitData, clock, onClose }: Props) {
  const { lang, t } = useI18n()

  const trip: Trip | undefined = useMemo(() => {
    if (!vehicle || vehicle.type !== 'lrt') return undefined
    return transitData.trips.find(tr => tr.id === vehicle.id)
  }, [vehicle?.id, transitData.trips])

  const stationMap = useMemo(() => {
    const map = new Map<string, { name: string; nameCn: string; namePt: string }>()
    for (const s of transitData.stations) {
      map.set(s.id, { name: s.name, nameCn: s.nameCn, namePt: s.namePt })
    }
    return map
  }, [transitData.stations])

  const busStopMap = useMemo(() => {
    return new Map(transitData.busStops.map(s => [s.id, s]))
  }, [transitData.busStops])

  const nowMinutesForETA = clock.currentTime.getHours() * 60
    + clock.currentTime.getMinutes()
    + clock.currentTime.getSeconds() / 60

  const busETAs: BusStopETA[] = useMemo(() => {
    if (!vehicle || vehicle.type !== 'bus') return []
    const route = transitData.busRoutes.find(r => r.id === vehicle.lineId)
    if (!route) return []
    return computeBusStopETAs(vehicle, route, busStopMap, nowMinutesForETA)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, vehicle?.progress, busStopMap, transitData.busRoutes])

  if (!vehicle) return null

  const line = vehicle.type === 'lrt'
    ? transitData.lrtLines.find(l => l.id === vehicle.lineId)
    : null
  const route = vehicle.type === 'bus'
    ? transitData.busRoutes.find(r => r.id === vehicle.lineId)
    : null

  const lineName = line
    ? localName(lang, line)
    : route
      ? (lang === 'en' ? `Route ${route.name}` : `${route.name} ${localName(lang, route)}`.trim())
      : vehicle.lineId

  const nowMinutes = clock.currentTime.getHours() * 60
    + clock.currentTime.getMinutes()
    + clock.currentTime.getSeconds() / 60

  const terminals = LINE_TERMINALS[vehicle.lineId]
  const destinationId = trip
    ? trip.entries[trip.entries.length - 1].stationId
    : (terminals
      ? (terminals.forward === vehicle.lineId ? terminals.forward : '')
      : '')
  const destStation = stationMap.get(destinationId)
  const destName = destStation
    ? localName(lang, destStation)
    : ''

  return (
    <div className="absolute top-20 left-4 bg-black/80 backdrop-blur-sm rounded-xl z-10
                    px-4 py-3 border border-white/20 min-w-[220px] max-w-[300px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: vehicle.color }}
          />
          <span className="text-white font-semibold text-sm">{lineName}</span>
        </div>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-sm transition-colors ml-2"
        >
          ✕
        </button>
      </div>

      {destName && (
        <div className="text-xs text-white/60 mb-2">
          {t.towards} <span className="text-white/90 font-medium">{destName}</span>
        </div>
      )}

      {trip && (
        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
          <div className="relative pl-4">
            <div className="absolute left-[5px] top-1 bottom-1 w-px bg-white/15" />
            {trip.entries.map((entry, i) => {
              const s = stationMap.get(entry.stationId)
              const label = s ? localName(lang, s) : entry.stationId
              const arr = entry.arrivalMinutes
              const dep = entry.departureMinutes ?? arr
              const isFirst = i === 0
              const isLast = i === trip.entries.length - 1

              let status: 'past' | 'dwelling' | 'future'
              if (nowMinutes > dep + 0.5) {
                status = 'past'
              } else if (nowMinutes >= arr - 0.3 && nowMinutes <= dep + 0.5) {
                status = 'dwelling'
              } else {
                status = 'future'
              }

              return (
                <div key={entry.stationId} className="relative flex items-start gap-2 pb-1.5">
                  <div
                    className={`absolute left-[-14px] top-[5px] w-[11px] h-[11px] rounded-full border-2 z-[1]
                      ${status === 'past'
                        ? 'bg-white/30 border-white/30'
                        : status === 'dwelling'
                          ? 'border-yellow-400 bg-yellow-400'
                          : isLast
                            ? 'border-white bg-transparent'
                            : 'border-white/60 bg-transparent'
                      }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs truncate ${
                          status === 'past'
                            ? 'text-white/30'
                            : status === 'dwelling'
                              ? 'text-yellow-300 font-semibold'
                              : isLast
                                ? 'text-white font-medium'
                                : 'text-white/80'
                        }`}
                      >
                        {label}
                      </span>
                      <span
                        className={`text-xs font-mono flex-shrink-0 ${
                          status === 'past'
                            ? 'text-white/25'
                            : status === 'dwelling'
                              ? 'text-yellow-300'
                              : 'text-white/60'
                        }`}
                      >
                        {formatMinutes(isFirst ? dep : arr)}
                      </span>
                    </div>
                    {status === 'dwelling' && (
                      <span className="text-[10px] text-yellow-400/70">{t.dwelling}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!trip && vehicle.type === 'bus' && busETAs.length > 0 && (
        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
          <div className="relative pl-4">
            <div className="absolute left-[5px] top-1 bottom-1 w-px bg-white/15" />
            {busETAs.map((s, i) => {
              const label = lang === 'zh' ? (s.stopNameCn || s.stopName) : s.stopName
              const isLast = i === busETAs.length - 1
              return (
                <div key={`${s.stopId}-${i}`} className="relative flex items-start gap-2 pb-1.5">
                  <div
                    className={`absolute left-[-14px] top-[5px] w-[11px] h-[11px] rounded-full border-2 z-[1]
                      ${s.status === 'past'
                        ? 'bg-white/30 border-white/30'
                        : s.status === 'dwelling'
                          ? 'border-yellow-400 bg-yellow-400'
                          : isLast
                            ? 'border-white bg-transparent'
                            : 'border-white/60 bg-transparent'
                      }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs truncate ${
                          s.status === 'past'
                            ? 'text-white/30'
                            : s.status === 'dwelling'
                              ? 'text-yellow-300 font-semibold'
                              : isLast
                                ? 'text-white font-medium'
                                : 'text-white/80'
                        }`}
                      >
                        {label}
                      </span>
                      <span
                        className={`text-xs font-mono flex-shrink-0 ${
                          s.status === 'past'
                            ? 'text-white/25'
                            : s.status === 'dwelling'
                              ? 'text-yellow-300'
                              : 'text-white/60'
                        }`}
                      >
                        {formatMinutes(s.etaMinutes)}
                      </span>
                    </div>
                    {s.status === 'dwelling' && (
                      <span className="text-[10px] text-yellow-400/70">{t.dwelling}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
