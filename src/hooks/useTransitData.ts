import { useState, useEffect } from 'react'
import type { TransitData, LRTLine, Station, Trip, BusRoute, BusStop, Flight, Ferry } from '../types'
import { FERRY_BERTH_COUNT_BY_TERMINAL, type MacauFerryTerminal, type FerryOperator } from '../engines/ferryBerths'

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
  operator: FerryOperator
  terminal: MacauFerryTerminal
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
  sources?: Record<string, string>
  routes: FerryScheduleRoute[]
}

function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

// Each terminal's Macau endpoint carries a distinctive substring: 外港 for
// outer_harbour, 氹仔 for taipa. A direction involves the terminal iff one
// of its endpoints contains the marker.
const TERMINAL_MARKER: Record<MacauFerryTerminal, string> = {
  outer_harbour: '外港',
  taipa: '氹仔',
}

function flattenFerrySchedules(file: FerryScheduleFile | null): Ferry[] {
  if (!file) return []
  const ferries: Ferry[] = []
  for (const route of file.routes) {
    const journey = route.journeyMinutes ?? 60
    const marker = TERMINAL_MARKER[route.terminal]
    for (const dir of route.directions) {
      const fromMacau = dir.from.includes(marker)
      const toMacau = dir.to.includes(marker)
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
          operator: route.operator,
          terminal: route.terminal,
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
  // Assign berths within each terminal: greedy by sorted scheduledTime so
  // adjacent ferries occupy different slots. (Full dwell conflicts stay the
  // engine's problem.) Terminals have independent berth pools.
  ferries.sort((a, b) => a.scheduledTime - b.scheduledTime)
  const cursor: Record<MacauFerryTerminal, number> = { outer_harbour: 0, taipa: 0 }
  for (const f of ferries) {
    const n = FERRY_BERTH_COUNT_BY_TERMINAL[f.terminal]
    f.berthIndex = cursor[f.terminal] % n
    cursor[f.terminal]++
  }
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
    // All 7 fetches kick off in parallel to saturate the network, but each
    // commits to state *as it arrives* (instead of waiting for Promise.all).
    // This spreads the big JSON.parse cost — trips.json and bus-routes.json
    // are ~2.8 MB each — across multiple React commits so the browser can
    // paint/interact between them rather than freeze on one fat setState.
    let cancelled = false

    function commit<K extends keyof TransitData>(key: K, value: TransitData[K]) {
      if (cancelled) return
      setData(prev => ({ ...prev, [key]: value }))
    }

    // Core data gates the `loading` flag — MapView's sim loop waits on it.
    // Flights + ferries are non-critical overlays, so they load independently
    // and do not block the first render of vehicles on the map.
    Promise.all([
      loadJson<LRTLine[]>('/data/lrt-lines.json').then(v => commit('lrtLines', v)),
      loadJson<Station[]>('/data/stations.json').then(v => commit('stations', v)),
      loadJson<Trip[]>('/data/trips.json').then(v => commit('trips', v)),
      loadJson<BusRoute[]>('/data/bus-routes.json').then(v => commit('busRoutes', v)).catch(() => commit('busRoutes', [])),
      loadJson<BusStop[]>('/data/bus-stops.json').then(v => commit('busStops', v)).catch(() => commit('busStops', [])),
    ]).then(() => {
      if (cancelled) return
      setData(prev => (prev.loading ? { ...prev, loading: false } : prev))
    }).catch(err => {
      console.error('Failed to load core transit data:', err)
      if (!cancelled) setData(prev => ({ ...prev, loading: false }))
    })

    loadJson<Flight[]>('/data/flights.json')
      .then(v => commit('flights', v))
      .catch(() => {})

    loadJson<FerryScheduleFile>('/data/ferry-schedules.json')
      .then(file => commit('ferries', flattenFerrySchedules(file)))
      .catch(() => {})

    return () => { cancelled = true }
  }, [])

  return data
}
