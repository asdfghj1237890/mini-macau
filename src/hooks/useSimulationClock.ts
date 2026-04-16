import { useState, useCallback, useRef, useEffect } from 'react'
import type { SimulationClock } from '../types'

export function useSimulationClock(): SimulationClock {
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [speed, setSpeedState] = useState(1)
  const [paused, setPaused] = useState(false)
  const lastTickRef = useRef(performance.now())

  useEffect(() => {
    let raf: number
    const tick = (now: number) => {
      if (!paused) {
        const delta = now - lastTickRef.current
        setCurrentTime(prev => new Date(prev.getTime() + delta * speed))
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
    setCurrentTime(new Date())
    lastTickRef.current = performance.now()
  }, [])

  return { currentTime, speed, paused, setSpeed, togglePause, reset }
}
