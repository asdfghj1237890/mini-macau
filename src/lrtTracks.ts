import type { Feature, LineString, Position } from 'geojson'

export type LrtDirection = 'forward' | 'backward'
export const LRT_DIRECTIONS: readonly LrtDirection[] = ['forward', 'backward']
// The map's enlarged train is 8.64 m wide. Leave room for its rigid cab
// overhang on curves as well as a visible gap between opposing trains.
export const LRT_TRACK_OFFSET_M = 7.5
export const LRT_TRACK_HALF_WIDTH_M = 5.5
const METERS_PER_DEG_LAT = 111320
type Point = [number, number]

// Positive is left of the source direction. Shared miter joins keep the
// running line and its continuous guideway aligned through source vertices.
export function offsetLrtCoordinates(coordinates: Position[], offsetM: number): Point[] {
  if (!coordinates.length) return []
  const [lng0, lat0] = coordinates[0]
  const metersPerLng = METERS_PER_DEG_LAT * Math.max(Math.cos(lat0 * Math.PI / 180), 1e-6)
  const points: Point[] = []
  for (const [lng, lat] of coordinates) {
    const p: Point = [(lng - lng0) * metersPerLng, (lat - lat0) * METERS_PER_DEG_LAT]
    const previous = points.at(-1)
    if (!previous || Math.hypot(p[0] - previous[0], p[1] - previous[1]) >= .001) points.push(p)
  }
  const coordinate = (x: number, y: number): Point => [lng0 + x / metersPerLng, lat0 + y / METERS_PER_DEG_LAT]
  if (points.length < 2 || offsetM === 0) return points.map(([x, y]) => coordinate(x, y))
  const normals: Point[] = points.slice(1).map((p, i) => {
    const dx = p[0] - points[i][0], dy = p[1] - points[i][1], length = Math.hypot(dx, dy)
    return [-dy / length, dx / length]
  })
  return points.map(([x, y], i) => {
    const before = normals[Math.max(0, i - 1)], after = normals[Math.min(normals.length - 1, i)]
    const denominator = 1 + before[0] * after[0] + before[1] * after[1]
    let nx = after[0] * offsetM, ny = after[1] * offsetM
    if (denominator > 1e-6) {
      nx = (before[0] + after[0]) * offsetM / denominator
      ny = (before[1] + after[1]) * offsetM / denominator
    }
    const limit = Math.min(1, Math.abs(offsetM) * 3 / Math.hypot(nx, ny))
    return coordinate(x + nx * limit, y + ny * limit)
  })
}

const tracks = new WeakMap<Feature<LineString>, Record<LrtDirection, Feature<LineString>>>()

function runningCoordinates(line: Feature<LineString>): Point[] {
  const points = offsetLrtCoordinates(line.geometry.coordinates, 0)
  if (points.length < 3) return points
  const lngM = METERS_PER_DEG_LAT * Math.cos(points[0][1] * Math.PI / 180)
  const isEndSpur = (a: Point, b: Point, c: Point) => {
    const ux = (b[0] - a[0]) * lngM, uy = (b[1] - a[1]) * METERS_PER_DEG_LAT
    const vx = (c[0] - b[0]) * lngM, vy = (c[1] - b[1]) * METERS_PER_DEG_LAT
    const first = Math.hypot(ux, uy), second = Math.hypot(vx, vy)
    return first < 10 && second > first * 3 && ux * vx + uy * vy < -.5 * first * second
  }
  // A short reversed stub at a stitched terminus is not a train U-turn.
  // Preserve the endpoint/station anchor; bypass only its intermediate tip.
  while (points.length >= 3 && isEndSpur(points[0], points[1], points[2])) points.splice(1, 1)
  while (points.length >= 3 && isEndSpur(points.at(-1)!, points.at(-2)!, points.at(-3)!)) points.splice(-2, 1)
  return points
}

export function getLrtTrack(line: Feature<LineString>, direction: LrtDirection): Feature<LineString> {
  let pair = tracks.get(line)
  if (!pair) {
    const coordinates = runningCoordinates(line)
    const make = (offset: number): Feature<LineString> => ({
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: offsetLrtCoordinates(coordinates, offset) },
    })
    // Keep both coordinate arrays in the original station order. Travel
    // direction controls heading, never the chosen track or its orientation.
    pair = { forward: make(LRT_TRACK_OFFSET_M), backward: make(-LRT_TRACK_OFFSET_M) }
    tracks.set(line, pair)
  }
  return pair[direction]
}
