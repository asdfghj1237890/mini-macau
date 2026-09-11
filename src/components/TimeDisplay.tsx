import { useState, useCallback, useRef } from 'react'
import type { SimulationClock } from '../types'
import { useClockTime } from '../hooks/useSimulationClock'
import { useI18n } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'
import { macauParts } from '../macauTime'
import { DateTimePicker } from './DateTimePicker'
import './mapChrome.css'

interface Props {
  clock: SimulationClock
  vehicleCount?: number
}

const WEEKDAYS = {
  en: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  pt: ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'],
}

function pad2(n: number) { return String(n).padStart(2, '0') }

export function TimeDisplay({ clock, vehicleCount }: Props) {
  const { lang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const phoneRef = useRef<HTMLButtonElement>(null)
  const deskRef = useRef<HTMLButtonElement>(null)
  // Seconds stay in this small component; the rest of the chrome subscribes by minute.
  const parts = macauParts(useClockTime(clock))
  const time = clock.timeRef.current
  const dow = WEEKDAYS[lang][parts.weekday]
  const h = pad2(parts.hours)
  const m = pad2(parts.minutes)
  const s = pad2(parts.seconds)
  const schedule = getScheduleType(time)
  const scheduleLabel = t[schedule === 'mon_thu' ? 'scheduleMonThu' : schedule === 'friday' ? 'scheduleFriday' : 'scheduleSatSun']
  const status = clock.paused ? t.pause : clock.isLive ? t.live : t.simShort

  const handleApply = useCallback((newDate: Date) => {
    clock.setTime(newDate)
    setOpen(false)
  }, [clock])

  return (
    <>
      <button ref={phoneRef} type="button" className="mm-clock-compact"
        onClick={() => setOpen(p => !p)} title={t.clickToSetTime}
        aria-label={t.clickToSetTime} aria-expanded={open}>
        <span className="mm-clock-compact-date mm-mono">
          <span>{pad2(parts.month + 1)} / {pad2(parts.day)}</span><span>{dow}</span>
        </span>
        <span className="mm-clock-compact-time mm-mono mm-tabular">
          {h}<span>:</span>{m}<small>{s}</small>
        </span>
        <span className="mm-clock-status-dot" data-live={clock.isLive} aria-label={status} />
      </button>

      <button ref={deskRef} type="button" className="mm-clock-card"
        onClick={() => setOpen(p => !p)} title={t.clickToSetTime}
        aria-label={t.clickToSetTime} aria-expanded={open}>
        <span className="mm-clock-topline">
          <span className="mm-clock-location mm-mono">MACAU <span>UTC+8</span></span>
          <span className="mm-clock-status" data-live={clock.isLive}>
            <span className="mm-clock-status-dot" data-live={clock.isLive} />{status}
          </span>
        </span>
        <span className="mm-clock-face mm-mono mm-tabular">
          <span>{h}<span className="mm-clock-colon">:</span>{m}</span>
          <span className="mm-clock-seconds"><span>{s}</span><small>{clock.speed !== 1 ? `${clock.speed}×` : t.sec}</small></span>
        </span>
        <span className="mm-clock-date mm-mono">
          {parts.year}.{pad2(parts.month + 1)}.{pad2(parts.day)}<span>{lang === 'zh' ? `週${dow}` : dow}</span>
        </span>
        <span className="mm-clock-footer">
          <span>{scheduleLabel}</span>
          {vehicleCount !== undefined && vehicleCount > 0 && (
            <span className="mm-clock-vehicles"><span className="mm-mono mm-tabular">{vehicleCount}</span>{t.vehicleUnit}</span>
          )}
        </span>
      </button>

      {open && (
        <DateTimePicker value={time} onApply={handleApply} onCancel={() => setOpen(false)}
          anchorRef={typeof window !== 'undefined' && window.matchMedia('(max-width: 1099px), (max-height: 500px)').matches ? phoneRef : deskRef} />
      )}
    </>
  )
}
