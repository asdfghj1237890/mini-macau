import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { LineLegend } from './components/LineLegend'
import { TimeDisplay } from './components/TimeDisplay'
import { MapSplash } from './components/MapSplash'
import { useSimulationClock } from './hooks/useSimulationClock'
import { useTransitData } from './hooks/useTransitData'
import { useServiceStatus } from './hooks/useServiceStatus'
import { getBusServiceBucket, getBusServiceWindow, getScheduleType } from './engines/simulationEngine'
import { macauHours, macauMinutes, macauMinutesOfDay, macauYmd } from './macauTime'
import { countActiveRoadWorks } from './roadWorks'
import { startEngagementTracker, ga } from './analytics/ga'
import { getRouteGroup, type GroupKey } from './routeGroups'
import {
  countSchoolsByLevel,
  filterSchoolsByLevel,
  loadSchoolLevelsOn,
  saveSchoolLevelsOn,
  type SchoolLevelSet,
} from './schools'
import { useCarParkVacancy } from './hooks/useCarParkVacancy'
import type { VehiclePosition, Station, BusRoute, RoadWorkNotice, School, SchoolLevel, Toilet, CarPark } from './types'

// MapView pulls in the ~1 MB maplibre-gl bundle; lazy so it doesn't block
// first paint. The <MapSplash/> fallback keeps the HUD interactive while
// MapLibre parses. No preconnect hint for CARTO/OpenFreeMap — the tile
// fetch happens well after LCP (behind the splash), and Lighthouse flags
// head-level preconnects as unused because they expire before MapLibre
// ever reaches the fetch. Letting the browser do DNS+TLS on-demand is a
// sub-100ms hit a user won't perceive during the splash.
const MapView = lazy(() => import('./components/MapView').then(m => ({ default: m.MapView })))
const VehicleInfoPanel = lazy(() => import('./components/VehicleInfoPanel').then(m => ({ default: m.VehicleInfoPanel })))
const StationInfoPanel = lazy(() => import('./components/StationInfoPanel').then(m => ({ default: m.StationInfoPanel })))
const FlightInfoPanel = lazy(() => import('./components/FlightInfoPanel').then(m => ({ default: m.FlightInfoPanel })))
const FerryInfoPanel = lazy(() => import('./components/FerryInfoPanel').then(m => ({ default: m.FerryInfoPanel })))
const RoadWorkInfoPanel = lazy(() => import('./components/RoadWorkInfoPanel').then(m => ({ default: m.RoadWorkInfoPanel })))
const SchoolInfoPanel = lazy(() => import('./components/SchoolInfoPanel').then(m => ({ default: m.SchoolInfoPanel })))
const ToiletInfoPanel = lazy(() => import('./components/ToiletInfoPanel').then(m => ({ default: m.ToiletInfoPanel })))
const CarParkInfoPanel = lazy(() => import('./components/CarParkInfoPanel').then(m => ({ default: m.CarParkInfoPanel })))

const LS_KEY = 'mini-macau-visible-routes'

// Keep a route considered in-service for up to SERVICE_TAIL_MIN past its
// scheduled end, so buses still finishing their last trip don't vanish.
const SERVICE_TAIL_MIN = 60

function isRouteInService(route: BusRoute, date: Date): boolean {
  const nowMin = macauMinutesOfDay(date)
  const window = getBusServiceWindow(route, getBusServiceBucket(date))
  if (!window) return false
  const startMin = window.start * 60
  let endWithTail = window.end * 60 + SERVICE_TAIL_MIN
  if (endWithTail <= startMin) endWithTail += 1440
  return (nowMin >= startMin && nowMin < endWithTail)
    || (nowMin + 1440 >= startMin && nowMin + 1440 < endWithTail)
}

function loadSavedRoutes(): string[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

function saveRoutes(ids: Set<string>) {
  localStorage.setItem(LS_KEY, JSON.stringify([...ids]))
}

function clearSavedRoutes() {
  localStorage.removeItem(LS_KEY)
}

const LS_LRT_KEY = 'mini-macau-lrt-on'
const LS_FLIGHTS_KEY = 'mini-macau-flights-on'
const LS_FERRIES_KEY = 'mini-macau-ferries-on'
const LS_ROADWORKS_KEY = 'mini-macau-roadworks-on'
const LS_SCHOOLS_KEY = 'mini-macau-schools-on'
const LS_TOILETS_KEY = 'mini-macau-toilets-on'
const LS_CARPARKS_KEY = 'mini-macau-carparks-on'

// Stable empty array for the "schools off" case. filteredTransitData is
// rebuilt on every clock tick (dateAwareFlights depends on currentTime), and
// MapView pushes the school layer on ARRAY IDENTITY change — a fresh `[]`
// literal here would make it call setData ~10×/s while the layer is hidden.
const NO_SCHOOLS: School[] = []
const NO_ROAD_WORKS: RoadWorkNotice[] = []
// Same reasoning for the toilet markers, which MapView also pushes on array
// identity (the data is time-independent, so it never goes through the tick).
const NO_TOILETS: Toilet[] = []
// Ditto for the "P" markers.
const NO_CAR_PARKS: CarPark[] = []
const LS_TIMEBAR_KEY = 'mini-macau-time-bar'

export default function App() {
  const clock = useSimulationClock()
  const transitData = useTransitData()
  const { ensureScheduleTypeLoaded } = transitData
  const serviceStatus = useServiceStatus()

  // Start the visibility- and idle-aware engagement tracker. See
  // src/analytics/ga.ts for event taxonomy + rationale.
  useEffect(() => {
    const dispose = startEngagementTracker()
    return dispose
  }, [])

  // On-demand safety net for Plan C cross-day handling: if the user drags
  // DateTimePicker into a different schedule type and the background
  // prefetch hasn't finished that type yet, this kicks off the fetch.
  // ensureScheduleTypeLoaded is idempotent, so repeat calls are no-ops once
  // the type is loaded or in-flight. We derive the type from the simulated
  // clock each render but only fire the effect when it actually changes.
  const currentScheduleType = getScheduleType(clock.currentTime)
  useEffect(() => {
    ensureScheduleTypeLoaded(currentScheduleType)
  }, [currentScheduleType, ensureScheduleTypeLoaded])
  const [visibleRoutes, setVisibleRoutes] = useState<Set<string>>(new Set())
  const [isAutoMode, setIsAutoMode] = useState(() => loadSavedRoutes() === null)
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null)
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  const [selectedRoadWork, setSelectedRoadWork] = useState<RoadWorkNotice | null>(null)
  // The clicked school plus the building that was clicked (schools are drawn
  // as one block per footprint, so the panel can name the exact one).
  const [selectedSchool, setSelectedSchool] = useState<
    { school: School; buildingName: string | null } | null
  >(null)
  const [selectedToilet, setSelectedToilet] = useState<Toilet | null>(null)
  const [selectedCarPark, setSelectedCarPark] = useState<CarPark | null>(null)
  const [trackedVehicleId, setTrackedVehicleId] = useState<string | null>(null)
  const [vehicleCount, setVehicleCount] = useState(0)
  const [showTimeBar, setShowTimeBar] = useState(() => localStorage.getItem(LS_TIMEBAR_KEY) !== '0')
  const [flightsOn, setFlightsOn] = useState(() => localStorage.getItem(LS_FLIGHTS_KEY) !== '0')
  const [ferriesOn, setFerriesOn] = useState(() => localStorage.getItem(LS_FERRIES_KEY) !== '0')
  const [roadWorksOn, setRoadWorksOn] = useState(() => localStorage.getItem(LS_ROADWORKS_KEY) !== '0')
  // Schools are the one layer that is OFF until asked for — opt-in, unlike
  // the transit layers, so `=== '1'` rather than the `!== '0'` the others use.
  const [schoolsOn, setSchoolsOn] = useState(() => localStorage.getItem(LS_SCHOOLS_KEY) === '1')
  // Toilets are opt-in for the same reason as schools — 197 pins over the
  // peninsula are noise until someone actually wants them, so `=== '1'`.
  const [toiletsOn, setToiletsOn] = useState(() => localStorage.getItem(LS_TOILETS_KEY) === '1')
  // Car parks are opt-in as well — 88 "P" plates over the peninsula, and the
  // layer is the only thing that starts the live-vacancy polling.
  const [carParksOn, setCarParksOn] = useState(() => localStorage.getItem(LS_CARPARKS_KEY) === '1')
  // Which of the five teaching stages are drawn. Independent of `schoolsOn`,
  // which is the master switch for the whole layer.
  const [schoolLevelsOn, setSchoolLevelsOn] = useState<SchoolLevelSet>(loadSchoolLevelsOn)
  // Defer the MapView mount (and therefore the MapLibre lazy chunk import +
  // its ~5s eval on a slow CPU) until the browser hits idle. The splash keeps
  // the HUD visible meanwhile. This shifts MapLibre's JS eval out of the LCP
  // window so Lighthouse no longer attributes it to "reduce JS execution".
  const [mapReady, setMapReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    const go = () => { if (!cancelled) setMapReady(true) }
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(go, { timeout: 1500 })
      return () => { cancelled = true; w.cancelIdleCallback?.(id) }
    }
    const t = window.setTimeout(go, 600)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [])
  const lrtSavedRef = useRef<string[] | null>((() => {
    try {
      const raw = localStorage.getItem(LS_LRT_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) return arr as string[]
      }
    } catch { /* ignore */ }
    return null
  })())
  const [lrtOn, setLrtOn] = useState<Set<string>>(() =>
    lrtSavedRef.current ? new Set(lrtSavedRef.current) : new Set()
  )
  const lrtInitedRef = useRef(false)
  const initedRef = useRef(false)

  useEffect(() => {
    if (transitData.lrtLines.length === 0) return
    if (lrtInitedRef.current) return
    lrtInitedRef.current = true
    if (!lrtSavedRef.current) {
      setLrtOn(new Set(transitData.lrtLines.map(l => l.id)))
    }
  }, [transitData.lrtLines])

  useEffect(() => { localStorage.setItem(LS_TIMEBAR_KEY, showTimeBar ? '1' : '0') }, [showTimeBar])
  useEffect(() => { localStorage.setItem(LS_FLIGHTS_KEY, flightsOn ? '1' : '0') }, [flightsOn])
  useEffect(() => { localStorage.setItem(LS_FERRIES_KEY, ferriesOn ? '1' : '0') }, [ferriesOn])
  useEffect(() => { localStorage.setItem(LS_ROADWORKS_KEY, roadWorksOn ? '1' : '0') }, [roadWorksOn])
  useEffect(() => { localStorage.setItem(LS_SCHOOLS_KEY, schoolsOn ? '1' : '0') }, [schoolsOn])
  useEffect(() => { localStorage.setItem(LS_TOILETS_KEY, toiletsOn ? '1' : '0') }, [toiletsOn])
  useEffect(() => { localStorage.setItem(LS_CARPARKS_KEY, carParksOn ? '1' : '0') }, [carParksOn])
  useEffect(() => { saveSchoolLevelsOn(schoolLevelsOn) }, [schoolLevelsOn])
  // Hiding the layer must also close its panel — the marker it describes is
  // gone from the map.
  useEffect(() => { if (!roadWorksOn) setSelectedRoadWork(null) }, [roadWorksOn])
  useEffect(() => { if (!schoolsOn) setSelectedSchool(null) }, [schoolsOn])
  useEffect(() => { if (!toiletsOn) setSelectedToilet(null) }, [toiletsOn])
  useEffect(() => { if (!carParksOn) setSelectedCarPark(null) }, [carParksOn])
  // Same rule one level down: switching off a teaching stage removes those
  // blocks, so a panel describing one of them has to close too.
  useEffect(() => {
    setSelectedSchool(prev => (prev && !schoolLevelsOn.has(prev.school.level) ? null : prev))
  }, [schoolLevelsOn])
  useEffect(() => { localStorage.setItem(LS_LRT_KEY, JSON.stringify([...lrtOn])) }, [lrtOn])

  const currentHour = macauHours(clock.currentTime)
  const currentMinute = macauMinutes(clock.currentTime)

  const inactiveRoutes = serviceStatus.inactive

  useEffect(() => {
    if (transitData.busRoutes.length === 0) return

    if (!initedRef.current) {
      initedRef.current = true
      const saved = loadSavedRoutes()
      if (saved) {
        const valid = new Set(transitData.busRoutes.map(r => r.id))
        setVisibleRoutes(new Set(saved.filter(id => valid.has(id) && !inactiveRoutes.has(id))))
        setIsAutoMode(false)
        return
      }
    }

    if (isAutoMode) {
      setVisibleRoutes(new Set(
        transitData.busRoutes
          .filter(r => !inactiveRoutes.has(r.id) && isRouteInService(r, clock.currentTime))
          .map(r => r.id)
      ))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitData.busRoutes.length, currentHour, currentMinute, isAutoMode, inactiveRoutes])

  useEffect(() => {
    if (inactiveRoutes.size === 0) return
    setVisibleRoutes(prev => {
      let changed = false
      const next = new Set(prev)
      for (const id of prev) {
        if (inactiveRoutes.has(id)) { next.delete(id); changed = true }
      }
      if (!changed) return prev
      if (!isAutoMode) saveRoutes(next)
      return next
    })
  }, [inactiveRoutes, isAutoMode])

  // Resolve flights for the simulated date. Inside the 8-day window
  // (today + 7 days from the timetable workflow) returns that day's
  // records; outside the window falls back to the latest day in the
  // window with the same weekday. See useTransitData.getFlightsForDate.
  const dateAwareFlights = useMemo(
    () => transitData.getFlightsForDate(clock.currentTime),
    [transitData, clock.currentTime]
  )

  // Memoized separately from filteredTransitData (which is rebuilt on every
  // clock tick): MapView pushes the school layer on ARRAY IDENTITY change, so
  // this array must only change when the master switch, the per-level set, or
  // the data itself does. Emptying it is the whole "off" mechanism.
  const visibleSchools = useMemo(
    () => (schoolsOn ? filterSchoolsByLevel(transitData.schools, schoolLevelsOn) : NO_SCHOOLS),
    [transitData.schools, schoolsOn, schoolLevelsOn]
  )

  // Per-level totals for the legend, from the UNFILTERED data — the rows show
  // how many schools each type has, not how many are currently drawn.
  const schoolLevelCounts = useMemo(
    () => countSchoolsByLevel(transitData.schools),
    [transitData.schools]
  )

  const filteredTransitData = useMemo(() => ({
    ...transitData,
    busRoutes: transitData.busRoutes.filter(r => visibleRoutes.has(r.id)),
    lrtLines: transitData.lrtLines.filter(l => lrtOn.has(l.id)),
    flights: flightsOn ? dateAwareFlights : [],
    ferries: ferriesOn ? transitData.ferries : [],
    roadWorks: roadWorksOn ? transitData.roadWorks : NO_ROAD_WORKS,
    schools: visibleSchools,
    toilets: toiletsOn ? transitData.toilets : NO_TOILETS,
    carParks: carParksOn ? transitData.carParks : NO_CAR_PARKS,
  }), [transitData, visibleRoutes, lrtOn, flightsOn, dateAwareFlights, ferriesOn, roadWorksOn, visibleSchools, toiletsOn, carParksOn])

  // Live car-park vacancy. Polled ONLY while the layer is on AND the clock
  // runs at 1× — at any other speed the simulated moment is not "now", so a
  // real-time count would be telling the user something false. The hook adds
  // the third condition (tab visible) and does the 30 s interval.
  const carParkVacancy = useCarParkVacancy(carParksOn && clock.speed === 1)

  // Notices in force on the simulated Macau calendar day. Keyed on the day
  // string, NOT on clock.currentTime — the clock re-renders at ~10 Hz and the
  // count only changes at midnight.
  const simYmd = macauYmd(clock.currentTime)
  const activeRoadWorksCount = useMemo(
    () => countActiveRoadWorks(transitData.roadWorks, simYmd),
    [transitData.roadWorks, simYmd]
  )

  const onVehicleCount = useCallback((count: number) => {
    setVehicleCount(count)
  }, [])

  const onToggleRoute = useCallback((routeId: string) => {
    if (inactiveRoutes.has(routeId)) return
    setVisibleRoutes(prev => {
      const next = new Set(prev)
      if (next.has(routeId)) next.delete(routeId)
      else next.add(routeId)
      saveRoutes(next)
      return next
    })
    setIsAutoMode(false)
  }, [inactiveRoutes])

  const onToggleAll = useCallback(() => {
    const eligible = transitData.busRoutes.filter(r => !inactiveRoutes.has(r.id))
    setVisibleRoutes(prev => {
      const next = prev.size === eligible.length
        ? new Set<string>()
        : new Set(eligible.map(r => r.id))
      saveRoutes(next)
      return next
    })
    setIsAutoMode(false)
  }, [transitData.busRoutes, inactiveRoutes])

  const onShowAll = useCallback(() => {
    const next = new Set(
      transitData.busRoutes.filter(r => !inactiveRoutes.has(r.id)).map(r => r.id)
    )
    saveRoutes(next)
    setVisibleRoutes(next)
    setIsAutoMode(false)
  }, [transitData.busRoutes, inactiveRoutes])

  const onHideAll = useCallback(() => {
    const next = new Set<string>()
    saveRoutes(next)
    setVisibleRoutes(next)
    setIsAutoMode(false)
  }, [])

  const onToggleGroup = useCallback((groupKey: GroupKey) => {
    const groupRoutes = transitData.busRoutes.filter(
      r => getRouteGroup(r) === groupKey && !inactiveRoutes.has(r.id)
    )
    if (groupRoutes.length === 0) return
    const autoSet = new Set(
      transitData.busRoutes
        .filter(r => !inactiveRoutes.has(r.id) && isRouteInService(r, clock.currentTime))
        .map(r => r.id)
    )
    const anyOn = groupRoutes.some(r => visibleRoutes.has(r.id))
    const next = new Set(visibleRoutes)
    if (anyOn) {
      for (const r of groupRoutes) next.delete(r.id)
    } else {
      // Only add routes currently in service so re-enabling matches
      // what the auto-by-time view was showing (e.g. 30/31, not 31/31).
      for (const r of groupRoutes) {
        if (isRouteInService(r, clock.currentTime)) next.add(r.id)
      }
    }
    setVisibleRoutes(next)
    // If the resulting set exactly equals the auto-by-time view, snap
    // back into auto mode so the tab re-highlights.
    const matchesAuto = next.size === autoSet.size
      && [...next].every(id => autoSet.has(id))
    if (matchesAuto) {
      clearSavedRoutes()
      setIsAutoMode(true)
    } else {
      saveRoutes(next)
      setIsAutoMode(false)
    }
    ga.layerToggled(`bus_group_${groupKey}`, !anyOn)
  }, [transitData.busRoutes, inactiveRoutes, clock, visibleRoutes])

  const onResetAuto = useCallback(() => {
    clearSavedRoutes()
    setIsAutoMode(true)
  }, [])

  const onVehicleClick = useCallback((vehicle: VehiclePosition | null) => {
    setSelectedVehicle(vehicle)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setTrackedVehicleId(vehicle?.id ?? null)
    if (vehicle) ga.vehicleSelected(vehicle.type, vehicle.id)
  }, [])

  const onTrackedVehicleUpdate = useCallback((vehicle: VehiclePosition) => {
    setSelectedVehicle(prev => (prev && prev.id === vehicle.id ? vehicle : prev))
  }, [])

  const onStationClick = useCallback((station: Station | null) => {
    setSelectedStation(station)
    setSelectedVehicle(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setTrackedVehicleId(null)
    if (station) ga.stationSelected(station.id)
  }, [])

  // Road-work markers are mutually exclusive with vehicle/station selection,
  // matching the existing handlers (only one info panel is ever open).
  const onRoadWorkClick = useCallback((notice: RoadWorkNotice | null) => {
    setSelectedRoadWork(notice)
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setTrackedVehicleId(null)
  }, [])

  // School blocks follow the same one-panel-at-a-time rule.
  const onSchoolClick = useCallback((school: School, buildingName: string | null) => {
    setSelectedSchool({ school, buildingName })
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setTrackedVehicleId(null)
  }, [])

  // Toilet markers, likewise: one info panel is ever open.
  const onToiletClick = useCallback((toilet: Toilet | null) => {
    setSelectedToilet(toilet)
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedCarPark(null)
    setTrackedVehicleId(null)
  }, [])

  // Car-park markers, same exclusivity rule.
  const onCarParkClick = useCallback((carPark: CarPark | null) => {
    setSelectedCarPark(carPark)
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setTrackedVehicleId(null)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setTrackedVehicleId(null)
  }, [])

  const toggleLrt = useCallback((id: string) => {
    setLrtOn(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      ga.layerToggled(`lrt_${id}`, next.has(id))
      return next
    })
  }, [])

  const toggleFlights = useCallback(() => setFlightsOn(v => {
    ga.layerToggled('flights', !v)
    return !v
  }), [])
  const toggleFerries = useCallback(() => setFerriesOn(v => {
    ga.layerToggled('ferries', !v)
    return !v
  }), [])
  const toggleRoadWorks = useCallback(() => setRoadWorksOn(v => {
    ga.layerToggled('road_works', !v)
    return !v
  }), [])
  const toggleSchools = useCallback(() => setSchoolsOn(v => {
    ga.layerToggled('schools', !v)
    return !v
  }), [])
  const toggleToilets = useCallback(() => setToiletsOn(v => {
    ga.layerToggled('toilets', !v)
    return !v
  }), [])
  const toggleCarParks = useCallback(() => setCarParksOn(v => {
    ga.layerToggled('carparks', !v)
    return !v
  }), [])
  const toggleSchoolLevel = useCallback((level: SchoolLevel) => {
    setSchoolLevelsOn(prev => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      ga.layerToggled(`schools_${level}`, next.has(level))
      return next
    })
  }, [])
  const toggleTimeBar = useCallback(() => setShowTimeBar(v => {
    ga.layerToggled('time_bar', !v)
    return !v
  }), [])

  const { togglePause } = clock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePause()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePause])

  return (
    <div className="relative w-full h-full">
      {mapReady ? (
        <Suspense fallback={<MapSplash />}>
          <MapView
            clock={clock}
            transitData={filteredTransitData}
            allTransitData={transitData}
            onVehicleClick={onVehicleClick}
            onTrackedVehicleUpdate={onTrackedVehicleUpdate}
            onStationClick={onStationClick}
            onRoadWorkClick={onRoadWorkClick}
            onSchoolClick={onSchoolClick}
            onToiletClick={onToiletClick}
            onCarParkClick={onCarParkClick}
            carParkVacancy={carParkVacancy.vacancy}
            onClearSelection={clearSelection}
            trackedVehicleId={trackedVehicleId}
            selectedRoadWorkId={selectedRoadWork?.id ?? null}
            selectedSchoolId={selectedSchool?.school.id ?? null}
            selectedToiletId={selectedToilet?.id ?? null}
            selectedCarParkId={selectedCarPark?.id ?? null}
            onVehicleCount={onVehicleCount}
            showTimeBar={showTimeBar}
            onToggleTimeBar={toggleTimeBar}
          />
        </Suspense>
      ) : (
        <MapSplash />
      )}
      {showTimeBar && <TimeDisplay clock={clock} vehicleCount={vehicleCount} />}
      <LineLegend
        transitData={filteredTransitData}
        // Pass the date-aware total here too so the "active / total"
        // flight count tracks the picker; using raw `transitData` would
        // always show today's realtime count even on a future date.
        allTransitData={{ ...transitData, flights: dateAwareFlights }}
        visibleRoutes={visibleRoutes}
        inactiveRoutes={inactiveRoutes}
        isAutoMode={isAutoMode}
        lrtOn={lrtOn}
        flightsOn={flightsOn}
        ferriesOn={ferriesOn}
        roadWorksOn={roadWorksOn}
        activeRoadWorksCount={activeRoadWorksCount}
        schoolsOn={schoolsOn}
        schoolLevelsOn={schoolLevelsOn}
        schoolLevelCounts={schoolLevelCounts}
        toiletsOn={toiletsOn}
        carParksOn={carParksOn}
        clock={clock}
        onToggleLrt={toggleLrt}
        onToggleFlights={toggleFlights}
        onToggleFerries={toggleFerries}
        onToggleRoadWorks={toggleRoadWorks}
        onToggleSchools={toggleSchools}
        onToggleSchoolLevel={toggleSchoolLevel}
        onToggleToilets={toggleToilets}
        onToggleCarParks={toggleCarParks}
        onToggleRoute={onToggleRoute}
        onToggleAll={onToggleAll}
        onShowAll={onShowAll}
        onHideAll={onHideAll}
        onToggleGroup={onToggleGroup}
        onResetAuto={onResetAuto}
      />
      <ControlPanel clock={clock} />
      <Suspense>
        {selectedVehicle && selectedVehicle.type === 'flight' && (
          <FlightInfoPanel
            vehicle={selectedVehicle}
            clock={clock}
            onClose={clearSelection}
          />
        )}
        {selectedVehicle && selectedVehicle.type === 'ferry' && (
          <FerryInfoPanel
            vehicle={selectedVehicle}
            clock={clock}
            onClose={clearSelection}
          />
        )}
        {selectedVehicle && selectedVehicle.type !== 'flight' && selectedVehicle.type !== 'ferry' && (
          <VehicleInfoPanel
            vehicle={selectedVehicle}
            transitData={filteredTransitData}
            clock={clock}
            onClose={clearSelection}
          />
        )}
        {selectedStation && (
          <StationInfoPanel
            station={selectedStation}
            transitData={filteredTransitData}
            clock={clock}
            onClose={clearSelection}
          />
        )}
        {selectedRoadWork && (
          <RoadWorkInfoPanel
            notice={selectedRoadWork}
            clock={clock}
            onClose={clearSelection}
          />
        )}
        {selectedSchool && (
          <SchoolInfoPanel
            school={selectedSchool.school}
            buildingName={selectedSchool.buildingName}
            onClose={clearSelection}
          />
        )}
        {selectedToilet && (
          <ToiletInfoPanel
            toilet={selectedToilet}
            onClose={clearSelection}
          />
        )}
        {selectedCarPark && (
          <CarParkInfoPanel
            carPark={selectedCarPark}
            vacancy={carParkVacancy.vacancy?.get(selectedCarPark.id) ?? null}
            polling={carParkVacancy.polling}
            onClose={clearSelection}
          />
        )}
      </Suspense>
    </div>
  )
}
