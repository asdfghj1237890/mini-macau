import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'
import { VEHICLE_SOURCE_MAXZOOM } from './VehicleLayer'
import { InstancedVehicleModelLayer } from './InstancedVehicleModelLayer'
import { createFerryMesh } from './ferryMesh'
import { buildFerryFeatures } from './ferryGeometry'

export const FERRY_3D_SOURCE_ID = 'ferry-3d-source'
export const ALL_FERRY_3D_LAYERS = ['ferry-3d-body']
const IS_MOBILE = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
const MIN_ZOOM = IS_MOBILE ? 16 : 16.9
const MESH = createFerryMesh()

export class Ferry3DLayer {
  private map: MapLibreMap | null = null
  private isEmpty = true
  private ferries: VehiclePosition[] = []
  private visible: VehiclePosition[] = []
  private onZoomEnd = () => this.updateView()
  private model = new InstancedVehicleModelLayer({
    id: 'ferry-3d-model', minZoom: MIN_ZOOM, mesh: MESH, label: 'ferry',
  })

  attach(map: MapLibreMap): void {
    this.map = map
    map.addSource(FERRY_3D_SOURCE_ID, {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: VEHICLE_SOURCE_MAXZOOM,
    })
    // Only the coarse envelope is tiled. All visible detail shares one GPU mesh,
    // just like the aircraft; the envelope keeps delegated click/hover handlers.
    map.addLayer({
      id: ALL_FERRY_3D_LAYERS[0], type: 'fill-extrusion', source: FERRY_3D_SOURCE_ID, minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-base': ['get', 'baseM'], 'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-opacity': 0,
      },
    })
    map.addLayer(this.model)
    // A paused simulation must still reveal its boats when zooming in.
    map.on('zoomend', this.onZoomEnd)
  }

  detach(): void {
    const map = this.map
    if (!map) return
    map.off('zoomend', this.onZoomEnd)
    if (map.getLayer(this.model.id)) map.removeLayer(this.model.id)
    for (const id of ALL_FERRY_3D_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(FERRY_3D_SOURCE_ID)) map.removeSource(FERRY_3D_SOURCE_ID)
    this.model.setVehicles([])
    this.ferries = []
    this.visible = []
    this.isEmpty = true
    this.map = null
  }

  setVehicles(ferries: VehiclePosition[]): void {
    this.ferries = ferries
    this.updateView()
  }

  private updateView(): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(FERRY_3D_SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    const visible = map.getZoom() >= MIN_ZOOM - .5 ? this.ferries : []
    if (visible.length === this.visible.length && visible.every((v, i) => v === this.visible[i])) return
    this.visible = visible
    this.model.setVehicles(visible)
    if (!visible.length && this.isEmpty) return
    src.setData({ type: 'FeatureCollection', features: buildFerryFeatures(visible) })
    this.isEmpty = !visible.length
  }
}
