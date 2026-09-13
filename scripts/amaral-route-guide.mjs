import { metres } from './amaral-network.mjs'

// The local 25AX trace concatenates a complete loop and a partial second
// journey. Reuse its closed GPX for matching terminal windows in that second
// journey, without adding a loop to the route or changing its stop sequence.
export const AMARAL_GUIDE_REPETITIONS = { '25AX': 2 }

// GPX supplies the approach/departure corridor. Bay centres are refined by the
// terminal graph afterwards; GPX lines are not surveyed platform boundaries.
export function applyTerminalGuide(route, stops, guide) {
  const points = [], vertices = new Set()
  const repetitions = AMARAL_GUIDE_REPETITIONS[route.id] ?? 1
  if (repetitions > 1 && metres(guide.paths[0].coordinates[0], guide.paths.at(-1).coordinates.at(-1)) > 100)
    throw new Error(`${route.id}: repeated terminal guide must be a closed loop`)
  for (const path of Array.from({ length: repetitions }, () => guide.paths).flat()) for (let i = 0; i < path.coordinates.length; i++) {
    const b = path.coordinates[i], a = i ? path.coordinates[i - 1] : b
    const count = Math.max(1, Math.ceil(metres(a, b) / 2.5))
    for (let j = 1; j <= count; j++) points.push(a.map((v, k) => v + (b[k] - v) * j / count))
    vertices.add(points.length - 1)
  }
  const nearest = (p, from, to) => {
    let index = from, distance = Infinity
    for (let i = from; i <= to; i++) {
      const d = metres(p, points[i])
      if (d < distance) { distance = d; index = i }
    }
    if (distance > 100) throw new Error(`${route.id}: GPX anchor ${p.join(',')} is ${distance.toFixed(1)} m away`)
    return index
  }
  const visits = []
  route.stopsForward.forEach((id, index) => {
    if (id.startsWith('M172/')) visits.push({ index, at: nearest(stops.get(id).coordinates, (visits.at(-1)?.at ?? -1) + 1, points.length - 1) })
  })
  const old = route.geometry.geometry.coordinates, offsets = [...route.stopOffsets], output = []
  const windows = visits.map(({ index, at }) => ({
    a: index ? route.stopOffsets[index - 1] + 1 : 0,
    b: index + 1 < offsets.length ? route.stopOffsets[index + 1] - 1 : old.length - 1,
    index, at,
  }))
  // A service can visit one bay outbound but only pass the roundabout on its
  // return. Correct those inter-stop corridors too, not just scheduled calls.
  for (let i = 1; i < old.length; i++) {
    if (windows.some(w => i >= w.a && i <= w.b)) continue
    const samples = Math.max(1, Math.ceil(metres(old[i - 1], old[i]) / 5))
    const through = Array.from({ length: samples + 1 }, (_, j) => {
      const p = old[i].map((v, k) => v + (old[i - 1][k] - v) * j / samples)
      return p[0] > 113.5427 && p[0] < 113.5440 && p[1] > 22.18865 && p[1] < 22.18985
    }).some(Boolean)
    if (!through) continue
    const next = route.stopOffsets.findIndex(offset => offset >= i)
    const a = next > 0 ? route.stopOffsets[next - 1] + 1 : 0
    const b = next >= 0 ? route.stopOffsets[next] - 1 : old.length - 1
    if (b < a || windows.some(w => a <= w.b && b >= w.a)) continue
    windows.push({ a, b }); i = b
  }
  windows.sort((a, b) => a.a - b.a)
  let cursor = 0
  let guideCursor = 0
  for (const window of windows) {
    let { a, b } = window
    const { index, at } = window
    if (a < cursor) throw new Error(`${route.id}: adjacent terminal stops need a shared GPX window`)
    const nextVisit = visits.find(v => route.stopOffsets[v.index] > b)
    const limit = nextVisit ? nextVisit.at - 1 : points.length - 1
    let from, to
    try { from = nearest(old[a], guideCursor, at ?? limit) }
    catch (error) {
      // A sparse OSRM vertex immediately beside a stop may sit on the wrong
      // road. Extend to that exact stop, whose location remains unchanged.
      if (a <= cursor || !route.stopOffsets.includes(a - 1)) throw error
      from = nearest(old[--a], guideCursor, at ?? limit)
    }
    try { to = nearest(old[b], at ?? from, limit) }
    catch (error) {
      if (b + 1 >= old.length || !route.stopOffsets.includes(b + 1)) throw error
      to = nearest(old[++b], at ?? from, limit)
    }
    // Dense samples are only for projecting anchors; keep source vertices
    // outside the station so long bridge approaches do not inflate the app.
    const indices = [...new Set([from, at, to, ...vertices])].filter(i => i !== undefined && i >= from && i <= to).sort((a, b) => a - b)
    const path = [old[a], ...indices.map(i => points[i]), old[b]]
    output.push(...old.slice(cursor, a))
    if (index !== undefined) offsets[index] = output.length + 1 + indices.indexOf(at)
    const shift = output.length + path.length - (b + 1)
    route.stopOffsets.forEach((offset, i) => {
      if (offset === a) offsets[i] = output.length
      else if (offset === b) offsets[i] = output.length + path.length - 1
      else if (offset > b) offsets[i] = offset + shift
    })
    output.push(...path); cursor = b + 1; guideCursor = to
  }
  output.push(...old.slice(cursor))
  route.geometry.geometry.coordinates = output
  route.stopOffsets = offsets
}
