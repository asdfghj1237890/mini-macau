import type { VehiclePosition } from '../types'
import { busesConflict } from './busTraffic'
import { BUS_TRACE_STRIDE as STRIDE, type BusDetailView, type BusMotionTrace } from './busMotionTrace'

type Chunk = { trace: BusMotionTrace; vehicles: Map<string, VehiclePosition> }
const LNG_M = 111320 * Math.cos(22.19 * Math.PI / 180)

function overlaps(vehicles: VehiclePosition[], view?: BusDetailView): boolean {
  if (view && !view.bounds && !view.trackedId) return false
  // Offscreen markers have only coarse traces. Their interpolation must not
  // stop visible models; test every pair involving a rendered/tracked body.
  // The worker checks traffic throughout the surrounding approach buffer.
  const visible = (v: VehiclePosition) => {
    if (!view || v.id === view.trackedId) return true
    const b = view.bounds, [x, y] = v.coordinates
    return !!b && x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3]
  }
  const cells = new Map<number, VehiclePosition[]>()
  for (const v of vehicles) {
    const x = Math.floor((v.coordinates[0] - 113.54) * LNG_M / 64)
    const y = Math.floor((v.coordinates[1] - 22.19) * 111320 / 64)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of cells.get((x + dx) * 1048576 + y + dy) ?? []) {
        if ((visible(v) || visible(other)) && busesConflict(v, other, 0)) return true
      }
    }
    const key = x * 1048576 + y
    let cell = cells.get(key)
    if (!cell) { cell = []; cells.set(key, cell) }
    cell.push(v)
  }
  return false
}

function interpolate(chunk: Chunk, timeMs: number, clockMs: number): VehiclePosition[] {
  const result: VehiclePosition[] = []
  for (const path of chunk.trace.paths) {
    const v = chunk.vehicles.get(path.id), p = path.points
    if (!v || !p.length || timeMs < p[0]) continue
    const count = p.length / STRIDE
    let low = 0, high = count - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (p[mid * STRIDE] <= timeMs) low = mid
      else high = mid - 1
    }
    const a = low * STRIDE, b = Math.min(low + 1, count - 1) * STRIDE
    const f = b === a ? 0 : Math.max(0, Math.min(1, (timeMs - p[a]) / (p[b] - p[a])))
    const mix = (axis: number) => p[a + axis] + (p[b + axis] - p[a + axis]) * f
    const angle = ((p[b + 3] - p[a + 3] + 540) % 360) - 180
    result.push({ ...v, coordinates: [mix(1), mix(2)], bearing: p[a + 3] + angle * f, progress: mix(4),
      busMotion: v.busMotion ? { ...v.busMotion, dirSec: mix(5), speedKmh: p[a + 7] === 1 ? 0 : mix(6),
        phase: p[a + 7] === 1 ? 'stopped' : p[a + 7] === 2 ? 'queued' : 'cruising',
        delaySec: mix(8) + Math.max(0, clockMs - timeMs) / 1000 } : undefined })
  }
  return result
}

/** A short, bounded presentation buffer. Every bus uses the same playhead;
 * no dead reckoning through a stop, crossing or a not-yet-computed route. */
export class BusPlayback {
  private chunks: Chunk[] = []
  private latest: VehiclePosition[] = []
  private latestWithLag: VehiclePosition[] = []
  private latestLag = NaN
  private endMs = NaN
  private displayMs = NaN
  private delayMs = 120
  private lastAt = NaN
  private lastClock = NaN
  private receivedAt = NaN
  private following = false
  private lastRate = 0
  private rendered: VehiclePosition[] = []

  clear(): void {
    this.chunks = []; this.latest = []; this.latestWithLag = []; this.rendered = []
    this.latestLag = NaN
    this.endMs = this.displayMs = this.lastAt = this.lastClock = this.receivedAt = NaN
    this.delayMs = 120
    this.following = false
    this.lastRate = 0
  }

  accept(vehicles: VehiclePosition[], trace: BusMotionTrace | undefined, now: number, turnaround: number): void {
    this.latest = vehicles
    this.latestLag = NaN
    const active = new Set(vehicles.map(v => v.id))
    this.rendered = this.rendered.filter(v => active.has(v.id))
    for (const chunk of this.chunks) for (const id of chunk.vehicles.keys()) if (!active.has(id)) chunk.vehicles.delete(id)
    if (!trace || trace.startMs === trace.endMs || trace.startMs !== this.endMs) {
      this.chunks = []; this.rendered = vehicles
      this.displayMs = trace?.endMs ?? NaN
    } else {
      this.chunks.push({ trace, vehicles: new Map(vehicles.map(v => [v.id, v])) })
      // Account for ordinary worker jitter, with at most 600 ms of deliberate
      // buffering. Cold initialization does not become a permanent delay.
      const interval = Number.isFinite(this.receivedAt) ? now - this.receivedAt : turnaround
      this.delayMs = Math.min(600, Math.max(80, this.delayMs * .95, turnaround * 1.5, interval * 1.2))
      if (this.chunks.length > 32) this.chunks.shift()
    }
    this.endMs = trace?.endMs ?? NaN
    this.receivedAt = now
  }

  sample(clockMs: number, now: number, speed?: number, view?: BusDetailView): VehiclePosition[] {
    const elapsed = now - this.lastAt
    const rate = speed ?? (elapsed > 0 ? Math.max(0, Math.min(60, (clockMs - this.lastClock) / elapsed)) : 0)
    // A speed change rebases the buffer in simulated time. Otherwise dropping
    // from 60× to 1× would take minutes to consume the old high-speed delay.
    if (rate !== this.lastRate) this.following = false
    this.lastRate = rate
    this.lastAt = now; this.lastClock = clockMs
    // Pausing flushes the final checked position and freezes it exactly.
    if (!rate || !this.chunks.length) {
      this.displayMs = this.endMs
      // A held worker may still be behind the clock. Keep that delay in the
      // info panel without moving the frozen fleet or reallocating each frame.
      const lag = Number.isFinite(this.endMs) ? Math.max(0, clockMs - this.endMs) / 1000 : 0
      if (lag !== this.latestLag) {
        this.latestLag = lag
        this.latestWithLag = lag ? this.latest.map(v => v.busMotion
          ? { ...v, busMotion: { ...v.busMotion, delaySec: v.busMotion.delaySec + lag } } : v) : this.latest
      }
      this.rendered = this.latestWithLag
      if (!rate) this.chunks = []
      this.following = false
      return this.rendered
    }
    let wanted = clockMs - this.delayMs * rate
    // Grow/reduce the buffer by gently changing pace. Moving the target
    // backwards after a slow reply used to freeze a whole fleet that already
    // had checked movement available, compounding the original worker stall.
    if (this.following) {
      const step = Math.max(0, elapsed) * rate
      wanted = Math.max(this.displayMs + step * .8, Math.min(this.displayMs + step * 1.2, wanted))
    }
    const timeMs = Math.max(this.displayMs, Math.min(this.endMs, Math.max(wanted, this.chunks[0].trace.startMs)))
    this.following = true
    if (timeMs === this.displayMs) return this.rendered
    const chunk = this.chunks.find(c => c.trace.endMs >= timeMs) ?? this.chunks.at(-1)!
    let presentedMs = timeMs
    let result = interpolate(chunk, presentedMs, clockMs)
    if (overlaps(result, view)) {
      // Interpolating two clear rotations can still intersect a curved queue.
      // Advance the WHOLE fleet to the next checked physics endpoint, never
      // individually extrapolate/stop one bus into another's swept path.
      presentedMs = chunk.trace.steps.find(t => t >= timeMs) ?? chunk.trace.endMs
      result = interpolate(chunk, presentedMs, clockMs)
      if (overlaps(result, view)) { result = [...chunk.vehicles.values()]; presentedMs = chunk.trace.endMs }
    }
    this.displayMs = presentedMs; this.rendered = result
    while (this.chunks.length > 1 && this.chunks[0].trace.endMs < presentedMs) this.chunks.shift()
    return result
  }
}
