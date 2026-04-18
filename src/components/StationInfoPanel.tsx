import type { Station, TransitData, SimulationClock, ScheduleType } from '../types'
import { useI18n, localName } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'

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
  destName: string
  destNameCn: string
  destNamePt: string
}

function getNextArrivals(
  stationId: string,
  transitData: TransitData,
  currentMinutes: number,
  scheduleType: ScheduleType,
  count: number = 6,
): Arrival[] {
  const arrivals: Arrival[] = []
  const stationMap = new Map(transitData.stations.map(s => [s.id, s]))

  for (const trip of transitData.trips) {
    if (trip.scheduleType && trip.scheduleType !== scheduleType) continue
    const line = transitData.lrtLines.find(l => l.id === trip.lineId)
    if (!line) continue

    for (const entry of trip.entries) {
      if (entry.stationId !== stationId) continue
      const dep = entry.departureMinutes ?? entry.arrivalMinutes

      let effective = currentMinutes
      if (currentMinutes < entry.arrivalMinutes && currentMinutes + 1440 <= dep) {
        effective = currentMinutes + 1440
      }

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
          destName: destStation?.name ?? destEntry.stationId,
          destNameCn: destStation?.nameCn ?? '',
          destNamePt: destStation?.namePt ?? '',
        })
        break
      }
    }
  }

  arrivals.sort((a, b) => a.arrivalMinutes - b.arrivalMinutes)
  return arrivals.slice(0, count)
}

function minutesToTimeStr(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = Math.floor(minutes % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function StationInfoPanel({ station, transitData, clock, onClose }: Props) {
  const { lang, t } = useI18n()

  if (!station) return null

  const nowMinutes = clock.currentTime.getHours() * 60 +
    clock.currentTime.getMinutes() +
    clock.currentTime.getSeconds() / 60

  const scheduleType = getScheduleType(clock.currentTime)
  const arrivals = getNextArrivals(station.id, transitData, nowMinutes, scheduleType)

  const stationName = localName(lang, station)
  const stationSub = lang === 'zh'
    ? (station.name && station.name !== stationName ? station.name : '')
    : (station.nameCn && station.nameCn !== stationName ? station.nameCn : '')

  const stationLines = station.lineIds
    .map(lid => transitData.lrtLines.find(l => l.id === lid))
    .filter((l): l is NonNullable<typeof l> => !!l)

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[72px] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                      shadow-2xl shadow-black/60 overflow-hidden mm-fade">
        {/* Header */}
        <div className="px-3 py-2 border-b border-amber-300/20 flex items-stretch">
          <div className="flex-1 min-w-0">
            <div className="mm-mono text-[11px] tracking-[0.25em] text-amber-300/70 mb-0.5">
              STATION · 車站
            </div>
            <div className="mm-han text-lg font-bold text-white truncate">
              {stationName}
              {stationSub && (
                <span className="text-white/50 font-normal text-[16px] ml-1.5">{stationSub}</span>
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
                    <span className="mm-mono text-[11px]" style={{ color: line.color }}>
                      {localName(lang, line)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="self-start text-white/40 hover:text-white mm-mono text-[16px] transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {arrivals.length > 0 ? (
          <>
            {/* Table header */}
            <div className="grid grid-cols-[8px_1fr_46px_42px_44px] gap-0 px-3 py-1.5
                            border-b border-white/5 bg-white/[0.015]">
              <span />
              <span className="mm-mono text-[10px] tracking-[0.25em] text-white/35">DEST · 方向</span>
              <span className="mm-mono text-[10px] tracking-[0.25em] text-white/35 text-right">ETA</span>
              <span className="mm-mono text-[10px] tracking-[0.25em] text-white/35 text-right">MIN</span>
              <span className="mm-mono text-[10px] tracking-[0.25em] text-white/35 text-right">STATUS</span>
            </div>

            <div className="max-h-[45vh] overflow-y-auto max-sm:max-h-[30vh]">
              {arrivals.map((a, i) => {
                let effective = nowMinutes
                if (nowMinutes < a.arrivalMinutes && nowMinutes + 1440 <= a.departureMinutes) {
                  effective = nowMinutes + 1440
                }
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
                const statusColor = atStation ? 'text-amber-300 mm-led-pulse'
                  : waitMin <= 1 ? 'text-amber-300'
                  : waitMin <= 3 ? 'text-emerald-300/70'
                  : 'text-white/35'
                return (
                  <div
                    key={`${a.tripId}-${i}`}
                    className="grid grid-cols-[8px_1fr_46px_42px_44px] items-center px-3 py-1.5
                               border-b border-white/5 last:border-b-0"
                  >
                    <div className="w-2 h-5 rounded-sm" style={{ backgroundColor: a.lineColor }} />
                    <div className="pl-2 flex items-center gap-1.5 min-w-0">
                      <span className="mm-han text-[13px] text-white/90 truncate">{destLabel}</span>
                    </div>
                    <span className={`mm-mono mm-tabular text-[13px] text-right ${
                      isFirst ? 'text-amber-200' : 'text-white/70'
                    }`}>
                      {minutesToTimeStr(a.arrivalMinutes)}
                    </span>
                    <span className={`mm-mono mm-tabular text-right font-bold ${
                      atStation
                        ? 'text-amber-200 text-[17px] mm-led-pulse'
                        : isFirst ? 'text-amber-200 text-[15px]' : 'text-white/60 text-[13px]'
                    }`}>
                      {atStation ? '⬤' : waitMin}
                    </span>
                    <span className={`mm-mono text-[10px] text-right tracking-wider ${statusColor}`}>
                      {statusLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="px-3 py-4 text-center mm-mono text-[12px] tracking-wider text-white/35">
            — NO SERVICE —
          </div>
        )}

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-white/8 bg-white/[0.02] flex items-center justify-between">
          <span className="mm-mono text-[10px] tracking-[0.25em] text-white/35 uppercase">
            {t.nextArrivals} · 下一班
          </span>
          <span className="mm-mono text-[11px] text-amber-300/80 flex items-center gap-1.5 tracking-wider">
            <span className="w-1 h-1 rounded-full bg-amber-300 mm-led-pulse" />LIVE
          </span>
        </div>
      </div>
    </div>
  )
}
