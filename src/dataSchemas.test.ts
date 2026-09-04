/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { z } from 'zod'
import {
  LRTLinesSchema,
  StationsSchema,
  TripsSchema,
  BusRoutesSchema,
  BusStopsSchema,
  FlightsSchema,
  FerryScheduleFileSchema,
  RoadWorksFileSchema,
  SchoolsFileSchema,
  ToiletsFileSchema,
  CarParksFileSchema,
  WaterFacilitiesFileSchema,
  WaterDistributionFileSchema,
} from './dataSchemas'

// Parse the actual JSON the app ships and assert it satisfies the runtime
// contract. This guards against a scrape or hand-edit committing malformed
// data — it runs in CI alongside the unit tests, so bad data fails the build
// instead of reaching the browser.
const dataDir = resolve(__dirname, '..', 'public', 'data')
// LRT trips are bundled from src/data rather than served under /data/ — see
// `loadTrips` in hooks/useTransitData.ts.
const tripsDir = resolve(__dirname, 'data')
const load = (f: string, dir = dataDir): unknown => JSON.parse(readFileSync(resolve(dir, f), 'utf8'))

function expectValid(schema: z.ZodType, file: string, dir = dataDir) {
  const res = schema.safeParse(load(file, dir))
  if (!res.success) {
    const summary = res.error.issues
      .slice(0, 10)
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n  ')
    throw new Error(`${file} failed schema validation:\n  ${summary}`)
  }
  expect(res.success).toBe(true)
}

describe('committed data files satisfy their schemas', () => {
  it('lrt-lines.json', () => expectValid(LRTLinesSchema, 'lrt-lines.json'))
  it('stations.json', () => expectValid(StationsSchema, 'stations.json'))
  it('trips-mon_thu.json', () => expectValid(TripsSchema, 'trips-mon_thu.json', tripsDir))
  it('trips-friday.json', () => expectValid(TripsSchema, 'trips-friday.json', tripsDir))
  it('trips-sat_sun.json', () => expectValid(TripsSchema, 'trips-sat_sun.json', tripsDir))
  it('bus-routes.json', () => expectValid(BusRoutesSchema, 'bus-routes.json'))
  it('bus-stops.json', () => expectValid(BusStopsSchema, 'bus-stops.json'))
  it('flights.json', () => expectValid(FlightsSchema, 'flights.json'))
  it('flights-timetable.json', () => expectValid(FlightsSchema, 'flights-timetable.json'))
  it('ferry-schedules.json', () => expectValid(FerryScheduleFileSchema, 'ferry-schedules.json'))
  it('road-works.json', () => expectValid(RoadWorksFileSchema, 'road-works.json'))
  it('schools.json', () => expectValid(SchoolsFileSchema, 'schools.json'))
  it('toilets.json', () => expectValid(ToiletsFileSchema, 'toilets.json'))
  it('car-parks.json', () => expectValid(CarParksFileSchema, 'car-parks.json'))
  it('water-facilities.json', () => expectValid(WaterFacilitiesFileSchema, 'water-facilities.json'))
  it('water-distribution.json', () => expectValid(WaterDistributionFileSchema, 'water-distribution.json'))
})

// water-distribution.json is loaded lazily and best-effort, so its schema is
// deliberately loose everywhere except `roads` — the only field the map reads.
describe('WaterDistributionFileSchema', () => {
  const road = { class: 'primary', coordinates: [[113.54, 22.19], [113.545, 22.192]] }

  it('accepts the full envelope and a bare roads list alike', () => {
    expect(WaterDistributionFileSchema.safeParse({
      fetchedAtUtc: '2026-09-04T00:00:00Z',
      sources: { osm: 'https://www.openstreetmap.org/copyright' },
      classes: ['primary', 'service'],
      roads: [road],
    }).success).toBe(true)
    expect(WaterDistributionFileSchema.safeParse({ roads: [road] }).success).toBe(true)
    expect(WaterDistributionFileSchema.safeParse({ roads: [] }).success).toBe(true)
  })

  it('takes any class string — the pipeline decides which roads to ship', () => {
    expect(WaterDistributionFileSchema.safeParse({
      roads: [{ ...road, class: 'living_street' }],
    }).success).toBe(true)
  })

  it('accepts the outward-orientation extras: dist / distEnd, null included', () => {
    // Added when the roads were oriented away from the treated-water sources.
    // Null is the honest value for a road the outward walk never reached, so it
    // has to validate — dropping those roads would leave holes in the mesh.
    expect(WaterDistributionFileSchema.safeParse({
      roads: [{ ...road, dist: 1403, distEnd: 3835 }],
    }).success).toBe(true)
    expect(WaterDistributionFileSchema.safeParse({
      roads: [{ ...road, dist: null, distEnd: null }],
    }).success).toBe(true)
    // …and a file written before the field existed still validates.
    expect(WaterDistributionFileSchema.safeParse({ roads: [road] }).success).toBe(true)
  })

  it('accepts the orientation bookkeeping: flowSources / unreached / splits', () => {
    expect(WaterDistributionFileSchema.safeParse({
      sources: { osm: 'https://www.openstreetmap.org/copyright' },
      flowSources: ['wtp-ilha-verde', 'tank-guia-50'],
      unreached: 143,
      splits: 219,
      roads: [{ ...road, dist: 0, distEnd: 812 }],
    }).success).toBe(true)
    // …and none of it is required: the runtime reads none of these.
    expect(WaterDistributionFileSchema.safeParse({ roads: [road] }).success).toBe(true)
  })

  it('takes `sources` in either shape the envelope has carried', () => {
    // It is the provenance object today, but this file's envelope has already
    // changed twice and nothing reads the key — pinning it buys a break.
    expect(WaterDistributionFileSchema.safeParse({
      sources: { osm: 'https://www.openstreetmap.org/copyright' }, roads: [road],
    }).success).toBe(true)
    expect(WaterDistributionFileSchema.safeParse({
      sources: [{ id: 'wtp-ilha-verde' }], roads: [road],
    }).success).toBe(true)
  })

  it('rejects a missing roads list and a road that is not a line', () => {
    expect(WaterDistributionFileSchema.safeParse({ classes: [] }).success).toBe(false)
    expect(WaterDistributionFileSchema.safeParse({
      roads: [{ class: 'primary', coordinates: [[113.54, 22.19]] }],
    }).success).toBe(false)
  })
})

// The pipe network was added after the facility list shipped, so the `network`
// block is optional: a file written before it must still validate, and a file
// with a malformed one must not silently reach the map.
describe('WaterFacilitiesFileSchema — the optional pipe network', () => {
  const base = {
    fetchedAtUtc: '2026-09-04T00:00:00Z',
    sources: { name: '澳門自來水 (Macao Water)' },
    facilities: [{
      id: 'wtp-ilha-verde',
      no: 1,
      type: 'plant',
      name: { zh: '青洲水廠', pt: '', en: 'Ilha Verde Water Treatment Plant' },
      coordinates: [113.5404, 22.2114],
      approximate: false,
      anchor: null,
      osm: ['w241618704'],
      buildings: [],
      water: [],
    }],
  }
  const net = {
    nodes: [{
      id: 'inlet-zhuhai',
      kind: 'inlet',
      name: { zh: '珠海原水輸入', pt: 'Água bruta de Zhuhai', en: 'Raw water from Zhuhai' },
      coordinates: [113.539, 22.216],
    }],
    pipes: [{
      id: 'raw-inlet-ilha-verde',
      from: 'inlet-zhuhai',
      to: 'wtp-ilha-verde',
      kind: 'raw',
      lengthM: 420,
      fallback: false,
      coordinates: [[113.539, 22.216], [113.5404, 22.2114]],
    }],
  }

  it('accepts a file with no network at all (the shape that shipped first)', () => {
    expect(WaterFacilitiesFileSchema.safeParse(base).success).toBe(true)
  })

  it('accepts the government reservoir: no Macao Water number, dsama operator', () => {
    const hacSa = {
      ...base.facilities[0],
      id: 'res-hac-sa',
      no: null,
      type: 'reservoir',
      operator: 'dsama',
      name: { zh: '黑沙水庫', pt: '', en: 'Hac Sa Reservoir' },
      water: [{ osmId: 'w1', coordinates: [[[113.55, 22.12], [113.56, 22.12], [113.55, 22.12]]] }],
    }
    const res = WaterFacilitiesFileSchema.safeParse({ ...base, facilities: [hacSa] })
    expect(res.success).toBe(true)
    // The default only fills the PARSED copy; the runtime reads the raw object
    // through waterOperator, which applies the same default.
    expect(res.success && res.data.facilities[0].operator).toBe('dsama')
  })

  it('defaults a missing operator to macao_water rather than failing', () => {
    const res = WaterFacilitiesFileSchema.safeParse(base)
    expect(res.success && res.data.facilities[0].operator).toBe('macao_water')
  })

  it('rejects an unknown operator', () => {
    const bad = { ...base, facilities: [{ ...base.facilities[0], operator: 'iam' }] }
    expect(WaterFacilitiesFileSchema.safeParse(bad).success).toBe(false)
  })

  it('accepts a well-formed network', () => {
    expect(WaterFacilitiesFileSchema.safeParse({ ...base, network: net }).success).toBe(true)
  })

  it('rejects an unknown pipe kind', () => {
    const bad = { ...net, pipes: [{ ...net.pipes[0], kind: 'sewer' }] }
    expect(WaterFacilitiesFileSchema.safeParse({ ...base, network: bad }).success).toBe(false)
  })

  it('rejects a pipe that is not a line (fewer than two points)', () => {
    const bad = { ...net, pipes: [{ ...net.pipes[0], coordinates: [[113.539, 22.216]] }] }
    expect(WaterFacilitiesFileSchema.safeParse({ ...base, network: bad }).success).toBe(false)
  })

  it('accepts a pipe with or without the optional `direct` stub flag', () => {
    const withDirect = { ...net, pipes: [{ ...net.pipes[0], direct: true }] }
    expect(WaterFacilitiesFileSchema.safeParse({ ...base, network: withDirect }).success).toBe(true)
    expect(WaterFacilitiesFileSchema.safeParse({ ...base, network: net }).success).toBe(true)
  })

  it('rejects a non-boolean `direct`', () => {
    const bad = { ...net, pipes: [{ ...net.pipes[0], direct: 'yes' }] }
    expect(WaterFacilitiesFileSchema.safeParse({ ...base, network: bad }).success).toBe(false)
  })

  it('rejects a pipe missing its fallback flag', () => {
    const { fallback: _drop, ...noFallback } = net.pipes[0]
    const bad = { ...net, pipes: [noFallback] }
    expect(WaterFacilitiesFileSchema.safeParse({ ...base, network: bad }).success).toBe(false)
  })
})
