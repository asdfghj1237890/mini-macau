import type { Flight, TransitData, VehiclePosition } from '../types'
import { computeFlightOnly, computeSingleFlight, computeVehiclePositions } from './simulationEngine'
import { BusTrafficController } from './busTraffic'
import type { AsyncBusFrame } from './asyncBusFrame'

interface FrameInput {
  now: number
  simMs: number
  data: TransitData
  zoom: number
  renderer: object | null
  trackedId: string | null
  uploadInterval: number
}

// All GeoJSON uploads share the existing 33/100/160 ms cadence. Dirty state
// remains pending until that cadence permits a write, including while paused.
export class VehicleFrame {
  private busTraffic = new BusTrafficController()
  private surface: VehiclePosition[] = []
  private base: VehiclePosition[] = []
  private buses: VehiclePosition[] = []
  private asyncBuses?: AsyncBusFrame
  private surfacePending = false
  private flights: VehiclePosition[] = []
  private vehicles: VehiclePosition[] = []
  private surfaceData: TransitData | null = null
  private surfaceMs = NaN
  private surfaceAt = -Infinity
  private surfaceDirty = false
  private flightData: TransitData | null = null
  private flightMs = NaN
  private uploadAt = -Infinity
  private zoom = NaN
  private renderer: object | null = null
  private uploadedTrackedId: string | null = null
  private trackedId: string | null = null
  private flightDefinitions: Flight[] | null = null
  private trackedDefinition: Flight | null = null
  private trackedFlight: VehiclePosition | null = null
  private trackedMs = NaN

  constructor(asyncBuses?: AsyncBusFrame) { this.asyncBuses = asyncBuses }
  dispose(): void { this.asyncBuses?.dispose() }

  sample(input: FrameInput) {
    const { now, simMs, data, zoom, renderer, trackedId, uploadInterval } = input
    let surfaceUpdated = false
    if (now - this.surfaceAt >= 33) {
      const changed = this.surfaceData !== data || this.surfaceMs !== simMs
      if (changed) this.base = computeVehiclePositions(data, new Date(simMs), {
        includeFlights: false, includeBuses: !this.asyncBuses, busTraffic: this.busTraffic,
      })
      const busFrame = this.asyncBuses?.sample(data, simMs, now)
      surfaceUpdated = changed || (!!busFrame && this.buses !== busFrame.vehicles)
      if (busFrame) this.buses = busFrame.vehicles
      this.surfacePending = busFrame?.pending ?? false
      if (surfaceUpdated) this.surface = this.asyncBuses ? [...this.base, ...this.buses] : this.base
      this.surfaceAt = now
      this.surfaceData = data
      this.surfaceMs = simMs
      this.surfaceDirty ||= surfaceUpdated
    }
    const flightChanged = this.flightData !== data || this.flightMs !== simMs
    const viewChanged = this.renderer !== renderer || this.zoom !== zoom
    const upload = now - this.uploadAt >= uploadInterval && (
      this.surfaceDirty || flightChanged || viewChanged || this.uploadedTrackedId !== trackedId
    )
    const fleetUpdated = upload && flightChanged
    if (fleetUpdated) {
      this.flights = computeFlightOnly(data, new Date(simMs))
      this.flightData = data
      this.flightMs = simMs
    }

    const selectionChanged = this.trackedId !== trackedId || this.flightDefinitions !== data.flights
    if (selectionChanged) {
      this.trackedDefinition = data.flights.find(f => f.id === trackedId) ?? null
      this.flightDefinitions = data.flights
      this.trackedId = trackedId
    }
    const oldTracked = this.trackedFlight
    if (selectionChanged || this.trackedMs !== simMs) {
      this.trackedFlight = !this.trackedDefinition ? null : fleetUpdated
        ? this.flights.find(f => f.id === trackedId) ?? null
        : computeSingleFlight(this.trackedDefinition, new Date(simMs))
      this.trackedMs = simMs
    }
    if (surfaceUpdated || fleetUpdated) this.vehicles = [...this.surface, ...this.flights]
    if (upload) {
      this.uploadAt = now
      this.surfaceDirty = false
      this.zoom = zoom
      this.renderer = renderer
      this.uploadedTrackedId = trackedId
    }
    return {
      upload, surfaceUpdated, surfacePending: this.surfacePending, vehicles: this.vehicles, surface: this.surface, flights: this.flights,
      trackedFlight: this.trackedFlight,
      trackedUpdated: oldTracked !== this.trackedFlight || (upload && (viewChanged || selectionChanged)),
    }
  }
}
