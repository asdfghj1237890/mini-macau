import { describe, expect, it, vi } from 'vitest'
import { LrtStateStore } from './lrtStateStore'
import { lrtWindowAt, type LrtStateWindow } from './lrtState'

const base = Date.parse('2026-05-04T10:00:00+08:00')
const windowFor = (start: number): LrtStateWindow => ({ version: 1, start, end: start + 120_000, vehicles: [], service: [] })
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('LRT state loading', () => {
  it('prefetches at 60×, keeps at most two windows and stays covered at transitions', async () => {
    let wall = 0
    const fetch = vi.fn(async (start: number) => windowFor(start))
    const store = new LrtStateStore(fetch, () => wall)
    for (wall = 0; wall <= 30_000; wall += 100) {
      const time = base + wall * 60
      store.update(time, 60, false)
      await settle()
      const snapshot = store.getSnapshot()
      expect(snapshot.lrtWindows.length).toBeLessThanOrEqual(2)
      expect(lrtWindowAt(snapshot.lrtWindows, time)).toBeDefined()
    }
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(32)
  })

  it('aborts stale scrubs and discards their late replies', async () => {
    let wall = 0
    const requests: { start: number; signal: AbortSignal; resolve: (window: LrtStateWindow) => void }[] = []
    const store = new LrtStateStore((start, signal) => new Promise(resolve => requests.push({ start, signal, resolve })), () => wall)
    store.update(base, 1, false)
    wall = 1000
    store.update(base + 86400000, 1, false)
    expect(requests[0].signal.aborted).toBe(true)
    requests[1].resolve(windowFor(requests[1].start)); await settle()
    requests[0].resolve(windowFor(base)); await settle()
    expect(store.getSnapshot().lrtWindows.map(w => w.start)).toEqual([base + 86400000])
  })

  it('does not prefetch while paused, but retries failures with backoff without clock advancement', async () => {
    let wall = 0
    const fetch = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue(windowFor(base))
    const store = new LrtStateStore(fetch, () => wall)
    store.update(base + 59000, 60, true); await settle()
    expect(store.getSnapshot().lrtStateStatus).toBe('error')
    for (wall = 100; wall < 2000; wall += 100) store.update(base + 59000, 60, true)
    expect(fetch).toHaveBeenCalledTimes(1)
    store.update(base + 59000, 60, true); await settle()
    wall = 10000; store.update(base + 59000, 60, true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().lrtStateStatus).toBe('ready')
  })

  it('uses only the overlap while the network is late, then clears expired states', async () => {
    let wall = 0
    const fetch = vi.fn().mockResolvedValueOnce(windowFor(base)).mockImplementation(() => new Promise(() => {}))
    const store = new LrtStateStore(fetch, () => wall)
    store.update(base, 60, false); await settle()
    wall = 1000; store.update(base + 60_000, 60, false)
    expect(lrtWindowAt(store.getSnapshot().lrtWindows, base + 60_000)).toBeDefined()
    wall = 2000; store.update(base + 120_000, 60, false)
    expect(store.getSnapshot().lrtWindows).toHaveLength(0)
    expect(store.getSnapshot().lrtStateStatus).toBe('loading')
    store.dispose()
  })
})
