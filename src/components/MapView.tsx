import { useRef, useEffect, useCallback, useState } from 'react'
import maplibregl from 'maplibre-gl'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import type { SimulationClock, TransitData, VehiclePosition, Station, Trip, LRTLine, BusRoute, ScheduleType } from '../types'
import { addVehicleLayers, updateVehicleData } from '../layers/VehicleLayer'
import { Bus3DLayer } from '../layers/Bus3DLayer'
import { computeVehiclePositions, getScheduleType } from '../engines/simulationEngine'
import { useI18n } from '../i18n'

const BUILDINGS_SOURCE_ID = 'openfreemap-buildings'
const BUILDINGS_LAYER_ID = '3d-buildings'
const BUILDINGS_TILEJSON = 'https://tiles.openfreemap.org/planet'

const LRT_LINE_OPACITY = 0.7
const LRT_LINE_OPACITY_DIM = 0.12
const BUS_LINE_OPACITY = 0.4
const BUS_LINE_OPACITY_DIM = 0.1

function getLRTLineWindow(
  line: LRTLine,
  trips: Trip[],
  scheduleType: ScheduleType
): [number, number] | null {
  let minStart = Infinity
  let maxEnd = -Infinity
  for (const trip of trips) {
    if (trip.lineId !== line.id) continue
    if (trip.scheduleType && trip.scheduleType !== scheduleType) continue
    if (trip.entries.length === 0) continue
    const s = trip.entries[0].arrivalMinutes
    const last = trip.entries[trip.entries.length - 1]
    const e = last.departureMinutes ?? last.arrivalMinutes
    if (s < minStart) minStart = s
    if (e > maxEnd) maxEnd = e
  }
  if (minStart === Infinity) return null
  return [minStart, maxEnd]
}

function isBusInService(route: BusRoute, hour: number): boolean {
  if (route.serviceHoursStart <= route.serviceHoursEnd) {
    return hour >= route.serviceHoursStart && hour < route.serviceHoursEnd
  }
  return hour >= route.serviceHoursStart || hour < route.serviceHoursEnd
}

const MACAU_CENTER: [number, number] = [113.55920888434439, 22.160440018223373]
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
  onClearSelection?: () => void
  trackedVehicleId?: string | null
}

export function MapView({ clock, transitData, onVehicleClick, onStationClick, onClearSelection, trackedVehicleId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const vehiclesRef = useRef<VehiclePosition[]>([])
  const layersAddedRef = useRef(false)
  const bus3DRef = useRef<Bus3DLayer | null>(null)
  const [is3D, setIs3D] = useState(true)
  const [isDark, setIsDark] = useState(true)
  const [zoom, setZoom] = useState<number>(MACAU_ZOOM)
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

    map.on('zoom', () => {
      setZoom(map.getZoom())
    })

    map.on('load', () => {
      try {
        const styleLayers = map.getStyle().layers ?? []
        let firstSymbolId: string | undefined
        for (const l of styleLayers) {
          if (l.type === 'symbol') {
            firstSymbolId = l.id
            break
          }
        }

        map.addSource(BUILDINGS_SOURCE_ID, {
          type: 'vector',
          url: BUILDINGS_TILEJSON,
        })

        map.addLayer(
          {
            id: BUILDINGS_LAYER_ID,
            source: BUILDINGS_SOURCE_ID,
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 14,
            filter: ['!=', ['get', 'hide_3d'], true],
            layout: { visibility: is3D ? 'visible' : 'none' },
            paint: {
              'fill-extrusion-color': isDark ? '#2a2d33' : '#d8d8dc',
              'fill-extrusion-height': [
                'interpolate', ['linear'], ['zoom'],
                14, 0,
                15.5, ['coalesce', ['get', 'render_height'], 0],
              ],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.85,
            },
          },
          firstSymbolId
        )
      } catch {
        // If the external building tiles fail, skip silently and keep the map functional.
      }

      for (const line of transitData.lrtLines) {
        if (!line.geometry) continue
        map.addSource(`lrt-line-${line.id}`, { type: 'geojson', data: line.geometry })
        map.addLayer({
          id: `lrt-line-${line.id}`,
          type: 'line',
          source: `lrt-line-${line.id}`,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': line.color,
            'line-width': [
              'interpolate', ['linear'], ['zoom'],
              10, 3,
              13, 5,
              16, 9,
            ],
            'line-opacity': LRT_LINE_OPACITY,
          },
        })
      }

      for (const route of transitData.busRoutes) {
        if (!route.geometry?.geometry?.coordinates?.length) continue
        map.addSource(`bus-route-${route.id}`, { type: 'geojson', data: route.geometry })
        map.addLayer({
          id: `bus-route-${route.id}`,
          type: 'line',
          source: `bus-route-${route.id}`,
          paint: { 'line-color': route.color, 'line-width': 2, 'line-opacity': BUS_LINE_OPACITY, 'line-dasharray': [2, 2] },
        })
      }

      const labelField = lang === 'zh' ? 'nameCn' : lang === 'pt' ? 'namePt' : 'name'
      const lrtLineMap = new Map(transitData.lrtLines.map(l => [l.id, l]))
      const stationFeatures = transitData.stations.map(s => {
        let coords: [number, number] = s.coordinates
        const lrtLineId = s.lineIds.find(id => lrtLineMap.has(id))
        const line = lrtLineId ? lrtLineMap.get(lrtLineId) : undefined
        if (line?.geometry) {
          const snapped = nearestPointOnLine(line.geometry, s.coordinates)
          const c = snapped.geometry.coordinates
          if (Array.isArray(c) && c.length >= 2) {
            coords = [c[0], c[1]]
          }
        }
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: coords },
          properties: { id: s.id, name: s.name, nameCn: s.nameCn, namePt: s.namePt },
        }
      })

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

      const bus3DLayer = new Bus3DLayer()
      bus3DLayer.attach(map)
      bus3DRef.current = bus3DLayer

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

      map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ['vehicles-circle', 'stations-circle'],
        })
        if (features.length === 0) {
          onClearSelection?.()
        }
      })
    })

    mapRef.current = map
    serviceStatusRef.current = new Map()
    lastServiceCheckRef.current = 0
    return () => {
      layersAddedRef.current = false
      bus3DRef.current = null
      map.remove()
    }
  }, [transitData.lrtLines.length, transitData.stations.length, transitData.busRoutes.length, isDark, lang])

  const transitRef = useRef(transitData)
  const trackedRef = useRef(trackedVehicleId)
  const prevTrackedRef = useRef<string | null>(null)
  const flyingUntilRef = useRef(0)
  const userInteractingUntilRef = useRef(0)
  const wasUserBusyRef = useRef(false)
  const serviceStatusRef = useRef<Map<string, boolean>>(new Map())
  const lastServiceCheckRef = useRef(0)
  const lrtWindowCacheRef = useRef<{ td: TransitData | null; schedule: ScheduleType | null; map: Map<string, [number, number] | null> }>(
    { td: null, schedule: null, map: new Map() }
  )
  transitRef.current = transitData
  trackedRef.current = trackedVehicleId

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const PAUSE_MS = 500
    const markInteracting = () => {
      userInteractingUntilRef.current = performance.now() + PAUSE_MS
    }

    const canvas = map.getCanvas()
    canvas.addEventListener('wheel', markInteracting, { passive: true })
    canvas.addEventListener('mousedown', markInteracting)
    canvas.addEventListener('touchstart', markInteracting, { passive: true })

    return () => {
      canvas.removeEventListener('wheel', markInteracting)
      canvas.removeEventListener('mousedown', markInteracting)
      canvas.removeEventListener('touchstart', markInteracting)
    }
  }, [transitData.lrtLines.length, isDark, lang])

  useEffect(() => {
    let raf: number
    const TRACK_ZOOM = 16
    const FLY_DURATION = 1200
    const EASE_BACK_DURATION = 400

    const animate = () => {
      const map = mapRef.current
      const td = transitRef.current
      if (map && !td.loading && layersAddedRef.current) {
        const vehicles = computeVehiclePositions(td, clock.timeRef.current)
        vehiclesRef.current = vehicles
        bus3DRef.current?.setVehicles(vehicles.filter(v => v.type === 'bus'))
        updateVehicleData(map, vehicles)

        const perfNow = performance.now()
        if (perfNow - lastServiceCheckRef.current > 1000) {
          lastServiceCheckRef.current = perfNow
          const simTime = clock.timeRef.current
          const schedule = getScheduleType(simTime)
          const nowMinutes = simTime.getHours() * 60 + simTime.getMinutes()
          const hour = simTime.getHours()

          const cache = lrtWindowCacheRef.current
          if (cache.td !== td || cache.schedule !== schedule) {
            cache.td = td
            cache.schedule = schedule
            cache.map = new Map()
            for (const line of td.lrtLines) {
              cache.map.set(line.id, getLRTLineWindow(line, td.trips, schedule))
            }
          }

          for (const line of td.lrtLines) {
            const layerId = `lrt-line-${line.id}`
            if (!map.getLayer(layerId)) continue
            const win = cache.map.get(line.id) ?? null
            const inService = win ? nowMinutes >= win[0] && nowMinutes <= win[1] : true
            const prev = serviceStatusRef.current.get(layerId)
            if (prev !== inService) {
              serviceStatusRef.current.set(layerId, inService)
              map.setPaintProperty(layerId, 'line-opacity', inService ? LRT_LINE_OPACITY : LRT_LINE_OPACITY_DIM)
            }
          }

          for (const route of td.busRoutes) {
            const layerId = `bus-route-${route.id}`
            if (!map.getLayer(layerId)) continue
            const inService = isBusInService(route, hour)
            const prev = serviceStatusRef.current.get(layerId)
            if (prev !== inService) {
              serviceStatusRef.current.set(layerId, inService)
              map.setPaintProperty(layerId, 'line-opacity', inService ? BUS_LINE_OPACITY : BUS_LINE_OPACITY_DIM)
            }
          }
        }

        const tid = trackedRef.current
        if (tid) {
          const tracked = vehicles.find(v => v.id === tid)
          if (tracked) {
            const isNewTrack = prevTrackedRef.current !== tid
            const now = performance.now()
            const userBusy = now < userInteractingUntilRef.current
            const justResumed = wasUserBusyRef.current && !userBusy
            wasUserBusyRef.current = userBusy

            if (isNewTrack) {
              prevTrackedRef.current = tid
              flyingUntilRef.current = now + FLY_DURATION
              map.flyTo({
                center: [tracked.coordinates[0], tracked.coordinates[1]],
                zoom: Math.max(map.getZoom(), TRACK_ZOOM),
                duration: FLY_DURATION,
              })
            } else if (now > flyingUntilRef.current && !userBusy) {
              if (justResumed) {
                flyingUntilRef.current = now + EASE_BACK_DURATION
                map.easeTo({
                  center: [tracked.coordinates[0], tracked.coordinates[1]],
                  duration: EASE_BACK_DURATION,
                })
              } else {
                map.setCenter([tracked.coordinates[0], tracked.coordinates[1]])
              }
            }
          }
        } else if (prevTrackedRef.current !== null) {
          prevTrackedRef.current = null
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
      const map = mapRef.current
      map?.easeTo({ pitch: next ? 45 : 0, duration: 500 })
      if (map?.getLayer(BUILDINGS_LAYER_ID)) {
        map.setLayoutProperty(BUILDINGS_LAYER_ID, 'visibility', next ? 'visible' : 'none')
      }
      return next
    })
  }, [])

  const toggleTheme = useCallback(() => {
    setIsDark(prev => !prev)
  }, [])

  return (
    <>
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute top-4 left-4 flex gap-2 z-10 items-center">
        <div
          className="bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm font-mono
                     backdrop-blur-sm border border-white/20 tabular-nums"
          aria-label="zoom level"
        >
          Z {zoom.toFixed(1)}
        </div>
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
          {lang === 'zh' ? 'PT' : lang === 'pt' ? 'EN' : '中文'}
        </button>
      </div>
    </>
  )
}
