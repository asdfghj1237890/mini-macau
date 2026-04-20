import { useCallback, useEffect, useRef, useState } from 'react'
import type { SimulationClock } from '../types'
import { useI18n } from '../i18n'
import { getScheduleDensity } from '../data/hourDensity'

interface Props {
  clock: SimulationClock
}

const SPEEDS = [1, 2, 5, 10, 30, 60]

const RT_BUILD = import.meta.env.VITE_ENABLE_RT === '1'

function useRtActive(): boolean {
  const [active, setActive] = useState(() =>
    RT_BUILD && typeof window !== 'undefined' &&
    localStorage.getItem('mm_rt_enabled') === '1')
  useEffect(() => {
    if (!RT_BUILD) return
    const read = () => setActive(localStorage.getItem('mm_rt_enabled') === '1')
    window.addEventListener('mm-rt-changed', read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener('mm-rt-changed', read)
      window.removeEventListener('storage', read)
    }
  }, [])
  return active
}

function PlayIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.55.83l10.4-6.86a1 1 0 0 0 0-1.66L9.55 4.31A1 1 0 0 0 8 5.14z" />
    </svg>
  )
}

function PauseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="0.5" />
      <rect x="14" y="5" width="4" height="14" rx="0.5" />
    </svg>
  )
}

function ClockIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function ExpandIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 14 4 20 10 20" />
      <polyline points="20 10 20 4 14 4" />
      <line x1="4" y1="20" x2="10" y2="14" />
      <line x1="20" y1="4" x2="14" y2="10" />
    </svg>
  )
}

function CollapseIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 10 10 10 10 4" />
      <polyline points="20 14 14 14 14 20" />
      <line x1="10" y1="10" x2="4" y2="4" />
      <line x1="14" y1="14" x2="20" y2="20" />
    </svg>
  )
}

function pad2(n: number) { return String(n).padStart(2, '0') }

function useIsCompact() {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const h = (e: MediaQueryListEvent) => setCompact(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return compact
}

function DensityBand({
  bins,
  heightPx,
  showPeaks,
  nowFrac,
  hoverFrac,
  firstFrac,
  lastFrac,
  density,
  small = false,
}: {
  bins: number
  heightPx: number
  showPeaks: boolean
  nowFrac: number
  hoverFrac: number | null
  firstFrac: number
  lastFrac: number
  density: ReadonlyArray<number>
  small?: boolean
}) {
  return (
    <div
      className="relative rounded-sm overflow-hidden bg-[#08080a] border border-white/8"
      style={{ height: heightPx }}
    >
      {Array.from({ length: bins }).map((_, i) => {
        const h = Math.floor((i / bins) * 24)
        const d = density[h]
        const d2 = d * d
        const r = Math.round(252 + (255 - 252) * d2)
        const g = Math.round(196 - 60 * d2)
        const b = Math.round(65 - 45 * d2)
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0"
            style={{
              left: `${(i / bins) * 100}%`,
              width: `${100 / bins + 0.3}%`,
              background: `linear-gradient(to top, rgba(${r},${g},${b},${d2 * 0.85 + d * 0.1}) 0%, rgba(${r},${g},${b},${d2 * 0.4}) 70%, transparent 100%)`,
            }}
          />
        )
      })}
      {showPeaks && (
        <>
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
        </>
      )}
      <div className="absolute top-0 bottom-0 w-px bg-emerald-400/50" style={{ left: `${firstFrac * 100}%` }} />
      <div className="absolute top-0 bottom-0 w-px bg-emerald-400/50" style={{ left: `${lastFrac * 100}%` }} />
      <div
        className="absolute top-[-3px] bottom-[-3px] w-[2px] bg-amber-300 shadow-[0_0_10px_rgba(252,196,65,0.9)]"
        style={{ left: `${nowFrac * 100}%`, transform: 'translateX(-1px)' }}
      />
      <div
        className={`absolute rounded-full bg-amber-300 border-2 border-[#08080a] shadow-[0_0_12px_rgba(252,196,65,0.9)] ${small ? 'w-2 h-2' : 'w-3 h-3'}`}
        style={{ left: `${nowFrac * 100}%`, top: '50%', transform: 'translate(-50%,-50%)' }}
      />
      {hoverFrac != null && (
        <div
          className="absolute top-0 bottom-0 w-px bg-white/40 pointer-events-none"
          style={{ left: `${hoverFrac * 100}%` }}
        />
      )}
    </div>
  )
}

export function ControlPanel({ clock }: Props) {
  const { t } = useI18n()
  const compact = useIsCompact()
  const scrubRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('mm_tl_expanded') !== '0'
  })
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('mm_tl_expanded', expanded ? '1' : '0')
  }, [expanded])

  const now = clock.currentTime
  const nowFrac = (now.getHours() * 60 + now.getMinutes()) / (24 * 60)
  const nowLabel = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  const hoverHH = hoverFrac != null ? Math.floor(hoverFrac * 24) : null
  const hoverMM = hoverFrac != null ? Math.floor((hoverFrac * 24 * 60) % 60) : null
  const hoverLabel =
    hoverFrac != null && hoverHH != null && hoverMM != null
      ? `${pad2(hoverHH)}:${pad2(hoverMM)}`
      : null

  const scrubTo = useCallback((frac: number) => {
    const f = Math.max(0, Math.min(1, frac))
    const totalMin = Math.floor(f * 24 * 60)
    const d = new Date(clock.currentTime)
    d.setHours(Math.floor(totalMin / 60), totalMin % 60, 0, 0)
    clock.setTime(d)
  }, [clock])

  const fracFromRef = useCallback((ref: React.RefObject<HTMLDivElement | null>, clientX: number) => {
    if (!ref.current) return null
    const r = ref.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }, [])

  const handleMove = useCallback((clientX: number) => {
    const f = fracFromRef(scrubRef, clientX)
    if (f != null) setHoverFrac(f)
  }, [fracFromRef])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const f = fracFromRef(scrubRef, e.clientX)
    if (f != null) scrubTo(f)
  }, [fracFromRef, scrubTo])

  const handleTouch = useCallback((clientX: number, commit: boolean) => {
    const f = fracFromRef(scrubRef, clientX)
    if (f == null) return
    setHoverFrac(f)
    if (commit) scrubTo(f)
  }, [fracFromRef, scrubTo])

  const handleBandMove = useCallback((clientX: number) => {
    const f = fracFromRef(bandRef, clientX)
    if (f != null) setHoverFrac(f)
  }, [fracFromRef])

  const handleBandClick = useCallback((e: React.MouseEvent) => {
    const f = fracFromRef(bandRef, e.clientX)
    if (f != null) scrubTo(f)
  }, [fracFromRef, scrubTo])

  const sched = getScheduleDensity(now.getDay())

  const isPaused = clock.paused
  const speed = clock.speed
  const isLive = !isPaused && speed === 1 && Math.abs(now.getTime() - Date.now()) < 3000
  const rtActive = useRtActive()

  useEffect(() => {
    if (rtActive && clock.speed !== 1) clock.setSpeed(1)
  }, [rtActive, clock])

  // ====================================================
  // PHONE: scrubber on top + 44px play/speed-menu/NOW row
  // ====================================================
  if (compact) {
    const MOBILE_SPEEDS = [1, 2, 5, 10, 30]
    return (
      <div className="absolute bottom-14 left-3 right-3 z-10 mm-fade
                      pb-[max(0px,env(safe-area-inset-bottom))]">
        <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                        shadow-2xl shadow-black/60 overflow-visible">
          {/* Scrubber */}
          <div
            ref={scrubRef}
            className="px-2.5 pt-2.5 pb-1.5 select-none cursor-pointer"
            onMouseMove={e => handleMove(e.clientX)}
            onMouseLeave={() => setHoverFrac(null)}
            onClick={handleClick}
            onTouchMove={e => handleTouch(e.touches[0].clientX, false)}
            onTouchEnd={e => {
              const t = e.changedTouches[0]
              if (t) handleTouch(t.clientX, true)
              setHoverFrac(null)
            }}
          >
            <DensityBand bins={48} heightPx={22} showPeaks nowFrac={nowFrac} hoverFrac={hoverFrac} firstFrac={sched.firstFrac} lastFrac={sched.lastFrac} density={sched.density} />
          </div>
          {/* Bottom row */}
          <div className="flex items-stretch gap-0 px-1 pb-1 pt-0.5 border-t border-white/8">
            <button
              type="button"
              onClick={clock.togglePause}
              aria-label={isPaused ? t.play : t.pause}
              className="w-11 h-11 flex items-center justify-center text-amber-200
                         active:bg-white/10 rounded-sm shrink-0"
            >
              {isPaused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
            </button>
            <div className="w-px bg-white/8 my-1.5" />
            <div className="relative">
              <button
                type="button"
                onClick={() => setSpeedMenuOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={speedMenuOpen}
                className="h-11 px-3 flex items-center gap-1 text-amber-200
                           active:bg-white/10 rounded-sm"
              >
                <span className="mm-mono mm-tabular text-[13px] font-bold">{speed}×</span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <polyline points="6 15 12 9 18 15" />
                </svg>
              </button>
              {speedMenuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 mb-1 bg-[#0b0b0c]
                             border border-white/15 shadow-2xl flex flex-col min-w-[64px]
                             overflow-hidden"
                >
                  {MOBILE_SPEEDS.map(s => {
                    const locked = rtActive && s !== 1
                    return (
                      <button
                        key={s}
                        type="button"
                        role="menuitemradio"
                        aria-checked={s === speed}
                        disabled={locked}
                        title={locked ? 'RT · 鎖定 1×' : undefined}
                        onClick={() => { if (locked) return; clock.setSpeed(s); setSpeedMenuOpen(false) }}
                        className={`h-10 px-3 text-left mm-mono mm-tabular text-[13px]
                                    ${locked ? 'text-white/20 cursor-not-allowed' : 'active:bg-white/10'}
                                    ${s === speed && !locked
                                      ? 'bg-amber-300/15 text-amber-200'
                                      : locked ? '' : 'text-white/70'}`}
                      >
                        {s}×
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="w-px bg-white/8 my-1.5" />
            <button
              type="button"
              onClick={clock.reset}
              title={t.resetNorth}
              className="h-11 px-3 flex items-center gap-1.5 text-white/60
                         active:bg-white/10 active:text-amber-200 rounded-sm"
            >
              <ClockIcon size={12} />
              <span className="mm-mono text-[10px] tracking-wider">NOW</span>
            </button>
            <div className="flex-1" />
            {hoverLabel && (
              <div className="h-11 pr-3 flex items-center gap-1.5 text-amber-200 shrink-0">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span className="mm-mono mm-tabular text-[12px] font-bold">{hoverLabel}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ====================================================
  // DESKTOP — collapsed rail
  // ====================================================
  if (!expanded) {
    return (
      <div className="mm-ui-scale absolute bottom-8 left-4 right-4 z-10 mx-auto mm-fade
                      landscape:bottom-6" style={{ maxWidth: 480 }}>
        <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                        shadow-2xl overflow-hidden flex items-center gap-0 px-1 py-1">
          <button
            type="button"
            onClick={clock.togglePause}
            aria-label={isPaused ? t.play : t.pause}
            className="w-7 h-7 flex items-center justify-center text-amber-200
                       hover:bg-white/5 rounded-sm shrink-0"
          >
            {isPaused ? <PlayIcon size={11} /> : <PauseIcon size={11} />}
          </button>
          <span className="mm-mono mm-tabular text-[9px] px-1.5 h-6 rounded-sm text-amber-200
                           bg-amber-300/15 shrink-0 flex items-center"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(253,224,71,0.3)' }}>
            {speed}×
          </span>
          <div className="w-px h-4 bg-white/10 mx-1.5 shrink-0" />
          <div
            ref={scrubRef}
            className="flex-1 px-0.5 select-none cursor-pointer"
            onMouseMove={e => handleMove(e.clientX)}
            onMouseLeave={() => setHoverFrac(null)}
            onClick={handleClick}
          >
            <DensityBand bins={48} heightPx={14} showPeaks={false} nowFrac={nowFrac} hoverFrac={hoverFrac} firstFrac={sched.firstFrac} lastFrac={sched.lastFrac} density={sched.density} small />
          </div>
          <div className={`mm-mono text-[10px] mm-tabular px-2 flex items-center gap-1 shrink-0 ${isLive ? 'text-amber-200/90' : 'text-white/45'}`}>
            <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-emerald-400 mm-led-pulse' : 'bg-white/25'}`} />
            <span>{hoverLabel ?? nowLabel}</span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title="Expand"
            aria-label="Expand"
            className="w-7 h-7 flex items-center justify-center text-white/40
                       hover:text-amber-200 hover:bg-white/5 rounded-sm shrink-0"
          >
            <ExpandIcon />
          </button>
        </div>
      </div>
    )
  }

  // ====================================================
  // DESKTOP — expanded: full scrubber with hour axis
  // ====================================================
  return (
    <div className="mm-ui-scale absolute bottom-8 left-4 right-4 z-10 mx-auto mm-fade
                    landscape:bottom-6" style={{ maxWidth: 720 }}>
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                      shadow-2xl overflow-hidden">
        {/* Top row */}
        <div className="flex items-center gap-0 px-1 py-1 border-b border-white/8">
          <button
            type="button"
            onClick={clock.togglePause}
            aria-label={isPaused ? t.play : t.pause}
            className="w-7 h-7 flex items-center justify-center text-amber-200
                       hover:bg-white/5 rounded-sm"
          >
            {isPaused ? <PlayIcon size={11} /> : <PauseIcon size={11} />}
          </button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          {SPEEDS.map(s => {
            const active = s === speed
            const locked = rtActive && s !== 1
            return (
              <button
                key={s}
                type="button"
                onClick={() => { if (!locked) clock.setSpeed(s) }}
                disabled={locked}
                title={locked ? 'RT · 鎖定 1×' : undefined}
                aria-pressed={active}
                className={`mm-mono mm-tabular text-[10px] px-1.5 h-6 rounded-sm transition
                           ${locked
                             ? 'text-white/15 cursor-not-allowed'
                             : active
                               ? 'bg-amber-300/15 text-amber-200'
                               : 'text-white/40 hover:text-white/80'}`}
                style={active && !locked ? { boxShadow: 'inset 0 0 0 1px rgba(253,224,71,0.3)' } : undefined}
              >
                {s}×
              </button>
            )
          })}
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button
            type="button"
            onClick={clock.reset}
            title={t.resetNorth}
            className="h-6 px-2 flex items-center gap-1 text-white/55 hover:text-white rounded-sm"
          >
            <ClockIcon size={10} />
            <span className="mm-mono text-[9px] tracking-wider">NOW</span>
          </button>
          <div className="flex-1" />
          <div className={`mm-mono mm-tabular text-[9px] pr-2 flex items-center gap-1.5 ${isLive ? 'text-amber-200/80' : 'text-white/40'}`}>
            <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-emerald-400 mm-led-pulse' : 'bg-white/25'}`} />
            <span>{hoverLabel ?? (isLive ? `${nowLabel} · NOW` : `${nowLabel} · SIM`)}</span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            title="Collapse"
            aria-label="Collapse"
            className="w-7 h-7 flex items-center justify-center text-white/40
                       hover:text-amber-200 hover:bg-white/5 rounded-sm"
          >
            <CollapseIcon />
          </button>
        </div>

        {/* Scrubber with hour axis + density + first/last labels */}
        <div className="px-3 pt-2.5 pb-3">
          <div
            ref={bandRef}
            className="relative select-none cursor-pointer"
            onMouseMove={e => handleBandMove(e.clientX)}
            onMouseLeave={() => setHoverFrac(null)}
            onClick={handleBandClick}
          >
            {/* hour ticks */}
            <div className="relative h-3 mb-1">
              {Array.from({ length: 25 }).map((_, h) => {
                const major = h % 6 === 0
                return (
                  <div
                    key={h}
                    className="absolute top-0 flex flex-col items-center"
                    style={{ left: `${(h / 24) * 100}%`, transform: 'translateX(-50%)' }}
                  >
                    <div className={`${major ? 'h-3 bg-white/30' : 'h-1.5 bg-white/12'} w-px`} />
                    {major && h < 24 && (
                      <div className="mm-mono mm-tabular text-[8px] text-white/35 mt-0.5">{pad2(h)}</div>
                    )}
                  </div>
                )
              })}
            </div>
            <DensityBand bins={96} heightPx={22} showPeaks nowFrac={nowFrac} hoverFrac={hoverFrac} firstFrac={sched.firstFrac} lastFrac={sched.lastFrac} density={sched.density} />
            <div className="relative h-4 mt-0.5">
              <div
                className="absolute mm-mono text-[9px] text-emerald-300/70 tracking-widest whitespace-nowrap"
                style={{ left: `${sched.firstFrac * 100}%`, transform: 'translateX(-50%)' }}
              >
                首班 {sched.first}
              </div>
              <div
                className="absolute mm-mono text-[9px] text-emerald-300/70 tracking-widest whitespace-nowrap"
                style={{ left: `${sched.lastFrac * 100}%`, transform: 'translateX(-100%)' }}
              >
                末班 {sched.last}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
