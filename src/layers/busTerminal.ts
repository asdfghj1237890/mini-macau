import type { Map } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import terminal from '../data/bus-terminals.json'

export const BUS_TERMINAL_LAYERS = ['bus-terminal-lanes', 'bus-terminal-arrows', 'bus-terminal-platforms', 'bus-terminal-labels'] as const

/** Static, local detail. No per-frame source updates or extra map requests. */
export function addBusTerminal(map: Map, dark: boolean): void {
  map.addSource('bus-terminal', { type: 'geojson', data: terminal as FeatureCollection })
  map.addLayer({ id: BUS_TERMINAL_LAYERS[0], type: 'line', source: 'bus-terminal', minzoom: 16.5,
    filter: ['==', ['get', 'kind'], 'lane'], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark ? '#718386' : '#758e8c', 'line-opacity': .35,
      'line-width': ['interpolate', ['exponential', 2], ['zoom'], 17, 3, 20, 24] } })
  map.addLayer({ id: BUS_TERMINAL_LAYERS[1], type: 'symbol', source: 'bus-terminal', minzoom: 18,
    filter: ['==', ['get', 'kind'], 'lane'],
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'text-field': '›', 'text-size': 18,
      'text-keep-upright': false, 'text-rotation-alignment': 'map' },
    paint: { 'text-color': dark ? '#bdcdca' : '#496460', 'text-opacity': .75 } })
  // Platform poles and their codes are close-up detail: keep them off until
  // the terminal is big enough to read them (the lanes and arrows stay).
  map.addLayer({ id: BUS_TERMINAL_LAYERS[2], type: 'circle', source: 'bus-terminal', minzoom: 19.1,
    filter: ['==', ['get', 'kind'], 'platform'],
    paint: { 'circle-radius': 3, 'circle-color': '#f2cf54', 'circle-stroke-color': dark ? '#182026' : '#ffffff', 'circle-stroke-width': 1 } })
  map.addLayer({ id: BUS_TERMINAL_LAYERS[3], type: 'symbol', source: 'bus-terminal', minzoom: 19.1,
    filter: ['==', ['get', 'kind'], 'platform'],
    layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, -1], 'text-anchor': 'bottom' },
    paint: { 'text-color': dark ? '#e9d689' : '#75580d', 'text-halo-color': dark ? '#182026' : '#ffffff', 'text-halo-width': 1.5 } })
}
