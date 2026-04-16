import { useState, useCallback, useRef, useEffect } from 'react'
import type { SimulationClock } from '../types'

const UI_UPDATE_INTERVAL = 100

export function useSimulationClock(): SimulationClock {
  const [displayTime, setDisplayTime] = useState(() => new Date())
  const [speed, setSpeedState] = useState(1)
  const [paused, setPaused] = useState(false)
  const lastTickRef = useRef(performance.now())
  const lastUIUpdateRef = useRef(performance.now())
  const timeRef = useRef(new Date())

  useEffect(() => {
    let raf: number
    const tick = (now: number) => {
      if (!paused) {
        const delta = now - lastTickRef.current
        const newTime = new Date(timeRef.current.getTime() + delta * speed)
        timeRef.current = newTime

        if (now - lastUIUpdateRef.current >= UI_UPDATE_INTERVAL) {
          setDisplayTime(newTime)
          lastUIUpdateRef.current = now
        }
      }
      lastTickRef.current = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [speed, paused])

  const setSpeed = useCallback((s: number) => setSpeedState(s), [])
  const togglePause = useCallback(() => setPaused(p => !p), [])
  const reset = useCallback(() => {
    const now = new Date()
    timeRef.current = now
    setDisplayTime(now)
    lastTickRef.current = performance.now()
  }, [])

  const setTime = useCallback((date: Date) => {
    timeRef.current = date
    setDisplayTime(date)
    lastTickRef.current = performance.now()
  }, [])

  return { currentTime: displayTime, timeRef, speed, paused, setSpeed, togglePause, reset, setTime }
}
