import { useState, useCallback, useRef } from 'react'
import type { SimulationClock } from '../types'
import { useI18n } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'
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
  const time = clock.currentTime

  const yr = time.getFullYear()
  const mo = time.getMonth() + 1
  const d = time.getDate()
  const dow = lang === 'zh'
    ? `${ZH_WEEKDAY_PREFIX}${WEEKDAY_ZH[time.getDay()]}`
    : lang === 'pt'
      ? WEEKDAY_PT[time.getDay()]
      : WEEKDAY_EN[time.getDay()]
  const dowShort = lang === 'zh' ? WEEKDAY_ZH[time.getDay()] : dow

  const h = pad2(time.getHours())
  const m = pad2(time.getMinutes())
  const s = pad2(time.getSeconds())
  const sched = SCHEDULE_EN[getScheduleType(time)]
  const schedLabel = t[`schedule${getScheduleType(time) === 'mon_thu' ? 'MonThu' : getScheduleType(time) === 'friday' ? 'Friday' : 'SatSun'}` as const]
  const isLive = !clock.paused && clock.speed === 1 && Math.abs(time.getTime() - Date.now()) < 3000
  const vehUnit = lang === 'zh' ? '輛' : lang === 'pt' ? 'v' : 'veh'

  const handleApply = useCallback((newDate: Date) => {
    clock.setTime(newDate)
    setOpen(false)
  }, [clock])

  return (
    <>
      {/* Phone: compact inline chip next to hamburger. */}
      <button
        ref={phoneRef}
        onClick={() => setOpen(p => !p)}
        title={t.clickToSetTime}
        aria-label={t.clickToSetTime}
        className="sm:hidden absolute top-[50px] left-[52px] z-30
                   h-9 flex items-stretch bg-[#0a0a0b]
                   border border-amber-300/25 overflow-hidden
                   hover:border-amber-300/50 active:bg-amber-300/5 transition
                   shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
      >
        <div className="flex flex-col justify-center px-2 bg-amber-300/[0.05] border-r border-amber-300/15">
          <span className="mm-mono mm-tabular text-[7px] leading-none tracking-[0.2em] text-amber-300/60">
            {pad2(mo)}·{pad2(d)}
          </span>
          <span className="mm-mono text-[7px] leading-none tracking-[0.2em] text-white/40 mt-[2px]">
            {lang === 'zh' ? WEEKDAY_ZH[time.getDay()] : WEEKDAY_EN[time.getDay()]}
          </span>
        </div>
        <div className="flex items-center gap-[2px] px-2 bg-gradient-to-b from-[#131314] to-[#0a0a0b]">
          <span className="mm-mono mm-tabular font-bold text-[16px] leading-none text-amber-200">{h}</span>
          <span className="mm-mono font-bold text-[14px] leading-none text-amber-300/70 mm-colon-blink relative -top-[1px]">:</span>
          <span className="mm-mono mm-tabular font-bold text-[16px] leading-none text-amber-200">{m}</span>
          <span className="mm-mono mm-tabular text-[9px] leading-none text-amber-300/50 ml-0.5">:{s}</span>
        </div>
        <div className="flex items-center px-1.5 bg-white/[0.02] border-l border-white/8">
          <span className="w-1 h-1 rounded-full bg-emerald-400 mm-led-pulse" />
        </div>
      </button>

      {/* Tablet / Desktop: split-flap departure-board clock centered top. */}
      <button
        ref={deskRef}
        onClick={() => setOpen(p => !p)}
        title={t.clickToSetTime}
        aria-label={t.clickToSetTime}
        className="mm-ui-scale hidden sm:block absolute top-3 left-1/2 -translate-x-1/2 z-30
                   text-left bg-[#0a0a0b]/95 backdrop-blur-md
                   border border-amber-300/25 rounded-sm overflow-hidden
                   shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                   hover:border-amber-300/45 transition-colors"
      >
        {/* Top meta strip */}
        <div className="flex items-center justify-between px-3 py-1 bg-amber-300/[0.06] border-b border-amber-300/15 gap-3">
          <span className="mm-mono mm-tabular text-[9px] tracking-[0.15em] text-amber-200/80">
            {yr}·{pad2(mo)}·{pad2(d)} · {dowShort}
          </span>
          <span className="flex items-center gap-2 mm-mono text-[9px] tracking-[0.2em]">
            {vehicleCount !== undefined && vehicleCount > 0 && (
              <span className="mm-tabular text-white/45">{vehicleCount}{vehUnit}</span>
            )}
            <span className={`flex items-center gap-1 ${isLive ? 'text-emerald-300/90' : 'text-white/30'}`}>
              <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-emerald-400 mm-led-pulse' : 'bg-white/25'}`} />
              {isLive ? 'LIVE' : 'SIM'}
            </span>
          </span>
        </div>
        {/* Split-flap */}
        <div className="flex items-stretch">
          <div className="flex items-center justify-center px-2.5 py-1.5
                          bg-gradient-to-b from-[#131314] to-[#0a0a0b] border-r border-black/40">
            <span className="mm-mono mm-tabular font-bold text-[40px] leading-none text-amber-200"
                  style={{ letterSpacing: '0.02em' }}>{h}</span>
          </div>
          <div className="flex items-center justify-center px-0.5 bg-[#0a0a0b]">
            <span className="mm-mono font-bold text-[32px] leading-none text-amber-300/70 mm-colon-blink relative -top-[2px]">:</span>
          </div>
          <div className="flex items-center justify-center px-2.5 py-1.5
                          bg-gradient-to-b from-[#131314] to-[#0a0a0b] border-l border-black/40 border-r border-white/5">
            <span className="mm-mono mm-tabular font-bold text-[40px] leading-none text-amber-200"
                  style={{ letterSpacing: '0.02em' }}>{m}</span>
          </div>
          <div className="flex-1 flex flex-col justify-between items-start py-1.5 px-2 bg-[#08080a] min-w-[42px]">
            <span className="mm-mono text-[8px] tracking-[0.2em] text-white/35">SEC</span>
            <div className="flex items-baseline gap-1">
              <span className="mm-mono mm-tabular font-bold text-[16px] leading-none text-amber-300/80">{s}</span>
              {clock.speed !== 1 && (
                <span className="mm-mono mm-tabular font-bold text-[13px] leading-none text-emerald-400/80">{clock.speed}×</span>
              )}
            </div>
          </div>
        </div>
        {/* Bottom schedule strip */}
        <div className="flex items-center justify-center gap-2 px-3 py-[5px] bg-white/[0.02] border-t border-white/8">
          <span className="mm-mono text-[9px] tracking-[0.18em] text-white/55 uppercase">
            {schedLabel} · {sched} TIMETABLE
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
