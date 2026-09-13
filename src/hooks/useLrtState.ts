import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SimulationClock } from '../types'
import { LrtStateStore } from '../lrtStateStore'

export function useLrtState(clock: SimulationClock) {
  const [store] = useState(() => new LrtStateStore())
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => {
    const update = () => store.update(clock.readTimeMs(), clock.speed, clock.paused)
    update()
    const unsubscribe = clock.subscribeTime(update)
    const retry = setInterval(update, 500)
    return () => { unsubscribe(); clearInterval(retry); store.dispose() }
  }, [clock, store])
  return snapshot
}
