import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TransitData, LRTLine, Station, Trip, BusRoute, BusStop, Flight, Ferry, ScheduleType } from '../types'
import { getScheduleType } from '../engines/simulationEngine'
import { FERRY_BERTH_COUNT_BY_TERMINAL, type MacauFerryTerminal, type FerryOperator } from '../engines/ferryBerths'

const SCHEDULE_TYPES: readonly ScheduleType[] = ['mon_thu', 'friday', 'sat_sun'] as const

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
          routeName: route.nameEn,
          routeNameCn: route.nameZh,
          // routeNamePt left undefined — upstream JSON has no pt field yet.
          operator: route.operator,
          terminal: route.terminal,
          type,
          scheduledTime: berthMin % 1440,
          otherPortCn: otherPort,
          // otherPort / otherPortPt left undefined; direction.from/to is 繁中
          // only. FerryInfoPanel falls back to the Chinese string.
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

export interface UseTransitDataResult extends TransitData {
  // Ensures the given schedule type's trips are loaded. Idempotent:
  // re-calls for an already-loaded or in-flight type are no-ops. Used by
  // App to react to DateTimePicker jumps that cross a schedule-type
  // boundary — if the user lands on Friday and friday-trips hasn't
  // finished prefetching yet, this triggers a fetch on demand.
  ensureScheduleTypeLoaded: (stype: ScheduleType) => void
}

export function useTransitData(): UseTransitDataResult {
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

  // Track scheduleTypes we've started loading so repeated triggers don't
  // kick off duplicate fetches. Refs (not state) because we only need
  // identity semantics — no re-render on change.
  const loadedRef = useRef<Set<ScheduleType>>(new Set())
  const inFlightRef = useRef<Set<ScheduleType>>(new Set())
  const cancelledRef = useRef(false)

  const ensureScheduleTypeLoaded = useCallback((stype: ScheduleType) => {
    if (loadedRef.current.has(stype) || inFlightRef.current.has(stype)) return
    inFlightRef.current.add(stype)
    loadJson<Trip[]>(`/data/trips-${stype}.json`)
      .then(newTrips => {
        if (cancelledRef.current) return
        loadedRef.current.add(stype)
        // Append instead of replace — other scheduleTypes may already be
        // present in state; simulationEngine.getFilteredTrips picks the
        // right subset per tick.
        setData(prev => ({ ...prev, trips: [...prev.trips, ...newTrips] }))
      })
      .catch(err => console.error(`Failed to load trips-${stype}.json:`, err))
      .finally(() => {
        inFlightRef.current.delete(stype)
      })
  }, [])

  useEffect(() => {
    // All 6 core fetches kick off in parallel to saturate the network, but
    // each commits to state *as it arrives* (instead of waiting for
    // Promise.all). This spreads the big JSON.parse cost — bus-routes.json
    // alone is ~2.7 MB, and the day's trips file is ~900 KB — across
    // multiple React commits so the browser can paint/interact between
    // them rather than freeze on one fat setState.
    cancelledRef.current = false

    function commit<K extends keyof TransitData>(key: K, value: TransitData[K]) {
      if (cancelledRef.current) return
      setData(prev => ({ ...prev, [key]: value }))
    }

    // Today's schedule type is loaded first and gates the `loading` flag
    // so LRT sim can start with the most-relevant data. Other types are
    // background-prefetched after primary lands (see below) so that by the
    // time the user drags DateTimePicker across a day boundary, the new
    // type's trips are already in memory.
    const primary = getScheduleType(new Date())
    inFlightRef.current.add(primary)
    const primaryTripsPromise = loadJson<Trip[]>(`/data/trips-${primary}.json`)
      .then(v => {
        if (cancelledRef.current) return
        loadedRef.current.add(primary)
        // This is the first trips commit; state's trips is still []. Replace.
        setData(prev => ({ ...prev, trips: v }))
      })
      .catch(err => console.error(`Failed to load primary trips (${primary}):`, err))
      .finally(() => {
        inFlightRef.current.delete(primary)
      })

    // Core data gates the `loading` flag — MapView's sim loop waits on it.
    // Flights + ferries are non-critical overlays, so they load independently
    // and do not block the first render of vehicles on the map.
    Promise.all([
      loadJson<LRTLine[]>('/data/lrt-lines.json').then(v => commit('lrtLines', v)),
      loadJson<Station[]>('/data/stations.json').then(v => commit('stations', v)),
      primaryTripsPromise,
      loadJson<BusRoute[]>('/data/bus-routes.json').then(v => commit('busRoutes', v)).catch(() => commit('busRoutes', [])),
      loadJson<BusStop[]>('/data/bus-stops.json').then(v => commit('busStops', v)).catch(() => commit('busStops', [])),
    ]).then(() => {
      if (cancelledRef.current) return
      setData(prev => (prev.loading ? { ...prev, loading: false } : prev))
      // Background-prefetch the other schedule types. ensureScheduleTypeLoaded
      // dedupes in-flight and already-loaded types so it's safe to call for
      // the primary too (it's a no-op by now).
      for (const stype of SCHEDULE_TYPES) {
        if (stype !== primary) ensureScheduleTypeLoaded(stype)
      }
    }).catch(err => {
      console.error('Failed to load core transit data:', err)
      if (!cancelledRef.current) setData(prev => ({ ...prev, loading: false }))
    })

    loadJson<Flight[]>('/data/flights.json')
      .then(v => commit('flights', v))
      .catch(() => {})

    loadJson<FerryScheduleFile>('/data/ferry-schedules.json')
      .then(file => commit('ferries', flattenFerrySchedules(file)))
      .catch(() => {})

    return () => { cancelledRef.current = true }
  }, [ensureScheduleTypeLoaded])

  // Memoise the wrapper so consumers (App.tsx's filteredTransitData useMemo,
  // MapView's deps, etc.) keep a stable object identity across renders.
  // Without this, every App render would spread a fresh object and invalidate
  // every downstream memo that depends on `transitData`.
  return useMemo(
    () => ({ ...data, ensureScheduleTypeLoaded }),
    [data, ensureScheduleTypeLoaded]
  )
}
