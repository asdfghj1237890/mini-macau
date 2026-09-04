import { useEffect, useRef, useState } from 'react'
import { PowerDistributionFileSchema, parseData } from '../dataSchemas'
import type { PowerDistributionFile } from '../types'

// power-distribution.json is Macau's own street network, drawn as the thin
// distribution feeders under the schematic HV corridors. It is ~0.5 MB and only
// the POWER layer ever wants it, so — like its water twin, and unlike every
// other dataset — it is NOT part of useTransitData's startup fetch: this hook
// pulls it the first time the layer goes on, and keeps it for the rest of the
// session.
//
// Best-effort by design. A missing or malformed file leaves the thin feeders
// out and logs once; the HV corridors, the facility blocks and the markers are
// unaffected, because they come from a different file entirely.
const PATH = '/data/power-distribution.json'

export function usePowerDistribution(enabled: boolean): PowerDistributionFile | null {
  const [file, setFile] = useState<PowerDistributionFile | null>(null)
  // "A fetch has been started", not "a fetch has finished" — so a second toggle
  // (or a re-render while the first request is still in flight) never issues a
  // second request. Never reset: the data has no time dimension.
  //
  // Deliberately NO cancellation flag, for the same reason as
  // useWaterDistribution: StrictMode mounts every effect twice in dev, and an
  // unmount-scoped "cancelled" ref would be set by the first teardown and never
  // cleared — the guard above makes the second pass a no-op, so the in-flight
  // response would be thrown away and the layer would stay empty. A setState
  // after unmount is a harmless no-op in React 18+, the cheaper trade here.
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled || startedRef.current) return
    startedRef.current = true
    fetch(PATH)
      .then(res => {
        if (!res.ok) throw new Error(`fetch ${PATH} → HTTP ${res.status}`)
        return res.json()
      })
      .then((raw: unknown) => {
        setFile(parseData<PowerDistributionFile>(
          PowerDistributionFileSchema, raw, 'power-distribution.json',
        ))
      })
      .catch((err: unknown) => {
        console.warn('[power] distribution network unavailable:', err)
      })
  }, [enabled])

  return file
}
