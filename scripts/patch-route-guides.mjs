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
//   GUIDE_DEBUG=1 prints each stop's candidate passes on the trace and the chosen one.
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
const STOP_REACH_M = 150    // the trace must pass this close to a stop to guide its legs…
const STOP_TRUST_M = 80     // …and beyond this (a bay off the main road) only an OSRM course is trusted
const WEAK_M = 200          // a long stretch off by less than a street's width: OSRM course only
// Where the bus-only 嘉樂庇總督大橋 is modelled as its own polyline; a guided
// leg over it stays with the bridge patch.
const TAIPA_BRIDGE = [[113.5439408, 22.1867834], [113.54871793494438, 22.165134309019084]]
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
const usesTaipaBridge = coords => {
  const a = xy(TAIPA_BRIDGE[0]), b = xy(TAIPA_BRIDGE[1]), dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy
  return coords.some(c => {
    const p = xy(c), t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
    return t > .2 && t < .8 && Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < 80
  })
}

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

// Routes whose trace is traversed more than once per loop (see
// AMARAL_GUIDE_REPETITIONS): their closing is not a simple turnaround.
const NO_CLOSING = { '25AX': true }

// The course to drive from `a` to `b` along `guide`: OSRM's road-snapped path
// through the trace (centre lines the road profile can match) when it stays
// on the trace's streets and is not longer than the trace — a parallel
// carriageway of a wide avenue passes, a different street does not — else
// the trace itself, snapped to centre lines, unless only OSRM is trusted.
async function courseFor(a, b, guide, osrmOnly) {
  let course, method = 'trace'
  if (useOsrm) {
    const via = densify(guide, 120).slice(1, -1).filter((p, i, list) => metres(p, a) > 60 && metres(p, b) > 60 && (i === 0 || metres(p, list[i - 1]) > 60))
    const snapped = await osrm([a, ...via.slice(0, 60), b], 30)
    await sleep(500)
    if (snapped && snapped.length >= 2) {
      // Both ways: the course stays on the trace, and the trace is covered
      // (a turnaround loop OSRM shortcuts is not a match).
      const check = offMetres(snapped, guide), covered = offMetres(guide, snapped)
      const slack = Math.max(60, length(guide) * .08)
      if (check.max <= 35 && check.off <= slack && covered.off <= slack && length(snapped) <= length(guide) * 1.15 + 30) { course = snapped; method = 'osrm' }
    }
  }
  if (!course && osrmOnly) return undefined
  if (!course) course = snapTrace(densify(guide, 10))
  // Endpoints stay on our stop vertices so the offsets remain exact.
  if (metres(course[0], a) > .05) course.unshift(a)
  if (metres(course.at(-1), b) > .05) course.push(b)
  return { course, method }
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
  // Dynamic programme over the passes: the monotonic assignment with the
  // smallest total stop-to-trace distance, penalising a leg whose trace
  // length is implausible for ours (a pass skipped, a whole excursion
  // attributed to the wrong leg). The first stop takes its closest pass;
  // the others come from the loop ahead of it.
  const origin = nearest(ringXY, xy(coords[route.stopOffsets[0]]), 0, trace.length)
  const start = origin.index, stopCount = route.stopOffsets.length
  const candidates = route.stopOffsets.map((offset, k) => k === 0
    ? (origin.distance <= STOP_REACH_M ? [origin] : [])
    : passes(ringXY, xy(coords[offset]), start, Math.min(ringXY.length - 1, start + trace.length)))
  const cost = new Array(stopCount).fill(null).map(() => []), back = cost.map(() => [])
  const NONE = 1e6 // a stop the trace never comes near: no pass, no ordering constraint
  candidates[0].forEach((c, i) => { cost[0][i] = c.distance })
  if (!candidates[0].length) cost[0][0] = NONE
  for (let k = 1; k < stopCount; k++) {
    const ourLegM = length(coords.slice(route.stopOffsets[k - 1], route.stopOffsets[k] + 1))
    const options = candidates[k].length ? candidates[k] : [null]
    options.forEach((c, i) => {
      let best = Infinity, from = -1
      const previousOptions = candidates[k - 1].length ? candidates[k - 1] : [null]
      previousOptions.forEach((p, j) => {
        if (cost[k - 1][j] === undefined) return
        if (c && p && along(c) < along(p)) return
        let penalty = c ? c.distance : NONE
        if (c && p) penalty += Math.max(0, along(c) - along(p) - (ourLegM * 2.5 + 300)) / 10
        if (cost[k - 1][j] + penalty < best) { best = cost[k - 1][j] + penalty; from = j }
      })
      if (from >= 0) { cost[k][i] = best; back[k][i] = from }
    })
  }
  const projections = new Array(stopCount).fill(null)
  let pick = -1
  cost[stopCount - 1].forEach((value, i) => { if (value !== undefined && (pick < 0 || value < cost[stopCount - 1][pick])) pick = i })
  for (let k = stopCount - 1; k >= 0 && pick >= 0; k--) {
    projections[k] = candidates[k][pick] ?? null
    pick = k ? back[k][pick] ?? -1 : -1
  }
  // The first stop's pass is the loop's origin; a later pass that landed
  // before it (only possible without an ordering chain) is not usable.
  if (process.env.GUIDE_DEBUG) {
    console.log(route.id, 'passes', candidates.map((c, k) => k + ':' + c.map(p => Math.round(along(p)) + '@' + Math.round(p.distance)).join('|')).join(' '))
    console.log(route.id, 'picked', projections.map((p, k) => k + ':' + (p ? Math.round(along(p)) : '-')).join(' '))
  }
  const along0 = projections[0] ? along(projections[0]) : 0
  for (let k = 1; k < stopCount; k++) if (projections[k] && along(projections[k]) < along0) projections[k] = null
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
  const name = id => stops.get(id.split('/')[0])?.nameCn ?? id
  let legLabel = ''
  const note = why => { if (verbose) console.log(`${route.id} ${legLabel}: ${why}`) }
  for (let k = 0; k + 1 < route.stopsForward.length; k++) {
    const a = route.stopOffsets[k], b = route.stopOffsets[k + 1]
    const from = projections[k], to = projections[k + 1]
    legLabel = `leg ${k} ${name(route.stopsForward[k])} -> ${name(route.stopsForward[k + 1])}`
    if (!from || !to) { note(`unguided (${!from ? 'first' : 'second'} stop is more than ${STOP_REACH_M} m from the trace)`); continue }
    if (b - a < 2) continue
    // Two consecutive calls at the same platform are a layover loop the trace does not draw.
    if (route.stopsForward[k] === route.stopsForward[k + 1]) { note('same platform twice (layover loop kept)'); continue }
    if (route.stopsForward[k].startsWith('M172/') || route.stopsForward[k + 1].startsWith('M172/')) { note('Amaral terminal leg'); continue }
    if (to.index < from.index || (to.index === from.index && to.t < from.t)) { note('trace order reversed'); continue }
    const ourLeg = coords.slice(a, b + 1)
    const guide = traceSlice(from, to)
    if (guide.length < 2 || length(guide) < 10) continue
    const ours = offMetres(ourLeg, guide), theirs = offMetres(guide, ourLeg)
    const structural = (ours.off >= STRUCTURAL_M && ours.max >= STRUCTURAL_MAX_M) || (theirs.off >= STRUCTURAL_M && theirs.max >= STRUCTURAL_MAX_M)
    const weak = !structural && (ours.off >= WEAK_M || theirs.off >= WEAK_M)
    if (!structural && !weak) { if (ours.off || theirs.off) note(`kept (ours off ${ours.off} m / max ${ours.max} m, trace off ${theirs.off} m / max ${theirs.max} m)`); continue }
    if (crossesChannel(guide) && usesTaipaBridge(guide)) { changes.push({ leg: k, skipped: 'guide uses 嘉樂庇總督大橋 (bridge patch owns it)', ours, theirs }); continue }
    // Only a road-snapped course is trusted when the leg is not plainly on a
    // different street: a stop in a bay off the main road (the trace never
    // enters the forecourt), a long stretch within a street's width (the
    // trace may be on the other carriageway) or a bridge crossing.
    const osrmOnly = weak || crossesChannel(guide) || from.distance > STOP_TRUST_M || to.distance > STOP_TRUST_M
    const replacement = await courseFor(coords[a], coords[b], guide, osrmOnly)
    if (!replacement) { note(`skipped (OSRM found no course along the trace; ${weak ? 'weak' : 'bay/bridge'} leg)`); continue }
    output.push(...coords.slice(previous, a), ...replacement.course.slice(0, -1))
    const method = replacement.method
    const delta = replacement.course.length - (b - a + 1)
    shift += delta
    for (let i = k + 1; i < offsets.length; i++) offsets[i] = route.stopOffsets[i] + shift
    previous = b
    changes.push({ leg: k, from: name(route.stopsForward[k]), to: name(route.stopsForward[k + 1]), oursOffM: ours.off, theirsOffM: theirs.off, oldM: Math.round(length(ourLeg)), newM: Math.round(length(replacement.course)), method })
  }
  output.push(...coords.slice(previous))
  // The turnaround at the origin terminal: the trace's course from its pass
  // of the last stop round to its pass of the first. Our loops end at the
  // last stop (60 of them at the origin bay itself, the rest at a bay beside
  // it and handed over at the seam); driving the published loop back to the
  // origin closes every loop at its first vertex.
  const last = route.stopsForward.length - 1, first = projections[0], final = projections[last]
  legLabel = 'closing'
  if (first && final && !route.stopsForward[0].startsWith('M172/') && !route.stopsForward[last].startsWith('M172/') && !(route.id in NO_CLOSING)) {
    const to = along(first) <= along(final) ? { ...first, index: first.index + trace.length } : first
    const guide = to.index < ring.length - 1 ? traceSlice(final, to) : []
    const ours = [output.at(-1), coords[0]]
    const theirs = guide.length > 1 ? offMetres(guide, ours) : { off: 0, max: 0 }
    if (guide.length > 1 && length(guide) >= 100 && theirs.off >= 100 && theirs.max >= 60) {
      if (crossesChannel(guide) && usesTaipaBridge(guide)) changes.push({ leg: 'closing', skipped: 'closing loop uses 嘉樂庇總督大橋 (bridge patch owns it)' })
      else {
        const replacement = await courseFor(output.at(-1), coords[0], guide, crossesChannel(guide) || final.distance > STOP_TRUST_M || first.distance > STOP_TRUST_M)
        if (!replacement) note('closing loop skipped (OSRM found no course along the trace)')
        else {
          output.push(...replacement.course.slice(1))
          changes.push({ leg: 'closing', from: name(route.stopsForward[last]), to: name(route.stopsForward[0]), oursOffM: 0, theirsOffM: theirs.off, oldM: Math.round(metres(ours[0], ours[1])), newM: Math.round(length(replacement.course)), method: replacement.method })
        }
      }
    } else if (verbose && theirs.off) note(`closing loop kept (trace off ${theirs.off} m / max ${theirs.max} m over ${Math.round(length(guide))} m)`)
  }
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
  for (const c of changes) console.log(`${route.id} ${c.leg === 'closing' ? 'closing' : 'leg ' + c.leg}: ${c.skipped ? 'SKIP ' + c.skipped : `${c.from} -> ${c.to}: ${c.oldM} m -> ${c.newM} m (${c.method}; ours off ${c.oursOffM} m, trace off ${c.theirsOffM} m)`}`)
  if (changes.some(c => !c.skipped)) summary.push({ id: route.id, legs: changes.filter(c => !c.skipped).length, skipped: changes.filter(c => c.skipped).length })
}
if (!dryRun) writeFileSync('public/data/bus-routes.json', JSON.stringify(routes))
console.log(JSON.stringify({ routes: summary.length, legs: summary.reduce((a, s) => a + s.legs, 0), skipped: summary.reduce((a, s) => a + s.skipped, 0), written: !dryRun }))
console.log(dryRun ? 'Dry run: nothing written.' : 'Rebuild profiles: node scripts/build-bus-road-profile.mjs')
