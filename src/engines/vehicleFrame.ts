import type { Flight, TransitData, VehiclePosition } from '../types'
import { computeFlightOnly, computeSingleFlight, computeVehiclePositions } from './simulationEngine'

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
  private surface: VehiclePosition[] = []
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

  sample(input: FrameInput) {
    const { now, simMs, data, zoom, renderer, trackedId, uploadInterval } = input
    const surfaceUpdated = now - this.surfaceAt >= 33 && (this.surfaceData !== data || this.surfaceMs !== simMs)
    if (surfaceUpdated) {
      this.surface = computeVehiclePositions(data, new Date(simMs), { includeFlights: false })
      this.surfaceAt = now
      this.surfaceData = data
      this.surfaceMs = simMs
      this.surfaceDirty = true
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
      upload, surfaceUpdated, vehicles: this.vehicles, surface: this.surface, flights: this.flights,
      trackedFlight: this.trackedFlight,
      trackedUpdated: oldTracked !== this.trackedFlight || (upload && (viewChanged || selectionChanged)),
    }
  }
}
