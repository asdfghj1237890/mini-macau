import { useRef, useEffect, useCallback, useState, useSyncExternalStore } from 'react'
import maplibregl from 'maplibre-gl'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import type { SimulationClock, TransitData, VehiclePosition, Station, Trip, LRTLine, BusRoute, RoadWorkNotice, RoadWorkRestriction, School, Toilet, CarPark, CarParkVacancy, ScheduleType } from '../types'
import { addVehicleLayers, updateVehicleData, updateVehicleLabelLang } from '../layers/VehicleLayer'
import { Bus3DLayer } from '../layers/Bus3DLayer'
import { LRT3DLayer } from '../layers/LRT3DLayer'
import { Flight3DLayer, ALL_FLIGHT_3D_LAYERS } from '../layers/Flight3DLayer'
import { Ferry3DLayer, ALL_FERRY_3D_LAYERS } from '../layers/Ferry3DLayer'
import {
  computeVehiclePositions,
  computeFlightOnly,
  getBusServiceBucket,
  getBusServiceWindow,
  getScheduleType,
} from '../engines/simulationEngine'
import { macauWeekday, macauHours, macauMinutes, macauMinutesOfDay, macauYmd, macauDayIndex } from '../macauTime'
import { ROAD_WORK_COLORS, roadWorkStatus, roadWorksHorizon } from '../roadWorks'
import { SCHOOL_FEATURE_ID_PROPERTY, buildSchoolFeatures } from '../schools'
import { TOILET_COLORS, TOILET_VARIANT_ORDER, buildToiletFeatures, toiletIconName } from '../toilets'
import { CAR_PARK_COLOR, CAR_PARK_ICON_NAME, buildCarParkFeatures } from '../carParks'
import { useI18n } from '../i18n'
import { ga } from '../analytics/ga'

declare global {
  interface Window {
    miniMacauInfo?: { open: () => void; close: () => void }
  }
}

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

function isBusInService(route: BusRoute, date: Date): boolean {
  const nowMin = macauMinutesOfDay(date)
  const window = getBusServiceWindow(route, getBusServiceBucket(date))
  if (!window) return false
  const startMin = window.start * 60
  let endWithTail = window.end * 60 + BUS_SERVICE_TAIL_MIN
  if (endWithTail <= startMin) endWithTail += 1440
  return (nowMin >= startMin && nowMin < endWithTail)
    || (nowMin + 1440 >= startMin && nowMin + 1440 < endWithTail)
}

// ---- Road works (DSAT 工程改道) overlay ----------------------------------
const ROAD_WORKS_SOURCE_ID = 'road-works'
const ROAD_WORKS_ICON_LAYER_ID = 'road-works-icon'
const ROAD_WORKS_SELECTED_LAYER_ID = 'road-works-selected'

// One marker image per colour bucket rather than per restriction, so the five
// restrictions share three canvases. The feature carries the image name in
// `icon` and the symbol layer is a plain ['get'].
const ROAD_WORK_ICON_COLORS = [...new Set(Object.values(ROAD_WORK_COLORS))]

function roadWorkIconName(restriction: RoadWorkRestriction): string {
  return `road-work-${ROAD_WORK_COLORS[restriction].slice(1)}`
}

// Device pixels; registered at pixelRatio 2, so this renders as a 22 px CSS
// marker at icon-size 1.
const ROAD_WORK_ICON_PX = 44

// Rounded warning triangle with a "!" and a 2 px white rim, drawn once per
// colour into an ImageData for map.addImage(). Returns null when the canvas
// 2D context is unavailable (headless/blocked), in which case the caller
// simply skips registering that image.
function drawRoadWorkIcon(color: string): ImageData | null {
  const size = ROAD_WORK_ICON_PX
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const border = 4 // 2 CSS px at pixelRatio 2
  const inset = border / 2 + 1
  const cx = size / 2
  const top = inset
  const bottom = size - inset
  const half = (size - inset * 2) / 2
  const pts: [number, number][] = [[cx, top], [cx + half, bottom], [cx - half, bottom]]
  const mid = (a: [number, number], b: [number, number]): [number, number] =>
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

  ctx.beginPath()
  const start = mid(pts[2], pts[0])
  ctx.moveTo(start[0], start[1])
  for (let i = 0; i < 3; i++) {
    const v = pts[i]
    const m = mid(v, pts[(i + 1) % 3])
    ctx.arcTo(v[0], v[1], m[0], m[1], 6)
  }
  ctx.closePath()

  ctx.fillStyle = color
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = border
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.round(size * 0.4)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Optical centre of a triangle sits below its geometric centre.
  ctx.fillText('!', cx, top + (bottom - top) * 0.62)

  return ctx.getImageData(0, 0, size, size)
}

// Markers for one simulated Macau calendar day: `active` = in force, dimmed
// `upcoming` = starts within the next week. Everything else is omitted.
function buildRoadWorkFeatures(
  notices: RoadWorkNotice[],
  ymd: string,
  ymdHorizon: string,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const n of notices) {
    const status = roadWorkStatus(n, ymd, ymdHorizon)
    if (!status) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: n.coordinates },
      properties: {
        id: n.id,
        restriction: n.restriction,
        status,
        icon: roadWorkIconName(n.restriction),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// ---- Public toilets (IAM 公廁) overlay -----------------------------------
const TOILETS_SOURCE_ID = 'toilets'
const TOILETS_ICON_LAYER_ID = 'toilets-icon'
const TOILETS_SELECTED_LAYER_ID = 'toilets-selected'

// Device pixels; registered at pixelRatio 2, so this renders as a 20 px CSS
// marker at icon-size 1.
const TOILET_ICON_PX = 40

// Rounded square in the variant colour with a white rim and a bold "WC", drawn
// once per variant into an ImageData for map.addImage(). Deliberately a canvas
// glyph rather than an emoji: the toilet emoji renders differently on every
// platform and can't be recoloured. Returns null when the 2D context is
// unavailable (headless/blocked), in which case the caller skips that image.
function drawToiletIcon(color: string): ImageData | null {
  const size = TOILET_ICON_PX
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const border = 3 // 1.5 CSS px at pixelRatio 2
  const inset = border / 2 + 1
  const r = 6 // 3 CSS px corner radius
  const x = inset
  const y = inset
  const w = size - inset * 2
  const h = size - inset * 2

  // Hand-rolled rounded rect: ctx.roundRect() is still missing on enough
  // engines that a fallback would be needed anyway.
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()

  ctx.fillStyle = color
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = border
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.round(size * 0.45)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('WC', size / 2, size / 2 + 1)

  return ctx.getImageData(0, 0, size, size)
}

// ---- Public car parks (DSAT 停車場) overlay -------------------------------
const CAR_PARKS_SOURCE_ID = 'car-parks'
const CAR_PARKS_ICON_LAYER_ID = 'car-parks-icon'
const CAR_PARKS_SELECTED_LAYER_ID = 'car-parks-selected'

// Same device-pixel budget as the toilet marker (registered at pixelRatio 2).
const CAR_PARK_ICON_PX = 40

// The universal blue "P" plate, drawn the same way as the WC marker so the two
// city overlays read as one family. Returns null when the 2D context is
// unavailable, in which case the caller skips the image.
function drawCarParkIcon(color: string): ImageData | null {
  const size = CAR_PARK_ICON_PX
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const border = 3 // 1.5 CSS px at pixelRatio 2
  const inset = border / 2 + 1
  const r = 6 // 3 CSS px corner radius
  const x = inset
  const y = inset
  const w = size - inset * 2
  const h = size - inset * 2

  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()

  ctx.fillStyle = color
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = border
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.round(size * 0.62)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('P', size / 2, size / 2 + 1)

  return ctx.getImageData(0, 0, size, size)
}

// ---- Schools overlay ----------------------------------------------------
// Our own coloured fill-extrusion, drawn directly above `3d-buildings`. The
// basemap tiles merge same-height buildings into one feature, so tinting them
// per building is impossible — see the header of src/schools.ts.
const SCHOOLS_SOURCE_ID = 'school-buildings'
const SCHOOLS_LAYER_ID = 'school-buildings'
// Colour of the selected school's blocks. Every building of a school shares
// the promoted feature id, so the `selected` feature-state below repaints the
// whole campus at once.
const SCHOOL_SELECTED_COLOR = '#ffffff'

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
  onRoadWorkClick?: (notice: RoadWorkNotice | null) => void
  // `buildingName` is the clicked footprint's OSM name — null for the many
  // unnamed campus buildings.
  onSchoolClick?: (school: School, buildingName: string | null) => void
  onToiletClick?: (toilet: Toilet | null) => void
  onCarParkClick?: (carPark: CarPark | null) => void
  // Live vacancy keyed by car-park id, from useCarParkVacancy. A new Map
  // identity (≈ every 30 s while polling) is what re-labels the markers.
  carParkVacancy?: Map<string, CarParkVacancy> | null
  onClearSelection?: () => void
  trackedVehicleId?: string | null
  selectedRoadWorkId?: string | null
  selectedSchoolId?: string | null
  selectedToiletId?: string | null
  selectedCarParkId?: string | null
  onVehicleCount?: (count: number) => void
  showTimeBar?: boolean
  onToggleTimeBar?: () => void
}

export function MapView({ clock, transitData, allTransitData, onVehicleClick, onTrackedVehicleUpdate, onStationClick, onRoadWorkClick, onSchoolClick, onToiletClick, onCarParkClick, carParkVacancy, onClearSelection, trackedVehicleId, selectedRoadWorkId, selectedSchoolId, selectedToiletId, selectedCarParkId, onVehicleCount, showTimeBar = true, onToggleTimeBar }: Props) {
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
  const { lang, t, setLang } = useI18n()
  const isDarkRef = useRef(isDark)
  const langRef = useRef(lang)
  const is3DRef = useRef(is3D)
  const showBuildingsRef = useRef(showBuildings)
  isDarkRef.current = isDark
  langRef.current = lang
  is3DRef.current = is3D
  showBuildingsRef.current = showBuildings
  // Mirrors the selected road-work id so addCustomLayers can restore the
  // highlight filter after a style swap (setStyle drops every layer).
  const selectedRoadWorkIdRef = useRef<string | null>(selectedRoadWorkId ?? null)
  selectedRoadWorkIdRef.current = selectedRoadWorkId ?? null
  // Last (notice array, Macau calendar day) the road-works source was built
  // from. Comparing these keeps the RAF tick allocation-free: the day string
  // is only recomputed when the simulated minute rolls over.
  const roadWorksRenderRef = useRef<{ notices: RoadWorkNotice[] | null; day: number }>(
    { notices: null, day: -1 }
  )
  // Mirrors the selected school id for the same reason: setStyle drops every
  // source AND its feature state, so addCustomLayers has to re-apply it.
  const selectedSchoolIdRef = useRef<string | null>(selectedSchoolId ?? null)
  selectedSchoolIdRef.current = selectedSchoolId ?? null
  // The id whose `selected` feature-state is currently set on the map, so the
  // effect clears exactly one entry instead of walking all 76 schools.
  const schoolStateIdRef = useRef<string | null>(null)
  // Same style-swap contract as the road works: the toilet highlight is a
  // filter on the marker source, so addCustomLayers needs the current id.
  const selectedToiletIdRef = useRef<string | null>(selectedToiletId ?? null)
  selectedToiletIdRef.current = selectedToiletId ?? null
  // Same for the car parks, plus the live vacancy map — addCustomLayers seeds
  // the source with whatever numbers are already in hand after a style swap.
  const selectedCarParkIdRef = useRef<string | null>(selectedCarParkId ?? null)
  selectedCarParkIdRef.current = selectedCarParkId ?? null
  const carParkVacancyRef = useRef<Map<string, CarParkVacancy> | null>(carParkVacancy ?? null)
  carParkVacancyRef.current = carParkVacancy ?? null

  // Highlight = one feature-state per school id. `promoteId` makes every
  // building of a school share that id, so this single pair of calls repaints
  // the whole campus — no setPaintProperty, which would recompile the layer.
  const applySchoolSelection = useCallback((m: maplibregl.Map) => {
    // The style can be mid-swap (setStyle → the sources are gone until
    // style.load re-adds them); setFeatureState would throw on a missing one.
    if (!m.getSource(SCHOOLS_SOURCE_ID)) return
    const next = selectedSchoolIdRef.current
    const prev = schoolStateIdRef.current
    if (prev && prev !== next) {
      m.setFeatureState({ source: SCHOOLS_SOURCE_ID, id: prev }, { selected: false })
    }
    if (next) m.setFeatureState({ source: SCHOOLS_SOURCE_ID, id: next }, { selected: true })
    schoolStateIdRef.current = next
  }, [])

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

  const pausedRef = useRef(clock.paused)
  pausedRef.current = clock.paused
  const speedRef = useRef(clock.speed)
  speedRef.current = clock.speed
  // `timeRef` is a stable ref off the clock. Pull it out as a plain identifier
  // so effects can depend on it without depending on the whole `clock` object
  // (which is a fresh literal every render and would restart RAF loops).
  const { timeRef } = clock

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

      // Hoisted out of the try below so the schools layer can reuse it as its
      // beforeId even if the building tiles fail to load.
      let firstSymbolId: string | undefined

      try {
        // Anchor the extrusions below the labels but ABOVE the basemap's own
        // 2D building fills. Dark Matter orders `building`/`building-top`
        // before its first symbol layer, but Positron's first symbol layer
        // (`waterway_label`) comes long before them — anchoring on it there
        // put the 3D blocks under the flat building fills, which then
        // painted over them. So: the first symbol layer AFTER the last
        // building fill, falling back to the first symbol layer at all.
        const styleLayers = m.getStyle().layers ?? []
        let lastBuildingFill = -1
        styleLayers.forEach((l, i) => {
          if (l.type === 'fill' && /^building/.test(l.id)) lastBuildingFill = i
        })
        for (let i = 0; i < styleLayers.length; i++) {
          const l = styleLayers[i]
          if (l.type === 'symbol' && i > lastBuildingFill) { firstSymbolId = l.id; break }
        }
        if (!firstSymbolId) {
          for (const l of styleLayers) {
            if (l.type === 'symbol') { firstSymbolId = l.id; break }
          }
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

      // Schools. Inserted at the same anchor as `3d-buildings` and right
      // after it, so the coloured campus blocks sit directly on top of the
      // basemap extrusions and still below every label and vehicle layer
      // (those are added later in this function). Deliberately NOT gated on
      // the BLD toggle or on 2D/3D: the overlay is a data layer of its own,
      // and in 2D it simply reads as flat colour patches.
      //
      // Seeded from transitRef (not a closure) because addCustomLayers also
      // runs after a theme swap, long after schools.json has landed — the
      // [transitData.schools] effect below only fires on identity changes.
      m.addSource(SCHOOLS_SOURCE_ID, {
        type: 'geojson',
        data: buildSchoolFeatures(transitRef.current.schools),
        // All buildings of one school carry the same `schoolId`, so promoting
        // it to the feature id lets a single setFeatureState light up the
        // whole campus (see applySchoolSelection).
        promoteId: SCHOOL_FEATURE_ID_PROPERTY,
      })
      // Height follows the SAME z14→z15.5 ramp as the basemap buildings above,
      // so a school block stays exactly 0.5 m proud of its grey neighbours
      // while they grow, and degrades to a flat coloured footprint (height 0)
      // at the zooms where the basemap draws no buildings at all.
      m.addLayer({
        id: SCHOOLS_LAYER_ID, type: 'fill-extrusion', source: SCHOOLS_SOURCE_ID,
        paint: {
          'fill-extrusion-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            SCHOOL_SELECTED_COLOR,
            ['get', 'color'],
          ],
          'fill-extrusion-height': [
            'interpolate', ['linear'], ['zoom'],
            14, 0, 15.5, ['get', 'height'],
          ],
          'fill-extrusion-base': [
            'interpolate', ['linear'], ['zoom'],
            14, 0, 15.5, ['get', 'minHeight'],
          ],
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': true,
        },
      }, firstSymbolId)

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
        m.addLayer({
          id: 'bus-routes-highlighted', type: 'line', source: 'bus-routes',
          filter: ['==', ['get', 'id'], ''],
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 18, 8],
            'line-opacity': 0.95,
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

      // Road works. setStyle({diff:false}) drops images along with layers, so
      // the icons are (re-)registered here on every style load, guarded by
      // hasImage. The source starts empty; the RAF tick fills it for the
      // simulated calendar day (roadWorksRenderRef is reset below).
      for (const color of ROAD_WORK_ICON_COLORS) {
        const name = `road-work-${color.slice(1)}`
        if (m.hasImage(name)) continue
        const img = drawRoadWorkIcon(color)
        if (img) m.addImage(name, img, { pixelRatio: 2 })
      }
      m.addSource(ROAD_WORKS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      m.addLayer({
        id: ROAD_WORKS_SELECTED_LAYER_ID, type: 'circle', source: ROAD_WORKS_SOURCE_ID,
        filter: ['==', ['get', 'id'], selectedRoadWorkIdRef.current ?? ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 17, 18, 22],
          'circle-color': '#ffffff',
          'circle-opacity': 0.14,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.75,
        },
      })
      m.addLayer({
        id: ROAD_WORKS_ICON_LAYER_ID, type: 'symbol', source: ROAD_WORKS_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 13, 0.7, 15, 1, 18, 1.1],
        },
        paint: {
          'icon-opacity': ['match', ['get', 'status'], 'upcoming', 0.5, 1],
        },
      })

      // Public toilets. Same image contract as the road works — setStyle
      // ({diff:false}) drops registered images with the layers, so all three
      // variants are redrawn here under a hasImage guard. Unlike road works
      // this data has no time dimension, so the source is seeded straight from
      // transitRef (which also covers a theme swap long after toilets.json
      // landed) and only refreshed by the [transitData.toilets] effect below.
      for (const variant of TOILET_VARIANT_ORDER) {
        const name = toiletIconName(variant)
        if (m.hasImage(name)) continue
        const img = drawToiletIcon(TOILET_COLORS[variant])
        if (img) m.addImage(name, img, { pixelRatio: 2 })
      }
      m.addSource(TOILETS_SOURCE_ID, {
        type: 'geojson',
        data: buildToiletFeatures(transitRef.current.toilets),
      })
      m.addLayer({
        id: TOILETS_SELECTED_LAYER_ID, type: 'circle', source: TOILETS_SOURCE_ID,
        filter: ['==', ['get', 'id'], selectedToiletIdRef.current ?? ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 17, 18, 22],
          'circle-color': '#ffffff',
          'circle-opacity': 0.14,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.75,
        },
      })
      m.addLayer({
        id: TOILETS_ICON_LAYER_ID, type: 'symbol', source: TOILETS_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'icon'],
          // 33 toilets share a point with another and many more sit metres
          // apart, so collision-hiding would silently drop them — overlap.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 15, 1],
        },
        paint: {
          // Suspended toilets read as "there, but not usable".
          'icon-opacity': ['match', ['get', 'variant'], 'closed', 0.55, 1],
        },
      })

      // Public car parks. Same contract as the toilets: the image is redrawn
      // here on every style load under a hasImage guard, and the source is
      // seeded from transitRef + the vacancy ref so a theme swap keeps both
      // the markers and their live numbers.
      if (!m.hasImage(CAR_PARK_ICON_NAME)) {
        const img = drawCarParkIcon(CAR_PARK_COLOR)
        if (img) m.addImage(CAR_PARK_ICON_NAME, img, { pixelRatio: 2 })
      }
      m.addSource(CAR_PARKS_SOURCE_ID, {
        type: 'geojson',
        data: buildCarParkFeatures(transitRef.current.carParks, carParkVacancyRef.current),
      })
      m.addLayer({
        id: CAR_PARKS_SELECTED_LAYER_ID, type: 'circle', source: CAR_PARKS_SOURCE_ID,
        filter: ['==', ['get', 'id'], selectedCarParkIdRef.current ?? ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 17, 18, 22],
          'circle-color': '#ffffff',
          'circle-opacity': 0.14,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.75,
        },
      })
      m.addLayer({
        id: CAR_PARKS_ICON_LAYER_ID, type: 'symbol', source: CAR_PARKS_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'icon'],
          // Car parks cluster along the same streets; hiding colliding pins
          // would drop half the peninsula, so they always draw.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 15, 1],
          // The vacant-car count, sitting to the right of the plate. The
          // property is only present when a live row says so (see
          // buildCarParkFeatures), so this is empty — no label — whenever the
          // numbers are unknown, suspended or not being polled.
          'text-field': ['get', 'vacancy'],
          // Labels DO collide with each other, unlike the plates: two
          // entrances of the same building sit metres apart and their numbers
          // would otherwise overprint. `text-optional` keeps the icon when its
          // label loses, and `symbol-sort-key` (ascending numeric id) makes the
          // winner stable instead of flickering as the map moves. Below z14
          // the size steps to 0, so it is plates only at city scale.
          'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'],
          'text-size': ['step', ['zoom'], 0, 14, 10, 16, 11],
          'text-offset': [0.9, 0],
          'text-anchor': 'left',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-optional': true,
          'symbol-sort-key': ['get', 'sortKey'],
        },
        paint: {
          'text-color': '#dbeafe',
          'text-halo-color': '#0b0b0c',
          'text-halo-width': 1.2,
        },
      })

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
      // Force the next tick to repopulate the (now empty) road-works source.
      roadWorksRenderRef.current = { notices: null, day: -1 }
      // A style swap drops feature state along with the sources, so the
      // selected school has to be re-marked on the freshly added source.
      schoolStateIdRef.current = null
      applySchoolSelection(m)
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

      m.on('click', ROAD_WORKS_ICON_LAYER_ID, (e) => {
        const feature = e.features?.[0]
        if (feature) {
          const nid = feature.properties?.id
          // Look the notice up in the CURRENT list (transitRef), not a
          // closed-over snapshot — road-works.json lands after this handler
          // is attached, and the legend toggle swaps the array.
          const notice = transitRef.current.roadWorks.find(n => n.id === nid)
          if (notice) { onRoadWorkClick?.(notice); e.preventDefault() }
        }
      })
      m.on('mouseenter', ROAD_WORKS_ICON_LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', ROAD_WORKS_ICON_LAYER_ID, () => { m.getCanvas().style.cursor = '' })

      // Registered BEFORE the vehicle handlers: delegated listeners fire in
      // registration order, so a bus parked over a campus block still wins.
      m.on('click', SCHOOLS_LAYER_ID, (e) => {
        const feature = e.features?.[0]
        if (feature) {
          const sid = feature.properties?.[SCHOOL_FEATURE_ID_PROPERTY]
          // Current list (transitRef), not a closed-over snapshot —
          // schools.json lands after this handler is attached.
          const school = transitRef.current.schools.find(s => s.id === sid)
          if (school) {
            const name = feature.properties?.name
            onSchoolClick?.(school, typeof name === 'string' && name ? name : null)
            e.preventDefault()
          }
        }
      })
      m.on('mouseenter', SCHOOLS_LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', SCHOOLS_LAYER_ID, () => { m.getCanvas().style.cursor = '' })

      // Also registered before the vehicle handlers, for the same reason: a
      // bus driving over a WC pin should still win the click.
      m.on('click', TOILETS_ICON_LAYER_ID, (e) => {
        const feature = e.features?.[0]
        if (feature) {
          const tid = feature.properties?.id
          // Current list (transitRef), not a closed-over snapshot —
          // toilets.json lands after this handler is attached, and the legend
          // toggle swaps the array. Toilets sharing a coordinate resolve to
          // the first hit, which is what the marker stack shows anyway.
          const toilet = transitRef.current.toilets.find(x => x.id === tid)
          if (toilet) { onToiletClick?.(toilet); e.preventDefault() }
        }
      })
      m.on('mouseenter', TOILETS_ICON_LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', TOILETS_ICON_LAYER_ID, () => { m.getCanvas().style.cursor = '' })

      // Car-park pins, registered before the vehicle handlers for the same
      // reason: a bus passing over a "P" should not steal the click.
      m.on('click', CAR_PARKS_ICON_LAYER_ID, (e) => {
        const feature = e.features?.[0]
        if (feature) {
          const cpid = feature.properties?.id
          // Current list (transitRef), not a closed-over snapshot —
          // car-parks.json lands after this handler is attached and the
          // legend toggle swaps the array.
          const carPark = transitRef.current.carParks.find(x => x.id === cpid)
          if (carPark) { onCarParkClick?.(carPark); e.preventDefault() }
        }
      })
      m.on('mouseenter', CAR_PARKS_ICON_LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', CAR_PARKS_ICON_LAYER_ID, () => { m.getCanvas().style.cursor = '' })

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
          layers: ['vehicles-circle', 'stations-circle', ROAD_WORKS_ICON_LAYER_ID, SCHOOLS_LAYER_ID, TOILETS_ICON_LAYER_ID, CAR_PARKS_ICON_LAYER_ID, ...model3DLayers],
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
    // Initialize the map once, when transit data first loads (these array
    // lengths flip 0 → N). It deliberately must NOT re-run when callbacks,
    // is3D, or the data-array identities change: that would tear down and
    // rebuild the entire MapLibre instance and re-attach the delegated click
    // handlers (the source of a past "vehicles aren't clickable" regression).
    // The parent's onVehicleClick / onStationClick / onClearSelection are
    // stable useCallback refs, and only is3D's initial value is needed at
    // construction, so capturing them once here is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Selected road-work highlight. setFilter (not setPaintProperty) so the
  // change is a cheap filter swap on the existing source.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer(ROAD_WORKS_SELECTED_LAYER_ID)) return
    map.setFilter(ROAD_WORKS_SELECTED_LAYER_ID, ['==', ['get', 'id'], selectedRoadWorkId ?? ''])
  }, [selectedRoadWorkId])

  // School blocks. Unlike every other overlay this data does not depend on
  // the simulated clock, so it is pushed here on array-identity change
  // (schools.json arriving, or the legend toggle swapping in []) instead of
  // from the RAF tick. A style rebuild is covered by addCustomLayers seeding
  // the source from transitRef.
  useEffect(() => {
    const map = mapRef.current
    const src = map?.getSource(SCHOOLS_SOURCE_ID) as unknown as
      { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    src?.setData?.(buildSchoolFeatures(transitData.schools))
  }, [transitData.schools])

  // Selected school highlight. Feature state survives setData, so this only
  // has to run when the selection itself changes (a style swap is covered by
  // addCustomLayers re-applying it).
  useEffect(() => {
    const map = mapRef.current
    if (map) applySchoolSelection(map)
  }, [selectedSchoolId, applySchoolSelection])

  // Toilet markers. Like the school blocks (and unlike the road works) this
  // data is independent of the simulated clock, so it is pushed here on array
  // identity change — toilets.json arriving, or the legend toggle swapping in
  // the empty array — and never from the RAF tick.
  useEffect(() => {
    const map = mapRef.current
    const src = map?.getSource(TOILETS_SOURCE_ID) as unknown as
      { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    src?.setData?.(buildToiletFeatures(transitData.toilets))
  }, [transitData.toilets])

  // Selected toilet highlight — a filter swap on the existing source, same as
  // the road-work ring.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer(TOILETS_SELECTED_LAYER_ID)) return
    map.setFilter(TOILETS_SELECTED_LAYER_ID, ['==', ['get', 'id'], selectedToiletId ?? ''])
  }, [selectedToiletId])

  // Car-park markers. Pushed on array identity (the file arriving, the legend
  // toggle swapping in the empty array) AND on vacancy-map identity, which
  // changes at most once per 30 s poll — never from the RAF tick, so the
  // labels cost nothing between fetches.
  useEffect(() => {
    const map = mapRef.current
    const src = map?.getSource(CAR_PARKS_SOURCE_ID) as unknown as
      { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    src?.setData?.(buildCarParkFeatures(transitData.carParks, carParkVacancy))
  }, [transitData.carParks, carParkVacancy])

  // Selected car-park highlight — a filter swap, same as the toilet ring.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer(CAR_PARKS_SELECTED_LAYER_ID)) return
    map.setFilter(CAR_PARKS_SELECTED_LAYER_ID, ['==', ['get', 'id'], selectedCarParkId ?? ''])
  }, [selectedCarParkId])

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
  const onClearSelectionRef = useRef(onClearSelection)
  onClearSelectionRef.current = onClearSelection
  const lastSimSyncRef = useRef<{ id: string | null; at: number }>({ id: null, at: 0 })
  transitRef.current = transitData
  trackedRef.current = trackedVehicleId

  useEffect(() => {
    const apply = () => {
      const m = mapRef.current
      if (!m || !m.getLayer('bus-routes-highlighted')) return
      const isWide = window.matchMedia('(min-width: 640px)').matches
      let lineId = ''
      if (isWide && trackedVehicleId) {
        const v = vehiclesRef.current.find(v => v.id === trackedVehicleId)
        if (v && v.type === 'bus') lineId = v.lineId
      }
      m.setFilter('bus-routes-highlighted', ['==', ['get', 'id'], lineId])
    }

    apply()
    const mq = window.matchMedia('(min-width: 640px)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [trackedVehicleId])

  const mapBusyRef = useRef(false)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const PAUSE_MS = 500
    const markInteracting = () => {
      userInteractingUntilRef.current = performance.now() + PAUSE_MS
    }

    const onMoveStart = () => { mapBusyRef.current = true }
    const onMoveEnd = () => { mapBusyRef.current = false }

    const canvas = map.getCanvas()
    canvas.addEventListener('wheel', markInteracting, { passive: true })
    canvas.addEventListener('mousedown', markInteracting)
    canvas.addEventListener('touchstart', markInteracting, { passive: true })
    map.on('movestart', onMoveStart)
    map.on('moveend', onMoveEnd)

    return () => {
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
    // Exponential camera smoothing for tracked vehicles. setCenter is
    // synchronous but setData (3D mesh) goes through the worker; the
    // 1-2 frame latency variance makes the mesh oscillate relative to
    // the viewport center. Smoothing the camera with alpha < 1 acts as
    // a low-pass filter, damping that high-frequency oscillation to
    // sub-pixel levels at the cost of a tiny consistent lag (~0.3 m at
    // 10× taxi speed).
    let smoothCam: [number, number] | null = null
    const CAM_ALPHA = 0.8

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
          const vehicles = computeVehiclePositions(td, timeRef.current)
          vehiclesRef.current = vehicles
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
          flightSimMs = timeRef.current.getTime()
        } else {
          const perfDelta = nowTick - flightPerfLast
          flightPerfLast = nowTick
          if (!pausedRef.current) {
            flightSimMs += perfDelta * speedRef.current
          }
          const clockMs = timeRef.current.getTime()
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

        // Merge per-RAF flight positions into the 2D marker source so the
        // dot tracks the 3D model at the same rate. Non-flight vehicles
        // keep their shouldTick-rate positions (bus/LRT/ferry move slowly
        // enough that 30 Hz is imperceptible).
        const freshFlights = flightVehiclesRef.current
        if (freshFlights.length > 0) {
          const flightIds = new Set<string>()
          for (const f of freshFlights) flightIds.add(f.id)
          const base = vehiclesRef.current
          const merged: VehiclePosition[] = []
          for (let i = 0; i < base.length; i++) {
            if (!flightIds.has(base[i].id)) merged.push(base[i])
          }
          for (const f of freshFlights) merged.push(f)
          updateVehicleData(map, merged)
        } else {
          updateVehicleData(map, vehiclesRef.current)
        }

        const now = performance.now()
        if (now - lastCountReport > 5000) {
          lastCountReport = now
          onVehicleCountRef.current?.(vehiclesRef.current.length)
        }

        const simTime = timeRef.current
        const simMinuteKey = `${macauWeekday(simTime)}-${macauHours(simTime)}-${macauMinutes(simTime)}`
        if (simMinuteKey !== lastServiceMinuteRef.current) {
          lastServiceMinuteRef.current = simMinuteKey
          const schedule = getScheduleType(simTime)
          const nowMinutes = macauHours(simTime) * 60 + macauMinutes(simTime)

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

        // Road works follow the SIMULATED calendar day, not wall time. The
        // FeatureCollection is rebuilt only when that day changes or the
        // notice array identity changes (data arrival / legend toggle), so
        // the per-frame cost here is one integer and one reference compare.
        // The day is gated on `macauDayIndex`, not on the weekday/H/M minute
        // key above: a ±7-day jump from the date picker keeps that key
        // byte-identical but must still swap the marker set.
        const rw = roadWorksRenderRef.current
        const rwDay = macauDayIndex(simTime)
        if (rw.notices !== td.roadWorks || rw.day !== rwDay) {
          const src = map.getSource(ROAD_WORKS_SOURCE_ID) as unknown as
            { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
          if (src?.setData) {
            rw.notices = td.roadWorks
            rw.day = rwDay
            const rwYmd = macauYmd(simTime)
            src.setData(buildRoadWorkFeatures(td.roadWorks, rwYmd, roadWorksHorizon(simTime)))
          }
        }

        const tid = trackedRef.current
        if (tid) {
          // Prefer the per-RAF flight snapshot for planes so the camera
          // follows the same position the mesh is rendered at.
          const tracked =
            flightVehiclesRef.current.find(v => v.id === tid) ??
            vehiclesRef.current.find(v => v.id === tid)
          if (!tracked && prevTrackedRef.current === tid) {
            // Tracked vehicle dropped out of the simulation (service ended,
            // schedule ran out, scrubbed to a time outside its window, etc).
            // Clear the selection so the info panel closes instead of
            // showing stale extrapolated ETAs.
            // Reset prevTracked + smoothCam first so this branch fires
            // exactly once until React rolls trackedVehicleId back to null.
            prevTrackedRef.current = null
            smoothCam = null
            onClearSelectionRef.current?.()
          } else if (tracked) {
            const perfNow = performance.now()
            const sim = lastSimSyncRef.current
            if (sim.id !== tid || perfNow - sim.at >= 150) {
              lastSimSyncRef.current = { id: tid, at: perfNow }
              onTrackedUpdateRef.current?.(tracked)
            }
            const isNewTrack = prevTrackedRef.current !== tid
            const now = performance.now()
            const userBusy = now < userInteractingUntilRef.current
            const justResumed = wasUserBusyRef.current && !userBusy
            wasUserBusyRef.current = userBusy

            if (isNewTrack) {
              prevTrackedRef.current = tid
              smoothCam = null
              flyingUntilRef.current = now + FLY_DURATION
              map.flyTo({
                center: [tracked.coordinates[0], tracked.coordinates[1]],
                zoom: Math.max(map.getZoom(), TRACK_ZOOM),
                duration: FLY_DURATION,
              })
            } else if (now > flyingUntilRef.current && !userBusy) {
              if (justResumed) {
                smoothCam = null
                flyingUntilRef.current = now + EASE_BACK_DURATION
                map.easeTo({
                  center: [tracked.coordinates[0], tracked.coordinates[1]],
                  duration: EASE_BACK_DURATION,
                })
              } else if (smoothCam) {
                smoothCam[0] += (tracked.coordinates[0] - smoothCam[0]) * CAM_ALPHA
                smoothCam[1] += (tracked.coordinates[1] - smoothCam[1]) * CAM_ALPHA
                map.setCenter(smoothCam)
              } else {
                smoothCam = [tracked.coordinates[0], tracked.coordinates[1]]
                map.setCenter(smoothCam)
              }
            }
          }
        } else if (prevTrackedRef.current !== null) {
          prevTrackedRef.current = null
          smoothCam = null
        }
      }
      raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [timeRef])

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
              <DrawerRow
                code="NFO"
                label={t.about}
                active={false}
                onClick={() => { ga.infoPanelOpened(); window.miniMacauInfo?.open(); setMenuOpen(false) }}
              />
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
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceRoadWorksLabel}</span>
                  <span className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 shrink-0">
                    <a
                      href="https://www.dsat.gov.mo/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >DSAT</a>
                    <span className="text-white/25 mx-[3px]">/</span>
                    <a
                      href="https://data.gov.mo/Detail?id=81c17efc-3e92-484e-ab14-de7fa0f90f01"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >data.gov.mo</a>
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceSchoolsLabel}</span>
                  <span className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 shrink-0">
                    <a
                      href="https://www.dsedj.gov.mo/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >DSEDJ</a>
                    <span className="text-white/25 mx-[3px]">/</span>
                    <a
                      href="https://www.openstreetmap.org/copyright"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >OSM</a>
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceToiletsLabel}</span>
                  <span className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 shrink-0">
                    <a
                      href="https://www.iam.gov.mo/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >IAM</a>
                    <span className="text-white/25 mx-[3px]">/</span>
                    <a
                      href="https://data.gov.mo/Detail?id=f6a9892d-7e16-49f0-bcd3-573d670cefe5"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >data.gov.mo</a>
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceCarParksLabel}</span>
                  <span className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 shrink-0">
                    <a
                      href="https://www.dsat.gov.mo/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >DSAT</a>
                    <span className="text-white/25 mx-[3px]">/</span>
                    <a
                      href="https://data.gov.mo/Detail?id=ac55c2f1-780a-4dc8-875f-851b2203b706"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >data.gov.mo</a>
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Status footer */}
          <div className="border-t border-white/5 pt-2 mt-3 space-y-0.5">
            <div className="flex items-center justify-between mm-mono text-[8px] tracking-wider text-white/35">
              <span className="cursor-default select-none">SRC</span>
              <span className="text-white/55">GTFS · SIM</span>
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
