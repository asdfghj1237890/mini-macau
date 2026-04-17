import { useState, useCallback } from 'react'
import type { SimulationClock } from '../types'
import { useI18n } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'
import { DateTimePicker } from './DateTimePicker'

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
const WEEKDAY_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function pad2(n: number) { return String(n).padStart(2, '0') }

export function TimeDisplay({ clock, vehicleCount }: Props) {
  const { lang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const time = clock.currentTime

  const y = time.getFullYear()
  const mo = time.getMonth() + 1
  const d = time.getDate()
  const dow = lang === 'zh'
    ? `週${WEEKDAY_ZH[time.getDay()]}`
    : lang === 'pt'
      ? WEEKDAY_PT[time.getDay()]
      : WEEKDAY_EN[time.getDay()]

  const h = pad2(time.getHours())
  const m = pad2(time.getMinutes())
  const s = pad2(time.getSeconds())
  const scheduleLabel = t[SCHEDULE_LABELS[getScheduleType(time)]]

  const handleApply = useCallback((newDate: Date) => {
    clock.setTime(newDate)
    setOpen(false)
  }, [clock])

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center
                    max-sm:top-2 landscape:top-2">
      <div className="bg-black/70 backdrop-blur-sm rounded-xl px-5 py-2
                      border border-white/20 text-center
                      max-sm:px-3 max-sm:py-1.5 landscape:px-3 landscape:py-1">
        <button
          onClick={() => setOpen(prev => !prev)}
          className="text-white font-mono font-bold tracking-wider text-lg
                     max-sm:text-sm landscape:text-sm
                     hover:text-blue-300 transition-colors cursor-pointer"
          title={t.clickToSetTime}
        >
          <span className="text-white/60">{y}/{pad2(mo)}/{pad2(d)}</span>
          {' '}
          <span className="text-white/40">{dow}</span>
          {' '}
          <span>{h}:{m}:{s}</span>
        </button>

        <div className="flex items-center justify-center gap-3 text-xs mt-0.5
                        max-sm:gap-2 max-sm:text-[10px] landscape:text-[10px]">
          <span className="text-amber-300/80">{scheduleLabel}</span>
          {clock.speed !== 1 && (
            <span className="text-white/60">{clock.speed}x</span>
          )}
          {vehicleCount !== undefined && vehicleCount > 0 && (
            <span className="text-white/40">{t.vehicles(vehicleCount)}</span>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-2">
          <DateTimePicker
            value={time}
            onApply={handleApply}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
