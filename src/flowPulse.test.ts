import { describe, it, expect } from 'vitest'
import { arrivalDistances, buildPulseFeatures, haversineM } from './flowPulse'
import type { PulseEdge } from './flowPulse'

// The generic engine is already exercised end-to-end through the WATER
// wrappers (src/water.test.ts) and the POWER wrappers (src/power.test.ts).
// What is NOT covered from either side is `extraNodeIds` — a network's own
// nodes (inlets) counting as roots even with no edge at all — and
// `buildPulseFeatures`'s `extraProps` hook. A handful of direct tests here is
// enough; this is not a full re-test of the wrapper behaviour.

const P0 = [113.5000, 22.2000]
const P1 = [113.5000, 22.2090]

describe('arrivalDistances', () => {
  it('treats an extra node id with no edge at all as its own root, at distance 0', () => {
    const edges: PulseEdge[] = [{ id: 'ab', from: 'a', to: 'b', coordinates: [P0, P1] }]
    const dist = arrivalDistances(edges, ['isolated'])
    expect(dist.get('isolated')).toBe(0)
    expect(dist.get('a')).toBe(0) // also a root: nothing flows into it
    expect(dist.get('b')).toBeCloseTo(haversineM(P0, P1), 6)
  })

  it('does not let an extra node id override a real inbound arrival', () => {
    // 'b' has an inbound edge, so it is not naturally a root — listing it as
    // an extra id must not clobber the distance Dijkstra actually computes.
    const edges: PulseEdge[] = [{ id: 'ab', from: 'a', to: 'b', coordinates: [P0, P1] }]
    const dist = arrivalDistances(edges, ['b'])
    expect(dist.get('b')).toBeCloseTo(haversineM(P0, P1), 6)
  })

  it('defaults to no extra roots when none are given', () => {
    const edges: PulseEdge[] = [{ id: 'ab', from: 'a', to: 'b', coordinates: [P0, P1] }]
    expect(arrivalDistances(edges)).toEqual(arrivalDistances(edges, []))
  })
})

describe('buildPulseFeatures', () => {
  it('merges extraProps into every chunk alongside bucket', () => {
    const edges: PulseEdge[] = [{ id: 'e1', from: 'a', to: 'b', coordinates: [P0, P1] }]
    // A bucket far bigger than the ~1000 m edge, so it comes back as one chunk.
    const build = buildPulseFeatures(edges, 1_000_000, 10, edge => ({ tag: `tag-${edge.id}` }))
    expect(build.features.features).toHaveLength(1)
    expect(build.features.features[0].properties).toEqual({ bucket: 0, tag: 'tag-e1' })
    expect(build.buckets).toBe(1)
  })

  it('omits extra properties entirely when no extraProps function is given', () => {
    const edges: PulseEdge[] = [{ id: 'e1', from: 'a', to: 'b', coordinates: [P0, P1] }]
    const build = buildPulseFeatures(edges, 1_000_000, 10)
    expect(build.features.features[0].properties).toEqual({ bucket: 0 })
  })
})
