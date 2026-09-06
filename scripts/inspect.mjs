#!/usr/bin/env node
// Reusable inspector for the committed datasets in public/data/.
//
// Why this exists: the recurring "how many routes / which are in service at
// HH:MM / what's the schema of this JSON" questions used to be answered with
// throwaway `node -e "..."` blobs, each of which earned its own one-off entry
// in .claude/settings.local.json and was never reused. This collapses them
// into one named command (one stable allowlist pattern: `node scripts/inspect.mjs *`).
//
// Service-window semantics mirror getBusServiceWindow / the in-service check in
// src/engines/simulationEngine.ts: fractional hours (5.75 = 05:45), end<=start
// means the window crosses midnight (+1440 min), and sat/sun buckets override
// the weekday window when present (explicit null = bucket exists but no service).
//
// Usage:
//   node scripts/inspect.mjs routes                 # count, by routeType, ids
//   node scripts/inspect.mjs route <id>             # one route, all buckets
//   node scripts/inspect.mjs in-service HH:MM [bucket] [--tail N]
//   node scripts/inspect.mjs coords                 # bus-line coordinate totals
//   node scripts/inspect.mjs ferries                # ferry-schedules.json summary
//   node scripts/inspect.mjs flights                # flights.json summary
//   node scripts/inspect.mjs road-works [YYYY-MM-DD] # road-works.json summary + active/upcoming for a date (default: today, Macau)
//   node scripts/inspect.mjs schools                # schools.json summary (by level/system, buildings, unmatched/dropped)
//   node scripts/inspect.mjs water-facilities       # water-facilities.json summary (by type, exact vs approximate + anchors, footprints, schematic pipe network)
//   node scripts/inspect.mjs water-distribution     # water-distribution.json summary (Macau-only road network: by class, km, bbox, file size)
//   node scripts/inspect.mjs power-facilities       # power-facilities.json summary (by type/voltage, exact vs approximate + anchors, footprints, schematic grid)
//   node scripts/inspect.mjs power-distribution     # power-distribution.json summary (Macau-only road network: by class, km, bbox, file size)
//   node scripts/inspect.mjs toilets                # toilets.json summary (accessible/family/closed counts, closed list)
//   node scripts/inspect.mjs car-parks              # car-parks.json summary (by zone, height-limit histogram, no-limit ids)
//   node scripts/inspect.mjs waste                  # waste.json summary (by type, closed, per-source upstreamUpdatedAt, sites with empty en/pt, treatment facilities incl. wwtp buildings + statsKey, eco stations)
//   node scripts/inspect.mjs dspa-stats              # dspa-stats.json summary (DSPA monthly stats: incinerator/hazardous/landfill/4x wwtp series, latest values, incinerator facts)
//   node scripts/inspect.mjs grand-prix [--kinks]   # grand-prix.json summary (Guia Circuit: official vs measured length, corner table with rules, pit lane, sources); --kinks lists the stitched line's sideways jogs (seams between OSM ways)
// bucket = weekday | sat | sun (default weekday)

import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))
const busRoutes = () => load('public/data/bus-routes.json')

// Resolve the active service window for a route + bucket (null = no service).
function serviceWindow(route, bucket = 'weekday') {
  if (bucket === 'sat' && route.serviceHoursStartSat !== undefined && route.serviceHoursEndSat !== undefined) {
    if (route.serviceHoursStartSat === null || route.serviceHoursEndSat === null) return null
    return { start: route.serviceHoursStartSat, end: route.serviceHoursEndSat }
  }
  if (bucket === 'sun' && route.serviceHoursStartSun !== undefined && route.serviceHoursEndSun !== undefined) {
    if (route.serviceHoursStartSun === null || route.serviceHoursEndSun === null) return null
    return { start: route.serviceHoursStartSun, end: route.serviceHoursEndSun }
  }
  if (route.serviceHoursStart === null || route.serviceHoursEnd === null) return null
  return { start: route.serviceHoursStart, end: route.serviceHoursEnd }
}

function inService(route, minutes, bucket, tail = 0) {
  const w = serviceWindow(route, bucket)
  if (!w) return false
  const s = w.start * 60
  let e = w.end * 60 + tail
  if (e <= s) e += 1440
  return (minutes >= s && minutes < e) || (minutes + 1440 >= s && minutes + 1440 < e)
}

const fmtHrs = (h) => (h === null || h === undefined ? '—' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`)

function cmdRoutes() {
  const routes = busRoutes()
  const byType = {}
  for (const r of routes) byType[r.routeType] = (byType[r.routeType] || 0) + 1
  console.log(`total routes: ${routes.length}`)
  console.log('by routeType:', byType)
  console.log('ids:', routes.map((r) => r.id).join(', '))
}

function cmdRoute(id) {
  if (!id) return fail('route <id> requires an id, e.g. `route 1`')
  const r = busRoutes().find((x) => x.id === id)
  if (!r) return fail(`no route with id "${id}"`)
  console.log(`${r.id}  ${r.name} / ${r.nameCn}   [${r.routeType}]  freq ${r.frequency} min`)
  console.log(`  weekday : ${fmtHrs(r.serviceHoursStart)}–${fmtHrs(r.serviceHoursEnd)}`)
  console.log(`  sat     : ${r.serviceHoursStartSat === undefined ? '(falls back to weekday)' : `${fmtHrs(r.serviceHoursStartSat)}–${fmtHrs(r.serviceHoursEndSat)}`}`)
  console.log(`  sun     : ${r.serviceHoursStartSun === undefined ? '(falls back to weekday)' : `${fmtHrs(r.serviceHoursStartSun)}–${fmtHrs(r.serviceHoursEndSun)}`}`)
  console.log(`  stops   : ${r.stopsForward.length} fwd / ${r.stopsBackward.length} back   coords: ${r.geometry.geometry.coordinates.length}`)
}

function cmdInService(hhmm, bucket = 'weekday', tail = 0) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
  if (!m) return fail('in-service needs HH:MM, e.g. `in-service 21:32`')
  if (!['weekday', 'sat', 'sun'].includes(bucket)) return fail(`bucket must be weekday|sat|sun, got "${bucket}"`)
  const minutes = +m[1] * 60 + +m[2]
  const routes = busRoutes()
  const live = routes.filter((r) => inService(r, minutes, bucket, tail))
  const off = routes.filter((r) => !live.includes(r))
  console.log(`@ ${hhmm} (${bucket}${tail ? `, +${tail}min tail` : ''}) — in service: ${live.length}/${routes.length}, out: ${off.length}`)
  console.log('\nout of service:')
  for (const r of off) {
    const w = serviceWindow(r, bucket)
    console.log(`  ${r.id.padEnd(5)} ${(r.nameCn || r.name).slice(0, 24).padEnd(24)} ${w ? `${fmtHrs(w.start)}–${fmtHrs(w.end)}` : '(no service this bucket)'}`)
  }
}

function cmdCoords() {
  const routes = busRoutes()
  let total = 0
  let min = Infinity
  let max = 0
  for (const r of routes) {
    const n = r.geometry?.geometry?.coordinates?.length ?? 0
    total += n
    min = Math.min(min, n)
    max = Math.max(max, n)
  }
  console.log(`bus lines: ${routes.length}   total coords: ${total}   per-route min ${min} / max ${max} / avg ${Math.round(total / routes.length)}`)
}

function summarizeJson(rel) {
  const d = load(rel)
  if (Array.isArray(d)) {
    console.log(`${rel}: array, len ${d.length}`)
    if (d.length) console.log('  keys[0]:', Object.keys(d[0]).join(', '))
  } else {
    console.log(`${rel}: object, keys: ${Object.keys(d).join(', ')}`)
    for (const [k, v] of Object.entries(d)) {
      const desc = Array.isArray(v) ? `array(${v.length})` : v && typeof v === 'object' ? `object(${Object.keys(v).length} keys)` : JSON.stringify(v)
      console.log(`  ${k}: ${desc}`)
    }
  }
}

// Macau is UTC+8 with no DST, so "today in Macau" is just the wall-clock
// UTC date after shifting the clock forward 8h — no timezone DB needed.
function macauYmd(date = new Date()) {
  const macau = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return macau.toISOString().slice(0, 10)
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function cmdRoadWorks(dateArg) {
  if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    return fail(`road-works date must be YYYY-MM-DD, got "${dateArg}"`)
  }
  const ymd = dateArg || macauYmd()
  const { exportedAt, notices } = load('public/data/road-works.json')

  const byRestriction = {}
  for (const n of notices) byRestriction[n.restriction] = (byRestriction[n.restriction] || 0) + 1
  console.log(`total notices: ${notices.length}   exportedAt: ${exportedAt}`)
  console.log('by restriction:', byRestriction)

  // Mirrors the map overlay's own window: active = startDate..endDate spans
  // today; upcoming = starts within the next 7 days (see RoadWorkInfoPanel).
  const upcomingBy = addDaysYmd(ymd, 7)
  const active = notices
    .filter((n) => n.startDate <= ymd && ymd <= n.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  const upcoming = notices.filter((n) => ymd < n.startDate && n.startDate <= upcomingBy)
  console.log(`\n@ ${ymd} — active: ${active.length}   upcoming (next 7d): ${upcoming.length}`)
  console.log('\nactive:')
  for (const n of active) {
    console.log(`  ${n.id.padEnd(10)} ${n.startDate}→${n.endDate}  ${n.restriction.padEnd(10)} ${n.location.zh}`)
  }
}

function cmdSchools() {
  const { schools, unmatchedDsedj, droppedOsm } = load('public/data/schools.json')

  const byLevel = {}
  const bySystem = {}
  let totalBuildings = 0
  const noBuildings = []
  for (const s of schools) {
    byLevel[s.level] = (byLevel[s.level] || 0) + 1
    bySystem[s.system] = (bySystem[s.system] || 0) + 1
    totalBuildings += s.buildings.length
    if (s.buildings.length === 0) noBuildings.push(s.name.zh)
  }

  console.log(`total schools: ${schools.length}   total buildings: ${totalBuildings}`)
  console.log('by level:', byLevel)
  console.log('by system:', bySystem)

  console.log(`\nschools with 0 buildings: ${noBuildings.length}`)
  for (const name of noBuildings) console.log(`  ${name}`)

  console.log(`\nunmatchedDsedj: ${unmatchedDsedj.length}`)
  for (const u of unmatchedDsedj) console.log(`  [${u.code}] ${u.name} (${u.level})`)

  console.log(`\ndroppedOsm: ${droppedOsm.length}`)
}

function cmdWaterFacilities() {
  const { fetchedAtUtc, anchors = {}, facilities, network } = load('public/data/water-facilities.json')

  const byType = {}
  // macao_water = one of the 22 numbered facilities; dsama = a government
  // reservoir (黑沙水庫) that is on the map but not on Macao Water's list.
  const byOperator = {}
  let totalBuildings = 0
  let totalWater = 0
  const exact = []
  const approximate = []
  for (const f of facilities) {
    byType[f.type] = (byType[f.type] || 0) + 1
    byOperator[f.operator] = (byOperator[f.operator] || 0) + 1
    totalBuildings += f.buildings.length
    totalWater += f.water.length
    ;(f.approximate ? approximate : exact).push(f)
  }

  console.log(`total facilities: ${facilities.length}   fetchedAtUtc: ${fetchedAtUtc}`)
  console.log('by type:', byType)
  console.log('by operator:', byOperator)
  console.log(`exact: ${exact.length}   approximate: ${approximate.length}   buildings: ${totalBuildings}   water polygons: ${totalWater}`)

  // Resolve an anchor to something a human recognises: another facility's
  // Chinese name, or the OSM element a `district:` anchor landed on.
  const nameById = new Map(facilities.map((f) => [f.id, f.name.zh]))
  const anchorLabel = (a) =>
    a === null ? '—' : a.startsWith('district:') ? `${a} (${anchors[a]?.osmId ?? '?'} ${anchors[a]?.name ?? '?'})` : `${a} (${nameById.get(a) ?? '?'})`

  console.log(`\nexact (${exact.length}) — OSM footprints:`)
  for (const f of exact) {
    console.log(`  ${(f.no === null ? '--' : String(f.no)).padStart(2)} ${f.id.padEnd(20)} ${f.type.padEnd(12)} ${f.operator.padEnd(11)} buildings ${String(f.buildings.length).padStart(2)}  water ${f.water.length}  ${f.osm.join(',')}  ${f.name.zh}`)
  }

  console.log(`\napproximate (${approximate.length}) — marker only:`)
  for (const f of approximate) {
    console.log(`  ${(f.no === null ? '--' : String(f.no)).padStart(2)} ${f.id.padEnd(20)} ${f.type.padEnd(12)} ${f.operator.padEnd(11)} anchor ${anchorLabel(f.anchor)}  ${f.name.zh}`)
  }

  const kinds = {}
  for (const f of facilities) for (const b of f.buildings) kinds[b.kind] = (kinds[b.kind] || 0) + 1
  console.log('\nbuilding kinds:', kinds)

  // The pipe network is OUR schematic (an edge list hard-coded in
  // fetch_water_facilities.py, geometry from OSRM), not Macao Water's mains.
  const { nodes = [], pipes = [] } = network ?? {}
  // Straight-line distance between a pipe's two ends, so the ratio below says
  // how far out of its way the road route went. `direct` pipes are 1.00 by
  // construction — they ARE the straight line.
  const straightM = (p) => {
    const [a, b] = [p.coordinates[0], p.coordinates[p.coordinates.length - 1]]
    const x = (b[0] - a[0]) * 111320 * Math.cos((22.16 * Math.PI) / 180)
    const y = (b[1] - a[1]) * 110540
    return Math.hypot(x, y)
  }

  const byKind = {}
  let totalM = 0
  let points = 0
  const fallbacks = []
  const direct = []
  let longest = null
  let maxRatio = null
  for (const p of pipes) {
    byKind[p.kind] = (byKind[p.kind] || 0) + 1
    totalM += p.lengthM
    points += p.coordinates.length
    if (p.fallback) fallbacks.push(p.id)
    if (p.direct) direct.push(p.id)
    if (longest === null || p.lengthM > longest.lengthM) longest = p
    const r = p.lengthM / straightM(p)
    if (!p.direct && (maxRatio === null || r > maxRatio.r)) maxRatio = { r, id: p.id }
  }

  console.log(`\nnetwork: ${pipes.length} pipes   ${(totalM / 1000).toFixed(1)} km total   ${points} coordinate points`)
  console.log('by kind:', byKind)
  console.log(`direct connectors: ${direct.length}   routed: ${pipes.length - direct.length}`)
  console.log(`extra nodes: ${nodes.map((n) => `${n.id} (${n.kind}) ${n.name.zh}`).join(', ') || '—'}`)
  console.log(`straight-line fallbacks: ${fallbacks.length}${fallbacks.length ? ` — ${fallbacks.join(', ')}` : ''}`)
  if (longest) console.log(`longest: ${longest.id}  ${longest.lengthM} m  ${longest.coordinates.length} pts`)
  if (maxRatio) console.log(`max routed detour: ${maxRatio.id}  x${maxRatio.r.toFixed(2)}`)

  console.log('\npipes (= direct, ~ fallback):')
  for (const p of pipes) {
    const mark = p.fallback ? '~' : p.direct ? '=' : ' '
    const ratio = (p.lengthM / straightM(p)).toFixed(2)
    console.log(`  ${mark}${p.kind.padEnd(8)} ${p.from.padEnd(20)} -> ${p.to.padEnd(20)} ${String(p.lengthM).padStart(6)} m  ${String(p.coordinates.length).padStart(4)} pts  straight ${String(Math.round(straightM(p))).padStart(6)} m  x${ratio}`)
  }
}

// power-facilities.json: CEM's generation + HV transmission assets and OUR
// schematic 220/110/66 kV grid (edge list in fetch_power_facilities.py,
// geometry from OSRM). Macau's HV cable is underground and not in OSM, so the
// lines are a topology drawing, not CEM's routes.
function cmdPowerFacilities() {
  const { fetchedAtUtc, facts = {}, anchors = {}, facilities, network } = load('public/data/power-facilities.json')

  const byType = {}
  const byOperator = {}
  let totalBuildings = 0
  const exact = []
  const approximate = []
  for (const f of facilities) {
    byType[f.type] = (byType[f.type] || 0) + 1
    byOperator[f.operator] = (byOperator[f.operator] || 0) + 1
    totalBuildings += f.buildings.length
    ;(f.approximate ? approximate : exact).push(f)
  }

  console.log(`total facilities: ${facilities.length}   fetchedAtUtc: ${fetchedAtUtc}`)
  console.log('by type:', byType)
  console.log('by operator:', byOperator)
  console.log(`exact: ${exact.length}   approximate: ${approximate.length}   buildings: ${totalBuildings}`)
  console.log(`${facts.year} (CEM): ${facts.consumptionGwh} GWh consumed, ${facts.localSharePct}% local / ${facts.importedSharePct}% imported, ` +
    `${facts.cemHvSubstations} HV substations + ${facts.cemHvSwitchingStations} switching stations, ${facts.hvCableKm} km HV cable`)

  const anchorLabel = (a) => (a === null ? '—' : `${a} (${anchors[a]?.osmId ?? '?'} ${(anchors[a]?.name ?? '?').split(' ')[0]})`)

  console.log(`\nexact (${exact.length}) — OSM footprints:`)
  for (const f of exact) {
    console.log(`  ${f.id.padEnd(26)} ${f.type.padEnd(12)} ${(f.voltageKv ? `${f.voltageKv} kV` : '—').padStart(6)}  buildings ${String(f.buildings.length).padStart(2)}  ${f.osm.join(',').padEnd(12)} ${f.name.zh}`)
  }

  console.log(`\napproximate (${approximate.length}) — marker only:`)
  for (const f of approximate) {
    console.log(`  ${f.id.padEnd(26)} ${f.type.padEnd(12)} ${(f.voltageKv ? `${f.voltageKv} kV` : '—').padStart(6)}  anchor ${anchorLabel(f.anchor)}  ${f.name.zh}`)
  }

  const kinds = {}
  for (const f of facilities) for (const b of f.buildings) kinds[b.kind] = (kinds[b.kind] || 0) + 1
  console.log('\nbuilding kinds:', kinds)

  const { nodes = [], lines = [] } = network ?? {}
  const straightM = (p) => {
    const [a, b] = [p.coordinates[0], p.coordinates[p.coordinates.length - 1]]
    const x = (b[0] - a[0]) * 111320 * Math.cos((22.16 * Math.PI) / 180)
    const y = (b[1] - a[1]) * 110540
    return Math.hypot(x, y)
  }

  const byKv = {}
  const kmByKv = {}
  let totalM = 0
  let points = 0
  const fallbacks = []
  const direct = []
  let longest = null
  let maxRatio = null
  for (const ln of lines) {
    byKv[ln.voltageKv] = (byKv[ln.voltageKv] || 0) + 1
    kmByKv[ln.voltageKv] = (kmByKv[ln.voltageKv] || 0) + ln.lengthM / 1000
    totalM += ln.lengthM
    points += ln.coordinates.length
    if (ln.fallback) fallbacks.push(ln.id)
    if (ln.direct) direct.push(ln.id)
    if (longest === null || ln.lengthM > longest.lengthM) longest = ln
    const r = ln.lengthM / straightM(ln)
    if (!ln.direct && (maxRatio === null || r > maxRatio.r)) maxRatio = { r, id: ln.id }
  }

  console.log(`\nnetwork: ${lines.length} lines   ${(totalM / 1000).toFixed(1)} km total   ${points} coordinate points`)
  for (const kv of [220, 110, 66]) {
    if (byKv[kv]) console.log(`  ${String(kv).padStart(3)} kV  ${String(byKv[kv]).padStart(3)} lines  ${kmByKv[kv].toFixed(1).padStart(6)} km`)
  }
  console.log(`direct connectors: ${direct.length}   routed: ${lines.length - direct.length}`)
  console.log(`inlet nodes: ${nodes.map((n) => `${n.approximate ? '~' : ''}${n.id} (${n.kind}, ${n.since}) ${n.name.zh}`).join(', ') || '—'}`)
  console.log(`straight-line fallbacks: ${fallbacks.length}${fallbacks.length ? ` — ${fallbacks.join(', ')}` : ''}`)
  if (longest) console.log(`longest: ${longest.id}  ${longest.lengthM} m  ${longest.coordinates.length} pts`)
  if (maxRatio) console.log(`max routed detour: ${maxRatio.id}  x${maxRatio.r.toFixed(2)}`)

  // Every facility and inlet must be on at least one line, or the overlay
  // draws a lit marker wired to nothing.
  const connected = new Set(lines.flatMap((ln) => [ln.from, ln.to]))
  const orphans = [...facilities.map((f) => f.id), ...nodes.map((n) => n.id)].filter((id) => !connected.has(id))
  console.log(`facilities/nodes with no line: ${orphans.length}${orphans.length ? ` — ${orphans.join(', ')}` : ''}`)

  console.log('\nlines (= direct, ~ fallback):')
  for (const ln of lines) {
    const mark = ln.fallback ? '~' : ln.direct ? '=' : ' '
    const ratio = (ln.lengthM / straightM(ln)).toFixed(2)
    console.log(`  ${mark}${String(ln.voltageKv).padStart(3)} kV ${ln.from.padEnd(26)} -> ${ln.to.padEnd(26)} ${String(ln.lengthM).padStart(6)} m  ${String(ln.coordinates.length).padStart(4)} pts  straight ${String(Math.round(straightM(ln))).padStart(6)} m  x${ratio}`)
  }
}

// water-distribution.json and power-distribution.json are the same file shape
// out of the same pipeline module (data/scripts/road_network.py) — the Macau
// -only road canvas — and differ only in what seeded the flow field.
function cmdDistribution(rel) {
  const { fetchedAtUtc, sources, classes, flowSources = [], unreached = 0, splits = 0, roads } = load(rel)

  // Planar metres at Macau's latitude — the same approximation the pipeline
  // simplifies with, so the km here matches the km it printed.
  const LAT0 = 22.16
  const mx = (lng) => lng * 111320 * Math.cos((LAT0 * Math.PI) / 180)
  const my = (lat) => lat * 110540

  const byClass = {}
  const kmByClass = {}
  let points = 0
  let totalM = 0
  const bbox = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of roads) {
    byClass[r.class] = (byClass[r.class] || 0) + 1
    points += r.coordinates.length
    let m = 0
    for (let i = 1; i < r.coordinates.length; i++) {
      const [a, b] = [r.coordinates[i - 1], r.coordinates[i]]
      m += Math.hypot(mx(b[0]) - mx(a[0]), my(b[1]) - my(a[1]))
    }
    totalM += m
    kmByClass[r.class] = (kmByClass[r.class] || 0) + m / 1000
    for (const [lng, lat] of r.coordinates) {
      if (lng < bbox[0]) bbox[0] = lng
      if (lat < bbox[1]) bbox[1] = lat
      if (lng > bbox[2]) bbox[2] = lng
      if (lat > bbox[3]) bbox[3] = lat
    }
  }

  const bytes = statSync(join(ROOT, rel)).size
  console.log(`total roads: ${roads.length}   coordinate points: ${points}   fetchedAtUtc: ${fetchedAtUtc}`)
  console.log(`total length: ${(totalM / 1000).toFixed(1)} km   file size: ${(bytes / 1024).toFixed(1)} KiB`)
  console.log(`boundary: ${sources.boundary}`)
  console.log(`bbox: [${bbox.map((v) => v.toFixed(5)).join(', ')}]`)

  console.log('\nby class (declared order):')
  for (const c of classes) {
    if (!byClass[c]) continue
    console.log(`  ${c.padEnd(14)} ${String(byClass[c]).padStart(5)} roads  ${kmByClass[c].toFixed(1).padStart(7)} km`)
  }
  const unknown = Object.keys(byClass).filter((c) => !classes.includes(c))
  if (unknown.length) console.log(`classes not declared in \`classes\`: ${unknown.join(', ')}`)

  // Flow: each road's coordinates run from the end nearer a source to the end
  // further away, so the dash animation flows outward.
  // A road that came back with `dist === null` is in a component no source
  // reaches, and keeps whatever order OSM drew it in.
  const reached = roads.filter((r) => r.dist !== null)
  const nulls = roads.length - reached.length
  const maxDist = reached.length ? Math.max(...reached.map((r) => r.distEnd)) : 0
  const backwards = reached.filter((r) => r.distEnd < r.dist).length

  console.log(`\nflow: ${reached.length} roads oriented, ${nulls} unreached (header says ${unreached})`)
  console.log(`sources (${flowSources.length}): ${flowSources.join(', ')}`)
  console.log(`max dist from a source: ${maxDist} m   ways split at a local minimum: ${splits}`)
  console.log(`roads pointing the wrong way (distEnd < dist): ${backwards}`)

  const hist = {}
  for (const r of reached) hist[Math.floor(r.dist / 1000)] = (hist[Math.floor(r.dist / 1000)] || 0) + 1
  console.log('start-distance histogram (km buckets):', hist)
}

function cmdToilets() {
  const { updatedAt, toilets } = load('public/data/toilets.json')
  const accessible = toilets.filter((t) => t.accessible).length
  const family = toilets.filter((t) => t.family).length
  const closed = toilets.filter((t) => t.closed)

  console.log(`total toilets: ${toilets.length}   updatedAt: ${updatedAt}`)
  console.log(`accessible: ${accessible}   family: ${family}   closed: ${closed.length}`)

  console.log('\nclosed:')
  for (const t of closed) console.log(`  ${t.id.padEnd(10)} ${t.name.zh}`)
}

function cmdCarParks() {
  const { fetchedAtUtc, carParks } = load('public/data/car-parks.json')
  const byZone = {}
  const heightHist = {}
  const noLimit = []
  for (const c of carParks) {
    byZone[c.zone.zh] = (byZone[c.zone.zh] || 0) + 1
    if (c.heightLimitM === null || c.heightLimitM === undefined) {
      noLimit.push(c.id)
    } else {
      const key = c.heightLimitM.toFixed(2)
      heightHist[key] = (heightHist[key] || 0) + 1
    }
  }

  console.log(`total car parks: ${carParks.length}   fetchedAtUtc: ${fetchedAtUtc}`)
  console.log('by zone:', byZone)

  console.log('\nheight limit histogram (m):')
  for (const key of Object.keys(heightHist).sort((a, b) => Number(a) - Number(b))) {
    console.log(`  ${key.padStart(5)}  ${heightHist[key]}`)
  }

  console.log(`\nno height limit: ${noLimit.length}`)
  for (const id of noLimit) console.log(`  ${id}`)
}

function cmdWaste() {
  const { fetchedAtUtc, sources, counts, sites, facilities = [], ecoStations = [] } = load('public/data/waste.json')
  const bytes = statSync(join(ROOT, 'public/data/waste.json')).size

  console.log(`total sites: ${sites.length}   fetchedAtUtc: ${fetchedAtUtc}   file size: ${(bytes / 1024).toFixed(1)} KiB`)
  console.log('by type (counts):', counts)

  const byType = {}
  for (const s of sites) byType[s.type] = (byType[s.type] || 0) + 1
  const mismatched = Object.keys(counts).filter((t) => counts[t] !== (byType[t] || 0))
  if (mismatched.length) console.log(`  MISMATCH vs actual site tally: ${mismatched.map((t) => `${t} counts=${counts[t]} actual=${byType[t] || 0}`).join(', ')}`)

  const closed = sites.filter((s) => s.closed)
  console.log(`\nclosed: ${closed.length}`)
  for (const s of closed) console.log(`  ${s.id.padEnd(28)} ${s.name.zh}`)

  console.log(`\nsources (${sources.length}):`)
  for (const s of sources) {
    console.log(`  ${s.id.padEnd(20)} ${s.type.padEnd(14)} ${s.datasetId.slice(0, 8)}  count ${String(s.count).padStart(3)}  updated ${s.upstreamUpdatedAt ?? '(unknown)'}  ${s.name.zh}`)
  }

  const emptyEn = sites.filter((s) => !s.name.en)
  const emptyPt = sites.filter((s) => !s.name.pt)
  console.log(`\nsites with empty name.en: ${emptyEn.length}   empty name.pt: ${emptyPt.length}`)
  const byTypeEmptyEn = {}
  for (const s of emptyEn) byTypeEmptyEn[s.type] = (byTypeEmptyEn[s.type] || 0) + 1
  console.log('  empty name.en by type:', byTypeEmptyEn)

  const statusCounts = {}
  for (const s of sites) statusCounts[s.upstreamStatus] = (statusCounts[s.upstreamStatus] || 0) + 1
  console.log(`\nupstreamStatus tally:`, statusCounts)

  const noAddress = sites.filter((s) => s.address === null).length
  const noPhoto = sites.filter((s) => s.photo === null).length
  const noTel = sites.filter((s) => s.tel === null).length
  console.log(`\naddress null: ${noAddress}   photo null: ${noPhoto}   tel null: ${noTel}`)

  const totalFacBuildings = facilities.reduce((n, f) => n + (f.buildings ? f.buildings.length : 0), 0)
  console.log(`\nfacilities (${facilities.length}, ${totalFacBuildings} buildings total):`)
  for (const f of facilities) {
    const pts = f.polygon ? f.polygon.length : 0
    const buildings = f.buildings ? f.buildings.length : 0
    console.log(`  ${f.id.padEnd(22)} ${f.kind.padEnd(10)} approx=${String(f.approximate).padEnd(5)} polygon pts=${String(pts).padStart(3)}  buildings=${String(buildings).padStart(2)}  statsKey=${(f.statsKey ?? '—').padEnd(16)} osm=${(f.osm ?? []).join(',') || '—'}  ${f.name.zh}`)
  }

  console.log(`\necoStations (${ecoStations.length}):`)
  for (const e of ecoStations) {
    console.log(`  ${e.id.padEnd(20)} since=${e.since}  approx=${String(e.approximate).padEnd(5)} ${e.name.zh}  — ${e.address.zh}`)
  }
}

// dspa-stats.json: DSPA's monthly figures for the incinerator, the hazardous
// -waste station, the landfill and the four DSPA-published wastewater
// treatment plants (wwtp.mia has no open dataset and is always null) — see
// fetch_dspa_stats.py. Every series is best-effort (null on a failed fetch),
// unlike everything else in the pipeline.
function cmdDspaStats() {
  const data = load('public/data/dspa-stats.json')
  const bytes = statSync(join(ROOT, 'public/data/dspa-stats.json')).size
  console.log(`fetchedAtUtc: ${data.fetchedAtUtc}   file size: ${(bytes / 1024).toFixed(1)} KiB`)

  const printSeries = (label, s) => {
    if (!s) {
      console.log(`  ${label.padEnd(18)} null`)
      return
    }
    const vals = Object.entries(s.latest)
      .filter(([k]) => k !== 'period')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    console.log(`  ${label.padEnd(18)} latest ${s.latest.period}  ${vals}  (${s.months.length} months, unit ${s.unit}, dataset ${s.datasetId ?? '—'})`)
  }

  console.log('\nseries:')
  printSeries('incinerator', data.incinerator)
  if (data.incinerator) {
    const f = data.incinerator.facts
    console.log(`    facts: phases ${f.phases.join('/')}  lines ${f.lines}  capacity ${f.capacityTPerDay} t/day  generation ${f.generationMw} MW  area ${f.areaM2} m²`)
  }
  printSeries('hazardous', data.hazardous)
  printSeries('landfill', data.landfill)
  for (const key of ['macau', 'taipa', 'coloane', 'crossborder', 'mia']) {
    printSeries(`wwtp.${key}`, data.wwtp[key])
  }
}

// grand-prix.json: the Guia Circuit racing line stitched out of OSM relation
// 8877949, plus the pit lane and the nine officially named locations. The
// corner coordinates are ours (the organiser publishes none), so this prints
// the rule behind each one next to it — see fetch_grand_prix.py.
function cmdGrandPrix(kinks = false) {
  const data = load('public/data/grand-prix.json')
  const bytes = statSync(join(ROOT, 'public/data/grand-prix.json')).size
  const c = data.circuit
  const track = c.track.coordinates
  const pit = c.pitLane?.coordinates ?? null
  const off = ((c.measuredLengthKm - c.lengthKm) / c.lengthKm) * 100

  console.log(`${c.name.zh} / ${c.name.en} / ${c.name.pt}   [${c.id}]`)
  console.log(`fetchedAtUtc: ${data.fetchedAtUtc}   file size: ${(bytes / 1024).toFixed(1)} KiB`)
  console.log(`official ${c.lengthKm} km, min width ${c.minWidthM} m, ${c.direction}`)
  console.log(`measured ${c.measuredLengthKm} km from OSM (${off >= 0 ? '+' : ''}${off.toFixed(1)} % vs official)`)
  console.log(`track: ${track.length} points, ${track[0][0] === track[track.length - 1][0] && track[0][1] === track[track.length - 1][1] ? 'closed' : 'NOT CLOSED'}`)
  console.log(`pit lane: ${pit ? `${pit.length} points, entry ${pit[0].join(',')} -> exit ${pit[pit.length - 1].join(',')}` : 'null'}`)
  console.log(`OSM relation ${c.osm.relationId}: ${c.osm.mainWays} main ways + ${c.osm.pitLaneWays} pit-lane ways`)
  if (c.lapRecord) {
    const r = c.lapRecord
    console.log(`lap record: ${r.time} (${r.seconds}s) — ${r.driver}, ${r.car ?? '—'}, ${r.year} [${r.source}]`)
  }

  console.log(`\ncorners (${c.corners.length}, race order — every one approximate):`)
  for (const k of c.corners) {
    const span = k.spanKm ? `${k.spanKm[0].toFixed(3)}–${k.spanKm[1].toFixed(3)}` : '—'
    console.log(`${String(k.order).padStart(2)}  ${k.id.padEnd(18)} ${k.kind.padEnd(12)} ${k.distKm.toFixed(3).padStart(6)} km  span ${span.padStart(13)}  ${k.lng.toFixed(6)},${k.lat.toFixed(6)}`)
    console.log(`    ${k.name.zh} · ${k.name.pt} · ${k.name.en}`)
    console.log(`    rule: ${k.rule}`)
  }

  console.log(`\nsources (${data.sources.length}):`)
  for (const s of data.sources) {
    const stamp = s.upstreamUpdatedAt ? `  upstream ${s.upstreamUpdatedAt}` : ''
    console.log(`  ${s.role.padEnd(10)} ${s.secondary ? '(secondary)' : '           '} ${s.name}`)
    console.log(`             ${s.url}${stamp}`)
  }

  if (kinks) cmdGrandPrixKinks(track, c.corners)
}

// The stitched line's seams: places where two OSM ways met with a sideways
// offset, so the line jogs — a short segment (< maxSegM) between two sharp
// turns of opposite sign — and draws like a break at street zoom. Lists every
// such jog with its distance into the lap and the nearest corner.
function cmdGrandPrixKinks(track, corners, minTurnDeg = 35, maxSegM = 25) {
  const kLat = 111320
  const kLng = 111320 * Math.cos((22.2 * Math.PI) / 180)
  const seg = (a, b) => Math.hypot((b[0] - a[0]) * kLng, (b[1] - a[1]) * kLat)
  const heading = (a, b) => (Math.atan2((b[0] - a[0]) * kLng, (b[1] - a[1]) * kLat) * 180) / Math.PI
  const turnAt = i => {
    let t = heading(track[i], track[i + 1]) - heading(track[i - 1], track[i])
    while (t > 180) t -= 360
    while (t < -180) t += 360
    return t
  }
  const cum = [0]
  for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + seg(track[i - 1], track[i]))
  const jogs = []
  for (let i = 1; i < track.length - 2; i++) {
    const a = turnAt(i)
    const b = turnAt(i + 1)
    const len = seg(track[i], track[i + 1])
    if (Math.abs(a) >= minTurnDeg && Math.abs(b) >= minTurnDeg && Math.sign(a) !== Math.sign(b) && len <= maxSegM) {
      jogs.push({ i, len, a, b, km: cum[i] / 1000 })
    }
  }
  console.log(`\njogs (short segment ≤ ${maxSegM} m between opposite turns ≥ ${minTurnDeg}°): ${jogs.length}`)
  for (const j of jogs) {
    const near = corners
      .map(k => ({ k, d: Math.abs(k.distKm - j.km) }))
      .sort((x, y) => x.d - y.d)[0]
    const p = track[j.i]
    console.log(`  vertex ${String(j.i).padStart(3)}  ${j.km.toFixed(3)} km  jog ${j.len.toFixed(1).padStart(5)} m  turns ${j.a.toFixed(0).padStart(4)}° / ${j.b.toFixed(0).padStart(4)}°  at ${p[0].toFixed(6)},${p[1].toFixed(6)}  (${near.k.id} ${near.d >= 0 ? '' : ''}${(j.km - near.k.distKm) >= 0 ? '+' : ''}${(j.km - near.k.distKm).toFixed(3)} km)`)
  }
  // Every sharp turn, for context: the corners themselves are the big ones.
  const sharp = []
  for (let i = 1; i < track.length - 1; i++) {
    const t = turnAt(i)
    if (Math.abs(t) >= 60) sharp.push(`${i}@${(cum[i] / 1000).toFixed(3)}km ${t.toFixed(0)}°`)
  }
  console.log(`turns ≥ 60° (${sharp.length}): ${sharp.join('  ')}`)
}

function fail(msg) {
  console.error(`error: ${msg}`)
  process.exit(1)
}

const [cmd, ...rest] = process.argv.slice(2)
const tailFlag = rest.indexOf('--tail')
const tail = tailFlag >= 0 ? Number(rest[tailFlag + 1]) || 0 : 0
const pos = rest.filter((a, i) => a !== '--tail' && rest[i - 1] !== '--tail')

switch (cmd) {
  case 'routes': cmdRoutes(); break
  case 'route': cmdRoute(pos[0]); break
  case 'in-service': cmdInService(pos[0], pos[1], tail); break
  case 'coords': cmdCoords(); break
  case 'ferries': summarizeJson('public/data/ferry-schedules.json'); break
  case 'flights': summarizeJson('public/data/flights.json'); break
  case 'road-works': cmdRoadWorks(pos[0]); break
  case 'schools': cmdSchools(); break
  case 'water-facilities': cmdWaterFacilities(); break
  case 'water-distribution': cmdDistribution('public/data/water-distribution.json'); break
  case 'power-facilities': cmdPowerFacilities(); break
  case 'power-distribution': cmdDistribution('public/data/power-distribution.json'); break
  case 'toilets': cmdToilets(); break
  case 'car-parks': cmdCarParks(); break
  case 'waste': cmdWaste(); break
  case 'dspa-stats': cmdDspaStats(); break
  case 'grand-prix': cmdGrandPrix(pos.includes('--kinks')); break
  default:
    console.log('commands: routes | route <id> | in-service HH:MM [weekday|sat|sun] [--tail N] | coords | ferries | flights | road-works [YYYY-MM-DD] | schools | water-facilities | water-distribution | power-facilities | power-distribution | toilets | car-parks | waste | dspa-stats | grand-prix')
    if (cmd) process.exit(1)
}
