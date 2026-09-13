// Offline OSM road matching. Never called by the browser or the animation loop.
// Run after extracting/patching bus geometry: node scripts/build-bus-road-profile.mjs
// OSM semantics: https://wiki.openstreetmap.org/wiki/Key:oneway
// Separately mapped carriageways: https://wiki.openstreetmap.org/wiki/Dual_carriageway
import { readFile, writeFile, mkdir, rename, copyFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { buildAmaralNetwork } from './amaral-network.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MX = 111320 * Math.cos(22.19 * Math.PI / 180), MY = 111320, CELL = 64
const xy = p => [(p[0] - 113.54) * MX, (p[1] - 22.19) * MY]
const number = v => typeof v === 'string' && /^\d+(\.\d+)?(?: m)?$/.test(v) ? parseFloat(v) : undefined

export function geometryKey(coords) {
  let hash = 2166136261
  for (const point of coords) for (const value of point) hash = Math.imul(hash ^ Math.round(value * 1e6), 16777619)
  return `${coords.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function roadDirection(tags) {
  // Public-transport exceptions take precedence. Conditional/reversible access
  // cannot be resolved from a static road profile and stays explicitly unknown.
  if (Object.keys(tags).some(k => /^oneway(?::bus|:psv)?:conditional$/.test(k))) return null
  const v = tags['oneway:bus'] ?? tags['oneway:psv'] ?? tags.oneway
  if (['yes', '1', 'true'].includes(v)) return 1
  if (v === '-1') return -1
  if (['no', '0', 'false'].includes(v)) return 0
  if (v !== undefined) return null
  if (tags.junction === 'roundabout' || tags.highway === 'motorway') return 1
  return 0 // OSM's default, recorded separately from an explicit tag.
}

function projection(p, s) {
  const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * s.dx + (p[1] - s.a[1]) * s.dy) / s.length ** 2))
  const x = s.a[0] + t * s.dx, y = s.a[1] + t * s.dy
  return { distance: Math.hypot(p[0] - x, p[1] - y), x, y }
}

export function buildRoadIndex(ways) {
  const cells = new Map(), segments = []
  for (const way of ways) {
    if (way.type !== 'way' || !way.geometry || !way.tags?.highway) continue
    let tags = way.tags
    // DSAT confirms two-way, two-lane traffic on the old bridge. OSM currently
    // tags lanes=1 on the span and approach, which must not create a 2.6 km
    // single-lane reservation. The published 9.2 m includes footways, so no
    // carriageway width is inferred from it.
    if (tags['name:zh'] === '嘉樂庇總督大橋' && tags.lanes === '1' && tags.oneway === 'no') {
      tags = { ...tags, lanes: '2', _osmLanes: 1, _lanesSource: 'https://www.dsat.gov.mo/dsat/subpage.aspx?a_id=1614585011' }
    }
    const direction = roadDirection(tags)
    const grade = `${tags.layer ?? '0'}/${tags.bridge ?? 'no'}/${tags.tunnel ?? 'no'}`
    const identity = tags.ref || tags['name:zh'] || tags.name || tags['name:pt']
    const coords = way.geometry.map(p => xy([p.lon, p.lat]))
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
      if (length < .05) continue
      const s = { wayId: way.id, segmentIndex: i - 1, tags, direction, grade, identity, a, b, dx, dy, length, fx: dx / length, fy: dy / length }
      segments.push(s)
      for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
          const key = `${x},${y}`
          if (!cells.has(key)) cells.set(key, [])
          cells.get(key).push(s)
        }
    }
  }
  const near = (p, radius = 40) => {
    const result = new Set()
    for (let x = Math.floor((p[0] - radius) / CELL); x <= Math.floor((p[0] + radius) / CELL); x++)
      for (let y = Math.floor((p[1] - radius) / CELL); y <= Math.floor((p[1] + radius) / CELL); y++)
        for (const s of cells.get(`${x},${y}`) ?? []) result.add(s)
    return result
  }
  return { segments, near }
}

function pairedCarriageway(s, p, index) {
  if (!s.direction || !s.identity || s.tags.junction || s.tags.highway.endsWith('_link')) return undefined
  // Infer a pair only from the same named/ref road, same grade, parallel
  // opposing travel, with the opposing carriageway to the driver's right.
  // This is evidence of separate geometry, NOT a surveyed physical median.
  const fx = s.fx * s.direction, fy = s.fy * s.direction
  for (const q of index.near(p)) {
    if (q.wayId === s.wayId || !q.direction || q.identity !== s.identity || q.grade !== s.grade) continue
    if ((q.fx * fx + q.fy * fy) * q.direction > -.94) continue
    const projected = projection(p, q), right = (projected.x - p[0]) * fy - (projected.y - p[1]) * fx
    if (projected.distance >= 4 && projected.distance <= 35 && right > 3) return q.wayId
  }
}

export function matchRoad(aLngLat, bLngLat, index) {
  const a = xy(aLngLat), b = xy(bLngLat), dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
  if (length < .05) return { kind: 'unknown', evidence: 'unmatched' }
  const p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], fx = dx / length, fy = dy / length
  let best, score = Infinity
  for (const s of index.near(p, 12)) {
    const dot = fx * s.fx + fy * s.fy, distance = projection(p, s).distance
    // These curves were constructed from the same directed terminal paths.
    // A rounded corner must not fall back to an unknown-road lateral shift.
    const terminalCurve = s.tags._lanePath && dot > .1 && distance < 2
    if (!terminalCurve && (Math.abs(dot) < .9 || distance > 8)) continue
    // Never choose a distant correct-way carriageway over an exact wrong-way
    // match: the latter reveals stale/imported geometry and must be reviewed.
    const candidate = distance + (1 - Math.abs(dot)) * (terminalCurve ? 1 : 15)
    if (candidate < score) { score = candidate; best = s }
  }
  if (!best) return { kind: 'unknown', evidence: 'unmatched' }
  const s = best, travel = fx * s.fx + fy * s.fy >= 0 ? 1 : -1
  if (s.tags._lanePath && travel === 1) return { kind: 'one-way', evidence: 'terminal-layout', lanePath: s.tags._lanePath,
    ...(typeof s.wayId === 'number' ? { wayId: s.wayId, direction: 1 } : {}) }
  const osmIdentity = typeof s.wayId === 'number' ? { wayId: s.wayId } : {}
  if (s.direction === null) return { kind: 'unknown', evidence: 'conditional', ...osmIdentity }
  if (s.direction && travel !== s.direction) return { kind: 'unknown', evidence: 'direction-mismatch', ...osmIdentity }
  const onRoad = projection(p, s)
  const pair = pairedCarriageway(s, [onRoad.x, onRoad.y], index)
  const tags = s.tags, kind = s.direction === 0 ? 'two-way' : pair ? 'divided' : 'one-way'
  const lanes = number(tags.lanes)
  const directionalLanes = number(tags[travel === 1 ? 'lanes:forward' : 'lanes:backward'])
  const width = number(tags.width)
  return { kind, evidence: pair ? 'paired-geometry' : tags.oneway !== undefined || tags['oneway:bus'] !== undefined || tags['oneway:psv'] !== undefined ? 'tag' : 'default',
    wayId: s.wayId, direction: travel, ...(pair ? { pairedWayId: pair } : {}),
    ...(lanes >= 1 && lanes <= 12 && Number.isInteger(lanes) ? { lanes } : {}),
    ...(tags._lanesSource ? { lanesSource: tags._lanesSource, osmLanes: tags._osmLanes } : {}),
    ...(directionalLanes >= 1 && directionalLanes <= 12 && Number.isInteger(directionalLanes) ? { directionalLanes } : {}),
    ...(width >= 2 && width <= 50 ? { widthM: width } : {}),
  }
}

export function annotateRoutes(routes, ways, fetchedAtUtc) {
  const index = buildRoadIndex(ways)
  const junctions = buildJunctionIndex(ways)
  for (const route of routes) {
    const coords = route.geometry.geometry.coordinates, sections = []
    let previous = ''
    for (let i = 0; i < coords.length - 1; i++) {
      const value = matchRoad(coords[i], coords[i + 1], index), key = JSON.stringify(value)
      if (key === previous) sections.at(-1).end = i + 1
      else sections.push({ start: i, end: i + 1, ...value })
      previous = key
    }
    route.roadProfile = { version: 1, geometryKey: geometryKey(coords), fetchedAtUtc, sections,
      junctions: routeJunctions(coords, junctions, sections) }
  }
  // OSRM traces sometimes use almost the same centre-line for opposite
  // carriageways. Keep their access classification, but mark that geometry
  // ambiguity so the renderer provides conservative directional separation.
  const traces = buildRoadIndex(routes.map((route, i) => ({ type: 'way', id: i, tags: { highway: 'service', oneway: 'yes' },
    geometry: route.geometry.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })) })))
  for (const trace of traces.segments) trace.road = routes[trace.wayId].roadProfile.sections.find(s => trace.segmentIndex >= s.start && trace.segmentIndex < s.end)
  for (const route of routes) {
    const points = route.geometry.geometry.coordinates.map(xy), sections = []
    const cumulative = [0]
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
    const entrances = route.roadProfile.sections.filter((s, i, all) => s.lanePath && !all[i - 1]?.lanePath).map(s => cumulative[s.start])
    let previous = ''
    for (const section of route.roadProfile.sections) {
      for (let i = section.start; i < section.end; i++) {
        const value = { ...section }
        delete value.start; delete value.end
        if (value.kind === 'one-way' && value.lanes > 1 && entrances.some(at => at > cumulative[i] && at - cumulative[i] <= 110)) value.entryLane = 'left'
        const a = points[i], b = points[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
        const p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        if (length >= .05 && !(section.kind === 'two-way' && (section.lanes === 1 || section.widthM < 5.9))) {
          for (const q of traces.near(p, 3)) if ((dx * q.fx + dy * q.fy) / length < -.94 && projection(p, q).distance < 3) {
            value.opposingRouteGeometry = true
            break
          }
        }
        if (length >= .05 && section.kind === 'divided' && section.lanes > 1 && !value.opposingRouteGeometry) {
          const count = section.directionalLanes ?? section.lanes
          const inner = -(count - 1) * (section.widthM ?? section.lanes * 3.5) / section.lanes / 2
          let minimum = inner
          // Imported carriageway centres need not be separated by their full
          // tagged width. Divide the actual space between opposing traces;
          // suppress only lane centres that would put buses across that divide.
          // Sample the complete segment so a long taper cannot hide at its end.
          const steps = Math.max(1, Math.ceil(length / 8))
          for (let step = 0; step <= steps; step++) {
            const point = [a[0] + dx * step / steps, a[1] + dy * step / steps]
            for (const q of traces.near(point, 16)) {
              if (q.road?.wayId !== section.pairedWayId && q.road?.pairedWayId !== section.wayId) continue
              if ((dx * q.fx + dy * q.fy) / length >= -.94) continue
              const near = projection(point, q)
              const right = ((near.x - point[0]) * dy - (near.y - point[1]) * dx) / length
              if (right <= 0 || near.distance > 16) continue
              minimum = Math.max(minimum, Math.ceil((1.6 - near.distance / 2) * 10) / 10)
            }
          }
          if (minimum > inner) value.minLaneOffsetM = minimum
        }
        // A close approach at one end must not shift the entire OSM way:
        // farther along, already separated carriageways could be shifted
        // towards each other and create a false head-on conflict.
        const key = JSON.stringify(value)
        if (key === previous) sections.at(-1).end = i + 1
        else sections.push({ start: i, end: i + 1, ...value })
        previous = key
      }
    }
    route.roadProfile.sections = sections
  }
  return routes
}

// Connected OSM nodes identify real junctions; geometric flyover crossings
// with different node ids do not become intersections. Include tight bends so
// long bus bodies clear the bend before the following vehicle enters it.
export function buildJunctionIndex(ways) {
  const nodes = new Map()
  for (const way of ways) {
    if (!way.nodes || !way.geometry || !way.tags?.highway) continue
    for (let i = 0; i < way.nodes.length; i++) {
      const id = way.nodes[i], point = way.geometry[i]
      if (!point) continue
      let node = nodes.get(id)
      if (!node) { node = { id, point: xy([point.lon, point.lat]), neighbours: new Map(), wayIds: new Set() }; nodes.set(id, node) }
      node.wayIds.add(way.id)
      for (const j of [i - 1, i + 1]) if (way.geometry[j]) node.neighbours.set(way.nodes[j], xy([way.geometry[j].lon, way.geometry[j].lat]))
    }
  }
  const candidates = [...nodes.values()].filter(n => {
    if (n.neighbours.size > 2) return true
    if (n.neighbours.size !== 2) return false
    const [a, b] = [...n.neighbours.values()].map(p => [p[0] - n.point[0], p[1] - n.point[1]])
    return (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b)) > .15
  }).sort((a, b) => a.id - b.id)
  const zones = [], cells = new Map()
  const near = (point, radius = 60) => {
    const found = []
    for (let x = Math.floor((point[0] - radius) / CELL); x <= Math.floor((point[0] + radius) / CELL); x++)
      for (let y = Math.floor((point[1] - radius) / CELL); y <= Math.floor((point[1] + radius) / CELL); y++)
        found.push(...(cells.get(`${x},${y}`) ?? []))
    return found
  }
  for (const n of candidates) {
    let zone = near(n.point, 12).find(z => [...n.wayIds].some(id => z.wayIds.has(id)) && Math.hypot(z.point[0] - n.point[0], z.point[1] - n.point[1]) < 12)
    if (zone) {
      zone.radius = Math.max(zone.radius, Math.hypot(zone.point[0] - n.point[0], zone.point[1] - n.point[1]) + 8)
      for (const id of n.wayIds) zone.wayIds.add(id)
    } else {
      zone = { id: `j${n.id}`, point: n.point, radius: 8, wayIds: n.wayIds }
      zones.push(zone)
      const key = `${Math.floor(n.point[0] / CELL)},${Math.floor(n.point[1] / CELL)}`
      if (!cells.has(key)) cells.set(key, [])
      cells.get(key).push(zone)
    }
  }
  return { zones, near }
}

export function routeJunctions(coords, index, sections = []) {
  const intervals = new Map()
  const points = coords.map(xy), cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  const total = cum.at(-1)
  let sectionIndex = 0
  for (let i = 0; i < points.length - 1; i++) {
    while (sectionIndex + 1 < sections.length && sections[sectionIndex].end <= i) sectionIndex++
    const wayId = sections[sectionIndex]?.wayId ?? sections[sectionIndex]?.lanePath
    const a = points[i], b = points[i + 1], length = cum[i + 1] - cum[i]
    if (length < .001) continue
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    for (const zone of index.near(mid, length / 2 + 35)) {
      if (wayId && !zone.wayIds.has(wayId)) continue
      const dx = (b[0] - a[0]) / length, dy = (b[1] - a[1]) / length
      const x = a[0] - zone.point[0], y = a[1] - zone.point[1], projection = -(x * dx + y * dy)
      const perpendicular2 = x * x + y * y - projection * projection
      if (perpendicular2 > zone.radius ** 2) continue
      const half = Math.sqrt(Math.max(0, zone.radius ** 2 - perpendicular2))
      const start = Math.max(0, projection - half), end = Math.min(length, projection + half)
      if (end <= start) continue
      const list = intervals.get(zone.id) ?? []
      const from = cum[i] + start, to = cum[i] + end
      if (list.length && from <= list.at(-1)[1] + .1) list.at(-1)[1] = to
      else list.push([from, to])
      intervals.set(zone.id, list)
    }
  }
  for (const section of sections) if (section.kind === 'two-way' && (section.lanes === 1 || section.widthM < 5.9)) {
    const id = `n${section.wayId}`, list = intervals.get(id) ?? []
    list.push([cum[section.start], cum[section.end]]); intervals.set(id, list)
  }
  const headingAt = distance => {
    let i = 0
    while (i + 2 < cum.length && cum[i + 1] < distance) i++
    return (Math.atan2(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]) * 180 / Math.PI + 360) % 360
  }
  return [...intervals].flatMap(([id, list]) => list.map(([start, end]) => ({ id, start: +(start / total).toFixed(8), end: +(end / total).toFixed(8), bearing: +headingAt(start).toFixed(1) })))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
}

async function run() {
  const path = join(ROOT, 'public/data/bus-routes.json'), cachePath = join(ROOT, 'data/raw/bus-road-ways.json')
  let snapshot
  const input = process.argv.indexOf('--input')
  if (input >= 0) {
    const data = JSON.parse(await readFile(process.argv[input + 1], 'utf8'))
    if (!data.fetchedAtUtc || !Array.isArray(data.elements)) throw new Error('--input requires a dated OSM snapshot')
    snapshot = data
  }
  if (!snapshot && !process.argv.includes('--refresh')) {
    try { snapshot = JSON.parse(await readFile(cachePath, 'utf8')) } catch { /* first run */ }
  }
  if (!snapshot) {
    // Include bridges/links and the university campus; only matched bus route
    // spans are emitted, so no surrounding mainland road network is shipped.
    const query = '[out:json][timeout:90];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](22.05,113.50,22.235,113.635);out geom;'
    let error
    for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
      try {
        const response = await fetch(`${host}?${new URLSearchParams({ data: query })}`, { signal: AbortSignal.timeout(110000) })
        if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`)
        const data = await response.json()
        if (!Array.isArray(data.elements) || data.elements.length < 1000 || data.remark) throw new Error('Incomplete road response')
        snapshot = { fetchedAtUtc: new Date().toISOString(), osmTimestamp: data.osm3s?.timestamp_osm_base, elements: data.elements }
        await mkdir(dirname(cachePath), { recursive: true }); await writeFile(cachePath, JSON.stringify(snapshot))
        break
      } catch (e) { error = e; console.warn(String(e)) }
    }
    if (!snapshot) throw error
  }
  const source = JSON.parse(await readFile(join(ROOT, 'data/bus_reference/amaral-terminal.json'), 'utf8'))
  const terminal = buildAmaralNetwork(source), replaced = new Set(terminal.ways.map(w => w.id))
  const ways = [...snapshot.elements.filter(w => !replaced.has(w.id)), ...terminal.ways]
  const routes = annotateRoutes(JSON.parse(await readFile(path, 'utf8')), ways, snapshot.fetchedAtUtc)
  const tempPath = join(ROOT, 'data/raw/bus-routes-profile-output.json')
  await writeFile(tempPath, JSON.stringify(routes))
  try { await rename(tempPath, path) } catch (error) {
    // Windows file watchers may hold the destination without FILE_SHARE_DELETE.
    // The complete validated output already exists in the local staging file.
    if (error.code !== 'EPERM') throw error
    await copyFile(tempPath, path); await unlink(tempPath)
  }
  console.log(`Annotated ${routes.length} routes using ${snapshot.elements.length} OSM ways (${snapshot.fetchedAtUtc}).`)
  console.log('Inspect: node scripts/inspect.mjs bus-roads')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
