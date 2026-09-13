// Freeze public bus geometry together with geometry-dependent replay playheads.
// Usage: node scripts/capture-bus-replay-routes.mjs <bus-routes-snapshot.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
const path = process.argv[2]
if (!path) throw new Error('Provide the public bus-route snapshot used to capture the kerb-turn fixture')
const fixture = JSON.parse(readFileSync('src/engines/__fixtures__/bus-kerb-turn.json', 'utf8'))
const ids = new Set(Object.keys(fixture).map(id => id.replace(/-\d+$/, '')))
const maneuvers = readFileSync('src/engines/busReplayManeuvers.test.ts', 'utf8')
for (const [, id] of maneuvers.matchAll(/['"]([A-Z0-9]+)-\d+['"]/g)) ids.add(id)
const routes = JSON.parse(readFileSync(path, 'utf8')).filter(r => ids.has(r.id))
if (routes.length !== ids.size || routes.some(r => !r.geometry || !r.roadProfile)) throw new Error('Incomplete bus geometry snapshot')
const output = gzipSync(JSON.stringify(routes), { level: 9 })
writeFileSync('src/engines/__fixtures__/bus-replay-routes.json.gz', output)
console.log(`Saved ${routes.length} public bus routes (${output.length} bytes) for the captured traffic regressions.`)
