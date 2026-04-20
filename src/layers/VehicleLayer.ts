import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { VehiclePosition } from '../types'
import type { Lang } from '../i18n'

const SOURCE_ID = 'vehicles-source'
const CIRCLE_LAYER_ID = 'vehicles-circle'
const LABEL_LAYER_ID = 'vehicles-label'
const FLIGHT_LABEL_LAYER_ID = 'vehicles-flight-label'
const PULSE_LAYER_ID = 'vehicles-pulse'

const LINE_LABELS: Record<string, { en: string; zh: string }> = {
  taipa: { en: 'Taipa', zh: '氹仔' },
  seac_pai_van: { en: 'SPV', zh: '石排灣' },
  hengqin: { en: 'Hengqin', zh: '橫琴' },
}

function vehiclesToGeoJson(vehicles: VehiclePosition[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map(v => {
      const isFlight = v.type === 'flight'
      const isFerry = v.type === 'ferry'
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: v.coordinates },
        properties: {
          id: v.id,
          lineId: v.lineId,
          type: v.type,
          color: v.color,
          bearing: v.bearing,
          labelEn: isFlight || isFerry ? v.lineId : (LINE_LABELS[v.lineId]?.en ?? v.lineId),
          labelZh: isFlight || isFerry ? v.lineId : (LINE_LABELS[v.lineId]?.zh ?? v.lineId),
        },
      }
    }),
  }
}

export function addVehicleLayers(map: MapLibreMap, lang: Lang = 'zh') {
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

  map.addLayer({
    id: PULSE_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'type'], 'flight'], 12,
        ['==', ['get', 'type'], 'lrt'], 10,
        ['==', ['get', 'type'], 'ferry'], 9,
        7,
      ],
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.2,
      'circle-blur': 0.5,
    },
  })

  map.addLayer({
    id: CIRCLE_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'type'], 'flight'], 7,
        ['==', ['get', 'type'], 'lrt'], 6,
        ['==', ['get', 'type'], 'ferry'], 5,
        4,
      ],
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 1,
      'circle-stroke-opacity': 1,
    },
  })

  map.addLayer({
    id: LABEL_LAYER_ID,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['==', ['get', 'type'], 'lrt'],
    layout: {
      'text-field': ['get', lang === 'zh' ? 'labelZh' : 'labelEn'],
      'text-size': 8,
      'text-letter-spacing': 0,
      'text-offset': [0, -1.5],
      'text-anchor': 'bottom',
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': '#000000',
      'text-halo-width': 1,
    },
    minzoom: 14,
  })

  map.addLayer({
    id: FLIGHT_LABEL_LAYER_ID,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['==', ['get', 'type'], 'flight'],
    layout: {
      'text-field': ['get', lang === 'zh' ? 'labelZh' : 'labelEn'],
      'text-size': 9,
      'text-letter-spacing': 0.25,
      'text-offset': [0, -1.5],
      'text-anchor': 'bottom',
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': '#000000',
      'text-halo-width': 1,
    },
    minzoom: 15.9,
  })
}

export function updateVehicleData(map: MapLibreMap, vehicles: VehiclePosition[]) {
  const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
  if (!source) return
  source.setData(vehiclesToGeoJson(vehicles))
}

export function updateVehicleLabelLang(map: MapLibreMap, lang: Lang) {
  const field = ['get', lang === 'zh' ? 'labelZh' : 'labelEn']
  if (map.getLayer(LABEL_LAYER_ID)) {
    map.setLayoutProperty(LABEL_LAYER_ID, 'text-field', field)
  }
  if (map.getLayer(FLIGHT_LABEL_LAYER_ID)) {
    map.setLayoutProperty(FLIGHT_LABEL_LAYER_ID, 'text-field', field)
  }
}

export function removeVehicleLayers(map: MapLibreMap) {
  if (map.getLayer(FLIGHT_LABEL_LAYER_ID)) map.removeLayer(FLIGHT_LABEL_LAYER_ID)
  if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID)
  if (map.getLayer(CIRCLE_LAYER_ID)) map.removeLayer(CIRCLE_LAYER_ID)
  if (map.getLayer(PULSE_LAYER_ID)) map.removeLayer(PULSE_LAYER_ID)
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}
