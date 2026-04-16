import { useState, useEffect, useRef, useCallback } from 'react'
import { useI18n, type Lang } from '../i18n'

interface Props {
  value: Date
  onApply: (d: Date) => void
  onCancel: () => void
}

const WEEKDAY_HEADERS: Record<Lang, string[]> = {
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  pt: ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'],
}

const MONTH_NAMES: Record<Lang, string[]> = {
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  pt: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
}

const QUICK_HOURS = [6, 9, 12, 18, 22]

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function buildCalendarCells(monthCursor: Date): { date: Date; dim: boolean }[] {
  const y = monthCursor.getFullYear()
  const m = monthCursor.getMonth()
  const startWeekday = new Date(y, m, 1).getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const daysPrevMonth = new Date(y, m, 0).getDate()

  const cells: { date: Date; dim: boolean }[] = []
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ date: new Date(y, m - 1, daysPrevMonth - i), dim: true })
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ date: new Date(y, m, i), dim: false })
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date
    cells.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      dim: true,
    })
  }
  return cells
}

export function DateTimePicker({ value, onApply, onCancel }: Props) {
  const { lang, t } = useI18n()
  const [selected, setSelected] = useState<Date>(value)
  const [monthCursor, setMonthCursor] = useState<Date>(
    new Date(value.getFullYear(), value.getMonth(), 1)
  )
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onApply(selected)
      }
    }
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onCancel()
      }
    }
    const tid = window.setTimeout(() => {
      document.addEventListener('mousedown', onOutside)
    }, 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(tid)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onOutside)
    }
  }, [onCancel, onApply, selected])

  const cells = buildCalendarCells(monthCursor)

  const pickDate = useCallback((d: Date) => {
    setSelected(prev => {
      const next = new Date(prev)
      next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
      return next
    })
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1))
  }, [])

  const setHour = (h: number) => {
    setSelected(prev => {
      const next = new Date(prev)
      next.setHours(h)
      return next
    })
  }
  const setMinute = (m: number) => {
    setSelected(prev => {
      const next = new Date(prev)
      next.setMinutes(m)
      return next
    })
  }

  const shiftMonth = (delta: number) => {
    setMonthCursor(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))
  }

  const applyNow = () => onApply(new Date())
  const applyAtHour = (hour: number) => {
    const d = new Date(selected)
    d.setHours(hour, 0, 0, 0)
    onApply(d)
  }

  const today = new Date()

  return (
    <div
      ref={rootRef}
      onClick={e => e.stopPropagation()}
      className="bg-zinc-900/95 border border-white/15 rounded-2xl p-4 shadow-2xl
                 backdrop-blur-xl text-white w-[300px]"
      style={{
        animation: 'dtp-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      <style>{`@keyframes dtp-in {
        from { opacity: 0; transform: translateY(-4px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0)    scale(1);    }
      }`}</style>

      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="previous month"
          className="w-8 h-8 flex items-center justify-center rounded-lg
                     hover:bg-white/10 text-white/70 transition-colors"
        >
          ‹
        </button>
        <div className="text-sm font-medium tabular-nums">
          {monthCursor.getFullYear()} · {MONTH_NAMES[lang][monthCursor.getMonth()]}
        </div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="next month"
          className="w-8 h-8 flex items-center justify-center rounded-lg
                     hover:bg-white/10 text-white/70 transition-colors"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 text-[10px] font-medium text-white/40 mb-1">
        {WEEKDAY_HEADERS[lang].map((w, i) => (
          <div key={i} className="h-6 flex items-center justify-center">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 mb-3">
        {cells.map(({ date, dim }, i) => {
          const isSelected = sameDay(date, selected)
          const isToday = sameDay(date, today)
          return (
            <button
              key={i}
              type="button"
              onClick={() => pickDate(date)}
              className={`h-8 rounded-lg text-sm tabular-nums transition-colors ${
                isSelected
                  ? 'bg-blue-500 text-white font-semibold shadow-sm shadow-blue-500/30'
                  : isToday
                    ? 'text-blue-300 ring-1 ring-blue-400/40 hover:bg-white/10'
                    : dim
                      ? 'text-white/20 hover:bg-white/5'
                      : 'text-white/80 hover:bg-white/10'
              }`}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-center gap-2 pt-3 border-t border-white/10 mb-3">
        <TimeStepper value={selected.getHours()} onChange={setHour} max={23} />
        <span className="text-white/40">:</span>
        <TimeStepper value={selected.getMinutes()} onChange={setMinute} max={59} />
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        <button
          type="button"
          onClick={applyNow}
          className="px-2 py-1 rounded-md bg-blue-500/20 hover:bg-blue-500/30
                     text-blue-200 text-xs font-medium transition-colors"
        >
          {t.now}
        </button>
        {QUICK_HOURS.map(h => (
          <button
            key={h}
            type="button"
            onClick={() => applyAtHour(h)}
            className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/15
                       text-white/70 text-xs tabular-nums transition-colors"
          >
            {pad2(h)}:00
          </button>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded-lg text-white/60
                     hover:text-white hover:bg-white/10 transition-colors"
        >
          {t.cancel}
        </button>
        <button
          type="button"
          onClick={() => onApply(selected)}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 hover:bg-blue-400
                     text-white font-medium transition-colors"
        >
          {t.apply}
        </button>
      </div>
    </div>
  )
}

interface StepperProps {
  value: number
  onChange: (n: number) => void
  max: number
}

function TimeStepper({ value, onChange, max }: StepperProps) {
  const [text, setText] = useState(pad2(value))
  useEffect(() => {
    setText(pad2(value))
  }, [value])

  const commit = (raw: string) => {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n >= 0 && n <= max) {
      onChange(n)
    } else {
      setText(pad2(value))
    }
  }

  const bump = (delta: number) => {
    const m = max + 1
    onChange(((value + delta) % m + m) % m)
  }

  return (
    <div className="flex items-center bg-white/5 rounded-lg border border-white/10 overflow-hidden">
      <button
        type="button"
        onClick={() => bump(-1)}
        className="w-7 h-8 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        tabIndex={-1}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onChange={e => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            commit((e.target as HTMLInputElement).value)
              ; (e.target as HTMLInputElement).blur()
          }
        }}
        className="w-10 bg-transparent text-center font-mono text-sm
                   outline-none tabular-nums text-white"
      />
      <button
        type="button"
        onClick={() => bump(1)}
        className="w-7 h-8 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        tabIndex={-1}
      >
        +
      </button>
    </div>
  )
}
