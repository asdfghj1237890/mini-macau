import { describe, expect, it } from 'vitest'
import type { BusRoadProfile, BusRoadSection } from '../types'
import { busGeometryKey, sampleBusRoad } from './busRoadProfile'
import { sampleBusPose } from './simulationEngine'
import type { Feature, LineString } from 'geojson'

const coords = [[113.54, 22.19], [113.541, 22.19], [113.542, 22.19], [113.543, 22.19]]
const cumulative = new Float64Array([0, .1, .2, .3])
function section(kind: BusRoadSection['kind'], start: number, end: number): BusRoadSection {
  return { start, end, kind, evidence: kind === 'divided' ? 'paired-geometry' : 'tag', wayId: 1, direction: 1,
    ...(kind === 'divided' ? { pairedWayId: 2 } : {}) }
}
function profile(sections: BusRoadSection[]): BusRoadProfile {
  return { version: 1, geometryKey: busGeometryKey(coords), fetchedAtUtc: '2026-09-12T00:00:00Z', sections }
}

describe('bus road classification lookup', () => {
  const p = profile([section('one-way', 0, 1), section('two-way', 1, 2), section('divided', 2, 3)])
  it('selects each road span by distance, including boundaries and endpoints', () => {
    for (const [distance, kind] of [[-.01, 'one-way'], [.05, 'one-way'], [.1, 'two-way'], [.15, 'two-way'], [.2, 'divided'], [.31, 'divided']] as const) {
      expect(sampleBusRoad(p, coords, cumulative, distance).kind).toBe(kind)
    }
  })
  it('carries matched OSM evidence into the pose', () => {
    const line: Feature<LineString> = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }
    const pose = sampleBusPose(line, .8, false, p)
    expect(pose.road).toMatchObject({ kind: 'divided', evidence: 'paired-geometry', wayId: 1, pairedWayId: 2 })
    expect(pose.coordinates.every(Number.isFinite)).toBe(true)
  })
  it('rejects stale or incomplete geometry profiles instead of applying wrong spans', () => {
    expect(sampleBusRoad(p, [[113.54, 22.1902], ...coords.slice(1)], cumulative, .05).kind).toBe('unknown')
    expect(sampleBusRoad(profile([section('one-way', 1, 3)]), coords, cumulative, .05).kind).toBe('unknown')
    expect(sampleBusRoad(undefined, coords, cumulative, .05).kind).toBe('unknown')
  })
})
