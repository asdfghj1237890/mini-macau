import { getLrtTrack, LRT_DIRECTIONS, LRT_TRACK_HALF_WIDTH_M, offsetLrtCoordinates } from './lrtTracks'

// A single outline per running track, without internal segment end walls.
export function buildLrtViaduct(
  geometry: GeoJSON.Feature<GeoJSON.LineString> | GeoJSON.LineString,
  halfWidthM: number,
): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  const line = geometry.type === 'Feature' ? geometry.geometry : geometry
  const coordinates: GeoJSON.Position[][][] = []
  if (halfWidthM > 0) {
    const left = offsetLrtCoordinates(line.coordinates, halfWidthM)
    const right = offsetLrtCoordinates(line.coordinates, -halfWidthM)
    if (left.length >= 2) {
      const ring = [...right, ...left.reverse()]
      ring.push(ring[0])
      coordinates.push([ring])
    }
  }
  return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates }, properties: {} }
}

export function buildLrtDoubleViaduct(line: GeoJSON.Feature<GeoJSON.LineString>): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  return {
    type: 'Feature', properties: {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: LRT_DIRECTIONS.flatMap(direction =>
        buildLrtViaduct(getLrtTrack(line, direction), LRT_TRACK_HALF_WIDTH_M).geometry.coordinates),
    },
  }
}
