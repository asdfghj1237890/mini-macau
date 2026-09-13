import { LrtStateWindowSchema, LRT_WINDOW_STEP_MS, lrtWindowAt, lrtWindowStart, type LrtStateWindow } from './lrtState'

export async function fetchLrtWindow(start: number, signal: AbortSignal): Promise<LrtStateWindow> {
  const base = /^(?:[a-z0-9-]+\.)?mini-map-macau\.pages\.dev$/.test(window.location.hostname)
    ? 'https://mini-map-macau.app' : ''
  const response = await fetch(`${base}/api/lrt/state?at=${start}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), cache: 'no-store',
  })
  if (!response.ok) throw new Error(`LRT state HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 1_000_000) throw new Error('LRT state too large')
  const parsed = LrtStateWindowSchema.parse(JSON.parse(text))
  if (parsed.start !== start) throw new Error('LRT state time mismatch')
  return parsed
}

type Snapshot = { lrtWindows: LrtStateWindow[]; lrtStateStatus: 'loading' | 'ready' | 'error' }

export class LrtStateStore {
  private snapshot: Snapshot = { lrtWindows: [], lrtStateStatus: 'loading' }
  private listeners = new Set<() => void>()
  private pending?: { start: number; controller: AbortController }
  private retryAt = 0
  private failures = 0
  private time = 0
  private alive = true
  private fetchWindow: typeof fetchLrtWindow
  private wallTime: () => number
  constructor(fetchWindow = fetchLrtWindow, wallTime = () => Date.now()) { this.fetchWindow = fetchWindow; this.wallTime = wallTime }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(windows: LrtStateWindow[], status: Snapshot['lrtStateStatus']) {
    if (status === this.snapshot.lrtStateStatus && windows.length === this.snapshot.lrtWindows.length
      && windows.every((w, i) => w === this.snapshot.lrtWindows[i])) return
    this.snapshot = { lrtWindows: windows, lrtStateStatus: status }
    this.listeners.forEach(listener => listener())
  }
  update(time: number, speed: number, paused: boolean) {
    this.alive = true
    this.time = time
    const start = lrtWindowStart(time), next = start + LRT_WINDOW_STEP_MS
    const windows = this.snapshot.lrtWindows.filter(w => w.end > time && w.start <= next && w.start >= start - LRT_WINDOW_STEP_MS).slice(-2)
    const covering = lrtWindowAt(windows, time)
    this.publish(windows, covering ? 'ready' : this.failures ? 'error' : 'loading')
    if (this.pending && this.pending.start !== start && this.pending.start !== next) {
      this.pending.controller.abort(); this.pending = undefined
    }
    if (this.pending || this.wallTime() < this.retryAt) return
    const target = !windows.some(w => w.start === start) ? start
      : !paused && time >= next - Math.max(15_000, speed * 1000) && !windows.some(w => w.start === next) ? next : null
    if (target === null) return
    const pending = { start: target, controller: new AbortController() }
    this.pending = pending
    // Bound request frequency during scrubs as well as normal playback.
    this.retryAt = this.wallTime() + 250
    void this.fetchWindow(target, pending.controller.signal).then(window => {
      if (!this.alive || this.pending !== pending) return
      this.failures = 0
      const merged = [...this.snapshot.lrtWindows.filter(w => w.start !== window.start), window].sort((a, b) => a.start - b.start).slice(-2)
      this.publish(merged, lrtWindowAt(merged, this.time) ? 'ready' : 'loading')
    }).catch(() => {
      if (!this.alive || this.pending !== pending) return
      this.failures++
      this.retryAt = this.wallTime() + Math.min(30_000, 2000 * 2 ** Math.min(this.failures - 1, 4))
      this.publish(this.snapshot.lrtWindows, lrtWindowAt(this.snapshot.lrtWindows, this.time) ? 'ready' : 'error')
    }).finally(() => {
      if (this.pending === pending) this.pending = undefined
    })
  }
  dispose() { this.alive = false; this.pending?.controller.abort(); this.pending = undefined }
}
