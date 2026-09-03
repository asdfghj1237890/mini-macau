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
})
