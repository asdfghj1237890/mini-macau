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
    const layoutKey = fingerprint({ ...baseLayout, guide, guideLayoutVersion: guide ? 4 : undefined,
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
      // Follow the published departure corridor inside the box as well, not
      // only at its edges: the shortest street path from the last bay to the
      // exit anchor sent C-lane departures out through lane D and the mouth,
      // where MO Transport's traces use the loop road west of the terminal.
      // Guide vertices after the last bay that lie on a street (never on a
      // modelled bay lane) become intermediate targets; those on the open
      // apron, or that a directed path cannot reach, are skipped. Arrivals
      // keep the shortest street path: guiding them along the loop road too
      // measured worse in the viewport replay, since that road rejoins the
      // arc right where every entrance turns off.
      const stopAt = new Map(window.stops.map(i => [route.stopOffsets[i], platforms.get(route.stopsForward[i]).vehiclePoint]))
      const lastStop = Math.max(-1, ...window.stops.map(i => route.stopOffsets[i]))
      const others = [...platforms.values()].map(p => p.vehiclePoint).filter(p => !via.some(v => key(v) === key(p)))
      const targets = [first], waypoints = new Set()
      // A guide vertex that lies on a modelled bay lane must not be pinned to
      // a neighbouring street: the graph places the bay itself.
      const laneEdges = edges.filter(e => e.lane)
      const onLane = p => laneEdges.some(e => {
        const dx = (e.b[0] - e.a[0]) * MX, dy = (e.b[1] - e.a[1]) * 111320, length = Math.hypot(dx, dy) || 1
        const t = Math.max(0, Math.min(1, ((p[0] - e.a[0]) * MX * dx + (p[1] - e.a[1]) * 111320 * dy) / length ** 2))
        return metres(p, [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t]) < 6
      })
      const clear = p => targets.every(t => metres(p, t) >= 15) && via.every(v => metres(p, v) >= 20) &&
        others.every(v => metres(p, v) >= 6) && metres(p, last) >= 15 && !onLane(p)
      for (let i = a; i <= b; i++) {
        const stop = stopAt.get(i)
        if (stop) { if (key(stop) !== key(targets.at(-1))) targets.push(stop); continue }
        if (!guide || i === a || i === b || i < lastStop || !clear(coords[i])) continue
        let anchor
        try { anchor = attachAnchor(edges, coords[i], heading(coords[i - 1], coords[i + 1]), targets.at(-1), true, 6, .8) }
        catch { continue }
        if (key(anchor) === key(targets.at(-1))) continue
        targets.push(anchor); waypoints.add(key(anchor))
      }
      if (key(last) !== key(targets.at(-1))) targets.push(last)
      // Between two bays (or an edge anchor and a bay) the guided course is
      // kept only when it never passes the same node twice and is not much
      // longer than the shortest street path: a waypoint on a one-way street
      // that only a lap of the terminal returns from would otherwise drag the
      // route round the islands.
      const length = (start, points) => { let sum = 0, previous = start; for (const q of points) { sum += metres(previous, q); previous = q } return sum }
      const segments = []
      let fromFixed = targets[0], pending = []
      const flush = to => {
        const direct = findPath(edges, fromFixed, to).slice(1), limit = length(fromFixed, direct) * 1.5 + 30
        const through = points => {
          const guided = []
          let cursor = fromFixed
          for (const w of points) { try { guided.push(...findPath(edges, cursor, w).slice(1)); cursor = w } catch { /* off the directed graph: skip */ } }
          try { guided.push(...findPath(edges, cursor, to).slice(1)) } catch { return undefined }
          const lap = new Set([key(fromFixed), ...guided.map(key)]).size <= guided.length
          return !lap && length(fromFixed, guided) <= limit ? guided : undefined
        }
        // One misplaced waypoint should not cost the whole corridor: retry
        // without each single waypoint, latest first, before routing directly.
        let guided = through(pending)
        for (let i = pending.length - 1; i >= 0 && !guided; i--) guided = through(pending.filter((_, j) => j !== i))
        segments.push(...(guided ?? direct))
        fromFixed = to; pending = []
      }
      for (const to of targets.slice(1)) { if (waypoints.has(key(to))) pending.push(to); else flush(to) }
      let path = [targets[0], ...segments]
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
