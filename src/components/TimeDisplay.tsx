import { useState, useCallback, useRef } from 'react'
import type { SimulationClock } from '../types'
import { useClockTime } from '../hooks/useSimulationClock'
import { useI18n } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'
import { macauParts } from '../macauTime'
import { DateTimePicker } from './DateTimePicker'

interface Props {
  clock: SimulationClock
  vehicleCount?: number
}

const SCHEDULE_EN = {
  mon_thu: 'MON–THU',
  friday: 'FRIDAY',
  sat_sun: 'SAT–SUN',
} as const

const WEEKDAY_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAY_PT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
const ZH_WEEKDAY_PREFIX = '週'

function pad2(n: number) { return String(n).padStart(2, '0') }

export function TimeDisplay({ clock, vehicleCount }: Props) {
  const { lang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const phoneRef = useRef<HTMLButtonElement>(null)
  const deskRef = useRef<HTMLButtonElement>(null)
  // This component is the one place the seconds are shown, so it is the one
  // place that re-renders on every clock tick.
  const time = useClockTime(clock)
  const parts = macauParts(time)

  const yr = parts.year
  const mo = parts.month + 1
  const d = parts.day
  const dow = lang === 'zh'
    ? `${ZH_WEEKDAY_PREFIX}${WEEKDAY_ZH[parts.weekday]}`
    : lang === 'pt'
      ? WEEKDAY_PT[parts.weekday]
      : WEEKDAY_EN[parts.weekday]
  const dowShort = lang === 'zh' ? WEEKDAY_ZH[parts.weekday] : dow

  const h = pad2(parts.hours)
  const m = pad2(parts.minutes)
  const s = pad2(parts.seconds)
  const sched = SCHEDULE_EN[getScheduleType(time)]
  const schedLabel = t[`schedule${getScheduleType(time) === 'mon_thu' ? 'MonThu' : getScheduleType(time) === 'friday' ? 'Friday' : 'SatSun'}` as const]
  const isLive = clock.isLive
  const vehUnit = t.vehicleUnit

  const handleApply = useCallback((newDate: Date) => {
    clock.setTime(newDate)
    setOpen(false)
  }, [clock])

  const toggleOpen = useCallback(() => setOpen(p => !p), [])

  return (
    <>
      {/* Phone: compact inline chip next to hamburger. */}
      <button
        ref={phoneRef}
        onClick={toggleOpen}
        title={t.clickToSetTime}
        aria-label={t.clickToSetTime}
        className="mm-ui-scale sm:hidden absolute top-2 left-[60px] z-30
                   h-9 flex items-stretch bg-(--mm-panel-2)
                   border border-(--mm-amber)/25 overflow-hidden
                   hover:border-(--mm-amber)/50 active:bg-(--mm-amber)/5 transition
                   shadow-[0_8px_24px_var(--mm-shadow)]"
      >
        <div className="flex flex-col justify-center px-2 bg-(--mm-amber)/[0.05] border-r border-(--mm-amber)/15">
          <span className="mm-mono mm-tabular text-[7px] leading-none tracking-[0.2em] text-(--mm-text-accent)">
            {pad2(mo)}·{pad2(d)}
          </span>
          <span className="mm-mono text-[7px] leading-none tracking-[0.2em] text-(--mm-text-muted) mt-[2px]">
            {lang === 'zh'
              ? WEEKDAY_ZH[parts.weekday]
              : lang === 'pt'
                ? WEEKDAY_PT[parts.weekday]
                : WEEKDAY_EN[parts.weekday]}
          </span>
        </div>
        <div className="flex items-center gap-[2px] px-2 bg-gradient-to-b from-(--mm-panel-3) to-(--mm-panel-2)">
          <span className="mm-mono mm-tabular font-bold text-[16px] leading-none text-(--mm-amber-1)">{h}</span>
          <span className="mm-mono font-bold text-[14px] leading-none text-(--mm-text-accent) mm-colon-blink relative -top-[1px]">:</span>
          <span className="mm-mono mm-tabular font-bold text-[16px] leading-none text-(--mm-amber-1)">{m}</span>
          <span className="mm-mono mm-tabular text-[9px] leading-none text-(--mm-text-accent) ml-0.5">:{s}</span>
        </div>
        <div className="flex items-center px-1.5 bg-(--mm-fg)/[0.02] border-l border-(--mm-fg)/8">
          <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-(--mm-emerald-2) mm-led-pulse' : 'bg-(--mm-fg)/25'}`} />
        </div>
      </button>

      {/* Tablet / Desktop: split-flap departure-board clock centered top. */}
      <button
        ref={deskRef}
        onClick={toggleOpen}
        title={t.clickToSetTime}
        aria-label={t.clickToSetTime}
        className="mm-ui-scale hidden sm:block absolute top-3 left-1/2 -translate-x-1/2 z-30
                   text-left bg-(--mm-panel-2)/95 backdrop-blur-md
                   border border-(--mm-amber)/25 rounded-sm overflow-hidden
                   shadow-[0_8px_24px_var(--mm-shadow)]
                   hover:border-(--mm-amber)/45 transition-colors"
      >
        {/* Top meta strip */}
        <div className="flex items-center justify-between px-3 py-1 bg-(--mm-amber)/[0.06] border-b border-(--mm-amber)/15 gap-3">
          <span className="mm-mono mm-tabular text-[9px] tracking-[0.15em] text-(--mm-amber-1)/80">
            {yr}·{pad2(mo)}·{pad2(d)} · {dowShort}
          </span>
          <span className="flex items-center gap-2 mm-mono text-[9px] tracking-[0.2em]">
            {vehicleCount !== undefined && vehicleCount > 0 && (
              <span className="mm-tabular text-(--mm-text-muted)">{vehicleCount}{vehUnit}</span>
            )}
            <span className={`flex items-center gap-1 ${isLive ? 'text-(--mm-emerald)/90' : 'text-(--mm-text-subtle)'}`}>
              <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-(--mm-emerald-2) mm-led-pulse' : 'bg-(--mm-fg)/25'}`} />
              {isLive ? t.live : t.simShort}
            </span>
          </span>
        </div>
        {/* Split-flap */}
        <div className="flex items-stretch">
          <div className="flex items-center justify-center px-2.5 py-1.5
                          bg-gradient-to-b from-(--mm-panel-3) to-(--mm-panel-2) border-r border-(--mm-seam)">
            <span className="mm-mono mm-tabular font-bold text-[40px] leading-none text-(--mm-amber-1)"
                  style={{ letterSpacing: '0.02em' }}>{h}</span>
          </div>
          <div className="flex items-center justify-center px-0.5 bg-(--mm-panel-2)">
            <span className="mm-mono font-bold text-[32px] leading-none text-(--mm-text-accent) mm-colon-blink relative -top-[2px]">:</span>
          </div>
          <div className="flex items-center justify-center px-2.5 py-1.5
                          bg-gradient-to-b from-(--mm-panel-3) to-(--mm-panel-2) border-l border-(--mm-seam) border-r border-(--mm-fg)/5">
            <span className="mm-mono mm-tabular font-bold text-[40px] leading-none text-(--mm-amber-1)"
                  style={{ letterSpacing: '0.02em' }}>{m}</span>
          </div>
          <div className="flex-1 flex flex-col justify-between items-start py-1.5 px-2 bg-(--mm-panel-2) min-w-[42px]">
            <span className="mm-mono text-[8px] tracking-[0.2em] text-(--mm-text-muted)">{t.sec}</span>
            <div className="flex items-baseline gap-1">
              <span className="mm-mono mm-tabular font-bold text-[16px] leading-none text-(--mm-amber)/80">{s}</span>
              {clock.speed !== 1 && (
                <span className="mm-mono mm-tabular font-bold text-[13px] leading-none text-(--mm-emerald-2)/80">{clock.speed}×</span>
              )}
            </div>
          </div>
        </div>
        {/* Bottom schedule strip */}
        <div className="flex items-center justify-center gap-2 px-3 py-[5px] bg-(--mm-fg)/[0.02] border-t border-(--mm-fg)/8">
          <span className="mm-mono text-[9px] tracking-[0.18em] text-(--mm-text-secondary) uppercase">
            {schedLabel} · {sched} {t.timetable}
          </span>
        </div>
      </button>

      {open && (
        <DateTimePicker
          value={time}
          onApply={handleApply}
          onCancel={() => setOpen(false)}
          anchorRef={typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? phoneRef : deskRef}
        />
      )}
    </>
  )
}
