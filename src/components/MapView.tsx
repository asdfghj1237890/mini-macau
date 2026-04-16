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

const LRT_VIADUCT_BASE_M = 6
const LRT_VIADUCT_HEIGHT_M = 7.2
const LRT_VIADUCT_HALF_WIDTH_M = 3.5
const LRT_VIADUCT_OPACITY = 0.95
const LRT_VIADUCT_OPACITY_DIM = 0.18

const METERS_PER_DEG_LAT = 111320

function bufferLineStringToCorridor(
  geometry: GeoJSON.Feature<GeoJSON.LineString> | GeoJSON.LineString,
  halfWidthM: number
): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  const line = (geometry as GeoJSON.Feature<GeoJSON.LineString>).geometry
    ? (geometry as GeoJSON.Feature<GeoJSON.LineString>).geometry
    : (geometry as GeoJSON.LineString)
  const coords = line.coordinates
  const polys: number[][][][] = []
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng0, lat0] = coords[i]
    const [lng1, lat1] = coords[i + 1]
    const midLat = (lat0 + lat1) / 2
    const cosLat = Math.cos((midLat * Math.PI) / 180)
    const mLat = 1 / METERS_PER_DEG_LAT
    const mLng = 1 / (METERS_PER_DEG_LAT * Math.max(cosLat, 1e-6))

    const dxM = (lng1 - lng0) / mLng
    const dyM = (lat1 - lat0) / mLat
    const len = Math.sqrt(dxM * dxM + dyM * dyM)
    if (len < 0.001) continue

    const pxM = (-dyM / len) * halfWidthM
    const pyM = (dxM / len) * halfWidthM

    const c1: [number, number] = [lng0 + pxM * mLng, lat0 + pyM * mLat]
    const c2: [number, number] = [lng1 + pxM * mLng, lat1 + pyM * mLat]
    const c3: [number, number] = [lng1 - pxM * mLng, lat1 - pyM * mLat]
    const c4: [number, number] = [lng0 - pxM * mLng, lat0 - pyM * mLat]
    polys.push([[c1, c2, c3, c4, c1]])
  }
  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: polys },
    properties: {},
  }
}

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
  const [showBuildings, setShowBuildings] = useState(true)
  const [isDark, setIsDark] = useState(true)
  const [zoom, setZoom] = useState<number>(MACAU_ZOOM)
  const { lang, setLang } = useI18n()

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

    const canvasEl = map.getCanvas()
    let middleDragging = false
    let mdLastX = 0
    let mdLastY = 0
    const BEARING_SENS = 0.5
    const PITCH_SENS = 0.5

    const onCanvasMiddleDown = (e: MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      middleDragging = true
      mdLastX = e.clientX
      mdLastY = e.clientY
      canvasEl.style.cursor = 'grabbing'
    }
    const onWindowMiddleMove = (e: MouseEvent) => {
      if (!middleDragging) return
      e.preventDefault()
      const dx = e.clientX - mdLastX
      const dy = e.clientY - mdLastY
      mdLastX = e.clientX
      mdLastY = e.clientY
      const nextBearing = map.getBearing() - dx * BEARING_SENS
      const nextPitch = Math.max(0, Math.min(map.getMaxPitch(), map.getPitch() + dy * PITCH_SENS))
      map.jumpTo({ bearing: nextBearing, pitch: nextPitch })
    }
    const onWindowMiddleUp = (e: MouseEvent) => {
      if (e.button !== 1 || !middleDragging) return
      middleDragging = false
      canvasEl.style.cursor = ''
    }
    const onCanvasAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }

    canvasEl.addEventListener('mousedown', onCanvasMiddleDown)
    canvasEl.addEventListener('auxclick', onCanvasAuxClick)
    window.addEventListener('mousemove', onWindowMiddleMove)
    window.addEventListener('mouseup', onWindowMiddleUp)

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
            layout: { visibility: is3D && showBuildings ? 'visible' : 'none' },
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
              10, 4,
              13, 7,
              16, 13,
              18, 18,
            ],
            'line-opacity': LRT_LINE_OPACITY,
          },
        })

        const corridor = bufferLineStringToCorridor(line.geometry, LRT_VIADUCT_HALF_WIDTH_M)
        map.addSource(`lrt-viaduct-${line.id}`, { type: 'geojson', data: corridor })
        map.addLayer({
          id: `lrt-viaduct-${line.id}`,
          type: 'fill-extrusion',
          source: `lrt-viaduct-${line.id}`,
          minzoom: 13,
          layout: { visibility: is3D ? 'visible' : 'none' },
          paint: {
            'fill-extrusion-color': line.color,
            'fill-extrusion-base': LRT_VIADUCT_BASE_M,
            'fill-extrusion-height': LRT_VIADUCT_HEIGHT_M,
            'fill-extrusion-opacity': LRT_VIADUCT_OPACITY,
            'fill-extrusion-vertical-gradient': true,
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
      canvasEl.removeEventListener('mousedown', onCanvasMiddleDown)
      canvasEl.removeEventListener('auxclick', onCanvasAuxClick)
      window.removeEventListener('mousemove', onWindowMiddleMove)
      window.removeEventListener('mouseup', onWindowMiddleUp)
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
            const viaductId = `lrt-viaduct-${line.id}`
            if (!map.getLayer(layerId)) continue
            const win = cache.map.get(line.id) ?? null
            const inService = win ? nowMinutes >= win[0] && nowMinutes <= win[1] : true
            const prev = serviceStatusRef.current.get(layerId)
            if (prev !== inService) {
              serviceStatusRef.current.set(layerId, inService)
              map.setPaintProperty(layerId, 'line-opacity', inService ? LRT_LINE_OPACITY : LRT_LINE_OPACITY_DIM)
              if (map.getLayer(viaductId)) {
                map.setPaintProperty(
                  viaductId,
                  'fill-extrusion-opacity',
                  inService ? LRT_VIADUCT_OPACITY : LRT_VIADUCT_OPACITY_DIM
                )
              }
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
        map.setLayoutProperty(
          BUILDINGS_LAYER_ID,
          'visibility',
          next && showBuildings ? 'visible' : 'none'
        )
      }
      if (map) {
        for (const line of transitRef.current.lrtLines) {
          const viaductId = `lrt-viaduct-${line.id}`
          if (map.getLayer(viaductId)) {
            map.setLayoutProperty(viaductId, 'visibility', next ? 'visible' : 'none')
          }
        }
      }
      return next
    })
  }, [showBuildings])

  const toggleBuildings = useCallback(() => {
    setShowBuildings(prev => {
      const next = !prev
      const map = mapRef.current
      if (map?.getLayer(BUILDINGS_LAYER_ID)) {
        map.setLayoutProperty(
          BUILDINGS_LAYER_ID,
          'visibility',
          is3D && next ? 'visible' : 'none'
        )
      }
      return next
    })
  }, [is3D])

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
          onClick={toggleBuildings}
          disabled={!is3D}
          aria-pressed={showBuildings}
          title={lang === 'zh' ? '3D 建築物' : lang === 'pt' ? 'Edifícios 3D' : '3D Buildings'}
          className={`bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm
                      hover:bg-black/90 transition-colors backdrop-blur-sm border border-white/20
                      disabled:opacity-40 disabled:cursor-not-allowed
                      ${showBuildings ? '' : 'opacity-50 line-through'}`}
        >
          {lang === 'zh' ? '3D建築' : lang === 'pt' ? 'Edif. 3D' : '3D BLDG'}
        </button>
        <button
          onClick={toggleTheme}
          className="bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm
                     hover:bg-black/90 transition-colors backdrop-blur-sm border border-white/20"
        >
          {isDark ? '☀' : '🌙'}
        </button>
        <div className="relative group">
          <button
            aria-haspopup="listbox"
            aria-label="language"
            className="bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm
                       hover:bg-black/90 transition-colors backdrop-blur-sm border border-white/20
                       group-hover:bg-black/90 group-focus-within:bg-black/90"
          >
            {lang === 'zh' ? '中文' : lang === 'pt' ? 'PT' : 'EN'}
            <span className="ml-1 text-white/40 text-[10px] inline-block">▾</span>
          </button>
          <div
            role="listbox"
            className="absolute top-full right-0 mt-1 flex flex-col gap-1
                       bg-black/85 backdrop-blur-sm border border-white/20 rounded-lg p-1
                       min-w-full opacity-0 translate-y-[-4px] pointer-events-none
                       group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto
                       group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:pointer-events-auto
                       transition-all duration-150"
          >
            {(['zh', 'pt', 'en'] as const)
              .filter(l => l !== lang)
              .map(l => (
                <button
                  key={l}
                  role="option"
                  aria-selected={false}
                  onClick={() => setLang(l)}
                  className="px-3 py-1 text-sm text-white/80 hover:bg-white/10 hover:text-white
                             rounded text-left transition-colors"
                >
                  {l === 'zh' ? '中文' : l === 'pt' ? 'PT' : 'EN'}
                </button>
              ))}
          </div>
        </div>
      </div>
    </>
  )
}
