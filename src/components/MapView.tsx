import { useRef, useEffect, useCallback, useState, useSyncExternalStore } from 'react'
import maplibregl from 'maplibre-gl'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import type { SimulationClock, TransitData, VehiclePosition, Station, Trip, LRTLine, BusRoute, RoadWorkNotice, RoadWorkRestriction, School, Toilet, CarPark, CarParkVacancy, WasteSiteType, WaterFacility, WaterFacilityType, WaterNetworkNode, WaterDistributionRoad, PowerFacility, PowerFacilityType, PowerNetworkNode, PowerDistributionRoad, ScheduleType } from '../types'
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
import {
  WASTE_COLORS,
  WASTE_FEATURE_ID_PROPERTY,
  WASTE_INCINERATOR_COLOR,
  WASTE_INCINERATOR_ICON,
  WASTE_THREE_COLOUR_BINS,
  WASTE_TYPES,
  buildWasteBuildingFeatures,
  buildWasteFeatures,
  wasteIconName,
  type WasteSelection,
} from '../waste'
import {
  WATER_COLORS,
  WATER_FEATURE_ID_PROPERTY,
  WATER_INLET_COLOR,
  WATER_INLET_ICON,
  WATER_PIPE_COLORS,
  WATER_DISTRIBUTION_COLOR,
  WATER_DISTRIBUTION_MAJOR_CLASSES,
  WATER_PIPE_FALLBACK_COLOR,
  WATER_PIPE_FLOW_COLOR,
  WATER_PIPE_GLOW_COLOR,
  WATER_TYPE_ORDER,
  buildDashFlowSteps,
  buildWaterBuildingFeatures,
  buildWaterDistributionFeatures,
  buildWaterMarkerFeatures,
  buildWaterPipeFeatures,
  buildWaterSurfaceFeatures,
  waterIconName,
  waterLabelField,
} from '../water'
import {
  POWER_COLORS,
  POWER_DISTRIBUTION_COLOR,
  POWER_DISTRIBUTION_MAJOR_CLASSES,
  POWER_FEATURE_ID_PROPERTY,
  POWER_INLET_COLOR,
  POWER_INLET_ICON,
  POWER_LINE_FLOW_COLOR,
  POWER_LINE_GLOW_COLOR,
  POWER_TYPE_ORDER,
  buildPowerBuildingFeatures,
  buildPowerDistributionFeatures,
  buildPowerLineFeatures,
  buildPowerMarkerFeatures,
  powerIconName,
  powerLabelField,
} from '../power'
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

// ---- Waste & recycling (IAM + DSPA) overlay ------------------------------
const WASTE_SOURCE_ID = 'waste'
const WASTE_ICON_LAYER_ID = 'waste-icon'
const WASTE_SELECTED_LAYER_ID = 'waste-selected'
// The incineration plant's 11 footprints, drawn as our own coloured extrusions
// exactly like the schools / water / power blocks and for the same reason (see
// the header of src/schools.ts). Its record comes from power-facilities.json.
const WASTE_BUILDINGS_SOURCE_ID = 'waste-buildings'
const WASTE_BUILDINGS_LAYER_ID = 'waste-buildings'
const WASTE_SELECTED_COLOR = '#ffffff'

// Same device-pixel budget as the WC / P plates (registered at pixelRatio 2).
const WASTE_ICON_PX = 40

// The plate every waste marker sits on: the same rounded square with a white
// rim as the WC and P markers, so the city overlays read as one family. Drawn
// once here rather than three times, because the six glyphs differ only in what
// goes ON the plate.
function wastePlate(color: string): { ctx: CanvasRenderingContext2D; size: number } | null {
  const size = WASTE_ICON_PX
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
  return { ctx, size }
}

// A lidded bin, the shared body of the two disposal glyphs: a tapered drum with
// a lid bar and a handle. `ink` is white on the light plates and near-black on
// the pale compactor plate, which is chosen by the caller.
function drawBinBody(ctx: CanvasRenderingContext2D, size: number, ink: string, bottom: number) {
  const cx = size / 2
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = 2.4
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // Lid + handle
  ctx.beginPath()
  ctx.moveTo(cx - 9, 14)
  ctx.lineTo(cx + 9, 14)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - 3, 11)
  ctx.lineTo(cx + 3, 11)
  ctx.stroke()
  // Tapered drum
  ctx.beginPath()
  ctx.moveTo(cx - 7.5, 17)
  ctx.lineTo(cx - 5.5, bottom)
  ctx.lineTo(cx + 5.5, bottom)
  ctx.lineTo(cx + 7.5, 17)
  ctx.closePath()
  ctx.stroke()
}

// One marker image per site type. Every glyph is drawn on the type's own plate,
// so colour AND shape carry the type — a colour-blind reader still gets six
// distinguishable marks. Returns null when the 2D context is unavailable
// (headless/blocked), in which case the caller skips that image.
function drawWasteIcon(type: WasteSiteType): ImageData | null {
  const plate = wastePlate(WASTE_COLORS[type])
  if (!plate) return null
  const { ctx, size } = plate
  const cx = size / 2
  // The two pale plates (compactor white, lamp/battery pink) need dark ink; the
  // rest carry white, like the WC and P glyphs.
  const ink = type === 'compactor' || type === 'lamp_battery' ? '#18181b' : '#ffffff'
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = 2.4
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  switch (type) {
    // 垃圾房 — a lidded bin.
    case 'refuse_room':
      drawBinBody(ctx, size, ink, 30)
      break
    // 壓縮式垃圾收集點 — the same bin with a down-arrow inside it: what the
    // machine does to the rubbish.
    case 'compactor': {
      drawBinBody(ctx, size, ink, 30)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx, 19)
      ctx.lineTo(cx, 26)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - 3, 23)
      ctx.lineTo(cx, 26.5)
      ctx.lineTo(cx + 3, 23)
      ctx.stroke()
      break
    }
    // 智能回收機 — a cabinet with a deposit slot.
    case 'smart_machine': {
      ctx.lineWidth = 2.4
      ctx.strokeRect(cx - 8, 11, 16, 19)
      ctx.fillRect(cx - 5, 15, 10, 2.6)
      ctx.beginPath()
      ctx.arc(cx, 25, 2, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    // 三色資源回收點 — the three bins themselves, in IAM's blue / yellow /
    // brown, so the swatch and the marker say the same thing.
    case 'three_colour': {
      const w = 7
      const gap = 1.6
      const total = w * 3 + gap * 2
      let x = cx - total / 2
      for (const bin of WASTE_THREE_COLOUR_BINS) {
        ctx.fillStyle = bin
        ctx.fillRect(x, 14, w, 15)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.2
        ctx.strokeRect(x, 14, w, 15)
        x += w + gap
      }
      break
    }
    // 電腦及通訊設備回收點 — a monitor on a stand.
    case 'e_waste': {
      ctx.lineWidth = 2.4
      ctx.strokeRect(cx - 9, 12, 18, 13)
      ctx.beginPath()
      ctx.moveTo(cx, 25)
      ctx.lineTo(cx, 29)
      ctx.moveTo(cx - 5, 29.5)
      ctx.lineTo(cx + 5, 29.5)
      ctx.stroke()
      break
    }
    // 光管及電池回收點 — a battery cell with its terminal cap.
    default: {
      ctx.lineWidth = 2.4
      ctx.strokeRect(cx - 6, 14, 12, 16)
      ctx.fillRect(cx - 2.5, 10.5, 5, 3)
      ctx.fillRect(cx - 3.5, 19, 7, 6)
      break
    }
  }
  return ctx.getImageData(0, 0, size, size)
}

// 澳門垃圾焚化中心 — a chimney with a flame above it, on the same lime plate the
// blocks below it use. Drawn separately from `drawWasteIcon` because its type
// is not one of the six and its colour comes from the POWER table.
function drawWasteIncineratorIcon(): ImageData | null {
  const plate = wastePlate(WASTE_INCINERATOR_COLOR)
  if (!plate) return null
  const { ctx, size } = plate
  const cx = size / 2
  const ink = '#18181b' // lime is a pale plate — dark ink, like the compactor
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // The stack: a slightly tapered chimney standing on a base line.
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.moveTo(cx - 4.5, 30)
  ctx.lineTo(cx - 3.2, 19)
  ctx.lineTo(cx + 3.2, 19)
  ctx.lineTo(cx + 4.5, 30)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - 7.5, 30.5)
  ctx.lineTo(cx + 7.5, 30.5)
  ctx.stroke()
  // The flame above it — a teardrop, filled so it reads at 0.45 icon-size.
  ctx.beginPath()
  ctx.moveTo(cx, 8.5)
  ctx.bezierCurveTo(cx + 5.5, 12.5, cx + 4.2, 16.8, cx, 16.8)
  ctx.bezierCurveTo(cx - 4.2, 16.8, cx - 5.5, 12.5, cx, 8.5)
  ctx.closePath()
  ctx.fill()
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

// ---- Macao Water supply facilities overlay -------------------------------
// Three layers off one dataset: a translucent fill for the reservoir surfaces,
// coloured fill-extrusions for the plants/tanks/pump house (the same contract
// as the schools blocks, for the same OpenFreeMap-merging reason), and a
// droplet marker for every facility — including the ones with no footprint,
// which are drawn hollow because their position is only approximate.
const WATER_SURFACES_SOURCE_ID = 'water-surfaces'
const WATER_SURFACES_LAYER_ID = 'water-surfaces'
const WATER_BUILDINGS_SOURCE_ID = 'water-buildings'
const WATER_BUILDINGS_LAYER_ID = 'water-buildings'
const WATER_MARKERS_SOURCE_ID = 'water-markers'
const WATER_ICON_LAYER_ID = 'water-icon'
const WATER_SELECTED_LAYER_ID = 'water-selected'
// The schematic pipe network: a glow under two cores. Three layers rather than
// the two you might expect because `line-dasharray` cannot be varied per
// feature the way a colour can — MapLibre bakes one dash texture per layer — so
// the dashed pipes (raw water, plus any straight-line fallback of either kind)
// need a layer of their own, drawn under the solid treated core.
const WATER_PIPES_SOURCE_ID = 'water-pipes'
const WATER_PIPES_GLOW_LAYER_ID = 'water-pipes-glow'
const WATER_PIPES_DASHED_PREFIX = 'water-pipes-dashed'
const WATER_PIPES_LAYER_ID = 'water-pipes'
// The moving dots on the treated mains, drawn ON TOP of the solid core. The raw
// mains show their flow by animating their own dashes; a solid line cannot, so
// it gets this second, much thinner layer instead.
const WATER_PIPES_FLOW_PREFIX = 'water-pipes-flow'
const WATER_PIPE_GLOW_OPACITY = 0.28

// Trunk mains vs distribution grid: the whole point of the two networks is that
// you can tell them apart at a glance, so the trunk core is ~5× the width of a
// distribution line and the halo under it is wider still.
const WATER_TRUNK_WIDTH: maplibregl.ExpressionSpecification =
  ['interpolate', ['linear'], ['zoom'], 12, 4.5, 16, 7]
const WATER_TRUNK_GLOW_WIDTH: maplibregl.ExpressionSpecification =
  ['interpolate', ['linear'], ['zoom'], 12, 12, 16, 18]
// The dots are ~75 % of the core they ride on: wide enough to be unmistakable
// at city zoom, still narrow enough that the pale-blue core shows either side
// and the pipe reads as a pipe with something moving along it.
const WATER_TRUNK_FLOW_WIDTH: maplibregl.ExpressionSpecification =
  ['interpolate', ['linear'], ['zoom'], 12, 3.4, 16, 5.2]

// The city-wide DISTRIBUTION network: Macau's streets drawn as thin pipes under
// the trunk mains, from OUR OWN water-distribution.json rather than the
// basemap's `transportation` layer. The basemap's roads cannot be clipped to
// Macau, and a distribution network running off into Zhuhai would be claiming
// something false — so the pipeline ships a Macau-only extract instead, loaded
// lazily the first time the layer goes on (useWaterDistribution).
const WATER_DISTRIBUTION_SOURCE_ID = 'water-distribution'
const WATER_DISTRIBUTION_GLOW_LAYER_ID = 'water-distribution-glow'
const WATER_DISTRIBUTION_LAYER_ID = 'water-distribution'
// Dots travelling OUTWARD along the distribution mesh. DESKTOP ONLY: it is
// thousands of extra dashed lines, and on a phone that is both a real cost and
// visually illegible at the widths involved — so on a narrow viewport the layer
// is never created at all (see `isDesktopRef` / WATER_DESKTOP_QUERY), rather
// than created and hidden.
//
// This IS a direction claim, not decoration: the pipeline orients every road
// away from the treated-water source that feeds it, so advancing the dash phase
// along vertex order — exactly as the trunk dots do — shows water leaving the
// plants and tanks for the streets. The dots stay small so the mains still
// dominate, but they move at the trunk's phase step: at half of it the mesh
// read as static rather than slow.
// Layer-id PREFIX, not an id: the flow is drawn as WATER_MESH_PHASES layers,
// one per dash phase, of which exactly one is opaque at a time. The comment
// above addPhaseLayers explains why the phase cannot simply be animated.
const WATER_DISTRIBUTION_FLOW_PREFIX = 'water-distribution-flow'
const WATER_DISTRIBUTION_FLOW_OPACITY = 0.5
// ~0.6× the distribution core. No per-class width bonus: a motorway's dots
// running fatter than a lane's would imply a hierarchy of supply that the road
// classes do not carry — they say how big the street is, not how much water
// goes down it.
const WATER_DISTRIBUTION_FLOW_WIDTH: maplibregl.ExpressionSpecification =
  ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1]
// The app's own `sm:` breakpoint, so "desktop" here means exactly what it means
// in the Tailwind classes everywhere else.
const WATER_DESKTOP_QUERY = '(min-width: 640px)'

// A motorway should read as a slightly bigger main than a service road — but
// only slightly: the width budget belongs to the trunk-vs-distribution
// distinction, so the class spread is a flat +0.4 px rather than a ramp of its
// own. `match` falls through to the thin branch for any class added later.
const WATER_DISTRIBUTION_MAJOR_BONUS = 0.4

// WHY THE FLOW IS DRAWN AS MANY LAYERS INSTEAD OF ONE ANIMATED LAYER
// ------------------------------------------------------------------
// `line-dasharray` is a CROSS-FADED property. `StyleLayer.setPaintProperty`
// returns requiresRelayout=true for it, so `Style._updateLayer` marks the
// layer's SOURCE `'reload'` and pauses its SourceCache — every tile of a
// GeoJSON source re-tessellates. At 14 ticks a second across three layers that
// is ~43 reload marks per source per 3 s, and the tiles visibly blink as they
// come back. That was the flicker.
//
// So the dash phase is never animated. Each animated group is built ONCE as K
// sibling layers that differ only in their fixed `line-dasharray`, and the
// animation swaps which one is opaque. `line-opacity` is a plain paint
// property — no relayout, no source reload — and MapLibre's line draw pass
// early-returns on `line-opacity === 0`, so the K-1 hidden phases cost no draw
// calls either. (`setLayoutProperty('visibility')` would ALSO mark the source
// for reload, so it is not usable per tick.)
const WATER_TRUNK_PHASES = 8
const WATER_MESH_PHASES = 6

function phaseLayerId(prefix: string, k: number): string {
  return `${prefix}-${k}`
}

interface PhaseGroupSpec {
  prefix: string
  source: string
  filter?: maplibregl.FilterSpecification
  color: string | maplibregl.ExpressionSpecification
  width: maplibregl.ExpressionSpecification
  opacity: number
  steps: number[][]
}

// All K layers share one filter and one LAYOUT, so MapLibre buckets their
// geometry once — the extra layers cost a dash texture each, not a copy of the
// road network. Phase 0 is the opaque one; the animation moves that from there.
function addPhaseLayers(
  m: maplibregl.Map, spec: PhaseGroupSpec, visible: boolean, beforeId?: string,
): void {
  spec.steps.forEach((dash, k) => {
    const id = phaseLayerId(spec.prefix, k)
    if (m.getLayer(id)) return
    m.addLayer({
      id, type: 'line', source: spec.source,
      ...(spec.filter ? { filter: spec.filter } : {}),
      layout: {
        'line-cap': 'round', 'line-join': 'round',
        visibility: visible ? 'visible' : 'none',
      },
      paint: {
        'line-color': spec.color,
        'line-opacity': k === 0 ? spec.opacity : 0,
        'line-width': spec.width,
        'line-dasharray': dash,
      },
    }, beforeId)
  })
}

// Every phase layer of a group, for the focus-visibility sweep and for removal.
function phaseLayerIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, k) => phaseLayerId(prefix, k))
}

// The distribution mesh's phase layers. Added from TWO places — addCustomLayers
// on a fresh style, and the breakpoint effect when a window is dragged past
// 640 px — so the spec lives in one function and the two can never disagree.
// Inserted directly above the distribution core and below the trunk glow.
function addDistributionFlowLayer(
  m: maplibregl.Map, visible: boolean, fallbackBeforeId?: string,
): void {
  const beforeId = m.getLayer(WATER_PIPES_GLOW_LAYER_ID)
    ? WATER_PIPES_GLOW_LAYER_ID
    : fallbackBeforeId
  addPhaseLayers(m, {
    prefix: WATER_DISTRIBUTION_FLOW_PREFIX,
    source: WATER_DISTRIBUTION_SOURCE_ID,
    color: WATER_PIPE_FLOW_COLOR,
    width: WATER_DISTRIBUTION_FLOW_WIDTH,
    // Faint on purpose: at ~5 000 roads dots this thin still read, and anything
    // brighter turns the mesh into the loudest thing on the map.
    opacity: WATER_DISTRIBUTION_FLOW_OPACITY,
    steps: WATER_DISTRIBUTION_FLOW_STEPS,
  }, visible, beforeId)
}

function distributionWidth(
  at12: number, at16: number,
  majorClasses: readonly string[] = WATER_DISTRIBUTION_MAJOR_CLASSES,
): maplibregl.ExpressionSpecification {
  const byClass = (w: number): maplibregl.ExpressionSpecification => [
    'match', ['get', 'class'], [...majorClasses],
    w + WATER_DISTRIBUTION_MAJOR_BONUS, w,
  ]
  return ['interpolate', ['linear'], ['zoom'], 12, byClass(at12), 16, byClass(at16)]
}
// Same rule as the schools blocks: every footprint of a facility shares the
// promoted feature id, so one setFeatureState whitens the whole site.
const WATER_SELECTED_COLOR = '#ffffff'
const WATER_SURFACE_OPACITY = 0.35

// Same device-pixel budget as the WC / P markers (registered at pixelRatio 2).
const WATER_ICON_PX = 40

// A droplet on a rounded square, drawn once per (type, approximate) pair into
// an ImageData for map.addImage(). The solid variant is the type colour with a
// white rim and a white droplet; the approximate variant is hollow — a dark
// plate with a coloured rim and a coloured OUTLINE droplet — so a facility whose
// position we inferred never looks as certain as a surveyed footprint. Returns
// null when the 2D context is unavailable (headless/blocked), in which case the
// caller skips that image.
function drawWaterIcon(color: string, approximate: boolean): ImageData | null {
  const size = WATER_ICON_PX
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

  // Hand-rolled rounded rect, like the sibling markers: ctx.roundRect() is
  // still missing on enough engines that a fallback would be needed anyway.
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

  // Hollow = the map's own near-black behind a coloured rim. A fully
  // transparent plate disappears over the basemap's water and building fills,
  // which is exactly where these facilities sit.
  ctx.fillStyle = approximate ? 'rgba(11,11,12,0.72)' : color
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = border
  ctx.strokeStyle = approximate ? color : '#ffffff'
  ctx.stroke()

  // Droplet: a teardrop — apex at the top, a circular belly below.
  const cx = size / 2
  const top = size * 0.26
  const belly = size * 0.63
  const rad = size * 0.185
  ctx.beginPath()
  ctx.moveTo(cx, top)
  ctx.quadraticCurveTo(cx + rad * 1.35, belly - rad * 0.5, cx + rad, belly)
  ctx.arc(cx, belly, rad, 0, Math.PI)
  ctx.quadraticCurveTo(cx - rad * 1.35, belly - rad * 0.5, cx, top)
  ctx.closePath()
  if (approximate) {
    ctx.lineWidth = 2.5
    ctx.strokeStyle = color
    ctx.stroke()
  } else {
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }

  return ctx.getImageData(0, 0, size, size)
}

// The Zhuhai raw-water inlet: a filled disc with a white arrow pointing INTO
// it, so it reads as "water enters Macau here" rather than as a 23rd facility.
// Same 40 px / pixelRatio 2 budget and the same null-on-no-context contract as
// drawWaterIcon above.
function drawWaterInletIcon(): ImageData | null {
  const size = WATER_ICON_PX
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const cx = size / 2
  const cy = size / 2
  ctx.beginPath()
  ctx.arc(cx, cy, size / 2 - 3, 0, Math.PI * 2)
  ctx.fillStyle = WATER_INLET_COLOR
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  // Arrow: a shaft from the left rim to the centre, capped with a head. Points
  // right (inward) — the direction is symbolic, not a bearing.
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.22, cy)
  ctx.lineTo(cx + size * 0.06, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + size * 0.20, cy)
  ctx.lineTo(cx - size * 0.02, cy - size * 0.15)
  ctx.lineTo(cx - size * 0.02, cy + size * 0.15)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  return ctx.getImageData(0, 0, size, size)
}

// One PRE-BUILT dash phase per entry, each shifted a little further along the
// line than the last, so showing them in order walks the pattern from a pipe's
// `from` end to its `to` end (see buildDashFlowSteps, and the vertex-order note
// on buildWaterPipeFeatures). Each array becomes one layer with that dasharray
// baked in — nothing here is ever handed to setPaintProperty at runtime.
//
// Raw pipes carry their OWN 2 / 1.5 dashes; the treated core is solid, so its
// motion comes from the separate `water-pipes-flow` group — chunky white dots
// with long gaps between them, which is what makes the direction of travel
// readable at city zoom rather than a shimmer you have to hunt for.
//
// K is a memory budget as much as a smoothness knob: every phase is a layer.
// 8 for the trunk groups (a 560 ms cycle at 70 ms a phase), 6 for the mesh,
// which steps every SECOND tick — 840 ms, gentler than the mains and sharing
// no period with them, so nothing pulses in lockstep.
const WATER_PIPE_DASH_STEPS: number[][] = buildDashFlowSteps(2, 1.5, WATER_TRUNK_PHASES)
const WATER_PIPE_FLOW_STEPS: number[][] = buildDashFlowSteps(2.2, 5.5, WATER_TRUNK_PHASES)
const WATER_DISTRIBUTION_FLOW_STEPS: number[][] = buildDashFlowSteps(1.2, 7, WATER_MESH_PHASES)
// The period of the ONE interval that drives every phase group of BOTH focus
// overlays. They are mutually exclusive, so only one set is ever advancing.
const FLOW_TICK_MS = 70
// Opacity of the ONE opaque phase in each trunk group.
const WATER_PIPES_DASHED_OPACITY = 1
const WATER_PIPES_FLOW_OPACITY = 0.95

// ---- CEM electricity overlay ---------------------------------------------
// The same three-part shape as the water overlay above: coloured
// fill-extrusions for the footprints, a bolt marker for every facility
// (hollow where CEM lists a station OSM has no feature for), and the schematic
// HV network as a glow + a solid core + travelling dots. The core is solid —
// unlike the water raw mains it never dashes — because a transmission diagram
// reads as continuous corridors; the direction claim rides entirely on the
// dots, which walk each line's vertex order outward from an inlet or the plant.
const POWER_BUILDINGS_SOURCE_ID = 'power-buildings'
const POWER_BUILDINGS_LAYER_ID = 'power-buildings'
const POWER_MARKERS_SOURCE_ID = 'power-markers'
const POWER_ICON_LAYER_ID = 'power-icon'
const POWER_SELECTED_LAYER_ID = 'power-selected'
const POWER_LINES_SOURCE_ID = 'power-lines'
const POWER_LINES_GLOW_LAYER_ID = 'power-lines-glow'
const POWER_LINES_LAYER_ID = 'power-lines'
const POWER_LINES_FLOW_PREFIX = 'power-lines-flow'
const POWER_LINE_GLOW_OPACITY = 0.26
const POWER_LINES_FLOW_OPACITY = 0.95

// Width by VOLTAGE. Baked per feature by buildPowerLineFeatures (`width12` /
// `width16`, from the POWER_LINE_WIDTHS table) rather than expressed as a
// `match` here, so the legend, the panel and the map all read one table: 220 kV
// ≈ 5→8 px, 110 kV 3.5→6, 66 kV 2.2→4. The glow and the dots are multiples of
// whatever the core is, so the whole corridor scales together.
const POWER_TRUNK_WIDTH: maplibregl.ExpressionSpecification =
  ['interpolate', ['linear'], ['zoom'], 12, ['get', 'width12'], 16, ['get', 'width16']]
const POWER_TRUNK_GLOW_WIDTH: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  12, ['*', ['get', 'width12'], 2.4], 16, ['*', ['get', 'width16'], 2.4],
]
// ~62 % of the core: unmistakable at city zoom, still narrow enough that the
// amber shows either side and the line reads as a line with something on it.
const POWER_TRUNK_FLOW_WIDTH: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  12, ['*', ['get', 'width12'], 0.62], 16, ['*', ['get', 'width16'], 0.62],
]

// The city-wide DISTRIBUTION network — the same Macau street extract as the
// water overlay's, oriented outward from the SUBSTATIONS instead. Loaded lazily
// the first time the layer goes on (usePowerDistribution), and like its twin
// the flow group is DESKTOP ONLY (WATER_DESKTOP_QUERY gates its existence, not
// just its visibility).
const POWER_DISTRIBUTION_SOURCE_ID = 'power-distribution'
const POWER_DISTRIBUTION_GLOW_LAYER_ID = 'power-distribution-glow'
const POWER_DISTRIBUTION_LAYER_ID = 'power-distribution'
const POWER_DISTRIBUTION_FLOW_PREFIX = 'power-distribution-flow'
const POWER_DISTRIBUTION_FLOW_OPACITY = 0.5
const POWER_DISTRIBUTION_FLOW_WIDTH: maplibregl.ExpressionSpecification =
  ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1]
const POWER_DISTRIBUTION_OPACITY = 0.7

// Same phase-layer budget and the same rhythm as the water groups (see the
// comment above WATER_TRUNK_PHASES for why the dash phase is never animated).
const POWER_TRUNK_PHASES = 8
const POWER_MESH_PHASES = 6
const POWER_LINE_FLOW_STEPS: number[][] = buildDashFlowSteps(2.2, 5.5, POWER_TRUNK_PHASES)
const POWER_DISTRIBUTION_FLOW_STEPS: number[][] = buildDashFlowSteps(1.2, 7, POWER_MESH_PHASES)

// Same rule as the school and water blocks: every footprint of a facility
// shares the promoted feature id, so one setFeatureState whitens the site.
const POWER_SELECTED_COLOR = '#ffffff'

// The layers that survive an empty `transitData` because they are built from
// `allTransitData`: the bus route polylines (one shared source, dimmed by
// feature-state rather than filtered) and the LRT station pins. EITHER focus
// mode hides them by layout visibility for as long as it is on — nothing else
// touches these two properties, so there is no state to fight over.
const FOCUS_HIDDEN_LAYERS = [
  'bus-routes', 'bus-routes-highlighted', 'stations-circle', 'stations-label',
] as const

// The mirror image: layers that exist ONLY for focus mode. The distribution
// network is drawn from the basemap's own tiles, so there is no data array to
// empty when the layer goes off — visibility is the whole mechanism.
const WATER_FOCUS_SHOWN_LAYERS: readonly string[] = [
  WATER_DISTRIBUTION_GLOW_LAYER_ID, WATER_DISTRIBUTION_LAYER_ID,
  // Every phase layer of the mesh flow. None of them may exist (narrow
  // viewport) — the loop skips missing layers. Visibility and opacity are
  // orthogonal here: focus mode shows them all, and exactly one is opaque.
  ...phaseLayerIds(WATER_DISTRIBUTION_FLOW_PREFIX, WATER_MESH_PHASES),
]

// The electricity overlay's mirror image of the list above.
const POWER_FOCUS_SHOWN_LAYERS: readonly string[] = [
  POWER_DISTRIBUTION_GLOW_LAYER_ID, POWER_DISTRIBUTION_LAYER_ID,
  ...phaseLayerIds(POWER_DISTRIBUTION_FLOW_PREFIX, POWER_MESH_PHASES),
]

// WATER and POWER are mutually exclusive focus modes, so this takes both flags
// and is the single place layout visibility is decided: the city hides for
// either, and each overlay's own street mesh shows only for its own.
function applyFocusVisibility(
  m: maplibregl.Map, water: boolean, power: boolean, waste: boolean,
): void {
  const focus = water || power || waste
  for (const id of FOCUS_HIDDEN_LAYERS) {
    if (!m.getLayer(id)) continue
    m.setLayoutProperty(id, 'visibility', focus ? 'none' : 'visible')
  }
  for (const id of WATER_FOCUS_SHOWN_LAYERS) {
    if (!m.getLayer(id)) continue
    m.setLayoutProperty(id, 'visibility', water ? 'visible' : 'none')
  }
  for (const id of POWER_FOCUS_SHOWN_LAYERS) {
    if (!m.getLayer(id)) continue
    m.setLayoutProperty(id, 'visibility', power ? 'visible' : 'none')
  }
  // The LRT track + viaduct layers are per-line, and their visibility belongs
  // to the [transitData.lrtLines] effect below — which restores them the moment
  // focus ends (its deps change as the line array refills). So focus only ever
  // forces them OFF, and never claims to restore them. This also covers the
  // style swap, which re-adds every layer visible: addCustomLayers calls this
  // last, before the LRT effect has had any chance to re-run.
  if (!focus) return
  // getStyle() is undefined (or throws) until the style has loaded — this
  // effect can fire on mount, before addCustomLayers has run. That is a no-op
  // by definition: the LRT layers do not exist yet, and addCustomLayers calls
  // this again once they do.
  let layers: { id: string }[] = []
  try { layers = m.getStyle()?.layers ?? [] } catch { return }
  for (const layer of layers) {
    if (/^lrt-(line|viaduct)-/.test(layer.id)) {
      m.setLayoutProperty(layer.id, 'visibility', 'none')
    }
  }
}

// Every (type, approximate) combination the marker layer can ask for. Both
// variants of all five types are registered up front, because the file decides
// which it needs and a missing image would silently drop the marker.
const WATER_ICON_VARIANTS: readonly { type: WaterFacilityType; approximate: boolean }[] =
  WATER_TYPE_ORDER.flatMap(type => [
    { type, approximate: false },
    { type, approximate: true },
  ])

// The same for the electricity markers.
const POWER_ICON_VARIANTS: readonly { type: PowerFacilityType; approximate: boolean }[] =
  POWER_TYPE_ORDER.flatMap(type => [
    { type, approximate: false },
    { type, approximate: true },
  ])

// The distribution mesh's phase layers for the POWER overlay. Added from TWO
// places — addCustomLayers on a fresh style, and the breakpoint effect — so the
// spec lives in one function and the two can never disagree. Inserted directly
// above the distribution core and below the HV glow.
function addPowerDistributionFlowLayer(
  m: maplibregl.Map, visible: boolean, fallbackBeforeId?: string,
): void {
  const beforeId = m.getLayer(POWER_LINES_GLOW_LAYER_ID)
    ? POWER_LINES_GLOW_LAYER_ID
    : fallbackBeforeId
  addPhaseLayers(m, {
    prefix: POWER_DISTRIBUTION_FLOW_PREFIX,
    source: POWER_DISTRIBUTION_SOURCE_ID,
    color: POWER_LINE_FLOW_COLOR,
    width: POWER_DISTRIBUTION_FLOW_WIDTH,
    opacity: POWER_DISTRIBUTION_FLOW_OPACITY,
    steps: POWER_DISTRIBUTION_FLOW_STEPS,
  }, visible, beforeId)
}

// A lightning bolt on a rounded square, drawn once per (type, approximate) pair
// into an ImageData for map.addImage(). Same plate, same sizes and the same
// null-on-no-context contract as drawWaterIcon: the solid variant is the type
// colour with a white rim and a white bolt; the approximate variant is hollow —
// a dark plate with a coloured rim and a coloured OUTLINE bolt — so a station
// whose position we inferred never looks as certain as a surveyed footprint.
function drawPowerIcon(color: string, approximate: boolean): ImageData | null {
  const size = WATER_ICON_PX
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

  // Hollow = the map's own near-black behind a coloured rim. A fully
  // transparent plate disappears over the basemap's building fills, which is
  // exactly where these stations sit.
  ctx.fillStyle = approximate ? 'rgba(11,11,12,0.72)' : color
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = border
  ctx.strokeStyle = approximate ? color : '#ffffff'
  ctx.stroke()

  // The bolt: the usual six-point zigzag, in fractions of the plate.
  const p: [number, number][] = [
    [0.58, 0.15], [0.32, 0.55], [0.46, 0.55],
    [0.41, 0.86], [0.68, 0.45], [0.54, 0.45],
  ]
  ctx.beginPath()
  ctx.moveTo(p[0][0] * size, p[0][1] * size)
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * size, p[i][1] * size)
  ctx.closePath()
  if (approximate) {
    ctx.lineWidth = 2.5
    ctx.strokeStyle = color
    ctx.stroke()
  } else {
    // The pale 66 kV plate needs a dark bolt to read at all; the deeper tiers
    // take white, like the water droplets.
    ctx.fillStyle = color === POWER_COLORS.sub66 ? '#0b0b0c' : '#ffffff'
    ctx.fill()
  }

  return ctx.getImageData(0, 0, size, size)
}

// A Guangdong import point: a filled disc with a white arrow pointing INTO it,
// so it reads as "power enters Macau here" rather than as another substation.
// Same budget and contract as drawWaterInletIcon.
function drawPowerInletIcon(): ImageData | null {
  const size = WATER_ICON_PX
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const cx = size / 2
  const cy = size / 2
  ctx.beginPath()
  ctx.arc(cx, cy, size / 2 - 3, 0, Math.PI * 2)
  ctx.fillStyle = POWER_INLET_COLOR
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.22, cy)
  ctx.lineTo(cx + size * 0.06, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + size * 0.20, cy)
  ctx.lineTo(cx - size * 0.02, cy - size * 0.15)
  ctx.lineTo(cx - size * 0.02, cy + size * 0.15)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  return ctx.getImageData(0, 0, size, size)
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
  onRoadWorkClick?: (notice: RoadWorkNotice | null) => void
  // `buildingName` is the clicked footprint's OSM name — null for the many
  // unnamed campus buildings.
  onSchoolClick?: (school: School, buildingName: string | null) => void
  onToiletClick?: (toilet: Toilet | null) => void
  onCarParkClick?: (carPark: CarPark | null) => void
  onWasteSiteClick?: (selection: WasteSelection | null) => void
  // WASTE is the third focus mode, and behaves exactly like the two below: App
  // empties every other layer's data while it is on, and this flag hides the
  // two things drawn from `allTransitData` that would otherwise survive.
  wasteFocus?: boolean
  // The incineration plant, taken from the POWER dataset (see src/waste.ts).
  // Null whenever the WASTE layer is off or its key row is switched off, which
  // is what empties both its blocks and its marker.
  wasteIncinerator?: PowerFacility | null
  onWaterFacilityClick?: (facility: WaterFacility | null) => void
  // The extra network nodes (today: the Zhuhai inlet) share the facility marker
  // layer but are NOT facilities, so they open their own panel variant.
  onWaterNodeClick?: (node: WaterNetworkNode | null) => void
  // WATER is a focus mode: while it is on, App has already emptied every other
  // layer's data. That hides the vehicles, the LRT tracks and every overlay,
  // but NOT the bus route polylines or the station pins — those are drawn from
  // `allTransitData` on purpose (the dimming is a feature-state, so the lines
  // stay put while routes go in and out of service). This flag hides them for
  // the duration, so focus mode really does leave only the water network.
  waterFocus?: boolean
  // Macau's streets, drawn as the thin distribution pipes. Null until the lazy
  // fetch lands (see useWaterDistribution) — the rest of the water overlay
  // renders immediately and this fills in behind it.
  waterDistributionRoads?: WaterDistributionRoad[] | null
  onPowerFacilityClick?: (facility: PowerFacility | null) => void
  // The extra network nodes (the three Guangdong import points) share the
  // facility marker layer but are NOT facilities, so they open their own panel.
  onPowerNodeClick?: (node: PowerNetworkNode | null) => void
  // POWER is the second focus mode, mutually exclusive with WATER: App empties
  // every other layer's data while it is on, and this flag hides the two things
  // drawn from `allTransitData` that would otherwise survive.
  powerFocus?: boolean
  // Macau's streets, drawn as the thin distribution feeders. Null until the
  // lazy fetch lands (see usePowerDistribution).
  powerDistributionRoads?: PowerDistributionRoad[] | null
  // Live vacancy keyed by car-park id, from useCarParkVacancy. A new Map
  // identity (≈ every 30 s while polling) is what re-labels the markers.
  carParkVacancy?: Map<string, CarParkVacancy> | null
  onClearSelection?: () => void
  trackedVehicleId?: string | null
  selectedRoadWorkId?: string | null
  selectedSchoolId?: string | null
  selectedToiletId?: string | null
  selectedCarParkId?: string | null
  selectedWasteSiteId?: string | null
  selectedWaterFacilityId?: string | null
  selectedWaterNodeId?: string | null
  selectedPowerFacilityId?: string | null
  selectedPowerNodeId?: string | null
  onVehicleCount?: (count: number) => void
  showTimeBar?: boolean
  onToggleTimeBar?: () => void
}

export function MapView({ clock, transitData, allTransitData, onVehicleClick, onTrackedVehicleUpdate, onStationClick, onRoadWorkClick, onSchoolClick, onToiletClick, onCarParkClick, onWasteSiteClick, wasteFocus = false, wasteIncinerator = null, onWaterFacilityClick, onWaterNodeClick, waterFocus = false, waterDistributionRoads = null, onPowerFacilityClick, onPowerNodeClick, powerFocus = false, powerDistributionRoads = null, carParkVacancy, onClearSelection, trackedVehicleId, selectedRoadWorkId, selectedSchoolId, selectedToiletId, selectedCarParkId, selectedWasteSiteId, selectedWaterFacilityId, selectedWaterNodeId, selectedPowerFacilityId, selectedPowerNodeId, onVehicleCount, showTimeBar = true, onToggleTimeBar }: Props) {
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
  // And the waste sites: same filter-on-the-marker-source highlight, so
  // addCustomLayers has to restore it after a style swap.
  const selectedWasteSiteIdRef = useRef<string | null>(selectedWasteSiteId ?? null)
  selectedWasteSiteIdRef.current = selectedWasteSiteId ?? null
  // The id whose  feature-state is set on the incinerator blocks, so
  // the effect clears exactly one entry (the plant is the only member).
  const wasteStateIdRef = useRef<string | null>(null)
  const carParkVacancyRef = useRef<Map<string, CarParkVacancy> | null>(carParkVacancy ?? null)
  carParkVacancyRef.current = carParkVacancy ?? null
  // Water facilities carry BOTH highlight mechanisms of the overlays above: a
  // marker ring (a filter, like the toilets) and whitened blocks (a
  // feature-state, like the schools), so addCustomLayers needs the id for each.
  const selectedWaterFacilityIdRef = useRef<string | null>(selectedWaterFacilityId ?? null)
  selectedWaterFacilityIdRef.current = selectedWaterFacilityId ?? null
  const waterStateIdRef = useRef<string | null>(null)
  // The inlet shares the marker layer, so its selection ring is the same filter
  // — one id from each side, at most one of them non-null at a time.
  const selectedWaterNodeIdRef = useRef<string | null>(selectedWaterNodeId ?? null)
  selectedWaterNodeIdRef.current = selectedWaterNodeId ?? null
  // Focus mode is a layout-visibility flag, so a style swap (which re-adds
  // every layer at its default visibility) has to re-apply it from here.
  const waterFocusRef = useRef(waterFocus)
  waterFocusRef.current = waterFocus
  // The electricity overlay carries the identical set: two selection ids (a
  // marker-ring filter and a block feature-state) and the focus flag, all read
  // by addCustomLayers after a style swap.
  const selectedPowerFacilityIdRef = useRef<string | null>(selectedPowerFacilityId ?? null)
  selectedPowerFacilityIdRef.current = selectedPowerFacilityId ?? null
  const powerStateIdRef = useRef<string | null>(null)
  const selectedPowerNodeIdRef = useRef<string | null>(selectedPowerNodeId ?? null)
  selectedPowerNodeIdRef.current = selectedPowerNodeId ?? null
  const powerFocusRef = useRef(powerFocus)
  powerFocusRef.current = powerFocus
  // WASTE has no layers of its own to reveal (its markers are data-driven), so
  // its focus flag only ever feeds applyFocusVisibility's "hide the city" half.
  const wasteFocusRef = useRef(wasteFocus)
  wasteFocusRef.current = wasteFocus
  // Seeds both waste sources after a style swap, the same way transitRef does
  // for every other overlay.
  const wasteIncineratorRef = useRef(wasteIncinerator)
  wasteIncineratorRef.current = wasteIncinerator
  // Same style-swap contract for the distribution roads: addCustomLayers seeds
  // the source from here, so a theme change after the lazy fetch landed redraws
  // the thin pipes without waiting for anything.
  // Is this a desktop-width viewport? Gates the distribution flow layer's very
  // EXISTENCE, not just its visibility — see WATER_DISTRIBUTION_FLOW_PREFIX.
  // Read from matchMedia rather than a resize handler so it fires once per
  // crossing of the breakpoint instead of once per pixel of drag.
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' || window.matchMedia(WATER_DESKTOP_QUERY).matches
  )
  useEffect(() => {
    const mq = window.matchMedia(WATER_DESKTOP_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    setIsDesktop(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const isDesktopRef = useRef(isDesktop)
  isDesktopRef.current = isDesktop
  // Which dash phase is currently opaque, per animated group. A REF, not a
  // local counter in the interval: addCustomLayers rebuilds the layers with
  // phase 0 opaque after a style swap, and the animation has to be told, or it
  // would clear a phase that is already transparent and leave two showing.
  const waterPhaseRef = useRef({ trunk: 0, mesh: 0, tick: 0 })
  const waterDistributionRef = useRef<WaterDistributionRoad[] | null>(waterDistributionRoads)
  waterDistributionRef.current = waterDistributionRoads
  const powerPhaseRef = useRef({ trunk: 0, mesh: 0, tick: 0 })
  const powerDistributionRef = useRef<PowerDistributionRoad[] | null>(powerDistributionRoads)
  powerDistributionRef.current = powerDistributionRoads

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

  // Same contract for the water blocks: every footprint of a facility shares
  // the promoted `facilityId`, so one pair of calls repaints the whole site.
  const applyWaterSelection = useCallback((m: maplibregl.Map) => {
    if (!m.getSource(WATER_BUILDINGS_SOURCE_ID)) return
    const next = selectedWaterFacilityIdRef.current
    const prev = waterStateIdRef.current
    if (prev && prev !== next) {
      m.setFeatureState({ source: WATER_BUILDINGS_SOURCE_ID, id: prev }, { selected: false })
    }
    if (next) m.setFeatureState({ source: WATER_BUILDINGS_SOURCE_ID, id: next }, { selected: true })
    waterStateIdRef.current = next
  }, [])

  // And the same again for the electricity blocks.
  const applyPowerSelection = useCallback((m: maplibregl.Map) => {
    if (!m.getSource(POWER_BUILDINGS_SOURCE_ID)) return
    const next = selectedPowerFacilityIdRef.current
    const prev = powerStateIdRef.current
    if (prev && prev !== next) {
      m.setFeatureState({ source: POWER_BUILDINGS_SOURCE_ID, id: prev }, { selected: false })
    }
    if (next) m.setFeatureState({ source: POWER_BUILDINGS_SOURCE_ID, id: next }, { selected: true })
    powerStateIdRef.current = next
  }, [])

  // And once more for the incineration plant’s blocks — one member, but the
  // same contract, so a style swap re-applies it exactly like the others.
  const applyWasteSelection = useCallback((m: maplibregl.Map) => {
    if (!m.getSource(WASTE_BUILDINGS_SOURCE_ID)) return
    const next = selectedWasteSiteIdRef.current
    const prev = wasteStateIdRef.current
    if (prev && prev !== next) {
      m.setFeatureState({ source: WASTE_BUILDINGS_SOURCE_ID, id: prev }, { selected: false })
    }
    if (next) m.setFeatureState({ source: WASTE_BUILDINGS_SOURCE_ID, id: next }, { selected: true })
    wasteStateIdRef.current = next
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

      // Macao Water. Same anchor and the same seeding rule as the schools
      // above (transitRef, not a closure, so a theme swap long after
      // water-facilities.json landed still redraws it). Order matters: the
      // reservoir surfaces are a flat fill and go in FIRST, so the extruded
      // blocks of a plant standing beside a reservoir draw over the water
      // rather than under it.
      m.addSource(WATER_SURFACES_SOURCE_ID, {
        type: 'geojson',
        data: buildWaterSurfaceFeatures(transitRef.current.waterFacilities),
      })
      m.addLayer({
        id: WATER_SURFACES_LAYER_ID, type: 'fill', source: WATER_SURFACES_SOURCE_ID,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': WATER_SURFACE_OPACITY,
          // A reservoir reads as an area, not an object — a hairline rim is
          // enough to separate it from the basemap's own water polygon.
          'fill-outline-color': ['get', 'color'],
        },
      }, firstSymbolId)
      // The distribution network, first of the pipe layers so the trunk mains
      // draw over it. Seeded from the ref, which is empty until the lazy fetch
      // lands — the source is created regardless so the layers exist, and the
      // [waterDistributionRoads] effect fills them in when the file arrives.
      // Visibility is seeded from the focus flag: unlike the other water layers
      // this data is CACHED once fetched, so emptying it is not the "off"
      // mechanism — layout visibility is (see applyWaterFocusVisibility).
      const roadVisibility = waterFocusRef.current ? 'visible' : 'none'
      m.addSource(WATER_DISTRIBUTION_SOURCE_ID, {
        type: 'geojson',
        data: buildWaterDistributionFeatures(waterDistributionRef.current),
      })
      m.addLayer({
        id: WATER_DISTRIBUTION_GLOW_LAYER_ID, type: 'line',
        source: WATER_DISTRIBUTION_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: roadVisibility },
        paint: {
          'line-color': WATER_PIPE_GLOW_COLOR,
          'line-opacity': 0.12,
          'line-width': distributionWidth(3, 5),
        },
      }, firstSymbolId)
      m.addLayer({
        id: WATER_DISTRIBUTION_LAYER_ID, type: 'line',
        source: WATER_DISTRIBUTION_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: roadVisibility },
        paint: {
          'line-color': WATER_DISTRIBUTION_COLOR,
          'line-opacity': 0.7,
          'line-width': distributionWidth(0.8, 1.6),
        },
      }, firstSymbolId)
      // Desktop only. The trunk layers are added after this, so on a fresh
      // style there is no `water-pipes-glow` to sit under yet — hence the
      // firstSymbolId fallback, which lands it in the same slot.
      if (isDesktopRef.current) {
        addDistributionFlowLayer(m, waterFocusRef.current, firstSymbolId)
      }

      // The pipe network, between the reservoir fills and the facility blocks:
      // over the water (so a pipe crossing a reservoir stays readable) and under
      // every block and marker, which are the things a user clicks. Four layers,
      // glow first — see the WATER_PIPES_* constants for why the dashed core
      // cannot just be a paint expression on the solid one, and why the treated
      // core needs a separate layer to show its flow.
      m.addSource(WATER_PIPES_SOURCE_ID, {
        type: 'geojson',
        data: buildWaterPipeFeatures(transitRef.current.waterNetwork),
      })
      m.addLayer({
        id: WATER_PIPES_GLOW_LAYER_ID, type: 'line', source: WATER_PIPES_SOURCE_ID,
        layout: {
          'line-cap': 'round', 'line-join': 'round',
          // Treated water over raw where the two share a street.
          'line-sort-key': ['get', 'sortKey'],
        },
        paint: {
          'line-color': WATER_PIPE_GLOW_COLOR,
          'line-opacity': WATER_PIPE_GLOW_OPACITY,
          'line-width': WATER_TRUNK_GLOW_WIDTH,
        },
      }, firstSymbolId)
      // Raw water, plus any pipe whose OSRM lookup fell back to a straight
      // line — a stand-in geometry should never look like a surveyed route.
      // One layer per dash phase; the animation swaps which is opaque.
      addPhaseLayers(m, {
        prefix: WATER_PIPES_DASHED_PREFIX,
        source: WATER_PIPES_SOURCE_ID,
        filter: ['any', ['==', ['get', 'kind'], 'raw'], ['==', ['get', 'fallback'], true]],
        color: [
          'case', ['get', 'fallback'], WATER_PIPE_FALLBACK_COLOR, WATER_PIPE_COLORS.raw,
        ],
        width: WATER_TRUNK_WIDTH,
        opacity: WATER_PIPES_DASHED_OPACITY,
        steps: WATER_PIPE_DASH_STEPS,
      }, true, firstSymbolId)
      m.addLayer({
        id: WATER_PIPES_LAYER_ID, type: 'line', source: WATER_PIPES_SOURCE_ID,
        filter: ['all', ['==', ['get', 'kind'], 'treated'], ['!=', ['get', 'fallback'], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'sortKey'] },
        paint: {
          'line-color': WATER_PIPE_COLORS.treated,
          'line-width': WATER_TRUNK_WIDTH,
        },
      }, firstSymbolId)
      // The dots that travel along the treated mains — their own group above
      // the solid core, because one line layer carries one dash pattern and the
      // core has to stay solid. Every treated pipe gets dots, including a
      // fallback one: the flow is a statement about direction, not about how
      // trustworthy the geometry is (the grey dashes below already say that).
      addPhaseLayers(m, {
        prefix: WATER_PIPES_FLOW_PREFIX,
        source: WATER_PIPES_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'treated'],
        color: WATER_PIPE_FLOW_COLOR,
        width: WATER_TRUNK_FLOW_WIDTH,
        opacity: WATER_PIPES_FLOW_OPACITY,
        steps: WATER_PIPE_FLOW_STEPS,
      }, true, firstSymbolId)

      m.addSource(WATER_BUILDINGS_SOURCE_ID, {
        type: 'geojson',
        data: buildWaterBuildingFeatures(transitRef.current.waterFacilities),
        promoteId: WATER_FEATURE_ID_PROPERTY,
      })
      // Identical height treatment to the school blocks: the SAME z14→z15.5
      // ramp as the basemap buildings, so a facility block stays exactly its
      // 2 m margin proud of its grey neighbours while they grow, and degrades
      // to a flat coloured footprint where the basemap draws no buildings.
      m.addLayer({
        id: WATER_BUILDINGS_LAYER_ID, type: 'fill-extrusion', source: WATER_BUILDINGS_SOURCE_ID,
        paint: {
          'fill-extrusion-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            WATER_SELECTED_COLOR,
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

      // CEM electricity. Same anchor and the same seeding rule as the water
      // overlay above (transitRef, not a closure, so a theme swap long after
      // power-facilities.json landed still redraws it), and the same layer
      // order: the street mesh first, then the HV corridors over it, then the
      // facility blocks — which are the thing a user clicks — on top.
      const powerRoadVisibility = powerFocusRef.current ? 'visible' : 'none'
      m.addSource(POWER_DISTRIBUTION_SOURCE_ID, {
        type: 'geojson',
        data: buildPowerDistributionFeatures(powerDistributionRef.current),
      })
      m.addLayer({
        id: POWER_DISTRIBUTION_GLOW_LAYER_ID, type: 'line',
        source: POWER_DISTRIBUTION_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: powerRoadVisibility },
        paint: {
          'line-color': POWER_LINE_GLOW_COLOR,
          'line-opacity': 0.12,
          'line-width': distributionWidth(3, 5, POWER_DISTRIBUTION_MAJOR_CLASSES),
        },
      }, firstSymbolId)
      m.addLayer({
        id: POWER_DISTRIBUTION_LAYER_ID, type: 'line',
        source: POWER_DISTRIBUTION_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: powerRoadVisibility },
        paint: {
          'line-color': POWER_DISTRIBUTION_COLOR,
          'line-opacity': POWER_DISTRIBUTION_OPACITY,
          'line-width': distributionWidth(0.8, 1.6, POWER_DISTRIBUTION_MAJOR_CLASSES),
        },
      }, firstSymbolId)
      // Desktop only. The HV layers are added after this, so on a fresh style
      // there is no `power-lines-glow` to sit under yet — hence the
      // firstSymbolId fallback, which lands it in the same slot.
      if (isDesktopRef.current) {
        addPowerDistributionFlowLayer(m, powerFocusRef.current, firstSymbolId)
      }

      // The HV network: a glow, a solid core whose colour and width come from
      // the feature's own voltage, and the travelling dots above it. Only three
      // layers (not the water overlay's four) because nothing here is dashed —
      // a fallback line says so with grey, not with a dash pattern.
      m.addSource(POWER_LINES_SOURCE_ID, {
        type: 'geojson',
        data: buildPowerLineFeatures(transitRef.current.powerNetwork),
      })
      m.addLayer({
        id: POWER_LINES_GLOW_LAYER_ID, type: 'line', source: POWER_LINES_SOURCE_ID,
        layout: {
          'line-cap': 'round', 'line-join': 'round',
          // Higher voltage over lower where the two share a street.
          'line-sort-key': ['get', 'sortKey'],
        },
        paint: {
          'line-color': POWER_LINE_GLOW_COLOR,
          'line-opacity': POWER_LINE_GLOW_OPACITY,
          'line-width': POWER_TRUNK_GLOW_WIDTH,
        },
      }, firstSymbolId)
      m.addLayer({
        id: POWER_LINES_LAYER_ID, type: 'line', source: POWER_LINES_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'sortKey'] },
        paint: {
          // Baked per feature: the voltage colour, or grey where OSRM fell back
          // to a straight line — a stand-in geometry should never look like a
          // surveyed route.
          'line-color': ['get', 'color'],
          'line-width': POWER_TRUNK_WIDTH,
        },
      }, firstSymbolId)
      // Every line gets dots, fallbacks included: the flow is a statement about
      // direction, not about how trustworthy the geometry is (the grey already
      // says that).
      addPhaseLayers(m, {
        prefix: POWER_LINES_FLOW_PREFIX,
        source: POWER_LINES_SOURCE_ID,
        color: POWER_LINE_FLOW_COLOR,
        width: POWER_TRUNK_FLOW_WIDTH,
        opacity: POWER_LINES_FLOW_OPACITY,
        steps: POWER_LINE_FLOW_STEPS,
      }, true, firstSymbolId)

      m.addSource(POWER_BUILDINGS_SOURCE_ID, {
        type: 'geojson',
        data: buildPowerBuildingFeatures(transitRef.current.powerFacilities),
        promoteId: POWER_FEATURE_ID_PROPERTY,
      })
      // Identical height treatment to the school and water blocks: the same
      // z14→z15.5 ramp as the basemap buildings, so a facility block stays
      // exactly its 2 m margin proud of its grey neighbours.
      m.addLayer({
        id: POWER_BUILDINGS_LAYER_ID, type: 'fill-extrusion', source: POWER_BUILDINGS_SOURCE_ID,
        paint: {
          'fill-extrusion-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            POWER_SELECTED_COLOR,
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

      // The incineration plant, for the WASTE overlay. Deliberately the SAME
      // code path as the electricity blocks above — same insertion point, same
      // height ramp, same opacity, same promoted-id selection highlight —
      // because it is the same record: power-facilities.json's `incinerator`,
      // read a second time by a layer that cares about where refuse goes rather
      // than where electricity comes from.
      m.addSource(WASTE_BUILDINGS_SOURCE_ID, {
        type: 'geojson',
        data: buildWasteBuildingFeatures(wasteIncineratorRef.current),
        promoteId: WASTE_FEATURE_ID_PROPERTY,
      })
      m.addLayer({
        id: WASTE_BUILDINGS_LAYER_ID, type: 'fill-extrusion', source: WASTE_BUILDINGS_SOURCE_ID,
        paint: {
          'fill-extrusion-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            WASTE_SELECTED_COLOR,
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

      // Waste & recycling markers. Same contract as the WC / P plates: the six
      // images are redrawn here on every style load under a hasImage guard, and
      // the source is seeded from transitRef so a theme swap keeps the markers.
      for (const type of WASTE_TYPES) {
        const name = wasteIconName(type)
        if (m.hasImage(name)) continue
        const img = drawWasteIcon(type)
        if (img) m.addImage(name, img, { pixelRatio: 2 })
      }
      if (!m.hasImage(WASTE_INCINERATOR_ICON)) {
        const img = drawWasteIncineratorIcon()
        if (img) m.addImage(WASTE_INCINERATOR_ICON, img, { pixelRatio: 2 })
      }
      m.addSource(WASTE_SOURCE_ID, {
        type: 'geojson',
        data: buildWasteFeatures(transitRef.current.waste, wasteIncineratorRef.current),
      })
      m.addLayer({
        id: WASTE_SELECTED_LAYER_ID, type: 'circle', source: WASTE_SOURCE_ID,
        filter: ['==', ['get', 'id'], selectedWasteSiteIdRef.current ?? ''],
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
        id: WASTE_ICON_LAYER_ID, type: 'symbol', source: WASTE_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'icon'],
          // Collision ON, unlike the WC and P plates: this is ~1,100 points, and
          // 406 lamp/battery markers drawn over each other at city zoom would be
          // a stain rather than a map. `symbol-sort-key` (ascending scarcity —
          // see WASTE_SORT_KEY) decides who survives, so the rare smart machines
          // stay visible and the winner is STABLE as the map moves rather than
          // flickering between neighbours.
          'icon-allow-overlap': false,
          'icon-ignore-placement': false,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.45, 14, 0.7, 16, 1],
          'symbol-sort-key': ['get', 'sortKey'],
        },
        paint: {
          // Suspended sites read as "there, but not usable" — the same statement
          // the closed WC markers make.
          'icon-opacity': ['case', ['get', 'closed'], 0.45, 1],
        },
      })

      // Water-facility markers. Same image contract as the WC / P plates —
      // setStyle({diff:false}) drops registered images with the layers, so both
      // variants of all five types are redrawn here under a hasImage guard —
      // and the same transitRef seeding, since the data has no time dimension.
      for (const variant of WATER_ICON_VARIANTS) {
        const name = waterIconName(variant.type, variant.approximate)
        if (m.hasImage(name)) continue
        const img = drawWaterIcon(WATER_COLORS[variant.type], variant.approximate)
        if (img) m.addImage(name, img, { pixelRatio: 2 })
      }
      if (!m.hasImage(WATER_INLET_ICON)) {
        const inletImg = drawWaterInletIcon()
        if (inletImg) m.addImage(WATER_INLET_ICON, inletImg, { pixelRatio: 2 })
      }
      m.addSource(WATER_MARKERS_SOURCE_ID, {
        type: 'geojson',
        data: buildWaterMarkerFeatures(
          transitRef.current.waterFacilities, transitRef.current.waterNetwork,
        ),
      })
      m.addLayer({
        id: WATER_SELECTED_LAYER_ID, type: 'circle', source: WATER_MARKERS_SOURCE_ID,
        // One ring for both kinds of marker: a facility id from one prop, a
        // network-node id from the other, at most one of them set.
        filter: ['in', ['get', WATER_FEATURE_ID_PROPERTY], ['literal', [
          selectedWaterFacilityIdRef.current ?? '', selectedWaterNodeIdRef.current ?? '',
        ]]],
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
        id: WATER_ICON_LAYER_ID, type: 'symbol', source: WATER_MARKERS_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'icon'],
          // The approximate pumping stations sit ~25 m from the facility they
          // are co-located with, which is one pixel at city zoom — collision
          // hiding would silently drop half the list, so they always draw.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 15, 1],
          // Only the network nodes carry a label (the inlet has to name itself;
          // a facility is named by the panel its marker opens), so this reads
          // as null — no text — for all 22 facilities. Swapped, not rebuilt, on
          // a language change: see the [lang] effect below.
          'text-field': ['get', waterLabelField(currentLang)],
          'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'],
          'text-size': ['step', ['zoom'], 0, 12, 10, 15, 11],
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          // The label may collide; the marker never does. `text-optional` keeps
          // the icon when its label loses the placement.
          'text-optional': true,
        },
        paint: {
          // The hollow plate already says "inferred position"; a slight fade
          // keeps it from competing with the facilities we actually mapped.
          'icon-opacity': ['case', ['get', 'approximate'], 0.85, 1],
          'text-color': '#dbeafe',
          'text-halo-color': '#0b0b0c',
          'text-halo-width': 1.2,
        },
      })

      // Electricity markers. Same image contract, same layer pair (a ring that
      // is a filter swap, then the symbols) and the same transitRef seeding as
      // the water markers directly above.
      for (const variant of POWER_ICON_VARIANTS) {
        const name = powerIconName(variant.type, variant.approximate)
        if (m.hasImage(name)) continue
        const img = drawPowerIcon(POWER_COLORS[variant.type], variant.approximate)
        if (img) m.addImage(name, img, { pixelRatio: 2 })
      }
      if (!m.hasImage(POWER_INLET_ICON)) {
        const inletImg = drawPowerInletIcon()
        if (inletImg) m.addImage(POWER_INLET_ICON, inletImg, { pixelRatio: 2 })
      }
      m.addSource(POWER_MARKERS_SOURCE_ID, {
        type: 'geojson',
        data: buildPowerMarkerFeatures(
          transitRef.current.powerFacilities, transitRef.current.powerNetwork,
        ),
      })
      m.addLayer({
        id: POWER_SELECTED_LAYER_ID, type: 'circle', source: POWER_MARKERS_SOURCE_ID,
        filter: ['in', ['get', POWER_FEATURE_ID_PROPERTY], ['literal', [
          selectedPowerFacilityIdRef.current ?? '', selectedPowerNodeIdRef.current ?? '',
        ]]],
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
        id: POWER_ICON_LAYER_ID, type: 'symbol', source: POWER_MARKERS_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'icon'],
          // Substations cluster tightly in Cotai; collision hiding would
          // silently drop half the list, so they always draw.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 15, 1],
          // Only the network nodes carry a label (an inlet has to name itself;
          // a facility is named by the panel its marker opens), so this reads
          // as null — no text — for every CEM facility. Swapped, not rebuilt,
          // on a language change: see the [lang] effect below.
          'text-field': ['get', powerLabelField(currentLang)],
          'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'],
          'text-size': ['step', ['zoom'], 0, 12, 10, 15, 11],
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'icon-opacity': ['case', ['get', 'approximate'], 0.85, 1],
          'text-color': '#fed7aa',
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
      // Ditto for the water and electricity blocks, whose highlight is the
      // same feature-state.
      waterStateIdRef.current = null
      applyWaterSelection(m)
      powerStateIdRef.current = null
      applyPowerSelection(m)
      wasteStateIdRef.current = null
      applyWasteSelection(m)
      // Every phase group was just rebuilt with phase 0 opaque.
      waterPhaseRef.current = { trunk: 0, mesh: 0, tick: 0 }
      powerPhaseRef.current = { trunk: 0, mesh: 0, tick: 0 }
      // A style swap re-adds every layer visible; re-assert focus mode.
      applyFocusVisibility(m, waterFocusRef.current, powerFocusRef.current, wasteFocusRef.current)
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

      // Waste & recycling pins, registered before the vehicle handlers for the
      // same reason: a bus passing over a bin should not steal the click.
      const openWasteMark = (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0]
        if (!feature) return
        const wid = feature.properties?.id ?? feature.properties?.[WASTE_FEATURE_ID_PROPERTY]
        // Current list (transitRef), not a closed-over snapshot — waste.json
        // lands after this handler is attached, and the legend's master and
        // per-type toggles swap the array.
        const site = transitRef.current.waste.find(x => x.id === wid)
        if (site) { onWasteSiteClick?.({ kind: 'site', site }); e.preventDefault(); return }
        // Not a collection point → the incineration plant, which shares this
        // marker layer (and adds the blocks) but opens its own panel variant.
        const plant = wasteIncineratorRef.current
        if (plant && wid === plant.id) {
          onWasteSiteClick?.({ kind: 'incinerator', facility: plant })
          e.preventDefault()
        }
      }
      // Blocks first, marker second: the plant's marker sits ON TOP of its own
      // footprints, so both layers report a hit — and delegated listeners all
      // fire, last one wins. Same rule as the water facilities.
      for (const layerId of [WASTE_BUILDINGS_LAYER_ID, WASTE_ICON_LAYER_ID]) {
        m.on('click', layerId, openWasteMark)
        m.on('mouseenter', layerId, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', layerId, () => { m.getCanvas().style.cursor = '' })
      }

      // Water facilities: the droplet marker AND the coloured blocks open the
      // same panel, so a user can click either the pin or the plant itself.
      // Registered before the vehicle handlers for the usual reason — a bus
      // driving past a treatment plant should not steal the click.
      const openWaterFacility = (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0]
        if (!feature) return
        const fid = feature.properties?.[WATER_FEATURE_ID_PROPERTY]
        // Current list (transitRef), not a closed-over snapshot —
        // water-facilities.json lands after this handler is attached, and the
        // legend toggle swaps the array.
        const facility = transitRef.current.waterFacilities.find(f => f.id === fid)
        if (facility) { onWaterFacilityClick?.(facility); e.preventDefault(); return }
        // Not a facility → one of the network's own nodes (the Zhuhai inlet),
        // which shares this marker layer but opens its own panel variant.
        const node = transitRef.current.waterNetwork?.nodes.find(n => n.id === fid)
        if (node) { onWaterNodeClick?.(node); e.preventDefault() }
      }
      // Blocks first, marker second: an approximate marker sits ON TOP of the
      // facility it is co-located with, so both layers report a hit — and
      // delegated listeners all fire, last one wins. The marker is the smaller,
      // more deliberate target, so it must be the one that ends up selected.
      for (const layerId of [WATER_BUILDINGS_LAYER_ID, WATER_ICON_LAYER_ID]) {
        m.on('click', layerId, openWaterFacility)
        m.on('mouseenter', layerId, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', layerId, () => { m.getCanvas().style.cursor = '' })
      }

      // Electricity facilities: identical contract to the water handler above —
      // the bolt marker AND the coloured block open the same panel, an id that
      // is not a facility is looked up among the network's own nodes (an
      // inlet), and blocks are registered before markers so the smaller, more
      // deliberate target wins when both report a hit.
      const openPowerFacility = (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0]
        if (!feature) return
        const fid = feature.properties?.[POWER_FEATURE_ID_PROPERTY]
        const facility = transitRef.current.powerFacilities.find(f => f.id === fid)
        if (facility) { onPowerFacilityClick?.(facility); e.preventDefault(); return }
        const node = transitRef.current.powerNetwork?.nodes.find(n => n.id === fid)
        if (node) { onPowerNodeClick?.(node); e.preventDefault() }
      }
      for (const layerId of [POWER_BUILDINGS_LAYER_ID, POWER_ICON_LAYER_ID]) {
        m.on('click', layerId, openPowerFacility)
        m.on('mouseenter', layerId, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', layerId, () => { m.getCanvas().style.cursor = '' })
      }

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
          layers: ['vehicles-circle', 'stations-circle', ROAD_WORKS_ICON_LAYER_ID, SCHOOLS_LAYER_ID, TOILETS_ICON_LAYER_ID, CAR_PARKS_ICON_LAYER_ID, WASTE_ICON_LAYER_ID, WASTE_BUILDINGS_LAYER_ID, WATER_ICON_LAYER_ID, WATER_BUILDINGS_LAYER_ID, POWER_ICON_LAYER_ID, POWER_BUILDINGS_LAYER_ID, ...model3DLayers],
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
    // Same trick for the water network's node labels (the Zhuhai inlet): all
    // three forms ride in the feature, so switching language is a text-field
    // swap rather than a source rebuild.
    if (map.getLayer(WATER_ICON_LAYER_ID)) {
      map.setLayoutProperty(WATER_ICON_LAYER_ID, 'text-field', ['get', waterLabelField(lang)])
    }
    if (map.getLayer(POWER_ICON_LAYER_ID)) {
      map.setLayoutProperty(POWER_ICON_LAYER_ID, 'text-field', ['get', powerLabelField(lang)])
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

  // Waste & recycling markers. Same array-identity push as the toilets —
  // waste.json arriving, the master switch swapping in the empty array, or a
  // per-type toggle handing over a narrowed one.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const setData = (sourceId: string, data: GeoJSON.FeatureCollection) => {
      const src = map.getSource(sourceId) as unknown as
        { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
      src?.setData?.(data)
    }
    setData(WASTE_SOURCE_ID, buildWasteFeatures(transitData.waste, wasteIncinerator))
    setData(WASTE_BUILDINGS_SOURCE_ID, buildWasteBuildingFeatures(wasteIncinerator))
  }, [transitData.waste, wasteIncinerator])

  // Selected waste-site highlight — a filter swap, same as the toilet ring.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    applyWasteSelection(map)
    if (!map.getLayer(WASTE_SELECTED_LAYER_ID)) return
    map.setFilter(WASTE_SELECTED_LAYER_ID, ['==', ['get', 'id'], selectedWasteSiteId ?? ''])
  }, [selectedWasteSiteId, applyWasteSelection])

  // Water facilities — three sources off one array, pushed together on array
  // identity (the file arriving, or the legend toggle swapping in the empty
  // array). Like the schools this data never goes through the RAF tick; a style
  // rebuild is covered by addCustomLayers seeding all three from transitRef.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const setData = (sourceId: string, data: GeoJSON.FeatureCollection) => {
      const src = map.getSource(sourceId) as unknown as
        { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
      src?.setData?.(data)
    }
    setData(WATER_SURFACES_SOURCE_ID, buildWaterSurfaceFeatures(transitData.waterFacilities))
    setData(WATER_BUILDINGS_SOURCE_ID, buildWaterBuildingFeatures(transitData.waterFacilities))
    setData(WATER_PIPES_SOURCE_ID, buildWaterPipeFeatures(transitData.waterNetwork))
    setData(
      WATER_MARKERS_SOURCE_ID,
      buildWaterMarkerFeatures(transitData.waterFacilities, transitData.waterNetwork),
    )
  }, [transitData.waterFacilities, transitData.waterNetwork])

  // The electricity overlay, on exactly the same terms: three sources off one
  // array identity (the file arriving, or the legend toggle swapping in the
  // empty array), never from the RAF tick.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const setData = (sourceId: string, data: GeoJSON.FeatureCollection) => {
      const src = map.getSource(sourceId) as unknown as
        { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
      src?.setData?.(data)
    }
    setData(POWER_BUILDINGS_SOURCE_ID, buildPowerBuildingFeatures(transitData.powerFacilities))
    setData(POWER_LINES_SOURCE_ID, buildPowerLineFeatures(transitData.powerNetwork))
    setData(
      POWER_MARKERS_SOURCE_ID,
      buildPowerMarkerFeatures(transitData.powerFacilities, transitData.powerNetwork),
    )
  }, [transitData.powerFacilities, transitData.powerNetwork])

  // The distribution roads land once, from their own lazy fetch, so this fires
  // at most twice per session (null → loaded) and never from the RAF tick.
  useEffect(() => {
    const map = mapRef.current
    const src = map?.getSource(WATER_DISTRIBUTION_SOURCE_ID) as unknown as
      { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    src?.setData?.(buildWaterDistributionFeatures(waterDistributionRoads))
  }, [waterDistributionRoads])

  useEffect(() => {
    const map = mapRef.current
    const src = map?.getSource(POWER_DISTRIBUTION_SOURCE_ID) as unknown as
      { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
    src?.setData?.(buildPowerDistributionFeatures(powerDistributionRoads))
  }, [powerDistributionRoads])

  // Selected water facility: the marker ring is a filter swap (toilet rule) and
  // the blocks are a feature-state (school rule), so both run here.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer(WATER_SELECTED_LAYER_ID)) {
      map.setFilter(
        WATER_SELECTED_LAYER_ID,
        ['in', ['get', WATER_FEATURE_ID_PROPERTY], ['literal', [
          selectedWaterFacilityId ?? '', selectedWaterNodeId ?? '',
        ]]],
      )
    }
    applyWaterSelection(map)
  }, [selectedWaterFacilityId, selectedWaterNodeId, applyWaterSelection])

  // The electricity selection, by the same two mechanisms.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer(POWER_SELECTED_LAYER_ID)) {
      map.setFilter(
        POWER_SELECTED_LAYER_ID,
        ['in', ['get', POWER_FEATURE_ID_PROPERTY], ['literal', [
          selectedPowerFacilityId ?? '', selectedPowerNodeId ?? '',
        ]]],
      )
    }
    applyPowerSelection(map)
  }, [selectedPowerFacilityId, selectedPowerNodeId, applyPowerSelection])

  // Crossing the 640 px breakpoint adds or REMOVES the distribution flow,
  // rather than toggling its visibility: on a narrow viewport the layer should
  // not exist at all, so a phone never pays to tile 5 600 dashed lines.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource(WATER_DISTRIBUTION_SOURCE_ID)) return
    if (isDesktop) {
      addDistributionFlowLayer(map, waterFocusRef.current)
      // Freshly added layers have phase 0 opaque; keep the animation's idea of
      // "current" in step with that or it would clear the wrong one next tick.
      waterPhaseRef.current.mesh = 0
    } else {
      for (const id of phaseLayerIds(WATER_DISTRIBUTION_FLOW_PREFIX, WATER_MESH_PHASES)) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
    }
  }, [isDesktop])

  // Same for the electricity mesh, which is gated on the same breakpoint for
  // the same reason.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource(POWER_DISTRIBUTION_SOURCE_ID)) return
    if (isDesktop) {
      addPowerDistributionFlowLayer(map, powerFocusRef.current)
      powerPhaseRef.current.mesh = 0
    } else {
      for (const id of phaseLayerIds(POWER_DISTRIBUTION_FLOW_PREFIX, POWER_MESH_PHASES)) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
    }
  }, [isDesktop])

  // The network "flows" while the WATER layer is on: ONE interval advancing
  // every animated layer — the raw pipes' own dashes, the dots riding the
  // treated core, and (desktop only) the distribution flow — so they can never
  // drift out of step and the cost stays at most SIX line-opacity writes per
  // 70 ms tick. Deliberately NOT in the RAF tick, which must stay
  // free of paint writes; each layer it touches is skipped when absent, which
  // is how the flow costs nothing on a narrow viewport. The phase index counts
  // up so the patterns walk forward along each line's vertex order — for a
  // pipe, from its `from` end to its `to` end; for a road, away from the source
  // feeding it.
  useEffect(() => {
    if (!waterFocus && !powerFocus) return
    const timer = window.setInterval(() => {
      const map = mapRef.current
      if (!map) return
      // Hide the phase that was showing, show the next one. Two opacity writes
      // per group: a plain paint change, so no relayout and no source reload —
      // which is the entire point of the phase layers (see addPhaseLayers).
      const swap = (prefix: string, from: number, to: number, opacity: number) => {
        const hide = phaseLayerId(prefix, from)
        const show = phaseLayerId(prefix, to)
        if (map.getLayer(hide)) map.setPaintProperty(hide, 'line-opacity', 0)
        if (map.getLayer(show)) map.setPaintProperty(show, 'line-opacity', opacity)
      }
      if (waterFocus) {
        const st = waterPhaseRef.current
        st.tick++
        const nextTrunk = (st.trunk + 1) % WATER_TRUNK_PHASES
        swap(WATER_PIPES_DASHED_PREFIX, st.trunk, nextTrunk, WATER_PIPES_DASHED_OPACITY)
        swap(WATER_PIPES_FLOW_PREFIX, st.trunk, nextTrunk, WATER_PIPES_FLOW_OPACITY)
        st.trunk = nextTrunk
        // The mesh steps every SECOND tick: fewer, larger phases keep its layer
        // count down, and half the rate keeps it gentler than the mains.
        if (st.tick % 2 === 0) {
          const nextMesh = (st.mesh + 1) % WATER_MESH_PHASES
          swap(
            WATER_DISTRIBUTION_FLOW_PREFIX, st.mesh, nextMesh,
            WATER_DISTRIBUTION_FLOW_OPACITY,
          )
          st.mesh = nextMesh
        }
      }
      // The electricity overlay, on the same tick and the same every-second
      // rule for its mesh. Mutually exclusive with water, so at most one of
      // these two branches ever runs — the cost stays at most FOUR
      // line-opacity writes per 70 ms tick.
      if (powerFocus) {
        const st = powerPhaseRef.current
        st.tick++
        const nextTrunk = (st.trunk + 1) % POWER_TRUNK_PHASES
        swap(POWER_LINES_FLOW_PREFIX, st.trunk, nextTrunk, POWER_LINES_FLOW_OPACITY)
        st.trunk = nextTrunk
        if (st.tick % 2 === 0) {
          const nextMesh = (st.mesh + 1) % POWER_MESH_PHASES
          swap(
            POWER_DISTRIBUTION_FLOW_PREFIX, st.mesh, nextMesh,
            POWER_DISTRIBUTION_FLOW_OPACITY,
          )
          st.mesh = nextMesh
        }
      }
    }, FLOW_TICK_MS)
    return () => window.clearInterval(timer)
  }, [waterFocus, powerFocus])

  // Focus mode. App has already emptied every other layer's data; this hides
  // the two things that are drawn from `allTransitData` and so would otherwise
  // survive — the bus route polylines and the station pins — and shows exactly
  // one overlay's street mesh.
  useEffect(() => {
    const map = mapRef.current
    if (map) applyFocusVisibility(map, waterFocus, powerFocus, wasteFocus)
  }, [waterFocus, powerFocus, wasteFocus])

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
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceWasteLabel}</span>
                  <span className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 shrink-0">
                    <a
                      href="https://www.iam.gov.mo/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >IAM</a>
                    <span className="text-white/25 mx-[3px]">/</span>
                    <a
                      href="https://www.dspa.gov.mo/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >DSPA</a>
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourceWaterLabel}</span>
                  <span className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 shrink-0">
                    <a
                      href="https://www.macaowater.com/about-macao-water/water-supply-facilities"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >Macao Water</a>
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
                  <span className="text-[10px] text-white/50 leading-tight">{t.dataSourcePowerLabel}</span>
                  <span className="mm-mono text-[9px] tracking-[0.1em] text-amber-200/80 shrink-0">
                    <a
                      href="https://www.cem-macau.com/zh/about-cem/company-profile/operation/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >CEM</a>
                    <span className="text-white/25 mx-[3px]">/</span>
                    <a
                      href="https://www.openstreetmap.org/copyright"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-amber-200 transition-colors"
                    >OSM</a>
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
