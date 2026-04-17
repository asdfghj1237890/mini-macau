import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react'
import { MapView } from './components/MapView'
import { ControlPanel } from './components/ControlPanel'
import { LineLegend } from './components/LineLegend'
import { TimeDisplay } from './components/TimeDisplay'
import { useSimulationClock } from './hooks/useSimulationClock'
import { useTransitData } from './hooks/useTransitData'
import type { VehiclePosition, Station, BusRoute } from './types'

const RouteSelector = lazy(() => import('./components/RouteSelector').then(m => ({ default: m.RouteSelector })))
const VehicleInfoPanel = lazy(() => import('./components/VehicleInfoPanel').then(m => ({ default: m.VehicleInfoPanel })))
const StationInfoPanel = lazy(() => import('./components/StationInfoPanel').then(m => ({ default: m.StationInfoPanel })))

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

export default function App() {
  const clock = useSimulationClock()
  const transitData = useTransitData()
  const [visibleRoutes, setVisibleRoutes] = useState<Set<string>>(new Set())
  const [isAutoMode, setIsAutoMode] = useState(() => loadSavedRoutes() === null)
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null)
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  const [trackedVehicleId, setTrackedVehicleId] = useState<string | null>(null)
  const [vehicleCount, setVehicleCount] = useState(0)
  const initedRef = useRef(false)

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
  }), [transitData, visibleRoutes])

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

  const onResetAuto = useCallback(() => {
    clearSavedRoutes()
    setIsAutoMode(true)
  }, [])

  const onVehicleClick = useCallback((vehicle: VehiclePosition | null) => {
    setSelectedVehicle(vehicle)
    setSelectedStation(null)
    setTrackedVehicleId(vehicle?.id ?? null)
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

  return (
    <div className="relative w-full h-full">
      <MapView
        clock={clock}
        transitData={filteredTransitData}
        allTransitData={transitData}
        onVehicleClick={onVehicleClick}
        onStationClick={onStationClick}
        onClearSelection={clearSelection}
        trackedVehicleId={trackedVehicleId}
        onVehicleCount={onVehicleCount}
      />
      <TimeDisplay clock={clock} vehicleCount={vehicleCount} />
      <ControlPanel clock={clock} />
      <LineLegend
        transitData={filteredTransitData}
        allTransitData={transitData}
        visibleRoutes={visibleRoutes}
        isAutoMode={isAutoMode}
        onToggleRoute={onToggleRoute}
        onToggleAll={onToggleAll}
        onResetAuto={onResetAuto}
      />
      <Suspense>
        <RouteSelector
          transitData={transitData}
          visibleRoutes={visibleRoutes}
          isAutoMode={isAutoMode}
          onToggleRoute={onToggleRoute}
          onToggleAll={onToggleAll}
          onResetAuto={onResetAuto}
        />
        {selectedVehicle && (
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
