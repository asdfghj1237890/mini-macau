import { useState, useCallback, useMemo, useRef } from 'react'
import { MapView } from './components/MapView'
import { ControlPanel } from './components/ControlPanel'
import { LineLegend } from './components/LineLegend'
import { TimeDisplay } from './components/TimeDisplay'
import { RouteSelector } from './components/RouteSelector'
import { VehicleInfoPanel } from './components/VehicleInfoPanel'
import { StationInfoPanel } from './components/StationInfoPanel'
import { useSimulationClock } from './hooks/useSimulationClock'
import { useTransitData } from './hooks/useTransitData'
import { computeVehiclePositions } from './engines/simulationEngine'
import type { VehiclePosition, Station } from './types'

export default function App() {
  const clock = useSimulationClock()
  const transitData = useTransitData()
  const [visibleRoutes, setVisibleRoutes] = useState<Set<string>>(new Set())
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null)
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  const [trackedVehicleId, setTrackedVehicleId] = useState<string | null>(null)
  const vehicleCountRef = useRef(0)

  useMemo(() => {
    if (transitData.busRoutes.length > 0 && visibleRoutes.size === 0) {
      setVisibleRoutes(new Set(transitData.busRoutes.map(r => r.id)))
    }
  }, [transitData.busRoutes.length])

  const filteredTransitData = useMemo(() => ({
    ...transitData,
    busRoutes: transitData.busRoutes.filter(r => visibleRoutes.has(r.id)),
  }), [transitData, visibleRoutes])

  // Compute vehicle count periodically (not every frame)
  useMemo(() => {
    if (!transitData.loading) {
      const vehicles = computeVehiclePositions(filteredTransitData, clock.currentTime)
      vehicleCountRef.current = vehicles.length
    }
  }, [Math.floor(clock.currentTime.getTime() / 5000)])

  const onToggleRoute = useCallback((routeId: string) => {
    setVisibleRoutes(prev => {
      const next = new Set(prev)
      if (next.has(routeId)) next.delete(routeId)
      else next.add(routeId)
      return next
    })
  }, [])

  const onToggleAll = useCallback(() => {
    setVisibleRoutes(prev => {
      if (prev.size === transitData.busRoutes.length) return new Set()
      return new Set(transitData.busRoutes.map(r => r.id))
    })
  }, [transitData.busRoutes])

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
        onVehicleClick={onVehicleClick}
        onStationClick={onStationClick}
        trackedVehicleId={trackedVehicleId}
      />
      <TimeDisplay clock={clock} vehicleCount={vehicleCountRef.current} />
      <ControlPanel clock={clock} />
      <LineLegend transitData={filteredTransitData} />
      <RouteSelector
        transitData={transitData}
        visibleRoutes={visibleRoutes}
        onToggleRoute={onToggleRoute}
        onToggleAll={onToggleAll}
      />
      <VehicleInfoPanel
        vehicle={selectedVehicle}
        transitData={filteredTransitData}
        onClose={clearSelection}
      />
      <StationInfoPanel
        station={selectedStation}
        transitData={filteredTransitData}
        clock={clock}
        onClose={clearSelection}
      />
    </div>
  )
}
