import { describe, expect, it } from 'vitest'
import { annotateRoutes, buildJunctionIndex, buildRoadIndex, geometryKey, matchRoad, roadDirection, routeJunctions } from './build-bus-road-profile.mjs'

const MX = 111320 * Math.cos(22.19 * Math.PI / 180)
const coord = (x, y) => [113.54 + x / MX, 22.19 + y / 111320]
const way = (id, a, b, tags = {}) => ({ type: 'way', id, tags: { highway: 'residential', ...tags }, geometry: [a, b].map(([x, y]) => { const [lon, lat] = coord(x, y); return { lon, lat } }) })
const match = (ways, a = [20, 0], b = [30, 0]) => matchRoad(coord(...a), coord(...b), buildRoadIndex(ways))

describe('offline bus road classification', () => {
  it('does not publish a synthetic lane identifier as an OSM way id on a reverse match', () => {
    const road = match([way('amaral/G', [0, 0], [100, 0], { oneway: 'yes', _lanePath: 'amaral/G' })], [30, 0], [20, 0])
    expect(road).toEqual({ kind: 'unknown', evidence: 'direction-mismatch' })
  })
  it('keeps a rounded terminal curve centred and preserves its surface-way identity', () => {
    const road = match([way(1, [0, 0], [100, 0], { oneway: 'yes', _lanePath: 'amaral/A' })], [20, -1], [21, 0])
    expect(road).toMatchObject({ evidence: 'terminal-layout', lanePath: 'amaral/A', wayId: 1, direction: 1 })
  })
  it('does not claim an underground junction for a modelled surface lane', () => {
    const tunnel = { ...way(20, [-40, 0], [0, 0], { tunnel: 'yes' }), nodes: [10, 11] }
    const east = { ...way(21, [0, 0], [40, 0], { tunnel: 'yes' }), nodes: [11, 12] }
    const north = { ...way(22, [0, 0], [0, 40], { tunnel: 'yes' }), nodes: [11, 13] }
    const index = buildJunctionIndex([tunnel, east, north])
    expect(index.zones).toHaveLength(1)
    expect(routeJunctions([coord(-40, 0), coord(40, 0)], index,
      [{ start: 0, end: 1, kind: 'one-way', evidence: 'terminal-layout', lanePath: 'amaral/G' }])).toEqual([])
  })
  it('honours negative direction, roundabouts, bus exceptions and conditional access', () => {
    expect(roadDirection({ oneway: '-1' })).toBe(-1)
    expect(roadDirection({ junction: 'roundabout' })).toBe(1)
    expect(roadDirection({ oneway: 'yes', 'oneway:bus': 'no' })).toBe(0)
    expect(roadDirection({ oneway: 'yes', 'oneway:psv': 'no' })).toBe(0)
    expect(roadDirection({ 'oneway:conditional': 'yes @ (08:00-10:00)' })).toBeNull()
    expect(roadDirection({ oneway: 'reversible' })).toBeNull()
  })
  it('separates explicit one-way, two-way and uncertain reverse geometry', () => {
    expect(match([way(1, [0, 0], [100, 0], { oneway: 'yes' })]).kind).toBe('one-way')
    expect(match([way(1, [0, 0], [100, 0], { oneway: 'no' })]).kind).toBe('two-way')
    expect(match([way(1, [0, 0], [100, 0], { oneway: '-1' })])).toMatchObject({ kind: 'unknown', evidence: 'direction-mismatch' })
  })
  it('pairs separately mapped opposing carriageways of the same road', () => {
    const ways = [way(1, [0, 0], [100, 0], { name: 'A', oneway: 'yes' }), way(2, [100, -8], [0, -8], { name: 'A', oneway: 'yes' })]
    expect(match(ways)).toMatchObject({ kind: 'divided', pairedWayId: 2, evidence: 'paired-geometry' })
    expect(match(ways, [30, -8], [20, -8])).toMatchObject({ kind: 'divided', pairedWayId: 1 })
  })
  it('does not confuse other streets, flyovers, roundabouts or same-direction lanes with a divided road', () => {
    const a = way(1, [0, 0], [100, 0], { name: 'A', oneway: 'yes' })
    for (const b of [
      way(2, [100, -8], [0, -8], { name: 'B', oneway: 'yes' }),
      way(2, [100, -8], [0, -8], { name: 'A', oneway: 'yes', bridge: 'yes', layer: '1' }),
      way(2, [0, -8], [100, -8], { name: 'A', oneway: 'yes' }),
    ]) expect(match([a, b]).kind).toBe('one-way')
    expect(match([{ ...a, tags: { ...a.tags, junction: 'roundabout' } }]).kind).toBe('one-way')
  })
  it('leaves distant geometry unmatched and never chooses a far lane to mask wrong-way geometry', () => {
    expect(match([way(1, [0, 20], [100, 20])]).kind).toBe('unknown')
    expect(match([way(1, [0, 0], [100, 0], { oneway: '-1' }), way(2, [0, 7], [100, 7], { oneway: 'yes' })]).evidence).toBe('direction-mismatch')
  })
  it('covers every segment and fingerprints the exact geometry', () => {
    const coords = [coord(0, 0), coord(25, 0), coord(50, 0)]
    const routes = annotateRoutes([{ geometry: { geometry: { coordinates: coords } } }], [way(1, [0, 0], [100, 0], { oneway: 'no', lanes: '2' })], '2026-09-12T00:00:00Z')
    expect(routes[0].roadProfile.sections).toHaveLength(1)
    expect(routes[0].roadProfile.sections[0]).toMatchObject({ start: 0, end: 2, lanes: 2 })
    expect(routes[0].roadProfile.geometryKey).toBe(geometryKey(coords))
    expect(geometryKey([coords[0], coord(26, 0), coords[2]])).not.toBe(geometryKey(coords))
  })
  it('records the official bridge lane correction without inventing carriageway width', () => {
    const result = match([way(1, [0, 0], [100, 0], { 'name:zh': '嘉樂庇總督大橋', oneway: 'no', lanes: '1' })])
    expect(result).toMatchObject({ kind: 'two-way', lanes: 2, osmLanes: 1 })
    expect(result.lanesSource).toContain('dsat.gov.mo')
    expect(result.widthM).toBeUndefined()
  })
  it('limits opposing-trace clearance to the close segments, preserving separated carriageways', () => {
    const route = points => ({ geometry: { geometry: { coordinates: points.map(p => coord(...p)) } } })
    const routes = annotateRoutes([
      route([[0, 0], [30, 0], [60, 0], [90, 0]]),
      route([[90, 8], [60, 8], [30, 0], [0, 0]]),
    ], [way(1, [0, 0], [90, 0], { oneway: 'yes', lanes: '1' })], '2026-09-12T00:00:00Z')
    const sections = routes[0].roadProfile.sections
    expect(sections[0]).toMatchObject({ start: 0, end: 1, opposingRouteGeometry: true })
    expect(sections.at(-1)).toMatchObject({ start: 1, end: 3, kind: 'one-way' })
    expect(sections.at(-1).opposingRouteGeometry).toBeUndefined()
  })
  it('uses connected nodes for junctions, not flyover geometry crossings', () => {
    const horizontal = { ...way(1, [-50, 0], [0, 0]), nodes: [1, 2] }
    const east = { ...way(2, [0, 0], [50, 0]), nodes: [2, 3] }
    const north = { ...way(3, [0, 0], [0, 50]), nodes: [2, 4] }
    const index = buildJunctionIndex([horizontal, east, north])
    expect(index.zones).toHaveLength(1)
    expect(routeJunctions([coord(-40, 0), coord(40, 0)], index)).toHaveLength(1)
    expect(routeJunctions([coord(-40, 0), coord(40, 0)], index, [{ start: 0, end: 1, wayId: 9 }])).toHaveLength(0)
    expect(buildJunctionIndex([horizontal, east, { ...north, nodes: [5, 4] }]).zones).toHaveLength(0)
  })
  it('bounds inner lanes at the narrow end of a long divided-road taper', () => {
    const roads = [way(1, [0, 0], [120, 0], { name: 'Taper', oneway: 'yes', lanes: '2' }),
      way(2, [120, -4.2], [0, -15], { name: 'Taper', oneway: 'yes', lanes: '1' })]
    const routes = roads.map(road => ({ geometry: { geometry: { coordinates: road.geometry.map(p => [p.lon, p.lat]) } } }))
    const annotated = annotateRoutes(routes, roads, '2026-09-12T00:00:00Z')
    expect(annotated[0].roadProfile.sections[0]).toMatchObject({ kind: 'divided', lanes: 2 })
    expect(annotated[0].roadProfile.sections[0].minLaneOffsetM).toBeGreaterThanOrEqual(-.6)
    // The one-lane opposing road already follows its own centre and gains no
    // invented extra lane or offset from this correction.
    expect(annotated[1].roadProfile.sections[0].minLaneOffsetM).toBeUndefined()
  })
  it('reserves a narrow two-way street over its full matched length', () => {
    const index = buildJunctionIndex([])
    const spans = routeJunctions([coord(0, 0), coord(100, 0)], index, [{ start: 0, end: 1, wayId: 1, kind: 'two-way', lanes: 1 }])
    expect(spans).toMatchObject([{ id: 'n1', start: 0, end: 1 }])
  })
})
