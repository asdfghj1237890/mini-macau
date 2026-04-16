import { useRef, useEffect, useCallback, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { SimulationClock, TransitData, VehiclePosition, Station } from '../types'
import { addVehicleLayers, updateVehicleData } from '../layers/VehicleLayer'
import { computeVehiclePositions } from '../engines/simulationEngine'
import { useI18n } from '../i18n'

const MACAU_CENTER: [number, number] = [113.5439, 22.1987]
const MACAU_ZOOM = 13
const STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
}

interface Props {
  clock: SimulationClock
  transitData: TransitData
  onVehicleClick?: (vehicle: VehiclePosition | null) => void
  onStationClick?: (station: Station | null) => void
  trackedVehicleId?: string | null
}

export function MapView({ clock, transitData, onVehicleClick, onStationClick, trackedVehicleId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const vehiclesRef = useRef<VehiclePosition[]>([])
  const layersAddedRef = useRef(false)
  const [is3D, setIs3D] = useState(true)
  const [isDark, setIsDark] = useState(true)
  const { lang, toggleLang } = useI18n()

  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: isDark ? STYLES.dark : STYLES.light,
      center: MACAU_CENTER,
      zoom: MACAU_ZOOM,
      pitch: is3D ? 45 : 0,
      bearing: -17,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      for (const line of transitData.lrtLines) {
        if (!line.geometry) continue
        map.addSource(`lrt-line-${line.id}`, { type: 'geojson', data: line.geometry })
        map.addLayer({
          id: `lrt-line-${line.id}`,
          type: 'line',
          source: `lrt-line-${line.id}`,
          paint: { 'line-color': line.color, 'line-width': 3, 'line-opacity': 0.7 },
        })
      }

      for (const route of transitData.busRoutes) {
        if (!route.geometry?.geometry?.coordinates?.length) continue
        map.addSource(`bus-route-${route.id}`, { type: 'geojson', data: route.geometry })
        map.addLayer({
          id: `bus-route-${route.id}`,
          type: 'line',
          source: `bus-route-${route.id}`,
          paint: { 'line-color': route.color, 'line-width': 2, 'line-opacity': 0.4, 'line-dasharray': [2, 2] },
        })
      }

      const labelField = lang === 'zh' ? 'nameCn' : 'name'
      const stationFeatures = transitData.stations.map(s => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: s.coordinates },
        properties: { id: s.id, name: s.name, nameCn: s.nameCn },
      }))

      if (stationFeatures.length > 0) {
        map.addSource('stations', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: stationFeatures },
        })
        map.addLayer({
          id: 'stations-circle',
          type: 'circle',
          source: 'stations',
          paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-stroke-color': isDark ? '#444' : '#999',
          },
        })
        map.addLayer({
          id: 'stations-label',
          type: 'symbol',
          source: 'stations',
          layout: {
            'text-field': ['get', labelField],
            'text-size': 11,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
          },
          paint: {
            'text-color': isDark ? '#cccccc' : '#333333',
            'text-halo-color': isDark ? '#000000' : '#ffffff',
            'text-halo-width': 1,
          },
        })

        map.on('click', 'stations-circle', (e) => {
          const feature = e.features?.[0]
          if (feature) {
            const sid = feature.properties?.id
            const station = transitData.stations.find(s => s.id === sid)
            onStationClick?.(station ?? null)
          }
        })
        map.on('mouseenter', 'stations-circle', () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', 'stations-circle', () => {
          map.getCanvas().style.cursor = ''
        })
      }

      addVehicleLayers(map, lang)
      layersAddedRef.current = true

      map.on('click', 'vehicles-circle', (e) => {
        const feature = e.features?.[0]
        if (feature) {
          const vid = feature.properties?.id
          const vehicle = vehiclesRef.current.find(v => v.id === vid)
          if (vehicle) {
            onVehicleClick?.(vehicle)
            return
          }
        }
      })
      map.on('mouseenter', 'vehicles-circle', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'vehicles-circle', () => {
        map.getCanvas().style.cursor = ''
      })
    })

    mapRef.current = map
    return () => {
      layersAddedRef.current = false
      map.remove()
    }
  }, [transitData.lrtLines.length, transitData.stations.length, transitData.busRoutes.length, isDark, lang])

  const transitRef = useRef(transitData)
  const trackedRef = useRef(trackedVehicleId)
  transitRef.current = transitData
  trackedRef.current = trackedVehicleId

  useEffect(() => {
    let raf: number
    const animate = () => {
      const map = mapRef.current
      const td = transitRef.current
      if (map && !td.loading && layersAddedRef.current) {
        const vehicles = computeVehiclePositions(td, clock.timeRef.current)
        vehiclesRef.current = vehicles
        updateVehicleData(map, vehicles)

        const tid = trackedRef.current
        if (tid) {
          const tracked = vehicles.find(v => v.id === tid)
          if (tracked) {
            map.easeTo({
              center: [tracked.coordinates[0], tracked.coordinates[1]],
              duration: 200,
            })
          }
        }
      }
      raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [])

  const toggle3D = useCallback(() => {
    setIs3D(prev => {
      const next = !prev
      mapRef.current?.easeTo({ pitch: next ? 45 : 0, duration: 500 })
      return next
    })
  }, [])

  const toggleTheme = useCallback(() => {
    setIsDark(prev => !prev)
  }, [])

  return (
    <>
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute top-4 left-4 flex gap-2 z-10">
        <button
          onClick={toggle3D}
          className="bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm
                     hover:bg-black/90 transition-colors backdrop-blur-sm border border-white/20"
        >
          {is3D ? '2D' : '3D'}
        </button>
        <button
          onClick={toggleTheme}
          className="bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm
                     hover:bg-black/90 transition-colors backdrop-blur-sm border border-white/20"
        >
          {isDark ? '☀' : '🌙'}
        </button>
        <button
          onClick={toggleLang}
          className="bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm
                     hover:bg-black/90 transition-colors backdrop-blur-sm border border-white/20"
        >
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </div>
    </>
  )
}
