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

export type FetchResult =
  | { ok: true; data: DsatRouteResponse }
  | { ok: false; reason: 'network' | 'http' | 'bad-payload' }

export async function fetchDsatRouteResult(routeName: string, dir: 0 | 1 = 0): Promise<FetchResult> {
  const url = `/api/dsat/routestation/bus?routeName=${encodeURIComponent(routeName)}&dir=${dir}`
  try {
    const r = await fetch(url)
    if (!r.ok) return { ok: false, reason: 'http' }
    const json = await r.json()
    if (json?.header !== '000') return { ok: false, reason: 'bad-payload' }
    return { ok: true, data: json as DsatRouteResponse }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

export async function fetchDsatRoute(routeName: string, dir: 0 | 1 = 0): Promise<DsatRouteResponse | null> {
  const res = await fetchDsatRouteResult(routeName, dir)
  return res.ok ? res.data : null
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

export class RouteRealtimePoller {
  readonly routeName: string
  readonly dir: 0 | 1
  private readonly intervalMs: number
  private readonly maxBackoffMs: number
  private timer: number | null = null
  private running = false
  private paused = false
  private failures = 0
  private subs = new Set<Subscriber>()
  private lastObs: BusObservation[] = []
  private visibilityHandler: (() => void) | null = null

  constructor(routeName: string, dir: 0 | 1, intervalMs: number = 15_000, maxBackoffMs: number = 5 * 60_000) {
    this.routeName = routeName
    this.dir = dir
    this.intervalMs = intervalMs
    this.maxBackoffMs = maxBackoffMs
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }

  getLatest(): BusObservation[] { return this.lastObs }

  start() {
    if (this.running) return
    this.running = true
    this.paused = false
    this.failures = 0
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (!document.hidden && this.running && !this.paused && this.timer === null) this.schedule(0)
      }
      document.addEventListener('visibilitychange', this.visibilityHandler)
    }
    this.schedule(0)
  }

  pause() {
    if (this.paused) return
    this.paused = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  resume() {
    if (!this.paused) return
    this.paused = false
    if (this.running && this.timer === null) this.schedule(0)
  }

  stop() {
    this.running = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  private schedule(delay: number) {
    if (!this.running || this.paused) return
    this.timer = window.setTimeout(() => {
      this.timer = null
      void this.tick()
    }, delay)
  }

  private nextDelay(): number {
    if (this.failures === 0) return this.intervalMs
    const backoff = this.intervalMs * Math.pow(2, Math.min(this.failures - 1, 6))
    return Math.min(backoff, this.maxBackoffMs)
  }

  private async tick() {
    if (!this.running || this.paused) return
    if (typeof document !== 'undefined' && document.hidden) {
      this.schedule(this.intervalMs)
      return
    }
    const res = await fetchDsatRouteResult(this.routeName, this.dir)
    if (!this.running) return
    if (!res.ok) {
      if (res.reason === 'http' || res.reason === 'network') this.failures++
      this.schedule(this.nextDelay())
      return
    }
    this.failures = 0
    const obs = extractObservations(res.data)
    this.lastObs = obs
    for (const fn of this.subs) fn(obs, res.data)
    this.schedule(this.nextDelay())
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

export class BusTracker {
  private readonly stopProgress: number[]
  private readonly isCircular: boolean
  private buses = new Map<string, TrackedBusState>()
  private cachedStates: TrackedBusState[] | null = null

  constructor(stopProgress: number[], isCircular: boolean) {
    this.stopProgress = stopProgress
    this.isCircular = isCircular
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
      } else if (o.stopIndex !== existing.lastStopIdx) {
        existing.transitionFromProgress = existing.lastProgress
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
        existing.lastAt = o.observedAt
        existing.speed = o.speed
        existing.status = o.status
      }
    }
    for (const [plate, state] of this.buses) {
      if (now - state.lastAt > STALE_MS) this.buses.delete(plate)
    }
    this.cachedStates = null
  }

  estimateProgress(state: TrackedBusState, now: number): number {
    if (state.transitionFromProgress == null || state.transitionStartAt == null) {
      return state.lastProgress
    }
    const elapsed = now - state.transitionStartAt
    if (elapsed >= TRANSITION_MS) return state.lastProgress
    if (elapsed <= 0) return state.transitionFromProgress
    const t = elapsed / TRANSITION_MS
    let from = state.transitionFromProgress
    const to = state.lastProgress
    if (this.isCircular && to - from < -0.5) from -= 1
    const raw = from + (to - from) * t
    return this.isCircular ? ((raw % 1) + 1) % 1 : Math.max(0, Math.min(1, raw))
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

