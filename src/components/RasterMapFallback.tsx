import { useEffect, useLayoutEffect, useRef } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './rasterMapFallback.css'
import type { MapViewProps } from './MapView'
import type { VehiclePosition } from '../types'
import { computeVehiclePositions } from '../engines/simulationEngine'
import { localName, useI18n } from '../i18n'
import { debugLog } from '../debugOverlay'
import { ROAD_WORK_COLORS, roadWorkStatus, roadWorksHorizon } from '../roadWorks'
import { macauYmd } from '../macauTime'
import { useClockMinute } from '../hooks/useSimulationClock'
import { grandPrixCarState } from '../grandPrix'
import { publicHousingColor } from '../publicHousing'
import { schoolColor } from '../schools'

type Props = MapViewProps & {
  initialCamera: { center: [number, number]; zoom: number } | null
  onRetry: (camera: { center: [number, number]; zoom: number }) => void
}
const latLng = ([lng, lat]: number[]): L.LatLngTuple => [lat, lng]
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

// Loaded only after WebGL fails. Raster tiles and Leaflet's Canvas2D renderer
// never ask for a WebGL context, including when the browser cannot restore one.
export default function RasterMapFallback(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const live = useRef(props)
  const { lang, t } = useI18n()
  const minute = useClockMinute(props.clock)
  const { transitData, wasteExtras } = props
  useLayoutEffect(() => {
    live.current = props
  }, [props])

  useEffect(() => {
    if (!host.current) return
    const camera = live.current.initialCamera
    const map = L.map(host.current, {
      center: latLng(camera?.center ?? [113.5592, 22.1604]),
      // MapLibre uses a 512px world tile; Leaflet uses 256px. +1 preserves scale.
      zoom: Math.min(19, (camera?.zoom ?? 13) + 1), minZoom: 3, maxZoom: 19,
      preferCanvas: true, attributionControl: false, zoomControl: false,
      zoomAnimation: false, fadeAnimation: false,
    })
    mapRef.current = map
    map.createPane('vehicles').style.zIndex = '450'
    L.control.zoom({ position: 'topleft' }).addTo(map)
    L.tileLayer(TILE_URL, {
      maxZoom: 19, detectRetina: false,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    map.on('click', () => live.current.onClearSelection?.())
    const resize = new ResizeObserver(() => map.invalidateSize())
    resize.observe(host.current)
    const markers = new Map<string, { marker: L.CircleMarker; vehicle: VehiclePosition }>()
    let raceCar: L.CircleMarker | null = null
    let count = -1
    const tick = () => {
      if (document.hidden) return
      const p = live.current
      const vehicles = computeVehiclePositions(p.transitData, p.clock.timeRef.current)
      const ids = new Set(vehicles.map(v => v.id))
      for (const [id, entry] of markers) {
        if (!ids.has(id)) { entry.marker.remove(); markers.delete(id) }
      }
      for (const vehicle of vehicles) {
        const existing = markers.get(vehicle.id)
        if (existing) {
          existing.vehicle = vehicle
          existing.marker.setLatLng(latLng(vehicle.coordinates))
        } else {
          const marker = L.circleMarker(latLng(vehicle.coordinates), {
            pane: 'vehicles',
            radius: vehicle.type === 'bus' ? 4 : 6, color: vehicle.color,
            fillColor: vehicle.color, fillOpacity: 1, weight: 1, bubblingMouseEvents: false,
          }).addTo(map)
          const entry = { marker, vehicle }
          marker.on('click', () => live.current.onVehicleClick?.(entry.vehicle))
          markers.set(vehicle.id, entry)
        }
        if (vehicle.id === p.trackedVehicleId) {
          p.onTrackedVehicleUpdate?.(vehicle)
          map.panTo(latLng(vehicle.coordinates), { animate: false })
        }
      }
      const race = p.transitData.grandPrix
      const pose = race && grandPrixCarState(race, p.clock.timeRef.current.getTime(), map.getZoom() - 1)?.pose
      if (pose) {
        if (!raceCar) {
          raceCar = L.circleMarker([pose.lat, pose.lng], {
            pane: 'vehicles', radius: 6, color: '#fff', fillColor: '#f43f5e',
            fillOpacity: 1, weight: 2, bubblingMouseEvents: false,
          }).addTo(map).on('click', () => {
            const circuit = live.current.transitData.grandPrix
            if (circuit) live.current.onGrandPrixCircuitClick?.(circuit)
          })
        } else raceCar.setLatLng([pose.lat, pose.lng])
      } else { raceCar?.remove(); raceCar = null }
      if (vehicles.length !== count) { count = vehicles.length; p.onVehicleCount?.(count) }
    }
    tick()
    const timer = window.setInterval(tick, 150)
    debugLog('[map] 2D raster fallback started (no WebGL)')
    return () => {
      window.clearInterval(timer)
      resize.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Tracking updates the parent every tick. Only rebuild static layers when
    // their data, language or simulated minute changes; callbacks stay current.
    const data = transitData
    const group = L.layerGroup().addTo(map)
    const point = (coords: [number, number], caption: string, color: string, click?: () => void) => {
      const label = document.createElement('span')
      label.textContent = caption
      const marker = L.circleMarker(latLng(coords), {
        radius: 5, color, fillColor: color, fillOpacity: 0.8, weight: 1,
        bubblingMouseEvents: false,
      }).bindTooltip(label).addTo(group)
      if (click) marker.on('click', click)
    }
    const line = (coords: number[][], color: string, weight = 2) =>
      L.polyline(coords.map(latLng), { color, weight, opacity: 0.7 }).addTo(group)
    const name = (value: { zh: string; en?: string; pt?: string }) =>
      (lang === 'zh' ? value.zh : lang === 'pt' ? value.pt : value.en) || value.pt || value.zh
    for (const route of [...data.busRoutes, ...data.lrtLines]) line(route.geometry.geometry.coordinates, route.color)
    const stationIds = new Set(data.lrtLines.flatMap(l => l.stations))
    for (const station of data.stations) if (stationIds.has(station.id)) {
      point(station.coordinates, localName(lang, station), '#64748b', () => live.current.onStationClick?.(station))
    }
    for (const notice of data.roadWorks) if (roadWorkStatus(notice, macauYmd(minute), roadWorksHorizon(minute))) {
      point(notice.coordinates, name(notice.location), ROAD_WORK_COLORS[notice.restriction], () => live.current.onRoadWorkClick?.(notice))
    }
    // One dot per school in its level-and-era shade, the same colour rule as
    // the 3D blocks and as the housing dots below.
    for (const school of data.schools) point(school.coordinates, name(school.name), schoolColor(school.level, school.founded), () => live.current.onSchoolClick?.(school, null))
    // One dot per estate in its type-and-decade shade, the same colour rule as
    // the 3D blocks, so the 2D map keeps the overlay's two facts readable.
    for (const estate of data.publicHousing) point(estate.coordinates, name(estate.name), publicHousingColor(estate.type, estate.year), () => live.current.onPublicHousingClick?.(estate, null))
    for (const toilet of data.toilets) point(toilet.coordinates, name(toilet.name), '#14b8a6', () => live.current.onToiletClick?.(toilet))
    for (const park of data.carParks) point(park.coordinates, name(park.name), '#3b82f6', () => live.current.onCarParkClick?.(park))
    for (const site of data.waste) point(site.coordinates, name(site.name), '#4ade80', () => live.current.onWasteSiteClick?.({ kind: 'site', site }))
    for (const station of wasteExtras?.ecoStations ?? []) point(station.coordinates, name(station.name), '#4ade80', () => live.current.onWasteSiteClick?.({ kind: 'ecoStation', station }))
    for (const facility of wasteExtras?.facilities ?? []) point(facility.coordinates, name(facility.name), '#4ade80', () => live.current.onWasteSiteClick?.({ kind: 'facility', facility }))
    const incinerator = wasteExtras?.incinerator
    if (incinerator) point(incinerator.coordinates, name(incinerator.name), '#4ade80', () => live.current.onWasteSiteClick?.({ kind: 'incinerator', facility: incinerator }))
    for (const facility of data.waterFacilities) point(facility.coordinates, name(facility.name), '#38bdf8', () => live.current.onWaterFacilityClick?.(facility))
    for (const node of data.waterNetwork?.nodes ?? []) point(node.coordinates, name(node.name), '#38bdf8', () => live.current.onWaterNodeClick?.(node))
    for (const pipe of data.waterNetwork?.pipes ?? []) line(pipe.coordinates, '#38bdf8')
    for (const facility of data.powerFacilities) point(facility.coordinates, name(facility.name), '#fbbf24', () => live.current.onPowerFacilityClick?.(facility))
    for (const node of data.powerNetwork?.nodes ?? []) point(node.coordinates, name(node.name), '#fbbf24', () => live.current.onPowerNodeClick?.(node))
    for (const wire of data.powerNetwork?.lines ?? []) line(wire.coordinates, '#fbbf24')
    if (data.grandPrix) {
      const circuit = data.grandPrix
      line(circuit.track.coordinates, '#f43f5e', 4).on('click', () => live.current.onGrandPrixCircuitClick?.(circuit))
      for (const corner of circuit.corners) point([corner.lng, corner.lat], name(corner.name), '#f43f5e', () => live.current.onGrandPrixCornerClick?.(corner))
    }
    return () => { group.remove() }
  }, [transitData, wasteExtras, lang, minute])

  return <>
    <div ref={host} className="mm-raster-map absolute inset-0 z-0" aria-label={t.mapFallbackTitle} />
    <div className="absolute left-3 top-20 z-10 max-w-[230px] rounded border border-(--mm-amber)/40 bg-(--mm-panel)/95 p-2 text-xs text-(--mm-fg) shadow">
      <p className="font-semibold">{t.mapFallbackTitle}</p>
      <p className="mt-1 text-(--mm-fg)/70">{t.mapFallbackNote}</p>
      <button type="button" className="mt-2 underline" onClick={() => {
        const map = mapRef.current
        if (!map) return
        const center = map.getCenter()
        props.onRetry({ center: [center.lng, center.lat], zoom: map.getZoom() - 1 })
      }}>{t.mapRetry}</button>
      {/* Keep attribution visible even when the phone debug log covers the bottom. */}
      <p className="mt-2 text-[10px]">© <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></p>
    </div>
  </>
}
