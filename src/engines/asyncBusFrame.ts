import type { BusRoute, TransitData, VehiclePosition } from '../types'
import { BusTrafficController } from './busTraffic'
import { computeBusOnly } from './simulationEngine'
import type { BusWorkerReply, BusWorkerRequest } from './busWorkerRuntime'
import type { BusDetailView } from './busMotionTrace'
import { BusPlayback } from './busPlayback'

type BusData = Pick<TransitData, 'busRoutes' | 'busStops'>
export interface BusWorkerPort {
  onmessage: ((event: MessageEvent<BusWorkerReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage: (request: BusWorkerRequest) => void
  terminate: () => void
}
const createWorker = (): BusWorkerPort => new Worker(new URL('./busTraffic.worker.ts', import.meta.url), { type: 'module', name: 'bus-traffic' })
const sameRoutes = (a: BusRoute[] | null | undefined, b: BusRoute[]) => a === b ||
  (!!a && a.length === b.length && a.every((route, i) => route === b[i]))
const sameView = (a: BusDetailView | undefined, b: BusDetailView | undefined) => a?.trackedId === b?.trackedId &&
  (a?.bounds === b?.bounds || !!a?.bounds && !!b?.bounds && a.bounds.every((value, i) => value === b.bounds![i]))

/** One calculation in flight, no accumulated message queue. Present a short
 * buffer of checked route traces while the worker computes the next snapshot. Seeks
 * and data changes invalidate stale replies; paused clocks still accept their
 * final reply. Only bus data is copied, once per dataset object. */
export class AsyncBusFrame {
  private worker: BusWorkerPort | null = null
  private fallback: BusTrafficController | null = null
  private disposed = false
  private started = false
  private epoch = 0
  private settledEpoch = -1
  private reset = false
  private serial = 0
  private pendingId: number | null = null
  private routeKeys = new WeakMap<BusRoute, number>()
  private nextRouteKey = 1
  private sentRoutes: BusData['busRoutes'] | null = null
  private sentStops: BusData['busStops'] | null = null
  private data: BusData | null = null
  private lastInputMs = NaN
  private lastInputAt = NaN
  private requestedMs = NaN
  private vehicles: VehiclePosition[] = []
  private playback = new BusPlayback()
  private completed: BusWorkerReply | null = null
  private sentAt = 0
  private turnaround = 0
  private sentView?: BusDetailView

  private workerFactory: () => BusWorkerPort
  constructor(workerFactory: () => BusWorkerPort = createWorker) { this.workerFactory = workerFactory }

  private fail = () => {
    if (this.disposed) return
    this.worker?.terminate()
    this.worker = null
    this.pendingId = null
    this.requestedMs = NaN
    this.fallback = new BusTrafficController()
    this.completed = null
    this.playback.clear()
    console.warn('[bus] Worker unavailable; using synchronous traffic simulation')
  }

  sample(data: BusData, simMs: number, now = performance.now(), view?: BusDetailView, speed?: number): { vehicles: VehiclePosition[]; pending: boolean } {
    if (this.disposed) return { vehicles: [], pending: false }
    const changed = !sameRoutes(this.data?.busRoutes, data.busRoutes) || this.data?.busStops !== data.busStops
    // A throttled/occluded tab at 60× can legitimately advance a minute per
    // frame. Treat that as elapsed playback, not a fresh user seek every tick.
    const forwardJump = simMs - this.lastInputMs > Math.max(12000, (now - this.lastInputAt) * 60 + 1000)
    const resumed = Number.isFinite(this.lastInputAt) && now - this.lastInputAt > 2000
    const seek = Number.isFinite(this.lastInputMs) && (simMs < this.lastInputMs || forwardJump || resumed)
    if (changed || seek) {
      this.epoch++
      this.requestedMs = NaN
      if (seek) { this.reset = true; this.vehicles = [] }
      else {
        const visible = new Set(data.busRoutes.map(route => route.id))
        this.vehicles = this.vehicles.filter(v => visible.has(v.lineId))
      }
      this.completed = null
      this.playback.clear()
      this.playback.accept(this.vehicles, undefined, now, 0)
    }
    this.data = data
    this.lastInputMs = simMs
    this.lastInputAt = now
    if (!this.started && data.busRoutes.length) {
      this.started = true
      try {
        this.worker = this.workerFactory()
        this.worker.onmessage = ({ data: reply }) => {
          if (this.disposed || reply.id !== this.pendingId) return
          this.pendingId = null
          if (reply.epoch === this.epoch) {
            this.completed = reply
            this.turnaround = performance.now() - this.sentAt
            this.settledEpoch = reply.epoch
          }
        }
        this.worker.onerror = this.fail
        this.worker.onmessageerror = this.fail
      } catch { this.fail() }
    }
    if (this.completed) {
      this.vehicles = this.completed.vehicles
      this.playback.accept(this.vehicles, this.completed.trace, now, this.turnaround)
      this.completed = null
    }
    if (this.fallback) {
      if (this.reset) { this.fallback = new BusTrafficController(); this.reset = false }
      if (this.requestedMs !== simMs) {
        this.vehicles = computeBusOnly(data, new Date(simMs), this.fallback)
        this.requestedMs = simMs
      }
    } else if (this.worker && this.pendingId === null) {
      // Align fast playback to complete physics steps. Splitting every late
      // reply into fresh fractional steps repeats turn resolution and creates
      // a feedback loop in which the next request is even further behind.
      // Presentation still follows the recorded route between these samples.
      const quantum = speed && speed >= 10 ? (speed >= 60 ? 8000 : speed >= 30 ? 4000 : 2000) : 0
      const targetMs = quantum && !changed && !seek && Number.isFinite(this.requestedMs)
        ? Math.max(this.requestedMs, Math.floor(simMs / quantum) * quantum) : simMs
      // A paused camera can reveal previously coarse markers. Place those
      // buses in detailed traffic even though simulation time has not moved.
      if (this.requestedMs !== targetMs || speed === 0 && !sameView(this.sentView, view)) {
        const request: BusWorkerRequest = { id: ++this.serial, epoch: this.epoch, simMs: targetMs, reset: this.reset }
        if (view) request.view = view
        this.sentView = view
        if (!sameRoutes(this.sentRoutes, data.busRoutes)) {
          request.routes = []
          request.routeKeys = data.busRoutes.map(route => {
            let key = this.routeKeys.get(route)
            if (key === undefined) {
              key = this.nextRouteKey++; this.routeKeys.set(route, key)
              request.routes!.push([key, route])
            }
            return key
          })
          this.sentRoutes = data.busRoutes
        }
        if (this.sentStops !== data.busStops) { request.stops = data.busStops; this.sentStops = data.busStops }
        this.pendingId = request.id
        this.requestedMs = targetMs
        this.reset = false
        this.sentAt = performance.now()
        try { this.worker.postMessage(request) } catch { this.fail() }
      }
    }
    // Tracking waits only for the first valid snapshot after a seek/change.
    // Ordinary in-flight updates must not keep a vehicle that ended service selected.
    return { vehicles: this.fallback ? this.vehicles : this.playback.sample(simMs, now, speed, view), pending: this.pendingId !== null && this.settledEpoch !== this.epoch }
  }

  dispose(): void {
    this.disposed = true
    this.worker?.terminate()
    this.worker = null
    this.vehicles = []
    this.completed = null
    this.playback.clear()
  }
}
