import type { Station, TransitData, SimulationClock, ScheduleType } from '../types'
import { useMemo } from 'react'
import { useClockTime } from '../hooks/useSimulationClock'
import { useI18n, localName } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'
import { getLrtDepartureMinutes } from '../engines/lrtTimetable'
import { macauMinutesOfDay } from '../macauTime'

interface Props {
  station: Station | null
  transitData: TransitData
  clock: SimulationClock
  onClose: () => void
}

interface Arrival {
  tripId: string
  lineName: string
  lineCn: string
  linePt: string
  lineColor: string
  arrivalMinutes: number
  departureMinutes: number
  effectiveMinutes: number
  destName: string
  destNameCn: string
  destNamePt: string
}

function getNextArrivals(
  stationId: string,
  transitData: TransitData,
  currentMinutes: number,
  scheduleType: ScheduleType,
  previousScheduleType: ScheduleType,
  count: number = 6,
): Arrival[] {
  const arrivals: Arrival[] = []
  const stationMap = new Map(transitData.stations.map(s => [s.id, s]))

  for (const trip of transitData.trips) {
    if (trip.scheduleType && trip.scheduleType !== scheduleType && trip.scheduleType !== previousScheduleType) continue
    const line = transitData.lrtLines.find(l => l.id === trip.lineId)
    if (!line) continue

    for (const entry of trip.entries) {
      if (entry.stationId !== stationId) continue
      const dep = getLrtDepartureMinutes(entry)

      let effective = currentMinutes
      const previousService = (!trip.scheduleType || trip.scheduleType === previousScheduleType)
        && dep >= 1440 && currentMinutes + 1440 <= dep
      if (previousService) {
        effective = currentMinutes + 1440
      } else if (trip.scheduleType && trip.scheduleType !== scheduleType) continue

      const atStation = effective >= entry.arrivalMinutes && effective <= dep
      const upcoming = entry.arrivalMinutes > effective

      if (atStation || upcoming) {
        const destEntry = trip.entries[trip.entries.length - 1]
        const destStation = stationMap.get(destEntry.stationId)
        arrivals.push({
          tripId: trip.id,
          lineName: line.name,
          lineCn: line.nameCn,
          linePt: line.name,
          lineColor: line.color,
          arrivalMinutes: entry.arrivalMinutes,
          departureMinutes: dep,
          effectiveMinutes: effective,
          destName: destStation?.name ?? destEntry.stationId,
          destNameCn: destStation?.nameCn ?? '',
          destNamePt: destStation?.namePt ?? '',
        })
        break
      }
    }
  }

  arrivals.sort((a, b) => (a.arrivalMinutes - a.effectiveMinutes) - (b.arrivalMinutes - b.effectiveMinutes))
  return arrivals.slice(0, count)
}

function minutesToTimeStr(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = Math.floor(minutes % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function StationInfoPanel({ station, transitData, clock, onClose }: Props) {
  const { lang, t } = useI18n()
  const now = useClockTime(clock)
  const nowMinutes = Math.floor(macauMinutesOfDay(now) * 60) / 60
  const scheduleType = getScheduleType(now)
  const previousScheduleType = getScheduleType(new Date(now.getTime() - 86400000))
  const stationId = station?.id
  // Index this station once; only its candidate trips need reevaluating as
  // the clock advances. Dwell status updates each second, including scrubs.
  const stationData = useMemo(() => ({ ...transitData, trips: transitData.trips.filter(trip =>
    trip.entries.some(entry => entry.stationId === stationId),
  ) }), [transitData, stationId])
  const arrivals = useMemo(() => stationId
    ? getNextArrivals(stationId, stationData, nowMinutes, scheduleType, previousScheduleType) : [],
  [stationId, stationData, nowMinutes, scheduleType, previousScheduleType])

  if (!station) return null

  const stationName = localName(lang, station)
  const stationSub = lang === 'zh'
    ? (station.name && station.name !== stationName ? station.name : '')
    : (station.nameCn && station.nameCn !== stationName ? station.nameCn : '')

  const stationLines = station.lineIds
    .map(lid => transitData.lrtLines.find(l => l.id === lid))
    .filter((l): l is NonNullable<typeof l> => !!l)

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-fg)/10 rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) overflow-hidden mm-fade">
        {/* Header */}
        <div className="px-3 py-2 border-b border-(--mm-amber)/20 flex items-stretch">
          <div className="flex-1 min-w-0">
            <div className="mm-mono text-ui-11 max-sm:text-ui-9 tracking-[0.25em] text-(--mm-text-accent) mb-0.5">
              STATION · 車站
            </div>
            <div className="mm-han text-lg font-bold text-(--mm-fg) truncate">
              {stationName}
              {stationSub && (
                <span className="text-(--mm-text-secondary) font-normal text-ui-16 ml-1.5">{stationSub}</span>
              )}
            </div>
            {stationLines.length > 0 && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {stationLines.map(line => (
                  <div
                    key={line.id}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm border"
                    style={{ borderColor: line.color + '55', backgroundColor: line.color + '18' }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: line.color }} />
                    <span className="mm-mono text-ui-11" style={{ color: line.color }}>
                      {localName(lang, line)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="self-start text-(--mm-text-muted) hover:text-(--mm-fg) mm-mono text-ui-16 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {arrivals.length > 0 ? (
          <>
            {/* Table header */}
            <div className="grid grid-cols-[8px_1fr_46px_42px_44px] gap-0 px-3 py-1.5
                            border-b border-(--mm-fg)/5 bg-(--mm-fg)/[0.015]">
              <span />
              <span className="mm-mono text-ui-10 max-sm:text-ui-8 tracking-[0.25em] text-(--mm-text-muted)">DEST · 方向</span>
              <span className="mm-mono text-ui-10 max-sm:text-ui-8 tracking-[0.25em] text-(--mm-text-muted) text-right">ETA</span>
              <span className="mm-mono text-ui-10 max-sm:text-ui-8 tracking-[0.25em] text-(--mm-text-muted) text-right">MIN</span>
              <span className="mm-mono text-ui-10 max-sm:text-ui-8 tracking-[0.25em] text-(--mm-text-muted) text-right">STATUS</span>
            </div>

            <div className="max-h-[45vh] overflow-y-auto max-sm:max-h-[30vh]">
              {arrivals.map((a, i) => {
                const effective = a.effectiveMinutes
                const atStation = effective >= a.arrivalMinutes && effective <= a.departureMinutes
                const waitMin = atStation ? 0 : Math.max(0, Math.round(a.arrivalMinutes - effective))
                const isFirst = i === 0
                const destLabel = localName(lang, {
                  name: a.destName,
                  nameCn: a.destNameCn,
                  namePt: a.destNamePt,
                })
                const statusLabel = atStation ? '到站中'
                  : waitMin <= 1 ? '即將到站'
                  : waitMin <= 3 ? '接近中'
                  : '等候中'
                const statusColor = atStation ? 'text-(--mm-amber) mm-led-pulse'
                  : waitMin <= 1 ? 'text-(--mm-amber)'
                  : waitMin <= 3 ? 'text-(--mm-emerald)/70'
                  : 'text-(--mm-text-muted)'
                return (
                  <div
                    key={`${a.tripId}-${i}`}
                    className="grid grid-cols-[8px_1fr_46px_42px_44px] items-center px-3 py-1.5
                               border-b border-(--mm-fg)/5 last:border-b-0"
                  >
                    <div className="w-2 h-5 rounded-sm" style={{ backgroundColor: a.lineColor }} />
                    <div className="pl-2 flex items-center gap-1.5 min-w-0">
                      <span className="mm-han text-ui-13 text-(--mm-fg)/90 truncate">{destLabel}</span>
                    </div>
                    <span className={`mm-mono mm-tabular text-ui-13 text-right ${
                      isFirst ? 'text-(--mm-amber-1)' : 'text-(--mm-fg)/70'
                    }`}>
                      {minutesToTimeStr(a.arrivalMinutes)}
                    </span>
                    <span className={`mm-mono mm-tabular text-right font-bold ${
                      atStation
                        ? 'text-(--mm-amber-1) text-ui-17 mm-led-pulse'
                        : isFirst ? 'text-(--mm-amber-1) text-ui-15' : 'text-(--mm-text-secondary) text-ui-13'
                    }`}>
                      {atStation ? '⬤' : waitMin}
                    </span>
                    <span className={`mm-mono text-ui-10 text-right tracking-wider ${statusColor}`}>
                      {statusLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="px-3 py-4 text-center mm-mono text-ui-12 tracking-wider text-(--mm-text-muted)">
            — NO SERVICE —
          </div>
        )}

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between">
          <span className="mm-mono text-ui-10 tracking-[0.25em] text-(--mm-text-muted) uppercase">
            {t.nextArrivals} · 下一班
          </span>
          <span className="mm-mono text-ui-11 text-(--mm-amber)/80 flex items-center gap-1.5 tracking-wider">
            <span className="w-1 h-1 rounded-full bg-(--mm-amber) mm-led-pulse" />LIVE
          </span>
        </div>
      </div>
    </div>
  )
}
