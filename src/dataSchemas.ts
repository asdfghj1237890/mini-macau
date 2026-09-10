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
      // Founding year (校史); the same window as SCHOOL_FOUNDED_RANGE in
      // validate_output.py — Macau's oldest register entries trace to the 1800s.
      founded: z.number().int().min(1500).max(2035).nullable(),
      foundedNote: z.object({ zh: z.string(), pt: z.string(), en: z.string() }).nullable(),
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

// public-housing.json — the Housing Bureau's 社會房屋 / 經濟房屋 estates with
// their OSM footprints. `type` picks the hue and `year` (per building, else per
// estate) the shade, so both are checked strictly; the descriptive fields the
// info panel shows are typed but not constrained beyond shape. Mirrors
// data/scripts/validate_output.py's v_public_housing — change one, change the
// other.
const publicHousingType = z.enum(['social', 'economic', 'other'])
const publicHousingCategory = z.enum(['elderly', 'replacement', 'temporary', 'sandwich'])
const publicHousingDistrict = z.enum(['macau', 'taipa', 'coloane'])
const publicHousingStatus = z.enum(['occupied', 'completed', 'under_construction'])
const publicHousingYearKind = z.enum(['occupation', 'completion', 'expected'])
const publicHousingName = z.object({ zh: z.string(), pt: z.string() })
// Same window as PUBLIC_HOUSING_YEAR_RANGE in validate_output.py: IH's oldest
// listed estate was occupied in 1985, and "expected" years stay within reach.
const publicHousingYear = z.number().int().min(1950).max(2035).nullable()

export const PublicHousingFileSchema = z.object({
  fetchedAtUtc: z.string(),
  sources: z.record(z.string(), z.string()),
  types: z.array(publicHousingType),
  estates: z.array(
    z.object({
      id: z.string(),
      name: publicHousingName,
      type: publicHousingType,
      category: publicHousingCategory.nullable(),
      district: publicHousingDistrict,
      address: publicHousingName,
      year: publicHousingYear,
      yearKind: publicHousingYearKind.nullable(),
      status: publicHousingStatus,
      partial: z.boolean(),
      units: z.number().int().positive().nullable(),
      storeys: z.number().int().positive().nullable(),
      blocks: z.array(
        z.object({
          name: publicHousingName,
          year: publicHousingYear,
          date: z.string().nullable(),
        }),
      ),
      coordinates: lngLat,
      approximate: z.boolean(),
      osm: z.array(z.string()),
      buildings: z.array(
        z.object({
          osmId: z.string(),
          name: z.string().nullable(),
          block: z.string().nullable(),
          year: publicHousingYear,
          height: z.number(),
          minHeight: z.number(),
          // GeoJSON Polygon coordinates: at least one ring of [lng, lat].
          coordinates: z.array(z.array(lngLat)).min(1),
        }),
      ),
      sources: z.array(z.string()),
    }),
  ),
})

// parishes.json — the seven parishes plus Cotai as MultiPolygons with their
// census figures. Mirrors validate_output.py's v_parishes — change one, change
// the other. The slug is what the colour table is keyed by, so it is an enum.
const parishSlug = z.enum([
  'fatima', 'santo-antonio', 'sao-lazaro', 'se', 'sao-lourenco', 'carmo', 'sao-francisco', 'cotai',
])
const parishRing = z.array(lngLat).min(4)

export const ParishesFileSchema = z.object({
  fetchedAtUtc: z.string(),
  sources: z.record(z.string(), z.string()),
  parishes: z.array(
    z.object({
      id: z.string(),
      slug: parishSlug,
      name: z.object({ zh: z.string(), pt: z.string(), en: z.string() }),
      kind: z.enum(['parish', 'reclamation']),
      island: z.enum(['macau', 'taipa', 'coloane', 'cotai']),
      areaKm2: z.number().positive().nullable(),
      population: z.number().int().nonnegative().nullable(),
      populationYear: z.number().int().min(1990).max(2035).nullable(),
      densityPerKm2: z.number().nonnegative().nullable().optional(),
      note: z.object({ zh: z.string(), pt: z.string(), en: z.string() }).nullable().optional(),
      coordinates: lngLat,
      geometry: z.array(z.array(parishRing).min(1)).min(1),
      osm: z.array(z.string()).min(1),
      sources: z.array(z.string()).min(1),
    }),
  ).min(1),
})

// toilets.json — the IAM public-toilet register (the 無障礙公廁 dataset is
// folded into the `accessible` flag by the pipeline). Mirrors the `toilets`
// block in data/scripts/validate_output.py. Unlike road works this feed is
// trilingual, so every text field carries zh/pt/en; `code` is null for the few
// entries the source publishes without a 編號, `photo` is null when there is no
// image, and `updatedAt` is null when the upstream readme has no timestamp.
const toiletText = z.object({ zh: z.string(), pt: z.string(), en: z.string() })

export const ToiletsFileSchema = z.object({
  fetchedAtUtc: z.string(),
  updatedAt: z.string().nullable(),
  sources: z.record(z.string(), z.string()),
  toilets: z.array(
    z.object({
      id: z.string(),
      code: z.string().nullable(),
      name: toiletText,
      address: toiletText,
      phone: toiletText,
      openHours: toiletText,
      accessible: z.boolean(),
      family: z.boolean(),
      closed: z.boolean(),
      photo: z.string().nullable(),
      coordinates: lngLat,
    }),
  ),
})

// car-parks.json — the DSAT public car-park register (car_park_detail). The
// live vacancy feed is NOT in this file: the browser polls it directly (see
// src/carParks.ts). Mirrors the `car-parks` block in
// data/scripts/validate_output.py. `heightLimitM` is null for the records
// whose `height` is "--"/"---", and every fee/name field is trilingual even
// when DSAT leaves the English side a copy of the Portuguese one.
const carParkText = z.object({ zh: z.string(), pt: z.string(), en: z.string() })

export const CarParksFileSchema = z.object({
  fetchedAtUtc: z.string(),
  sources: z.record(z.string(), z.string()),
  carParks: z.array(
    z.object({
      id: z.string(),
      name: carParkText,
      location: carParkText,
      entrance: carParkText,
      phone: z.string(),
      heightLimitM: z.number().nullable(),
      fees: z.object({
        light: carParkText,
        heavy: carParkText,
        moto: carParkText,
        remark: carParkText,
      }),
      zone: carParkText,
      parish: carParkText,
      coordinates: lngLat,
    }),
  ),
})

// waste.json — the six kinds of waste and recycling collection point, from two
// IAM datasets and four DSPA ones. Mirrors the `waste` block in
// data/scripts/validate_output.py. `type` is the enum the overlay colours by,
// so it is checked strictly. `en` is OPTIONAL in every text block: the DSPA
// feeds publish no English and the address block is zh/pt only, so the runtime
// falls back en → pt → zh (see `pickWasteText`) rather than requiring a field
// upstream never sends. `address` is null for the refuse rooms, `photo`/`tel`
// null wherever the source has none, and `upstreamStatus` is DSPA's raw,
// undocumented `status` — kept, never interpreted.
const wasteSiteType = z.enum([
  'refuse_room', 'compactor', 'refuse_station',
  'smart_machine', 'three_colour', 'e_waste', 'lamp_battery',
  'glass', 'clothing',
])
const wasteText = z.object({
  zh: z.string(),
  pt: z.string(),
  en: z.string().optional(),
})

// The hand-maintained blocks carry their own already-formatted attribution
// rather than pointing at a `sources` entry.
const wasteAttribution = z.object({ name: z.string(), url: z.string() })

export const WasteFileSchema = z.object({
  fetchedAtUtc: z.string(),
  sources: z.array(
    z.object({
      id: z.string(),
      type: wasteSiteType,
      datasetId: z.string(),
      name: z.object({ zh: z.string(), pt: z.string().optional(), en: z.string().optional() }),
      url: z.string(),
      upstreamUpdatedAt: z.string().nullable(),
      count: z.number(),
    }),
  ),
  // Per-type totals, kept as a plain record: the runtime recounts from `sites`
  // (that is what the legend shows), so this is provenance, not a contract.
  counts: z.record(z.string(), z.number()).optional(),
  sites: z.array(
    z.object({
      id: z.string(),
      type: wasteSiteType,
      name: wasteText,
      address: wasteText.nullable(),
      coordinates: lngLat,
      closed: z.boolean(),
      tel: z.string().nullable(),
      photo: z.string().nullable(),
      upstreamStatus: z.number().nullable(),
    }),
  ),
  // The three non-collection blocks. ALL OPTIONAL: they were added after the
  // file shipped, so a waste.json without them must still validate (the runtime
  // just draws no facilities, no eco stations and no stats) — the same rule the
  // water network's `network` block follows.
  facilities: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['hazardous', 'landfill', 'wwtp']),
      name: wasteText,
      coordinates: lngLat,
      approximate: z.boolean(),
      // A landfill's OSM outer ring; null for the station and the sewage works,
      // which are drawn as extruded buildings instead. A ring needs 4 points.
      polygon: z.array(lngLat).min(4).nullable(),
      // Extruded footprints, in the power-facility shape. Optional: only the
      // sewage works carry them today.
      buildings: z.array(
        z.object({
          osmId: z.string(),
          name: z.string().nullable(),
          height: z.number(),
          minHeight: z.number(),
          kind: z.string().optional(),
          coordinates: z.array(z.array(lngLat)).min(1),
        }),
      ).optional(),
      osm: z.array(z.string()).optional(),
      operator: z.string().optional(),
      // The dspa-stats.json series this facility's chart reads, or null when
      // DSPA publishes none for it.
      statsKey: z.string().nullable().optional(),
      note: wasteText,
      source: wasteAttribution,
    }),
  ).optional(),
  ecoStations: z.array(
    z.object({
      id: z.string(),
      name: wasteText,
      address: wasteText,
      coordinates: lngLat,
      approximate: z.boolean(),
      hours: wasteText,
      accepts: wasteText,
      since: z.number(),
      source: wasteAttribution,
    }),
  ).optional(),
})

// dspa-stats.json — DSPA's published monthly throughput for the incineration
// plant, the hazardous-waste station, the construction-waste landfill and the
// sewage works. EVERY series is nullable and optional: each endpoint is fetched
// best-effort, so a failed one leaves its key null and the panel shows no chart
// rather than the whole file failing to load.
const dspaStatsMonth = z.object({
  period: z.string(),
  receivedT: z.number().optional(),
  processedT: z.number().optional(),
  electricityMwh: z.number().optional(),
  metalRecycledT: z.number().optional(),
  volumeM3: z.number().optional(),
  basicM3: z.number().optional(),
  biologicalM3: z.number().optional(),
  totalM3: z.number().optional(),
})

const dspaSeries = z.object({
  // Null for the two series DSPA publishes only on its GIS pages (the hazardous
  // station and the construction-waste landfill), which have no data.gov.mo id.
  datasetId: z.string().nullable(),
  url: z.string(),
  unit: z.enum(['t', 'm3']),
  latest: dspaStatsMonth.nullable(),
  months: z.array(dspaStatsMonth),
  // Only the incinerator series carries this.
  facts: z.object({
    phases: z.array(z.number()),
    lines: z.number(),
    capacityTPerDay: z.number(),
    generationMw: z.number(),
    areaM2: z.number(),
  }).nullable().optional(),
}).nullable()

export const DspaStatsFileSchema = z.object({
  fetchedAtUtc: z.string().optional(),
  incinerator: dspaSeries.optional(),
  hazardous: dspaSeries.optional(),
  landfill: dspaSeries.optional(),
  wwtp: z.object({
    macau: dspaSeries.optional(),
    taipa: dspaSeries.optional(),
    coloane: dspaSeries.optional(),
    crossborder: dspaSeries.optional(),
    mia: dspaSeries.optional(),
  }).nullable().optional(),
})

// water-facilities.json — Macao Water's 22 supply facilities, geometry taken
// from OSM. Mirrors the `water-facilities` block in
// data/scripts/validate_output.py. `type` is the enum the overlay colours by,
// so it is checked strictly; `buildings` reuses the schools contract (the
// runtime shares the +2 m margin and the height ramp), `water` carries the
// reservoir surfaces, and `anchor` is null for an exact facility, a facility id
// or a "district:<slug>" point for an approximate one.
const waterFacilityType = z.enum(['plant', 'reservoir', 'tank', 'raw_pumping', 'pumping'])
const waterText = z.object({ zh: z.string(), pt: z.string(), en: z.string() })

// The schematic pipe network. OPTIONAL on purpose: it was added after the
// facility list shipped, so a file without it must still validate (and the
// runtime just draws no pipes). Facilities are implicit nodes — `from`/`to`
// name a facility id or one of the extra `nodes` (the raw-water inlets) — and
// a pipe needs at least two points to be a line at all.
const waterNetwork = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      name: waterText,
      coordinates: lngLat,
      // Optional, like the power inlets: a schematic position the panel must
      // flag, and the pipeline's own note on it.
      approximate: z.boolean().optional(),
      note: waterText.optional(),
    }),
  ),
  pipes: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      kind: z.enum(['raw', 'treated']),
      lengthM: z.number(),
      fallback: z.boolean(),
      // Optional: a deliberate straight stub between co-located facilities.
      // Absent means false, and it changes no paint — only `fallback` does.
      direct: z.boolean().optional(),
      coordinates: z.array(lngLat).min(2),
    }),
  ),
})

// Macao Water's published supply statistics and raw-water sourcing, refreshed
// roughly twice a year — the info panel reads these instead of a hard-coded
// percentage/year. Mirrors the `facts` block in `v_water_facilities` in
// data/scripts/validate_output.py: five keys are required, the rest are
// optional extra detail. `facts` itself is REQUIRED on the file, same as the
// power file's.
const waterFacts = z.object({
  statistics: z.object({
    year: z.number().int().positive(),
    designCapacityM3PerDay: z.number().positive(),
    annualSupplyM3: z.number().positive(),
    rawWaterImportedM3: z.number().positive(),
    plants: z.number().int().positive(),
    previousYear: z.number().optional(),
    peakDailySupplyM3: z.number().optional(),
    annualConsumptionM3: z.number().optional(),
    mainsKm: z.number().optional(),
    reservoirs: z.number().optional(),
    tanks: z.number().optional(),
    rawWaterPumpingStations: z.number().optional(),
    treatedWaterPumpingStations: z.number().optional(),
    perCapitaLitresPerDay: z.number().optional(),
    householdPerCapitaLitresPerDay: z.number().optional(),
    leakagePct: z.number().optional(),
  }),
  rawWater: z.object({
    xijiangShareMinPct: z.number().int().min(0).max(100),
    zhuhaiPipelines: z.array(
      z.object({
        diameterM: z.number(),
        count: z.number(),
        capacityM3PerDay: z.number(),
      }),
    ).optional(),
    lapaReservoirM3: z.number().optional(),
    lapaReservoirYear: z.number().optional(),
    zhuyinReservoirM3: z.number().optional(),
    zhuyinRegulatingM3: z.number().optional(),
    zhuyinMacauShareM3: z.number().optional(),
    zhuyinReservoirYear: z.number().optional(),
  }),
})

export const WaterFacilitiesFileSchema = z.object({
  fetchedAtUtc: z.string(),
  sources: z.record(z.string(), z.string()),
  facts: waterFacts,
  facilities: z.array(
    z.object({
      id: z.string(),
      // Null for a facility Macao Water does not list (a government reservoir).
      no: z.number().int().nullable(),
      type: waterFacilityType,
      // Defaulted rather than required, so a file written before ownership was
      // recorded still validates. `parseData` returns the RAW object, so the
      // runtime reads this through `waterOperator`, which applies the same
      // default — see src/water.ts.
      operator: z.enum(['macao_water', 'dsama']).default('macao_water'),
      name: waterText,
      coordinates: lngLat,
      approximate: z.boolean(),
      anchor: z.string().nullable(),
      osm: z.array(z.string()),
      buildings: z.array(
        z.object({
          osmId: z.string(),
          name: z.string().nullable(),
          height: z.number(),
          minHeight: z.number(),
          kind: z.string().optional(),
          // GeoJSON Polygon coordinates: at least one ring of [lng, lat].
          coordinates: z.array(z.array(lngLat)).min(1),
        }),
      ),
      water: z.array(
        z.object({
          osmId: z.string(),
          coordinates: z.array(z.array(lngLat)).min(1),
        }),
      ),
    }),
  ),
  network: waterNetwork.optional(),
})

// water-distribution.json — Macau's own streets, drawn as the thin distribution
// pipes under the trunk mains. Deliberately LENIENT: everything but `roads` is
// provenance the runtime never reads, and this file is loaded lazily and
// best-effort (a failure just leaves the thin pipes out), so a envelope tweak
// upstream must not throw in dev. `class` is a free string, not an enum — the
// pipeline decides which OSM classes to ship and the width expression falls
// back to the thin branch for anything it does not recognise.
export const WaterDistributionFileSchema = z.object({
  fetchedAtUtc: z.string().optional(),
  // The provenance map every dataset carries. Kept as a union because this
  // file's envelope has already changed twice and the runtime reads none of
  // it — a shape we do not depend on should not be a shape we can break on.
  sources: z.union([
    z.record(z.string(), z.string()),
    z.array(z.unknown()),
  ]).optional(),
  classes: z.array(z.string()).optional(),
  // Bookkeeping from the outward orientation pass: which facilities the walk
  // started from, how many roads it never reached, and how many were split at
  // a junction. Provenance only — nothing here reaches the map.
  flowSources: z.array(z.string()).optional(),
  unreached: z.number().int().optional(),
  splits: z.number().int().optional(),
  roads: z.array(
    z.object({
      class: z.string(),
      // Metres along the network from the nearest treated-water source, at the
      // road's first and last vertex. Null where the walk never reached it.
      // Carried for provenance and possible future styling; the layer does not
      // read them today, so they stay out of the GeoJSON features.
      dist: z.number().nullable().optional(),
      distEnd: z.number().nullable().optional(),
      coordinates: z.array(lngLat).min(2),
    }),
  ),
})

// power-facilities.json — CEM's generation and HV substations, geometry taken
// from OSM. Mirrors the `power-facilities` block in
// data/scripts/validate_output.py. Same shape as the water file one section up,
// with `voltageKv` in place of the facility number and a `details` block that
// only the Coloane plant carries.
const powerFacilityType = z.enum(['plant', 'incinerator', 'sub220', 'sub110', 'sub66'])
const powerText = z.object({ zh: z.string(), pt: z.string(), en: z.string() })

// The schematic HV network. OPTIONAL for the same reason the water one is: a
// file that ships only the facility list must still validate (and the runtime
// just draws no lines). Facilities are implicit nodes — `from`/`to` name a
// facility id or one of the extra `nodes` (the Guangdong inlets) — and a line
// needs at least two points to be a line at all.
const powerNetwork = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      name: powerText,
      coordinates: lngLat,
      approximate: z.boolean().optional(),
    }),
  ),
  lines: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      // A plain positive number, not the 220/110/66 enum: the runtime's colour
      // and width tables fall back to the lowest tier for anything else, so a
      // voltage the pipeline adds later must not fail validation.
      voltageKv: z.number().positive(),
      lengthM: z.number(),
      fallback: z.boolean(),
      // Optional: a deliberate straight stub between co-located stations.
      // Absent means false, and it changes no paint — only `fallback` does.
      direct: z.boolean().optional(),
      coordinates: z.array(lngLat).min(2),
    }),
  ),
})

// The published facts CEM reports roughly twice a year — the info panel reads
// these instead of a hard-coded percentage/year. Mirrors the `facts` block in
// `v_power_facilities` in data/scripts/validate_output.py: six keys are
// required, the rest are optional extra detail. `facts` itself is REQUIRED on
// the file, same as the Python validator.
const powerFacts = z.object({
  year: z.number().int().positive(),
  consumptionGwh: z.number().positive(),
  localGenerationGwh: z.number().optional(),
  importedGwh: z.number().optional(),
  localSharePct: z.number().int().min(0).max(100),
  importedSharePct: z.number().int().min(0).max(100),
  cemHvSubstations: z.number().int().positive(),
  cemHvSwitchingStations: z.number().optional(),
  hvCableKm: z.number().int().positive(),
  interconnectionCorridors: z.number().optional(),
  interconnectionCapacityMw: z.number().optional(),
  interconnection220kvCircuits: z.number().optional(),
  interconnection110kvBackupCircuits: z.number().optional(),
}).refine(f => f.localSharePct + f.importedSharePct === 100, {
  message: 'power-facilities.facts: localSharePct and importedSharePct must sum to 100',
})

export const PowerFacilitiesFileSchema = z.object({
  fetchedAtUtc: z.string(),
  sources: z.record(z.string(), z.string()),
  facts: powerFacts,
  facilities: z.array(
    z.object({
      id: z.string(),
      type: powerFacilityType,
      // Defaulted rather than required, exactly like the water file's, so a
      // file written before ownership was recorded still validates. `parseData`
      // returns the RAW object, so the runtime reads this through
      // `powerOperator`, which applies the same default — see src/power.ts.
      operator: z.enum(['cem', 'dspa']).default('cem'),
      name: powerText,
      // Null for generation (the plant and the incinerator), which carry no
      // transmission voltage of their own.
      voltageKv: z.number().positive().nullable(),
      coordinates: lngLat,
      approximate: z.boolean(),
      anchor: z.string().nullable(),
      osm: z.array(z.string()),
      buildings: z.array(
        z.object({
          osmId: z.string(),
          name: z.string().nullable(),
          height: z.number(),
          minHeight: z.number(),
          kind: z.string().optional(),
          // GeoJSON Polygon coordinates: at least one ring of [lng, lat].
          coordinates: z.array(z.array(lngLat)).min(1),
        }),
      ),
      // Extra facts the panel shows where the pipeline has them. The Coloane
      // plant carries the full trilingual unit prose plus its capacity; a
      // 220 kV station carries only the year it was commissioned. Every field
      // is therefore OPTIONAL — the block says "here is what is known", not
      // "here is a fixed record" — and the panel renders each row only when
      // its field is present.
      details: z.object({
        unitsZh: z.string().optional(),
        unitsEn: z.string().optional(),
        unitsPt: z.string().optional(),
        // A language-neutral unit string (澳北's "A + B"), used when the
        // trilingual prose above is absent.
        units: z.string().optional(),
        capacityMw: z.number().optional(),
        commissioned: z.number().int().optional(),
      }).nullable().optional(),
      // Free-text provenance for a station OSM has but CEM's list does not.
      note: z.string().nullable().optional(),
    }),
  ),
  network: powerNetwork.optional(),
})

// power-distribution.json — the same street extract as the water file, oriented
// outward from the substations instead. Deliberately LENIENT for the same
// reason: everything but `roads` is provenance the runtime never reads, and the
// file is loaded lazily and best-effort (a failure just leaves the thin feeders
// out), so an envelope tweak upstream must not throw in dev.
export const PowerDistributionFileSchema = z.object({
  fetchedAtUtc: z.string().optional(),
  sources: z.union([
    z.record(z.string(), z.string()),
    z.array(z.unknown()),
  ]).optional(),
  classes: z.array(z.string()).optional(),
  flowSources: z.array(z.string()).optional(),
  unreached: z.number().int().optional(),
  splits: z.number().int().optional(),
  roads: z.array(
    z.object({
      class: z.string(),
      // Metres along the network from the nearest substation, at the road's
      // first and last vertex. Null where the walk never reached it. Carried
      // for provenance and possible future styling; the layer does not read
      // them today, so they stay out of the GeoJSON features.
      dist: z.number().nullable().optional(),
      distEnd: z.number().nullable().optional(),
      coordinates: z.array(lngLat).min(2),
    }),
  ),
})

// grand-prix.json — the Guia Circuit. Strict where the map reads (a CLOSED
// track in race order, the corners in order with every language named),
// lenient on the provenance block. Mirrors `v_grand_prix` in
// data/scripts/validate_output.py.
const grandPrixText = z.object({ zh: z.string(), pt: z.string(), en: z.string() })
const grandPrixLine = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(lngLat).min(2),
})
export const GrandPrixFileSchema = z.object({
  fetchedAtUtc: z.string(),
  sources: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      role: z.string(),
      secondary: z.boolean().optional(),
      upstreamUpdatedAt: z.string().nullable().optional(),
    }),
  ),
  circuit: z.object({
    id: z.string(),
    name: grandPrixText,
    lengthKm: z.number().positive(),
    minWidthM: z.number().positive(),
    direction: z.string(),
    lapRecord: z.object({
      time: z.string(),
      seconds: z.number().positive(),
      driver: z.string(),
      year: z.number().int(),
      car: z.string().nullable(),
      source: z.string(),
    }).nullable(),
    osm: z.object({
      relationId: z.number().int(),
      mainWays: z.number().int(),
      pitLaneWays: z.number().int(),
    }),
    measuredLengthKm: z.number().positive(),
    // The car, the pulse and the arrows all walk this line from its first
    // vertex, so it has to come back to where it started.
    track: grandPrixLine.refine(
      line => {
        const c = line.coordinates
        const a = c[0]
        const b = c[c.length - 1]
        return a[0] === b[0] && a[1] === b[1]
      },
      { message: 'track must be a closed loop (first point == last point)' },
    ),
    pitLane: grandPrixLine.nullable(),
    corners: z.array(
      z.object({
        id: z.string(),
        order: z.number().int().positive(),
        kind: z.enum(['start_finish', 'bend', 'section']),
        name: grandPrixText,
        lng: z.number(),
        lat: z.number(),
        distKm: z.number().min(0),
        approximate: z.boolean(),
        rule: z.string().min(1),
        spanKm: z.tuple([z.number(), z.number()]).nullable(),
      }),
    ).min(1),
  }),
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
