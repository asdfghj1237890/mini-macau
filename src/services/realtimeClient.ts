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

export async function fetchDsatRoute(routeName: string, dir: 0 | 1 = 0): Promise<DsatRouteResponse | null> {
  const url = `/api/dsat/routestation/bus?routeName=${encodeURIComponent(routeName)}&dir=${dir}`
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const json = await r.json()
    if (json?.header !== '000') return null
    return json as DsatRouteResponse
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

export class RouteRealtimePoller {
  readonly routeName: string
  readonly dir: 0 | 1
  private readonly intervalMs: number
  private timer: number | null = null
  private subs = new Set<Subscriber>()
  private lastObs: BusObservation[] = []

  constructor(routeName: string, dir: 0 | 1, intervalMs: number = 15_000) {
    this.routeName = routeName
    this.dir = dir
    this.intervalMs = intervalMs
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }

  getLatest(): BusObservation[] { return this.lastObs }

  start() {
    if (this.timer !== null) return
    void this.tick()
    this.timer = window.setInterval(() => { void this.tick() }, this.intervalMs)
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tick() {
    const resp = await fetchDsatRoute(this.routeName, this.dir)
    if (!resp) return
    const obs = extractObservations(resp)
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
}

const STALE_MS = 60_000

export class BusTracker {
  private readonly stopProgress: number[]
  private readonly isCircular: boolean
  private buses = new Map<string, TrackedBusState>()

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
        })
      } else if (o.stopIndex !== existing.lastStopIdx) {
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
  }

  estimateProgress(state: TrackedBusState, now: number): number {
    if (state.prevProgress == null || state.prevAt == null) {
      return state.lastProgress
    }
    let delta = state.lastProgress - state.prevProgress
    if (this.isCircular && delta < -0.3) delta += 1
    const dt = state.lastAt - state.prevAt
    if (dt <= 0 || delta <= 0) return state.lastProgress
    const ratePerMs = delta / dt
    const elapsed = Math.max(0, now - state.lastAt)
    const maxAhead = delta * 1.5
    const advance = Math.min(ratePerMs * elapsed, maxAhead)
    const raw = state.lastProgress + advance
    return this.isCircular ? ((raw % 1) + 1) % 1 : Math.max(0, Math.min(1, raw))
  }

  getStates(): TrackedBusState[] {
    return Array.from(this.buses.values())
  }

  clear() { this.buses.clear() }
}

