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
  geometry: Feature<LineString>
  frequency: number // minutes between departures
  // Fractional hour (5.75 = 05:45). End may exceed 24 when service crosses
  // midnight — simulation & service checks treat end<=start as +1440min.
  serviceHoursStart: number      // Mon-Sat (weekday)
  serviceHoursEnd: number        // Mon-Sat (weekday)
  serviceHoursStartSun?: number  // Sun + public holidays; falls back to weekday
  serviceHoursEndSun?: number
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

export interface TransitData {
  lrtLines: LRTLine[]
  stations: Station[]
  trips: Trip[]
  busRoutes: BusRoute[]
  busStops: BusStop[]
  flights: Flight[]
  ferries: Ferry[]
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
