import type { BusRoute, BusStop, VehiclePosition } from '../types'
import { BusTrafficController } from './busTraffic'
import { computeBusOnly } from './simulationEngine'

export type BusWorkerRequest = {
  id: number
  epoch: number
  simMs: number
  reset: boolean
  routes?: [number, BusRoute][]
  routeKeys?: number[]
  stops?: BusStop[]
}
export type BusWorkerReply = { id: number; epoch: number; simMs: number; vehicles: VehiclePosition[] }

// Keep dataset object identities across visibility changes so route geometry
// caches and the queues of still-visible routes survive a layer toggle.
export class BusWorkerRuntime {
  private routes = new Map<number, BusRoute>()
  private data = { busRoutes: [] as BusRoute[], busStops: [] as BusStop[] }
  private traffic = new BusTrafficController()

  sample(request: BusWorkerRequest): BusWorkerReply {
    if (request.reset) this.traffic = new BusTrafficController()
    for (const [key, route] of request.routes ?? []) {
      this.routes.set(key, route)
    }
    if (request.routeKeys) this.data.busRoutes = request.routeKeys.map(key => {
      const route = this.routes.get(key)
      if (!route) throw new Error('Missing bus route in worker')
      return route
    })
    if (request.stops) this.data.busStops = request.stops
    return { id: request.id, epoch: request.epoch, simMs: request.simMs,
      vehicles: computeBusOnly(this.data, new Date(request.simMs), this.traffic) }
  }
}
