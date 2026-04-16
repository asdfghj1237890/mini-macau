import type { SimulationClock } from '../types'
import { useI18n } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'

interface Props {
  clock: SimulationClock
  vehicleCount?: number
}

const SCHEDULE_LABELS = {
  mon_thu: 'scheduleMonThu',
  friday: 'scheduleFriday',
  sat_sun: 'scheduleSatSun',
} as const

const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六']

function formatDate(date: Date, lang: string): string {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()
  const dow = lang === 'zh'
    ? `週${WEEKDAY_ZH[date.getDay()]}`
    : WEEKDAY_EN[date.getDay()]
  if (lang === 'zh') return `${y}/${m}/${d} ${dow}`
  return `${y}/${m}/${d} ${dow}`
}

export function TimeDisplay({ clock, vehicleCount }: Props) {
  const { lang, t } = useI18n()
  const time = clock.currentTime
  const h = String(time.getHours()).padStart(2, '0')
  const m = String(time.getMinutes()).padStart(2, '0')
  const s = String(time.getSeconds()).padStart(2, '0')
  const scheduleLabel = t[SCHEDULE_LABELS[getScheduleType(time)]]

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm z-10
                    rounded-xl px-5 py-2 border border-white/20 text-center">
      <div className="text-white/50 text-xs">{formatDate(time, lang)}</div>
      <div className="text-white text-2xl font-mono font-bold tracking-wider">
        {h}:{m}:{s}
      </div>
      <div className="flex items-center justify-center gap-3 text-xs mt-0.5">
        <span className="text-amber-300/80">{scheduleLabel}</span>
        {clock.speed !== 1 && (
          <span className="text-white/60">{clock.speed}x</span>
        )}
        {vehicleCount !== undefined && vehicleCount > 0 && (
          <span className="text-white/40">{t.vehicles(vehicleCount)}</span>
        )}
      </div>
    </div>
  )
}
