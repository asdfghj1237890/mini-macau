export interface DsatBusInfo {
  busType: string
  busCode: string
  busPlate: string
  status: string
  isFacilities: string
  passengerFlow: string
  speed: string
}

export interface DsatStationInfo {
  staCode: string
  busInfo: DsatBusInfo[]
}

export interface DsatRouteResponse {
  data: {
    lastBusType: string
    badCar: string
    lastBusPlate: string
    toBeginBus: string
    busColor: string
    routeInfo: DsatStationInfo[]
  }
  header: string
}

export interface BusObservation {
  plate: string
  busCode: string
  staCode: string
  stopIndex: number
  status: string
  speed: number
  observedAt: number
}

interface BatchItem {
  key: string
  status: number
  data: DsatRouteResponse | null
}

async function fetchBatch(keys: string[]): Promise<BatchItem[] | null> {
  if (keys.length === 0) return []
  const url = '/api/dsat/batch?routes=' + encodeURIComponent(keys.join(','))
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const json = (await r.json()) as unknown
    if (!Array.isArray(json)) return null
    return json as BatchItem[]
  } catch {
    return null
  }
}

export function extractObservations(resp: DsatRouteResponse, now = Date.now()): BusObservation[] {
  const out: BusObservation[] = []
  resp.data.routeInfo.forEach((station, stopIndex) => {
    for (const b of station.busInfo) {
      if (!b.busPlate) continue
      out.push({
        plate: b.busPlate,
        busCode: b.busCode,
        staCode: station.staCode,
        stopIndex,
        status: b.status,
        speed: parseInt(b.speed || '0', 10),
        observedAt: now,
      })
    }
  })
  return out
}

type Subscriber = (obs: BusObservation[], raw: DsatRouteResponse) => void

// Adaptive cadence: a poller that returns zero buses ADAPTIVE_EMPTY_THRESHOLD
// ticks in a row drops from every-tick to every-Nth-tick participation in
// the batch. Keeps night-route / idle-route cost near zero without losing
// the first-observation latency once buses start running.
const ADAPTIVE_EMPTY_THRESHOLD = 3
const SLOW_TICK_FACTOR = 4

class BusRealtimeBatcher {
  private readonly pollers = new Map<string, RouteRealtimePoller>()
  private timer: number | null = null
  private readonly tickMs: number = 15_000
  private tickCounter = 0
  private firstKickTimer: number | null = null

  register(p: RouteRealtimePoller): void {
    this.pollers.set(p.key, p)
    this.ensureRunning()
  }

  unregister(p: RouteRealtimePoller): void {
    this.pollers.delete(p.key)
    if (this.pollers.size === 0) this.stopTimer()
  }

  private ensureRunning(): void {
    if (this.timer !== null || this.firstKickTimer !== null) return
    // Give the app ~500 ms after the first poller registers before the first
    // batch fires, so a burst of register() calls during startup collapses
    // into a single batch instead of triggering a mid-startup fetch.
    this.firstKickTimer = window.setTimeout(() => {
      this.firstKickTimer = null
      void this.fire()
      this.timer = window.setInterval(() => { void this.fire() }, this.tickMs)
    }, 500)
  }

  private stopTimer(): void {
    if (this.firstKickTimer !== null) {
      clearTimeout(this.firstKickTimer)
      this.firstKickTimer = null
    }
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async fire(): Promise<void> {
    if (typeof document !== 'undefined' && document.hidden) return
    const tick = ++this.tickCounter
    const participating: RouteRealtimePoller[] = []
    for (const p of this.pollers.values()) {
      if (p._shouldParticipate(tick)) participating.push(p)
    }
    if (participating.length === 0) return
    const keys = participating.map(p => p.key)
    const results = await fetchBatch(keys)
    const now = Date.now()
    if (!results) return
    const byKey = new Map<string, BatchItem>()
    for (const r of results) byKey.set(r.key, r)
    for (const p of participating) {
      const r = byKey.get(p.key)
      if (!r || r.status !== 200 || !r.data || r.data.header !== '000') continue
      p._deliver(r.data, now)
    }
  }
}

const batcher = new BusRealtimeBatcher()

export class RouteRealtimePoller {
  readonly routeName: string
  readonly dir: 0 | 1
  readonly key: string
  private running = false
  private paused = false
  private emptyStreak = 0
  // Stagger slow-cadence pollers across the 4-tick cycle so we don't dump
  // all idle routes into the same batch.
  private readonly slowOffset: number
  private subs = new Set<Subscriber>()
  private lastObs: BusObservation[] = []

  constructor(routeName: string, dir: 0 | 1, _intervalMs?: number) {
    this.routeName = routeName
    this.dir = dir
    this.key = `${routeName}:${dir}`
    let h = 0
    for (let i = 0; i < this.key.length; i++) h = (h * 31 + this.key.charCodeAt(i)) | 0
    this.slowOffset = Math.abs(h) % SLOW_TICK_FACTOR
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }

  getLatest(): BusObservation[] { return this.lastObs }

  start(): void {
    if (this.running) return
    this.running = true
    this.paused = false
    batcher.register(this)
  }

  pause(): void { this.paused = true }

  resume(): void { this.paused = false }

  stop(): void {
    this.running = false
    batcher.unregister(this)
  }

  _shouldParticipate(tick: number): boolean {
    if (!this.running || this.paused) return false
    if (this.emptyStreak >= ADAPTIVE_EMPTY_THRESHOLD) {
      return ((tick % SLOW_TICK_FACTOR) === this.slowOffset)
    }
    return true
  }

  _deliver(resp: DsatRouteResponse, now: number): void {
    const obs = extractObservations(resp, now)
    if (obs.length === 0) this.emptyStreak++
    else this.emptyStreak = 0
    this.lastObs = obs
    for (const fn of this.subs) fn(obs, resp)
  }
}

export interface TrackedBusState {
  plate: string
  busCode: string
  lastStopIdx: number
  lastProgress: number
  lastAt: number
  prevStopIdx: number | null
  prevProgress: number | null
  prevAt: number | null
  firstSeenAt: number
  speed: number
  status: string
  transitionFromProgress: number | null
  transitionStartAt: number | null
}

const STALE_MS = 60_000
const TRANSITION_MS = 2_500
// How long after the last observation we still trust dead-reckoning to
// advance the bus. Past this we assume the feed is stale and freeze
// the position instead of flying the bus off into the sunset.
const DR_MAX_AGE_MS = 45_000
// City-bus hard cap on reported speed (km/h). DSAT occasionally returns
// garbage like 99 or stale speeds from a previous segment.
const DR_SPEED_CAP_KMH = 60
// DSAT reports instantaneous speed, which doesn't account for the traffic
// lights, congestion, and stop dwells the bus will hit between polls. Using
// it at face value makes the map bus race ahead and "arrive" at the next
// stop 3–4 minutes before the feed actually confirms it. Scale down so the
// DR bus stays behind the real bus until the next observation catches up.
const DR_SPEED_SCALE = 0.4
// Leave a tiny gap before the next stop so the bus never appears to
// "arrive" without an actual observation confirming it.
const DR_STOP_EPSILON = 0.0005

export class BusTracker {
  private readonly stopProgress: number[]
  private readonly isCircular: boolean
  private readonly totalKm: number
  private buses = new Map<string, TrackedBusState>()
  private cachedStates: TrackedBusState[] | null = null

  constructor(stopProgress: number[], isCircular: boolean, totalKm: number = 0) {
    this.stopProgress = stopProgress
    this.isCircular = isCircular
    this.totalKm = totalKm
  }

  ingest(obs: BusObservation[], now: number = Date.now()): void {
    for (const o of obs) {
      const prog = this.stopProgress[o.stopIndex] ?? 0
      const existing = this.buses.get(o.plate)
      if (!existing) {
        this.buses.set(o.plate, {
          plate: o.plate,
          busCode: o.busCode,
          lastStopIdx: o.stopIndex,
          lastProgress: prog,
          lastAt: o.observedAt,
          prevStopIdx: null,
          prevProgress: null,
          prevAt: null,
          firstSeenAt: o.observedAt,
          speed: o.speed,
          status: o.status,
          transitionFromProgress: null,
          transitionStartAt: null,
        })
      } else {
        // Snapshot the current dead-reckoned position *before* rewriting any
        // state. This is what the user currently sees; tween/baseline must
        // start from here to avoid visible backward jumps.
        const currentEstimate = this.estimateProgress(existing, o.observedAt)
        if (o.stopIndex !== existing.lastStopIdx) {
          existing.transitionFromProgress = currentEstimate
          existing.transitionStartAt = o.observedAt
          existing.prevStopIdx = existing.lastStopIdx
          existing.prevProgress = existing.lastProgress
          existing.prevAt = existing.lastAt
          existing.lastStopIdx = o.stopIndex
          existing.lastProgress = prog
          existing.lastAt = o.observedAt
          existing.speed = o.speed
          existing.status = o.status
        } else {
          // Same-stop re-observation: "commit" the DR progress so the next
          // estimateProgress call continues forward from the visible
          // position instead of snapping back to the stop itself.
          existing.lastProgress = currentEstimate
          existing.lastAt = o.observedAt
          existing.speed = o.speed
          existing.status = o.status
          // Clear any stale transition; we're now fully DR-driven.
          existing.transitionFromProgress = null
          existing.transitionStartAt = null
        }
      }
    }
    for (const [plate, state] of this.buses) {
      if (now - state.lastAt > STALE_MS) this.buses.delete(plate)
    }
    this.cachedStates = null
  }

  estimateProgress(state: TrackedBusState, now: number): number {
    // Phase 1: if we just observed a stop change, tween from the previous
    // position to the newly observed stop over TRANSITION_MS. This absorbs
    // any error built up by dead-reckoning before the new observation.
    if (state.transitionFromProgress != null && state.transitionStartAt != null) {
      const elapsed = now - state.transitionStartAt
      if (elapsed >= 0 && elapsed < TRANSITION_MS) {
        const t = elapsed / TRANSITION_MS
        let from = state.transitionFromProgress
        const to = state.lastProgress
        if (this.isCircular && to - from < -0.5) from -= 1
        const raw = from + (to - from) * t
        return this.isCircular ? ((raw % 1) + 1) % 1 : Math.max(0, Math.min(1, raw))
      }
    }

    // Phase 2: dead-reckon forward from the last observed stop, using the
    // reported speed. We cap the advance at the next stop's progress so
    // the bus never "passes" a stop without the feed confirming it.
    const base = state.lastProgress
    const speed = state.speed
    const age = now - state.lastAt
    if (speed <= 0 || age <= 0 || age > DR_MAX_AGE_MS || this.totalKm <= 0) {
      return base
    }
    const cappedSpeedKmh = Math.min(speed, DR_SPEED_CAP_KMH) * DR_SPEED_SCALE
    const kmAdvanced = (cappedSpeedKmh / 3600) * (age / 1000)
    const progressAdvance = kmAdvanced / this.totalKm

    const nextIdx = state.lastStopIdx + 1
    let cap: number
    if (nextIdx < this.stopProgress.length) {
      cap = this.stopProgress[nextIdx] - DR_STOP_EPSILON
    } else if (this.isCircular && this.stopProgress.length > 0) {
      // After the last stop on a circular route, the "next" stop wraps
      // back to index 0, which lives at progress 0 — unwrap by +1.
      cap = this.stopProgress[0] + 1 - DR_STOP_EPSILON
    } else {
      cap = 1
    }

    const advanced = Math.min(base + progressAdvance, cap)
    return this.isCircular ? ((advanced % 1) + 1) % 1 : Math.max(0, Math.min(1, advanced))
  }

  getStates(): TrackedBusState[] {
    if (this.cachedStates === null) {
      this.cachedStates = Array.from(this.buses.values())
    }
    return this.cachedStates
  }

  clear() {
    this.buses.clear()
    this.cachedStates = null
  }
}
