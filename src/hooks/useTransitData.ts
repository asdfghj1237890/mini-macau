import { useState, useEffect } from 'react'
import type { TransitData, LRTLine, Station, Trip, BusRoute, BusStop, Flight, Ferry } from '../types'
import { FERRY_BERTH_COUNT } from '../engines/ferryBerths'

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  return res.json() as Promise<T>
}

interface FerryScheduleTime {
  time: string // "HH:MM"
  markers?: string
}

interface FerryScheduleDirection {
  header: string
  from: string
  to: string
  day: FerryScheduleTime[]
  night: FerryScheduleTime[]
}

interface FerryScheduleRoute {
  id: string
  nameZh: string
  nameEn: string
  journeyMinutes: number | null
  effectiveDate: string | null
  directions: FerryScheduleDirection[]
  notes?: string[]
}

interface FerryScheduleFile {
  fetchedAtUtc: string
  effectiveAs: string
  source: string
  routes: FerryScheduleRoute[]
}

function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function flattenFerrySchedules(file: FerryScheduleFile | null): Ferry[] {
  if (!file) return []
  const ferries: Ferry[] = []
  for (const route of file.routes) {
    const journey = route.journeyMinutes ?? 60
    for (const dir of route.directions) {
      const fromMacau = dir.from.includes('外港')
      const toMacau = dir.to.includes('外港')
      if (!fromMacau && !toMacau) continue
      const otherPort = fromMacau ? dir.to : dir.from
      const times = [...dir.day, ...dir.night]
      for (const t of times) {
        const depMin = hhmmToMinutes(t.time)
        if (depMin === null) continue
        // If departing Macau: ferry is at berth for this minute.
        // If arriving Macau: schedule time is HK departure → berth time = dep + journey.
        const berthMin = fromMacau ? depMin : depMin + journey
        const type: Ferry['type'] = fromMacau ? 'departure' : 'arrival'
        const id = `${route.id}:${type}:${t.time}:${otherPort}`
        ferries.push({
          id,
          routeId: route.id,
          routeNameZh: route.nameZh,
          routeNameEn: route.nameEn,
          type,
          scheduledTime: berthMin % 1440,
          otherPortZh: otherPort,
          journeyMinutes: journey,
          markers: t.markers,
          berthIndex: 0, // assigned below
        })
      }
    }
  }
  // Assign berths: greedy by sorted scheduledTime, rotating so adjacent arrivals
  // occupy different slots. (Full dwell conflicts are resolved in the engine.)
  ferries.sort((a, b) => a.scheduledTime - b.scheduledTime)
  ferries.forEach((f, i) => { f.berthIndex = i % FERRY_BERTH_COUNT })
  return ferries
}

export function useTransitData(): TransitData {
  const [data, setData] = useState<TransitData>({
    lrtLines: [],
    stations: [],
    trips: [],
    busRoutes: [],
    busStops: [],
    flights: [],
    ferries: [],
    loading: true,
  })

  useEffect(() => {
    Promise.all([
      loadJson<LRTLine[]>('/data/lrt-lines.json'),
      loadJson<Station[]>('/data/stations.json'),
      loadJson<Trip[]>('/data/trips.json'),
      loadJson<BusRoute[]>('/data/bus-routes.json').catch(() => []),
      loadJson<BusStop[]>('/data/bus-stops.json').catch(() => []),
      loadJson<Flight[]>('/data/flights.json').catch(() => []),
      loadJson<FerryScheduleFile>('/data/ferry-schedules.json').catch(() => null),
    ]).then(([lrtLines, stations, trips, busRoutes, busStops, flights, ferrySchedules]) => {
      const ferries = flattenFerrySchedules(ferrySchedules)
      setData({ lrtLines, stations, trips, busRoutes, busStops, flights, ferries, loading: false })
    }).catch(err => {
      console.error('Failed to load transit data:', err)
      setData(prev => ({ ...prev, loading: false }))
    })
  }, [])

  return data
}
