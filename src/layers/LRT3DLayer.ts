import type { Map as MapLibreMap } from 'maplibre-gl'
import type { LRTLine, VehiclePosition } from '../types'
import { VEHICLE_SOURCE_MAXZOOM } from './VehicleLayer'
import { InstancedVehicleModelLayer } from './InstancedVehicleModelLayer'
import { createLrtMesh, LRT_VIADUCT_TOP_M } from './lrtMesh'
import { buildLrtFeatures } from './lrtGeometry'
import { lrtArticulation } from './lrtArticulation'

const SOURCE_ID = 'lrt-3d-source'
export const ALL_LRT_3D_LAYERS = ['lrt-3d-body', 'lrt-3d-gangway']
const IS_MOBILE = window.matchMedia('(max-width: 639px)').matches
const MIN_ZOOM = IS_MOBILE ? 16 : 16.9
const MESH = createLrtMesh()

export class LRT3DLayer {
  private map: MapLibreMap | null = null
  private isEmpty = true
  private model = new InstancedVehicleModelLayer({
    id: 'lrt-3d-model', minZoom: MIN_ZOOM, mesh: MESH,
    groundAltitude: LRT_VIADUCT_TOP_M, label: 'lrt', articulated: true,
  })

  attach(map: MapLibreMap): void {
    this.map = map
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      maxzoom: VEHICLE_SOURCE_MAXZOOM,
    })
    // Small invisible volumes preserve delegated map click/hover behaviour.
    // The detailed train is one shared, instanced mesh in the map's GL context.
    for (const id of ALL_LRT_3D_LAYERS) {
      map.addLayer({
        id, type: 'fill-extrusion', source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], id.slice('lrt-3d-'.length)],
        minzoom: MIN_ZOOM,
        paint: {
          'fill-extrusion-base': ['get', 'baseM'],
          'fill-extrusion-height': ['get', 'heightM'],
          'fill-extrusion-opacity': 0,
        },
      })
    }
    map.addLayer(this.model)
  }

  detach(): void {
    const map = this.map
    if (!map) return
    if (map.getLayer(this.model.id)) map.removeLayer(this.model.id)
    for (const id of ALL_LRT_3D_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    this.map = null
  }

  setVehicles(lrts: VehiclePosition[], lines: LRTLine[] = []): void {
    const map = this.map
    if (!map) return
    const src = map.getSource(SOURCE_ID) as unknown as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    if (!src?.setData) return
    const belowMin = map.getZoom() < MIN_ZOOM - 0.5
    const poses = belowMin ? [] : lrts.map(v => lrtArticulation(v, lines.find(line => line.id === v.lineId)?.geometry))
    this.model.setVehicles(belowMin ? [] : lrts, poses)
    if (belowMin || lrts.length === 0) {
      if (this.isEmpty) return
      src.setData({ type: 'FeatureCollection', features: [] })
      this.isEmpty = true
      return
    }
    src.setData({ type: 'FeatureCollection', features: buildLrtFeatures(lrts, poses) })
    this.isEmpty = false
  }
}
