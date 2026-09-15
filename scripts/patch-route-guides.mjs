// Make each bus route follow MO Transport's published GPX trace wherever the
// drawn loop leaves it: OSRM detours (a peninsula route sent over 澳門大橋 and
// back, a lap of the Cotai golf course, a trip through the university tunnel)
// and turnarounds drawn differently. Only stop-to-stop legs that deviate
// structurally are rewritten; the replacement is OSRM's road-snapped path
// through the trace when that stays on the trace, otherwise the trace itself.
// Runs on the output of the extract/bridge/Amaral steps (legs next to the
// Amaral platforms are the terminal patch's, bridge crossings the bridge
// patch's); rebuild the road profile afterwards. The whole post-processing
// chain is `npm run data:routes`. Traces: data/bus_reference/route-paths.json
// from scripts/capture-route-paths.mjs; check the result with
// `node scripts/inspect.mjs bus-route-match`.
//
//   node scripts/patch-route-guides.mjs [route-id…] [--dry-run] [--no-osrm] [--verbose]
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { buildRoadIndex } from './build-bus-road-profile.mjs'

// Same digest as patch-amaral-terminal.mjs: the Amaral layout stays valid
// (its windows are never touched here), so its geometry key is refreshed.
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
const MX = 111320 * Math.cos(22.19 * Math.PI / 180), MY = 111320
const xy = ([lng, lat]) => [(lng - 113.55) * MX, (lat - 22.19) * MY]
const metres = (a, b) => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY)
const OFF_M = 30            // farther than this from the other line counts as off it
const STRUCTURAL_M = 120    // metres off before a leg is rewritten…
const STRUCTURAL_MAX_M = 60 // …and it must leave by more than a parallel carriageway
const STOP_REACH_M = 80     // the trace must pass this close to a stop to guide its legs
const OSRM = 'https://router.project-osrm.org/route/v1/driving/'
const args = process.argv.slice(2)
const selected = args.filter(a => !a.startsWith('--')), dryRun = args.includes('--dry-run'), useOsrm = !args.includes('--no-osrm'), verbose = args.includes('--verbose')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Nearest point of a polyline (metre coordinates) to p, searching segments [from, to).
function nearest(pts, p, from = 0, to = pts.length - 1) {
  let best = { distance: Infinity, index: -1, t: 0 }
  for (let i = from; i < to; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
    if (d < best.distance) best = { distance: d, index: i, t }
  }
  return best
}
// Every separate pass of the polyline within STOP_REACH_M of p, scanning
// segments [from, to): the closest point of each pass.
function passes(pts, p, from, to) {
  const out = []
  let best = null
  for (let i = from; i < to; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
    if (d <= STOP_REACH_M) { if (!best || d < best.distance) best = { distance: d, index: i, t } }
    else if (best) { out.push(best); best = null }
  }
  if (best) out.push(best)
  return out
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const length = coords => { let sum = 0; for (let i = 1; i < coords.length; i++) sum += metres(coords[i - 1], coords[i]); return sum }
// Metres of `coords` (sampled every 5 m) farther than OFF_M from `other`, and the largest gap.
function offMetres(coords, other) {
  const pts = other.map(xy)
  let off = 0, max = 0
  for (let i = 1; i < coords.length; i++) {
    const seg = metres(coords[i - 1], coords[i]), n = Math.max(1, Math.ceil(seg / 5))
    for (let j = 0; j < n; j++) {
      const d = nearest(pts, xy(lerp(coords[i - 1], coords[i], j / n))).distance
      if (d > OFF_M) off += seg / n
      if (d > max) max = d
    }
  }
  return { off: Math.round(off), max: Math.round(max) }
}
function densify(coords, gap) {
  const out = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    const n = Math.max(1, Math.ceil(metres(coords[i - 1], coords[i]) / gap))
    for (let j = 1; j <= n; j++) out.push(lerp(coords[i - 1], coords[i], j / n))
  }
  return out
}
// The published trace is drawn by hand, often 10–20 m off the road's centre
// line, which the road profile (and its opposing-lane offsets) cannot match.
// Pull each vertex onto the nearest OSM way within SNAP_M that runs the same
// way (a one-way carriageway only in its own direction), preferring the way
// the previous vertex is on so parallel ways do not alternate.
const SNAP_M = 12
const roadXY = ([lng, lat]) => [(lng - 113.54) * MX, (lat - 22.19) * MY]
const roadLngLat = ([x, y]) => [113.54 + x / MX, 22.19 + y / MY]
let roadIndex
try {
  const snapshot = JSON.parse(readFileSync('data/raw/bus-road-ways.json', 'utf8'))
  roadIndex = buildRoadIndex(snapshot.elements)
} catch { console.warn('No OSM road snapshot (data/raw/bus-road-ways.json): trace legs are not snapped to road centre lines. Run build-bus-road-profile.mjs first.') }
function snapTrace(coords) {
  if (!roadIndex) return coords
  const out = []
  let previousWay
  for (let i = 0; i < coords.length; i++) {
    const p = roadXY(coords[i]), before = roadXY(coords[Math.max(0, i - 1)]), after = roadXY(coords[Math.min(coords.length - 1, i + 1)])
    const hx = after[0] - before[0], hy = after[1] - before[1], h = Math.hypot(hx, hy) || 1
    let best
    for (const s of roadIndex.near(p, SNAP_M)) {
      const along = (s.fx * hx + s.fy * hy) / h
      if (s.direction ? along * s.direction < .9 : Math.abs(along) < .9) continue
      const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * s.dx + (p[1] - s.a[1]) * s.dy) / s.length ** 2))
      const q = [s.a[0] + t * s.dx, s.a[1] + t * s.dy], distance = Math.hypot(p[0] - q[0], p[1] - q[1])
      if (distance > SNAP_M) continue
      const score = distance - (s.wayId === previousWay ? 4 : 0)
      if (!best || score < best.score) best = { score, q, wayId: s.wayId }
    }
    if (best) { previousWay = best.wayId; out.push(roadLngLat(best.q)) } else out.push(coords[i])
  }
  return out.filter((p, i) => !i || metres(p, out[i - 1]) > 1)
}
// A course that reaches both the peninsula and Taipa crosses one of the bridges.
const crossesChannel = coords => coords.some(([, lat]) => lat < 22.172) && coords.some(([, lat]) => lat > 22.186)

async function osrm(waypoints, radiusM) {
  // Via points may only snap to a road within radiusM of the trace, so OSRM
  // cannot pull the course onto a side street to reach one of them.
  const url = OSRM + waypoints.map(p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';') +
    `?overview=full&geometries=geojson&steps=false&radiuses=${waypoints.map((p, i) => i === 0 || i === waypoints.length - 1 ? 50 : radiusM).join(';')}`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (response.status === 429) { await sleep(2000 * (attempt + 1)); continue }
      if (!response.ok) return undefined
      const data = await response.json()
      return data.code === 'Ok' ? data.routes[0].geometry.coordinates : undefined
    } catch { await sleep(1000) }
  }
  return undefined
}

async function guideRoute(route, reference, stops) {
  const coords = route.geometry.geometry.coordinates
  const trace = []
  for (const p of reference.paths.flatMap(path => path.coordinates)) if (!trace.length || metres(trace.at(-1), p) > .5) trace.push(p)
  const ring = [...trace, ...trace]                       // cyclic search: the trace may start anywhere on the loop
  const ringXY = ring.map(xy)
  const cum = [0]
  for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + metres(ring[i - 1], ring[i]))
  const along = hit => cum[hit.index] + (cum[hit.index + 1] - cum[hit.index]) * hit.t
  // Project every stop vertex onto the trace, in visit order. The trace can
  // pass a stop twice (outbound and return on the same street), so among the
  // passes ahead of the previous stop take the first whose distance along the
  // trace is plausible for the leg, not simply the closest. A stop the trace
  // never comes near (an Amaral bay, a terminal forecourt) leaves its two
  // legs alone.
  const projections = []
  let cursor = 0, previousHit = null
  route.stopOffsets.forEach((offset, k) => {
    const p = xy(coords[offset])
    if (k === 0) {
      const hit = nearest(ringXY, p, 0, trace.length)
      previousHit = hit.distance <= STOP_REACH_M ? hit : null
      projections.push(previousHit); cursor = hit.index
      return
    }
    const candidates = passes(ringXY, p, cursor, Math.min(ringXY.length - 1, cursor + trace.length))
    if (!candidates.length) { projections.push(null); return }
    const ourLegM = previousHit ? length(coords.slice(route.stopOffsets[k - 1], offset + 1)) : 0
    const plausible = c => !previousHit || along(c) - along(previousHit) <= ourLegM * 2.5 + 300
    const hit = candidates.find(plausible) ?? candidates.reduce((a, b) => along(a) <= along(b) ? a : b)
    projections.push(hit); previousHit = hit; cursor = hit.index
  })
  const tracePoint = hit => lerp(ring[hit.index], ring[hit.index + 1], hit.t)
  const traceSlice = (from, to) => {
    const out = [tracePoint(from)]
    for (let i = from.index + 1; i <= to.index; i++) out.push(ring[i])
    out.push(tracePoint(to))
    return out
  }
  const changes = []
  let output = [], previous = 0, shift = 0
  const offsets = [...route.stopOffsets]
  for (let k = 0; k + 1 < route.stopsForward.length; k++) {
    const a = route.stopOffsets[k], b = route.stopOffsets[k + 1]
    const from = projections[k], to = projections[k + 1]
    const name = id => stops.get(id.split('/')[0])?.nameCn ?? id
    const note = why => { if (verbose) console.log(`${route.id} leg ${k} ${name(route.stopsForward[k])} -> ${name(route.stopsForward[k + 1])}: ${why}`) }
    if (!from || !to) { note(`unguided (${!from ? 'first' : 'second'} stop is more than ${STOP_REACH_M} m from the trace)`); continue }
    if (b - a < 2) continue
    if (route.stopsForward[k].startsWith('M172/') || route.stopsForward[k + 1].startsWith('M172/')) { note('Amaral terminal leg'); continue }
    if (to.index < from.index || (to.index === from.index && to.t < from.t)) { note('trace order reversed'); continue }
    const ourLeg = coords.slice(a, b + 1)
    const guide = traceSlice(from, to)
    if (guide.length < 2 || length(guide) < 10) continue
    const ours = offMetres(ourLeg, guide), theirs = offMetres(guide, ourLeg)
    const structural = (ours.off >= STRUCTURAL_M && ours.max >= STRUCTURAL_MAX_M) || (theirs.off >= STRUCTURAL_M && theirs.max >= STRUCTURAL_MAX_M)
    if (!structural) { if (ours.off || theirs.off) note(`kept (ours off ${ours.off} m / max ${ours.max} m, trace off ${theirs.off} m / max ${theirs.max} m)`); continue }
    if (crossesChannel(guide)) { changes.push({ leg: k, skipped: 'guide crosses the Macau–Taipa channel (bridge patch owns it)', ours, theirs }); continue }
    // Prefer OSRM's road-snapped course through the trace (centre lines the
    // road profile can match); keep it only if it stays on the trace's
    // streets and is not longer than the trace itself. A parallel carriageway
    // of a wide avenue passes; a different street does not.
    let replacement, method = 'trace'
    if (useOsrm) {
      const via = densify(guide, 120).slice(1, -1).filter((p, i, list) => metres(p, coords[a]) > 60 && metres(p, coords[b]) > 60 && (i === 0 || metres(p, list[i - 1]) > 60))
      const snapped = await osrm([coords[a], ...via.slice(0, 60), coords[b]], 30)
      await sleep(500)
      if (snapped && snapped.length >= 2) {
        const check = offMetres(snapped, guide)
        if (check.max <= 35 && check.off <= Math.max(60, length(guide) * .08) && length(snapped) <= length(guide) * 1.15 + 30) { replacement = snapped; method = 'osrm' }
      }
    }
    if (!replacement) replacement = snapTrace(densify(guide, 10))
    // Endpoints stay on our stop vertices so the offsets remain exact.
    if (metres(replacement[0], coords[a]) > .05) replacement.unshift(coords[a])
    if (metres(replacement.at(-1), coords[b]) > .05) replacement.push(coords[b])
    output.push(...coords.slice(previous, a), ...replacement.slice(0, -1))
    const delta = replacement.length - (b - a + 1)
    shift += delta
    for (let i = k + 1; i < offsets.length; i++) offsets[i] = route.stopOffsets[i] + shift
    previous = b
    changes.push({ leg: k, from: name(route.stopsForward[k]), to: name(route.stopsForward[k + 1]), oursOffM: ours.off, theirsOffM: theirs.off, oldM: Math.round(length(ourLeg)), newM: Math.round(length(replacement)), method })
  }
  output.push(...coords.slice(previous))
  if (changes.some(c => !c.skipped)) {
    if (offsets.some((v, i) => i && v <= offsets[i - 1])) throw new Error(`Stop order changed on ${route.id}`)
    for (let k = 0; k < offsets.length; k++) if (metres(output[offsets[k]], coords[route.stopOffsets[k]]) > .05) throw new Error(`Stop ${route.stopsForward[k]} moved on ${route.id}`)
    route.geometry.geometry.coordinates = output
    route.stopOffsets = offsets
    if (route.geometry.properties?.amaralLayout) route.geometry.properties.amaralLayout.geometryKey = fingerprint(output)
    delete route.roadProfile // stale vertex spans must never survive geometry edits
  }
  return changes
}

const routes = JSON.parse(readFileSync('public/data/bus-routes.json', 'utf8'))
const stops = new Map(JSON.parse(readFileSync('public/data/bus-stops.json', 'utf8')).map(s => [s.id, s]))
const reference = JSON.parse(readFileSync('data/bus_reference/route-paths.json', 'utf8'))
const summary = []
for (const route of routes) {
  if (selected.length && !selected.includes(route.id)) continue
  const ref = reference[route.id]
  if (!ref?.paths?.length) { console.log(`${route.id}: no trace`); continue }
  const changes = await guideRoute(route, ref, stops)
  for (const c of changes) console.log(`${route.id} leg ${c.leg}: ${c.skipped ? 'SKIP ' + c.skipped : `${c.from} -> ${c.to}: ${c.oldM} m -> ${c.newM} m (${c.method}; ours off ${c.oursOffM} m, trace off ${c.theirsOffM} m)`}`)
  if (changes.some(c => !c.skipped)) summary.push({ id: route.id, legs: changes.filter(c => !c.skipped).length, skipped: changes.filter(c => c.skipped).length })
}
if (!dryRun) writeFileSync('public/data/bus-routes.json', JSON.stringify(routes))
console.log(JSON.stringify({ routes: summary.length, legs: summary.reduce((a, s) => a + s.legs, 0), skipped: summary.reduce((a, s) => a + s.skipped, 0), written: !dryRun }))
console.log(dryRun ? 'Dry run: nothing written.' : 'Rebuild profiles: node scripts/build-bus-road-profile.mjs')
