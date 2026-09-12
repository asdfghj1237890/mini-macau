import type { VehiclePosition } from '../types'

// time, longitude, latitude, heading, route progress, direction seconds,
// speed, phase, traffic delay. Float64 keeps geographic and epoch precision.
export const BUS_TRACE_STRIDE = 9
export type BusDetailView = { bounds?: [number, number, number, number]; trackedId?: string | null }
export type BusMotionTrace = { startMs: number; endMs: number; steps: number[]; paths: { id: string; points: Float64Array }[] }

/** One request's checked movement, transferred rather than cloned. Detailed
 * route samples are needed only around visible models/the tracked vehicle. */
export class BusTraceRecorder {
  private paths = new Map<string, number[]>()
  private steps: number[] = []
  private startMs = NaN
  private view: BusDetailView

  constructor(view: BusDetailView = {}) { this.view = view }
  get startTimeMs(): number { return this.startMs }

  begin(timeMs: number): void { this.startMs = timeMs; this.steps.push(timeMs) }
  step(timeMs: number): void { this.steps.push(timeMs) }
  clear(id: string): void { this.paths.delete(id) }
  detailed(vehicle: VehiclePosition): boolean {
    if (vehicle.id === this.view.trackedId) return true
    const b = this.view.bounds, [x, y] = vehicle.coordinates
    return !!b && x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3]
  }
  add(vehicle: VehiclePosition, timeMs: number): void {
    let points = this.paths.get(vehicle.id)
    if (!points) { points = []; this.paths.set(vehicle.id, points) }
    const motion = vehicle.busMotion
    points.push(timeMs, ...vehicle.coordinates, vehicle.bearing, vehicle.progress,
      motion?.dirSec ?? 0, motion?.speedKmh ?? 0,
      motion?.phase === 'stopped' ? 1 : motion?.phase === 'queued' ? 2 : 0, motion?.delaySec ?? 0)
  }
  finish(vehicles: VehiclePosition[], endMs: number): BusMotionTrace {
    // Only the final active fleet supplies metadata. Removed/hidden vehicles
    // cannot be kept alive by a trailing animation buffer.
    return { startMs: this.startMs, endMs, steps: this.steps,
      paths: vehicles.map(vehicle => ({ id: vehicle.id, points: new Float64Array(this.paths.get(vehicle.id) ?? []) })) }
  }
}
