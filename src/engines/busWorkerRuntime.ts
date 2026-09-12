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
  routes?: [number, BusRoute][]
  routeKeys?: number[]
  stops?: BusStop[]
  view?: BusDetailView
}
export type BusWorkerReply = { id: number; epoch: number; simMs: number; vehicles: VehiclePosition[]; trace?: BusMotionTrace }

// Keep dataset object identities across visibility changes so route geometry
// caches and the queues of still-visible routes survive a layer toggle.
export class BusWorkerRuntime {
  private routes = new Map<number, BusRoute>()
  private data = { busRoutes: [] as BusRoute[], busStops: [] as BusStop[] }
  // Bound catch-up work when a device cannot sustain the selected rate. A
  // fresh checked placement is preferable to minutes of accumulated replay.
  private traffic = new BusTrafficController(16)
  private scope = new BusTrafficScope(this.traffic)

  sample(request: BusWorkerRequest): BusWorkerReply {
    if (request.reset) {
      this.traffic = new BusTrafficController(16)
      this.scope = new BusTrafficScope(this.traffic)
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
    const recorder = new BusTraceRecorder(request.view)
    const vehicles = computeBusOnly(this.data, new Date(request.simMs), {
      sample: (plans, timeMs) => this.scope.sample(plans, timeMs, request.view, recorder),
    })
    return { id: request.id, epoch: request.epoch, simMs: request.simMs, vehicles, trace: recorder.finish(vehicles, request.simMs) }
  }
}
