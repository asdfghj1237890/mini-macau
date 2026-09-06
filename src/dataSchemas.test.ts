/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
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
  WasteFileSchema,
  DspaStatsFileSchema,
  WaterFacilitiesFileSchema,
  WaterDistributionFileSchema,
  PowerFacilitiesFileSchema,
  PowerDistributionFileSchema,
} from './dataSchemas'

// Parse the actual JSON the app ships and assert it satisfies the runtime
// contract. This guards against a scrape or hand-edit committing malformed
// data — it runs in CI alongside the unit tests, so bad data fails the build
// instead of reaching the browser.
const dataDir = resolve(__dirname, '..', 'public', 'data')
// LRT trips are NOT committed to this repo: they live in a private data repo
// and reach the app through /api/lrt (see `loadTrips` in
// hooks/useTransitData.ts). The deploy job checks that repo out and points
// LRT_TRIPS_DIR at the copy before running the tests, so the schema still
// gates every deploy; in plain CI, with no copy on disk, the three cases skip.
// A maintainer with a local git-ignored copy in src/data gets them for free.
const tripsDir = process.env.LRT_TRIPS_DIR
  ? resolve(process.env.LRT_TRIPS_DIR)
  : resolve(__dirname, 'data')
// An explicitly configured deployment input is mandatory, never a skipped test.
const skipTrips = (f: string) => !process.env.LRT_TRIPS_DIR && !existsSync(resolve(tripsDir, f))
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
  it.skipIf(skipTrips('trips-mon_thu.json'))('trips-mon_thu.json', () => expectValid(TripsSchema, 'trips-mon_thu.json', tripsDir))
  it.skipIf(skipTrips('trips-friday.json'))('trips-friday.json', () => expectValid(TripsSchema, 'trips-friday.json', tripsDir))
  it.skipIf(skipTrips('trips-sat_sun.json'))('trips-sat_sun.json', () => expectValid(TripsSchema, 'trips-sat_sun.json', tripsDir))
  it('bus-routes.json', () => expectValid(BusRoutesSchema, 'bus-routes.json'))
  it('bus-stops.json', () => expectValid(BusStopsSchema, 'bus-stops.json'))
  it('flights.json', () => expectValid(FlightsSchema, 'flights.json'))
  it('flights-timetable.json', () => expectValid(FlightsSchema, 'flights-timetable.json'))
  it('ferry-schedules.json', () => expectValid(FerryScheduleFileSchema, 'ferry-schedules.json'))
  it('road-works.json', () => expectValid(RoadWorksFileSchema, 'road-works.json'))
  it('schools.json', () => expectValid(SchoolsFileSchema, 'schools.json'))
  it('toilets.json', () => expectValid(ToiletsFileSchema, 'toilets.json'))
  it('car-parks.json', () => expectValid(CarParksFileSchema, 'car-parks.json'))
  it('waste.json', () => expectValid(WasteFileSchema, 'waste.json'))
  it('dspa-stats.json', () => expectValid(DspaStatsFileSchema, 'dspa-stats.json'))
  it('water-facilities.json', () => expectValid(WaterFacilitiesFileSchema, 'water-facilities.json'))
  it('water-distribution.json', () => expectValid(WaterDistributionFileSchema, 'water-distribution.json'))
  it('power-facilities.json', () => expectValid(PowerFacilitiesFileSchema, 'power-facilities.json'))
  it('power-distribution.json', () => expectValid(PowerDistributionFileSchema, 'power-distribution.json'))
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

// power-facilities.json mirrors the water file above: the facility list is
// strict (the `type` enum is what the overlay colours by), the HV `network` is
// optional, and `details` exists only for the one generating plant.
describe('PowerFacilitiesFileSchema', () => {
  const base = {
    fetchedAtUtc: '2026-09-04T00:00:00Z',
    sources: { name: '澳電 (CEM)' },
    facilities: [{
      id: 'sub-lotus',
      type: 'sub220',
      name: { zh: '蓮花變電站', pt: '', en: 'Lotus Substation' },
      voltageKv: 220,
      coordinates: [113.5652, 22.1421],
      approximate: false,
      anchor: null,
      osm: ['w692620497'],
      buildings: [],
    }],
  }
  const net = {
    nodes: [{
      id: 'inlet-lotus',
      kind: 'inlet',
      name: { zh: '廣東電網輸入（蓮花）', pt: '', en: 'Guangdong grid import (Lotus)' },
      coordinates: [113.564, 22.145],
    }],
    lines: [{
      id: 'hv-inlet-lotus',
      from: 'inlet-lotus',
      to: 'sub-lotus',
      voltageKv: 220,
      lengthM: 820,
      fallback: false,
      coordinates: [[113.564, 22.145], [113.5652, 22.1421]],
    }],
  }

  it('accepts a file with no network at all', () => {
    expect(PowerFacilitiesFileSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a well-formed network', () => {
    expect(PowerFacilitiesFileSchema.safeParse({ ...base, network: net }).success).toBe(true)
  })

  it('defaults a missing operator to cem, and accepts the incinerator’s dspa', () => {
    expect(PowerFacilitiesFileSchema.safeParse(base).success).toBe(true)
    const parsed = PowerFacilitiesFileSchema.safeParse(base)
    expect(parsed.success && parsed.data.facilities[0].operator).toBe('cem')
    const inc = {
      ...base.facilities[0],
      id: 'incinerator', type: 'incinerator', operator: 'dspa', voltageKv: null,
    }
    const res = PowerFacilitiesFileSchema.safeParse({ ...base, facilities: [inc] })
    expect(res.success && res.data.facilities[0].operator).toBe('dspa')
  })

  it('rejects an unknown operator or an unknown facility type', () => {
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, facilities: [{ ...base.facilities[0], operator: 'iam' }],
    }).success).toBe(false)
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, facilities: [{ ...base.facilities[0], type: 'sub11' }],
    }).success).toBe(false)
  })

  it('allows a null voltage for generation but rejects a non-positive one', () => {
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base,
      facilities: [{ ...base.facilities[0], type: 'plant', voltageKv: null }],
    }).success).toBe(true)
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, facilities: [{ ...base.facilities[0], voltageKv: 0 }],
    }).success).toBe(false)
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, facilities: [{ ...base.facilities[0], voltageKv: '220' }],
    }).success).toBe(false)
  })

  it('accepts every shape the details block comes in, and its absence', () => {
    const plant = {
      ...base.facilities[0],
      id: 'plant-coloane', type: 'plant', voltageKv: null,
      details: { unitsZh: 'A 廠', unitsEn: 'Plant A', unitsPt: '', capacityMw: 407.8 },
    }
    expect(PowerFacilitiesFileSchema.safeParse({ ...base, facilities: [plant] }).success).toBe(true)
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, facilities: [{ ...plant, details: null }],
    }).success).toBe(true)
    // The block says "here is what is known", so a station carrying only its
    // commissioning year — or only a language-neutral unit string — is valid.
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, facilities: [{ ...base.facilities[0], details: { commissioned: 2012 } }],
    }).success).toBe(true)
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, facilities: [{ ...base.facilities[0], details: { units: 'A + B' } }],
    }).success).toBe(true)
    // But a field of the wrong type is still malformed.
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, facilities: [{ ...plant, details: { capacityMw: '407.8' } }],
    }).success).toBe(false)
  })

  it('accepts a station OSM has but CEM’s list does not, via `note`', () => {
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base,
      facilities: [{ ...base.facilities[0], id: 'sub-um', type: 'sub110', voltageKv: 110, note: 'OSM' }],
    }).success).toBe(true)
  })

  it('takes any positive line voltage, so a tier added later still validates', () => {
    const other = { ...net, lines: [{ ...net.lines[0], voltageKv: 11 }] }
    expect(PowerFacilitiesFileSchema.safeParse({ ...base, network: other }).success).toBe(true)
    const bad = { ...net, lines: [{ ...net.lines[0], voltageKv: 0 }] }
    expect(PowerFacilitiesFileSchema.safeParse({ ...base, network: bad }).success).toBe(false)
  })

  it('rejects a line that is not a line (fewer than two points)', () => {
    const bad = { ...net, lines: [{ ...net.lines[0], coordinates: [[113.564, 22.145]] }] }
    expect(PowerFacilitiesFileSchema.safeParse({ ...base, network: bad }).success).toBe(false)
  })

  it('rejects a line missing its fallback flag, and a non-boolean `direct`', () => {
    const { fallback: _drop, ...noFallback } = net.lines[0]
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, network: { ...net, lines: [noFallback] },
    }).success).toBe(false)
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, network: { ...net, lines: [{ ...net.lines[0], direct: 'yes' }] },
    }).success).toBe(false)
    expect(PowerFacilitiesFileSchema.safeParse({
      ...base, network: { ...net, lines: [{ ...net.lines[0], direct: true }] },
    }).success).toBe(true)
  })
})

// power-distribution.json is loaded lazily and best-effort, so — exactly like
// its water twin — its schema is deliberately loose everywhere except `roads`.
describe('PowerDistributionFileSchema', () => {
  const road = { class: 'primary', coordinates: [[113.54, 22.19], [113.545, 22.192]] }

  it('accepts the full envelope and a bare roads list alike', () => {
    expect(PowerDistributionFileSchema.safeParse({
      fetchedAtUtc: '2026-09-04T00:00:00Z',
      sources: { osm: 'Overpass' },
      classes: ['primary'],
      flowSources: ['sub-lotus'],
      unreached: 3,
      splits: 12,
      roads: [road],
    }).success).toBe(true)
    expect(PowerDistributionFileSchema.safeParse({ roads: [road] }).success).toBe(true)
    expect(PowerDistributionFileSchema.safeParse({ roads: [] }).success).toBe(true)
  })

  it('takes the per-end distances as numbers, nulls, or not at all', () => {
    expect(PowerDistributionFileSchema.safeParse({
      roads: [{ ...road, dist: 0, distEnd: 812.5 }],
    }).success).toBe(true)
    expect(PowerDistributionFileSchema.safeParse({
      roads: [{ ...road, dist: null, distEnd: null }],
    }).success).toBe(true)
    expect(PowerDistributionFileSchema.safeParse({ roads: [road] }).success).toBe(true)
  })

  it('rejects a road that is not a line, and a file with no roads key', () => {
    expect(PowerDistributionFileSchema.safeParse({
      roads: [{ class: 'service', coordinates: [[113.54, 22.19]] }],
    }).success).toBe(false)
    expect(PowerDistributionFileSchema.safeParse({ classes: [] }).success).toBe(false)
  })
})
