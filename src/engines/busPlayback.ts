import type { VehiclePosition } from '../types'
import { busesConflict } from './busTraffic'
import { BUS_TRACE_STRIDE as STRIDE, type BusDetailView, type BusMotionTrace } from './busMotionTrace'

type Chunk = { trace: BusMotionTrace; vehicles: Map<string, VehiclePosition> }
const LNG_M = 111320 * Math.cos(22.19 * Math.PI / 180)
// Pace correction: no correction within the dead band, then proportional,
// reaching the 0.8×/1.2× limits PACE_HORIZON_MS beyond it (all in real ms).
export const PACE_DEAD_BAND_MS = 40
const PACE_HORIZON_MS = 800
// Scheduling slack on top of the measured delivery interval and round trip:
// a request leaves on the first frame after its boundary and its reply is
// consumed on the frame after it lands.
const BUFFER_SLACK_MS = 80

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

  /** The playhead's distance behind the clock, in real milliseconds. */
  lagMs(clockMs: number, rate: number): number {
    return rate > 0 && Number.isFinite(this.displayMs) ? Math.max(0, clockMs - this.displayMs) / rate : 0
  }
  get targetDelayMs(): number { return this.delayMs }

  /** `expectedMs`: the caller's estimate of the next chunk's delivery interval
   * plus round trip when that differs from this chunk's (a batch period). */
  accept(vehicles: VehiclePosition[], trace: BusMotionTrace | undefined, now: number, turnaround: number, expectedMs = 0): void {
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
      // The next chunk lands one delivery interval plus a worker round trip
      // after this one (an aligned fast-playback batch first waits for the
      // clock to reach its boundary), plus scheduling slack. Sizing the buffer
      // at 1.2× the interval alone starved the playhead at 30–60×: it froze
      // for a frame or three every second or two, then ran at 1.2× to catch
      // up. At most 600 ms of deliberate buffering, and cold initialization
      // does not become a permanent delay.
      const interval = Number.isFinite(this.receivedAt) ? now - this.receivedAt : turnaround
      this.delayMs = Math.min(600, Math.max(80, this.delayMs * .95, interval + turnaround * 1.25 + BUFFER_SLACK_MS, expectedMs))
      if (this.chunks.length > 32) this.chunks.shift()
    }
    this.endMs = trace?.endMs ?? NaN
    this.receivedAt = now
  }

  sample(clockMs: number, now: number, speed?: number, view?: BusDetailView): VehiclePosition[] {
    const elapsed = now - this.lastAt
    const rate = speed ?? (elapsed > 0 ? Math.max(0, Math.min(60, (clockMs - this.lastClock) / elapsed)) : 0)
    // Slowing down rebases the buffer in simulated time. Otherwise dropping
    // from 60× to 1× would take minutes to consume the old high-speed delay.
    // Speeding up keeps following: the buffer grows by easing the pace.
    if (rate < this.lastRate) this.following = false
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
    // The correction is proportional with a dead band: a target that jitters
    // by a frame no longer swings the whole fleet between 0.8× and 1.2× in
    // second-long runs; only a real drift (a slow reply, a speed change) is
    // corrected, and gently. Catching up (running faster than the clock)
    // needs a buffer that outlasts the next delivery gap, or the playhead
    // runs into the end of the checked movement every batch and stalls.
    if (this.following) {
      const step = Math.max(0, elapsed) * rate
      const error = (wanted - this.displayMs - step) / rate
      const headroom = (this.endMs - this.displayMs) / rate
      const pace = Math.abs(error) <= PACE_DEAD_BAND_MS || error > 0 && headroom < this.delayMs ? 1
        : Math.max(.8, Math.min(1.2, 1 + (error - Math.sign(error) * PACE_DEAD_BAND_MS) / PACE_HORIZON_MS))
      wanted = this.displayMs + step * pace
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
