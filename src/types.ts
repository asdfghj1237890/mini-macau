import type { Feature, LineString } from 'geojson'
import type React from 'react'

export interface Station {
  id: string
  name: string
  nameCn: string
  namePt: string
  coordinates: [number, number]
  lineIds: string[]
}

export interface LRTLine {
  id: string
  name: string
  nameCn: string
  // Portuguese name (optional — upstream DSAT/MLM data isn't always trilingual
  // for every line; falls back to `name` via localName()).
  namePt?: string
  color: string
  // Station ids in track order, running in the direction of the line's
  // *forward* trips. validate_output.py cross-checks this against the trips;
  // downstream readers label direction 0 as stations[0] → stations[-1].
  stations: string[]
  geometry: Feature<LineString>
}

export interface BusRoute {
  id: string
  name: string
  nameCn: string
  namePt?: string
  color: string
  stopsForward: string[]
  stopsBackward: string[]
  // Vertex index in `geometry` for each `stopsForward` entry. Values are
  // strictly increasing, so repeated roads/stops still map to the correct
  // pass through a self-crossing loop.
  stopOffsets: number[]
  // Index in stopsForward/stopOffsets where DSAT direction 1 begins.
  // Equals stopsForward.length when DSAT publishes only one direction.
  directionSplitIndex: number
  geometry: Feature<LineString>
  frequency: number // minutes between departures
  // Fractional hour (5.75 = 05:45). End may exceed 24 when service crosses
  // midnight — simulation & service checks treat end<=start as +1440min.
  serviceHoursStart: number | null      // Weekday/default window
  serviceHoursEnd: number | null        // Weekday/default window
  // Saturday override; falls back to weekday when absent. Explicit null means
  // this bucket exists but has no service.
  serviceHoursStartSat?: number | null
  serviceHoursEndSat?: number | null
  // Sunday override; falls back to weekday when absent. Explicit null means
  // this bucket exists but has no service.
  serviceHoursStartSun?: number | null
  serviceHoursEndSun?: number | null
  routeType: 'bilateral' | 'circular'
}

export interface BusStop {
  id: string
  name: string
  nameCn: string
  namePt?: string
  coordinates: [number, number]
  routeIds: string[]
}

export interface TimetableEntry {
  stationId: string
  arrivalMinutes: number
  departureMinutes?: number
}

export type ScheduleType = 'mon_thu' | 'friday' | 'sat_sun'

export interface Trip {
  id: string
  lineId: string
  direction: 'forward' | 'backward'
  scheduleType?: ScheduleType
  entries: TimetableEntry[]
}

export interface FlightAirport {
  iata: string
  name: string
  nameCn?: string
  namePt?: string
  bearing: number
}

export interface Flight {
  id: string
  flightNumber: string
  airline: { name: string; iata: string }
  type: 'departure' | 'arrival'
  scheduledTime: number // minutes since midnight
  destination?: FlightAirport
  origin?: FlightAirport
  aircraftType?: string
  // Present only on records produced by the multi-day timetable workflow
  // (`fetch_flights.py --days N>1`). Format: YYYY-MM-DD in Macau-local
  // time. Absent on the per-day realtime file. Used by the `useTransitData`
  // hook to bucket records into a `byDate` lookup.
  date?: string
}

export interface Ferry {
  id: string
  routeId: string // e.g. "hkgmacroute"
  // Route display names. `routeName` = English (from upstream `nameEn`),
  // `routeNameCn` = 繁中 (from upstream `nameZh`). Portuguese is optional
  // — upstream TurboJET / Cotai schedules don't publish pt names today, so
  // we fall back to English via localName() when pt is undefined.
  routeName: string
  routeNameCn: string
  routeNamePt?: string
  operator: 'turbojet' | 'cotai'
  terminal: 'outer_harbour' | 'taipa'
  type: 'departure' | 'arrival' // relative to the Macau terminal
  scheduledTime: number // minutes since midnight; berth time at Macau
  // The non-Macau endpoint of this leg. Only the Chinese form is reliably
  // in the source JSON (direction.from/to are Chinese); English/Portuguese
  // are optional and fall back via localName().
  otherPortCn: string // e.g. "香港(上環)"
  otherPort?: string
  otherPortPt?: string
  journeyMinutes: number
  markers?: string // e.g. "*", "#", "@"
  berthIndex: number // index within FERRY_BERTHS_BY_TERMINAL[terminal]
}

// Bilingual free text as published by DSAT. The upstream feed is zh/pt only —
// there is no English form, so `pickText` in roadWorks.ts maps en → pt (Macau
// street names are officially Portuguese).
export interface RoadWorkText {
  zh: string
  pt: string
}

export type RoadWorkRestriction = 'closed' | 'limited' | 'one_way' | 'no_parking' | 'other'

// One DSAT 工程改道 (traffic-diversion) notice, from
// public/data/road-works.json. Dates are Macau-local YYYY-MM-DD calendar
// days, so they compare correctly as plain strings.
export interface RoadWorkNotice {
  id: string // aviso_no, e.g. "2509/2026"
  restriction: RoadWorkRestriction
  restrictionText: RoadWorkText
  location: RoadWorkText
  reason: RoadWorkText
  principal: RoadWorkText
  contractor: RoadWorkText // "" when the notice has no contractor
  details: RoadWorkText // plain text; paragraphs separated by \n
  duration: { days: number; hours: number }
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  onlineDate: string // YYYY-MM-DD
  coordinates: [number, number] // [lng, lat]
  previousNotice: string | null
}

// Teaching level a school is coloured by. `all_through` is a school that runs
// kindergarten + primary + secondary under one roof (一條龍); the other four
// are the highest stage the school is approved for. The pipeline decides this
// from the DSEDJ stage flags, so the runtime never re-derives it.
export type SchoolLevel = 'kindergarten' | 'primary' | 'secondary' | 'university' | 'all_through'

// One building footprint of a school campus, from public/data/schools.json.
// `coordinates` is a GeoJSON Polygon coordinate array (outer ring only),
// already buffered ~0.5 m outwards by the pipeline, and `height` is the
// basemap building's height + 0.5 m — together they make our coloured block
// sit proud of the OpenFreeMap extrusion underneath instead of z-fighting it.
export interface SchoolBuilding {
  osmId: string // e.g. "w411047590"
  name: string | null // OSM building name, null when the footprint is unnamed
  height: number // metres
  minHeight: number // metres; 0 for a ground-level building
  coordinates: [number, number][][]
}

// One school from public/data/schools.json: the DSEDJ register (id
// "dsedj:[002]") matched to OSM campus features, plus tertiary institutions
// taken straight from OSM (id "osm:w123" / "osm:n456").
export interface School {
  id: string
  name: { zh: string; pt: string } // no English form upstream; pt may be ""
  level: SchoolLevel
  levels: { kindergarten?: boolean; primary?: boolean; secondary?: boolean }
  system: string // 'private' | 'public' | 'tertiary' — not read by the runtime
  coordinates: [number, number] // representative point [lng, lat]
  osm: string[] // the OSM campus features this school was matched to
  buildings: SchoolBuilding[] // may be empty when no footprint was matched
}

// Trilingual free text as published by IAM. Unlike the DSAT road-works feed
// (zh/pt only) this dataset carries a real English form for every field, so
// `pickToiletText` in toilets.ts hands `en` the English string instead of
// falling back to Portuguese.
export interface ToiletText {
  zh: string
  pt: string
  en: string
}

// One IAM public toilet, from public/data/toilets.json. `coordinates` is
// [lng, lat]; 33 toilets share a point with another (several cubicles at one
// address), which the marker layer does not try to separate.
export interface Toilet {
  id: string // IAM code, "-2"-suffixed on collisions, or a name slug
  code: string | null // the published 編號; null when the source has none
  name: ToiletText // number prefix already stripped by the pipeline
  address: ToiletText
  phone: ToiletText // may be empty strings
  openHours: ToiletText
  accessible: boolean // has a barrier-free cubicle (hasDwc / 無障礙 dataset)
  family: boolean // has a family cubicle (hasFwc)
  closed: boolean // temporarily out of service (tempClose)
  photo: string | null // IAM photo URL
  coordinates: [number, number] // [lng, lat]
}

export interface TransitData {
  lrtLines: LRTLine[]
  stations: Station[]
  trips: Trip[]
  busRoutes: BusRoute[]
  busStops: BusStop[]
  flights: Flight[]
  ferries: Ferry[]
  roadWorks: RoadWorkNotice[]
  schools: School[]
  toilets: Toilet[]
  loading: boolean
}

export interface VehiclePosition {
  id: string
  lineId: string
  type: 'lrt' | 'bus' | 'flight' | 'ferry'
  coordinates: [number, number]
  bearing: number
  progress: number
  color: string
  altitude?: number
  scale?: number
  flightPhase?: 'apron' | 'taxi' | 'climb'
  flightData?: Flight
  ferryData?: Ferry
  rt?: {
    plate: string
    speed: number
    stopIndex: number
    dir: 0 | 1
    observedAt: number
  }
}

export interface SimulationClock {
  currentTime: Date
  timeRef: React.RefObject<Date>
  speed: number
  paused: boolean
  // True when the sim is locked to real wall time (not paused, 1× speed, and
  // within 3 s of now). Computed in the clock tick so consumers don't each
  // call Date.now() during render. Drives the "LIVE" badges.
  isLive: boolean
  setSpeed: (s: number) => void
  togglePause: () => void
  // Re-lock the sim to wall time: sim = Date.now(), speed = 1, not paused.
  // This is what "live" means — use it whenever the user asks to return to
  // the current moment, not for clearing state.
  syncToNow: () => void
  setTime: (date: Date) => void
}

export interface StationProgress {
  stationId: string
  progress: number // 0-1 along the line geometry
}
