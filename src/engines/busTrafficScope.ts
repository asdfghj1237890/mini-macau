import type { VehiclePosition } from '../types'
import { BusTrafficController, type BusTrafficPlan } from './busTraffic'
import type { BusDetailView, BusTraceRecorder } from './busMotionTrace'

const LAT_METRES = 111320
const LNG_METRES = LAT_METRES * Math.cos(22.19 * Math.PI / 180)
const BUFFER_M = 100

/** Keep microscopic traffic around the camera and tracked bus. Distant map
 * dots follow their schedules; they enter traffic before reaching the view.
 * Existing physical poses also select membership, so a delayed queue cannot
 * disappear just because its nominal timetable position has moved away. */
export class BusTrafficScope {
  private previous = new Map<string, VehiclePosition>()
  private lastMs = NaN

  private traffic: BusTrafficController
  constructor(traffic: BusTrafficController) { this.traffic = traffic }

  sample(plans: BusTrafficPlan[], timeMs: number, view: BusDetailView | undefined, recorder: BusTraceRecorder): VehiclePosition[] {
    const dt = (timeMs - this.lastMs) / 1000
    this.lastMs = timeMs
    this.traffic.recorder = recorder
    try {
      if (!view) {
        const vehicles = this.traffic.sample(plans, timeMs)
        this.previous = new Map(vehicles.map(v => [v.id, v]))
        return vehicles
      }
      const nominal = new Map(plans.map(plan => [plan.id, plan.sample(plan.elapsedSec).vehicle]))
      const current = new Map(this.traffic.currentVehicles().map(v => [v.id, v]))
      const tracked = view.trackedId ? current.get(view.trackedId) ?? nominal.get(view.trackedId) : undefined
      // Include the next batch's approach, and use a wider exit boundary to
      // avoid repeatedly placing buses at the edge when the camera is still.
      const margin = BUFFER_M + Math.min(8, Math.max(0, dt || 0)) * 22
      const near = (vehicle: VehiclePosition, padding: number): boolean => {
        const [x, y] = vehicle.coordinates, b = view.bounds
        if (b && x >= b[0] - padding / LNG_METRES && x <= b[2] + padding / LNG_METRES &&
            y >= b[1] - padding / LAT_METRES && y <= b[3] + padding / LAT_METRES) return true
        return !!tracked && Math.hypot((x - tracked.coordinates[0]) * LNG_METRES,
          (y - tracked.coordinates[1]) * LAT_METRES) <= padding
      }
      const selected = plans.filter(plan => {
        if (plan.id === view.trackedId) return true
        const physical = current.get(plan.id)
        return near(nominal.get(plan.id)!, margin) || !!physical && near(physical, margin + 100)
      })
      const selectedIds = new Set(selected.map(plan => plan.id))
      const vehicles = this.traffic.sample(selected, timeMs)
      for (const [id, vehicle] of nominal) {
        if (selectedIds.has(id)) continue
        const previous = this.previous.get(id)
        const a = previous?.busMotion, b = vehicle.busMotion
        // A terminal handover is a new pose, not a drive across the map.
        if (previous && recorder.startTimeMs < timeMs && a?.returning === b?.returning && (b?.dirSec ?? 0) >= (a?.dirSec ?? 0)) {
          recorder.add(previous, recorder.startTimeMs)
        }
        recorder.add(vehicle, timeMs)
        vehicles.push(vehicle)
      }
      this.previous = new Map(vehicles.map(v => [v.id, v]))
      return vehicles
    } finally { this.traffic.recorder = undefined }
  }
}
