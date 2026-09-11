import { useCallback, useEffect, useRef, useState } from 'react'
import type { SimulationClock } from '../types'
import { useClockMinute } from '../hooks/useSimulationClock'
import { useI18n } from '../i18n'
import { getScheduleDensity } from '../data/hourDensity'
import { macauParts, macauWeekday, macauWallToInstant } from '../macauTime'

interface Props {
  clock: SimulationClock
}

const SPEEDS = [1, 2, 5, 10, 30, 60]

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

function timeLabel(minutes: number) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
}

export function ControlPanel({ clock }: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(() => localStorage.getItem('mm_tl_expanded') !== '0')
  const [draftMinute, setDraftMinute] = useState<number | null>(null)
  const draftRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    localStorage.setItem('mm_tl_expanded', expanded ? '1' : '0')
  }, [expanded])

  // Keep the density rail on a minute subscription, independent of the seconds display.
  const now = useClockMinute(clock)
  const parts = macauParts(now)
  const minute = draftMinute ?? parts.hours * 60 + parts.minutes
  const sched = getScheduleDensity(macauWeekday(now))
  const status = clock.paused ? t.pause : clock.isLive ? t.live : t.simShort

  const seekTo = useCallback((value: number) => {
    const selectedMinute = Math.max(0, Math.min(1439, value))
    const p = macauParts(clock.timeRef.current)
    clock.setTime(macauWallToInstant(p.year, p.month, p.day, Math.floor(selectedMinute / 60), selectedMinute % 60))
  }, [clock])

  const finishScrub = () => {
    draggingRef.current = false
    if (draftRef.current !== null) seekTo(draftRef.current)
    draftRef.current = null
    setDraftMinute(null)
  }

  return (
    <section className="mm-time-player" data-expanded={expanded} aria-label={t.timelineTitle}>
      <div className="mm-player-toolbar">
        <button type="button" className="mm-player-play" onClick={clock.togglePause}
          aria-label={clock.paused ? t.play : t.pause} title={`${clock.paused ? t.play : t.pause} (Space)`}>
          {clock.paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
        </button>
        <span className="mm-player-heading">{t.timelineTitle}<small className="mm-mono">24H / MACAU</small></span>
        <div className="mm-player-speeds mm-mono" role="group" aria-label={t.playbackSpeed}>
          {SPEEDS.map(speed => (
            <button type="button" key={speed} onClick={() => clock.setSpeed(speed)}
              aria-pressed={clock.speed === speed}>{speed}×</button>
          ))}
        </div>
        <select className="mm-player-speed-select mm-mono" value={clock.speed}
          aria-label={t.playbackSpeed} onChange={e => clock.setSpeed(Number(e.target.value))}
          onKeyDown={e => e.stopPropagation()}>
          {SPEEDS.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
        </select>
        <button type="button" className="mm-player-now" onClick={clock.syncToNow} title={t.resetNorth}>
          <ClockIcon size={14} /><span>{t.nowShort}</span>
        </button>
        <span className="mm-player-readout">
          <span className="mm-mono mm-tabular">{timeLabel(minute)}</span>
          <small><span className="mm-clock-status-dot" data-live={clock.isLive} />{status}</small>
        </span>
        <button type="button" className="mm-player-expand" onClick={() => setExpanded(p => !p)}
          aria-expanded={expanded} aria-controls="mm-day-timeline" aria-label={expanded ? t.collapse : t.expand}>
          {expanded ? <CollapseIcon size={15} /> : <ExpandIcon size={15} />}
        </button>
      </div>

      <div className="mm-player-timeline" id="mm-day-timeline" hidden={!expanded}>
        <div className="mm-player-caption"><span>{t.timelineDensity}</span><span>{t.timelineSeek}</span></div>
        <div className="mm-player-rail">
          <div className="mm-player-wave" aria-hidden="true">
            {Array.from({ length: 96 }, (_, i) => {
              const density = sched.density[Math.floor(i / 4)]
              return <span key={i} data-elapsed={i / 96 <= minute / 1440}
                style={{ height: `${Math.max(7, density * 100)}%` }} />
            })}
          </div>
          <div className="mm-player-markers" aria-hidden="true">
            <span className="mm-player-service-start" style={{ left: `${sched.firstFrac * 100}%` }} />
            <span className="mm-player-service-end" style={{ left: `${Math.min(100, sched.lastFrac * 100)}%` }} />
            <span className="mm-player-cursor" style={{ left: `${minute / 1439 * 100}%` }} />
            <span className="mm-player-peak" style={{ left: '33.33%' }}>{t.amPeak}</span>
            <span className="mm-player-peak" style={{ left: '75%' }}>{t.pmPeak}</span>
          </div>
          <input className="mm-player-scrubber" type="range" min={0} max={1439} step={1}
            value={minute} aria-label={t.timelineSeek} aria-valuetext={timeLabel(minute)}
            onPointerDown={e => {
              draggingRef.current = true
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onChange={e => {
              const next = Number(e.target.value)
              if (draggingRef.current) {
                draftRef.current = next
                setDraftMinute(next)
              } else {
                seekTo(next)
              }
            }}
            onPointerUp={finishScrub} onBlur={finishScrub}
            onPointerCancel={() => {
              draggingRef.current = false
              draftRef.current = null
              setDraftMinute(null)
            }} />
        </div>
        <div className="mm-player-hours mm-mono" aria-hidden="true">
          {[0, 6, 12, 18, 24].map(hour => <span key={hour}>{pad2(hour)}</span>)}
        </div>
        <div className="mm-player-service">
          <span><i />{t.firstBusLabel} <b className="mm-mono">{sched.first}</b></span>
          <span>{t.lastBusLabel} <b className="mm-mono">{sched.last}</b><i /></span>
        </div>
      </div>
    </section>
  )
}
