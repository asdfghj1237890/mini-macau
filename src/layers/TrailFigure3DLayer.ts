import type { Map as MapLibreMap } from 'maplibre-gl'
import { InstancedVehicleModelLayer, type ModelInstance } from './InstancedVehicleModelLayer'
import { createHikerMesh, createPhotographerMesh } from './hikerMesh'

// The TRAILS overlay's LEGO-style figures, drawn only from zoom 19 in (the
// user's choice; the flat marker under each fades out just before):
//   * hikers — one at each entrance of an open walking trail, facing up it;
//   * photographers — one on each summit an open walking trail reaches (its
//     line or a climb within 30 m of the top), taking a photo of the view.
// Decorative: clicks go to the entrance / summit marker underneath. The
// photographers stand BESIDE their summit (the user's request): moved towards
// the left of the screen by a distance tied to the figure's size, recomputed
// as the map zooms or rotates, so the triangle and the name / height label to
// its right stay clear.
export const HIKER_MIN_ZOOM = 19
const HIKER_MESH = createHikerMesh()
const PHOTOGRAPHER_MESH = createPhotographerMesh()

// Scale factor of the 1.78 m figure: 3.7 at zoom 19 (about 6.6 m, ~24 px),
// halving per zoom level in until life size (zoom 20.9), so it does not start
// as a few pixels.
export function hikerScale(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.max(1, 3.7 * Math.pow(2, 19 - zoom))
}

export type HikerPose = Pick<ModelInstance, 'coordinates' | 'bearing' | 'color'>

// `point` moved `metres` towards the left of a screen whose top faces
// `mapBearing` (a compass bearing, as map.getBearing() gives it).
export function besideOnScreen(point: [number, number], metres: number, mapBearing: number): [number, number] {
  const toward = ((mapBearing - 90) * Math.PI) / 180
  const lat = point[1] + (metres * Math.cos(toward)) / 110_574
  const lng = point[0] + (metres * Math.sin(toward)) / (111_320 * Math.cos((point[1] * Math.PI) / 180))
  return [lng, lat]
}

export class TrailFigure3DLayer {
  private map: MapLibreMap | null = null
  private figures: HikerPose[] = []
  private shown = false
  private onView = () => this.push()
  private model: InstancedVehicleModelLayer
  // Metres per unit of figure scale to stand to the screen-left of the
  // point; 0 = on the point.
  private beside: number

  constructor(options: { id: string; mesh: Float32Array; label: string; beside?: number }) {
    this.model = new InstancedVehicleModelLayer({ id: options.id, minZoom: HIKER_MIN_ZOOM, mesh: options.mesh, label: options.label })
    this.beside = options.beside ?? 0
  }

  attach(map: MapLibreMap): void {
    this.map = map
    map.addLayer(this.model)
    map.on('zoom', this.onView)
    if (this.beside) map.on('rotate', this.onView)
    this.push()
  }

  detach(): void {
    const map = this.map
    if (!map) return
    map.off('zoom', this.onView)
    map.off('rotate', this.onView)
    if (map.getLayer(this.model.id)) map.removeLayer(this.model.id)
    this.model.setInstances([])
    this.shown = false
    this.map = null
  }

  setFigures(figures: HikerPose[]): void {
    this.figures = figures
    this.push()
  }

  // Rewritten on every zoom frame while visible: a few dozen instances, one
  // bufferSubData. Below the minimum zoom the buffer is emptied once.
  private push(): void {
    const map = this.map
    if (!map) return
    const zoom = map.getZoom()
    if (zoom < HIKER_MIN_ZOOM - .5 || !this.figures.length) {
      if (this.shown) this.model.setInstances([])
      this.shown = false
      return
    }
    const scale = hikerScale(zoom)
    const offset = this.beside * scale
    const mapBearing = map.getBearing()
    this.model.setInstances(this.figures.map(figure => ({
      ...figure,
      scale,
      coordinates: offset ? besideOnScreen(figure.coordinates, offset, mapBearing) : figure.coordinates,
    })))
    this.shown = true
  }
}

export function createTrailHikerLayer(): TrailFigure3DLayer {
  return new TrailFigure3DLayer({ id: 'trail-hikers-3d', mesh: HIKER_MESH, label: 'hiker' })
}

export function createSummitPhotographerLayer(): TrailFigure3DLayer {
  // 1.6 m per unit of scale: about 22 px left of the summit at every zoom, a
  // figure's width clear of the triangle.
  return new TrailFigure3DLayer({ id: 'trail-photographers-3d', mesh: PHOTOGRAPHER_MESH, label: 'photographer', beside: 1.6 })
}
