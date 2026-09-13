import { describe, expect, it } from 'vitest'
import { busLaneLayout, busLaneOffset, sampleBusLaneBody, sampleBusLaneCourse } from './busLaneGeometry'
import { sampleBusPose } from './simulationEngine'
import type { Feature, LineString } from 'geojson'
import { busGeometryKey } from './busRoadProfile'
import type { BusRoadProfile, BusRoadSection } from '../types'

const section = (kind: BusRoadSection['kind'], extra: Partial<BusRoadSection> = {}): BusRoadSection => ({ start: 0, end: 2, kind, evidence: 'tag', ...extra })
describe('classified bus lanes', () => {
  it('faces the outgoing road after a short reversing bend instead of dragging its rear axle backwards', () => {
    const line = {}, front = (distance: number) => {
      if (distance <= 20) return { x: distance, y: 0, fx: 1, fy: 0 }
      if (distance < 20 + Math.PI) {
        const angle = distance - 20
        return { x: 20 + Math.sin(angle), y: 1 - Math.cos(angle), fx: Math.cos(angle), fy: Math.sin(angle) }
      }
      return { x: 20 - (distance - 20 - Math.PI), y: 2, fx: -1, fy: 0 }
    }
    for (let metre = 34; metre <= 50; metre++) {
      const pose = sampleBusLaneBody(line, undefined, 60, metre / 60, false, front, 0)
      expect(pose.fx, `outgoing heading at ${metre}m`).toBeLessThan(-.9)
    }
  })
  it('follows a sharp corner with the rear axle and reuses the path for other vehicles', () => {
    const line = {}, headings: number[] = []
    let samples = 0
    const front = (distance: number) => {
      samples++
      return distance <= 50 ? { x: distance, y: 0, fx: 1, fy: 0 } : { x: 50, y: distance - 50, fx: 0, fy: 1 }
    }
    for (let metre = 20; metre <= 85; metre++) {
      const pose = sampleBusLaneBody(line, undefined, 100, metre / 100, false, front)
      headings.push(Math.atan2(pose.fx, pose.fy) * 180 / Math.PI)
    }
    for (let i = 1; i < headings.length; i++) expect(Math.abs(headings[i] - headings[i - 1])).toBeLessThan(15)
    expect(headings[0]).toBeCloseTo(90)
    expect(headings.at(-1)).toBeLessThan(1)
    const corner = sampleBusLaneBody(line, undefined, 100, .5, false, front)
    expect(corner.x + corner.fx * 3.4).toBeCloseTo(50, 4)
    expect(corner.y + corner.fy * 3.4).toBeCloseTo(3.4, 4)
    const builtSamples = samples
    sampleBusLaneBody(line, undefined, 100, .8, false, front)
    sampleBusLaneBody(line, undefined, 100, .1, false, front)
    expect(samples).toBe(builtSamples)
  })
  it('keeps a one-way carriageway centred and separates traffic on a two-way road', () => {
    expect(busLaneOffset(section('one-way', { lanes: 1, widthM: 3.5 }))).toBe(0)
    expect(busLaneOffset(section('divided', { lanes: 1, widthM: 3.5 }))).toBe(0)
    expect(busLaneOffset(section('two-way', { lanes: 2, widthM: 7 }))).toBe(1.75)
    expect(busLaneOffset(section('two-way', { lanes: 1, widthM: 4 }))).toBe(0)
    expect(busLaneOffset(section('unknown'))).toBe(3.25)
    expect(busLaneOffset(section('one-way', { lanes: 1 }))).toBe(0)
    expect(busLaneOffset(section('one-way'))).toBe(0)
  })
  it('counts each direction separately and leaves an ambiguous centre lane unused', () => {
    expect(busLaneLayout(section('one-way', { lanes: 3 })).offsets).toEqual([3.5, 0, -3.5])
    expect(busLaneLayout(section('divided', { lanes: 2 })).offsets).toEqual([1.75, -1.75])
    expect(busLaneLayout(section('two-way', { lanes: 4 })).offsets).toEqual([5.25, 1.75])
    expect(busLaneLayout(section('two-way', { lanes: 3 })).offsets).toEqual([3.5])
    const asymmetric = section('two-way', { lanes: 3, directionalLanes: 2 })
    expect(busLaneLayout(asymmetric).offsets).toEqual([3.5, 0])
    expect(busLaneLayout(asymmetric, true).offsets).toEqual([3.5])
    expect(busLaneLayout(section('divided', { lanes: 4, opposingRouteGeometry: true })).offsets).toEqual([3.25])
    expect(busLaneLayout(section('two-way', { lanes: 1 })).offsets).toEqual([0])
    expect(busLaneLayout(section('one-way', { lanes: 3, widthM: 5 })).offsets).toEqual([0])
  })

  it('preserves separated traces when a one-way match has the wrong direction', () => {
    const mismatch = section('unknown', { evidence: 'direction-mismatch', wayId: 12 })
    expect(busLaneOffset(mismatch)).toBe(0)
    expect(busLaneOffset({ ...mismatch, opposingRouteGeometry: true })).toBe(3.25)
    const north = [[113.54, 22.19], [113.54, 22.192]]
    const south = [[113.53996, 22.192], [113.53996, 22.19]]
    const pose = (coords: number[][], road: BusRoadSection) => sampleBusPose(
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }, .5, false,
      { version: 1, geometryKey: busGeometryKey(coords), fetchedAtUtc: '2026-09-12T00:00:00Z', sections: [{ ...road, end: 1 }] })
    const a = pose(north, section('one-way')), b = pose(south, mismatch)
    const clearance = Math.abs(a.coordinates[0] - b.coordinates[0]) * 111320 * Math.cos(22.19 * Math.PI / 180)
    expect(clearance).toBeGreaterThan(3)
  })

  it('uses only lane centres that fit beside the opposing carriageway', () => {
    expect(busLaneLayout(section('divided', { lanes: 2, minLaneOffsetM: -.6 })).offsets).toEqual([1.75])
    expect(busLaneLayout(section('divided', { lanes: 3, minLaneOffsetM: -2.4 })).offsets).toEqual([3.5, 0])
    expect(busLaneLayout(section('divided', { lanes: 3, minLaneOffsetM: -4 })).offsets).toEqual([3.5, 0, -3.5])
  })

  it('merges before a lane drop, serves the kerb stop, and caches each lane independently', () => {
    const line = {}, inner = { preference: 2, stops: [.3] }, outer = { preference: 0, stops: [.3] }
    let reads = 0
    const roadAt = (m: number) => { reads++; return section('one-way', { lanes: m < 700 ? 3 : 1 }) }
    const sample = (m: number, plan = inner) => sampleBusLaneCourse(line, undefined, 1000, m / 1000, false, roadAt, plan)
    expect(sample(50)).toBeCloseTo(-3.5)
    expect(sample(300)).toBeCloseTo(3.5)
    expect(sample(550)).toBeCloseTo(3.5)
    expect(sample(700)).toBeCloseTo(0)
    expect(sample(750)).toBeCloseTo(0)
    expect(sample(50, outer)).toBeCloseTo(3.5)
    const built = reads
    for (let m = 1; m <= 1000; m++) {
      expect(Math.abs(sample(m) - sample(m - 1))).toBeLessThanOrEqual(.041)
    }
    expect(reads).toBe(built)
  })
  it('moves to the terminal entry lane in advance and keeps it after departure', () => {
    const line = {}, lane = { preference: 2, stops: [] }
    const roadAt = (m: number) => section('one-way', { lanes: 3, ...(m >= 400 && m <= 600 ? { entryLane: 'left' as const } : {}) })
    const sample = (m: number) => sampleBusLaneCourse(line, undefined, 1000, m / 1000, false, roadAt, lane)
    expect(sample(50)).toBeCloseTo(-3.5)
    expect(sample(400)).toBeCloseTo(3.5)
    expect(sample(850)).toBeCloseTo(3.5)
    expect(busLaneLayout(roadAt(500)).offsets).toHaveLength(3)
    for (let m = 1; m <= 1000; m++) expect(Math.abs(sample(m) - sample(m - 1))).toBeLessThanOrEqual(.041)
  })
  it('retains the nearest surviving lane when three lanes become two', () => {
    const line = {}, lane = { preference: 2, stops: [] }
    const roadAt = (m: number) => section('one-way', { lanes: m < 500 ? 3 : 2 })
    expect(sampleBusLaneCourse(line, undefined, 1000, .8, false, roadAt, lane)).toBeCloseTo(-1.75)
  })
  it('stays in the kerb lane between stops and after the last stop', () => {
    const line = {}, lane = { preference: 2, stops: [.3, .65] }
    const roadAt = () => section('one-way', { lanes: 3 })
    const sample = (metres: number) => sampleBusLaneCourse(line, undefined, 1000, metres / 1000, false, roadAt, lane)
    expect(sample(50)).toBeCloseTo(-3.5)
    for (let metres = 300; metres <= 1000; metres += 10) expect(sample(metres)).toBeCloseTo(3.5)
  })
  it('keeps the surviving lane when a road widens again', () => {
    const line = {}, lane = { preference: 2, stops: [] }
    const roadAt = (metres: number) => section('one-way', { lanes: metres < 350 || metres >= 650 ? 3 : 2 })
    const sample = (metres: number) => sampleBusLaneCourse(line, undefined, 1000, metres / 1000, false, roadAt, lane)
    expect(sample(50)).toBeCloseTo(-3.5)
    expect(sample(500)).toBeCloseTo(-1.75)
    expect(sample(850)).toBeCloseTo(0)
    expect(sample(1000)).toBeCloseTo(0)
  })
  it('holds independent lanes until a stop or lane drop requires a change', () => {
    const line = {}, roadAt = () => section('one-way', { lanes: 3 })
    for (const preference of [0, 1, 2]) {
      const lane = { preference, stops: [] }
      for (const progress of [.9, .1, .5, 1, 0]) {
        expect(sampleBusLaneCourse(line, undefined, 1000, progress, false, roadAt, lane)).toBeCloseTo(3.5 - preference * 3.5)
      }
    }
  })
  it('retains its lane after a return-direction stop, even when seeking out of order', () => {
    const line = {}, lane = { preference: 1, stops: [.65, .2] }
    const roadAt = () => section('two-way', { lanes: 4 })
    const sample = (progress: number) => sampleBusLaneCourse(line, undefined, 1000, progress, true, roadAt, lane)
    for (const progress of [.1, .95, .2, .5, .65, 0, .95]) {
      expect(sample(progress)).toBeCloseTo(progress > .9 ? 1.75 : 5.25)
    }
  })
  it('places opposite journeys on opposite sides without changing schedule distance', () => {
    const coords: [number, number][] = [[113.54, 22.19], [113.54, 22.1905], [113.54, 22.191]]
    const line: Feature<LineString> = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
    const profile: BusRoadProfile = { version: 1, geometryKey: busGeometryKey(coords), fetchedAtUtc: '2026-09-12T00:00:00Z', sections: [section('two-way', { lanes: 2, widthM: 8 })] }
    const a = sampleBusPose(line, .5, false, profile).coordinates
    const b = sampleBusPose(line, .5, true, profile).coordinates
    expect(a[0]).toBeLessThan(113.54)
    expect(b[0]).toBeGreaterThan(113.54)
    expect(a[1]).toBeCloseTo(22.1905, 10)
    expect(b[1]).toBeCloseTo(a[1], 10)
    expect((b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180)).toBeCloseTo(4, 4)
  })
})
