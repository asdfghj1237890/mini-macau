import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'
import { buildFlightFeatures, type AircraftPartKind } from './aircraftGeometry'
import { AircraftModelLayer } from './AircraftModelLayer'
import { FLIGHT_LABEL_LAYER_ID } from './VehicleLayer'

export const FLIGHT_3D_SOURCE_ID = 'flight-3d-source'
export const FLIGHT_3D_TRACKED_SOURCE_ID = 'flight-3d-tracked-source'
export const FLIGHT_3D_FUSELAGE_LAYER = 'flight-3d-fuselage'
export const FLIGHT_3D_WING_LAYER = 'flight-3d-wing'
export const FLIGHT_3D_TAIL_LAYER = 'flight-3d-tail'
export const FLIGHT_3D_VTAIL_LAYER = 'flight-3d-vtail'

export const FLIGHT_3D_TRACKED_FUSELAGE_LAYER = 'flight-3d-tracked-fuselage'
export const FLIGHT_3D_TRACKED_WING_LAYER = 'flight-3d-tracked-wing'
export const FLIGHT_3D_TRACKED_TAIL_LAYER = 'flight-3d-tracked-tail'
export const FLIGHT_3D_TRACKED_VTAIL_LAYER = 'flight-3d-tracked-vtail'

export const ALL_FLIGHT_3D_LAYERS = [
  FLIGHT_3D_VTAIL_LAYER,
  FLIGHT_3D_WING_LAYER,
  FLIGHT_3D_TAIL_LAYER,
  FLIGHT_3D_FUSELAGE_LAYER,
  FLIGHT_3D_TRACKED_VTAIL_LAYER,
  FLIGHT_3D_TRACKED_WING_LAYER,
  FLIGHT_3D_TRACKED_TAIL_LAYER,
  FLIGHT_3D_TRACKED_FUSELAGE_LAYER,
]

const IS_MOBILE = window.matchMedia('(max-width: 639px)').matches
const MIN_ZOOM = IS_MOBILE ? 14.5 : 15.6

// Invisible picking volumes retain the existing delegated click handlers.
// Visible geometry is rendered by AircraftModelLayer in the map's GL context.
type LayerSpec = {
  idMain: string
  idTracked: string
  kind: AircraftPartKind
}

const LAYER_SPECS: LayerSpec[] = [
  { idMain: FLIGHT_3D_FUSELAGE_LAYER, idTracked: FLIGHT_3D_TRACKED_FUSELAGE_LAYER, kind: 'fuselage' },
  { idMain: FLIGHT_3D_WING_LAYER,     idTracked: FLIGHT_3D_TRACKED_WING_LAYER,     kind: 'wing' },
  { idMain: FLIGHT_3D_TAIL_LAYER,     idTracked: FLIGHT_3D_TRACKED_TAIL_LAYER,     kind: 'tail' },
  { idMain: FLIGHT_3D_VTAIL_LAYER,    idTracked: FLIGHT_3D_TRACKED_VTAIL_LAYER,    kind: 'vtail' },
]

export class Flight3DLayer {
  private map: MapLibreMap | null = null
  private model = new AircraftModelLayer(MIN_ZOOM)
  private isEmpty = true
  private trackedEmpty = true
  // Separate fleet and tracked batches keep the per-RAF camera target current
  // without rebuilding every aircraft's picking geometry at that cadence.
  private trackedId: string | null = null
  private lastFlights: VehiclePosition[] = []

  attach(map: MapLibreMap): void {
    this.map = map

    map.addSource(FLIGHT_3D_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    map.addSource(FLIGHT_3D_TRACKED_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    for (const spec of LAYER_SPECS) {
      map.addLayer({
        id: spec.idMain,
        type: 'fill-extrusion',
        source: FLIGHT_3D_SOURCE_ID,
        filter: ['==', ['get', 'kind'], spec.kind],
        minzoom: MIN_ZOOM,
        paint: {
          'fill-extrusion-color': '#ffffff',
          'fill-extrusion-base': ['get', 'baseM'],
          'fill-extrusion-height': ['get', 'heightM'],
          'fill-extrusion-opacity': 0,
        },
      })
    }

    for (const spec of LAYER_SPECS) {
      map.addLayer({
        id: spec.idTracked,
        type: 'fill-extrusion',
        source: FLIGHT_3D_TRACKED_SOURCE_ID,
        filter: ['==', ['get', 'kind'], spec.kind],
        minzoom: MIN_ZOOM,
        paint: {
          'fill-extrusion-color': '#ffffff',
          'fill-extrusion-base': ['get', 'baseM'],
          'fill-extrusion-height': ['get', 'heightM'],
          'fill-extrusion-opacity': 0,
        },
      })
    }
    map.addLayer(this.model)
    // Labels are initially added with the 2D markers. Draw them after the
    // custom mesh so the fuselage cannot paint over its own flight number.
    if (map.getLayer(FLIGHT_LABEL_LAYER_ID)) map.moveLayer(FLIGHT_LABEL_LAYER_ID)
  }

  detach(): void {
    const map = this.map
    if (!map) return
    if (map.getLayer(this.model.id)) map.removeLayer(this.model.id)
    for (const id of ALL_FLIGHT_3D_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(FLIGHT_3D_SOURCE_ID)) map.removeSource(FLIGHT_3D_SOURCE_ID)
    if (map.getSource(FLIGHT_3D_TRACKED_SOURCE_ID)) map.removeSource(FLIGHT_3D_TRACKED_SOURCE_ID)
    this.map = null
  }

  setVehicles(flights: VehiclePosition[]): void {
    this.lastFlights = flights
    const map = this.map
    if (!map) return
    const src = map.getSource(FLIGHT_3D_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    const belowMin = map.getZoom() < MIN_ZOOM - 0.5
    const filtered = this.trackedId
      ? flights.filter(f => f.id !== this.trackedId)
      : flights
    this.model.setVehicles(belowMin ? [] : filtered)
    if (belowMin || filtered.length === 0) {
      if (this.isEmpty) return
      src.setData({ type: 'FeatureCollection', features: [] })
      this.isEmpty = true
      return
    }
    src.setData({ type: 'FeatureCollection', features: buildFlightFeatures(filtered) })
    this.isEmpty = false
  }

  // The tracked GPU instance updates synchronously with the camera. Its small
  // picking source follows independently through the MapLibre worker.
  setTrackedVehicle(flight: VehiclePosition | null, options: { updatePicking?: boolean; refreshFleet?: boolean } = {}): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(FLIGHT_3D_TRACKED_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return

    const newId = flight?.id ?? null
    const idChanged = newId !== this.trackedId

    if (!flight) {
      this.model.setTrackedVehicle(null)
      this.trackedId = null
      if (!this.trackedEmpty) {
        src.setData({ type: 'FeatureCollection', features: [] })
        this.trackedEmpty = true
      }
      // Plane went back into the main source — rebuild so it reappears there
      // instead of winking out until the next heavy tick.
      if (idChanged && options.refreshFleet !== false) this.setVehicles(this.lastFlights)
      return
    }

    this.trackedId = newId
    const belowMin = map.getZoom() < MIN_ZOOM - 0.5
    if (belowMin) {
      this.model.setTrackedVehicle(null)
      if (!this.trackedEmpty) {
        src.setData({ type: 'FeatureCollection', features: [] })
        this.trackedEmpty = true
      }
      return
    }

    this.model.setTrackedVehicle(flight)
    if (options.updatePicking !== false || idChanged || this.trackedEmpty) {
      src.setData({ type: 'FeatureCollection', features: buildFlightFeatures([flight]) })
      this.trackedEmpty = false
    }
    // On track-change, refresh the main source immediately so the newly
    // tracked plane is excluded (avoids a 1-heavy-tick window where it would
    // render in both sources, producing a double image).
    if (idChanged && options.refreshFleet !== false) this.setVehicles(this.lastFlights)
  }
}
