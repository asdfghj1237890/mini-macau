import { useState, useCallback, useRef, useEffect, useMemo, useSyncExternalStore } from 'react'
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
// Whether sim time is locked to real wall time: not paused, 1× speed, and
// within 3 s of now. Centralized so consumers read `clock.isLive` instead of
// each recomputing it from Date.now() during render (which the React-purity
// lint flags, and which duplicated the threshold across five components).
function computeLive(simMs: number, paused: boolean, speed: number): boolean {
  return !paused && speed === 1 && Math.abs(simMs - Date.now()) < 3000
}

// The sim time is NOT React state. It is published through a small external
// store (`subscribeTime` / `getTimeMs`) that the ~10 Hz tick notifies, and
// only the components that render the time subscribe to it — through
// `useClockTime` (every tick) or `useClockMinute` (once per simulated
// minute). Before this the tick set a `currentTime` state on the hook, so the
// App that owns the clock — and its whole tree, the layer panel included —
// re-rendered ten times a second for a seconds digit.
export function useSimulationClock(): SimulationClock {
  // Lazy initializer (called once) keeps the impure Date.now() out of the
  // render phase while still typing the refs as plain numbers.
  const [initialNow] = useState(() => Date.now())
  const baseWallRef = useRef(initialNow)
  const baseSimRef = useRef(initialNow)
  const [speed, setSpeedState] = useState(1)
  const [paused, setPaused] = useState(false)
  const [isLive, setIsLive] = useState(() => computeLive(initialNow, false, 1))
  const timeRef = useRef(new Date())
  const listenersRef = useRef(new Set<() => void>())

  // Tell every subscribed component the time moved. Called at most every
  // UI_UPDATE_INTERVAL from the tick, and once from each jump.
  const notify = useCallback(() => {
    for (const listener of listenersRef.current) listener()
  }, [])
  const subscribeTime = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => { listenersRef.current.delete(listener) }
  }, [])
  const getTimeMs = useCallback(() => timeRef.current.getTime(), [])

  // Snapshot current sim into baseSim and peg baseWall to Date.now().
  // Callers MUST do this before mutating speed/paused so the perceived sim
  // time stays continuous across the transition. Reads the current `paused`
  // and `speed` via refs so it can be called from event handlers and the RAF
  // loop that were bound before the latest React state update flushed. The
  // refs are mirrored in effects (not during render) so they update right
  // after commit — by which point any event handler or RAF tick reads the
  // fresh value.
  const pausedRef = useRef(paused)
  const speedRef = useRef(speed)
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { speedRef.current = speed }, [speed])

  const rebase = useCallback(() => {
    const simNow = pausedRef.current
      ? baseSimRef.current
      : baseSimRef.current + (Date.now() - baseWallRef.current) * speedRef.current
    baseSimRef.current = simNow
    baseWallRef.current = Date.now()
  }, [])

  // RAF keeps timeRef fresh for per-frame consumers (sim engine, animations).
  // When the tab is visible this also notifies the time subscribers; when the
  // tab is backgrounded RAF pauses entirely, so the interval below takes over.
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
        notify()
        // Same value → React bails out, so this costs a render only when
        // the badge actually flips.
        setIsLive(computeLive(simMs, pausedRef.current, speedRef.current))
        lastUIUpdate = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [notify])

  // Independent fallback so the displayed time doesn't freeze when RAF
  // throttles (backgrounded tab, occluded window). setInterval keeps firing
  // (throttled to ~1Hz in hidden tabs, but that's enough to keep the "即時"
  // badge and visible HH:mm accurate). Also fires a fresh compute on
  // visibilitychange so the very first paint after foregrounding is already
  // current, without waiting for the next interval tick.
  useEffect(() => {
    const pump = () => {
      const simMs = pausedRef.current
        ? baseSimRef.current
        : baseSimRef.current + (Date.now() - baseWallRef.current) * speedRef.current
      const t = new Date(simMs)
      timeRef.current = t
      notify()
      setIsLive(computeLive(simMs, pausedRef.current, speedRef.current))
    }
    // While the tab is visible the RAF tick is already notifying at this
    // rate; a second notifier would double every subscriber's renders.
    const iv = setInterval(() => { if (document.visibilityState !== 'visible') pump() }, UI_UPDATE_INTERVAL)
    const onVis = () => { if (document.visibilityState === 'visible') pump() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [notify])

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
    notify()
    setSpeedState(1)
    setPaused(false)
  }, [notify])

  const setTime = useCallback((date: Date) => {
    const prev = timeRef.current.getTime()
    baseSimRef.current = date.getTime()
    baseWallRef.current = Date.now()
    timeRef.current = date
    notify()
    ga.timeJumped((date.getTime() - prev) / 3_600_000)
  }, [notify])

  return useMemo(() => ({
    timeRef, subscribeTime, getTimeMs, speed, paused, isLive, setSpeed, togglePause, syncToNow, setTime,
  }), [subscribeTime, getTimeMs, speed, paused, isLive, setSpeed, togglePause, syncToNow, setTime])
}

// The start of the simulated minute an instant falls in. Minute boundaries
// are the same in UTC and Macau time (a whole-hour offset), so flooring the
// epoch is enough.
export function clockMinuteMs(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000
}

// The simulated time, re-rendering the caller on every tick (~10 Hz). For
// the components that SHOW the time — the clock face, the scrubber.
export function useClockTime(clock: SimulationClock): Date {
  const ms = useSyncExternalStore(clock.subscribeTime, clock.getTimeMs, clock.getTimeMs)
  return useMemo(() => new Date(ms), [ms])
}

// The simulated time at minute resolution, re-rendering the caller only when
// the simulated minute changes — once a second at 60×, once a minute at 1×.
// For everything that DECIDES by the time: which routes are in service, which
// day's flights, which timetable, a panel's ETA.
export function useClockMinute(clock: SimulationClock): Date {
  const minuteMs = useSyncExternalStore(
    clock.subscribeTime,
    () => clockMinuteMs(clock.getTimeMs()),
    () => clockMinuteMs(clock.getTimeMs()),
  )
  return useMemo(() => new Date(minuteMs), [minuteMs])
}
