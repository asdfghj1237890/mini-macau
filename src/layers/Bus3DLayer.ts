import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'
import { VEHICLE_SOURCE_MAXZOOM } from './VehicleLayer'
import { InstancedVehicleModelLayer } from './InstancedVehicleModelLayer'
import { createBusMesh } from './busMesh'
import { buildBusFeatures, busesInBounds } from './busGeometry'

export const BUS_3D_SOURCE_ID = 'bus-3d-source'
export const ALL_BUS_3D_LAYERS = ['bus-3d-body']
const IS_MOBILE = window.matchMedia('(max-width: 639px)').matches
const MIN_ZOOM = IS_MOBILE ? 16 : 16.9
const MESH = createBusMesh()

export class Bus3DLayer {
  private map: MapLibreMap | null = null
  private isEmpty = true
  private buses: VehiclePosition[] = []
  private lastViewUpdate = -Infinity
  private onMove = () => {
    if (performance.now() - this.lastViewUpdate >= 100) this.updateView()
  }
  private onMoveEnd = () => this.updateView()
  private model = new InstancedVehicleModelLayer({
    id: 'bus-3d-model', minZoom: MIN_ZOOM, mesh: MESH, label: 'bus',
  })

  attach(map: MapLibreMap): void {
    this.map = map
    map.addSource(BUS_3D_SOURCE_ID, {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: VEHICLE_SOURCE_MAXZOOM,
    })
    map.addLayer({
      id: ALL_BUS_3D_LAYERS[0], type: 'fill-extrusion', source: BUS_3D_SOURCE_ID, minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-base': ['get', 'baseM'], 'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-opacity': 0,
      },
    })
    map.addLayer(this.model)
    // A paused clock skips fleet uploads; panning must still reveal buses that
    // were outside the previous viewport. Throttle intermediate camera updates.
    map.on('move', this.onMove)
    map.on('moveend', this.onMoveEnd)
  }

  detach(): void {
    const map = this.map
    if (!map) return
    map.off('move', this.onMove)
    map.off('moveend', this.onMoveEnd)
    if (map.getLayer(this.model.id)) map.removeLayer(this.model.id)
    for (const id of ALL_BUS_3D_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(BUS_3D_SOURCE_ID)) map.removeSource(BUS_3D_SOURCE_ID)
    this.model.setVehicles([])
    this.buses = []
    this.isEmpty = true
    this.map = null
  }

  setVehicles(buses: VehiclePosition[]): void {
    this.buses = buses
    this.updateView()
  }

  private updateView(): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(BUS_3D_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    this.lastViewUpdate = performance.now()
    const visible = map.getZoom() >= MIN_ZOOM - .5 ? busesInBounds(this.buses, map.getBounds()) : []
    this.model.setVehicles(visible)
    if (!visible.length && this.isEmpty) return
    src.setData({ type: 'FeatureCollection', features: buildBusFeatures(visible) })
    this.isEmpty = !visible.length
  }
}
