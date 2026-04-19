import type { VehiclePosition, TransitData, SimulationClock, Trip, BusRoute, BusStop } from '../types'
import { useI18n, localName } from '../i18n'
import { useMemo, useRef, useEffect } from 'react'
import length from '@turf/length'
import nearestPointOnLine from '@turf/nearest-point-on-line'

interface Props {
  vehicle: VehiclePosition | null
  transitData: TransitData
  clock: SimulationClock
  onClose: () => void
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
  status: 'past' | 'dwelling' | 'arriving' | 'future'
}

const busStopListCache = new WeakMap<BusRoute, { totalLenKm: number; stopProgressByIndex: number[] }>()

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

function getBusRouteCache(route: BusRoute, busStopMap: Map<string, BusStop>) {
  let entry = busStopListCache.get(route)
  if (entry) return entry

  const coords = (route.geometry.geometry?.coordinates ?? []) as [number, number][]
  const cumKm: number[] = [0]
  for (let i = 1; i < coords.length; i++) {
    const seg = projectPointOnSegment(coords[i - 1], coords[i], coords[i])
    cumKm.push(cumKm[i - 1] + seg.segLenKm)
  }
  const totalLenKm = cumKm[cumKm.length - 1] ?? 0

  const stopProgressByIndex: number[] = new Array(route.stops.length).fill(0)
  const isCircular = route.routeType === 'circular'
  const firstEqualsLast = route.stops.length > 1
    && route.stops[0] === route.stops[route.stops.length - 1]

  if (totalLenKm > 0 && coords.length >= 2) {
    if (isCircular) {
      // Ordered forward walk: each stop projects onto segments after the
      // previous cursor. Handles closed loops where first/last stop share
      // coordinates and routes that visit the same stop twice.
      let cursorKm = 0
      for (let idx = 0; idx < route.stops.length; idx++) {
        const stop = busStopMap.get(route.stops[idx])
        if (!stop) {
          stopProgressByIndex[idx] = cursorKm / totalLenKm
          continue
        }
        if (idx === 0 && firstEqualsLast) {
          stopProgressByIndex[0] = 0
          cursorKm = 0
          continue
        }
        if (idx === route.stops.length - 1 && firstEqualsLast) {
          stopProgressByIndex[idx] = 1
          cursorKm = totalLenKm
          continue
        }
        let bestDist = Infinity
        let bestKm = cursorKm
        for (let i = 1; i < coords.length; i++) {
          if (cumKm[i] < cursorKm) continue
          const { alongKm, distKm } = projectPointOnSegment(coords[i - 1], coords[i], stop.coordinates)
          let candidateKm = cumKm[i - 1] + alongKm
          if (candidateKm < cursorKm) candidateKm = cursorKm
          if (distKm < bestDist) {
            bestDist = distKm
            bestKm = candidateKm
          }
        }
        stopProgressByIndex[idx] = bestKm / totalLenKm
        cursorKm = bestKm
      }
    } else {
      for (let idx = 0; idx < route.stops.length; idx++) {
        const stop = busStopMap.get(route.stops[idx])
        if (!stop) continue
        const projected = nearestPointOnLine(route.geometry, stop.coordinates, { units: 'kilometers' })
        const dist = (projected.properties.location ?? 0) as number
        stopProgressByIndex[idx] = dist / totalLenKm
      }
    }
  }

  entry = { totalLenKm, stopProgressByIndex }
  busStopListCache.set(route, entry)
  return entry
}

function computeLiveBusDirection(vehicle: VehiclePosition, route: BusRoute, totalLenKm: number, nowMinutes: number): boolean {
  if (route.routeType === 'circular') return false
  const tripDuration = totalLenKm < 5 ? 30 : 60
  const vIndex = parseInt(vehicle.id.split('-').pop() ?? '0', 10)
  const minutesSinceStart = nowMinutes - route.serviceHoursStart * 60
  const elapsed = minutesSinceStart - vIndex * route.frequency
  if (elapsed < 0) return false
  const cycleTime = tripDuration * 2
  const cyclePos = elapsed % cycleTime
  return cyclePos > tripDuration
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

  const liveProgress = vehicle.progress
  const returning = vehicle.rt
    ? vehicle.rt.dir === 1
    : computeLiveBusDirection(vehicle, route, cache.totalLenKm, nowMinutes)

  const entries: { stopId: string; stop: BusStop; effectiveProg: number }[] = []
  let prevProg = -1
  const isCircular = route.routeType === 'circular'
  for (let idx = 0; idx < route.stops.length; idx++) {
    const stopId = route.stops[idx]
    const stop = busStopMap.get(stopId)
    if (!stop) continue
    const stopProg = cache.stopProgressByIndex[idx]

    let effectiveProg = stopProg
    if (!isCircular && effectiveProg <= prevProg + 0.001) {
      effectiveProg = prevProg + 0.001
    }
    prevProg = effectiveProg
    entries.push({ stopId, stop, effectiveProg })
  }

  if (returning) entries.reverse()

  const rtStopIndex = vehicle.rt?.stopIndex

  const result: BusStopETA[] = []
  for (let i = 0; i < entries.length; i++) {
    const { stopId, stop, effectiveProg } = entries[i]
    let delta: number
    if (returning) {
      delta = liveProgress - effectiveProg
    } else {
      delta = effectiveProg - liveProgress
    }

    const etaMin = delta * tripDuration

    let status: 'past' | 'dwelling' | 'arriving' | 'future'
    if (rtStopIndex !== undefined) {
      if (i < rtStopIndex) status = 'past'
      else if (i === rtStopIndex) status = 'dwelling'
      else if (i - rtStopIndex === 1) status = 'arriving'
      else status = 'future'
    } else if (etaMin > -0.5 && etaMin < 0.5) status = 'dwelling'
    else if (etaMin >= 0.5 && etaMin < 5) status = 'arriving'
    else if (etaMin >= 5) status = 'future'
    else status = 'past'

    result.push({
      stopId,
      stopName: stop.name,
      stopNameCn: stop.nameCn,
      etaMinutes: nowMinutes + etaMin,
      status,
    })
  }
  return result
}

interface RowData {
  key: string
  primary: string
  secondary: string
  arr: string
  dep: string
  status: 'past' | 'dwelling' | 'arriving' | 'future'
  isLast: boolean
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
  }, [vehicle?.id, vehicle?.rt?.stopIndex, vehicle?.rt?.observedAt, vehicle?.progress, nowMinutesForETA, busStopMap, transitData.busRoutes])

  if (!vehicle) return null

  const line = vehicle.type === 'lrt'
    ? transitData.lrtLines.find(l => l.id === vehicle.lineId)
    : null
  const route = vehicle.type === 'bus'
    ? transitData.busRoutes.find(r => r.id === vehicle.lineId)
    : null

  const color = vehicle.color
  const lineLabel = line
    ? localName(lang, line)
    : route
      ? route.name
      : vehicle.lineId
  const nowMinutes = clock.currentTime.getHours() * 60
    + clock.currentTime.getMinutes()
    + clock.currentTime.getSeconds() / 60

  // Build unified rows
  const rows: RowData[] = []
  if (trip) {
    trip.entries.forEach((entry, i) => {
      const s = stationMap.get(entry.stationId)
      const primary = s ? localName(lang, s) : entry.stationId
      const secondary = s ? (s.name !== primary ? s.name : '') : ''
      const arr = entry.arrivalMinutes
      const dep = entry.departureMinutes ?? arr
      const isFirst = i === 0
      const isLast = i === trip.entries.length - 1

      let status: 'past' | 'dwelling' | 'arriving' | 'future'
      if (nowMinutes > dep + 0.5) status = 'past'
      else if (nowMinutes >= arr - 0.3 && nowMinutes <= dep + 0.5) status = 'dwelling'
      else if (nowMinutes >= arr - 5) status = 'arriving'
      else status = 'future'

      rows.push({
        key: entry.stationId,
        primary,
        secondary,
        arr: isFirst ? '—' : formatMinutes(arr),
        dep: isLast ? (lang === 'zh' ? '終站' : lang === 'pt' ? 'Terminal' : 'End') : formatMinutes(dep),
        status,
        isLast,
      })
    })
  } else if (vehicle.type === 'bus') {
    busETAs.forEach((s, i) => {
      const primary = lang === 'zh' ? (s.stopNameCn || s.stopName) : s.stopName
      const secondary = lang === 'zh' && s.stopNameCn && s.stopName !== s.stopNameCn ? s.stopName : ''
      const isLast = i === busETAs.length - 1
      const etaStr = formatMinutes(s.etaMinutes)
      rows.push({
        key: `${s.stopId}-${i}`,
        primary,
        secondary,
        arr: etaStr,
        dep: isLast ? (lang === 'zh' ? '終站' : lang === 'pt' ? 'Terminal' : 'End') : etaStr,
        status: s.status,
        isLast,
      })
    })
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const firstActiveIdx = rows.findIndex(r => r.status !== 'past')
  const prevVehicleIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!vehicle || firstActiveIdx < 0) return
    const isNewVehicle = prevVehicleIdRef.current !== vehicle.id
    prevVehicleIdRef.current = vehicle.id
    const el = scrollRef.current
    if (!el) return
    const targetRow = el.children[firstActiveIdx] as HTMLElement | undefined
    if (!targetRow) return
    if (isNewVehicle) {
      targetRow.scrollIntoView({ block: 'center' })
    } else {
      const containerRect = el.getBoundingClientRect()
      const rowRect = targetRow.getBoundingClientRect()
      if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
        targetRow.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }
  }, [vehicle?.id, firstActiveIdx])

  // Find next destination (last entry for lrt, last future stop for bus)
  const destRow = trip
    ? rows[rows.length - 1]
    : rows.find(r => r.status === 'future' || r.status === 'arriving')
  const destName = destRow?.primary ?? ''

  // Find next stop dwelling/arriving for NEXT stat
  const nextRow = rows.find(r => r.status === 'dwelling' || r.status === 'arriving' || r.status === 'future')
  const nextETA = nextRow ? nextRow.arr : '—'
  const nextSub = nextRow?.status === 'dwelling' ? 'dwell' : 'arr'

  const speed = useMemo(() => {
    if (vehicle.rt) return vehicle.rt.speed
    if (vehicle.type === 'lrt' && trip && line) {
      const totalLenKm = length(line.geometry, { units: 'kilometers' })
      for (let i = 0; i < trip.entries.length; i++) {
        const e = trip.entries[i]
        const dep = e.departureMinutes ?? e.arrivalMinutes
        if (nowMinutes >= e.arrivalMinutes - 0.3 && nowMinutes <= dep + 0.3) return 0

        if (i < trip.entries.length - 1) {
          const next = trip.entries[i + 1]
          if (nowMinutes > dep && nowMinutes < next.arrivalMinutes) {
            const travelMin = next.arrivalMinutes - dep
            if (travelMin <= 0) return 0
            const stns = transitData.stations
            const fromCoords = stns.find(s => s.id === e.stationId)?.coordinates
            const toCoords = stns.find(s => s.id === next.stationId)?.coordinates
            let segKm: number
            if (fromCoords && toCoords && totalLenKm > 0) {
              const p1 = nearestPointOnLine(line.geometry, fromCoords, { units: 'kilometers' })
              const p2 = nearestPointOnLine(line.geometry, toCoords, { units: 'kilometers' })
              segKm = Math.abs((p2.properties.location ?? 0) - (p1.properties.location ?? 0))
            } else {
              segKm = totalLenKm / Math.max(1, trip.entries.length - 1)
            }
            const avgSpeed = (segKm / travelMin) * 60
            const segProgress = (nowMinutes - dep) / travelMin
            const approachSlowdown = segProgress > 0.85 ? 1 - ((segProgress - 0.85) / 0.15) * 0.7 : 1
            const departAccel = segProgress < 0.15 ? 0.3 + (segProgress / 0.15) * 0.7 : 1
            return Math.round(avgSpeed * approachSlowdown * departAccel)
          }
        }
      }
      return 0
    }
    if (vehicle.type === 'bus' && route) {
      const cache = getBusRouteCache(route, busStopMap)
      if (cache.totalLenKm < 0.01) return 0
      const tripDuration = cache.totalLenKm < 5 ? 30 : 60
      return Math.round((cache.totalLenKm / tripDuration) * 60)
    }
    return 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id, vehicle.type, nowMinutes, trip, line, route, busETAs])

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+112px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                      shadow-2xl shadow-black/60 overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className="flex items-stretch border-b border-amber-300/20">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-white/10"
               style={{ backgroundColor: color + '22' }}>
            <div className="w-1 h-7 shrink-0" style={{ backgroundColor: color }} />
            <div>
              <div className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-white/50">LINE</div>
              <div className={`mm-han font-bold text-white leading-tight ${lang === 'zh' ? 'text-[16px]' : 'text-[14px]'}`}>{lineLabel}</div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-amber-300/70 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-300 mm-led-pulse" />
              {t.towards.toUpperCase()} · BOUND FOR
            </div>
            <div className={`mm-han font-semibold text-amber-100 truncate ${lang === 'zh' ? 'text-lg' : 'text-[15px]'}`}>
              {destName}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 text-white/40 hover:text-white hover:bg-white/5 border-l border-white/10
                       mm-mono text-[16px] transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 border-b border-white/8 bg-white/[0.02]">
          <div className="px-3 py-1.5 border-r border-white/8">
            <div className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-white/35">SPEED</div>
            <div className="flex items-baseline gap-1">
              <span className="mm-mono mm-tabular text-[16px] font-bold text-white/90 leading-tight">{speed}</span>
              <span className="mm-mono text-[11px] text-white/40">km/h</span>
            </div>
          </div>
          <div className="px-3 py-1.5">
            <div className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-white/35">NEXT</div>
            <div className="flex items-baseline gap-1">
              <span className="mm-mono mm-tabular text-[17px] font-bold text-amber-200 leading-tight">{nextETA}</span>
              <span className="mm-mono text-[11px] text-white/40">{nextSub}</span>
            </div>
          </div>
        </div>

        {/* Schedule table */}
        {rows.length > 0 && (
          <>
            <div className="grid grid-cols-[16px_1fr_54px_54px] gap-0 px-3 py-1.5
                            border-b border-white/5 bg-white/[0.015]">
              <span />
              <span className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-white/35">STATION · 車站</span>
              <span className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-white/35 text-right">ARR</span>
              <span className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-white/35 text-right">DEP</span>
            </div>
            <div ref={scrollRef} className="max-h-[45vh] overflow-y-auto max-sm:max-h-[30vh]">
              {rows.map((r, i) => {
                const isFirstRow = i === 0
                const isLastRow = i === rows.length - 1
                const railColor = r.status === 'past' ? 'rgba(255,255,255,0.15)' : color + '88'
                return (
                  <div
                    key={r.key}
                    className={`grid grid-cols-[16px_1fr_54px_54px] items-center px-3 py-1.5
                                border-b border-white/5 last:border-b-0
                                ${r.status === 'past' ? 'opacity-35' : ''}`}
                  >
                    {/* Marker */}
                    <div className="relative flex items-center justify-center h-full">
                      {!isLastRow && (
                        <div className="absolute left-1/2 -translate-x-1/2 top-[14px] bottom-[-8px] w-px"
                             style={{ backgroundColor: railColor }} />
                      )}
                      {!isFirstRow && (
                        <div className="absolute left-1/2 -translate-x-1/2 top-[-8px] bottom-[14px] w-px"
                             style={{ backgroundColor: railColor }} />
                      )}
                      {r.status === 'dwelling' ? (
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-300 relative z-10 mm-led-pulse"
                             style={{ boxShadow: '0 0 6px rgba(252,196,65,0.8)' }} />
                      ) : r.status === 'arriving' ? (
                        <div className="w-2.5 h-2.5 rounded-full border-2 border-amber-300 bg-[#0b0b0c] relative z-10" />
                      ) : r.status === 'past' ? (
                        <div className="w-1.5 h-1.5 rounded-full bg-white/30 relative z-10" />
                      ) : (
                        <div className="w-2 h-2 rounded-full border-2 relative z-10"
                             style={{ borderColor: color, backgroundColor: '#0b0b0c' }} />
                      )}
                    </div>
                    {/* Station */}
                    <div className="flex flex-col min-w-0">
                      <span className={`mm-han truncate ${lang === 'zh' ? 'text-[14px]' : 'text-[12px]'} ${
                        r.status === 'dwelling' ? 'text-amber-200 font-semibold'
                          : r.status === 'arriving' ? 'text-white font-medium'
                          : r.status === 'future' ? (r.isLast ? 'text-white font-semibold' : 'text-white/80')
                          : 'text-white/50'
                      }`}>{r.primary}</span>
                      {r.secondary && (
                        <span className="mm-mono text-[9px] text-white/30 tracking-wide truncate">{r.secondary}</span>
                      )}
                    </div>
                    {/* ARR */}
                    <span className={`mm-mono mm-tabular text-[13px] text-right ${
                      r.status === 'dwelling' ? 'text-amber-200'
                        : r.status === 'past' ? 'text-white/25 line-through'
                        : 'text-white/65'
                    }`}>{r.arr}</span>
                    {/* DEP */}
                    <span className={`mm-mono mm-tabular text-[13px] text-right ${
                      r.status === 'dwelling' ? 'text-amber-300'
                        : r.status === 'past' ? 'text-white/25 line-through'
                        : 'text-white/50'
                    }`}>{r.dep}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-white/8 bg-white/[0.02] flex items-center justify-between">
          <span className="mm-mono text-[10px] tracking-[0.25em] text-white/35 uppercase">{t.schedule}</span>
          <span className="mm-mono text-[11px] text-emerald-300/80 flex items-center gap-1.5 tracking-wider">
            <span className="w-1 h-1 rounded-full bg-emerald-400 mm-led-pulse" />ON TIME
          </span>
        </div>
      </div>
    </div>
  )
}
