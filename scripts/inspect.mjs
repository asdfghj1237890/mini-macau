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
// bucket = weekday | sat | sun (default weekday)

import { readFileSync } from 'node:fs'
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
  default:
    console.log('commands: routes | route <id> | in-service HH:MM [weekday|sat|sun] [--tail N] | coords | ferries | flights')
    if (cmd) process.exit(1)
}
