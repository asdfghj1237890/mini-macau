import { useState, useRef, useEffect, useCallback } from 'react'
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
const WEEKDAY_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function pad2(n: number) { return String(n).padStart(2, '0') }

function toLocalDatetimeStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function TimeDisplay({ clock, vehicleCount }: Props) {
  const { lang, t } = useI18n()
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
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

  const handleOpen = useCallback(() => {
    setEditing(true)
  }, [])

  const handleApply = useCallback(() => {
    if (inputRef.current?.value) {
      const newDate = new Date(inputRef.current.value)
      if (!isNaN(newDate.getTime())) {
        clock.setTime(newDate)
      }
    }
    setEditing(false)
  }, [clock])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleApply()
    if (e.key === 'Escape') setEditing(false)
  }, [handleApply])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.value = toLocalDatetimeStr(time)
      inputRef.current.focus()
    }
  }, [editing])

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm z-10
                    rounded-xl px-5 py-2 border border-white/20 text-center">
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="datetime-local"
            onKeyDown={handleKeyDown}
            className="bg-white/10 text-white font-mono text-sm rounded px-2 py-1
                       border border-white/30 outline-none focus:border-blue-400
                       [color-scheme:dark]"
          />
          <button
            onClick={handleApply}
            className="text-blue-400 hover:text-blue-300 text-sm font-semibold px-1"
          >
            ✓
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-white/40 hover:text-white text-sm px-1"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={handleOpen}
          className="text-white font-mono font-bold tracking-wider text-lg
                     hover:text-blue-300 transition-colors cursor-pointer"
          title={t.clickToSetTime}
        >
          <span className="text-white/60">{y}/{pad2(mo)}/{pad2(d)}</span>
          {' '}
          <span className="text-white/40">{dow}</span>
          {' '}
          <span>{h}:{m}:{s}</span>
        </button>
      )}

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
