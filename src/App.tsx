import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react'
import { MapView } from './components/MapView'
import { ControlPanel } from './components/ControlPanel'
import { LineLegend } from './components/LineLegend'
import { TimeDisplay } from './components/TimeDisplay'
import { useSimulationClock } from './hooks/useSimulationClock'
import { useTransitData } from './hooks/useTransitData'
import type { VehiclePosition, Station, BusRoute } from './types'

const VehicleInfoPanel = lazy(() => import('./components/VehicleInfoPanel').then(m => ({ default: m.VehicleInfoPanel })))
const StationInfoPanel = lazy(() => import('./components/StationInfoPanel').then(m => ({ default: m.StationInfoPanel })))
const FlightInfoPanel = lazy(() => import('./components/FlightInfoPanel').then(m => ({ default: m.FlightInfoPanel })))

const LS_KEY = 'mini-macau-visible-routes'

function isRouteInService(route: BusRoute, hour: number): boolean {
  if (route.serviceHoursStart <= route.serviceHoursEnd) {
    return hour >= route.serviceHoursStart && hour < route.serviceHoursEnd
  }
  return hour >= route.serviceHoursStart || hour < route.serviceHoursEnd
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
const LS_TIMEBAR_KEY = 'mini-macau-time-bar'

export default function App() {
  const clock = useSimulationClock()
  const transitData = useTransitData()
  const [visibleRoutes, setVisibleRoutes] = useState<Set<string>>(new Set())
  const [isAutoMode, setIsAutoMode] = useState(() => loadSavedRoutes() === null)
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null)
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  const [trackedVehicleId, setTrackedVehicleId] = useState<string | null>(null)
  const [vehicleCount, setVehicleCount] = useState(0)
  const [showTimeBar, setShowTimeBar] = useState(() => localStorage.getItem(LS_TIMEBAR_KEY) !== '0')
  const [flightsOn, setFlightsOn] = useState(() => localStorage.getItem(LS_FLIGHTS_KEY) !== '0')
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
  useEffect(() => { localStorage.setItem(LS_LRT_KEY, JSON.stringify([...lrtOn])) }, [lrtOn])

  const currentHour = clock.currentTime.getHours()

  useEffect(() => {
    if (transitData.busRoutes.length === 0) return

    if (!initedRef.current) {
      initedRef.current = true
      const saved = loadSavedRoutes()
      if (saved) {
        const valid = new Set(transitData.busRoutes.map(r => r.id))
        setVisibleRoutes(new Set(saved.filter(id => valid.has(id))))
        setIsAutoMode(false)
        return
      }
    }

    if (isAutoMode) {
      setVisibleRoutes(new Set(
        transitData.busRoutes
          .filter(r => isRouteInService(r, currentHour))
          .map(r => r.id)
      ))
    }
  }, [transitData.busRoutes.length, currentHour, isAutoMode])

  const filteredTransitData = useMemo(() => ({
    ...transitData,
    busRoutes: transitData.busRoutes.filter(r => visibleRoutes.has(r.id)),
    lrtLines: transitData.lrtLines.filter(l => lrtOn.has(l.id)),
    flights: flightsOn ? transitData.flights : [],
  }), [transitData, visibleRoutes, lrtOn, flightsOn])

  const onVehicleCount = useCallback((count: number) => {
    setVehicleCount(count)
  }, [])

  const onToggleRoute = useCallback((routeId: string) => {
    setVisibleRoutes(prev => {
      const next = new Set(prev)
      if (next.has(routeId)) next.delete(routeId)
      else next.add(routeId)
      saveRoutes(next)
      return next
    })
    setIsAutoMode(false)
  }, [])

  const onToggleAll = useCallback(() => {
    setVisibleRoutes(prev => {
      const next = prev.size === transitData.busRoutes.length
        ? new Set<string>()
        : new Set(transitData.busRoutes.map(r => r.id))
      saveRoutes(next)
      return next
    })
    setIsAutoMode(false)
  }, [transitData.busRoutes])

  const onShowAll = useCallback(() => {
    const next = new Set(transitData.busRoutes.map(r => r.id))
    saveRoutes(next)
    setVisibleRoutes(next)
    setIsAutoMode(false)
  }, [transitData.busRoutes])

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
      {showTimeBar && <TimeDisplay clock={clock} vehicleCount={vehicleCount} />}
      <LineLegend
        transitData={filteredTransitData}
        allTransitData={transitData}
        visibleRoutes={visibleRoutes}
        isAutoMode={isAutoMode}
        lrtOn={lrtOn}
        flightsOn={flightsOn}
        clock={clock}
        onToggleLrt={toggleLrt}
        onToggleFlights={toggleFlights}
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
        {selectedVehicle && selectedVehicle.type !== 'flight' && (
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
