import type { BusRoute, BusStop, VehiclePosition } from '../types'
import { BusTrafficController } from './busTraffic'
import { computeBusOnly } from './simulationEngine'
import { BusTraceRecorder, type BusDetailView, type BusMotionTrace } from './busMotionTrace'
import { BusTrafficScope } from './busTrafficScope'

export type BusWorkerRequest = {
  id: number
  epoch: number
  simMs: number
  reset: boolean
  hold?: boolean
  routes?: [number, BusRoute][]
  routeKeys?: number[]
  stops?: BusStop[]
  view?: BusDetailView
}
// simMs is the time actually computed, which can trail the requested clock
// while catching up. Replies always retain one continuous traffic timeline.
export type BusWorkerReply = { id: number; epoch: number; simMs: number; vehicles: VehiclePosition[]; trace?: BusMotionTrace }
const BATCH_MS = 8000

// Keep dataset object identities across visibility changes so route geometry
// caches and the queues of still-visible routes survive a layer toggle.
export class BusWorkerRuntime {
  private routes = new Map<number, BusRoute>()
  private data = { busRoutes: [] as BusRoute[], busStops: [] as BusStop[] }
  // Bound each job, not the lifetime of a queue. A late clock must never
  // teleport delayed buses back to their nominal timetable positions.
  private traffic = new BusTrafficController(16)
  private scope = new BusTrafficScope(this.traffic)
  private simMs = NaN

  sample(request: BusWorkerRequest): BusWorkerReply {
    if (request.reset || request.simMs < this.simMs) {
      this.traffic = new BusTrafficController(16)
      this.scope = new BusTrafficScope(this.traffic)
      this.simMs = NaN
    }
    for (const [key, route] of request.routes ?? []) {
      this.routes.set(key, route)
    }
    if (request.routeKeys) this.data.busRoutes = request.routeKeys.map(key => {
      const route = this.routes.get(key)
      if (!route) throw new Error('Missing bus route in worker')
      return route
    })
    if (request.stops) this.data.busStops = request.stops
    const simMs = !Number.isFinite(this.simMs) ? request.simMs
      : request.hold ? this.simMs : Math.min(request.simMs, this.simMs + BATCH_MS)
    const recorder = new BusTraceRecorder(request.view)
    const vehicles = computeBusOnly(this.data, new Date(simMs), {
      sample: (plans, timeMs) => this.scope.sample(plans, timeMs, request.view, recorder),
    })
    this.simMs = simMs
    return { id: request.id, epoch: request.epoch, simMs, vehicles, trace: recorder.finish(vehicles, simMs) }
  }
}
