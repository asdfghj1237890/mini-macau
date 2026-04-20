import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { LineLegend } from './components/LineLegend'
import { TimeDisplay } from './components/TimeDisplay'
import { MapSplash } from './components/MapSplash'
import { useSimulationClock } from './hooks/useSimulationClock'
import { useTransitData } from './hooks/useTransitData'
import { useServiceStatus } from './hooks/useServiceStatus'
import type { VehiclePosition, Station, BusRoute } from './types'

// Inject a preconnect <link> once — timed at the moment MapView starts
// loading, so the TCP/TLS handshake races alongside the MapLibre chunk
// download instead of sitting idle in <head> (where it expires before
// the lazy chunk even finishes).
function preconnect(href: string) {
  if (typeof document === 'undefined') return
  if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = href
  link.crossOrigin = ''
  document.head.appendChild(link)
}

// MapView pulls in the ~1 MB maplibre-gl bundle; lazy so it doesn't block
// first paint. The <MapSplash/> fallback keeps the HUD interactive while
// MapLibre parses.
const MapView = lazy(() => {
  // Warm up sockets for CARTO basemap style + OpenFreeMap building tiles
  // right before MapLibre starts fetching them.
  preconnect('https://basemaps.cartocdn.com')
  preconnect('https://tiles.openfreemap.org')
  return import('./components/MapView').then(m => ({ default: m.MapView }))
})
const VehicleInfoPanel = lazy(() => import('./components/VehicleInfoPanel').then(m => ({ default: m.VehicleInfoPanel })))
const StationInfoPanel = lazy(() => import('./components/StationInfoPanel').then(m => ({ default: m.StationInfoPanel })))
const FlightInfoPanel = lazy(() => import('./components/FlightInfoPanel').then(m => ({ default: m.FlightInfoPanel })))
const FerryInfoPanel = lazy(() => import('./components/FerryInfoPanel').then(m => ({ default: m.FerryInfoPanel })))

const LS_KEY = 'mini-macau-visible-routes'

// Keep a route considered in-service for up to SERVICE_TAIL_MIN past its
// scheduled end, so buses still finishing their last trip don't vanish.
const SERVICE_TAIL_MIN = 60

function isRouteInService(route: BusRoute, date: Date): boolean {
  const nowMin = date.getHours() * 60 + date.getMinutes()
  const useSun = date.getDay() === 0
    && route.serviceHoursStartSun !== undefined
    && route.serviceHoursEndSun !== undefined
  const start = useSun ? route.serviceHoursStartSun! : route.serviceHoursStart
  const end = useSun ? route.serviceHoursEndSun! : route.serviceHoursEnd
  const startMin = start * 60
  let endWithTail = end * 60 + SERVICE_TAIL_MIN
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
const LS_TIMEBAR_KEY = 'mini-macau-time-bar'

export default function App() {
  const clock = useSimulationClock()
  const transitData = useTransitData()
  const serviceStatus = useServiceStatus()
  const [visibleRoutes, setVisibleRoutes] = useState<Set<string>>(new Set())
  const [isAutoMode, setIsAutoMode] = useState(() => loadSavedRoutes() === null)
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null)
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  const [trackedVehicleId, setTrackedVehicleId] = useState<string | null>(null)
  const [vehicleCount, setVehicleCount] = useState(0)
  const [showTimeBar, setShowTimeBar] = useState(() => localStorage.getItem(LS_TIMEBAR_KEY) !== '0')
  const [flightsOn, setFlightsOn] = useState(() => localStorage.getItem(LS_FLIGHTS_KEY) !== '0')
  const [ferriesOn, setFerriesOn] = useState(() => localStorage.getItem(LS_FERRIES_KEY) !== '0')
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
  useEffect(() => { localStorage.setItem(LS_LRT_KEY, JSON.stringify([...lrtOn])) }, [lrtOn])

  const currentHour = clock.currentTime.getHours()
  const currentMinute = clock.currentTime.getMinutes()

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

  const filteredTransitData = useMemo(() => ({
    ...transitData,
    busRoutes: transitData.busRoutes.filter(r => visibleRoutes.has(r.id)),
    lrtLines: transitData.lrtLines.filter(l => lrtOn.has(l.id)),
    flights: flightsOn ? transitData.flights : [],
    ferries: ferriesOn ? transitData.ferries : [],
  }), [transitData, visibleRoutes, lrtOn, flightsOn, ferriesOn])

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

  const onResetAuto = useCallback(() => {
    clearSavedRoutes()
    setIsAutoMode(true)
  }, [])

  const onVehicleClick = useCallback((vehicle: VehiclePosition | null) => {
    setSelectedVehicle(vehicle)
    setSelectedStation(null)
    setTrackedVehicleId(vehicle?.id ?? null)
  }, [])

  const onTrackedVehicleUpdate = useCallback((vehicle: VehiclePosition) => {
    setSelectedVehicle(prev => (prev && prev.id === vehicle.id ? vehicle : prev))
  }, [])

  const onStationClick = useCallback((station: Station | null) => {
    setSelectedStation(station)
    setSelectedVehicle(null)
    setTrackedVehicleId(null)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedVehicle(null)
    setSelectedStation(null)
    setTrackedVehicleId(null)
  }, [])

  const toggleLrt = useCallback((id: string) => {
    setLrtOn(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleFlights = useCallback(() => setFlightsOn(v => !v), [])
  const toggleFerries = useCallback(() => setFerriesOn(v => !v), [])
  const toggleTimeBar = useCallback(() => setShowTimeBar(v => !v), [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        clock.togglePause()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clock.togglePause])

  return (
    <div className="relative w-full h-full">
      <Suspense fallback={<MapSplash />}>
        <MapView
          clock={clock}
          transitData={filteredTransitData}
          allTransitData={transitData}
          onVehicleClick={onVehicleClick}
          onTrackedVehicleUpdate={onTrackedVehicleUpdate}
          onStationClick={onStationClick}
          onClearSelection={clearSelection}
          trackedVehicleId={trackedVehicleId}
          onVehicleCount={onVehicleCount}
          showTimeBar={showTimeBar}
          onToggleTimeBar={toggleTimeBar}
        />
      </Suspense>
      {showTimeBar && <TimeDisplay clock={clock} vehicleCount={vehicleCount} />}
      <LineLegend
        transitData={filteredTransitData}
        allTransitData={transitData}
        visibleRoutes={visibleRoutes}
        inactiveRoutes={inactiveRoutes}
        isAutoMode={isAutoMode}
        lrtOn={lrtOn}
        flightsOn={flightsOn}
        ferriesOn={ferriesOn}
        clock={clock}
        onToggleLrt={toggleLrt}
        onToggleFlights={toggleFlights}
        onToggleFerries={toggleFerries}
        onToggleRoute={onToggleRoute}
        onToggleAll={onToggleAll}
        onShowAll={onShowAll}
        onHideAll={onHideAll}
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
      </Suspense>
    </div>
  )
}
