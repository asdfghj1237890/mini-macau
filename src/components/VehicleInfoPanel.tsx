import type { VehiclePosition, TransitData, SimulationClock, Trip, BusStop } from '../types'
import { useClockTime } from '../hooks/useSimulationClock'
import { useI18n, localName } from '../i18n'
import { useMemo, useRef, useEffect, useState, useId } from 'react'
import { CloseIcon } from './TransitIcons'
import {
  computeLRTVehicle,
  getLrtTripMinutes,
  getBusSchedule,
  getBusServiceBucket,
  computeBusCycleSec,
  computeBusDirSec,
  type BusSchedule,
} from '../engines/simulationEngine'
import { macauMinutesOfDay } from '../macauTime'
import { getLrtDepartureMinutes } from '../engines/lrtTimetable'
import { formatCountdown, lrtStopStatus, nextStopSummary, type TimedStop } from './vehiclePanelStatus'

interface Props {
  vehicle: VehiclePosition | null
  transitData: TransitData
  clock: SimulationClock
  onClose: () => void
}

// Inner props guarantee a non-null vehicle. The exported wrapper does the
// null check so every hook below runs unconditionally (React Rules of Hooks):
// the panel previously called useRef/useEffect/useMemo *after* an early
// `return null`, which is a latent crash if the selection toggles null↔set.
interface InnerProps extends Omit<Props, 'vehicle'> {
  vehicle: VehiclePosition
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
  departureMinutes: number
  status: 'past' | 'dwelling' | 'arriving' | 'future'
}

function computeBusStopETAs(
  schedule: BusSchedule,
  busStopMap: Map<string, BusStop>,
  dirSec: number,
  returning: boolean,
  nowMinutes: number,
): BusStopETA[] {
  const stops = returning ? schedule.backwardStops : schedule.forwardStops

  const result: BusStopETA[] = []
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    const stop = busStopMap.get(s.stopId)
    if (!stop) continue

    const etaMin = (s.arriveSec - dirSec) / 60

    let status: 'past' | 'dwelling' | 'arriving' | 'future'
    if (dirSec >= s.arriveSec && dirSec <= s.departSec) status = 'dwelling'
    else if (etaMin > 0 && etaMin < 5) status = 'arriving'
    else if (etaMin >= 5) status = 'future'
    else status = 'past'

    result.push({
      stopId: s.stopId,
      stopName: stop.name,
      stopNameCn: stop.nameCn,
      etaMinutes: nowMinutes + etaMin,
      departureMinutes: nowMinutes + (s.departSec - dirSec) / 60,
      status,
    })
  }
  return result
}

interface RowData extends TimedStop {
  key: string
  primary: string
  secondary: string
  arr: string
  dep: string
  status: 'past' | 'dwelling' | 'arriving' | 'future'
  isLast: boolean
}

function VehicleInfoPanelInner({ vehicle, transitData, clock, onClose }: InnerProps) {
  const { lang, t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const scheduleId = useId()

  // Selection is a snapshot, not a live speed source. Key lookup on its id
  // and derive current motion from the same engine/time as the map.
  const vehicleId = vehicle?.id
  const vehicleType = vehicle?.type

  const trip: Trip | undefined = useMemo(() => {
    if (vehicleType !== 'lrt' || vehicleId == null) return undefined
    return transitData.trips.find(tr => tr.id === vehicleId)
  }, [vehicleId, vehicleType, transitData.trips])

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

  // Only this mounted panel subscribes at ~10 Hz; App and map chrome keep
  // their existing cadence. Pauses, scrubs and speed changes use this clock.
  const now = useClockTime(clock)
  const nowMinutesForETA = macauMinutesOfDay(now)
  const serviceBucket = getBusServiceBucket(now)
  const liveLrt = useMemo(
    () => trip ? computeLRTVehicle(transitData, trip, now) : undefined,
    [transitData, trip, now],
  )

  const busCtx = useMemo(() => {
    if (!vehicle || vehicle.type !== 'bus') return null
    const route = transitData.busRoutes.find(r => r.id === vehicle.lineId)
    if (!route) return null
    const schedule = getBusSchedule(route, busStopMap)
    if (!schedule) return null
    const cycleSec = computeBusCycleSec(vehicle.id, schedule, route, nowMinutesForETA, serviceBucket)
    const { dirSec, returning } = computeBusDirSec(cycleSec, schedule)
    return { route, schedule, dirSec, returning }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, nowMinutesForETA, serviceBucket, busStopMap, transitData.busRoutes])
  const busETAs: BusStopETA[] = useMemo(() => {
    if (!vehicle || !busCtx) return []
    return computeBusStopETAs(busCtx.schedule, busStopMap, busCtx.dirSec, busCtx.returning, nowMinutesForETA)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, busCtx, busStopMap, nowMinutesForETA])

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
  const nowMinutes = trip ? getLrtTripMinutes(trip, nowMinutesForETA) : nowMinutesForETA

  // Build unified rows
  const rows: RowData[] = []
  if (trip) {
    trip.entries.forEach((entry, i) => {
      const s = stationMap.get(entry.stationId)
      const primary = s ? localName(lang, s) : entry.stationId
      const secondary = s ? (s.name !== primary ? s.name : '') : ''
      const arr = entry.arrivalMinutes
      const dep = getLrtDepartureMinutes(entry)
      const isFirst = i === 0
      const isLast = i === trip.entries.length - 1

      const status = lrtStopStatus(entry, nowMinutes)

      rows.push({
        key: entry.stationId,
        primary,
        secondary,
        arr: isFirst ? '—' : formatMinutes(arr),
        dep: isLast ? t.terminalStop : formatMinutes(dep),
        arrivalMinutes: arr,
        departureMinutes: dep,
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
        arrivalMinutes: s.etaMinutes,
        departureMinutes: s.departureMinutes,
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
    if (collapsed || vehicleId == null || focusIdx < 0) return
    const isNewVehicle = prevVehicleIdRef.current !== vehicleId
    prevVehicleIdRef.current = vehicleId
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
  }, [vehicleId, focusIdx, collapsed])

  // Find next destination (last entry for lrt, last future stop for bus)
  const destRow = trip
    ? rows[rows.length - 1]
    : rows.find(r => r.status === 'future' || r.status === 'arriving')
  const destName = destRow?.primary ?? ''

  const next = nextStopSummary(rows, nowMinutes, vehicle.type !== 'lrt' || liveLrt !== undefined)
  const nextRow = next ? rows[next.index] : undefined
  const nextETA = next ? formatCountdown(next.seconds) : '—'
  const nextSub = next?.phase ?? ''

  const speed = useMemo(() => {
    if (vehicle.type === 'lrt') return liveLrt?.lrtMotion?.speedKmh ?? null
    if (vehicle.type === 'bus' && busCtx) {
      const { schedule, returning } = busCtx
      const stops = returning ? schedule.backwardStops : schedule.forwardStops

      const dirSec = busCtx.dirSec

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
  }, [vehicle.id, vehicle.type, liveLrt, busCtx])

  return (
    <div className="mm-vehicle-panel absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }} data-collapsed={collapsed}>
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-fg)/10 rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className="flex items-stretch border-b border-(--mm-amber)/20">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-(--mm-fg)/10 max-w-[38%] min-w-0 shrink-0"
               style={{ backgroundColor: color + '22' }}>
            <div className="w-1 h-7 shrink-0" style={{ backgroundColor: color }} />
            <div className="min-w-0">
              <div className="mm-mono text-ui-11 max-sm:text-ui-9 tracking-[0.25em] text-(--mm-text-secondary)">LINE</div>
              <div title={lineLabel} className={`mm-han font-bold text-(--mm-fg) leading-tight truncate ${lang === 'zh' ? 'text-ui-16' : 'text-ui-14'}`}>{lineLabel}</div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="mm-mono text-ui-11 max-sm:text-ui-9 tracking-[0.25em] text-(--mm-text-accent) flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-(--mm-amber) mm-led-pulse" />
              <span className="truncate">{t.towards.toUpperCase()}<span className="max-sm:hidden"> · BOUND FOR</span></span>
            </div>
            <div title={destName} className={`mm-han font-bold text-(--mm-amber-1) truncate ${lang === 'zh' ? 'text-lg' : 'text-ui-15'}`}>
              {destName}
            </div>
          </div>
          <div className="flex shrink-0 items-center border-l border-(--mm-fg)/10">
            <button type="button" onClick={() => setCollapsed(value => !value)}
              className="flex items-center justify-center w-9 min-h-11 text-(--mm-text-muted) hover:text-(--mm-fg) hover:bg-(--mm-fg)/5
                         focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--mm-amber)"
              aria-label={`${collapsed ? t.expand : t.collapse} ${t.schedule}`}
              title={`${collapsed ? t.expand : t.collapse} ${t.schedule}`}
              aria-expanded={!collapsed} aria-controls={scheduleId}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d={collapsed ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
              </svg>
            </button>
            <button type="button" onClick={onClose}
              className="flex items-center justify-center w-9 min-h-11 text-(--mm-text-muted) hover:text-(--mm-fg) hover:bg-(--mm-fg)/5
                         focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--mm-amber)"
              aria-label="Close">
              <CloseIcon size={18} />
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 border-b border-(--mm-fg)/8 bg-(--mm-fg)/[0.02]">
          <div className="px-3 py-1.5 border-r border-(--mm-fg)/8">
            <div className="mm-mono text-ui-10 max-sm:text-ui-8 tracking-[0.25em] text-(--mm-text-muted)">SPEED</div>
            <div className="flex items-baseline gap-1">
              <span className="mm-mono mm-tabular text-ui-16 font-bold text-(--mm-fg)/90 leading-tight">{speed === null ? '—' : vehicle.type === 'lrt' ? speed.toFixed(1) : speed}</span>
              <span className="mm-mono text-ui-11 text-(--mm-text-muted)">km/h</span>
            </div>
          </div>
          <div className="px-3 py-1.5 min-w-0" title={nextRow?.primary}>
            <div className="flex items-center gap-2 mm-mono text-ui-10 max-sm:text-ui-8 tracking-[0.25em] text-(--mm-text-muted)">
              <span>NEXT</span>
              {collapsed && <span className="truncate tracking-normal mm-han">{nextRow?.primary}</span>}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="mm-mono mm-tabular text-ui-17 font-bold text-(--mm-amber-1) leading-tight">{nextETA}</span>
              <span className="mm-mono text-ui-11 text-(--mm-text-muted)">{nextSub}</span>
            </div>
          </div>
        </div>

        <div id={scheduleId} hidden={collapsed}>
          {/* Unmount the long list while collapsed; the live summary above keeps updating. */}
          {!collapsed && rows.length > 0 && (
            <>
              <div className="grid grid-cols-[16px_1fr_54px_54px] gap-0 px-3 py-1.5
                              border-b border-(--mm-fg)/5 bg-(--mm-fg)/[0.015]">
                <span />
                <span className="mm-mono text-ui-10 max-sm:text-ui-8 tracking-[0.25em] text-(--mm-text-muted)">STATION · 車站</span>
                <span className="mm-mono text-ui-10 max-sm:text-ui-8 tracking-[0.25em] text-(--mm-text-muted) text-right">ARR</span>
                <span className="mm-mono text-ui-10 max-sm:text-ui-8 tracking-[0.25em] text-(--mm-text-muted) text-right">DEP</span>
              </div>
              <div ref={scrollRef} className="max-h-[45vh] overflow-y-auto max-sm:max-h-[30vh]">
                {rows.map((r, i) => {
                  const isFirstRow = i === 0
                  const isLastRow = i === rows.length - 1
                  const railColor = r.status === 'past' ? 'color-mix(in srgb, var(--mm-fg) 15%, transparent)' : color + '88'
                  return (
                    <div
                      key={r.key}
                      className={`grid grid-cols-[16px_1fr_54px_54px] items-center px-3 py-1.5
                                  border-b border-(--mm-fg)/5 last:border-b-0
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
                          <div className="w-2.5 h-2.5 rounded-full bg-(--mm-amber) relative z-10 mm-led-pulse"
                               style={{ boxShadow: '0 0 6px color-mix(in srgb, var(--mm-amber) 80%, transparent)' }} />
                        ) : r.status === 'arriving' ? (
                          <div className="w-2.5 h-2.5 rounded-full border-2 border-(--mm-amber) bg-(--mm-panel) relative z-10" />
                        ) : r.status === 'past' ? (
                          <div className="w-1.5 h-1.5 rounded-full bg-(--mm-fg)/30 relative z-10" />
                        ) : (
                          <div className="w-2 h-2 rounded-full border-2 relative z-10"
                               style={{ borderColor: color, backgroundColor: 'var(--mm-panel)' }} />
                        )}
                      </div>
                      {/* Station */}
                      <div className="flex flex-col min-w-0">
                        <span className={`mm-han truncate ${lang === 'zh' ? 'text-ui-14' : 'text-ui-12'} ${
                          r.status === 'dwelling' ? 'text-(--mm-amber-1) font-bold'
                            : r.status === 'arriving' ? 'text-(--mm-fg) font-medium'
                            : r.status === 'future' ? (r.isLast ? 'text-(--mm-fg) font-bold' : 'text-(--mm-fg)/80')
                            : 'text-(--mm-text-secondary)'
                        }`}>{r.primary}</span>
                        {r.secondary && (
                          <span className="mm-mono text-ui-9 text-(--mm-text-subtle) tracking-wide truncate">{r.secondary}</span>
                        )}
                      </div>
                      {/* ARR */}
                      <span className={`mm-mono mm-tabular text-ui-13 text-right ${
                        r.status === 'dwelling' ? 'text-(--mm-amber-1)'
                          : r.status === 'past' ? 'text-(--mm-fg)/25 line-through'
                          : 'text-(--mm-fg)/65'
                      }`}>{r.arr}</span>
                      {/* DEP */}
                      <span className={`mm-mono mm-tabular text-ui-13 text-right ${
                        r.status === 'dwelling' ? 'text-(--mm-amber)'
                          : r.status === 'past' ? 'text-(--mm-fg)/25 line-through'
                          : 'text-(--mm-text-secondary)'
                      }`}>{r.dep}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Footer */}
          {!collapsed && <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between">
            <span className="mm-mono text-ui-10 tracking-[0.25em] text-(--mm-text-muted) uppercase">{t.schedule}</span>
            <span className="mm-mono text-ui-11 text-(--mm-emerald)/80 flex items-center gap-1.5 tracking-wider">
              <span className="w-1 h-1 rounded-full bg-(--mm-emerald-2) mm-led-pulse" />ON TIME
            </span>
          </div>}
        </div>
      </div>
    </div>
  )
}

export function VehicleInfoPanel(props: Props) {
  // Thin wrapper: bail before any hook runs when there's no selection.
  if (!props.vehicle) return null
  return <VehicleInfoPanelInner key={props.vehicle.id} {...props} vehicle={props.vehicle} />
}
