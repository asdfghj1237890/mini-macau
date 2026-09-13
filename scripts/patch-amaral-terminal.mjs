// Run after bus extraction/bridge corrections, before rebuilding road profiles.
// Replaces only visits to M172 and preserves every other stop/route section.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { applyTerminalGuide, AMARAL_GUIDE_REPETITIONS } from './amaral-route-guide.mjs'
import { buildAmaralNetwork, streetGraph, attachAnchor, findPath, roundedPath, key, metres } from './amaral-network.mjs'
const MX = 111320 * Math.cos(22.19 * Math.PI / 180)
const inside = p => p[0] > 113.5427 && p[0] < 113.5443 && p[1] > 22.1876 && p[1] < 22.1900
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
const heading = (a, b) => {
  const dx = (b[0] - a[0]) * MX, dy = (b[1] - a[1]) * 111320, d = Math.hypot(dx, dy) || 1
  return [dx / d, dy / d]
}

export function patchAmaral(routes, stops, source, guides = {}) {
  const network = buildAmaralNetwork(source), graph = streetGraph(network.ways), changes = []
  const baseLayout = { version: 1, ways: network.ways, platforms: [...network.platforms.values()] }
  const platforms = new Map([...network.platforms.values()].map(p => [p.id, p]))
  for (const stop of stops) {
    const platform = platforms.get(stop.id)
    if (!platform) continue
    stop.coordinates = platform.coordinates
    stop.platform = `${platform.lane}${platform.id.split('/')[1]}`
    stop.nameCn = `${source.name}（${platform.lane} 車道 · 分站 ${platform.id.split('/')[1]}）`
  }
  for (const route of routes) {
    const guide = guides[route.id]
    const layoutKey = fingerprint({ ...baseLayout, guide, guideLayoutVersion: guide ? 3 : undefined,
      guideRepetitions: AMARAL_GUIDE_REPETITIONS[route.id] })
    const previous = route.geometry.properties?.amaralLayout
    if (previous?.layoutKey === layoutKey && previous.geometryKey === fingerprint(route.geometry.geometry.coordinates)) continue
    if (guide) applyTerminalGuide(route, new Map(stops.map(s => [s.id, s])), guide)
    const coords = route.geometry.geometry.coordinates, windows = []
    route.stopsForward.forEach((id, stopIndex) => {
      const platform = platforms.get(id)
      if (!platform) return
      if (!platform.routes.some(r => r.id === route.id)) throw new Error(`${route.id} is not assigned to ${id} by MO Transport`)
      let a = route.stopOffsets[stopIndex], b = a
      const lower = stopIndex ? route.stopOffsets[stopIndex - 1] + 1 : 0
      const upper = stopIndex + 1 < route.stopOffsets.length ? route.stopOffsets[stopIndex + 1] - 1 : coords.length - 1
      while (a > lower && inside(coords[a])) a--
      while (b < upper && inside(coords[b])) b++
      const previous = windows.at(-1)
      if (previous && a <= previous.b) { previous.b = Math.max(previous.b, b); previous.stops.push(stopIndex) }
      else windows.push({ a, b, stops: [stopIndex], lower, upper })
    })
    // Legacy bridge joins on through routes cut diagonally through the bays.
    // Route these same journeys through connected streets too, without adding
    // a stop or changing their existing stop sequence.
    if (!windows.length) for (let i = 1; i < coords.length; i++) {
      const crossing = Array.from({ length: 11 }, (_, j) => coords[i].map((v, a) => v + (coords[i - 1][a] - v) * j / 10))
        .some(p => p[0] > 113.54310 && p[0] < 113.54358 && p[1] > 22.18918 && p[1] < 22.18960)
      if (!crossing) continue
      const next = route.stopOffsets.findIndex(offset => offset >= i)
      const lower = next > 0 ? route.stopOffsets[next - 1] + 1 : 0
      const upper = next >= 0 ? route.stopOffsets[next] - 1 : coords.length - 1
      let a = i - 1, b = i
      while (a > lower && inside(coords[a])) a--
      while (b < upper && inside(coords[b])) b++
      windows.push({ a, b, stops: [], lower, upper }); i = b
    }
    if (!windows.length && !guide) continue
    const output = [], offsets = [...route.stopOffsets]
    let cursor = 0
    for (const window of windows) {
      let { a, b } = window
      const edges = [...graph]
      const isStart = a === 0 && window.stops[0] === 0
      const isEnd = b === coords.length - 1 && window.stops.at(-1) === route.stopOffsets.length - 1
      const via = window.stops.map(i => platforms.get(route.stopsForward[i]).vehiclePoint)
      const { lower, upper } = window
      const reference = via[0] ?? [113.5435461, 22.1895971]
      let first = via[0], last = via.at(-1)
      if (!isStart) for (;;) {
        try { first = attachAnchor(edges, coords[a], heading(coords[a], coords[a + 1]), reference, false, guide ? 15 : 5); break }
        catch (error) { if (a <= lower) throw new Error(`${route.id} entry: ${error.message}`); a-- }
      }
      if (!isEnd) for (;;) {
        try { last = attachAnchor(edges, coords[b], heading(coords[b - 1], coords[b]), via.at(-1) ?? reference, true, guide ? 15 : 5); break }
        catch (error) { if (b >= upper) throw new Error(`${route.id} exit: ${error.message}`); b++ }
      }
      if (a < cursor) throw new Error(`Overlapping terminal visits on ${route.id}`)
      output.push(...coords.slice(cursor, a))
      const targets = [first, ...via, last].filter((p, i, all) => !i || key(p) !== key(all[i - 1]))
      let path = [targets[0]]
      for (let i = 1; i < targets.length; i++) path.push(...findPath(edges, targets[i - 1], targets[i]).slice(1))
      if (!isStart && metres(coords[a], path[0]) > .05) path.unshift(coords[a])
      if (!isEnd && metres(coords[b], path.at(-1)) > .05) path.push(coords[b])
      path = roundedPath(path, new Set(via.map(key)))
      let after = -1
      for (const index of window.stops) {
        const p = platforms.get(route.stopsForward[index]).vehiclePoint
        const at = path.findIndex((q, j) => j > after && metres(p, q) < .01)
        if (at < 0) throw new Error(`Lost ${route.id} ${route.stopsForward[index]}`)
        offsets[index] = output.length + at; after = at
      }
      const shift = output.length + path.length - (b + 1)
      route.stopOffsets.forEach((offset, i) => { if (offset > b) offsets[i] = offset + shift })
      output.push(...path); cursor = b + 1
    }
    output.push(...coords.slice(cursor))
    if (offsets.some((v, i) => i && v <= offsets[i - 1])) throw new Error(`Stop order changed on ${route.id}`)
    route.geometry.geometry.coordinates = output
    route.geometry.properties ??= {}
    route.geometry.properties.amaralLayout = { layoutKey, geometryKey: fingerprint(output) }
    route.stopOffsets = offsets
    delete route.roadProfile // stale vertex spans must never survive geometry edits
    changes.push({ route: route.id, visits: windows.flatMap(w => w.stops).length, before: coords.length, after: output.length })
  }
  return changes
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const routes = JSON.parse(readFileSync('public/data/bus-routes.json', 'utf8'))
  const stops = JSON.parse(readFileSync('public/data/bus-stops.json', 'utf8'))
  const source = JSON.parse(readFileSync('data/bus_reference/amaral-terminal.json', 'utf8'))
  const guides = JSON.parse(readFileSync('data/bus_reference/amaral-route-paths.json', 'utf8'))
  const changes = patchAmaral(routes, stops, source, guides)
  writeFileSync('public/data/bus-routes.json', JSON.stringify(routes))
  writeFileSync('public/data/bus-stops.json', JSON.stringify(stops, null, 2) + '\n')
  console.log(JSON.stringify(changes))
  console.log(`Patched ${changes.length} routes. Rebuild profiles: node scripts/build-bus-road-profile.mjs`)
}
