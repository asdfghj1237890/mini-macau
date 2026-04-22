import type { VehiclePosition, TransitData, SimulationClock, Trip, BusStop } from '../types'
import { useI18n, localName } from '../i18n'
import { useMemo, useRef, useEffect } from 'react'
import length from '@turf/length'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import {
  getBusSchedule,
  computeBusCycleSec,
  computeBusDirSec,
  type BusSchedule,
} from '../engines/simulationEngine'

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

function computeBusStopETAs(
  vehicle: VehiclePosition,
  schedule: BusSchedule,
  busStopMap: Map<string, BusStop>,
  dirSec: number,
  returning: boolean,
  nowMinutes: number,
): BusStopETA[] {
  const stops = returning ? schedule.backwardStops : schedule.forwardStops
  const rtStopIndex = vehicle.rt?.stopIndex
  // RT-anchored display: the bus is at `stops[rtStopIndex]` NOW, so we pin
  // displayed[rtStopIndex] = nowMinutes and extrapolate every other stop
  // using the scheduled inter-stop duration deltas (`stops[i].arriveSec -
  // stops[rtStopIndex].arriveSec`). This means past stops show a plausible
  // "when we were there" time in the past and future stops show an ETA
  // derived from RT reality — regardless of whether the bus is running
  // ahead of or behind its scheduled slot.
  //
  // An earlier implementation snapped the implied trip start to the nearest
  // scheduled slot (`serviceHoursStart + k × frequency`) and printed the
  // schedule for that slot. That looked "canonical" but made past stops
  // show future times (and vice versa) whenever the bus was off schedule
  // by more than ~15–30 seconds, which is essentially always.
  let rtDirectionStartMin: number | null = null
  if (rtStopIndex !== undefined && rtStopIndex >= 0 && rtStopIndex < stops.length) {
    const currentStopArriveMin = stops[rtStopIndex].arriveSec / 60
    rtDirectionStartMin = nowMinutes - currentStopArriveMin
  }

  const result: BusStopETA[] = []
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    const stop = busStopMap.get(s.stopId)
    if (!stop) continue

    const etaMin = rtDirectionStartMin != null
      ? (rtDirectionStartMin + s.arriveSec / 60) - nowMinutes
      : (s.arriveSec - dirSec) / 60

    let status: 'past' | 'dwelling' | 'arriving' | 'future'
    if (rtStopIndex !== undefined) {
      if (i < rtStopIndex) status = 'past'
      else if (i === rtStopIndex) status = 'dwelling'
      else if (i - rtStopIndex === 1) status = 'arriving'
      else status = 'future'
    } else if (dirSec >= s.arriveSec && dirSec <= s.departSec) status = 'dwelling'
    else if (etaMin > 0 && etaMin < 5) status = 'arriving'
    else if (etaMin >= 5) status = 'future'
    else status = 'past'

    result.push({
      stopId: s.stopId,
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

  const isSunBucket = clock.currentTime.getDay() === 0

  const busCtx = useMemo(() => {
    if (!vehicle || vehicle.type !== 'bus') return null
    const route = transitData.busRoutes.find(r => r.id === vehicle.lineId)
    if (!route) return null
    const schedule = getBusSchedule(route, busStopMap)
    if (!schedule) return null
    const cycleSec = computeBusCycleSec(vehicle.id, schedule, route, nowMinutesForETA, isSunBucket)
    const { dirSec, returning } = computeBusDirSec(cycleSec, schedule)
    const effectiveReturning = vehicle.rt ? vehicle.rt.dir === 1 : returning
    return { route, schedule, dirSec, returning: effectiveReturning }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, vehicle?.rt?.stopIndex, vehicle?.rt?.observedAt, vehicle?.rt?.dir, nowMinutesForETA, isSunBucket, busStopMap, transitData.busRoutes])
  const busETAs: BusStopETA[] = useMemo(() => {
    if (!vehicle || !busCtx) return []
    return computeBusStopETAs(vehicle, busCtx.schedule, busStopMap, busCtx.dirSec, busCtx.returning, nowMinutesForETA)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, busCtx, busStopMap, nowMinutesForETA, isSunBucket])

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
        dep: isLast ? t.terminalStop : formatMinutes(dep),
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
        dep: isLast ? t.terminalStop : etaStr,
        status: s.status,
        isLast,
      })
    })
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  // Center priority: dwelling > arriving > boundary between last past and first future
  const focusIdx = (() => {
    const dwellingIdx = rows.findIndex(r => r.status === 'dwelling')
    if (dwellingIdx >= 0) return dwellingIdx
    const arrivingIdx = rows.findIndex(r => r.status === 'arriving')
    if (arrivingIdx >= 0) return arrivingIdx
    const firstFuture = rows.findIndex(r => r.status === 'future')
    if (firstFuture > 0 && rows[firstFuture - 1].status === 'past') return firstFuture - 1
    return firstFuture
  })()
  const prevVehicleIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!vehicle || focusIdx < 0) return
    const isNewVehicle = prevVehicleIdRef.current !== vehicle.id
    prevVehicleIdRef.current = vehicle.id
    const el = scrollRef.current
    if (!el) return
    const targetRow = el.children[focusIdx] as HTMLElement | undefined
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
  }, [vehicle?.id, focusIdx])

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
    if (vehicle.rt && vehicle.rt.speed > 0) return vehicle.rt.speed
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
    if (vehicle.type === 'bus' && busCtx) {
      const { schedule, returning } = busCtx
      const stops = returning ? schedule.backwardStops : schedule.forwardStops

      let dirSec = busCtx.dirSec
      if (vehicle.rt) {
        const idx = vehicle.rt.stopIndex
        if (idx >= 0 && idx < stops.length) {
          dirSec = stops[idx].departSec + 0.5
        }
      }

      for (const s of stops) {
        if (dirSec >= s.arriveSec && dirSec <= s.departSec) return 0
      }

      let segStart = 0
      let segEnd = schedule.tripDurationSec
      let segProgressDelta = 1
      if (stops.length > 0) {
        if (dirSec < stops[0].arriveSec) {
          segEnd = stops[0].arriveSec
          segProgressDelta = Math.abs(stops[0].progress - (returning ? 1 : 0))
        } else if (dirSec > stops[stops.length - 1].departSec) {
          segStart = stops[stops.length - 1].departSec
          segProgressDelta = Math.abs((returning ? 0 : 1) - stops[stops.length - 1].progress)
        } else {
          for (let i = 0; i < stops.length - 1; i++) {
            if (dirSec > stops[i].departSec && dirSec < stops[i + 1].arriveSec) {
              segStart = stops[i].departSec
              segEnd = stops[i + 1].arriveSec
              segProgressDelta = Math.abs(stops[i + 1].progress - stops[i].progress)
              break
            }
          }
        }
      }
      const segDurSec = Math.max(0.001, segEnd - segStart)
      const segDistKm = segProgressDelta * schedule.totalLenKm
      const avgSpeed = (segDistKm / segDurSec) * 3600
      const t = Math.max(0, Math.min(1, (dirSec - segStart) / segDurSec))
      const approachSlowdown = t > 0.85 ? 1 - ((t - 0.85) / 0.15) * 0.7 : 1
      const departAccel = t < 0.15 ? 0.3 + (t / 0.15) * 0.7 : 1
      return Math.round(avgSpeed * approachSlowdown * departAccel)
    }
    return 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id, vehicle.type, vehicle.rt?.speed, vehicle.rt?.stopIndex, nowMinutes, trip, line, busCtx])

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
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
            <div className={`mm-han font-bold text-amber-100 truncate ${lang === 'zh' ? 'text-lg' : 'text-[15px]'}`}>
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
                        r.status === 'dwelling' ? 'text-amber-200 font-bold'
                          : r.status === 'arriving' ? 'text-white font-medium'
                          : r.status === 'future' ? (r.isLast ? 'text-white font-bold' : 'text-white/80')
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
