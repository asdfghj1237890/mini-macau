import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TransitData, LRTLine, Station, Trip, BusRoute, BusStop, Flight, Ferry, RoadWorkNotice, School, SchoolLevel, ScheduleType } from '../types'
import { getScheduleType } from '../engines/simulationEngine'
import { macauWeekday } from '../macauTime'
import { FERRY_BERTH_COUNT_BY_TERMINAL, type MacauFerryTerminal, type FerryOperator } from '../engines/ferryBerths'
import type { z } from 'zod'
import {
  parseData,
  LRTLinesSchema,
  StationsSchema,
  TripsSchema,
  BusRoutesSchema,
  BusStopsSchema,
  FlightsSchema,
  FerryScheduleFileSchema,
  RoadWorksFileSchema,
  SchoolsFileSchema,
} from '../dataSchemas'

const SCHEDULE_TYPES: readonly ScheduleType[] = ['mon_thu', 'friday', 'sat_sun'] as const

// Fetch + schema-validate a static data file. A non-2xx response throws (so a
// 404 doesn't get parsed as an HTML error page), and the JSON is run through
// its zod schema (`parseData` throws in dev, logs in prod) before use.
async function loadJson<T>(path: string, schema: z.ZodType, label: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`fetch ${path} → HTTP ${res.status}`)
  const raw = await res.json()
  return parseData<T>(schema, raw, label)
}

// LRT trips are NOT served from /data/ like the other datasets. The MLM
// timetable is bundled from `src/data/trips-*.json` into anonymously named,
// content-hashed chunks (see `chunkFileNames` in vite.config.ts), so there is
// no guessable JSON endpoint for it. `import.meta.glob` keeps each
// scheduleType a separate lazy chunk: today's loads first, the other two
// prefetch in the background (see ensureScheduleTypeLoaded).
const tripModules = import.meta.glob<unknown>('../data/trips-*.json', { import: 'default' })

async function loadTrips(stype: ScheduleType): Promise<Trip[]> {
  const load = tripModules[`../data/trips-${stype}.json`]
  if (!load) throw new Error(`no bundled trips chunk for scheduleType "${stype}"`)
  return parseData<Trip[]>(TripsSchema, await load(), `trips-${stype}`)
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

// road-works.json wraps the notices in a metadata envelope; only `notices`
// reaches TransitData (the runtime never reads the provenance fields — the
// panel's source attribution is a static label).
interface RoadWorksFile {
  fetchedAtUtc: string
  exportedAt: string
  source: { name: string; dataset: string; download: string }
  notices: RoadWorkNotice[]
}

// schools.json likewise wraps the list in a metadata envelope. Only `schools`
// reaches TransitData — `unmatchedDsedj` / `droppedOsm` are pipeline
// diagnostics and the source attribution in the sidebar is a static label.
interface SchoolsFile {
  fetchedAtUtc: string
  sources: Record<string, string>
  levels: SchoolLevel[]
  schools: School[]
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

  // Resolve flights for a given calendar date.
  //
  // Two upstream files feed this:
  //   • `flights.json` — realtime, today only (Macau-local), no `date` field.
  //   • `flights-timetable.json` — multi-day window starting tomorrow, each
  //      record carries `date: YYYY-MM-DD`.
  //
  // Resolution order for a target date `d`:
  //   1. Exact match in the 8-day window (today + 7 days) → that day's
  //      records (realtime if today, timetable bucket otherwise).
  //   2. Weekday fallback — pick the latest day in the window with the
  //      same weekday as `d`. (We have ≥1 representative for every
  //      weekday because the window spans 8 consecutive days.)
  //   3. Whatever's loaded (realtime if available, else first timetable
  //      bucket) — only hit when both fetches haven't finished or both
  //      failed.
  //
  // Date keys are formatted using `d`'s LOCAL Y/M/D, so user-picked
  // dates from the DateTimePicker line up with the upstream `date`
  // strings (which are Macau-local YYYY-MM-DD).
  getFlightsForDate: (d: Date) => Flight[]
}

// `ymdMacau(d)` formats an instant as a YYYY-MM-DD calendar date in **Macau
// time** (UTC+8). Used both to seed `today` inside `buildFlightIndex` and to
// resolve picker-selected dates in `getFlightsForDate`. The realtime file's
// authoritative `date` field is written by `fetch_flights.py` in Macau-local
// time, and the whole simulation reads wall-clock fields in Macau (see
// `macauTime.ts`), so a Macau-aligned key keeps every overlay on the same
// calendar day for every viewer regardless of their browser timezone.
//
// `en-CA` locale is used purely because it produces `YYYY-MM-DD` natively,
// matching the upstream `date` field shape.
const MACAU_YMD_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Macau',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function ymdMacau(d: Date): string {
  return MACAU_YMD_FMT.format(d)
}

// Weekday (0=Sun..6=Sat) of a YYYY-MM-DD calendar date. Constructed
// from a local-tz Date at midnight, but since the calendar weekday is
// timezone-invariant for any given Y/M/D, the result is the right
// weekday regardless of the viewer's timezone. Used inside
// `buildFlightIndex` to derive weekdays from Macau-dated index keys.
export function weekdayOf(ymd: string): number {
  const [y, m, day] = ymd.split('-').map(Number)
  return new Date(y, m - 1, day).getDay()
}

export interface FlightDataIndex {
  // YYYY-MM-DD → flights for that exact date.
  byDate: Map<string, Flight[]>
  // 0..6 (Sun..Sat) → representative day's flights (latest matching date
  // within the window).
  byWeekday: Map<number, Flight[]>
  // Last-resort list when no index entry matches and no fetches landed.
  fallback: Flight[]
}

// Build the date-keyed flight index. Pure / exported for unit tests.
//
// `realtime`: today-only records from /data/flights.json. Modern files
// carry `date: YYYY-MM-DD` (Macau-local) on every record. Legacy files
// generated before that field existed have no `date`.
// `timetable`: multi-day records from /data/flights-timetable.json,
// each with a `date: YYYY-MM-DD` field.
//
// `today` is the Macau-local YYYY-MM-DD used as the "best-effort"
// bucket key for legacy realtime files (those lacking a `date` field).
// Tests inject a fixed value so they don't depend on wall-clock time.
//
// **Realtime trust rule** (fix for the "Macau-midnight to morning
// realtime refresh" stale-file window):
//   * If realtime carries `date`, bucket it under THAT date — even
//     when it doesn't equal today_macau. So a stale realtime file
//     from yesterday lands in yesterday's bucket and today's bucket
//     keeps the timetable record (which has the correct future
//     schedule). When realtime IS fresh, it correctly overwrites
//     today's timetable bucket and the user sees richer realtime
//     info.
//   * If realtime carries no `date` (legacy file), only fill today's
//     bucket if no timetable bucket exists for today. We never let
//     an unverifiable realtime file shadow a trusted timetable bucket.
export function buildFlightIndex(
  realtime: Flight[],
  timetable: Flight[],
  today: string = ymdMacau(new Date()),
): FlightDataIndex {
  const byDate = new Map<string, Flight[]>()

  // Bucket multi-day timetable records by their `date` field.
  for (const f of timetable) {
    if (!f.date) continue
    let bucket = byDate.get(f.date)
    if (!bucket) {
      bucket = []
      byDate.set(f.date, bucket)
    }
    bucket.push(f)
  }

  if (realtime.length) {
    const claimedDate = realtime[0]?.date
    if (claimedDate) {
      // Trusted source date: place under the date the file claims,
      // overwriting the timetable bucket only for that exact date.
      byDate.set(claimedDate, realtime)
    } else if (!byDate.has(today)) {
      // Legacy file with no date: only used as today's bucket if the
      // timetable hasn't already filled it. Avoids shadowing a
      // trusted timetable record with an unverifiable realtime file.
      byDate.set(today, realtime)
    }
  }

  // For each weekday, remember the latest date in the window with that
  // weekday (so out-of-window dates get the freshest matching schedule).
  const latestByWeekday = new Map<number, string>()
  for (const dateStr of byDate.keys()) {
    const wd = weekdayOf(dateStr)
    const prev = latestByWeekday.get(wd)
    if (!prev || dateStr > prev) latestByWeekday.set(wd, dateStr)
  }
  const byWeekday = new Map<number, Flight[]>()
  for (const [wd, dateStr] of latestByWeekday) {
    const flights = byDate.get(dateStr)
    if (flights) byWeekday.set(wd, flights)
  }

  // Last-resort fallback: prefer realtime, then any timetable day.
  let fallback: Flight[] = realtime
  if (!fallback.length) {
    const firstBucket = byDate.values().next()
    if (!firstBucket.done) fallback = firstBucket.value
  }

  return { byDate, byWeekday, fallback }
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
    roadWorks: [],
    schools: [],
    loading: true,
  })
  // Multi-day timetable lives in its own state slot rather than on
  // TransitData — only the resolver needs it, and pulling it out keeps
  // the existing `flights` field semantically "today's realtime".
  const [flightsTimetable, setFlightsTimetable] = useState<Flight[]>([])

  // Track scheduleTypes we've started loading so repeated triggers don't
  // kick off duplicate fetches. Refs (not state) because we only need
  // identity semantics — no re-render on change.
  const loadedRef = useRef<Set<ScheduleType>>(new Set())
  const inFlightRef = useRef<Set<ScheduleType>>(new Set())
  const cancelledRef = useRef(false)

  const ensureScheduleTypeLoaded = useCallback((stype: ScheduleType) => {
    if (loadedRef.current.has(stype) || inFlightRef.current.has(stype)) return
    inFlightRef.current.add(stype)
    loadTrips(stype)
      .then(newTrips => {
        if (cancelledRef.current) return
        loadedRef.current.add(stype)
        // Append instead of replace — other scheduleTypes may already be
        // present in state; simulationEngine.getFilteredTrips picks the
        // right subset per tick.
        setData(prev => ({ ...prev, trips: [...prev.trips, ...newTrips] }))
      })
      .catch(err => console.error(`Failed to load trips-${stype}:`, err))
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
    const primaryTripsPromise = loadTrips(primary)
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
      loadJson<LRTLine[]>('/data/lrt-lines.json', LRTLinesSchema, 'lrt-lines.json').then(v => commit('lrtLines', v)),
      loadJson<Station[]>('/data/stations.json', StationsSchema, 'stations.json').then(v => commit('stations', v)),
      primaryTripsPromise,
      loadJson<BusRoute[]>('/data/bus-routes.json', BusRoutesSchema, 'bus-routes.json').then(v => commit('busRoutes', v)).catch(() => commit('busRoutes', [])),
      loadJson<BusStop[]>('/data/bus-stops.json', BusStopsSchema, 'bus-stops.json').then(v => commit('busStops', v)).catch(() => commit('busStops', [])),
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

    loadJson<Flight[]>('/data/flights.json', FlightsSchema, 'flights.json')
      .then(v => commit('flights', v))
      .catch(() => {})

    // The multi-day timetable file is produced by a separate workflow
    // (`update-flights-timetable`) and may legitimately not exist on
    // first deployment — swallow 404s/parse errors and let the resolver
    // fall back to today's realtime schedule.
    loadJson<Flight[]>('/data/flights-timetable.json', FlightsSchema, 'flights-timetable.json')
      .then(v => {
        if (cancelledRef.current) return
        setFlightsTimetable(v)
      })
      .catch(() => {})

    loadJson<FerryScheduleFile>('/data/ferry-schedules.json', FerryScheduleFileSchema, 'ferry-schedules.json')
      .then(file => commit('ferries', flattenFerrySchedules(file)))
      .catch(() => {})

    // Road works are a non-critical overlay like flights/ferries: the file is
    // produced by its own workflow and may legitimately be missing on a fresh
    // deployment, so a failure just leaves the overlay empty.
    loadJson<RoadWorksFile>('/data/road-works.json', RoadWorksFileSchema, 'road-works.json')
      .then(file => commit('roadWorks', file.notices))
      .catch(() => {})

    // Schools are a static (manually regenerated) overlay, loaded the same
    // non-critical way: a missing file just leaves the campus blocks off the
    // map rather than failing the whole load.
    loadJson<SchoolsFile>('/data/schools.json', SchoolsFileSchema, 'schools.json')
      .then(file => commit('schools', file.schools))
      .catch(() => {})

    return () => { cancelledRef.current = true }
  }, [ensureScheduleTypeLoaded])

  // Build the date-keyed flight index once whenever either source
  // changes, so getFlightsForDate is a cheap Map lookup at call time.
  const flightIndex = useMemo(
    () => buildFlightIndex(data.flights, flightsTimetable),
    [data.flights, flightsTimetable]
  )

  const getFlightsForDate = useCallback(
    (d: Date): Flight[] => {
      // Look up by the Macau calendar Y/M/D (and Macau weekday) of the
      // instant. The whole simulation now reads wall-clock fields in Macau
      // time (buses/LRT via the engine, the clock display, the picker), and
      // the upstream `date` field is Macau-local, so a Macau-keyed lookup
      // keeps flights on the same calendar day as every other overlay for
      // every viewer regardless of their browser timezone.
      const ymd = ymdMacau(d)
      const exact = flightIndex.byDate.get(ymd)
      if (exact) return exact
      const wd = flightIndex.byWeekday.get(macauWeekday(d))
      if (wd) return wd
      return flightIndex.fallback
    },
    [flightIndex]
  )

  // Memoise the wrapper so consumers (App.tsx's filteredTransitData useMemo,
  // MapView's deps, etc.) keep a stable object identity across renders.
  // Without this, every App render would spread a fresh object and invalidate
  // every downstream memo that depends on `transitData`.
  return useMemo(
    () => ({ ...data, ensureScheduleTypeLoaded, getFlightsForDate }),
    [data, ensureScheduleTypeLoaded, getFlightsForDate]
  )
}
