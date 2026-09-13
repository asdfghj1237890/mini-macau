// Compact display-only geometry; the source OSM snapshot stays offline.
import { readFileSync, writeFileSync } from 'node:fs'
import { buildAmaralNetwork, roundedPath, key } from './amaral-network.mjs'
const source = JSON.parse(readFileSync('data/bus_reference/amaral-terminal.json', 'utf8'))
const { ways, platforms } = buildAmaralNetwork(source)
const fixed = new Set([...platforms.values()].map(p => key(p.vehiclePoint)))
const features = ways.filter(w => w.tags._lanePath).map(w => ({ type: 'Feature',
  properties: { kind: 'lane', label: w.tags._lanePath.split('/')[1] },
  geometry: { type: 'LineString', coordinates: roundedPath(w.geometry.map(p => [p.lon, p.lat]), fixed) } }))
for (const p of platforms.values()) features.push({ type: 'Feature',
  properties: { kind: 'platform', label: `${p.lane}${p.id.split('/')[1]}`, id: p.id },
  geometry: { type: 'Point', coordinates: p.coordinates } })
writeFileSync('src/data/bus-terminals.json', JSON.stringify({ type: 'FeatureCollection', features }))
console.log(`Built ${features.length} terminal map features.`)
