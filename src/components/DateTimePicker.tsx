import { useState, useEffect, useRef, useCallback, type RefObject } from 'react'
import { useI18n } from '../i18n'
import type { Translations } from '../i18n'
import { getScheduleType } from '../engines/simulationEngine'
import { getScheduleDensity } from '../data/hourDensity'
import { macauParts, macauWeekday, macauWallToInstant } from '../macauTime'

interface Props {
  value: Date
  onApply: (d: Date) => void
  onCancel: () => void
  anchorRef?: RefObject<HTMLElement | null>
}

// Schedule cards. `en` column stays a fixed code (MON–THU / FRIDAY / SAT–SUN)
// because the dense tracking-[0.2em] display reads as a universal 24h-style
// abbreviation across locales. Human-readable header + note come from i18n.
const SCHEDULES = [
  { key: 'mon_thu' as const, code: 'MON–THU', descKey: 'mtDescMonThu' as const, noteKey: 'scheduleNoteMonThu' as const, targetDow: 2 },
  { key: 'friday' as const, code: 'FRIDAY', descKey: 'mtDescFriday' as const, noteKey: 'scheduleNoteFriday' as const, targetDow: 5 },
  { key: 'sat_sun' as const, code: 'SAT–SUN', descKey: 'mtDescSatSun' as const, noteKey: 'scheduleNoteSatSun' as const, targetDow: 6 },
]

const QUICK: ReadonlyArray<{ t: string; labelKey: keyof Translations }> = [
  { t: '06:30', labelKey: 'quickFirst' },
  { t: '08:00', labelKey: 'quickMorningPeak' },
  { t: '12:00', labelKey: 'quickNoon' },
  { t: '18:00', labelKey: 'quickEveningPeak' },
  { t: '22:00', labelKey: 'quickNight' },
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

  // All date/time fields the picker shows and edits are in Macau wall-clock
  // time, so a user anywhere on Earth picks the same Macau moment.
  const sel = macauParts(selected)
  const hh = sel.hours
  const mm = sel.minutes
  const schedType = getScheduleType(selected)
  const schedDensity = getScheduleDensity(sel.weekday)

  const pickSchedule = useCallback((targetDow: number) => {
    setSelected(prev => {
      const offset = ((targetDow - macauWeekday(prev)) + 7) % 7
      // +offset Macau calendar days; Macau has no DST so a fixed 24h step
      // advances the wall clock by exactly one day and preserves time-of-day.
      return new Date(prev.getTime() + offset * 86400000)
    })
  }, [])

  const shiftDate = (days: number) => {
    setSelected(prev => new Date(prev.getTime() + days * 86400000))
  }

  const setToToday = () => {
    setSelected(prev => {
      const p = macauParts(prev)
      const today = macauParts(new Date())
      // Keep the chosen Macau time-of-day, swap to today's Macau date.
      return macauWallToInstant(today.year, today.month, today.day, p.hours, p.minutes, p.seconds, p.ms)
    })
  }

  const setHourMinute = (h: number, m: number) => {
    setSelected(prev => {
      const p = macauParts(prev)
      return macauWallToInstant(p.year, p.month, p.day, h, m)
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
    const wd = macauWeekday(d)
    return lang === 'zh' ? `週${zh[wd]}` : lang === 'pt' ? pt[wd] : en[wd]
  }

  const schedLabel = t[`schedule${schedType === 'mon_thu' ? 'MonThu' : schedType === 'friday' ? 'Friday' : 'SatSun'}` as const]

  const body = (
    <div className={`${isPhone ? 'space-y-4' : 'w-[380px] space-y-3'}`}>
      {/* Schedule cards */}
      <div>
        <div className="mm-mono text-[9px] tracking-[0.25em] text-(--mm-text-accent) mb-1.5">◣ SCHEDULE · {t.scheduleCategoryLabel}</div>
        <div className="grid grid-cols-3 gap-1.5">
          {SCHEDULES.map(s => {
            const active = schedType === s.key
            return (
              <button
                key={s.key}
                onClick={() => pickSchedule(s.targetDow)}
                className={`text-left p-2 border transition relative overflow-hidden rounded-sm ${
                  active
                    ? 'border-(--mm-amber)/70 bg-(--mm-amber)/[0.10]'
                    : 'border-(--mm-fg)/10 bg-(--mm-fg)/[0.02] hover:border-(--mm-fg)/25'
                }`}
              >
                {active && <div className="absolute top-1.5 right-1.5 w-1 h-1 rounded-full bg-(--mm-amber) mm-led-pulse" />}
                <div className={`mm-mono text-[9px] tracking-[0.2em] ${active ? 'text-(--mm-amber)' : 'text-(--mm-text-muted)'}`}>{s.code}</div>
                <div className={`mm-han text-[13px] font-bold mt-0.5 ${active ? 'text-(--mm-amber-1)' : 'text-(--mm-fg)/75'}`}>{t[s.descKey]}</div>
                <div className={`text-[9px] mt-0.5 ${active ? 'text-(--mm-amber-1)/70' : 'text-(--mm-text-muted)'}`}>{t[s.noteKey]}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Date stepper */}
      <div>
        <div className="flex items-end justify-between mb-1.5">
          <div className="mm-mono text-[9px] tracking-[0.25em] text-(--mm-text-accent)">◣ DATE · {t.dateCategoryLabel}</div>
          <div className="mm-mono mm-tabular text-[10px] text-(--mm-amber-1)">
            {sel.year}/{pad2(sel.month + 1)}/{pad2(sel.day)} · {weekdayShort(selected)}
          </div>
        </div>
        <div className="flex items-stretch border border-(--mm-fg)/10 rounded-sm overflow-hidden">
          <button onClick={() => shiftDate(-7)} className="px-2 h-9 mm-mono text-[10px] text-(--mm-text-secondary) hover:text-(--mm-amber-1) hover:bg-(--mm-fg)/5 border-r border-(--mm-fg)/8">−7D</button>
          <button onClick={() => shiftDate(-1)} className="px-2 h-9 mm-mono text-[10px] text-(--mm-text-secondary) hover:text-(--mm-amber-1) hover:bg-(--mm-fg)/5 border-r border-(--mm-fg)/8">−1D</button>
          <button onClick={setToToday} className="flex-1 h-9 mm-mono text-[10px] tracking-wider text-(--mm-emerald)/85 hover:bg-(--mm-emerald-2)/10 border-r border-(--mm-fg)/8">▸ {t.now.toUpperCase()}</button>
          <button onClick={() => shiftDate(1)} className="px-2 h-9 mm-mono text-[10px] text-(--mm-text-secondary) hover:text-(--mm-amber-1) hover:bg-(--mm-fg)/5 border-r border-(--mm-fg)/8">+1D</button>
          <button onClick={() => shiftDate(7)} className="px-2 h-9 mm-mono text-[10px] text-(--mm-text-secondary) hover:text-(--mm-amber-1) hover:bg-(--mm-fg)/5">+7D</button>
        </div>
      </div>

      {/* Time */}
      <div>
        <div className="mm-mono text-[9px] tracking-[0.25em] text-(--mm-text-accent) mb-1.5">◣ TIME · {t.timeCategoryLabel}</div>
        <div className="bg-(--mm-inset) border border-(--mm-amber)/20 rounded-sm px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-end gap-0.5">
            <span className="mm-seg7 mm-tabular font-bold text-[34px] leading-none text-(--mm-amber-1)"
              style={{ textShadow: '0 0 12px color-mix(in srgb, var(--mm-amber) 40%, transparent)' }}>{pad2(hh)}</span>
            <span className="mm-seg7 font-bold text-[28px] leading-none text-(--mm-text-accent) mm-colon-blink pb-1">:</span>
            <span className="mm-seg7 mm-tabular font-bold text-[34px] leading-none text-(--mm-amber-1)"
              style={{ textShadow: '0 0 12px color-mix(in srgb, var(--mm-amber) 40%, transparent)' }}>{pad2(mm)}</span>
          </div>
          <div className="flex flex-col gap-0.5 items-end">
            <div className="mm-mono text-[8px] tracking-widest text-(--mm-text-accent)">24H</div>
            <div className="flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-(--mm-emerald-2) mm-led-pulse" />
              <span className="mm-mono text-[8px] tracking-widest text-(--mm-emerald)/80">{schedLabel}</span>
            </div>
          </div>
        </div>

        {/* Hour density rail */}
        <div className="mt-2">
          <div className="relative h-8 bg-(--mm-panel-2) border border-(--mm-fg)/8 rounded-sm overflow-hidden">
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
              className="absolute top-[2px] mm-mono text-[7px] text-(--mm-amber-1)/90 tracking-widest pointer-events-none"
              style={{ left: `${(7.5 / 24) * 100}%`, transform: 'translateX(-50%)' }}
            >
              {t.amPeak}
            </div>
            <div
              className="absolute top-[2px] mm-mono text-[7px] text-(--mm-amber-1)/90 tracking-widest pointer-events-none"
              style={{ left: `${(18 / 24) * 100}%`, transform: 'translateX(-50%)' }}
            >
              {t.pmPeak}
            </div>
            <div className="absolute top-0 bottom-0 w-px bg-(--mm-emerald-2)/50 pointer-events-none" style={{ left: `${schedDensity.firstFrac * 100}%` }} />
            <div className="absolute top-0 bottom-0 w-px bg-(--mm-emerald-2)/50 pointer-events-none" style={{ left: `${schedDensity.lastFrac * 100}%` }} />
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-(--mm-amber) pointer-events-none"
              style={{
                left: `${(hh + mm / 60) / 24 * 100}%`,
                transform: 'translateX(-1px)',
                boxShadow: '0 0 10px color-mix(in srgb, var(--mm-amber) 90%, transparent)',
              }}
            />
            <div
              className="absolute w-3 h-3 rounded-full bg-(--mm-amber) border-2 border-(--mm-panel-2) shadow-[0_0_12px_color-mix(in_srgb,_var(--mm-amber)_90%,_transparent)] pointer-events-none"
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
              className="absolute mm-mono text-[8px] text-(--mm-emerald)/70 tracking-widest whitespace-nowrap"
              style={{ left: `${schedDensity.firstFrac * 100}%`, transform: 'translateX(-50%)' }}
            >
              {t.firstBusLabel} {schedDensity.first}
            </div>
            <div
              className="absolute mm-mono text-[8px] text-(--mm-emerald)/70 tracking-widest whitespace-nowrap"
              style={{ left: `${schedDensity.lastFrac * 100}%`, transform: 'translateX(-100%)' }}
            >
              {t.lastBusLabel} {schedDensity.last}
            </div>
          </div>
        </div>

        {/* Quick presets */}
        <div className="flex items-stretch gap-1 mt-2">
          {QUICK.map(q => {
            const [h2, m2] = q.t.split(':').map(Number)
            const active = hh === h2 && mm === m2
            const label = t[q.labelKey]
            // All quick-preset labels in the Translations table are plain
            // strings (never functions), so we can safely render them as-is.
            const labelStr = typeof label === 'string' ? label : ''
            return (
              <button
                key={q.t}
                onClick={() => setHourMinute(h2, m2)}
                className={`flex-1 h-10 flex flex-col items-center justify-center border rounded-sm transition ${
                  active
                    ? 'border-(--mm-amber)/60 bg-(--mm-amber)/10 text-(--mm-amber-1)'
                    : 'border-(--mm-fg)/10 bg-(--mm-fg)/[0.02] text-(--mm-text-secondary) hover:border-(--mm-fg)/25 hover:text-(--mm-fg)/85'
                }`}
              >
                <span className="mm-mono mm-tabular text-[10px] font-bold leading-none">{q.t}</span>
                <span className="mm-han text-[9px] leading-none mt-0.5 opacity-75">{labelStr}</span>
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
          className="fixed inset-0 z-[80] bg-(--mm-scrim) backdrop-blur-[2px]"
          style={{ animation: 'mm-fade 140ms ease-out' }}
          onClick={onCancel}
        />
        <div
          ref={rootRef}
          className="mm-ui-scale fixed bottom-0 z-[90] bg-(--mm-panel) border-t border-(--mm-amber)/25"
          style={{
            left: 0,
            width: 'calc(100vw / 1.2)',
            animation: 'mm-sheet-up 220ms cubic-bezier(0.2,0.8,0.2,1)',
            boxShadow: '0 -12px 40px var(--mm-shadow)',
          }}
        >
          <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5 border-b border-(--mm-fg)/10 bg-(--mm-amber)/[0.04]">
            <div className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-(--mm-emerald-2) mm-led-pulse" />
              <span
                className="inline-block w-[8px] h-[8px]"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, color-mix(in srgb, var(--mm-amber) 70%, transparent) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-[9px] tracking-[0.25em] text-(--mm-amber)/80">SET TIME · {t.setTimeLabel}</span>
            </div>
          </div>
          <div className="mx-auto w-10 h-1 rounded-full bg-(--mm-fg)/12 mt-2" />
          <div className="p-4 pb-2">{body}</div>
          <div className="px-4 py-3 flex items-center justify-between gap-2 border-t border-(--mm-fg)/10 bg-(--mm-fg)/[0.02]">
            <button
              onClick={onCancel}
              className="h-11 px-4 mm-mono text-[12px] tracking-wider text-(--mm-text-secondary) active:bg-(--mm-fg)/10 rounded-sm"
            >
              {t.cancel.toUpperCase()}
            </button>
            <button
              onClick={() => onApply(selected)}
              className="h-11 px-5 mm-mono text-[12px] tracking-[0.2em] font-bold text-(--mm-on-accent) bg-(--mm-amber) active:bg-(--mm-amber-2) flex-1 rounded-sm"
              style={{ boxShadow: '0 0 20px color-mix(in srgb, var(--mm-amber) 30%, transparent)' }}
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
      className="absolute top-[130px] left-1/2 -translate-x-1/2 z-[90]
                 bg-(--mm-panel) border border-(--mm-amber)/25 rounded-sm
                 flex flex-col"
      style={{
        animation: 'mm-pop-in 160ms cubic-bezier(0.2,0.8,0.2,1)',
        boxShadow: '0 18px 52px var(--mm-shadow)',
        zoom: 1.2,
        maxHeight: 'calc((100vh - 340px) / 1.2)',
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-(--mm-fg)/10 bg-(--mm-amber)/[0.04] shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-1 h-1 rounded-full bg-(--mm-emerald-2) mm-led-pulse" />
          <span
                className="inline-block w-[8px] h-[8px]"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, color-mix(in srgb, var(--mm-amber) 70%, transparent) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-[9px] tracking-[0.25em] text-(--mm-amber)/80">SET TIME · {t.setTimeLabel}</span>
        </div>
      </div>
      <div className="p-3 overflow-y-auto mm-scrollbar">{body}</div>
      <div className="px-3 py-2 flex items-center justify-end gap-2 border-t border-(--mm-fg)/10 bg-(--mm-fg)/[0.02] shrink-0">
        <button
          onClick={onCancel}
          className="h-7 px-3 mm-mono text-[10px] tracking-wider text-(--mm-text-secondary) hover:text-(--mm-fg) transition rounded-sm"
        >
          {t.cancel.toUpperCase()}
        </button>
        <button
          onClick={() => onApply(selected)}
          className="h-7 px-4 mm-mono text-[10px] tracking-[0.2em] font-bold text-(--mm-on-accent) bg-(--mm-amber) hover:bg-(--mm-amber-1) transition rounded-sm"
          style={{ boxShadow: '0 0 14px color-mix(in srgb, var(--mm-amber) 25%, transparent)' }}
        >
          {t.apply.toUpperCase()}
        </button>
      </div>
    </div>
  )
}
