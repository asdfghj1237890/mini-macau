import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'

const SOURCE_ID = 'vehicles-source'
const CIRCLE_LAYER_ID = 'vehicles-circle'
const LABEL_LAYER_ID = 'vehicles-label'
const PULSE_LAYER_ID = 'vehicles-pulse'

function vehiclesToGeoJson(vehicles: VehiclePosition[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map(v => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: v.coordinates,
      },
      properties: {
        id: v.id,
        lineId: v.lineId,
        type: v.type,
        color: v.color,
        bearing: v.bearing,
      },
    })),
  }
}

export function addVehicleLayers(map: MapLibreMap) {
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
        ['==', ['get', 'type'], 'lrt'], 10,
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
        ['==', ['get', 'type'], 'lrt'], 6,
        4,
      ],
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  })

  map.addLayer({
    id: LABEL_LAYER_ID,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['==', ['get', 'type'], 'lrt'],
    layout: {
      'text-field': ['get', 'lineId'],
      'text-size': 8,
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
}

export function updateVehicleData(map: MapLibreMap, vehicles: VehiclePosition[]) {
  const source = map.getSource(SOURCE_ID)
  if (source && 'setData' in source) {
    (source as { setData: (data: GeoJSON.FeatureCollection) => void })
      .setData(vehiclesToGeoJson(vehicles))
  }
}

export function removeVehicleLayers(map: MapLibreMap) {
  if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID)
  if (map.getLayer(CIRCLE_LAYER_ID)) map.removeLayer(CIRCLE_LAYER_ID)
  if (map.getLayer(PULSE_LAYER_ID)) map.removeLayer(PULSE_LAYER_ID)
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}
