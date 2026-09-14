// M172's platform facts are imported; vehicle centre lines are a local model.
// Keep these estimates separate from the unmodified OSM source snapshot.
const MX = 111320 * Math.cos(22.19 * Math.PI / 180), MY = 111320
export const metres = (a, b) => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY)
export const key = p => p.map(n => n.toFixed(7)).join(',')
const point = p => [p.lon, p.lat]
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

export function buildAmaralNetwork(source) {
  const ways = structuredClone(source.ways).filter(w => !w.tags.tunnel && Number(w.tags.layer ?? 0) >= 0 &&
    (!['no', 'private'].includes(w.tags.access) || w.tags.bus === 'yes') && w.tags.service !== 'driveway')
  const platforms = new Map(source.platforms.map(p => [Number(p.id.split('/')[1]), p]))
  // Approximate 1.8 m from the stop pole to the vehicle centre, on its right
  // in the direction of travel. This is not a measured road/platform width.
  const bay = (id, bearing) => {
    const p = platforms.get(id), a = bearing * Math.PI / 180
    p.vehiclePoint = [p.coordinates[0] + Math.cos(a) * 1.8 / MX, p.coordinates[1] - Math.sin(a) * 1.8 / MY]
    return p.vehiclePoint
  }
  const replace = (id, from, to, middle, lane) => {
    const w = ways.find(w => w.id === id), coords = w.geometry.map(point)
    const a = coords.findIndex(p => key(p) === key(from)), b = coords.findIndex(p => key(p) === key(to))
    if (a < 0 || b <= a) throw new Error(`Missing OSM connection ${id}`)
    w.geometry = [...coords.slice(0, a + 1), ...middle, ...coords.slice(b)].map(([lon, lat]) => ({ lon, lat }))
    w.nodes = w.geometry.map(p => key(point(p)))
    w.tags._lanePath = `amaral/${lane}`
  }
  replace(820959429, [113.5436266,22.1891019], [113.5435461,22.1895971],
    [[113.543597,22.189160], bay(1,345), bay(2,345), bay(3,345), [113.543479,22.189548]], 'A')
  replace(183815523, [113.5434001,22.1895042], [113.5434865,22.1891665],
    [bay(4,170), bay(5,168), bay(6,155)], 'B')
  replace(751603543, [113.5434206,22.1891709], [113.5432955,22.1895992],
    [[113.543374,22.189230], bay(7,355), bay(8,0), [113.543287,22.189550]], 'C')
  replace(819904532, [113.5431848,22.1894682], [113.5434094,22.189089],
    [bay(9,175), [113.543187,22.189350], bay(10,140), bay(11,135), [113.543350,22.189127]], 'D')
  replace(820959421, [113.5430983,22.1895437], [113.5432925,22.189081],
    [bay(12,180), [113.543067,22.189350], [113.543092,22.189288], bay(13,140), bay(14,135)], 'E')
  replace(792954597, [113.5430829,22.1891752], [113.5431736,22.1890816], [bay(15,140)], 'F')
  const add = (lane, coords) => ways.push({ type: 'way', id: `amaral/${lane}`,
    tags: { highway: 'service', oneway: 'yes', bus: 'yes', _lanePath: `amaral/${lane}` },
    geometry: coords.map(([lon, lat]) => ({ lon, lat })), nodes: coords.map(key) })
  // MO Transport's GPX continues from G around the north arc to the east;
  // it must not join the neighbouring northbound tunnel exit.
  add('G', [[113.5429941,22.1887788], [113.542994,22.188852], bay(16,60),
    [113.54308,22.188943], [113.54319,22.188978], [113.5433492,22.1889906]])
  // H is a kerb-side bay on the roundabout arc east of the mouth: MO Transport's
  // 2A/7 traces pull in from the arc and continue east along it. Rejoining the
  // arc at its next node, instead of turning back into lane A, keeps those
  // services out of the A/B lanes and the mouth. (A longer merge lane joining
  // 30 m further on measured no better in the viewport replay.)
  add('H', [[113.5435626,22.1890065], [113.543613,22.189028], bay(17,85),
    [113.543740,22.189010], [113.5437701,22.1889579]])
  // Shared coordinates, including new bay points, are the graph identities.
  // Only OSM shared nodes are junctions: crossing traces do not connect.
  const osmNodes = new Map(source.ways.flatMap(w => w.geometry.map((p, i) => [key(point(p)), w.nodes[i]])))
  for (const w of ways) w.nodes = w.geometry.map(p => osmNodes.get(key(point(p))) ?? `amaral-${key(point(p))}`)
  return { ways, platforms }
}

export function streetGraph(ways) {
  const edges = []
  for (const w of ways) {
    if (w.tags.bus === 'no' || w.tags['oneway:conditional'] || w.tags['oneway:bus:conditional']) continue
    const direction = w.tags['oneway:bus'] ?? w.tags['oneway:psv'] ?? w.tags.oneway
    const coords = w.geometry.map(point), oneway = ['yes', '1', 'true', '-1'].includes(direction) || (direction === undefined && w.tags.junction === 'roundabout')
    if (direction === '-1') coords.reverse()
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i]
      if (metres(a, b) < .05) continue
      const edge = { a, b, way: w.id, lane: w.tags._lanePath }
      edges.push(edge)
      if (!oneway) edges.push({ ...edge, a: b, b: a })
    }
  }
  return edges
}

export function attachAnchor(edges, p, heading, target, outgoing = false, maxDistance = 5, minDot = .5) {
  const reachable = new Set([key(target)])
  let changed = true
  while (changed) {
    changed = false
    for (const e of edges) {
      const from = key(outgoing ? e.a : e.b), to = key(outgoing ? e.b : e.a)
      if (reachable.has(from) && !reachable.has(to)) { reachable.add(to); changed = true }
    }
  }
  let best
  for (const e of edges) {
    if (!reachable.has(key(outgoing ? e.a : e.b))) continue
    const dx = (e.b[0] - e.a[0]) * MX, dy = (e.b[1] - e.a[1]) * MY, length = Math.hypot(dx, dy)
    const dot = heading ? (heading[0] * dx + heading[1] * dy) / length : 1
    if (dot < minDot || e.lane) continue
    const t = Math.max(0, Math.min(1, ((p[0] - e.a[0]) * MX * dx + (p[1] - e.a[1]) * MY * dy) / length ** 2))
    const q = lerp(e.a, e.b, t), distance = metres(p, q), score = distance + (1 - dot) * 12
    if (!best || score < best.score) best = { e, q, score, distance, t }
  }
  if (!best || best.distance > maxDistance) throw new Error(`No surface approach for ${p} (${best?.distance.toFixed(1)} m)`)
  if (best.t < .001) return best.e.a
  if (best.t > .999) return best.e.b
  const index = edges.indexOf(best.e), q = best.q
  edges.splice(index, 1, { ...best.e, b: q }, { ...best.e, a: q })
  return q
}

export function findPath(edges, start, end) {
  const adjacency = new Map(), positions = new Map()
  for (const e of edges) {
    const a = key(e.a), b = key(e.b)
    positions.set(a, e.a); positions.set(b, e.b)
    if (!adjacency.has(a)) adjacency.set(a, [])
    adjacency.get(a).push({ ...e, next: b, distance: metres(e.a, e.b) })
  }
  const from = key(start), to = key(end), distance = new Map([[from, 0]]), previous = new Map(), open = new Set([from])
  while (open.size) {
    let current
    for (const id of open) if (current === undefined || distance.get(id) < distance.get(current)) current = id
    if (current === to) break
    open.delete(current)
    for (const e of adjacency.get(current) ?? []) {
      const cost = distance.get(current) + e.distance
      if (cost >= (distance.get(e.next) ?? Infinity)) continue
      distance.set(e.next, cost); previous.set(e.next, current); open.add(e.next)
    }
  }
  if (!distance.has(to)) throw new Error(`No directed terminal path ${from} -> ${to}`)
  const path = [to]
  while (path[0] !== from) path.unshift(previous.get(path[0]))
  return path.map(id => positions.get(id))
}

export function roundedPath(coords, fixed = new Set()) {
  const points = [coords[0]]
  for (let i = 1; i < coords.length - 1; i++) {
    const a = coords[i - 1], b = coords[i], c = coords[i + 1]
    if (fixed.has(key(b))) { points.push(b); continue }
    const trim = Math.min(6, metres(a, b) * .35, metres(b, c) * .35)
    if (trim < .05) { points.push(b); continue }
    const enter = lerp(b, a, trim / metres(a, b)), leave = lerp(b, c, trim / metres(b, c))
    points.push(enter)
    for (let k = 1; k <= 5; k++) points.push(lerp(lerp(enter, b, k / 5), lerp(b, leave, k / 5), k / 5))
  }
  points.push(coords.at(-1))
  const dense = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], steps = Math.ceil(metres(a, b) / 2.5)
    for (let j = 1; j <= steps; j++) dense.push(lerp(a, b, j / steps))
  }
  return dense.map(p => p.map(n => +n.toFixed(9))).filter((p, i, all) => !i || metres(p, all[i - 1]) >= .001)
}
