import { useState, useCallback, useRef, useEffect } from 'react'
import type { SimulationClock } from '../types'
import { ga } from '../analytics/ga'

const UI_UPDATE_INTERVAL = 100

// Offset-based wall clock. The sim time is computed fresh every read from
// Date.now() plus the accumulated offset — not by summing RAF deltas. That
// means background/throttled tabs (where RAF is paused or throttled) can't
// make the clock drift: when the tab resumes, Date.now() is already correct
// and the sim reflects wall time exactly, as long as the user hasn't paused,
// changed speed, or scrubbed.
//
// Baseline invariants:
//   baseWallRef = wall time (ms) at the last resync point
//   baseSimRef  = sim time (ms) at that same resync point
//   speed       = sim-seconds per wall-second (1× = realtime, 10× = 10× fast)
//   paused      = when true, sim time is frozen at baseSim
//
// Current sim time:
//   paused  → baseSim
//   running → baseSim + (Date.now() - baseWall) * speed
//
// "Live" (sim == wall time) iff !paused && speed === 1 && baseSim === baseWall.
export function useSimulationClock(): SimulationClock {
  const baseWallRef = useRef(Date.now())
  const baseSimRef = useRef(Date.now())
  const [speed, setSpeedState] = useState(1)
  const [paused, setPaused] = useState(false)
  const [displayTime, setDisplayTime] = useState(() => new Date())
  const timeRef = useRef(new Date())

  // Snapshot current sim into baseSim and peg baseWall to Date.now().
  // Callers MUST do this before mutating speed/paused so the perceived sim
  // time stays continuous across the transition. Reads the current `paused`
  // and `speed` via refs so it can be called from event handlers that were
  // bound before the latest React state update flushed.
  const pausedRef = useRef(paused)
  const speedRef = useRef(speed)
  pausedRef.current = paused
  speedRef.current = speed

  const rebase = useCallback(() => {
    const simNow = pausedRef.current
      ? baseSimRef.current
      : baseSimRef.current + (Date.now() - baseWallRef.current) * speedRef.current
    baseSimRef.current = simNow
    baseWallRef.current = Date.now()
  }, [])

  // RAF keeps timeRef fresh for per-frame consumers (sim engine, animations).
  // When the tab is visible this also drives setDisplayTime; when the tab is
  // backgrounded RAF pauses entirely, so the interval below takes over.
  useEffect(() => {
    let raf: number
    let lastUIUpdate = performance.now()
    const tick = (now: number) => {
      const simMs = pausedRef.current
        ? baseSimRef.current
        : baseSimRef.current + (Date.now() - baseWallRef.current) * speedRef.current
      const t = new Date(simMs)
      timeRef.current = t
      if (now - lastUIUpdate >= UI_UPDATE_INTERVAL) {
        setDisplayTime(t)
        lastUIUpdate = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Independent fallback so `displayTime` doesn't freeze when RAF throttles
  // (backgrounded tab, occluded window). setInterval keeps firing (throttled
  // to ~1Hz in hidden tabs, but that's enough to keep the "即時" badge and
  // visible HH:mm accurate). Also fires a fresh compute on visibilitychange
  // so the very first paint after foregrounding is already current, without
  // waiting for the next interval tick.
  useEffect(() => {
    const pump = () => {
      const simMs = pausedRef.current
        ? baseSimRef.current
        : baseSimRef.current + (Date.now() - baseWallRef.current) * speedRef.current
      const t = new Date(simMs)
      timeRef.current = t
      setDisplayTime(t)
    }
    const iv = setInterval(pump, UI_UPDATE_INTERVAL)
    const onVis = () => { if (document.visibilityState === 'visible') pump() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const setSpeed = useCallback((s: number) => {
    rebase()
    setSpeedState(s)
    ga.simSpeedChanged(s)
  }, [rebase])

  const togglePause = useCallback(() => {
    rebase()
    setPaused(p => {
      ga.simPauseToggled(!p)
      return !p
    })
  }, [rebase])

  // Re-lock the sim to wall time: sim = Date.now(), speed = 1, not paused.
  // This is what "live" means. Pressing NOW / live-sync must get you here
  // regardless of prior state.
  const syncToNow = useCallback(() => {
    const now = Date.now()
    baseSimRef.current = now
    baseWallRef.current = now
    timeRef.current = new Date(now)
    setDisplayTime(new Date(now))
    setSpeedState(1)
    setPaused(false)
  }, [])

  const setTime = useCallback((date: Date) => {
    const prev = timeRef.current.getTime()
    baseSimRef.current = date.getTime()
    baseWallRef.current = Date.now()
    timeRef.current = date
    setDisplayTime(date)
    ga.timeJumped((date.getTime() - prev) / 3_600_000)
  }, [])

  return { currentTime: displayTime, timeRef, speed, paused, setSpeed, togglePause, syncToNow, setTime }
}
