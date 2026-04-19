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
  color: string
  stations: string[]
  geometry: Feature<LineString>
}

export interface BusRoute {
  id: string
  name: string
  nameCn: string
  color: string
  stopsForward: string[]
  stopsBackward: string[]
  geometry: Feature<LineString>
  frequency: number // minutes between departures
  serviceHoursStart: number // hour (0-23)
  serviceHoursEnd: number // hour (0-23)
  routeType: 'bilateral' | 'circular'
}

export interface BusStop {
  id: string
  name: string
  nameCn: string
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
  routeNameZh: string
  routeNameEn: string
  type: 'departure' | 'arrival' // relative to Macau (外港)
  scheduledTime: number // minutes since midnight; berth time at Macau
  otherPortZh: string // e.g. "香港(上環)"
  journeyMinutes: number
  markers?: string // e.g. "*", "#"
  berthIndex: number // 0..FERRY_BERTHS.length-1
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
  reset: () => void
  setTime: (date: Date) => void
}

export interface StationProgress {
  stationId: string
  progress: number // 0-1 along the line geometry
}
