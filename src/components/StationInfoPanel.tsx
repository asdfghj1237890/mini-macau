import type { Station, TransitData, SimulationClock, ScheduleType } from '../types'
import { useI18n } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'

interface Props {
  station: Station | null
  transitData: TransitData
  clock: SimulationClock
  onClose: () => void
}

function getNextArrivals(
  stationId: string,
  transitData: TransitData,
  currentMinutes: number,
  scheduleType: ScheduleType,
  count: number = 5
): { tripId: string; lineName: string; lineCn: string; lineColor: string; arrivalMinutes: number; direction: string }[] {
  const arrivals: { tripId: string; lineName: string; lineCn: string; lineColor: string; arrivalMinutes: number; direction: string }[] = []

  for (const trip of transitData.trips) {
    if (trip.scheduleType && trip.scheduleType !== scheduleType) continue
    const line = transitData.lrtLines.find(l => l.id === trip.lineId)
    if (!line) continue

    for (const entry of trip.entries) {
      if (entry.stationId === stationId && entry.arrivalMinutes > currentMinutes) {
        arrivals.push({
          tripId: trip.id,
          lineName: line.name,
          lineCn: line.nameCn,
          lineColor: line.color,
          arrivalMinutes: entry.arrivalMinutes,
          direction: trip.direction === 'forward' ? '→' : '←',
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

  const lineColors = station.lineIds.map(lid =>
    transitData.lrtLines.find(l => l.id === lid)?.color ?? '#888'
  )

  const stationName = lang === 'zh' ? station.nameCn : station.name
  const subName = lang === 'zh'
    ? `${station.name} / ${station.namePt}`
    : `${station.nameCn} / ${station.namePt}`

  return (
    <div className="absolute top-20 left-4 bg-black/80 backdrop-blur-sm rounded-xl z-10
                    px-4 py-3 border border-white/20 min-w-[220px] max-w-[300px]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            {lineColors.map((c, i) => (
              <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
            ))}
            <span className="text-white font-semibold text-sm">{stationName}</span>
          </div>
          <div className="text-white/50 text-xs mt-0.5">{subName}</div>
        </div>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-sm transition-colors"
        >
          ✕
        </button>
      </div>

      {arrivals.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/10">
          <div className="text-white/50 text-xs mb-1.5">{t.nextArrivals}</div>
          <div className="space-y-1">
            {arrivals.map((a, i) => {
              const waitMin = Math.round(a.arrivalMinutes - nowMinutes)
              const displayName = lang === 'zh' ? a.lineCn : a.lineName
              return (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: a.lineColor }} />
                    <span className="text-white/80">{displayName}</span>
                    <span className="text-white/40">{a.direction}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-white font-mono">{minutesToTimeStr(a.arrivalMinutes)}</span>
                    <span className="text-white/40 ml-1">({waitMin}m)</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {station.lineIds.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/10">
          <div className="text-white/50 text-xs">
            {t.lines}: {station.lineIds.map(lid => {
              const line = transitData.lrtLines.find(l => l.id === lid)
              return lang === 'zh' ? line?.nameCn : line?.name
            }).filter(Boolean).join(', ')}
          </div>
        </div>
      )}
    </div>
  )
}
