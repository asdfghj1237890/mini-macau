import { useRef, useEffect, useCallback, useState, useSyncExternalStore } from 'react'
import maplibregl from 'maplibre-gl'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import type { SimulationClock, TransitData, VehiclePosition, Station, Trip, LRTLine, BusRoute, ScheduleType } from '../types'
import { addVehicleLayers, updateVehicleData, updateVehicleLabelLang } from '../layers/VehicleLayer'
import { Bus3DLayer } from '../layers/Bus3DLayer'
import { LRT3DLayer } from '../layers/LRT3DLayer'
import { Flight3DLayer, ALL_FLIGHT_3D_LAYERS } from '../layers/Flight3DLayer'
import { Ferry3DLayer, ALL_FERRY_3D_LAYERS } from '../layers/Ferry3DLayer'
import { computeVehiclePositions, computeFlightOnly, getScheduleType, interpolateOnLine } from '../engines/simulationEngine'
import length from '@turf/length'
import { useI18n } from '../i18n'
import type { BusTracker, RouteRealtimePoller } from '../services/realtimeClient'
import { ga } from '../analytics/ga'

const RT_BUILD = import.meta.env.VITE_ENABLE_RT === '1'

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

const BUS_SERVICE_TAIL_MIN = 60

function getServiceHours(route: BusRoute, date: Date): { start: number; end: number } {
  // Sunday (getDay() === 0) uses the Sun+PH bucket if present. We don't have
  // a public-holiday calendar wired in yet, so weekdays fall through to the
  // Mon-Sat window.
  const isSunBucket = date.getDay() === 0
    && route.serviceHoursStartSun !== undefined
    && route.serviceHoursEndSun !== undefined
  if (isSunBucket) {
    return { start: route.serviceHoursStartSun!, end: route.serviceHoursEndSun! }
  }
  return { start: route.serviceHoursStart, end: route.serviceHoursEnd }
}

function isBusInService(route: BusRoute, date: Date): boolean {
  const nowMin = date.getHours() * 60 + date.getMinutes()
  const { start, end } = getServiceHours(route, date)
  const startMin = start * 60
  let endWithTail = end * 60 + BUS_SERVICE_TAIL_MIN
  if (endWithTail <= startMin) endWithTail += 1440
  return (nowMin >= startMin && nowMin < endWithTail)
    || (nowMin + 1440 >= startMin && nowMin + 1440 < endWithTail)
}

// Bbox = [minLng, minLat, maxLng, maxLat]. Cached per route geometry since
// coordinates never change after load. Used to skip DSAT polling for routes
// whose entire path lies outside the current viewport (+buffer).
type Bbox = [number, number, number, number]
const routeBboxCache = new WeakMap<BusRoute, Bbox>()
function getRouteBbox(route: BusRoute): Bbox {
  const cached = routeBboxCache.get(route)
  if (cached) return cached
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const [lng, lat] of route.geometry.geometry.coordinates) {
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }
  const bb: Bbox = [minLng, minLat, maxLng, maxLat]
  routeBboxCache.set(route, bb)
  return bb
}

function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

// Expand a viewport bbox by km so routes just outside the visible area still
// poll — reduces "pop-in" when the user pans slowly.
function expandBbox(b: Bbox, km: number): Bbox {
  const degLat = km / 111
  const midLat = (b[1] + b[3]) / 2
  const degLng = km / (111 * Math.max(Math.cos((midLat * Math.PI) / 180), 1e-6))
  return [b[0] - degLng, b[1] - degLat, b[2] + degLng, b[3] + degLat]
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
  allTransitData: TransitData
  onVehicleClick?: (vehicle: VehiclePosition | null) => void
  onTrackedVehicleUpdate?: (vehicle: VehiclePosition) => void
  onStationClick?: (station: Station | null) => void
  onClearSelection?: () => void
  trackedVehicleId?: string | null
  onVehicleCount?: (count: number) => void
  showTimeBar?: boolean
  onToggleTimeBar?: () => void
}

export function MapView({ clock, transitData, allTransitData, onVehicleClick, onTrackedVehicleUpdate, onStationClick, onClearSelection, trackedVehicleId, onVehicleCount, showTimeBar = true, onToggleTimeBar }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const vehiclesRef = useRef<VehiclePosition[]>([])
  // Per-RAF flight snapshot. Used as the fallback source for the tracked
  // plane's live position when we still need one outside the dedicated
  // per-RAF recompute path.
  const flightVehiclesRef = useRef<VehiclePosition[]>([])
  const layersAddedRef = useRef(false)
  const bus3DRef = useRef<Bus3DLayer | null>(null)
  const lrt3DRef = useRef<LRT3DLayer | null>(null)
  const flight3DRef = useRef<Flight3DLayer | null>(null)
  const ferry3DRef = useRef<Ferry3DLayer | null>(null)
  const [is3D, setIs3D] = useState(true)
  const [showBuildings, setShowBuildings] = useState(true)
  const [isDark, setIsDark] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const zoomStoreRef = useRef<{ value: number; listeners: Set<() => void> }>({
    value: MACAU_ZOOM,
    listeners: new Set(),
  })
  const subscribeZoom = useCallback((cb: () => void) => {
    const s = zoomStoreRef.current
    s.listeners.add(cb)
    return () => { s.listeners.delete(cb) }
  }, [])
  const getZoomSnapshot = useCallback(() => zoomStoreRef.current.value, [])
  const [rtUnlocked, setRtUnlocked] = useState(() =>
    RT_BUILD && typeof window !== 'undefined' && localStorage.getItem('mm_rt_unlocked') === '1')
  const [rtEnabled, setRtEnabled] = useState(() =>
    RT_BUILD && typeof window !== 'undefined' && localStorage.getItem('mm_rt_enabled') === '1')
  const srcTapsRef = useRef<number[]>([])
  type RtDirState = {
    route: BusRoute
    dir: 0 | 1
    geometry: GeoJSON.Feature<GeoJSON.LineString>
    tracker: BusTracker
    poller: RouteRealtimePoller
    unsub: () => void
  }
  const rtStatesRef = useRef<Map<string, RtDirState>>(new Map())
  const rtEnabledRef = useRef(rtEnabled)
  rtEnabledRef.current = rtEnabled
  const rtCachedVehiclesRef = useRef<VehiclePosition[]>([])
  const rtCachedLiveIdsRef = useRef<Set<string>>(new Set())
  const rtVisibleIdsRef = useRef<Set<string>>(new Set())
  // Pool of reusable VehiclePosition objects keyed by vehicle id, so the
  // RT tick can mutate in place instead of allocating ~300 fresh objects
  // (plus their .rt sub-objects) five times a second. Entries for plates
  // that are no longer tracked get evicted at the end of each tick.
  const rtVehiclePoolRef = useRef<Map<string, VehiclePosition>>(new Map())
  const rtVisibleIdsSourceRef = useRef<BusRoute[] | null>(null)
  const rtLastTickAtRef = useRef(0)
  const { lang, t, setLang } = useI18n()
  const isDarkRef = useRef(isDark)
  const langRef = useRef(lang)
  const is3DRef = useRef(is3D)
  const showBuildingsRef = useRef(showBuildings)
  isDarkRef.current = isDark
  langRef.current = lang
  is3DRef.current = is3D
  showBuildingsRef.current = showBuildings

  const addCustomLayersRef = useRef<((map: maplibregl.Map) => void) | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        setMenuOpen(o => {
          if (!o) ga.drawerOpened()
          return !o
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const rtDataReady = allTransitData.busRoutes.length > 0 && allTransitData.busStops.length > 0
  const busStopsRef = useRef(allTransitData.busStops)
  busStopsRef.current = allTransitData.busStops
  const rtModuleRef = useRef<typeof import('../services/realtimeClient') | null>(null)
  const pausedRef = useRef(clock.paused)
  pausedRef.current = clock.paused
  const speedRef = useRef(clock.speed)
  speedRef.current = clock.speed
  const tabVisibleRef = useRef(typeof document === 'undefined' || !document.hidden)
  // Current viewport bbox (expanded by buffer). null = "show everything"
  // — used before the map reports its first bounds.
  const viewBboxRef = useRef<Bbox | null>(null)

  // Single source of truth for "should this poller be running right now?".
  // A poller costs one DSAT request per ~15 s, so pausing pollers whose
  // output the user can't see (tab hidden, outside viewport, outside
  // service hours, clock paused) cuts the network bill dramatically without
  // changing what the user sees. Every gate is evaluated here; all
  // handlers (clock pause, tab visibility, map move, sim-minute flip) just
  // re-invoke this.
  const reconcilePollersRef = useRef<() => void>(() => {})
  reconcilePollersRef.current = () => {
    if (!RT_BUILD) return
    const simTime = clock.timeRef.current
    const paused = pausedRef.current
    const tabVisible = tabVisibleRef.current
    const view = viewBboxRef.current
    let anyRunning = false
    for (const s of rtStatesRef.current.values()) {
      const inService = isBusInService(s.route, simTime)
      const inView = view === null || bboxIntersects(getRouteBbox(s.route), view)
      const shouldRun = !paused && tabVisible && inService && inView
      if (shouldRun) { s.poller.resume(); anyRunning = true }
      else s.poller.pause()
    }
    if (anyRunning) rtLastTickAtRef.current = 0
  }

  useEffect(() => {
    if (!RT_BUILD) return
    return () => {
      for (const s of rtStatesRef.current.values()) { s.unsub(); s.poller.stop() }
      rtStatesRef.current = new Map()
      rtCachedVehiclesRef.current = []
      rtCachedLiveIdsRef.current = new Set()
      rtVehiclePoolRef.current = new Map()
      rtLastTickAtRef.current = 0
    }
  }, [rtEnabled, rtDataReady])

  useEffect(() => {
    if (!RT_BUILD) return
    if (!rtEnabled || !rtDataReady) return

    let cancelled = false
    const staggerTimers: number[] = []

    const sync = async () => {
      const mod = rtModuleRef.current ?? (rtModuleRef.current = await import('../services/realtimeClient'))
      if (cancelled) return
      const { RouteRealtimePoller, BusTracker } = mod

      const stopMap = new Map(busStopsRef.current.map(s => [s.id, s]))
      const desired = new Map<string, { route: BusRoute; dir: 0 | 1 }>()
      for (const route of transitData.busRoutes) {
        const dirs: (0 | 1)[] = route.routeType === 'circular' ? [0] : [0, 1]
        for (const dir of dirs) desired.set(`${route.id}:${dir}`, { route, dir })
      }

      const current = rtStatesRef.current
      const removed: string[] = []
      for (const [key, state] of current) {
        if (!desired.has(key)) {
          state.unsub()
          state.poller.stop()
          removed.push(key)
        }
      }
      for (const k of removed) current.delete(k)

      let staggerIdx = 0
      for (const [key, { route, dir }] of desired) {
        if (current.has(key)) continue
        const stopsOrdered = dir === 0 ? route.stopsForward : route.stopsBackward
        const coords = dir === 0
          ? route.geometry.geometry.coordinates
          : [...route.geometry.geometry.coordinates].reverse()
        const geometry: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        }
        const totalLenKm = length(geometry, { units: 'kilometers' })
        const stopProgress = stopsOrdered.map(stopId => {
          const stop = stopMap.get(stopId)
          if (!stop || totalLenKm <= 0) return 0
          const projected = nearestPointOnLine(geometry, stop.coordinates, { units: 'kilometers' })
          return Math.max(0, Math.min(1, (projected.properties.location ?? 0) / totalLenKm))
        })
        const tracker = new BusTracker(stopProgress, route.routeType === 'circular', totalLenKm)
        const poller = new RouteRealtimePoller(route.id, dir, 15_000)
        const unsub = poller.subscribe(obs => { tracker.ingest(obs) })
        current.set(key, { route, dir, geometry, tracker, poller, unsub })

        const delay = staggerIdx * 40
        const t = window.setTimeout(() => {
          if (cancelled) return
          poller.start()
          // Apply current gating (tab visibility, viewport, service hours,
          // clock pause) so a newly-spawned poller doesn't fire a request
          // we'd immediately throw away.
          reconcilePollersRef.current()
        }, delay)
        staggerTimers.push(t)
        staggerIdx++
      }

      rtLastTickAtRef.current = 0
    }

    void sync()

    return () => {
      cancelled = true
      for (const t of staggerTimers) clearTimeout(t)
    }
  }, [rtEnabled, rtDataReady, transitData.busRoutes])

  // Kick the reconciler on clock-pause and on every sim-minute flip.
  // Service windows change on minute boundaries, so a single re-evaluation
  // per minute is enough.
  const simMinuteKey = `${clock.currentTime.getDay()}-${clock.currentTime.getHours()}-${clock.currentTime.getMinutes()}`
  useEffect(() => {
    if (!RT_BUILD) return
    reconcilePollersRef.current()
  }, [clock.paused, simMinuteKey])

  // Tab visibility: pause every poller the moment the user switches tabs
  // and restore proper state on return. visibilitychange fires on
  // blur/focus, window minimize, and mobile background.
  useEffect(() => {
    if (!RT_BUILD) return
    const onVis = () => {
      tabVisibleRef.current = !document.hidden
      reconcilePollersRef.current()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: isDarkRef.current ? STYLES.dark : STYLES.light,
      center: MACAU_CENTER,
      zoom: MACAU_ZOOM,
      pitch: is3D ? 45 : 0,
      bearing: -17,
      attributionControl: false,
    })

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.once('load', () => {
      const attrib = containerRef.current?.querySelector('.maplibregl-ctrl-attrib')
      if (attrib) attrib.classList.remove('maplibregl-compact-show')
    })

    let zoomTimer = 0
    map.on('zoom', () => {
      cancelAnimationFrame(zoomTimer)
      zoomTimer = requestAnimationFrame(() => {
        const s = zoomStoreRef.current
        s.value = map.getZoom()
        for (const l of s.listeners) l()
      })
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

    const lrtLineMap = new Map(allTransitData.lrtLines.map(l => [l.id, l]))
    const stationFeatures = allTransitData.stations.map(s => {
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

    const corridors = new Map<string, GeoJSON.Feature<GeoJSON.MultiPolygon>>()
    for (const line of allTransitData.lrtLines) {
      if (line.geometry) {
        corridors.set(line.id, bufferLineStringToCorridor(line.geometry, LRT_VIADUCT_HALF_WIDTH_M))
      }
    }

    const addCustomLayers = (m: maplibregl.Map) => {
      const dark = isDarkRef.current
      const currentLang = langRef.current
      const cur3D = is3DRef.current
      const curBuildings = showBuildingsRef.current

      try {
        const styleLayers = m.getStyle().layers ?? []
        let firstSymbolId: string | undefined
        for (const l of styleLayers) {
          if (l.type === 'symbol') { firstSymbolId = l.id; break }
        }

        m.addSource(BUILDINGS_SOURCE_ID, { type: 'vector', url: BUILDINGS_TILEJSON })
        m.addLayer({
          id: BUILDINGS_LAYER_ID,
          source: BUILDINGS_SOURCE_ID,
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14,
          filter: ['!=', ['get', 'hide_3d'], true],
          layout: { visibility: cur3D && curBuildings ? 'visible' : 'none' },
          paint: {
            'fill-extrusion-color': dark ? '#2a2d33' : '#d8d8dc',
            'fill-extrusion-height': [
              'interpolate', ['linear'], ['zoom'],
              14, 0, 15.5, ['coalesce', ['get', 'render_height'], 0],
            ],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.85,
          },
        }, firstSymbolId)
      } catch { /* building tiles may fail */ }

      for (const line of allTransitData.lrtLines) {
        if (!line.geometry) continue
        m.addSource(`lrt-line-${line.id}`, { type: 'geojson', data: line.geometry })
        m.addLayer({
          id: `lrt-line-${line.id}`, type: 'line', source: `lrt-line-${line.id}`,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': line.color,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 13, 7, 16, 13, 18, 18],
            'line-opacity': LRT_LINE_OPACITY,
          },
        })
        const corridor = corridors.get(line.id)
        if (corridor) {
          m.addSource(`lrt-viaduct-${line.id}`, { type: 'geojson', data: corridor })
          m.addLayer({
            id: `lrt-viaduct-${line.id}`, type: 'fill-extrusion', source: `lrt-viaduct-${line.id}`,
            minzoom: 13, layout: { visibility: cur3D ? 'visible' : 'none' },
            paint: {
              'fill-extrusion-color': line.color, 'fill-extrusion-base': LRT_VIADUCT_BASE_M,
              'fill-extrusion-height': LRT_VIADUCT_HEIGHT_M, 'fill-extrusion-opacity': LRT_VIADUCT_OPACITY,
              'fill-extrusion-vertical-gradient': true,
            },
          })
        }
      }

      const busRouteFeatures = allTransitData.busRoutes
        .filter(r => r.geometry?.geometry?.coordinates?.length)
        .map(r => ({
          type: 'Feature' as const,
          id: r.id,
          geometry: r.geometry.geometry,
          properties: { id: r.id, color: r.color },
        }))
      if (busRouteFeatures.length > 0) {
        m.addSource('bus-routes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: busRouteFeatures },
        })
        m.addLayer({
          id: 'bus-routes', type: 'line', source: 'bus-routes',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': [
              'case',
              ['==', ['feature-state', 'inService'], false],
              BUS_LINE_OPACITY_DIM,
              BUS_LINE_OPACITY,
            ],
            'line-dasharray': [2, 2],
          },
        })
      }

      const labelField = currentLang === 'zh' ? 'nameCn' : currentLang === 'pt' ? 'namePt' : 'name'
      if (stationFeatures.length > 0) {
        m.addSource('stations', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: stationFeatures },
        })
        m.addLayer({
          id: 'stations-circle', type: 'circle', source: 'stations',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 13, 7, 16, 9, 18, 11],
            'circle-color': '#ffffff', 'circle-stroke-width': 2.5,
            'circle-stroke-color': dark ? '#444' : '#999',
          },
        })
        m.addLayer({
          id: 'stations-label', type: 'symbol', source: 'stations',
          layout: { 'text-field': ['get', labelField], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
          paint: { 'text-color': dark ? '#cccccc' : '#333333', 'text-halo-color': dark ? '#000000' : '#ffffff', 'text-halo-width': 1 },
        })
      }

      addVehicleLayers(m, currentLang)

      const bus3DLayer = new Bus3DLayer()
      bus3DLayer.attach(m)
      bus3DRef.current = bus3DLayer

      const lrt3DLayer = new LRT3DLayer()
      lrt3DLayer.attach(m)
      lrt3DRef.current = lrt3DLayer

      const flight3DLayer = new Flight3DLayer()
      flight3DLayer.attach(m)
      flight3DRef.current = flight3DLayer

      const ferry3DLayer = new Ferry3DLayer()
      ferry3DLayer.attach(m)
      ferry3DRef.current = ferry3DLayer

      layersAddedRef.current = true
      serviceStatusRef.current = new Map()
      lastServiceMinuteRef.current = ''
    }

    addCustomLayersRef.current = addCustomLayers

    const attachClickHandlers = (m: maplibregl.Map) => {
      m.on('click', 'stations-circle', (e) => {
        const feature = e.features?.[0]
        if (feature) {
          const sid = feature.properties?.id
          const station = allTransitData.stations.find(s => s.id === sid)
          onStationClick?.(station ?? null)
        }
      })
      m.on('mouseenter', 'stations-circle', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'stations-circle', () => { m.getCanvas().style.cursor = '' })

      m.on('click', 'vehicles-circle', (e) => {
        const feature = e.features?.[0]
        if (feature) {
          const vid = feature.properties?.id
          const vehicle = vehiclesRef.current.find(v => v.id === vid)
          if (vehicle) { onVehicleClick?.(vehicle); return }
        }
      })
      m.on('mouseenter', 'vehicles-circle', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'vehicles-circle', () => { m.getCanvas().style.cursor = '' })

      const model3DLayers = ['bus-3d-body', 'bus-3d-roof', 'bus-3d-window', 'bus-3d-windshield', 'bus-3d-wheel',
        'lrt-3d-body', 'lrt-3d-roof', 'lrt-3d-window', 'lrt-3d-windshield', 'lrt-3d-bogie', 'lrt-3d-gangway',
        ...ALL_FLIGHT_3D_LAYERS,
        ...ALL_FERRY_3D_LAYERS,
        'ferry-3d-upper-back', 'ferry-3d-wheel-visor']
      for (const layerId of model3DLayers) {
        m.on('click', layerId, (e) => {
          const feature = e.features?.[0]
          if (feature) {
            const vid = feature.properties?.vehicleId
            const vehicle = vehiclesRef.current.find(v => v.id === vid)
            if (vehicle) { onVehicleClick?.(vehicle); e.preventDefault() }
          }
        })
        m.on('mouseenter', layerId, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', layerId, () => { m.getCanvas().style.cursor = '' })
      }

      m.on('click', (e) => {
        const features = m.queryRenderedFeatures(e.point, {
          layers: ['vehicles-circle', 'stations-circle', ...model3DLayers],
        })
        if (features.length === 0) onClearSelection?.()
      })
    }

    // addCustomLayers needs the style loaded (addLayer would throw otherwise),
    // so it stays gated on 'load'. Click handlers use delegated listeners
    // (layer-id is a queryRenderedFeatures filter, not an addLayer precondition),
    // so they can — and MUST — be attached synchronously up front: otherwise
    // a setStyle({diff:false}) that races the initial load (see the [isDark]
    // effect below, which runs on mount) can swallow the 'load' event and
    // the click callback never fires. That was the "vehicles aren't clickable"
    // regression — no delegated click listeners ever registered on the map.
    attachClickHandlers(map)
    map.on('load', () => {
      addCustomLayers(map)
    })

    mapRef.current = map
    serviceStatusRef.current = new Map()
    lastServiceMinuteRef.current = ''
    return () => {
      layersAddedRef.current = false
      bus3DRef.current = null
      lrt3DRef.current = null
      flight3DRef.current = null
      ferry3DRef.current = null
      addCustomLayersRef.current = null
      canvasEl.removeEventListener('mousedown', onCanvasMiddleDown)
      canvasEl.removeEventListener('auxclick', onCanvasAuxClick)
      window.removeEventListener('mousemove', onWindowMiddleMove)
      window.removeEventListener('mouseup', onWindowMiddleUp)
      map.remove()
    }
  }, [allTransitData.lrtLines.length, allTransitData.stations.length, allTransitData.busRoutes.length])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersAddedRef.current = false
    bus3DRef.current = null
    lrt3DRef.current = null
    flight3DRef.current = null
    ferry3DRef.current = null
    map.once('style.load', () => {
      addCustomLayersRef.current?.(map)
    })
    map.setStyle(isDark ? STYLES.dark : STYLES.light, { diff: false })
  }, [isDark])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const labelField = lang === 'zh' ? 'nameCn' : lang === 'pt' ? 'namePt' : 'name'
    if (map.getLayer('stations-label')) {
      map.setLayoutProperty('stations-label', 'text-field', ['get', labelField])
    }
    updateVehicleLabelLang(map, lang)
  }, [lang])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const visibleIds = new Set(transitData.lrtLines.map(l => l.id))
    for (const line of allTransitData.lrtLines) {
      const visible = visibleIds.has(line.id)
      const lineLayer = `lrt-line-${line.id}`
      const viaductLayer = `lrt-viaduct-${line.id}`
      if (map.getLayer(lineLayer)) {
        map.setLayoutProperty(lineLayer, 'visibility', visible ? 'visible' : 'none')
      }
      if (map.getLayer(viaductLayer)) {
        map.setLayoutProperty(viaductLayer, 'visibility', visible && is3D ? 'visible' : 'none')
      }
    }
  }, [transitData.lrtLines, allTransitData.lrtLines, is3D])

  const transitRef = useRef(transitData)
  const trackedRef = useRef(trackedVehicleId)
  const prevTrackedRef = useRef<string | null>(null)
  const flyingUntilRef = useRef(0)
  const userInteractingUntilRef = useRef(0)
  const wasUserBusyRef = useRef(false)
  const serviceStatusRef = useRef<Map<string, boolean>>(new Map())
  // Sim-minute key of the last service-status sweep. Service windows flip
  // on minute boundaries, so there's no point re-running the ~90-route
  // scan at 1 Hz real time when nothing has changed. Empty string forces
  // a sweep after layer/data swaps.
  const lastServiceMinuteRef = useRef('')
  const lrtWindowCacheRef = useRef<{ td: TransitData | null; schedule: ScheduleType | null; map: Map<string, [number, number] | null> }>(
    { td: null, schedule: null, map: new Map() }
  )
  const onVehicleCountRef = useRef(onVehicleCount)
  onVehicleCountRef.current = onVehicleCount
  const onTrackedUpdateRef = useRef(onTrackedVehicleUpdate)
  onTrackedUpdateRef.current = onTrackedVehicleUpdate
  const lastTrackedSyncRef = useRef<{ id: string | null; observedAt: number | null }>({ id: null, observedAt: null })
  const lastSimSyncRef = useRef<{ id: string | null; at: number }>({ id: null, at: 0 })
  transitRef.current = transitData
  trackedRef.current = trackedVehicleId

  const mapBusyRef = useRef(false)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const PAUSE_MS = 500
    const markInteracting = () => {
      userInteractingUntilRef.current = performance.now() + PAUSE_MS
    }

    const onMoveStart = () => { mapBusyRef.current = true }

    // Update the gating viewport bbox on pan/zoom end, then ask the poller
    // reconciler to pause routes that scrolled offscreen and wake ones
    // that scrolled into view. 300 ms debounce swallows the flurry of
    // moveends that fire during a flyTo or a momentum-scroll spindown.
    const VIEW_BUFFER_KM = 2
    let reconcileTimer: number | null = null
    const updateViewAndReconcile = () => {
      const b = map.getBounds()
      viewBboxRef.current = expandBbox(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        VIEW_BUFFER_KM,
      )
      reconcilePollersRef.current()
    }
    const onMoveEnd = () => {
      mapBusyRef.current = false
      if (reconcileTimer !== null) clearTimeout(reconcileTimer)
      reconcileTimer = window.setTimeout(updateViewAndReconcile, 300)
    }
    // Initialize viewport bbox once the map has its first bounds so the
    // reconciler can gate pollers on the very first pass.
    updateViewAndReconcile()

    const canvas = map.getCanvas()
    canvas.addEventListener('wheel', markInteracting, { passive: true })
    canvas.addEventListener('mousedown', markInteracting)
    canvas.addEventListener('touchstart', markInteracting, { passive: true })
    map.on('movestart', onMoveStart)
    map.on('moveend', onMoveEnd)

    return () => {
      if (reconcileTimer !== null) clearTimeout(reconcileTimer)
      canvas.removeEventListener('wheel', markInteracting)
      canvas.removeEventListener('mousedown', markInteracting)
      canvas.removeEventListener('touchstart', markInteracting)
      map.off('movestart', onMoveStart)
      map.off('moveend', onMoveEnd)
    }
  }, [allTransitData.lrtLines.length])

  useEffect(() => {
    let raf: number
    const TRACK_ZOOM = 16
    const FLY_DURATION = 1200
    const EASE_BACK_DURATION = 400
    // 30 Hz sim tick. 20 Hz (50 ms) was fine at 1× but at ≥5× sim speed the
    // per-tick LRT step grew to ~5 m, held for ~3 render frames — visible as
    // 前後抖動. 33 ms halves that step without piling re-tessellations on
    // the MapLibre worker the way a full 60 Hz would.
    const SIM_TICK_MS = 33
    const HEAVY_TICK_MS_BUSY = 160
    let lastCountReport = 0
    let lastSimTick = 0
    let lastHeavyTick = 0
    let lastFlightTick = 0
    // Local smooth time for flight computation: the clock hook advances
    // timeRef in its own RAF loop which can fire after this animate loop
    // in the same browser frame, causing a stale read (zero delta) followed
    // by a double-delta on the next frame. At >=10x the alternating 0/2x
    // steps are visible as 前後抖動. Maintaining our own time from
    // performance.now() delta guarantees monotonic per-frame advancement.
    let flightPerfLast = 0
    let flightSimMs = 0

    const animate = () => {
      const map = mapRef.current
      const td = transitRef.current
      if (map && !td.loading && layersAddedRef.current) {
        const nowTick = performance.now()
        const shouldTick = nowTick - lastSimTick >= SIM_TICK_MS
        const heavyInterval = mapBusyRef.current ? HEAVY_TICK_MS_BUSY : SIM_TICK_MS
        const shouldHeavy = nowTick - lastHeavyTick >= heavyInterval
        if (shouldTick) {
          lastSimTick = nowTick
        const rtActive = RT_BUILD && rtEnabledRef.current
        // In RT mode every sim bus is discarded (the map shows only
        // DSAT-observed buses) so we skip the per-route bus rollup entirely
        // — no point computing positions that will be filtered out.
        const vehicles = computeVehiclePositions(td, clock.timeRef.current, rtActive ? { skipBuses: true } : undefined)
        if (rtActive) {
          if (rtStatesRef.current.size > 0) {
            const rtNow = performance.now()
            if (rtVisibleIdsSourceRef.current !== td.busRoutes) {
              rtVisibleIdsSourceRef.current = td.busRoutes
              const next = new Set<string>()
              for (const r of td.busRoutes) next.add(r.id)
              rtVisibleIdsRef.current = next
              rtLastTickAtRef.current = 0
            }
            // RT tick at 5 Hz. DSAT polls at 15 s and dead-reckoning runs
            // between polls; 5 Hz is smooth (~3 m at 60 km/h between
            // frames) and halves the per-tick cost vs the old 10 Hz.
            if (!pausedRef.current && rtNow - rtLastTickAtRef.current >= 200) {
              rtLastTickAtRef.current = rtNow
              const visibleRouteIds = rtVisibleIdsRef.current
              const liveRouteIds = new Set<string>()
              const rtVehicles: VehiclePosition[] = []
              const pool = rtVehiclePoolRef.current
              const seenIds = new Set<string>()
              const wallNow = Date.now()
              for (const s of rtStatesRef.current.values()) {
                if (!visibleRouteIds.has(s.route.id)) continue
                const states = s.tracker.getStates()
                if (states.length === 0) continue
                liveRouteIds.add(s.route.id)
                for (const state of states) {
                  const p = s.tracker.estimateProgress(state, wallNow)
                  const pos = interpolateOnLine(s.geometry, p)
                  const id = `${s.route.id}-rt-${s.dir}-${state.plate}`
                  seenIds.add(id)
                  // Pool lookup: mutate-in-place for existing buses, fall
                  // back to a fresh object only on first sight. Downstream
                  // consumers (vehiclesToGeoJson, info panel) snapshot the
                  // fields they need each tick so in-place mutation is
                  // safe.
                  let v = pool.get(id)
                  if (!v) {
                    v = {
                      id,
                      lineId: s.route.id,
                      type: 'bus',
                      coordinates: pos.coordinates,
                      bearing: pos.bearing,
                      progress: p,
                      color: s.route.color,
                      rt: {
                        plate: state.plate,
                        speed: state.speed,
                        stopIndex: state.lastStopIdx,
                        dir: s.dir,
                        observedAt: state.lastAt,
                      },
                    }
                    pool.set(id, v)
                  } else {
                    v.coordinates = pos.coordinates
                    v.bearing = pos.bearing
                    v.progress = p
                    const rt = v.rt!
                    rt.speed = state.speed
                    rt.stopIndex = state.lastStopIdx
                    rt.observedAt = state.lastAt
                  }
                  rtVehicles.push(v)
                }
              }
              // Evict pooled entries for plates that disappeared from the
              // feed this tick — otherwise the pool would grow forever as
              // buses come off service.
              if (pool.size > seenIds.size) {
                for (const id of pool.keys()) {
                  if (!seenIds.has(id)) pool.delete(id)
                }
              }
              rtCachedVehiclesRef.current = rtVehicles
              rtCachedLiveIdsRef.current = liveRouteIds
            }
            for (const v of rtCachedVehiclesRef.current) vehicles.push(v)
          }
        }
        vehiclesRef.current = vehicles
        updateVehicleData(map, vehicles)
        if (shouldHeavy) {
          lastHeavyTick = nowTick
          bus3DRef.current?.setVehicles(vehicles.filter(v => v.type === 'bus'))
          lrt3DRef.current?.setVehicles(vehicles.filter(v => v.type === 'lrt'))
          ferry3DRef.current?.setVehicles(vehicles.filter(v => v.type === 'ferry'))
        }
        }

        // Advance local flight time smoothly from performance.now() delta.
        if (flightPerfLast === 0) {
          flightPerfLast = nowTick
          flightSimMs = clock.timeRef.current.getTime()
        } else {
          const perfDelta = nowTick - flightPerfLast
          flightPerfLast = nowTick
          if (!pausedRef.current) {
            flightSimMs += perfDelta * speedRef.current
          }
          const clockMs = clock.timeRef.current.getTime()
          if (Math.abs(flightSimMs - clockMs) > 2000) {
            flightSimMs = clockMs
          }
        }

        if (flight3DRef.current && !td.loading) {
          const flightVehicles = computeFlightOnly(td, new Date(flightSimMs))
          flightVehiclesRef.current = flightVehicles
          const flightNow = performance.now()
          const busyOk = !mapBusyRef.current || flightNow - lastFlightTick >= HEAVY_TICK_MS_BUSY
          if (shouldHeavy && busyOk) {
            lastFlightTick = flightNow
            flight3DRef.current.setVehicles(flightVehicles)
          }
          const tid = trackedRef.current
          const trackedFlight = tid
            ? flightVehicles.find(v => v.id === tid && v.type === 'flight') ?? null
            : null
          flight3DRef.current.setTrackedVehicle(trackedFlight)
        }

        const now = performance.now()
        if (now - lastCountReport > 5000) {
          lastCountReport = now
          onVehicleCountRef.current?.(vehiclesRef.current.length)
        }

        const simTime = clock.timeRef.current
        const simMinuteKey = `${simTime.getDay()}-${simTime.getHours()}-${simTime.getMinutes()}`
        if (simMinuteKey !== lastServiceMinuteRef.current) {
          lastServiceMinuteRef.current = simMinuteKey
          const schedule = getScheduleType(simTime)
          const nowMinutes = simTime.getHours() * 60 + simTime.getMinutes()

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
            const inService = win
              ? (nowMinutes >= win[0] && nowMinutes <= win[1]) ||
                (nowMinutes + 1440 >= win[0] && nowMinutes + 1440 <= win[1])
              : true
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

          if (map.getLayer('bus-routes')) {
            for (const route of td.busRoutes) {
              const key = `bus-route-${route.id}`
              const inService = isBusInService(route, simTime)
              const prev = serviceStatusRef.current.get(key)
              if (prev !== inService) {
                serviceStatusRef.current.set(key, inService)
                map.setFeatureState({ source: 'bus-routes', id: route.id }, { inService })
              }
            }
          }
        }

        const tid = trackedRef.current
        if (tid) {
          // Prefer the per-RAF flight snapshot for planes so the camera
          // follows the same position the mesh is rendered at.
          const tracked =
            flightVehiclesRef.current.find(v => v.id === tid) ??
            vehiclesRef.current.find(v => v.id === tid)
          if (tracked) {
            if (tracked.rt) {
              const sync = lastTrackedSyncRef.current
              if (sync.id !== tid || sync.observedAt !== tracked.rt.observedAt) {
                lastTrackedSyncRef.current = { id: tid, observedAt: tracked.rt.observedAt }
                onTrackedUpdateRef.current?.(tracked)
              }
            } else {
              const perfNow = performance.now()
              const sim = lastSimSyncRef.current
              if (sim.id !== tid || perfNow - sim.at >= 150) {
                lastSimSyncRef.current = { id: tid, at: perfNow }
                onTrackedUpdateRef.current?.(tracked)
              }
            }
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
                // Flights: tracked mesh just got setData'd into the 1-feature
                // tracked source and will land on this same paint, so the
                // camera can move synchronously with it. Non-flights go
                // through heavy-tick 3D layers whose step is small enough
                // that a per-RAF setCenter is likewise fine.
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
      ga.viewModeChanged(next ? '3d' : '2d')
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
    setIsDark(prev => {
      const next = !prev
      ga.themeChanged(next ? 'dark' : 'light')
      return next
    })
  }, [])

  return (
    <>
      <div ref={containerRef} className="w-full h-full" />
      {/* Hamburger + zoom (desktop top-left; phone top-1 next to TimeDisplay,
          horizontally aligned with MapLibre +/- zoom controls on the right) */}
      <div className="mm-ui-scale absolute z-10 flex items-center gap-1.5
                      top-3 left-3
                      max-sm:top-2 max-sm:left-2">
        <button
          onClick={() => setMenuOpen(o => {
            if (!o) ga.drawerOpened()
            return !o
          })}
          aria-label="menu"
          aria-expanded={menuOpen}
          className="w-9 h-9 flex items-center justify-center
                     bg-[#0a0a0b] border border-amber-300/25 text-amber-200
                     hover:bg-amber-300/10 hover:border-amber-300/50
                     active:scale-95 transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round">
            {menuOpen
              ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
              : <><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></>
            }
          </svg>
        </button>
        {/* Zoom chip — hidden on phone */}
        <div
          className="h-9 px-2.5 flex items-center gap-1.5 max-sm:hidden
                     bg-[#0a0a0b] border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
          aria-label="zoom level"
        >
          <span className="mm-mono text-[8px] tracking-[0.2em] text-white/40">ZOOM</span>
          <ZoomText subscribe={subscribeZoom} getSnapshot={getZoomSnapshot} precision={1}
                    className="mm-mono mm-tabular text-[11px] text-amber-200" />
        </div>
      </div>

      {/* Backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[35]"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Slide-out drawer — CRT / Platform style.
          100dvh (dynamic viewport height) keeps the drawer flush with the
          visible viewport on mobile browsers where the URL bar expands/
          collapses. 100vh overshoots into the hidden-under-URL-bar area,
          leaving bottom content unreachable by scroll. */}
      <div
        style={{ zoom: 1.2, height: 'calc(100dvh / 1.2)' }}
        className={`fixed top-0 left-0 z-40 w-60
                    bg-[#0b0b0d] border-r border-amber-300/20
                    shadow-[8px_0_32px_rgba(0,0,0,0.8)]
                    transition-transform duration-200 ease-out
                    ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* CRT header with scanlines */}
        <div className="relative border-b border-amber-300/20 px-3 pt-3 pb-2.5
                        bg-gradient-to-b from-amber-300/[0.04] to-transparent">
          <div
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(252,196,65,0.06) 2px, rgba(252,196,65,0.06) 3px)',
            }}
          />
          <div className="relative flex items-center justify-between mb-2">
            <span className="mm-mono text-[8px] tracking-[0.3em] text-amber-300/70">SYS.MAP v2</span>
            <span className="flex items-center gap-1 mm-mono text-[8px] tracking-wider text-emerald-300/80">
              <span className="w-1 h-1 rounded-full bg-emerald-400 mm-led-pulse" />ONLINE
            </span>
          </div>
          <div className="relative flex items-baseline gap-2">
            <div className="mm-han text-[20px] font-black tracking-[0.15em] text-amber-200 leading-none">澳門</div>
            <div className="mm-mono text-[10px] tracking-[0.3em] text-amber-300/60 leading-none">MACAU</div>
          </div>
          <div className="relative mm-mono text-[9px] tracking-[0.2em] text-white/40 mt-1">
            MINI · MAP · LIVE
          </div>
        </div>

        {/* Content */}
        <div className="p-2.5 space-y-3 overflow-y-auto" style={{ height: 'calc(100% - 100px)' }}>
          {/* Map settings */}
          <div>
            <div className="mm-mono text-[8px] tracking-[0.3em] text-white/35 px-1 pb-1.5 border-b border-white/5 flex items-center gap-1.5">
              <span
                className="inline-block w-[8px] h-[8px]"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.35) 0 1px, transparent 1px 3px)' }}
              />
              {t.mapSettings.toUpperCase()}
            </div>
            <div className="pt-1 space-y-0.5">
              <DrawerRow
                code="2D"
                label={t.plan2D}
                active={!is3D}
                onClick={() => { if (is3D) toggle3D(); setMenuOpen(false) }}
              />
              <DrawerRow
                code="3D"
                label={t.terrain3D}
                active={is3D}
                onClick={() => { if (!is3D) toggle3D(); setMenuOpen(false) }}
              />
              <DrawerRow
                code="BLD"
                label={t.buildings}
                active={showBuildings}
                onClick={() => { toggleBuildings(); setMenuOpen(false) }}
                disabled={!is3D}
              />
              <DrawerRow
                code={isDark ? 'DRK' : 'LGT'}
                label={isDark ? t.darkMode : t.lightMode}
                active
                onClick={() => { toggleTheme(); setMenuOpen(false) }}
              />
              {onToggleTimeBar && (
                <DrawerRow
                  code="TIM"
                  label={t.timeBar}
                  active={showTimeBar}
                  onClick={() => { onToggleTimeBar() }}
                />
              )}
              {RT_BUILD && rtUnlocked && (
                <DrawerRow
                  code="RT*"
                  label={t.realtimeBus}
                  active={rtEnabled}
                  onClick={() => {
                    setRtEnabled(e => {
                      const next = !e
                      localStorage.setItem('mm_rt_enabled', next ? '1' : '0')
                      window.dispatchEvent(new Event('mm-rt-changed'))
                      return next
                    })
                  }}
                />
              )}
            </div>
          </div>

          {/* Language — Segmented LCD */}
          <div>
            <div className="mm-mono text-[8px] tracking-[0.3em] text-white/35 px-1 pb-1.5 border-b border-white/5 flex items-center gap-1.5">
              <span
                className="inline-block w-[8px] h-[8px]"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.35) 0 1px, transparent 1px 3px)' }}
              />
              {t.language.toUpperCase()} · LANG
            </div>
            <div className="pt-2">
              <div className="relative flex items-stretch bg-[#050506] border border-white/10">
                {(['zh', 'pt', 'en'] as const).map((l, i) => {
                  const active = lang === l
                  return (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-2 transition
                                  ${i > 0 ? 'border-l border-white/10' : ''}
                                  ${active
                                    ? 'bg-amber-300/10 text-amber-200'
                                    : 'text-white/40 hover:text-white/70 hover:bg-white/[0.03]'}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full transition
                                    ${active ? 'bg-amber-300 mm-led-pulse' : 'bg-white/15'}`}
                        style={active ? { boxShadow: '0 0 6px rgba(252,196,65,0.95)' } : undefined}
                      />
                      <span className="mm-mono text-[13px] font-bold tracking-[0.15em] leading-none">
                        {l.toUpperCase()}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center justify-between mt-1.5 px-0.5">
                <span className="mm-mono text-[9px] tracking-wider text-amber-300/60">
                  ▸ {lang === 'zh' ? t.langNameZh : lang === 'pt' ? t.langNamePt : t.langNameEn}
                </span>
                <span className="mm-mono text-[7px] tracking-[0.2em] text-white/30">LANG.SET</span>
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="pt-2">
            <div className="bg-[#050506] border border-white/8 px-2.5 py-2">
              <div className="flex items-start gap-1.5">
                <span className="mm-mono text-[9px] tracking-[0.15em] text-amber-300/60 leading-none pt-[1px] shrink-0">⚠</span>
                <p className="text-[10px] leading-[1.55] text-white/45">
                  {t.simDisclaimer}
                </p>
              </div>
            </div>
          </div>

          {/* Data sources — label column localised, right column is proper
              nouns (DSAT / MLM / AviationStack / TurboJET / CotaiJet) that
              stay in Latin script across all three languages. */}
          <div className="pt-2">
            <div className="bg-[#050506] border border-white/8 px-2.5 py-2">
              <div className="mm-mono text-[8px] tracking-[0.25em] text-amber-300/60 mb-2 flex items-center gap-1.5">
                <span className="w-1 h-1 bg-amber-300/70 rounded-full shrink-0" />
                <span>{t.dataSources}</span>
                <span className="flex-1 h-px bg-gradient-to-r from-amber-300/20 to-transparent" />
              </div>
              <ul className="space-y-[6px]">
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceBusLabel}</span>
                  <a
                    href="https://www.dsat.gov.mo/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 hover:text-amber-200 transition-colors shrink-0"
                  >DSAT</a>
                </li>
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceLrtLabel}</span>
                  <a
                    href="https://www.mlm.com.mo/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 hover:text-amber-200 transition-colors shrink-0"
                  >MLM</a>
                </li>
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceFlightLabel}</span>
                  <a
                    href="https://aviationstack.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 hover:text-amber-200 transition-colors shrink-0"
                  >AviationStack</a>
                </li>
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceFerryLabel}</span>
                  <span className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 shrink-0">
                    <a
                      href="https://www2.turbojet.com.hk/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >TurboJET</a>
                    <span className="text-white/25 mx-[3px]">/</span>
                    <a
                      href="https://www.cotaiwaterjet.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >CotaiJet</a>
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Status footer */}
          <div className="border-t border-white/5 pt-2 mt-3 space-y-0.5">
            <div className="flex items-center justify-between mm-mono text-[8px] tracking-wider text-white/35">
              <span
                onClick={() => {
                  if (!RT_BUILD) return
                  const now = Date.now()
                  const taps = srcTapsRef.current.filter(t => now - t < 2000)
                  taps.push(now)
                  srcTapsRef.current = taps
                  if (taps.length >= 5) {
                    srcTapsRef.current = []
                    setRtUnlocked(u => {
                      const next = !u
                      localStorage.setItem('mm_rt_unlocked', next ? '1' : '0')
                      if (!next) {
                        setRtEnabled(false)
                        localStorage.setItem('mm_rt_enabled', '0')
                      }
                      return next
                    })
                  }
                }}
                className="cursor-default select-none"
              >SRC</span>
              <span className="text-white/55">{RT_BUILD && rtEnabled ? 'GTFS · RT*' : 'GTFS · SIM'}</span>
            </div>
            <div className="flex items-center justify-between mm-mono text-[8px] tracking-wider text-white/35">
              <span>ZOOM</span>
              <ZoomText subscribe={subscribeZoom} getSnapshot={getZoomSnapshot} precision={2}
                        className="mm-tabular text-amber-200/80" />
            </div>
            <div className="flex items-center justify-between mm-mono text-[8px] tracking-wider text-white/35">
              <span>MODE</span><span className="text-emerald-300/70">{is3D ? '3D.LIVE' : '2D.LIVE'}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function ZoomText({
  subscribe,
  getSnapshot,
  precision,
  className,
}: {
  subscribe: (cb: () => void) => () => void
  getSnapshot: () => number
  precision: number
  className?: string
}) {
  const z = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return <span className={className}>{z.toFixed(precision)}</span>
}

interface DrawerRowProps {
  code: string
  label: string
  active: boolean
  onClick: () => void
  disabled?: boolean
}

function DrawerRow({ code, label, active, onClick, disabled }: DrawerRowProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-2 py-1.5 text-left transition border
                  ${disabled ? 'opacity-30 cursor-not-allowed border-transparent' :
                    active ? 'bg-amber-300/[0.06] border-amber-300/15 hover:border-amber-300/30'
                           : 'border-transparent hover:bg-white/[0.04] hover:border-white/10'}`}
    >
      <span className={`mm-mono text-[9px] tracking-wider leading-none w-8 h-6 flex items-center justify-center shrink-0 border
                        ${active
                          ? 'border-amber-300/50 bg-amber-300/10 text-amber-200'
                          : 'border-white/15 bg-white/[0.02] text-white/55'}`}
            style={active ? { boxShadow: 'inset 0 0 0 1px rgba(253,224,71,0.15)' } : undefined}>
        {code}
      </span>
      <span className={`text-[12px] ${active ? 'text-amber-100' : 'text-white/80'}`}>{label}</span>
      <div className="flex-1" />
      {active && !disabled && <span className="w-1 h-1 rounded-full bg-amber-300 mm-led-pulse shrink-0" />}
    </button>
  )
}
