import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { LineLegend } from './components/LineLegend'
import { TimeDisplay } from './components/TimeDisplay'
import { MapSplash } from './components/MapSplash'
import { useSimulationClock, useClockMinute } from './hooks/useSimulationClock'
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
import {
  FOCUS_LAYERS,
  activeFocusPeer,
  applyFocusMode,
  applyLayerSnapshot,
  focusHandoffSnapshot,
  loadFocusSnapshot,
  saveFocusSnapshot,
  type FocusLayer,
  type LayerVisibilityApply,
  type LayerVisibilityState,
} from './focusMode'
import {
  countWasteByType,
  loadHiddenWasteTypes,
  saveHiddenWasteTypes,
  visibleWasteEcoStations,
  visibleWasteFacilities,
  visibleWasteIncinerator,
  visibleWasteSites,
  wasteIncinerator,
  wasteSelectionId,
  wasteSelectionType,
  type WasteExtras,
  type WasteLayerType,
  type WasteSelection,
  type WasteTypeSet,
} from './waste'
import { useCarParkVacancy } from './hooks/useCarParkVacancy'
import { useWaterDistribution } from './hooks/useWaterDistribution'
import { usePowerDistribution } from './hooks/usePowerDistribution'
import { ignoreClockShortcut } from './timeControls'
import type { VehiclePosition, Station, BusRoute, RoadWorkNotice, School, SchoolLevel, Toilet, CarPark, WasteSite, WaterFacility, WaterNetworkNode, PowerFacility, PowerNetworkNode, GrandPrixCorner } from './types'

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
const WasteSiteInfoPanel = lazy(() => import('./components/WasteSiteInfoPanel').then(m => ({ default: m.WasteSiteInfoPanel })))
// The incineration plant's variant lives in the same module, so this resolves
// the same chunk rather than adding a second network request.
const WasteIncineratorInfoPanel = lazy(() => import('./components/WasteSiteInfoPanel').then(m => ({ default: m.WasteIncineratorInfoPanel })))
const WasteEcoStationInfoPanel = lazy(() => import('./components/WasteSiteInfoPanel').then(m => ({ default: m.WasteEcoStationInfoPanel })))
const WasteFacilityInfoPanel = lazy(() => import('./components/WasteSiteInfoPanel').then(m => ({ default: m.WasteFacilityInfoPanel })))
const WaterFacilityInfoPanel = lazy(() => import('./components/WaterFacilityInfoPanel').then(m => ({ default: m.WaterFacilityInfoPanel })))
// The inlet variant lives in the same module, so this resolves the same chunk
// rather than adding a second network request.
const WaterInletInfoPanel = lazy(() => import('./components/WaterFacilityInfoPanel').then(m => ({ default: m.WaterInletInfoPanel })))
const PowerFacilityInfoPanel = lazy(() => import('./components/PowerFacilityInfoPanel').then(m => ({ default: m.PowerFacilityInfoPanel })))
// Same module as the facility panel, so this resolves the same chunk rather
// than adding a second network request.
const PowerInletInfoPanel = lazy(() => import('./components/PowerFacilityInfoPanel').then(m => ({ default: m.PowerInletInfoPanel })))
const GrandPrixCircuitInfoPanel = lazy(() => import('./components/GrandPrixInfoPanel').then(m => ({ default: m.GrandPrixCircuitInfoPanel })))
// Same module as the circuit panel, so this resolves the same chunk.
const GrandPrixCornerInfoPanel = lazy(() => import('./components/GrandPrixInfoPanel').then(m => ({ default: m.GrandPrixCornerInfoPanel })))

// What the GRAND PRIX panel is showing: the circuit itself (a click on the
// racing line) or one of its named corners (a click on a badge).
type GrandPrixSelection = { kind: 'circuit' } | { kind: 'corner'; corner: GrandPrixCorner }

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
const LS_WASTE_KEY = 'mini-macau-waste-on'
const LS_WATER_KEY = 'mini-macau-water-on'
const LS_POWER_KEY = 'mini-macau-power-on'
const LS_GRANDPRIX_KEY = 'mini-macau-grandprix-on'

// Stable empty array for the "schools off" case. filteredTransitData is
// rebuilt every simulated minute (dateAwareFlights depends on the clock),
// and MapView pushes the school layer on ARRAY IDENTITY change — a fresh `[]`
// literal here would make it call setData each time while the layer is hidden.
const NO_SCHOOLS: School[] = []
const NO_ROAD_WORKS: RoadWorkNotice[] = []
// Same reasoning for the toilet markers, which MapView also pushes on array
// identity (the data is time-independent, so it never goes through the tick).
const NO_TOILETS: Toilet[] = []
// Ditto for the "P" markers.
const NO_CAR_PARKS: CarPark[] = []
// And for the ~1,100 waste and recycling pins, pushed on array identity too.
const NO_WASTE: WasteSite[] = []
// Stable "nothing extra" bag for the layer-off case, for the same identity
// reason as the empty arrays above.
const NO_WASTE_EXTRAS: WasteExtras = {}
// And for the water overlay, which pushes THREE sources (surfaces, blocks,
// markers) on one array identity — a fresh `[]` would rebuild all three.
const NO_WATER_FACILITIES: WaterFacility[] = []
// And the same for the electricity overlay, which pushes blocks, markers and
// the HV lines off one array identity.
const NO_POWER_FACILITIES: PowerFacility[] = []
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
  //
  // Everything App decides by the time is minute-resolution (service windows,
  // the day's flights, the timetable, the road-works day), so App subscribes
  // to the clock at the MINUTE: one re-render per simulated minute instead of
  // ten a second. The clock face and the scrubber subscribe to the tick on
  // their own (useClockTime).
  const simTime = useClockMinute(clock)
  const currentScheduleType = getScheduleType(simTime)
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
  // Either kind of waste mark — a collection point or the incineration plant.
  // One slot, because the two share a marker layer, a highlight and the
  // one-panel-at-a-time rule; only the panel that opens differs.
  const [selectedWasteSite, setSelectedWasteSite] = useState<WasteSelection | null>(null)
  const [selectedWaterFacility, setSelectedWaterFacility] = useState<WaterFacility | null>(null)
  // A node of the schematic pipe network — today only the Zhuhai raw-water
  // inlet. Its own slot rather than a widened `selectedWaterFacility`, because
  // it is not one of Macao Water's 22 and gets a different panel.
  const [selectedWaterNode, setSelectedWaterNode] = useState<WaterNetworkNode | null>(null)
  const [selectedPowerFacility, setSelectedPowerFacility] = useState<PowerFacility | null>(null)
  // A node of the schematic HV network — the three Guangdong import points.
  // Its own slot rather than a widened `selectedPowerFacility`, because an
  // inlet is not a CEM facility and gets a different panel.
  const [selectedPowerNode, setSelectedPowerNode] = useState<PowerNetworkNode | null>(null)
  const [selectedGrandPrix, setSelectedGrandPrix] = useState<GrandPrixSelection | null>(null)
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
  // Waste and recycling points — opt-in like every other CITY overlay, and the
  // most so: ~1,100 pins would bury the map until someone asks for them.
  const [wasteOn, setWasteOn] = useState(() => localStorage.getItem(LS_WASTE_KEY) === '1')
  // WASTE is the THIRD focus mode, mutually exclusive with water and power: it
  // gets its own snapshot slot, seeded from its own storage key like theirs.
  const wasteFocusSnapshotRef = useRef<LayerVisibilityState | null>(loadFocusSnapshot('waste'))
  // Which of the six site types are HIDDEN. Independent of `wasteOn`, which is
  // the master switch for the whole layer. Stored as the hidden set so a type
  // added later shows up by default (see src/waste.ts).
  const [wasteHiddenTypes, setWasteHiddenTypes] = useState<WasteTypeSet>(loadHiddenWasteTypes)
  // Water facilities are opt-in like the rest of the CITY page: 22 markers plus
  // three reservoir fills are infrastructure trivia until asked for, so `=== '1'`.
  const [waterOn, setWaterOn] = useState(() => localStorage.getItem(LS_WATER_KEY) === '1')
  // The layer state to put back when water focus ends. Seeded from storage so a
  // reload with water already on (nothing to snapshot at that point — every
  // other layer is already off) still restores the pre-focus map later.
  const waterFocusSnapshotRef = useRef<LayerVisibilityState | null>(loadFocusSnapshot('water'))
  // Electricity is the second focus mode, and MUTUALLY EXCLUSIVE with water:
  // turning either on takes the other off (handing the snapshot over) so the
  // map only ever hides the city for one of them. Same opt-in default, same
  // `=== '1'`, and its own snapshot slot seeded from its own storage key.
  const [powerOn, setPowerOn] = useState(() => localStorage.getItem(LS_POWER_KEY) === '1')
  const powerFocusSnapshotRef = useRef<LayerVisibilityState | null>(loadFocusSnapshot('power'))
  // The Guia Circuit is the FOURTH focus mode, on exactly the terms of the
  // three above: opt-in, its own key, its own snapshot slot, and mutually
  // exclusive with them.
  const [grandPrixOn, setGrandPrixOn] = useState(() => localStorage.getItem(LS_GRANDPRIX_KEY) === '1')
  const grandPrixFocusSnapshotRef = useRef<LayerVisibilityState | null>(loadFocusSnapshot('grandprix'))
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
  useEffect(() => { localStorage.setItem(LS_WASTE_KEY, wasteOn ? '1' : '0') }, [wasteOn])
  useEffect(() => { saveHiddenWasteTypes(wasteHiddenTypes) }, [wasteHiddenTypes])
  useEffect(() => { localStorage.setItem(LS_WATER_KEY, waterOn ? '1' : '0') }, [waterOn])
  useEffect(() => { localStorage.setItem(LS_POWER_KEY, powerOn ? '1' : '0') }, [powerOn])
  useEffect(() => { localStorage.setItem(LS_GRANDPRIX_KEY, grandPrixOn ? '1' : '0') }, [grandPrixOn])
  useEffect(() => { saveSchoolLevelsOn(schoolLevelsOn) }, [schoolLevelsOn])
  // Hiding the layer must also close its panel — the marker it describes is
  // gone from the map.
  useEffect(() => { if (!roadWorksOn) setSelectedRoadWork(null) }, [roadWorksOn])
  useEffect(() => { if (!schoolsOn) setSelectedSchool(null) }, [schoolsOn])
  useEffect(() => { if (!toiletsOn) setSelectedToilet(null) }, [toiletsOn])
  useEffect(() => { if (!carParksOn) setSelectedCarPark(null) }, [carParksOn])
  useEffect(() => { if (!wasteOn) setSelectedWasteSite(null) }, [wasteOn])
  // Same rule one level down: hiding a site type removes those markers, so a
  // panel describing one of them has to close too.
  useEffect(() => {
    setSelectedWasteSite(prev =>
      (prev && wasteHiddenTypes.has(wasteSelectionType(prev)) ? null : prev))
  }, [wasteHiddenTypes])
  useEffect(() => {
    if (waterOn) return
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
  }, [waterOn])
  useEffect(() => {
    if (powerOn) return
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
  }, [powerOn])
  useEffect(() => { if (!grandPrixOn) setSelectedGrandPrix(null) }, [grandPrixOn])
  // Same rule one level down: switching off a teaching stage removes those
  // blocks, so a panel describing one of them has to close too.
  useEffect(() => {
    setSelectedSchool(prev => (prev && !schoolLevelsOn.has(prev.school.level) ? null : prev))
  }, [schoolLevelsOn])
  useEffect(() => { localStorage.setItem(LS_LRT_KEY, JSON.stringify([...lrtOn])) }, [lrtOn])

  const currentHour = macauHours(simTime)
  const currentMinute = macauMinutes(simTime)

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
          .filter(r => !inactiveRoutes.has(r.id) && isRouteInService(r, simTime))
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
    () => transitData.getFlightsForDate(simTime),
    [transitData, simTime]
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

  // Same reasoning as `visibleSchools`: MapView pushes the waste markers on
  // ARRAY IDENTITY, so this must only change when the master switch, the hidden
  // set or the data itself does — not on every clock tick.
  const visibleWaste = useMemo(
    () => (wasteOn ? visibleWasteSites(transitData.waste, wasteHiddenTypes) : NO_WASTE),
    [transitData.waste, wasteOn, wasteHiddenTypes]
  )

  // The incineration plant. It is not in waste.json: it is the `incinerator`
  // record of power-facilities.json, already loaded at startup, read here from
  // the UNFILTERED data (the POWER layer nulls its own copy out when off).
  const incinerator = useMemo(
    () => wasteIncinerator(transitData.powerFacilities),
    [transitData.powerFacilities]
  )

  // What MapView actually draws besides the collection points: the plant, the
  // eco stations and the treatment facilities, each only while WASTE is on and
  // its key row is not switched off. Emptying a slot is what removes its marks —
  // and for the facilities, its landfill polygons too. Memoised as ONE object
  // because MapView pushes all three sources on this identity.
  const wasteExtras = useMemo<WasteExtras>(() => (wasteOn ? {
    incinerator: visibleWasteIncinerator(incinerator, wasteHiddenTypes),
    ecoStations: visibleWasteEcoStations(transitData.wasteEcoStations, wasteHiddenTypes),
    facilities: visibleWasteFacilities(transitData.wasteFacilities, wasteHiddenTypes),
  } : NO_WASTE_EXTRAS), [
    incinerator, transitData.wasteEcoStations, transitData.wasteFacilities,
    wasteOn, wasteHiddenTypes,
  ])

  // Per-type totals for the legend, from the UNFILTERED data — the key rows show
  // how many marks each row stands for, not how many are currently drawn. The
  // last two rows come from the POWER record and the two extra blocks.
  const wasteTypeCounts = useMemo(
    () => countWasteByType(transitData.waste, {
      incinerator,
      ecoStations: transitData.wasteEcoStations,
      facilities: transitData.wasteFacilities,
    }),
    [transitData.waste, incinerator, transitData.wasteEcoStations, transitData.wasteFacilities]
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
    waste: visibleWaste,
    waterFacilities: waterOn ? transitData.waterFacilities : NO_WATER_FACILITIES,
    // The pipes go with the facilities: null empties the pipe source and drops
    // the inlet marker, exactly as the empty array empties the other three.
    waterNetwork: waterOn ? transitData.waterNetwork : null,
    powerFacilities: powerOn ? transitData.powerFacilities : NO_POWER_FACILITIES,
    // Same rule for the HV lines and the Guangdong import markers.
    powerNetwork: powerOn ? transitData.powerNetwork : null,
    // And for the circuit: null empties the track, the corners, the pulse and
    // takes the car off.
    grandPrix: grandPrixOn ? transitData.grandPrix : null,
  }), [transitData, visibleRoutes, lrtOn, flightsOn, dateAwareFlights, ferriesOn, roadWorksOn, visibleSchools, toiletsOn, carParksOn, visibleWaste, waterOn, powerOn, grandPrixOn])

  // Macau's streets, for the thin distribution pipes. Fetched the first time
  // WATER goes on and kept for the session — the hook ignores later toggles, so
  // switching the layer off and on again costs no second request. Passed
  // straight to MapView rather than through TransitData: it is a lazily loaded
  // extra, not part of the pipeline contract the simulation reads.
  const waterDistribution = useWaterDistribution(waterOn)

  // The same streets again, oriented outward from the substations instead —
  // fetched the first time POWER goes on and kept for the session, exactly like
  // its water twin.
  const powerDistribution = usePowerDistribution(powerOn)

  // Live car-park vacancy. Polled ONLY while the layer is on AND the clock
  // runs at 1× — at any other speed the simulated moment is not "now", so a
  // real-time count would be telling the user something false. The hook adds
  // the third condition (tab visible) and does the 30 s interval.
  const carParkVacancy = useCarParkVacancy(carParksOn && clock.isLive)

  // Notices in force on the simulated Macau calendar day. Keyed on the day
  // string, NOT on the minute — the count only changes at midnight.
  const simYmd = macauYmd(simTime)
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
        .filter(r => !inactiveRoutes.has(r.id) && isRouteInService(r, simTime))
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
        if (isRouteInService(r, simTime)) next.add(r.id)
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
  }, [transitData.busRoutes, inactiveRoutes, simTime, visibleRoutes])

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
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
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
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
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
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
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
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
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
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
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
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
    setTrackedVehicleId(null)
  }, [])

  // Waste and recycling pins, same exclusivity rule.
  const onWasteSiteClick = useCallback((selection: WasteSelection | null) => {
    setSelectedWasteSite(selection)
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
    setTrackedVehicleId(null)
  }, [])

  // Water facilities — reached from either the droplet marker or the coloured
  // block, and mutually exclusive with everything above like the rest.
  const onWaterFacilityClick = useCallback((facility: WaterFacility | null) => {
    setSelectedWaterFacility(facility)
    setSelectedWaterNode(null)
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setSelectedWasteSite(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
    setTrackedVehicleId(null)
  }, [])

  // A node of the pipe network (the Zhuhai inlet). Shares the marker layer with
  // the facilities, so it follows the same one-panel-at-a-time rule.
  const onWaterNodeClick = useCallback((node: WaterNetworkNode | null) => {
    setSelectedWaterNode(node)
    setSelectedWaterFacility(null)
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setSelectedWasteSite(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
    setTrackedVehicleId(null)
  }, [])

  // Electricity facilities — reached from either the bolt marker or the
  // coloured block, and mutually exclusive with everything above like the rest.
  const onPowerFacilityClick = useCallback((facility: PowerFacility | null) => {
    setSelectedPowerFacility(facility)
    setSelectedPowerNode(null)
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setTrackedVehicleId(null)
  }, [])

  // A node of the HV network (a Guangdong import point). Shares the marker
  // layer with the facilities, so it follows the same one-panel rule.
  const onPowerNodeClick = useCallback((node: PowerNetworkNode | null) => {
    setSelectedPowerNode(node)
    setSelectedPowerFacility(null)
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setTrackedVehicleId(null)
  }, [])

  // The circuit's corners and the racing line. GRAND PRIX is a focus mode, so
  // nothing else is on the map while it is on — the other panels are cleared
  // all the same, for the one-panel rule every handler above keeps.
  const onGrandPrixCornerClick = useCallback((corner: GrandPrixCorner | null) => {
    setSelectedGrandPrix(corner ? { kind: 'corner', corner } : null)
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
    setTrackedVehicleId(null)
  }, [])

  const onGrandPrixCircuitClick = useCallback(() => {
    setSelectedGrandPrix({ kind: 'circuit' })
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
    setTrackedVehicleId(null)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedVehicle(null)
    setSelectedStation(null)
    setSelectedRoadWork(null)
    setSelectedSchool(null)
    setSelectedToilet(null)
    setSelectedCarPark(null)
    setSelectedWasteSite(null)
    setSelectedWaterFacility(null)
    setSelectedWaterNode(null)
    setSelectedPowerFacility(null)
    setSelectedPowerNode(null)
    setSelectedGrandPrix(null)
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
  // One of the nine key rows. Stored as the HIDDEN set, so "toggle" adds or
  // removes the row there — see src/waste.ts for why hidden rather than shown.
  const toggleWasteType = useCallback((type: WasteLayerType) => {
    setWasteHiddenTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      ga.layerToggled(`waste_${type}`, !next.has(type))
      return next
    })
  }, [])

  // The setters the water focus mode drives. Bus visibility is set as one
  // operation (routes + mode) and mirrored into its own localStorage key the
  // same way the manual controls do it, so a reload during focus mode reads a
  // consistent "buses off" — the snapshot is what restores it, not that key.
  const layerApply = useMemo<LayerVisibilityApply>(() => ({
    setLrt: ids => setLrtOn(new Set(ids)),
    setBus: (routeIds, auto) => {
      const next = new Set(routeIds)
      if (auto) clearSavedRoutes()
      else saveRoutes(next)
      setVisibleRoutes(next)
      setIsAutoMode(auto)
    },
    setFlights: setFlightsOn,
    setFerries: setFerriesOn,
    setRoadWorks: setRoadWorksOn,
    setSchools: setSchoolsOn,
    setToilets: setToiletsOn,
    setCarParks: setCarParksOn,
  }), [])

  // Everything a focus mode has to remember, as it stands right now. Read only
  // at click time (never rendered), so this is just the one place the live
  // switches are collected into the shape focusMode.ts speaks.
  const liveLayerState = useMemo<LayerVisibilityState>(() => ({
    lrt: [...lrtOn],
    busAuto: isAutoMode,
    busRoutes: [...visibleRoutes],
    flights: flightsOn,
    ferries: ferriesOn,
    roadWorks: roadWorksOn,
    schools: schoolsOn,
    toilets: toiletsOn,
    carParks: carParksOn,
  }), [lrtOn, isAutoMode, visibleRoutes, flightsOn, ferriesOn, roadWorksOn, schoolsOn, toiletsOn, carParksOn])

  // WATER, POWER and WASTE are focus modes: switching one on snapshots every
  // other layer and clears them, switching it off puts that exact snapshot back
  // — even if the user flipped other switches in between. Each snapshot lives in
  // a ref seeded from its own localStorage key, so a reload while a focus mode
  // is on still restores correctly afterwards.
  //
  // The three are MUTUALLY EXCLUSIVE. Turning one on while another is focused
  // ends that focus (which would restore its snapshot) and immediately
  // re-hides everything, so what the new layer must remember is the OTHER
  // layer's snapshot — see focusHandoffSnapshot, which is that composition
  // written down once instead of pushed through a React render, and
  // activeFocusPeer, which names the at-most-one layer it applies to.
  const setFocus = useCallback((layer: FocusLayer, on: boolean) => {
    const refFor = (l: FocusLayer) =>
      l === 'water' ? waterFocusSnapshotRef
        : l === 'power' ? powerFocusSnapshotRef
          : l === 'waste' ? wasteFocusSnapshotRef
            : grandPrixFocusSnapshotRef
    const setOnFor = (l: FocusLayer) =>
      l === 'water' ? setWaterOn
        : l === 'power' ? setPowerOn
          : l === 'waste' ? setWasteOn
            : setGrandPrixOn
    const isOn = (l: FocusLayer) =>
      l === 'water' ? waterOn
        : l === 'power' ? powerOn
          : l === 'waste' ? wasteOn
            : grandPrixOn
    const selfRef = refFor(layer)
    ga.layerToggled(layer, on)
    if (on) {
      const peer = activeFocusPeer(
        FOCUS_LAYERS.filter(l => l !== layer).map(l => ({
          layer: l, on: isOn(l), snapshot: refFor(l).current,
        }))
      )
      const snapshot = focusHandoffSnapshot(liveLayerState, peer?.snapshot ?? null, !!peer)
      if (peer) {
        refFor(peer.layer).current = null
        saveFocusSnapshot(peer.layer, null)
        setOnFor(peer.layer)(false)
      }
      selfRef.current = snapshot
      saveFocusSnapshot(layer, snapshot)
      applyFocusMode(layerApply)
    } else {
      const snapshot = selfRef.current
      if (snapshot) applyLayerSnapshot(snapshot, layerApply)
      selfRef.current = null
      saveFocusSnapshot(layer, null)
    }
    setOnFor(layer)(on)
  }, [liveLayerState, waterOn, powerOn, wasteOn, grandPrixOn, layerApply])

  const toggleWater = useCallback(() => setFocus('water', !waterOn), [setFocus, waterOn])
  const togglePower = useCallback(() => setFocus('power', !powerOn), [setFocus, powerOn])
  const toggleWaste = useCallback(() => setFocus('waste', !wasteOn), [setFocus, wasteOn])
  const toggleGrandPrix = useCallback(() => setFocus('grandprix', !grandPrixOn), [setFocus, grandPrixOn])
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

  // The utility focus modes take the clock UI off the screen (nothing on them
  // has a time dimension), so they lock the keyboard shortcut and hide the
  // time controls below. GRAND PRIX is the exception: the car laps on the
  // simulation clock, and the speed buttons are how a two-minute lap becomes
  // watchable — so that mode keeps the clock.
  const clockHidden = waterOn || powerOn || wasteOn

  const { togglePause } = clock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isTextEntry =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      // Locked during a focus mode, exactly like the buttons — otherwise the
      // one control that ISN'T dimmed would still pause the clock.
      if (ignoreClockShortcut(clockHidden, isTextEntry)) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePause()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePause, clockHidden])

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
            onWasteSiteClick={onWasteSiteClick}
            wasteFocus={wasteOn}
            wasteExtras={wasteExtras}
            onWaterFacilityClick={onWaterFacilityClick}
            onWaterNodeClick={onWaterNodeClick}
            waterFocus={waterOn}
            waterDistributionRoads={waterDistribution?.roads ?? null}
            onPowerFacilityClick={onPowerFacilityClick}
            onPowerNodeClick={onPowerNodeClick}
            powerFocus={powerOn}
            powerDistributionRoads={powerDistribution?.roads ?? null}
            onGrandPrixCornerClick={onGrandPrixCornerClick}
            onGrandPrixCircuitClick={onGrandPrixCircuitClick}
            grandPrixFocus={grandPrixOn}
            carParkVacancy={carParkVacancy.vacancy}
            onClearSelection={clearSelection}
            trackedVehicleId={trackedVehicleId}
            selectedRoadWorkId={selectedRoadWork?.id ?? null}
            selectedSchoolId={selectedSchool?.school.id ?? null}
            selectedToiletId={selectedToilet?.id ?? null}
            selectedCarParkId={selectedCarPark?.id ?? null}
            selectedWasteSiteId={wasteSelectionId(selectedWasteSite)}
            selectedWaterFacilityId={selectedWaterFacility?.id ?? null}
            selectedWaterNodeId={selectedWaterNode?.id ?? null}
            selectedPowerFacilityId={selectedPowerFacility?.id ?? null}
            selectedPowerNodeId={selectedPowerNode?.id ?? null}
            selectedGrandPrixCornerId={selectedGrandPrix?.kind === 'corner' ? selectedGrandPrix.corner.id : null}
            onVehicleCount={onVehicleCount}
            showTimeBar={showTimeBar}
            onToggleTimeBar={toggleTimeBar}
          />
        </Suspense>
      ) : (
        <MapSplash />
      )}
      {/* Either focus mode takes the clock UI OFF the screen. Neither the
          supply network nor the grid has a time dimension — nothing on them
          moves, nothing about them differs between 03:00 and 18:00 — so a clock
          and a scrubber would only invite the user to drive something that
          changes nothing they can see. Unmounted rather than hidden, and the
          state that matters survives it: the clock itself lives in this
          component and keeps ticking, and the bar's expanded/collapsed choice
          is persisted (`mm_tl_expanded`), so both come back exactly as they
          were when the focus mode goes off. */}
      {showTimeBar && !clockHidden && (
        <TimeDisplay clock={clock} vehicleCount={vehicleCount} />
      )}
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
        wasteOn={wasteOn}
        wasteHiddenTypes={wasteHiddenTypes}
        wasteTypeCounts={wasteTypeCounts}
        waterOn={waterOn}
        powerOn={powerOn}
        grandPrixOn={grandPrixOn}
        clock={clock}
        onToggleLrt={toggleLrt}
        onToggleFlights={toggleFlights}
        onToggleFerries={toggleFerries}
        onToggleRoadWorks={toggleRoadWorks}
        onToggleSchools={toggleSchools}
        onToggleSchoolLevel={toggleSchoolLevel}
        onToggleToilets={toggleToilets}
        onToggleCarParks={toggleCarParks}
        onToggleWaste={toggleWaste}
        onToggleWasteType={toggleWasteType}
        onToggleWater={toggleWater}
        onTogglePower={togglePower}
        onToggleGrandPrix={toggleGrandPrix}
        onToggleRoute={onToggleRoute}
        onToggleAll={onToggleAll}
        onShowAll={onShowAll}
        onHideAll={onHideAll}
        onToggleGroup={onToggleGroup}
        onResetAuto={onResetAuto}
      />
      {!clockHidden && <ControlPanel clock={clock} />}
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
        {selectedWasteSite?.kind === 'site' && (
          <WasteSiteInfoPanel
            site={selectedWasteSite.site}
            // The UNFILTERED source list: the panel names the dataset a site
            // came from, which is provenance rather than something the type
            // toggles narrow.
            sources={transitData.wasteSources}
            onClose={clearSelection}
          />
        )}
        {selectedWasteSite?.kind === 'incinerator' && (
          <WasteIncineratorInfoPanel
            facility={selectedWasteSite.facility}
            stats={transitData.dspaStats}
            onClose={clearSelection}
          />
        )}
        {selectedWasteSite?.kind === 'ecoStation' && (
          <WasteEcoStationInfoPanel
            station={selectedWasteSite.station}
            onClose={clearSelection}
          />
        )}
        {selectedWasteSite?.kind === 'facility' && (
          <WasteFacilityInfoPanel
            facility={selectedWasteSite.facility}
            stats={transitData.dspaStats}
            onClose={clearSelection}
          />
        )}
        {selectedWaterFacility && (
          <WaterFacilityInfoPanel
            facility={selectedWaterFacility}
            // The UNFILTERED list: an approximate marker names the facility it
            // sits at, which may not be one the panel's own filter kept.
            facilities={transitData.waterFacilities}
            network={transitData.waterNetwork}
            onClose={clearSelection}
          />
        )}
        {selectedWaterNode && (
          <WaterInletInfoPanel
            node={selectedWaterNode}
            network={transitData.waterNetwork}
            onClose={clearSelection}
          />
        )}
        {selectedPowerFacility && (
          <PowerFacilityInfoPanel
            facility={selectedPowerFacility}
            // The UNFILTERED list: an approximate marker names the facility it
            // sits at, which may not be one the panel's own filter kept.
            facilities={transitData.powerFacilities}
            network={transitData.powerNetwork}
            onClose={clearSelection}
          />
        )}
        {selectedPowerNode && (
          <PowerInletInfoPanel
            node={selectedPowerNode}
            network={transitData.powerNetwork}
            onClose={clearSelection}
          />
        )}
        {selectedGrandPrix?.kind === 'circuit' && transitData.grandPrix && (
          <GrandPrixCircuitInfoPanel
            circuit={transitData.grandPrix}
            sources={transitData.grandPrixSources}
            onClose={clearSelection}
          />
        )}
        {selectedGrandPrix?.kind === 'corner' && transitData.grandPrix && (
          <GrandPrixCornerInfoPanel
            corner={selectedGrandPrix.corner}
            circuit={transitData.grandPrix}
            sources={transitData.grandPrixSources}
            onClose={clearSelection}
          />
        )}
      </Suspense>
    </div>
  )
}
