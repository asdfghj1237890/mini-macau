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
//   node scripts/inspect.mjs bus-traffic [HH:MM] [seconds] [step] # replay citywide bus following; timing, overlaps and queue checks (BUS_TRIP_MODEL=legacy for the fixed 30/60-minute cycle; BUS_TRACE_BOX=w,s,e,n [BUS_TRACE_EVERY=20] records every bus in the box: wait reason, passage held/wanted, owners; mode scope = the app's viewport model around BUS_VIEW=w,s,e,n, mode amaral = the same around the terminal)
//   node scripts/inspect.mjs bus-route-match [route-id…] [--threshold=30] # our drawn loops vs MO Transport's public GPX traces (data/bus_reference/route-paths.json from scripts/capture-route-paths.mjs): metres of our loop farther than the threshold from their trace, metres of their trace farther from ours, and each stretch with its nearest stop (Amaral terminal bays reported separately)
//   node scripts/inspect.mjs bus-roads [route-id] [lng,lat] # classification summary or geometry within 20 m
//   node scripts/inspect.mjs bus-station [base-id] # platform coordinates and route geometry at each stop
//   node scripts/inspect.mjs bus-cycles [route-id]  # generated service cycle per route: loop km, stops, minutes, fleet and average speed (road vs legacy model)
//   node scripts/inspect.mjs bus-continuity [HH:MM] [seconds] [step] [schedule|traffic|scope] # buses that vanish, jump or go NaN between ticks while their route is still in service (scope = the worker's viewport model, BUS_VIEW=w,s,e,n)
//   node scripts/inspect.mjs bus-playback [HH:MM] [realSeconds] [speed] [latencyMs] # the app's worker+playback pipeline in-process at 1–60x: presented buses that vanish mid-route, empty/pending frames, in-view queued counts per minute, playhead pace per frame (frozen/slow/nominal/fast/snap), lag, headroom and buffer target, worker compute per request (BUS_VIEW=w,s,e,n; BUS_FRAME_MS=33|100 renderer cadence; BUS_SWITCH_AT=<real ms> [BUS_SPEED_FROM=1] switches speed mid-run and reports the 3 s after it; BUS_PLAYHEAD_TRACE=1 prints per-frame rows around 5 s or the switch)
//   node scripts/inspect.mjs lrt-motion [--dwell 45] # aggregate motion feasibility; uses LRT_TRIPS_DIR or local dev inputs
//   node scripts/inspect.mjs city-loading          # city payload and generated count-catalog sizes
//   node scripts/inspect.mjs ferries                # ferry-schedules.json summary
//   node scripts/inspect.mjs flights                # flights.json summary
//   node scripts/inspect.mjs road-works [YYYY-MM-DD] # road-works.json summary + active/upcoming for a date (default: today, Macau)
//   node scripts/inspect.mjs schools                # schools.json summary (by level/system, buildings, unmatched/dropped)
//   node scripts/inspect.mjs public-housing         # public-housing.json summary (by type/category/district/decade, buildings, estates with 0 footprints, blocks with no building, unmatched)
//   node scripts/inspect.mjs water-facilities       # water-facilities.json summary (by type, exact vs approximate + anchors, footprints, schematic pipe network)
//   node scripts/inspect.mjs water-distribution     # water-distribution.json summary (Macau-only road network: by class, km, bbox, file size)
//   node scripts/inspect.mjs power-facilities       # power-facilities.json summary (by type/voltage, exact vs approximate + anchors, footprints, schematic grid)
//   node scripts/inspect.mjs power-distribution     # power-distribution.json summary (Macau-only road network: by class, km, bbox, file size)
//   node scripts/inspect.mjs parishes               # parishes.json summary (the 7 parishes + Cotai: names, island/kind, published land area vs drawn OSM area, population + density, polygon/ring/point counts, unsourced figures)
//   node scripts/inspect.mjs toilets                # toilets.json summary (accessible/family/closed counts, closed list)
//   node scripts/inspect.mjs car-parks              # car-parks.json summary (by zone, height-limit histogram, no-limit ids)
//   node scripts/inspect.mjs waste                  # waste.json summary (by type, closed, per-source upstreamUpdatedAt, sites with empty en/pt, treatment facilities incl. wwtp buildings + statsKey, eco stations)
//   node scripts/inspect.mjs dspa-stats              # dspa-stats.json summary (DSPA monthly stats: incinerator/hazardous/landfill/4x wwtp series, latest values, incinerator facts)
//   node scripts/inspect.mjs grand-prix [--kinks]   # grand-prix.json summary (Guia Circuit: official vs measured length, corner table with rules, pit lane, sources); --kinks lists the stitched line's sideways jogs (seams between OSM ways)
//   node scripts/inspect.mjs religion               # religion.json summary (by kind/source, approximate count, heritage sites, My Maps-only count, top 10 by macaumemory.names length)
//   node scripts/inspect.mjs old-maps               # old-maps.json summary (per map: title, years, raster size + bounds, georef method / control points / RMS, worst residuals, scan source)
// bucket = weekday | sat | sun (default weekday)

import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))
const busRoutes = () => load(process.env.BUS_TRAFFIC_ROUTES || 'public/data/bus-routes.json')

function cmdBusStation(base = 'M172') {
  const stops = load('public/data/bus-stops.json').filter(s => s.id.split('/')[0] === base)
  const routes = busRoutes(), mx = 111320 * Math.cos(22.19 * Math.PI / 180)
  for (const stop of stops.sort((a, b) => Number(a.id.split('/')[1]) - Number(b.id.split('/')[1]))) {
    const visits = []
    for (const route of routes) route.stopsForward.forEach((id, index) => {
      if (id !== stop.id) return
      const vertex = route.stopOffsets?.[index], coords = route.geometry.geometry.coordinates, point = coords[vertex]
      const road = route.roadProfile?.sections.find(s => vertex >= s.start && vertex < s.end)
      visits.push({ route: route.id, index, vertex, point, errorM: point ? Math.round(Math.hypot(
        (point[0] - stop.coordinates[0]) * mx, (point[1] - stop.coordinates[1]) * 111320)) : null,
        before: coords[vertex - 1], after: coords[vertex + 1], road })
    })
    console.log(JSON.stringify({ ...stop, visits }))
  }
}

function cmdBusTerminalCrossings() {
  for (const r of busRoutes()) {
    if (r.stopsForward.some(id => id.startsWith('M172/'))) continue
    const points = r.geometry.geometry.coordinates
    const hits = []
    for (let i = 1; i < points.length; i++) for (let j = 0; j <= 10; j++) {
      const p = points[i].map((v, a) => v + (points[i - 1][a] - v) * j / 10)
      if (p[0] > 113.54310 && p[0] < 113.54358 && p[1] > 22.18918 && p[1] < 22.18960) {
        hits.push({ vertex: i, p, road: r.roadProfile?.sections.find(s => i >= s.start && i < s.end) }); break
      }
    }
    if (hits.length) console.log(JSON.stringify({ route: r.id, hits }))
  }
}

function cmdBusReplayReport(path) {
  const report = load(path), ids = new Set(report.group ?? report.pair ?? [])
  if (report.trace?.length) {
    for (const frame of report.trace) console.log(JSON.stringify({ second: frame.second,
      states: frame.states.map(s => ({ id: s.id, distanceM: s.distanceM, playhead: s.playhead, speed: s.speed,
        stalledSec: s.stalledSec, offset: s.offset, leader: s.leader, waitingFor: s.waitingFor, yieldTo: s.yieldTo })),
    }))
    return
  }
  console.log(JSON.stringify({ clock: report.clock, second: report.second, group: [...ids],
    queues: report.queues?.filter(q => ids.has(q.id)).map(q => {
      const summary = { ...q }; delete summary.preview; delete summary.path; return summary
    }),
    states: report.checkpoint?.states.filter(([id]) => ids.has(id)).map(([id, s]) => ({ id,
      distanceM: s.pose.distanceM, coordinates: s.pose.vehicle.coordinates, bearing: s.pose.vehicle.bearing,
      offset: [s.offsetX, s.offsetY], playhead: s.playhead, nominal: s.nominal, clearance: s.clearance,
      recoveryYield: s.recoveryYield, yieldTo: s.yieldTo, passage: s.passage,
      laneAllowance: s.pose.laneAllowance, rejoinAfterM: s.rejoinAfterM, tightConvoyUntilM: s.tightConvoyUntilM,
    })),
  }, null, 2))
}

function cmdBusTerminalReference(routeId, path) {
  const route = busRoutes().find(r => r.id === routeId)
  if (!route) throw new Error('Expected route id')
  const xml = path ? readFileSync(path, 'utf8') : ''
  const reference = path
    ? [...xml.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g)].map(m => [Number(m[2]), Number(m[1])])
    : load('data/bus_reference/amaral-route-paths.json')[routeId]?.paths.flatMap(p => p.coordinates) ?? []
  if (!reference.length) throw new Error('No GPX track points')
  const inside = p => p[0] > 113.5424 && p[0] < 113.5443 && p[1] > 22.1876 && p[1] < 22.1902
  const windows = points => {
    const result = []
    for (let i = 0; i < points.length; i++) {
      if (!inside(points[i])) continue
      const start = Math.max(0, i - 1)
      while (i < points.length && inside(points[i])) i++
      result.push(points.slice(start, Math.min(points.length, i + 1)))
    }
    return result
  }
  const stops = new Map(load('public/data/bus-stops.json').map(s => [s.id, s]))
  const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(22.19 * Math.PI / 180), (a[1] - b[1]) * 111320)
  const nearest = point => Math.min(...reference.map(p => metres(point, p)))
  console.log(JSON.stringify({ route: routeId, stopOrder: route.stopsForward, local: windows(route.geometry.geometry.coordinates), reference: windows(reference),
    stops: route.stopsForward.map((id, i) => ({ id, name: stops.get(id)?.nameCn, coordinates: stops.get(id)?.coordinates,
      routePoint: route.geometry.geometry.coordinates[route.stopOffsets[i]], sourceDistance: nearest(stops.get(id).coordinates),
      routeSourceDistance: nearest(route.geometry.geometry.coordinates[route.stopOffsets[i]]) })),
    platforms: load('public/data/bus-stops.json').filter(s => s.id.startsWith('M172/')),
    lanes: load('src/data/bus-terminals.json').features.filter(f => f.properties.kind === 'lane') }))
}

async function cmdBusContinuity(clock = '22:30', duration = '3600', interval = '2', mode = 'schedule') {
  if (!/^\d{2}:\d{2}$/.test(clock)) throw new Error('Expected HH:MM')
  const seconds = Number(duration), step = Number(interval)
  if (!['schedule', 'traffic', 'scope'].includes(mode)) throw new Error('Mode must be schedule, traffic or scope')
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: false, root: ROOT, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'error' })
  try {
    const { computeBusOnly, getBusServiceWindow, getBusServiceBucket, getBusSchedule } = await server.ssrLoadModule('/src/engines/simulationEngine.ts')
    const { BusTrafficController } = await server.ssrLoadModule('/src/engines/busTraffic.ts')
    const { BusTrafficScope } = await server.ssrLoadModule('/src/engines/busTrafficScope.ts')
    const { BusTraceRecorder } = await server.ssrLoadModule('/src/engines/busMotionTrace.ts')
    const data = { busRoutes: busRoutes(), busStops: load('public/data/bus-stops.json') }
    const routes = new Map(data.busRoutes.map(r => [r.id, r])), stops = new Map(data.busStops.map(s => [s.id, s]))
    // scope: the worker's viewport model (BUS_VIEW=w,s,e,n; default: the Amaral demo view).
    const bounds = (process.env.BUS_VIEW || '113.5357,22.1834,113.5523,22.1942').split(',').map(Number)
    const view = { bounds }
    const controller = mode === 'schedule' ? undefined : new BusTrafficController()
    const scope = mode === 'scope' ? new BusTrafficScope(controller) : undefined
    const traffic = scope ? { sample: (plans, t) => scope.sample(plans, t, view, new BusTraceRecorder(view)), playheadOf: id => scope.playheadOf(id) } : controller
    const inView = v => v.coordinates[0] >= bounds[0] && v.coordinates[0] <= bounds[2] && v.coordinates[1] >= bounds[1] && v.coordinates[1] <= bounds[3]
    const start = new Date(`${process.env.BUS_TRAFFIC_DATE || '2026-09-11'}T${clock}:00+08:00`).getTime()
    const mx = 111320 * Math.cos(22.19 * Math.PI / 180)
    const metres = (a, b) => Math.hypot((a[0] - b[0]) * mx, (a[1] - b[1]) * 111320)
    const events = [], seen = new Map()
    let previous = new Map()
    for (let tick = 0; tick <= Math.round(seconds / step); tick++) {
      const at = new Date(start + tick * step * 1000)
      const vehicles = computeBusOnly(data, at, traffic)
      const current = new Map(vehicles.map(v => [v.id, v]))
      for (const v of vehicles) {
        if (!Number.isFinite(v.coordinates[0]) || !Number.isFinite(v.coordinates[1]) || !Number.isFinite(v.bearing)) events.push({ tick: tick * step, id: v.id, kind: 'nan', progress: v.progress })
        const was = previous.get(v.id)
        if (was && metres(was.coordinates, v.coordinates) > Math.max(150, step * 25) && Math.abs((v.progress ?? 0) - (was.progress ?? 0)) < .9) events.push({ tick: tick * step, id: v.id, kind: 'jump', metres: Math.round(metres(was.coordinates, v.coordinates)), inView: inView(was) || inView(v), progress: [+was.progress.toFixed(3), +v.progress.toFixed(3)] })
        seen.set(v.id, tick)
      }
      for (const [id, was] of previous) if (!current.has(id)) {
        const route = routes.get(was.lineId), bucket = getBusServiceBucket(at), window = route && getBusServiceWindow(route, bucket)
        const minutes = at.getUTCHours() * 60 + at.getUTCMinutes() + 480, endMin = window ? (window.end <= window.start ? window.end * 60 + 1440 : window.end * 60) : null
        const schedule = route && getBusSchedule(route, stops)
        events.push({ tick: tick * step, id, kind: 'vanish', progress: +was.progress.toFixed(3), phase: was.busMotion?.phase, inView: inView(was), delaySec: Math.round(was.busMotion?.delaySec ?? 0), serviceEndMin: endMin, nowMin: minutes % 1440, cycleMin: schedule ? +(schedule.cycleSec / 60).toFixed(1) : null })
      }
      previous = current
    }
    const byKind = {}
    for (const e of events) byKind[e.kind + (e.inView ? 'InView' : '')] = (byKind[e.kind + (e.inView ? 'InView' : '')] ?? 0) + 1
    console.log(JSON.stringify({ clock, seconds, step, mode, bounds: mode === 'scope' ? bounds : undefined, events: byKind, vehiclesSeen: seen.size }))
    // Vanishes before the terminus first (the ones a viewer would notice), then jumps.
    const rank = e => (e.kind === 'vanish' && e.progress < .99 ? 0 : e.kind === 'nan' ? 1 : e.kind === 'jump' ? 2 : 3) - (e.inView ? .5 : 0)
    for (const e of [...events].sort((a, b) => rank(a) - rank(b) || a.tick - b.tick).slice(0, 60)) console.log(JSON.stringify(e))
  } finally { await server.close() }
}

async function cmdBusPlayback(clock = '17:30', realSeconds = '30', speedArg = '60', latencyArg = '120') {
  if (!/^\d{2}:\d{2}$/.test(clock)) throw new Error('Expected HH:MM')
  const speed = Number(speedArg), realMs = Number(realSeconds) * 1000, latencyMs = Number(latencyArg)
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: false, root: ROOT, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'error' })
  try {
    const { AsyncBusFrame } = await server.ssrLoadModule('/src/engines/asyncBusFrame.ts')
    const { BusWorkerRuntime } = await server.ssrLoadModule('/src/engines/busWorkerRuntime.ts')
    const data = { busRoutes: busRoutes(), busStops: load('public/data/bus-stops.json') }
    const origins = new Map(data.busRoutes.map(r => [r.id, r.geometry.geometry.coordinates[0]]))
    const bounds = (process.env.BUS_VIEW || '113.5357,22.1834,113.5523,22.1942').split(',').map(Number)
    const view = { bounds }
    const mx = 111320 * Math.cos(22.19 * Math.PI / 180)
    const metres = (a, b) => Math.hypot((a[0] - b[0]) * mx, (a[1] - b[1]) * 111320)
    const inView = c => c[0] >= bounds[0] && c[0] <= bounds[2] && c[1] >= bounds[1] && c[1] <= bounds[3]
    // A fake worker port: the real runtime computes at once; the reply is
    // delivered after the configured latency, like a message round trip.
    const runtime = new BusWorkerRuntime()
    let port, now = 0
    const inbox = [], computes = []
    const factory = () => (port = { onmessage: null, onerror: null, onmessageerror: null, terminate() {},
      postMessage(request) { const t0 = performance.now(); const reply = runtime.sample(request); const took = performance.now() - t0; computes.push({ took, simMs: reply.simMs }); inbox.push({ at: now + latencyMs + took, reply }) } })
    const frame = new AsyncBusFrame(factory, s => events.push({ frame: frames.length, kind: 'overload', speed: s }))
    const start = new Date(`${process.env.BUS_TRAFFIC_DATE || '2026-09-11'}T${clock}:00+08:00`).getTime()
    const frames = [], events = []
    const last = new Map()
    let emptyFrames = 0, pendingFrames = 0
    // BUS_PAN=1 slides the view sideways every 3 s (a user panning at speed);
    // BUS_ZOOM_TOGGLE=1 alternates overview (no bounds) and detail every 5 s.
    const pan = process.env.BUS_PAN === '1', zoomToggle = process.env.BUS_ZOOM_TOGGLE === '1'
    const width = bounds[2] - bounds[0]
    // BUS_FRAME_MS mirrors the renderer's sampling cadence (33 ms desktop, 100 ms phones).
    const frameMs = Number(process.env.BUS_FRAME_MS || 33)
    let previousVehicles = null, frozenFrames = 0, freezeEpisodes = 0, freezeRunMs = 0, freezeMaxMs = 0, playedFrames = 0
    // White-box view of the presentation buffer (TypeScript-private, plain at runtime):
    // how far the playhead moved per frame relative to the clock, and its lag/headroom.
    const playhead = frame.playback
    const pace = { frozen: 0, slow: 0, nominal: 0, fast: 0, snap: 0 }
    const lags = [], heads = [], delays = [], rows = []
    let previousShownMs = NaN
    // BUS_SWITCH_AT=<real ms> runs at BUS_SPEED_FROM (default 1×) until then and
    // switches to the requested speed, the way a viewer speeds the clock up;
    // the 3 s after the switch are reported separately.
    const switchAt = Number(process.env.BUS_SWITCH_AT || NaN), speedFrom = Number(process.env.BUS_SPEED_FROM || 1)
    const switching = Number.isFinite(switchAt)
    const switchPace = { frozen: 0, slow: 0, nominal: 0, fast: 0, snap: 0 }
    let switchFrozenMs = 0, switchFreezeMaxMs = 0, switchRunMs = 0
    const traceFrom = switching ? switchAt - 200 : 5000, traceTo = traceFrom + 2200
    let simMs = start - frameMs * (switching && switchAt > 0 ? speedFrom : speed)
    for (now = 0; now <= realMs; now += frameMs) {
      while (inbox.length && inbox[0].at <= now) { const { reply } = inbox.shift(); port.onmessage?.({ data: reply }) }
      const currentSpeed = switching && now < switchAt ? speedFrom : speed
      simMs += frameMs * currentSpeed
      const frameIndex = frames.length
      const shift = pan ? ((Math.floor(frameIndex / 90) % 2) * 2 - 1) * width * .5 * (Math.floor(frameIndex / 90) > 0 ? 1 : 0) : 0
      const currentBounds = [bounds[0] + shift, bounds[1], bounds[2] + shift, bounds[3]]
      const currentView = zoomToggle && Math.floor(frameIndex / 150) % 2 === 1 ? { bounds: undefined } : { bounds: currentBounds }
      const inViewNow = c => currentView.bounds ? c[0] >= currentBounds[0] && c[0] <= currentBounds[2] && c[1] >= currentBounds[1] && c[1] <= currentBounds[3] : inView(c)
      const { vehicles, pending } = frame.sample(data, simMs, now, currentView, currentSpeed)
      if (pending) pendingFrames++
      // The playhead returns the identical array when it cannot advance: a
      // frozen frame while the clock moves is the stutter a viewer sees.
      const inSwitchWindow = switching && now >= switchAt && now < switchAt + 3000
      if (!pending && vehicles.length && currentSpeed > 0) {
        playedFrames++
        if (vehicles === previousVehicles) { frozenFrames++; if (!freezeRunMs) freezeEpisodes++; freezeRunMs += frameMs; freezeMaxMs = Math.max(freezeMaxMs, freezeRunMs) }
        else freezeRunMs = 0
        if (inSwitchWindow) {
          if (vehicles === previousVehicles) { switchFrozenMs += frameMs; switchRunMs += frameMs; switchFreezeMaxMs = Math.max(switchFreezeMaxMs, switchRunMs) }
          else switchRunMs = 0
        }
      }
      previousVehicles = vehicles
      const shownMs = playhead.displayMs
      if (!pending && vehicles.length && currentSpeed > 0 && Number.isFinite(shownMs) && Number.isFinite(previousShownMs)) {
        const ratio = (shownMs - previousShownMs) / (frameMs * currentSpeed)
        const bucket = ratio === 0 ? 'frozen' : ratio < .9 ? 'slow' : ratio <= 1.1 ? 'nominal' : ratio <= 1.3 ? 'fast' : 'snap'
        pace[bucket]++
        if (inSwitchWindow) switchPace[bucket]++
        lags.push((simMs - shownMs) / currentSpeed); heads.push((playhead.endMs - shownMs) / currentSpeed); delays.push(playhead.delayMs)
        if (process.env.BUS_PLAYHEAD_TRACE && now >= traceFrom && now < traceTo) rows.push({ now, speed: currentSpeed, ratio: +ratio.toFixed(2), lagMs: Math.round((simMs - shownMs) / currentSpeed), headMs: Math.round((playhead.endMs - shownMs) / currentSpeed), delayMs: Math.round(playhead.delayMs), chunks: playhead.chunks.length })
      }
      previousShownMs = shownMs
      if (!vehicles.length) emptyFrames++
      const ids = new Map(vehicles.map(v => [v.id, v]))
      const index = frames.length
      for (const [id, v] of ids) {
        const l = last.get(id)
        if (l && index - l.frame >= 3) events.push({ frame: index, kind: 'gap', id, gapMs: now - l.now, simAt: new Date(l.sim).toISOString().slice(11, 19), inView: l.inView, phase: l.v.busMotion?.phase, delaySec: Math.round(l.v.busMotion?.delaySec ?? 0), toOriginM: Math.round(metres(l.v.coordinates, origins.get(l.v.lineId))), progress: +l.v.progress.toFixed(3), jumpM: Math.round(metres(l.v.coordinates, v.coordinates)) })
        last.set(id, { frame: index, now, sim: simMs, v, inView: inViewNow(v.coordinates) })
      }
      const shown = vehicles.filter(v => inView(v.coordinates))
      frames.push({ now, simMs, count: vehicles.length, inView: shown.length, queued: shown.filter(v => v.busMotion?.phase === 'queued').length })
    }
    const endFrame = frames.length - 1
    const gone = [...last].filter(([, l]) => endFrame - l.frame >= 3).map(([id, l]) => ({ kind: 'gone', id, sinceMs: now - frameMs - l.now, simAt: new Date(l.sim).toISOString().slice(11, 19), inView: l.inView, phase: l.v.busMotion?.phase, delaySec: Math.round(l.v.busMotion?.delaySec ?? 0), toOriginM: Math.round(metres(l.v.coordinates, origins.get(l.v.lineId))), progress: +l.v.progress.toFixed(3) }))
    const midRoute = e => e.toOriginM > 60 && e.progress > .02 && e.progress < .98
    const sorted = computes.map(c => c.took).sort((a, b) => a - b)
    const chunkMs = computes.slice(1).map((c, i) => c.simMs - computes[i].simMs).filter(d => d > 0)
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
    const summary = { clock, speed, realSeconds: Number(realSeconds), latencyMs, frameMs, pan, zoomToggle, frames: frames.length, emptyFrames, pendingFrames,
      switch: switching ? { at: switchAt, from: speedFrom, pace: switchPace, frozenMs: switchFrozenMs, freezeMaxMs: switchFreezeMaxMs } : undefined,
      pace, lagMs: { mean: Math.round(mean(lags)), max: Math.round(Math.max(0, ...lags)) }, headroomMs: { mean: Math.round(mean(heads)), min: Math.round(Math.min(Infinity, ...heads)) }, delayMs: { mean: Math.round(mean(delays)), max: Math.round(Math.max(0, ...delays)) },
      playhead: { playedFrames, frozenFrames, frozenPct: playedFrames ? +(frozenFrames / playedFrames * 100).toFixed(1) : 0, freezeEpisodes, freezeMaxMs, freezeMeanMs: freezeEpisodes ? Math.round(frozenFrames * frameMs / freezeEpisodes) : 0 },
      worker: { requests: computes.length, computeMeanMs: +mean(sorted).toFixed(1), computeP95Ms: sorted.length ? +sorted[Math.floor(sorted.length * .95)].toFixed(1) : 0, computeMaxMs: sorted.length ? +sorted.at(-1).toFixed(1) : 0,
        chunkSimMs: Math.round(mean(chunkMs)), periodMs: Math.round(mean(chunkMs) / speed) },
      fleet: { first: frames[0].count, last: frames.at(-1).count, min: Math.min(...frames.map(f => f.count)), max: Math.max(...frames.map(f => f.count)) },
      inView: { mean: +(frames.reduce((a, f) => a + f.inView, 0) / frames.length).toFixed(1), max: Math.max(...frames.map(f => f.inView)),
        queuedMean: +(frames.reduce((a, f) => a + f.queued, 0) / frames.length).toFixed(1), queuedMax: Math.max(...frames.map(f => f.queued)),
        queuedByMinute: frames.filter((_, i) => i % Math.max(1, Math.round(60000 / frameMs / speed)) === 0).map(f => f.queued) },
      gaps: events.filter(e => e.kind === 'gap').length, gapsInViewMidRoute: events.filter(e => e.kind === 'gap' && e.inView && midRoute(e)).length,
      gone: gone.length, goneInViewMidRoute: gone.filter(e => e.inView && midRoute(e)).length, overloads: events.filter(e => e.kind === 'overload').map(e => e.speed) }
    console.log(JSON.stringify(summary))
    for (const row of rows) console.log(JSON.stringify(row))
    const rank = e => (e.inView ? 0 : 1) + (midRoute(e) ? 0 : 2)
    for (const e of [...events.filter(e => e.kind === 'gap'), ...gone].sort((a, b) => rank(a) - rank(b) || (a.frame ?? 0) - (b.frame ?? 0)).slice(0, 40)) console.log(JSON.stringify(e))
  } finally { await server.close() }
}

async function cmdBusCycles(routeId) {
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: false, root: ROOT, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'error' })
  try {
    const { getBusSchedule } = await server.ssrLoadModule('/src/engines/simulationEngine.ts')
    const stops = new Map(load('public/data/bus-stops.json').map(s => [s.id, s]))
    const rows = []
    for (const route of busRoutes().filter(r => !routeId || r.id === routeId)) {
      const road = getBusSchedule(route, stops, 'road'), legacy = getBusSchedule(route, stops, 'legacy')
      if (!road || !legacy) continue
      const fleet = s => Math.max(1, Math.floor(s.tripDurationSec / 60 / route.frequency))
      rows.push({ id: route.id, km: +road.totalLenKm.toFixed(1), stops: route.stopsForward.length, freq: route.frequency,
        roadMin: +(road.tripDurationSec / 60).toFixed(1), legacyMin: legacy.tripDurationSec / 60,
        roadKmh: +(road.totalLenKm / (road.tripDurationSec / 3600)).toFixed(1), legacyKmh: +(legacy.totalLenKm / (legacy.tripDurationSec / 3600)).toFixed(1),
        fleetRoad: fleet(road), fleetLegacy: fleet(legacy) })
    }
    for (const r of rows) console.log(JSON.stringify(r))
    const sum = key => rows.reduce((a, r) => a + r[key], 0)
    const sorted = key => rows.map(r => r[key]).sort((a, b) => a - b)
    const pick = a => ({ min: a[0], median: a[Math.floor(a.length / 2)], max: a[a.length - 1] })
    console.log(JSON.stringify({ routes: rows.length, fleetRoad: sum('fleetRoad'), fleetLegacy: sum('fleetLegacy'),
      roadMin: pick(sorted('roadMin')), roadKmh: pick(sorted('roadKmh')), legacyKmh: pick(sorted('legacyKmh')) }))
  } finally { await server.close() }
}

function cmdBusRoads(routeId, location) {
  const routes = busRoutes().filter(r => !routeId || r.id === routeId)
  if (location) {
    const [lng, lat] = location.split(',').map(Number), mx = 111320 * Math.cos(lat * Math.PI / 180)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('Expected longitude,latitude')
    const found = []
    for (const route of routes) {
      const coords = route.geometry.geometry.coordinates
      for (let i = 0; i < coords.length - 1; i++) {
        const a = [(coords[i][0] - lng) * mx, (coords[i][1] - lat) * 111320]
        const b = [(coords[i + 1][0] - lng) * mx, (coords[i + 1][1] - lat) * 111320]
        const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
        if (length < .05) continue
        const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length ** 2))
        const distance = Math.hypot(a[0] + t * dx, a[1] + t * dy)
        if (distance <= 20) found.push({ route: route.id, segment: i, distance, a, b,
          road: route.roadProfile?.sections.find(s => i >= s.start && i < s.end) })
      }
    }
    console.log(JSON.stringify(found, null, 2)); return
  }
  const totals = {}, reasons = {}, laneTags = {}, wayIds = new Set(), examples = {}, dates = new Set()
  let junctionSpans = 0
  const junctionIds = new Set()
  const mx = 111320 * Math.cos(22.19 * Math.PI / 180)
  for (const route of routes) {
    const coords = route.geometry.geometry.coordinates, profile = route.roadProfile
    if (!profile) continue
    dates.add(profile.fetchedAtUtc)
    for (const j of profile.junctions ?? []) { junctionSpans++; junctionIds.add(j.id) }
    for (const section of profile.sections) {
      let metres = 0
      for (let i = section.start; i < section.end; i++) metres += Math.hypot((coords[i + 1][0] - coords[i][0]) * mx, (coords[i + 1][1] - coords[i][1]) * 111320)
      const group = totals[section.kind] ??= { sections: 0, routeKm: 0 }
      group.sections++; group.routeKm += metres / 1000
      const laneKey = `${section.kind}: total=${section.lanes ?? '?'} direction=${section.directionalLanes ?? '?'} width=${section.widthM ?? '?'} opposed=${!!section.opposingRouteGeometry}`
      laneTags[laneKey] = (laneTags[laneKey] ?? 0) + metres / 1000
      reasons[section.evidence] = (reasons[section.evidence] ?? 0) + metres / 1000
      if (section.wayId) wayIds.add(section.wayId)
      const list = examples[section.kind] ??= []
      if (list.length < 5 && metres > 30) list.push({ route: route.id, ...section, coordinates: coords[section.start] })
    }
  }
  const km = Object.values(totals).reduce((sum, v) => sum + v.routeKm, 0)
  console.log(JSON.stringify({ routes: routes.length, source: 'OpenStreetMap contributors', sourceUrl: 'https://www.openstreetmap.org/copyright',
    fetchedAtUtc: [...dates], uniqueMatchedWays: wayIds.size, junctionSpans, junctions: junctionIds.size, totals, evidenceRouteKm: reasons,
    classifiedPercent: km ? (km - (totals.unknown?.routeKm ?? 0)) / km * 100 : 0, laneTagRouteKm: laneTags,
    note: 'Route kilometres count shared roads once per route. Paired geometry and untagged widths are estimates, not surveyed lanes.', examples,
  }, null, 2))
}

async function cmdBusTraffic(clock = '08:00', duration = '60', interval = '.2', mode = 'current', focus = '') {
  if (!['current', 'baseline', 'amaral', 'scope'].includes(mode)) throw new Error('Mode must be current, baseline, amaral or scope')
  if (!/^\d{2}:\d{2}$/.test(clock)) throw new Error('Expected HH:MM')
  const seconds = Number(duration)
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) throw new Error('Duration must be 0–3600 seconds')
  const step = Number(interval)
  if (!Number.isFinite(step) || step < .03 || step > 8) throw new Error('Sample step must be .03–8 simulated seconds')
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: false, root: ROOT, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'error' })
  try {
    const { computeVehiclePositions, sampleBusPose } = await server.ssrLoadModule('/src/engines/simulationEngine.ts')
    const { BusTrafficController, busesConflict } = await server.ssrLoadModule('/src/engines/busTraffic.ts')
    const data = { busRoutes: busRoutes(), busStops: load('public/data/bus-stops.json'), lrtLines: [], stations: [], trips: [], flights: [], ferries: [] }
    if (mode === 'baseline') for (const route of data.busRoutes) delete route.roadProfile
    const checkpoint = process.env.BUS_TRAFFIC_RESUME ? load(process.env.BUS_TRAFFIC_RESUME).checkpoint : undefined
    const start = checkpoint?.lastMs ?? new Date(`${process.env.BUS_TRAFFIC_DATE || '2026-09-11'}T${clock}:00+08:00`).getTime()
    if (!Number.isFinite(start)) throw new Error('Invalid time')
    // scope = the worker's viewport model around BUS_VIEW=w,s,e,n (default: the Amaral view)
    const viewBounds = mode === 'scope' && process.env.BUS_VIEW ? process.env.BUS_VIEW.split(',').map(Number) : [113.5418, 22.187, 113.5453, 22.1915]
    const centre = [(viewBounds[0] + viewBounds[2]) / 2, (viewBounds[1] + viewBounds[3]) / 2]
    const nearby = buses => buses.filter(v => Math.abs(v.coordinates[0] - centre[0]) < .003 && Math.abs(v.coordinates[1] - centre[1]) < .003)
    const conflicts = buses => {
      const hits = []
      for (let i = 0; i < buses.length; i++) for (let j = i + 1; j < buses.length; j++)
        if (Math.abs(buses[i].coordinates[0] - buses[j].coordinates[0]) <= .001 &&
            Math.abs(buses[i].coordinates[1] - buses[j].coordinates[1]) <= .001 &&
            busesConflict(buses[i], buses[j], 0)) hits.push([buses[i].id, buses[j].id])
      return hits
    }
    const busTraffic = new BusTrafficController(), timings = []
    // BUS_TRIP_MODEL=legacy replays the fixed 30/60-minute service cycle.
    const tripModel = process.env.BUS_TRIP_MODEL === 'legacy' ? 'legacy' : 'road'
    const { BusTrafficScope } = await server.ssrLoadModule('/src/engines/busTrafficScope.ts')
    const { BusTraceRecorder } = await server.ssrLoadModule('/src/engines/busMotionTrace.ts')
    const scope = new BusTrafficScope(busTraffic)
    const view = { bounds: viewBounds }
    const driver = mode === 'amaral' || mode === 'scope' ? { sample: (plans, time) => scope.sample(plans, time, view, new BusTraceRecorder(view)), playheadOf: id => scope.playheadOf(id) } : busTraffic
    let final = [], collisions = 0, worst = [], queuedPeak = 0, initialMs = 0
    const holds = new Map()
    const events = new Map(), trace = [], focusIds = new Set(focus.split(',').filter(Boolean))
    // BUS_TRACE_BOX=w,s,e,n (+ BUS_TRACE_EVERY seconds, default 20) records every
    // bus inside the box at that cadence: what it waits for, which passage it
    // holds or wants, and the owners of that passage.
    const traceBox = process.env.BUS_TRACE_BOX ? process.env.BUS_TRACE_BOX.split(',').map(Number) : undefined
    const traceEvery = Number(process.env.BUS_TRACE_EVERY || 20), areaTrace = []
    const inTraceBox = c => !!traceBox && c[0] >= traceBox[0] && c[0] <= traceBox[2] && c[1] >= traceBox[1] && c[1] <= traceBox[3]
    if (checkpoint) {
      computeVehiclePositions(data, new Date(start), { busTraffic, busTripModel: tripModel })
      const savedIds = new Set(checkpoint.states.map(([id]) => id))
      for (const id of busTraffic.states.keys()) if (!savedIds.has(id)) busTraffic.states.delete(id)
      for (const [id, saved] of checkpoint.states) {
        const state = busTraffic.states.get(id)
        if (!state) throw new Error(`Checkpoint bus ${id} is absent from this service window`)
        Object.assign(state, saved)
        state.passageShapes = undefined
      }
      // Creation order breaks ties inside a traffic step. Preserve it too;
      // reseeding the same states in route order changes the reproduced scene.
      busTraffic.states = new Map(checkpoint.states.map(([id]) => [id, busTraffic.states.get(id)]))
      busTraffic.lastMs = start; busTraffic.nextRequest = checkpoint.nextRequest
      busTraffic.recoverySequence = checkpoint.recoverySequence ?? 0
      busTraffic.junctionOwners = new Map(checkpoint.junctionOwners.map(([key, owners]) => [key, new Map(owners)]))
      busTraffic.junctionWaiters.clear()
    }
    for (let tick = checkpoint ? 1 : 0; tick <= Math.round(seconds / step); tick++) {
      const begin = performance.now()
      final = computeVehiclePositions(data, new Date(start + tick * step * 1000), { busTraffic: driver, busTripModel: tripModel })
      const took = performance.now() - begin
      if (tick === 0) initialMs = took
      else timings.push(took)
      const hits = conflicts(mode === 'amaral' || mode === 'scope' ? busTraffic.currentVehicles() : final)
      for (const pair of hits) if (!events.has(pair.join('/'))) events.set(pair.join('/'), { at: tick * step, buses: pair.map(id => { const v = final.find(v => v.id === id); return {id, coordinates:v.coordinates, bearing:v.bearing, motion:v.busMotion} }) })
      collisions += hits.length
      if (hits.length > worst.length) worst = hits
      queuedPeak = Math.max(queuedPeak, final.filter(v => v.busMotion?.phase === 'queued').length)
      if (focusIds.size) trace.push({ second: tick * step, states: busTraffic.inspectQueues({ includeMoving: true }).filter(s => focusIds.has(s.id)) })
      if (traceBox && Math.abs(tick * step / traceEvery - Math.round(tick * step / traceEvery)) < 1e-6) {
        areaTrace.push({ second: tick * step, states: busTraffic.inspectQueues({ includeMoving: true }).filter(s => inTraceBox(s.coordinates)).map(s => ({
          id: s.id, phase: s.phase, blocked: s.blocked, speed: +s.speed.toFixed(2), stalledSec: +s.stalledSec.toFixed(1), distanceM: +s.distanceM.toFixed(1),
          leader: s.leader, waitingFor: s.waitingFor, waitReason: s.waitReason, blockerIds: s.blockerIds, yieldTo: s.yieldTo, recoveryYield: s.recoveryYield?.id,
          cautiousUntilM: s.cautiousUntilM === undefined ? undefined : +s.cautiousUntilM.toFixed(1), claimedThroughM: s.claimedThroughM === undefined ? undefined : +s.claimedThroughM.toFixed(1),
          coordinates: s.coordinates, bearing: Math.round(s.bearing), offset: s.offset.map(n => +n.toFixed(2)),
          held: s.held && { keys: s.held.keys, approaches: s.held.approaches, entryM: +s.held.entryM.toFixed(1), exitM: +s.held.exitM.toFixed(1) },
          next: s.next && { keys: s.next.keys, approaches: s.next.approaches, entryM: +s.next.entryM.toFixed(1), exitM: +s.next.exitM.toFixed(1) },
          owners: s.owners })) })
      }
      for (const v of final) {
        const held = v.busMotion?.phase === 'queued' && v.busMotion.speedKmh < .2
        const record = holds.get(v.id) ?? { current: 0, longest: 0 }
        record.current = held ? record.current + (tick ? step : 0) : 0
        record.longest = Math.max(record.longest, record.current)
        holds.set(v.id, record)
      }
    }
    // Measure cold route/body caches during the first traffic frame; computing
    // the unimpeded comparison earlier would silently warm those caches.
    const nominal = computeVehiclePositions(data, new Date(start), { busTripModel: tripModel })
    timings.sort((a, b) => a - b)
    console.log(JSON.stringify({ clock, seconds, step, mode, nominalBuses: nominal.length, visibleBuses: final.length,
      nominalAmaralOverlaps: conflicts(nearby(nominal)), replayOverlapObservations: collisions, worstPairs: worst.slice(0, 8),
      queuedPeak, initialMs, sampleP95Ms: timings[Math.floor(timings.length * .95)] ?? 0,
      sampleMeanMs: timings.reduce((sum, ms) => sum + ms, 0) / Math.max(1, timings.length),
      timingScope: 'CPU vehicle calculation only, excluding rendering; initialMs includes cold geometry caches.',
      longestHolds: [...holds].sort((a, b) => b[1].longest - a[1].longest).slice(0, 10).map(([id, times]) => {
        const v = final.find(v => v.id === id), route = data.busRoutes.find(r => r.id === v?.lineId)
        return { id, ...times, coordinates: v?.coordinates, bearing: v?.bearing, leader: v?.busMotion?.leaderId,
          road: route && sampleBusPose(route.geometry, v.progress, v.busMotion.returning, route.roadProfile).road }
      }),
      firstOverlapEvents: [...events.values()].slice(0, 20),
      trace: focusIds.size ? trace : undefined,
      focusGeometry: [...focusIds].flatMap(id => {
        const state = busTraffic.states.get(id)
        const route = data.busRoutes.find(r => r.id === state?.pose.vehicle.lineId)
        if (!state || !route) return []
        const v = state.pose.vehicle
        return [{ id, pose: sampleBusPose(route.geometry, v.progress, v.busMotion.returning, route.roadProfile),
          coordinates: route.geometry.geometry.coordinates.filter(p => Math.abs(p[0] - v.coordinates[0]) < .002 && Math.abs(p[1] - v.coordinates[1]) < .002) }]
      }),
      queues: busTraffic.inspectQueues({ includeFuture: true }),
      areaTrace: traceBox ? areaTrace : undefined,
      checkpoint: process.env.BUS_TRAFFIC_CHECKPOINT === '1' ? {
        lastMs: busTraffic.lastMs, nextRequest: busTraffic.nextRequest, recoverySequence: busTraffic.recoverySequence,
        junctionOwners: [...busTraffic.junctionOwners].map(([key, owners]) => [key, [...owners]]),
        states: [...busTraffic.states].map(([id, state]) => [id, { ...state, plan: undefined, passageShapes: undefined }]),
      } : undefined,
      finalNearby: nearby(final).map(v => ({ id: v.id, coordinates: v.coordinates, bearing: v.bearing, speed: Math.round(v.busMotion.speedKmh), delay: Math.round(v.busMotion.delaySec), phase: v.busMotion.phase, leader: v.busMotion.leaderId })),
    }, null, 2))
  } finally { await server.close() }
}

async function cmdCityLoading() {
  const { buildCityCatalog } = await import('../plugins/city-catalog.ts')
  const files = ['road-works', 'schools', 'public-housing', 'parishes', 'toilets',
    'car-parks', 'waste', 'dspa-stats', 'water-facilities', 'power-facilities', 'grand-prix']
  const sizes = files.map(name => {
    const bytes = readFileSync(join(ROOT, 'public/data', `${name}.json`))
    return { name, decoded: bytes.length, gzip: gzipSync(bytes).length }
  })
  const total = list => list.reduce((sum, file) => ({ decoded: sum.decoded + file.decoded, gzip: sum.gzip + file.gzip }), { decoded: 0, gzip: 0 })
  const catalog = Buffer.from(JSON.stringify(await buildCityCatalog(join(ROOT, 'public/data'))))
  console.log(JSON.stringify({
    cityFiles: sizes.length,
    allCityDataBytes: total(sizes),
    defaultCityFiles: ['road-works'],
    deferredByDefaultBytes: total(sizes.filter(file => file.name !== 'road-works')),
    catalogBytes: { decoded: catalog.length, gzip: gzipSync(catalog).length },
    note: 'Uncompressed/gzip payload sizes; HTTP compression and transfer overhead depend on the server.',
  }, null, 2))
}

async function cmdLrtMotion(defaultDwellSec) {
  const { getLrtDepartureMinutes, LRT_DEFAULT_DWELL_SEC } = await import('../src/engines/lrtTimetable.ts')
  defaultDwellSec ??= LRT_DEFAULT_DWELL_SEC
  if (!Number.isFinite(defaultDwellSec) || defaultDwellSec < 0) throw new Error('Invalid default dwell seconds')
  const { default: nearestPointOnLine } = await import('@turf/nearest-point-on-line')
  const { createLrtMotionProfile, sampleLrtMotion } = await import('../src/engines/lrtMotion.ts')
  const { getLrtTrack, LRT_DIRECTIONS } = await import('../src/lrtTracks.ts')
  const stations = new Map(load('public/data/stations.json').map(s => [s.id, s.coordinates]))
  const routes = new Map(load('public/data/lrt-lines.json').map(route => [route.id, route]))
  const positions = new Map()
  for (const route of routes.values()) for (const direction of LRT_DIRECTIONS) for (const sid of route.stations) {
    const point = nearestPointOnLine(getLrtTrack(route.geometry, direction), stations.get(sid), { units: 'kilometers' })
    positions.set(`${route.id}:${direction}:${sid}`, (point.properties.location ?? 0) * 1000)
  }
  const dir = process.env.LRT_TRIPS_DIR || join(ROOT, 'src/data')
  const summary = {}
  for (const schedule of ['mon_thu', 'friday', 'sat_sun']) {
    const trips = JSON.parse(readFileSync(join(dir, `trips-${schedule}.json`), 'utf8'))
    for (const trip of trips) {
      const row = summary[trip.lineId] ??= { legs: 0, maxAverageKmh: 0, maxPeakKmh: 0, over80: 0, infeasible: 0, positiveDwell: 0, zeroDwell: 0, minRunSec: Infinity, maxRunSec: 0, overnightTrips: 0, minDwellCeilingSec: Infinity }
      if (trip.entries.at(-1).arrivalMinutes >= 1440) row.overnightTrips++
      for (let i = 0; i < trip.entries.length; i++) {
        const e = trip.entries[i], next = trip.entries[i + 1]
        const dwell = (e.departureMinutes ?? e.arrivalMinutes) - e.arrivalMinutes
        if (dwell > 0) row.positiveDwell++; else row.zeroDwell++
        if (!next) continue
        const intervalSec = (next.arrivalMinutes - e.arrivalMinutes) * 60
        const seconds = (next.arrivalMinutes - getLrtDepartureMinutes(e, defaultDwellSec)) * 60
        const distance = Math.abs(positions.get(`${trip.lineId}:${trip.direction}:${next.stationId}`) - positions.get(`${trip.lineId}:${trip.direction}:${e.stationId}`))
        if (!Number.isFinite(distance) || seconds <= 0) throw new Error('Invalid LRT segment inputs')
        const average = distance / seconds * 3.6
        row.minDwellCeilingSec = Math.min(row.minDwellCeilingSec, intervalSec - distance / (80 / 3.6))
        row.legs++; row.maxAverageKmh = Math.max(row.maxAverageKmh, average)
        if (average > 80) row.over80++
        row.minRunSec = Math.min(row.minRunSec, seconds)
        row.maxRunSec = Math.max(row.maxRunSec, seconds)
        const profile = createLrtMotionProfile(distance, seconds)
        if (!profile) { row.infeasible++; continue }
        row.maxPeakKmh = Math.max(row.maxPeakKmh, profile.cruiseMps * 3.6)
        let previous = 0
        for (let step = 0; step <= 100; step++) {
          const state = sampleLrtMotion(profile, seconds * step / 100)
          if (state.progress < previous || state.speedKmh > 80 || !Number.isFinite(state.progress)) throw new Error('Invalid LRT motion sample')
          previous = state.progress
        }
        const start = sampleLrtMotion(profile, 0), end = sampleLrtMotion(profile, seconds)
        if (start.progress !== 0 || end.progress !== 1 || start.speedKmh !== 0 || end.speedKmh !== 0) throw new Error('LRT endpoint mismatch')
      }
    }
  }
  // Aggregate diagnostics only: no individual trips or timetable rows.
  for (const row of Object.values(summary)) {
    row.maxAverageKmh = +row.maxAverageKmh.toFixed(3)
    row.maxPeakKmh = +row.maxPeakKmh.toFixed(3)
    row.minRunSec = +row.minRunSec.toFixed(3)
    row.maxRunSec = +row.maxRunSec.toFixed(3)
    row.minDwellCeilingSec = +row.minDwellCeilingSec.toFixed(3)
  }
  console.log(JSON.stringify(summary, null, 2))
  if (Object.values(summary).some(row => row.infeasible > 0)) process.exitCode = 1
}

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
  // The era buckets the 3D overlay shades a school by. `founded` is null when
  // no source gives the school a year (see FOUNDED in fetch_schools.py).
  const byEra = { '<1900': 0, '1900-49': 0, '1950-79': 0, '1980-99': 0, '2000+': 0 }
  const noFounded = []
  for (const s of schools) {
    byLevel[s.level] = (byLevel[s.level] || 0) + 1
    bySystem[s.system] = (bySystem[s.system] || 0) + 1
    totalBuildings += s.buildings.length
    if (s.buildings.length === 0) noBuildings.push(s.name.zh)
    if (s.founded == null) noFounded.push(s.name.zh)
    else if (s.founded < 1900) byEra['<1900']++
    else if (s.founded < 1950) byEra['1900-49']++
    else if (s.founded < 1980) byEra['1950-79']++
    else if (s.founded < 2000) byEra['1980-99']++
    else byEra['2000+']++
  }

  console.log(`total schools: ${schools.length}   total buildings: ${totalBuildings}`)
  console.log('by level:', byLevel)
  console.log('by system:', bySystem)
  console.log(`founded: ${schools.length - noFounded.length}/${schools.length}`, byEra, ...(noFounded.length ? [`| no year: ${noFounded.join(', ')}`] : []))

  console.log(`\nschools with 0 buildings: ${noBuildings.length}`)
  for (const name of noBuildings) console.log(`  ${name}`)

  console.log(`\nunmatchedDsedj: ${unmatchedDsedj.length}`)
  for (const u of unmatchedDsedj) console.log(`  [${u.code}] ${u.name} (${u.level})`)

  console.log(`\ndroppedOsm: ${droppedOsm.length}`)
}

function cmdPublicHousing() {
  const { fetchedAtUtc, estates, unmatched = [] } = load('public/data/public-housing.json')

  const byType = {}
  // Only `other` estates carry a category (the programme they belong to);
  // social and economic ones are null, which `type` already says.
  const byCategory = {}
  const others = []
  const byDistrict = {}
  const byDecade = {}
  let totalBuildings = 0
  let approximate = 0
  let partial = 0
  // OpenMapTiles' height for a building nothing publishes one for. A footprint
  // still sitting on it is one neither OSM nor the basemap nor the storey
  // fallback in fetch_public_housing.py could give a real height.
  let defaultHeight = 0
  const noBuildings = []
  const blocksWithout = []
  for (const e of estates) {
    byType[e.type] = (byType[e.type] || 0) + 1
    if (e.category !== null && e.category !== undefined) {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1
    }
    if (e.type === 'other') others.push(e)
    byDistrict[e.district] = (byDistrict[e.district] || 0) + 1
    const decade = e.year === null ? 'unknown' : `${Math.floor(e.year / 10) * 10}s`
    byDecade[decade] = (byDecade[decade] || 0) + 1
    totalBuildings += e.buildings.length
    defaultHeight += e.buildings.filter((b) => b.height === 5).length
    if (e.approximate) approximate++
    if (e.partial) partial++
    if (e.buildings.length === 0) noBuildings.push(`${e.name.zh} (${e.id})`)
    const matched = new Set(e.buildings.map((b) => b.block).filter(Boolean))
    for (const b of e.blocks) {
      if (!matched.has(b.name.zh)) blocksWithout.push(`${e.name.zh} · ${b.name.zh}`)
    }
  }

  console.log(`fetchedAtUtc: ${fetchedAtUtc}`)
  console.log(`estates: ${estates.length}   buildings: ${totalBuildings}   approximate points: ${approximate}   partial (IH asterisk): ${partial}`)
  console.log('by type:', byType)
  console.log(`by category (type "other" only): ${JSON.stringify(byCategory)}`)
  for (const e of others) {
    const yr = e.year === null ? '—' : `${e.year} ${e.yearKind}`
    console.log(
      `  ${e.category.padEnd(11)} ${e.name.zh}  (${e.id})  ${yr} · ${e.status}` +
        ` · ${e.storeys === null ? 'no storeys' : `${e.storeys} storeys`}` +
        ` · ${e.units === null ? 'no units' : `${e.units} units`}` +
        ` · ${e.buildings.length} footprints`,
    )
  }
  console.log('by district:', byDistrict)
  console.log('by decade (estate year):', Object.fromEntries(Object.entries(byDecade).sort(([a], [b]) => a.localeCompare(b))))
  console.log(`footprints at the 5 m default height (no height source): ${defaultHeight} of ${totalBuildings}`)

  console.log(`\nestates with 0 buildings: ${noBuildings.length}`)
  for (const name of noBuildings) console.log(`  ${name}`)

  console.log(`\nblocks with no matched building: ${blocksWithout.length} of ${estates.reduce((n, e) => n + e.blocks.length, 0)}`)
  for (const b of blocksWithout) console.log(`  ${b}`)

  console.log(`\nunmatched: ${unmatched.length}`)
  for (const u of unmatched) console.log(`  ${u.name} (${u.id}) — ${u.reason}`)
}

function cmdWaterFacilities() {
  const { fetchedAtUtc, facts = {}, anchors = {}, facilities, network } = load('public/data/water-facilities.json')

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
  // Macao Water's own figures (統計數據 latest year + 供澳原水), read by macao_water.py.
  const s = facts.statistics
  const r = facts.rawWater
  if (s && r) {
    console.log(`${s.year} (Macao Water): design capacity ${s.designCapacityM3PerDay.toLocaleString('en')} m³/day, ` +
      `${(s.rawWaterImportedM3 / 1e6).toFixed(1)} M m³ raw water imported, ${(s.annualSupplyM3 / 1e6).toFixed(1)} M m³ supplied, ` +
      `${s.mainsKm} km mains; counts plants ${s.plants} / reservoirs ${s.reservoirs} / tanks ${s.tanks} / ` +
      `raw pumping ${s.rawWaterPumpingStations} / treated pumping ${s.treatedWaterPumpingStations}; ` +
      `over ${r.xijiangShareMinPct}% of raw water from the Xijiang`)
  }

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

// Shoelace area of one MultiPolygon, in km2. The rings are lng/lat degrees, so
// each is projected equirectangularly about its own mean latitude first — over
// an area a few km across that is well under the rounding in the figures we
// print it next to. rings[0] is the outer ring, the rest are holes.
function multiPolygonKm2(geometry) {
  let km2 = 0
  for (const polygon of geometry) {
    for (let r = 0; r < polygon.length; r++) {
      const ring = polygon[r]
      const lat0 = ring.reduce((s, [, lat]) => s + lat, 0) / ring.length
      const mx = 111.32 * Math.cos((lat0 * Math.PI) / 180)
      let shoelace = 0
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = ring[i]
        const [bx, by] = ring[i + 1]
        shoelace += ax * mx * (by * 110.54) - bx * mx * (ay * 110.54)
      }
      km2 += (r === 0 ? 1 : -1) * Math.abs(shoelace / 2)
    }
  }
  return km2
}

function cmdParishes() {
  const { fetchedAtUtc, sources, parishes } = load('public/data/parishes.json')

  console.log(`fetchedAtUtc: ${fetchedAtUtc}`)
  console.log('sources:', sources)
  const kinds = {}
  for (const p of parishes) kinds[p.kind] = (kinds[p.kind] || 0) + 1
  console.log(`areas: ${parishes.length}  ${JSON.stringify(kinds)}`)

  // Two areas per row are worth comparing: `areaKm2` is the government's
  // published *land* area, `osm km2` is the polygon we actually draw. The OSM
  // administrative boundary reaches into water and reclamation, so it is the
  // larger of the two — a difference here is expected, not a defect.
  console.log(
    `\n${'slug'.padEnd(14)} ${'zh'.padEnd(7)} ${'pt'.padEnd(24)} ${'en'.padEnd(32)} ` +
      `${'island'.padEnd(8)} ${'kind'.padEnd(11)} ${'km2'.padStart(7)} ${'osm km2'.padStart(8)} ` +
      `${'population'.padStart(11)} ${'dens/km2'.padStart(9)} ${'poly'.padStart(4)} ${'ring'.padStart(4)} ${'pts'.padStart(5)}`,
  )
  let totalPop = 0
  let totalArea = 0
  let totalOsm = 0
  let totalPts = 0
  const missing = []
  for (const p of parishes) {
    const polys = p.geometry.length
    const rings = p.geometry.reduce((n, poly) => n + poly.length, 0)
    const pts = p.geometry.reduce((n, poly) => n + poly.reduce((m, ring) => m + ring.length, 0), 0)
    const osmKm2 = multiPolygonKm2(p.geometry)
    const dens = p.densityPerKm2 != null ? Math.round(p.densityPerKm2) : (p.population !== null && p.areaKm2 !== null ? Math.round(p.population / p.areaKm2) : null)
    if (p.population === null) missing.push(`${p.slug}: population`)
    if (p.areaKm2 === null) missing.push(`${p.slug}: areaKm2`)
    totalPop += p.population ?? 0
    totalArea += p.areaKm2 ?? 0
    totalOsm += osmKm2
    totalPts += pts
    console.log(
      `${p.slug.padEnd(14)} ${p.name.zh.padEnd(7)} ${p.name.pt.padEnd(24)} ${p.name.en.padEnd(32)} ` +
        `${p.island.padEnd(8)} ${p.kind.padEnd(11)} ${(p.areaKm2 === null ? '—' : p.areaKm2.toFixed(2)).padStart(7)} ` +
        `${osmKm2.toFixed(2).padStart(8)} ` +
        `${(p.population === null ? '—' : `${p.population} (${p.populationYear})`).padStart(11)} ` +
        `${(dens === null ? '—' : String(dens)).padStart(9)} ` +
        `${String(polys).padStart(4)} ${String(rings).padStart(4)} ${String(pts).padStart(5)}`,
    )
  }
  console.log(
    `${'TOTAL'.padEnd(14)} ${''.padEnd(7)} ${''.padEnd(24)} ${''.padEnd(32)} ${''.padEnd(8)} ${''.padEnd(11)} ` +
      `${totalArea.toFixed(2).padStart(7)} ${totalOsm.toFixed(2).padStart(8)} ${String(totalPop).padStart(11)} ` +
      `${(totalArea > 0 ? String(Math.round(totalPop / totalArea)) : '—').padStart(9)} ` +
      `${''.padStart(4)} ${''.padStart(4)} ${String(totalPts).padStart(5)}`,
  )

  console.log(`\nlabel anchors (must be inside the area) and osm refs:`)
  for (const p of parishes) {
    console.log(`  ${p.slug.padEnd(14)} ${p.coordinates.map((n) => n.toFixed(6)).join(', ')}   ${p.osm.join(' ')}`)
  }

  console.log(`\nfigures not published / not sourced: ${missing.length}`)
  for (const m of missing) console.log(`  ${m}`)
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

// old-maps.json: HISTORICAL MAPS overlay — georeferenced scans built by
// scripts/build-old-maps.mjs (Node + sharp, not the Python pipeline). Per
// map: title, years, raster size and bounds, how it was georeferenced
// (method, control points, RMS), the worst residuals and the scan source.
function cmdOldMaps() {
  const { generatedAt, maps } = load('public/data/old-maps.json')
  console.log(`old-maps.json: ${maps.length} map(s), generated ${generatedAt}`)
  for (const m of maps) {
    const file = join(ROOT, 'public', m.image.replace(/^\//, ''))
    const kb = existsSync(file) ? `${(statSync(file).size / 1024).toFixed(0)} KB` : 'MISSING'
    console.log(`\n${m.id}: ${m.title.zh}`)
    console.log(`  ${m.title.en}`)
    console.log(`  drawn ${m.year}${m.published ? `, published ${m.published}` : ''} — ${m.author}`)
    console.log(`  raster ${m.width}x${m.height} px @ ${m.georef.metresPerPixel} m/px, ${kb}; bounds W ${m.bounds.west} E ${m.bounds.east} N ${m.bounds.north} S ${m.bounds.south}`)
    console.log(`  georef: ${m.georef.method}${m.georef.lambda != null ? ` (λ ${m.georef.lambda})` : ''}, ${m.georef.controlPoints} control points, RMS ${m.georef.rmsM} m`)
    const snap = m.georef.coastSnap
    if (snap) console.log(`  coast snap: ${snap.pairs} dense pairs onto the reference shoreline in ${snap.steps} steps (radius ${snap.radiusM} m, largest step gradient ${snap.maxStepGradient}); spline alone median ${snap.splineMedianM} m / p90 ${snap.splineP90M} m / max ${snap.splineMaxM} m off, after the snap median ${snap.leftMedianM} m / max ${snap.leftMaxM} m`)
    const worst = [...m.georef.gcps].sort((a, b) => b.residualM - a.residualM).slice(0, 5)
    for (const p of worst) console.log(`    ${String(p.residualM).padStart(6)} m  ${p.name}`)
    console.log(`  scan: ${m.scan.holder} via ${m.scan.via} (${m.scan.identifier}, leaves ${m.scan.leaves.join('+')}) — ${m.scan.license}`)
    for (const r of m.references) console.log(`  ref: ${r.name} — ${r.url}`)
  }
}
// religion.json: RELIGION overlay — five categories (tudigong 土地公, temple
// 廟宇, church 教堂, mosque 清真寺, other 其他信仰). tudigong is OSM worship/社壇
// candidates plus 澳門記憶 / Google My Maps 澳門的土地信仰 sites (attached onto an
// existing site, accumulating into macaumemory.names/records/entries, or
// added as new approximate street-level sites); the other four categories
// are a separate OSM classification pass. 文化局 heritage rows are attached
// to the nearest same-category site for both (not kept as separate points)
// or, unmatched, become their own standalone `ic-<code>` site — see
// fetch_religion.py.
function cmdReligion() {
  const { fetchedAtUtc, categories, sites, stats } = load('public/data/religion.json')
  const bytes = statSync(join(ROOT, 'public/data/religion.json')).size

  console.log(`total sites: ${sites.length}   fetchedAtUtc: ${fetchedAtUtc}   file size: ${(bytes / 1024).toFixed(1)} KiB`)
  console.log('stats:', stats)

  const byKind = {}
  for (const s of sites) byKind[s.kind] = (byKind[s.kind] || 0) + 1
  console.log('\nby kind:', byKind)

  const bySource = {}
  for (const s of sites) for (const src of s.sources) bySource[src] = (bySource[src] || 0) + 1
  console.log('by source:', bySource)

  console.log('\nby category:')
  for (const c of categories) {
    const n = sites.filter((s) => s.category === c.id).length
    console.log(`  ${c.id.padEnd(10)} ${String(n).padStart(3)}  ${c.name.zh} / ${c.name.en} / ${c.name.pt}`)
  }

  console.log('\nby category x kind:')
  for (const c of categories) {
    const inCat = sites.filter((s) => s.category === c.id)
    const kinds = {}
    for (const s of inCat) kinds[s.kind] = (kinds[s.kind] || 0) + 1
    console.log(`  ${c.id.padEnd(10)} ${JSON.stringify(kinds)}`)
  }

  const byReligion = {}
  for (const s of sites) byReligion[s.religion] = (byReligion[s.religion] || 0) + 1
  console.log('\nby religion:', byReligion)

  console.log('\nby category x religion:')
  for (const c of categories) {
    const inCat = sites.filter((s) => s.category === c.id)
    const rel = {}
    for (const s of inCat) rel[s.religion] = (rel[s.religion] || 0) + 1
    console.log(`  ${c.id.padEnd(10)} ${JSON.stringify(rel)}`)
  }

  const withDenom = sites.filter((s) => s.denomination).sort((a, b) => a.denomination.localeCompare(b.denomination, 'zh'))
  const denomCounts = {}
  for (const s of withDenom) denomCounts[s.denomination] = (denomCounts[s.denomination] || 0) + 1
  console.log(`\ndenominations found (${Object.keys(denomCounts).length}, ${withDenom.length} sites):`, denomCounts)
  for (const s of withDenom) console.log(`  ${s.denomination.padEnd(8)} ${s.id.padEnd(22)} ${s.name.zh}`)

  const approx = sites.filter((s) => s.approximate)
  console.log(`\napproximate: ${approx.length}`)

  const heritage = sites.filter((s) => s.heritage)
  console.log(`\nheritage sites (${heritage.length}):`)
  for (const s of heritage) console.log(`  ${s.heritage.code.padEnd(6)} ${s.id.padEnd(16)} ${s.category.padEnd(9)} ${s.name.zh}`)

  const icStandalone = sites.filter((s) => s.id.startsWith('ic-'))
  console.log(`\nstandalone ic- sites (heritage row with no same-category OSM match within range, ${icStandalone.length}):`)
  for (const s of icStandalone) console.log(`  ${s.id.padEnd(16)} ${s.category.padEnd(9)} kind=${s.kind.padEnd(7)} ${s.name.zh}`)

  const mmOnly = sites.filter((s) => s.id.startsWith('mm-'))
  console.log(`\nMy Maps-only sites (id starts 'mm-'): ${mmOnly.length}`)

  const withMm = sites.filter((s) => s.macaumemory).sort((a, b) => b.macaumemory.names.length - a.macaumemory.names.length)
  console.log(`\ntop 10 sites by macaumemory.names length (${withMm.length} sites carry macaumemory):`)
  for (const s of withMm.slice(0, 10)) {
    console.log(`  ${s.id.padEnd(22)} names=${String(s.macaumemory.names.length).padStart(2)}  ${s.name.zh}  [${s.macaumemory.names.join(' / ')}]`)
  }
}

function fail(msg) {
  console.error(`error: ${msg}`)
  process.exit(1)
}

function cmdBusRouteMatch(ids, thresholdArg) {
  // Compare each route's drawn loop with the public GPX paths linked by MO
  // Transport's route pages (captured by scripts/capture-route-paths.mjs):
  // metres of our loop farther than the threshold from their trace, metres
  // of their trace farther than the threshold from ours, and where.
  const threshold = Number(thresholdArg ?? 30), near = 15
  const routes = busRoutes().filter(r => !ids.length || ids.includes(r.id))
  const stops = load('public/data/bus-stops.json')
  const reference = {}
  for (const file of ['data/bus_reference/amaral-route-paths.json', 'data/bus_reference/route-paths.json']) {
    try { Object.assign(reference, load(file)) } catch { /* optional capture */ }
  }
  const mx = 111320 * Math.cos(22.19 * Math.PI / 180)
  const toXY = ([lng, lat]) => [(lng - 113.55) * mx, (lat - 22.19) * 111320]
  const CELL = 50
  // Segments of a polyline on a grid, for nearest-distance queries.
  const index = coords => {
    const pts = coords.map(toXY), cells = new Map()
    const key = (cx, cy) => cx * 100000 + cy
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1]
      for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++)
        for (let cy = Math.floor(Math.min(ay, by) / CELL); cy <= Math.floor(Math.max(ay, by) / CELL); cy++) {
          const k = key(cx, cy)
          let list = cells.get(k)
          if (!list) { list = []; cells.set(k, list) }
          list.push(i)
        }
    }
    const distance = ([px, py], radius) => {
      let best = Infinity
      const r = Math.ceil(radius / CELL), cx0 = Math.floor(px / CELL), cy0 = Math.floor(py / CELL)
      for (let cx = cx0 - r; cx <= cx0 + r; cx++) for (let cy = cy0 - r; cy <= cy0 + r; cy++) for (const i of cells.get(key(cx, cy)) ?? []) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if (d < best) best = d
      }
      return best
    }
    return { distance }
  }
  // Walk a polyline every 5 m.
  const samples = coords => {
    const out = [], pts = coords.map(toXY)
    let along = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), n = Math.max(1, Math.ceil(seg / 5))
      for (let j = 0; j < n; j++) {
        const f = j / n
        out.push({ xy: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f],
          lngLat: [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f], along: along + seg * f })
      }
      along += seg
    }
    return { out, length: along }
  }
  const nearestStop = lngLat => {
    const p = toXY(lngLat)
    let best = null, d0 = Infinity
    for (const s of stops) { const q = toXY(s.coordinates), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < d0) { d0 = d; best = s } }
    return best ? `${best.nameCn} (${Math.round(d0)} m)` : ''
  }
  // The Amaral terminal is modelled as bay lanes; the GPX just crosses the forecourt.
  const inTerminal = ([lng, lat]) => lng > 113.5427 && lng < 113.5440 && lat > 22.18865 && lat < 22.18985
  // Contiguous stretches farther than the threshold, merged across gaps under 20 m.
  const runs = (list, other) => {
    const result = []
    let current = null
    for (const s of list) {
      const d = other.distance(s.xy, 120)
      if (d <= threshold) continue
      if (current && s.along - current.toM < 20) { current.toM = s.along; if (d > current.maxM) { current.maxM = d; current.at = s.lngLat } }
      else { current = { fromM: s.along, toM: s.along, maxM: d, at: s.lngLat }; result.push(current) }
    }
    return result.map(r => ({ lengthM: Math.round(r.toM - r.fromM + 5), maxM: Math.round(Math.min(r.maxM, 999)), atM: Math.round(r.fromM), at: r.at.map(v => +v.toFixed(5)), near: nearestStop(r.at), terminal: inTerminal(r.at) || undefined }))
  }
  const rows = []
  for (const route of routes) {
    const ref = reference[route.id]
    if (!ref || ref.error || !ref.paths?.length) { rows.push({ id: route.id, error: ref?.error ?? 'no reference' }); continue }
    const ours = route.geometry.geometry.coordinates, refCoords = ref.paths.flatMap(p => p.coordinates)
    const oursIndex = index(ours), refIndex = index(refCoords)
    const oursSamples = samples(ours), refSamples = samples(refCoords)
    const oursD = oursSamples.out.map(s => refIndex.distance(s.xy, 120))
    const oursRuns = runs(oursSamples.out, refIndex).sort((a, b) => b.lengthM - a.lengthM)
    const refRuns = runs(refSamples.out, oursIndex).sort((a, b) => b.lengthM - a.lengthM)
    const outside = list => list.filter(r => !r.terminal).reduce((a, r) => a + r.lengthM, 0)
    rows.push({ id: route.id, name: route.nameCn, km: +(oursSamples.length / 1000).toFixed(1), refKm: +(refSamples.length / 1000).toFixed(1), refPaths: ref.paths.length, checkedAt: ref.checkedAt,
      within15Pct: +(oursD.filter(d => d <= near).length / oursD.length * 100).toFixed(1), maxM: Math.round(Math.min(Math.max(...oursD), 999)),
      oursOffM: outside(oursRuns), refOffM: outside(refRuns), terminalOffM: [...oursRuns, ...refRuns].filter(r => r.terminal).reduce((a, r) => a + r.lengthM, 0),
      oursRuns: oursRuns.slice(0, 6), refRuns: refRuns.slice(0, 6) })
  }
  for (const row of rows) console.log(JSON.stringify(row))
  const differing = rows.filter(r => !r.error && (r.oursOffM > 50 || r.refOffM > 50)).sort((a, b) => Math.max(b.oursOffM, b.refOffM) - Math.max(a.oursOffM, a.refOffM))
  console.log(JSON.stringify({ routes: rows.length, thresholdM: threshold, matching: rows.filter(r => !r.error && r.oursOffM <= 50 && r.refOffM <= 50).length,
    differing: differing.map(r => `${r.id}: ours ${r.oursOffM} m / ref ${r.refOffM} m`), missingReference: rows.filter(r => r.error).map(r => `${r.id}: ${r.error}`) }))
}

const [cmd, ...rest] = process.argv.slice(2)
const tailFlag = rest.indexOf('--tail')
const tail = tailFlag >= 0 ? Number(rest[tailFlag + 1]) || 0 : 0
const pos = rest.filter((a, i) => a !== '--tail' && rest[i - 1] !== '--tail')

switch (cmd) {
  case 'bus-terminal-guide-check': {
    const { applyTerminalGuide } = await import('./amaral-route-guide.mjs')
    const guides = load('data/bus_reference/amaral-route-paths.json')
    const stops = new Map(load('public/data/bus-stops.json').map(s => [s.id, s]))
    let passed = 0
    for (const route of busRoutes()) if (guides[route.id]) {
      try { applyTerminalGuide(route, stops, guides[route.id]); passed++ }
      catch (error) { console.log(error.message) }
    }
    console.log(`Compatible GPX guides: ${passed}/${Object.keys(guides).length}`)
    break
  }
  case 'bus-terminal-reference': cmdBusTerminalReference(pos[0], pos[1]); break
  case 'bus-terminal-crossings': cmdBusTerminalCrossings(); break
  case 'bus-route-match': cmdBusRouteMatch(pos.filter(a => !a.startsWith('--')), rest.find(a => a.startsWith('--threshold='))?.slice(12)); break
  case 'bus-replay-report': cmdBusReplayReport(pos[0]); break
  case 'bus-station': cmdBusStation(pos[0]); break
  case 'bus-cycles': await cmdBusCycles(pos[0]); break
  case 'bus-continuity': await cmdBusContinuity(pos[0], pos[1], pos[2], pos[3]); break
  case 'bus-playback': await cmdBusPlayback(pos[0], pos[1], pos[2], pos[3]); break
  case 'bus-roads': cmdBusRoads(pos[0], pos[1]); break
  case 'city-loading': await cmdCityLoading(); break
  case 'lrt-motion': {
    const index = rest.indexOf('--dwell')
    await cmdLrtMotion(index < 0 ? undefined : Number(rest[index + 1]))
    break
  }
  case 'routes': cmdRoutes(); break
  case 'route': cmdRoute(pos[0]); break
  case 'in-service': cmdInService(pos[0], pos[1], tail); break
  case 'coords': cmdCoords(); break
  case 'bus-traffic': await cmdBusTraffic(pos[0], pos[1], pos[2], pos[3], pos[4]); break
  case 'ferries': summarizeJson('public/data/ferry-schedules.json'); break
  case 'flights': summarizeJson('public/data/flights.json'); break
  case 'road-works': cmdRoadWorks(pos[0]); break
  case 'schools': cmdSchools(); break
  case 'public-housing': cmdPublicHousing(); break
  case 'water-facilities': cmdWaterFacilities(); break
  case 'water-distribution': cmdDistribution('public/data/water-distribution.json'); break
  case 'power-facilities': cmdPowerFacilities(); break
  case 'power-distribution': cmdDistribution('public/data/power-distribution.json'); break
  case 'parishes': cmdParishes(); break
  case 'toilets': cmdToilets(); break
  case 'car-parks': cmdCarParks(); break
  case 'waste': cmdWaste(); break
  case 'dspa-stats': cmdDspaStats(); break
  case 'grand-prix': cmdGrandPrix(pos.includes('--kinks')); break
  case 'religion': cmdReligion(); break
  case 'old-maps': cmdOldMaps(); break
  default:
    console.log('commands: bus-traffic [HH:MM] [seconds] [step] [current|baseline|amaral|scope] | bus-station [M172] | bus-cycles [route-id] | bus-continuity [HH:MM] [seconds] [step] [schedule|traffic|scope] | bus-playback [HH:MM] [realSeconds] [speed] [latencyMs] | bus-terminal-crossings | bus-route-match [route-id…] [--threshold=30] | city-loading | lrt-motion | routes | route <id> | in-service HH:MM [weekday|sat|sun] [--tail N] | coords | ferries | flights | road-works [YYYY-MM-DD] | schools | public-housing | water-facilities | water-distribution | power-facilities | power-distribution | parishes | toilets | car-parks | waste | dspa-stats | grand-prix | religion | old-maps')
    if (cmd) process.exit(1)
}
