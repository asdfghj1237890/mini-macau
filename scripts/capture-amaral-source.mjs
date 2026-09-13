// Capture only the public M172 station facts and the local OSM street graph.
// Fetch station HTML into data/raw/amaral-mo.html before running this command.
import { readFileSync, writeFileSync, statSync } from 'node:fs'
const html = readFileSync('data/raw/amaral-mo.html', 'utf8')
const snapshot = JSON.parse(readFileSync('data/raw/bus-road-ways.json', 'utf8'))
const points = [...html.matchAll(/\{id: '(\d+)', lat: ([\d.]+), lng: ([\d.]+)\}/g)]
const platforms = new Map(points.map(([, id, lat, lng]) => [id, { id: `M172/${id}`, coordinates: [+lng, +lat], routes: [] }]))
let lane, platform
for (const match of html.matchAll(/([A-H]) 車道|分站 (\d+)|href="\.\.\/route\/([^/]+)\/([01])"/g)) {
  if (match[1]) lane = match[1]
  else if (match[2]) { platform = platforms.get(match[2]); platform.lane = lane }
  else if (platform) platform.routes.push({ id: match[3], direction: +match[4] })
}
if (platforms.size !== 17 || [...platforms.values()].some(p => !p.lane || !p.routes.length)) throw new Error('Incomplete M172 station page')
const ways = snapshot.elements.filter(w => w.type === 'way' && w.geometry && w.tags?.highway &&
  w.geometry.some(p => p.lon > 113.5418 && p.lon < 113.5453 && p.lat > 22.1865 && p.lat < 22.1915))
writeFileSync('data/bus_reference/amaral-terminal.json', JSON.stringify({
  station: 'M172', name: '亞馬喇前地', checkedAt: statSync('data/raw/amaral-mo.html').mtime.toISOString().slice(0, 10),
  sources: { platforms: 'https://motransportinfo.com/zh/station/M172', streets: 'https://www.openstreetmap.org/#map=19/22.18930/113.54335' },
  osmFetchedAtUtc: snapshot.fetchedAtUtc,
  note: 'Platform coordinates and route assignments are from MO Transport. OSM supplies street connectivity and directions. Vehicle paths, kerb clearance and turning curves are approximate, not surveyed lane boundaries.',
  platforms: [...platforms.values()].sort((a, b) => Number(a.id.split('/')[1]) - Number(b.id.split('/')[1])), ways,
}, null, 2) + '\n')
console.log(`Captured ${platforms.size} platforms and ${ways.length} surrounding OSM ways.`)
