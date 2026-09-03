// Runtime contracts for the static JSON the app loads from /public/data.
//
// These mirror the interfaces in `types.ts`, but unlike compile-time types
// they catch the case the types can't: an upstream scrape or a hand-edit that
// ships JSON with the wrong shape. The Python pipeline validates the same
// invariants before committing (the hard gate); this is the client-side
// tripwire so contract drift is loud (a console error, and a thrown error in
// dev) instead of a silently broken map.
//
// Schemas are intentionally permissive about EXTRA keys (zod strips unknown
// keys but does not reject them) and only require the fields the runtime
// actually reads — the goal is to catch gross shape breakage, not to relitigate
// every optional attribute.
import { z } from 'zod'

const lngLat = z.tuple([z.number(), z.number()])

// GeoJSON LineString Feature. Coordinates are validated structurally (a
// non-empty array of [lng, lat, …] tuples) without asserting every vertex, to
// keep the one-time parse of the ~2.7 MB bus-routes file cheap.
const lineFeature = z.object({
  type: z.literal('Feature'),
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.array(z.number())).min(2),
  }),
})

export const LRTLinesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    nameCn: z.string(),
    namePt: z.string().optional(),
    color: z.string(),
    stations: z.array(z.string()),
    geometry: lineFeature,
  }),
)

export const StationsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    nameCn: z.string(),
    namePt: z.string().optional(),
    coordinates: lngLat,
    lineIds: z.array(z.string()),
  }),
)

export const TripsSchema = z.array(
  z.object({
    id: z.string(),
    lineId: z.string(),
    direction: z.enum(['forward', 'backward']),
    scheduleType: z.enum(['mon_thu', 'friday', 'sat_sun']).optional(),
    entries: z.array(
      z.object({
        stationId: z.string(),
        arrivalMinutes: z.number(),
        departureMinutes: z.number().optional(),
      }),
    ),
  }),
)

export const BusRoutesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    nameCn: z.string(),
    namePt: z.string().optional(),
    color: z.string(),
    stopsForward: z.array(z.string()),
    stopsBackward: z.array(z.string()),
    stopOffsets: z.array(z.number().int().nonnegative()),
    directionSplitIndex: z.number().int().nonnegative(),
    geometry: lineFeature,
    frequency: z.number(),
    serviceHoursStart: z.number().nullable(),
    serviceHoursEnd: z.number().nullable(),
    serviceHoursStartSat: z.number().nullable().optional(),
    serviceHoursEndSat: z.number().nullable().optional(),
    serviceHoursStartSun: z.number().nullable().optional(),
    serviceHoursEndSun: z.number().nullable().optional(),
    routeType: z.enum(['bilateral', 'circular']),
  }),
)

export const BusStopsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    nameCn: z.string(),
    namePt: z.string().optional(),
    coordinates: lngLat,
    routeIds: z.array(z.string()),
  }),
)

const airport = z.object({
  iata: z.string(),
  name: z.string(),
  nameCn: z.string().optional(),
  namePt: z.string().optional(),
  bearing: z.number(),
})

export const FlightsSchema = z.array(
  z.object({
    id: z.string(),
    flightNumber: z.string(),
    airline: z.object({ name: z.string(), iata: z.string() }),
    type: z.enum(['departure', 'arrival']),
    scheduledTime: z.number(),
    destination: airport.optional(),
    origin: airport.optional(),
    aircraftType: z.string().optional(),
    date: z.string().optional(),
  }),
)

// Raw ferry-schedules.json shape (transformed by flattenFerrySchedules at
// load). The runtime `Ferry` type is the post-transform shape, not this one.
export const FerryScheduleFileSchema = z.object({
  fetchedAtUtc: z.string(),
  effectiveAs: z.string(),
  sources: z.record(z.string(), z.string()).optional(),
  routes: z.array(
    z.object({
      id: z.string(),
      operator: z.enum(['turbojet', 'cotai']),
      terminal: z.enum(['outer_harbour', 'taipa']),
      nameZh: z.string(),
      nameEn: z.string(),
      journeyMinutes: z.number().nullable(),
      effectiveDate: z.string().nullable(),
      directions: z.array(
        z.object({
          header: z.string(),
          from: z.string(),
          to: z.string(),
          day: z.array(z.object({ time: z.string(), markers: z.string().optional() })),
          night: z.array(z.object({ time: z.string(), markers: z.string().optional() })),
        }),
      ),
      notes: z.array(z.string()).optional(),
    }),
  ),
})

// road-works.json — DSAT 工程改道 notices. Mirrors the `road-works` block in
// data/scripts/validate_output.py: the pipeline is the hard gate, this is the
// client-side tripwire. Dates are Macau-local YYYY-MM-DD (string-comparable),
// `contractor` may be empty strings, and `previousNotice` is null when the
// upstream value was "na".
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const roadWorkText = z.object({ zh: z.string(), pt: z.string() })

export const RoadWorksFileSchema = z.object({
  fetchedAtUtc: z.string(),
  exportedAt: z.string(),
  source: z.object({
    name: z.string(),
    dataset: z.string(),
    download: z.string(),
  }),
  notices: z.array(
    z.object({
      id: z.string(),
      restriction: z.enum(['closed', 'limited', 'one_way', 'no_parking', 'other']),
      restrictionText: roadWorkText,
      location: roadWorkText,
      reason: roadWorkText,
      principal: roadWorkText,
      contractor: roadWorkText,
      details: roadWorkText,
      duration: z.object({
        days: z.number().int().nonnegative(),
        hours: z.number().int().nonnegative(),
      }),
      startDate: ymd,
      endDate: ymd,
      onlineDate: ymd,
      coordinates: lngLat,
      previousNotice: z.string().nullable(),
    }),
  ),
})

// schools.json — the DSEDJ school register matched to OSM campus/building
// footprints (tertiary institutions come straight from OSM). Mirrors the
// `schools` block in data/scripts/validate_output.py. `level` is the enum the
// overlay colours by, so it is checked strictly; `system` is metadata the
// runtime never reads and stays a plain string. Building `name` is null when
// the OSM footprint is unnamed, and `buildings` may be empty for a school
// whose campus has no mapped footprint.
const schoolLevel = z.enum(['kindergarten', 'primary', 'secondary', 'university', 'all_through'])

export const SchoolsFileSchema = z.object({
  fetchedAtUtc: z.string(),
  sources: z.record(z.string(), z.string()),
  levels: z.array(schoolLevel),
  schools: z.array(
    z.object({
      id: z.string(),
      name: z.object({ zh: z.string(), pt: z.string() }),
      level: schoolLevel,
      levels: z.object({
        kindergarten: z.boolean().optional(),
        primary: z.boolean().optional(),
        secondary: z.boolean().optional(),
      }),
      system: z.string(),
      coordinates: lngLat,
      osm: z.array(z.string()),
      buildings: z.array(
        z.object({
          osmId: z.string(),
          name: z.string().nullable(),
          height: z.number(),
          minHeight: z.number(),
          // GeoJSON Polygon coordinates: at least one ring of [lng, lat].
          coordinates: z.array(z.array(lngLat)).min(1),
        }),
      ),
    }),
  ),
})

// Validate `raw` against `schema`. On mismatch: throw in dev (so tests and the
// dev server surface contract drift immediately) and console.error in prod (so
// the live site logs the problem but still renders best-effort). Returns the
// original object untouched — the schema is a gate/logger, not a transformer,
// so no field is stripped or coerced.
export function parseData<T>(schema: z.ZodType, raw: unknown, label: string): T {
  const res = schema.safeParse(raw)
  if (!res.success) {
    const summary = res.error.issues
      .slice(0, 5)
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join(' | ')
    const msg = `[data] ${label} failed schema validation: ${summary}`
    if (import.meta.env.DEV) throw new Error(msg)
    console.error(msg, res.error.issues)
  }
  return raw as T
}
