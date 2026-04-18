import { useState, useEffect, useRef, useCallback, type RefObject } from 'react'
import { useI18n } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'
import { getScheduleDensity } from '../data/hourDensity'

interface Props {
  value: Date
  onApply: (d: Date) => void
  onCancel: () => void
  anchorRef?: RefObject<HTMLElement | null>
}

const SCHEDULES = [
  { key: 'mon_thu' as const, en: 'MON–THU', zh: '週一至四', note: '常規班表', targetDow: 2 },
  { key: 'friday' as const, en: 'FRIDAY', zh: '週五', note: '略有加班', targetDow: 5 },
  { key: 'sat_sun' as const, en: 'SAT–SUN', zh: '週末', note: '延長末班', targetDow: 6 },
]

const QUICK = [
  { t: '06:30', zh: '首班' },
  { t: '08:00', zh: '早尖峰' },
  { t: '12:00', zh: '午' },
  { t: '18:00', zh: '晚尖峰' },
  { t: '22:00', zh: '夜' },
]

function pad2(n: number) { return String(n).padStart(2, '0') }

export function DateTimePicker({ value, onApply, onCancel, anchorRef }: Props) {
  const { lang, t } = useI18n()
  const [selected, setSelected] = useState<Date>(value)
  const rootRef = useRef<HTMLDivElement>(null)
  const [isPhone, setIsPhone] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : false
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = () => setIsPhone(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      else if (e.key === 'Enter') { e.preventDefault(); onApply(selected) }
    }
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (anchorRef?.current?.contains(target)) return
      onCancel()
    }
    const tid = window.setTimeout(() => document.addEventListener('mousedown', onOutside), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(tid)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onOutside)
    }
  }, [onCancel, onApply, selected, anchorRef])

  const hh = selected.getHours()
  const mm = selected.getMinutes()
  const schedType = getScheduleType(selected)
  const schedDensity = getScheduleDensity(selected.getDay())

  const pickSchedule = useCallback((targetDow: number) => {
    setSelected(prev => {
      const cur = prev.getDay()
      const offset = ((targetDow - cur) + 7) % 7
      const n = new Date(prev)
      n.setDate(prev.getDate() + offset)
      return n
    })
  }, [])

  const shiftDate = (days: number) => {
    setSelected(prev => {
      const n = new Date(prev)
      n.setDate(prev.getDate() + days)
      return n
    })
  }

  const setToToday = () => {
    setSelected(prev => {
      const now = new Date()
      const n = new Date(prev)
      n.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
      return n
    })
  }

  const setHourMinute = (h: number, m: number) => {
    setSelected(prev => {
      const n = new Date(prev)
      n.setHours(h, m, 0, 0)
      return n
    })
  }

  const scrubHour = (frac: number) => {
    const total = Math.max(0, Math.min(23 * 60 + 59, Math.round(frac * 24 * 60)))
    setHourMinute(Math.floor(total / 60), total % 60)
  }

  const weekdayShort = (d: Date) => {
    const zh = ['日', '一', '二', '三', '四', '五', '六']
    const en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const pt = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    return lang === 'zh' ? `週${zh[d.getDay()]}` : lang === 'pt' ? pt[d.getDay()] : en[d.getDay()]
  }

  const schedLabel = t[`schedule${schedType === 'mon_thu' ? 'MonThu' : schedType === 'friday' ? 'Friday' : 'SatSun'}` as const]

  const body = (
    <div className={`${isPhone ? 'space-y-4' : 'w-[380px] space-y-3'}`}>
      {/* Schedule cards */}
      <div>
        <div className="mm-mono text-[9px] tracking-[0.25em] text-amber-300/60 mb-1.5">◣ SCHEDULE · 班表</div>
        <div className="grid grid-cols-3 gap-1.5">
          {SCHEDULES.map(s => {
            const active = schedType === s.key
            return (
              <button
                key={s.key}
                onClick={() => pickSchedule(s.targetDow)}
                className={`text-left p-2 border transition relative overflow-hidden rounded-sm ${
                  active
                    ? 'border-amber-300/70 bg-amber-300/[0.10]'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/25'
                }`}
              >
                {active && <div className="absolute top-1.5 right-1.5 w-1 h-1 rounded-full bg-amber-300 mm-led-pulse" />}
                <div className={`mm-mono text-[9px] tracking-[0.2em] ${active ? 'text-amber-300' : 'text-white/40'}`}>{s.en}</div>
                <div className={`mm-han text-[13px] font-semibold mt-0.5 ${active ? 'text-amber-100' : 'text-white/75'}`}>{s.zh}</div>
                <div className={`text-[9px] mt-0.5 ${active ? 'text-amber-200/70' : 'text-white/35'}`}>{s.note}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Date stepper */}
      <div>
        <div className="flex items-end justify-between mb-1.5">
          <div className="mm-mono text-[9px] tracking-[0.25em] text-amber-300/60">◣ DATE · 日期</div>
          <div className="mm-mono mm-tabular text-[10px] text-amber-200">
            {selected.getFullYear()}/{pad2(selected.getMonth() + 1)}/{pad2(selected.getDate())} · {weekdayShort(selected)}
          </div>
        </div>
        <div className="flex items-stretch border border-white/10 rounded-sm overflow-hidden">
          <button onClick={() => shiftDate(-7)} className="px-2 h-9 mm-mono text-[10px] text-white/60 hover:text-amber-200 hover:bg-white/5 border-r border-white/8">−7D</button>
          <button onClick={() => shiftDate(-1)} className="px-2 h-9 mm-mono text-[10px] text-white/60 hover:text-amber-200 hover:bg-white/5 border-r border-white/8">−1D</button>
          <button onClick={setToToday} className="flex-1 h-9 mm-mono text-[10px] tracking-wider text-emerald-300/85 hover:bg-emerald-500/10 border-r border-white/8">▸ {t.now.toUpperCase()}</button>
          <button onClick={() => shiftDate(1)} className="px-2 h-9 mm-mono text-[10px] text-white/60 hover:text-amber-200 hover:bg-white/5 border-r border-white/8">+1D</button>
          <button onClick={() => shiftDate(7)} className="px-2 h-9 mm-mono text-[10px] text-white/60 hover:text-amber-200 hover:bg-white/5">+7D</button>
        </div>
      </div>

      {/* Time */}
      <div>
        <div className="mm-mono text-[9px] tracking-[0.25em] text-amber-300/60 mb-1.5">◣ TIME · 時間</div>
        <div className="bg-[#050505] border border-amber-300/20 rounded-sm px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-end gap-0.5">
            <span className="mm-seg7 mm-tabular font-bold text-[34px] leading-none text-amber-200"
              style={{ textShadow: '0 0 12px rgba(252,196,65,0.4)' }}>{pad2(hh)}</span>
            <span className="mm-seg7 font-bold text-[28px] leading-none text-amber-300/60 mm-colon-blink pb-1">:</span>
            <span className="mm-seg7 mm-tabular font-bold text-[34px] leading-none text-amber-200"
              style={{ textShadow: '0 0 12px rgba(252,196,65,0.4)' }}>{pad2(mm)}</span>
          </div>
          <div className="flex flex-col gap-0.5 items-end">
            <div className="mm-mono text-[8px] tracking-widest text-amber-300/55">24H</div>
            <div className="flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-emerald-400 mm-led-pulse" />
              <span className="mm-mono text-[8px] tracking-widest text-emerald-300/80">{schedLabel}</span>
            </div>
          </div>
        </div>

        {/* Hour density rail */}
        <div className="mt-2">
          <div className="relative h-8 bg-[#08080a] border border-white/8 rounded-sm overflow-hidden">
            {Array.from({ length: 96 }).map((_, i) => {
              const h = Math.floor((i / 96) * 24)
              const d = schedDensity.density[h]
              const d2 = d * d
              const r = Math.round(252 + (255 - 252) * d2)
              const g = Math.round(196 - 60 * d2)
              const b = Math.round(65 - 45 * d2)
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0"
                  style={{
                    left: `${(i / 96) * 100}%`,
                    width: `${100 / 96 + 0.3}%`,
                    background: `linear-gradient(to top, rgba(${r},${g},${b},${d2 * 0.85 + d * 0.1}) 0%, rgba(${r},${g},${b},${d2 * 0.4}) 70%, transparent 100%)`,
                  }}
                />
              )
            })}
            <div
              className="absolute top-[2px] mm-mono text-[7px] text-amber-200/90 tracking-widest pointer-events-none"
              style={{ left: `${(7.5 / 24) * 100}%`, transform: 'translateX(-50%)' }}
            >
              AM PEAK
            </div>
            <div
              className="absolute top-[2px] mm-mono text-[7px] text-amber-200/90 tracking-widest pointer-events-none"
              style={{ left: `${(18 / 24) * 100}%`, transform: 'translateX(-50%)' }}
            >
              PM PEAK
            </div>
            <div className="absolute top-0 bottom-0 w-px bg-emerald-400/50 pointer-events-none" style={{ left: `${schedDensity.firstFrac * 100}%` }} />
            <div className="absolute top-0 bottom-0 w-px bg-emerald-400/50 pointer-events-none" style={{ left: `${schedDensity.lastFrac * 100}%` }} />
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-amber-300 pointer-events-none"
              style={{
                left: `${(hh + mm / 60) / 24 * 100}%`,
                transform: 'translateX(-1px)',
                boxShadow: '0 0 10px rgba(252,196,65,0.9)',
              }}
            />
            <div
              className="absolute w-3 h-3 rounded-full bg-amber-300 border-2 border-[#08080a] shadow-[0_0_12px_rgba(252,196,65,0.9)] pointer-events-none"
              style={{ left: `${(hh + mm / 60) / 24 * 100}%`, top: '50%', transform: 'translate(-50%,-50%)' }}
            />
            <div
              className="absolute inset-0 cursor-pointer"
              onClick={e => {
                const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                scrubHour((e.clientX - r.left) / r.width)
              }}
            />
          </div>
          <div className="relative h-3 mt-0.5">
            <div
              className="absolute mm-mono text-[8px] text-emerald-300/70 tracking-widest whitespace-nowrap"
              style={{ left: `${schedDensity.firstFrac * 100}%`, transform: 'translateX(-50%)' }}
            >
              首班 {schedDensity.first}
            </div>
            <div
              className="absolute mm-mono text-[8px] text-emerald-300/70 tracking-widest whitespace-nowrap"
              style={{ left: `${schedDensity.lastFrac * 100}%`, transform: 'translateX(-100%)' }}
            >
              末班 {schedDensity.last}
            </div>
          </div>
        </div>

        {/* Quick presets */}
        <div className="flex items-stretch gap-1 mt-2">
          {QUICK.map(q => {
            const [h2, m2] = q.t.split(':').map(Number)
            const active = hh === h2 && mm === m2
            return (
              <button
                key={q.t}
                onClick={() => setHourMinute(h2, m2)}
                className={`flex-1 h-10 flex flex-col items-center justify-center border rounded-sm transition ${
                  active
                    ? 'border-amber-300/60 bg-amber-300/10 text-amber-200'
                    : 'border-white/10 bg-white/[0.02] text-white/60 hover:border-white/25 hover:text-white/85'
                }`}
              >
                <span className="mm-mono mm-tabular text-[10px] font-semibold leading-none">{q.t}</span>
                <span className="mm-han text-[9px] leading-none mt-0.5 opacity-75">{q.zh}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  if (isPhone) {
    return (
      <>
        <div
          className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-[2px]"
          style={{ animation: 'mm-fade 140ms ease-out' }}
          onClick={onCancel}
        />
        <div
          ref={rootRef}
          className="fixed left-0 right-0 bottom-0 z-[90] bg-[#0b0b0c] border-t border-amber-300/25"
          style={{ animation: 'mm-sheet-up 220ms cubic-bezier(0.2,0.8,0.2,1)', boxShadow: '0 -12px 40px rgba(0,0,0,0.7)' }}
        >
          <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5 border-b border-white/10 bg-amber-300/[0.04]">
            <div className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-emerald-400 mm-led-pulse" />
              <span className="mm-mono text-[9px] tracking-[0.25em] text-amber-300/80">░ SET TIME · 設定時間</span>
            </div>
          </div>
          <div className="mx-auto w-10 h-1 rounded-full bg-white/12 mt-2" />
          <div className="p-4 pb-2">{body}</div>
          <div className="px-4 py-3 flex items-center justify-between gap-2 border-t border-white/10 bg-white/[0.02]">
            <button
              onClick={onCancel}
              className="h-11 px-4 mm-mono text-[12px] tracking-wider text-white/55 active:bg-white/10 rounded-sm"
            >
              {t.cancel.toUpperCase()}
            </button>
            <button
              onClick={() => onApply(selected)}
              className="h-11 px-5 mm-mono text-[12px] tracking-[0.2em] font-bold text-black bg-amber-300 active:bg-amber-400 flex-1 rounded-sm"
              style={{ boxShadow: '0 0 20px rgba(252,196,65,0.3)' }}
            >
              {t.apply.toUpperCase()}
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <div
      ref={rootRef}
      className="absolute top-[92px] left-1/2 -translate-x-1/2 z-[90]
                 bg-[#0b0b0c] border border-amber-300/25 rounded-sm
                 flex flex-col"
      style={{
        animation: 'mm-pop-in 160ms cubic-bezier(0.2,0.8,0.2,1)',
        boxShadow: '0 18px 52px rgba(0,0,0,0.75)',
        zoom: 1.2,
        maxHeight: 'calc((100vh - 260px) / 1.2)',
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-amber-300/[0.04] shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-1 h-1 rounded-full bg-emerald-400 mm-led-pulse" />
          <span className="mm-mono text-[9px] tracking-[0.25em] text-amber-300/80">░ SET TIME · 設定時間</span>
        </div>
      </div>
      <div className="p-3 overflow-y-auto mm-scrollbar">{body}</div>
      <div className="px-3 py-2 flex items-center justify-end gap-2 border-t border-white/10 bg-white/[0.02] shrink-0">
        <button
          onClick={onCancel}
          className="h-7 px-3 mm-mono text-[10px] tracking-wider text-white/55 hover:text-white transition rounded-sm"
        >
          {t.cancel.toUpperCase()}
        </button>
        <button
          onClick={() => onApply(selected)}
          className="h-7 px-4 mm-mono text-[10px] tracking-[0.2em] font-bold text-black bg-amber-300 hover:bg-amber-200 transition rounded-sm"
          style={{ boxShadow: '0 0 14px rgba(252,196,65,0.25)' }}
        >
          {t.apply.toUpperCase()}
        </button>
      </div>
    </div>
  )
}
