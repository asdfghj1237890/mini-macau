import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { expect, it, vi } from 'vitest'
import type { Feature, LineString } from 'geojson'
import type { TransitData } from '../types'
import { BusTrafficController, busesConflict } from './busTraffic'
import { computeVehiclePositions } from './simulationEngine'
import { busGeometryKey } from './busRoadProfile'

// These warm starts include clearance offsets measured on the former lane
// courses. Freeze that input geometry so a new lane policy cannot invalidate
// the original interlock reproduction before the controller even runs. Knots
// record the two-metre lateral courses from the September 12 city replays;
// they contain public bus geometry only. busTrafficReplay.test.ts separately
// exercises the current, unmocked lane policy across the complete fleet.
vi.mock('./busLaneGeometry', async importOriginal => {
  const original = await importOriginal<typeof import('./busLaneGeometry')>()
  const { default: recorded } = await import('./__fixtures__/bus-maneuver-lanes.json')
  const fixtures = recorded as Record<string, { count: number; points: number[][] }>
  const keys = new WeakMap<object, string>()
  return { ...original, sampleBusLaneCourse: (...args: Parameters<typeof original.sampleBusLaneCourse>) => {
    const [line, , , progress, returning, , plan] = args
    let key = keys.get(line)
    if (!key) { key = busGeometryKey((line as Feature<LineString>).geometry.coordinates); keys.set(line, key) }
    const fixture = fixtures[`${key}:${plan.preference}:${returning}`]
    if (!fixture) throw new Error(`Missing recorded bus lane course: ${key}:${plan.preference}:${returning}`)
    const at = Math.max(0, Math.min(1, returning ? 1 - progress : progress)) * fixture.count
    const points = fixture.points
    let low = 0, high = points.length - 1
    while (high - low > 1) { const middle = (low + high) >>> 1; if (points[middle][0] <= at) low = middle; else high = middle }
    const a = points[low], b = points[high]
    return a[1] + (b[1] - a[1]) * (at - a[0]) / (b[0] - a[0])
  } }
})

// Public route geometry only. Warm starts reproduce the approach positions
// from city replays without running the preceding twenty minutes each time.
const routes = JSON.parse(gunzipSync(readFileSync(new URL('./__fixtures__/bus-replay-routes.json.gz', import.meta.url))).toString('utf8')) as TransitData['busRoutes']
const stops = JSON.parse(readFileSync(new URL('../../public/data/bus-stops.json', import.meta.url), 'utf8')) as TransitData['busStops']

function pairAt(clock: string, playheads: Map<string, number>) {
  const traffic = new BusTrafficController()
  const start = new Date(`2026-09-11T${clock}+08:00`).getTime()
  const routeIds = new Set([...playheads.keys()].map(id => id.split('-')[0]))
  const data = { busRoutes: routes.filter(r => routeIds.has(r.id)), busStops: stops,
    lrtLines: [], stations: [], trips: [], flights: [], ferries: [] } as unknown as TransitData
  computeVehiclePositions(data, new Date(start), { busTraffic: traffic })
  traffic['junctionOwners'].clear(); traffic['junctionWaiters'].clear()
  for (const [id, state] of traffic['states']) {
    if (!playheads.has(id)) { traffic['states'].delete(id); continue }
    state.playhead = playheads.get(id)!
    state.pose = state.plan.sample(state.playhead)
    state.active = true; state.blocked = false
    state.speed = (state.pose.vehicle.busMotion?.speedKmh ?? 0) / 3.6
    state.path = undefined; state.exitPose = undefined
    state.passage = undefined; state.requestOrder = 0
    const passage = state.plan.passageAt?.(state.pose.distanceM)
    if (passage) traffic['holdPassage'](state, passage)
  }
  expect(traffic['states'].size).toBe(playheads.size)
  return { traffic, start }
}

function advancePair(traffic: BusTrafficController, start: number, seconds: number) {
  const starting = [...traffic['states'].values()]
  for (let a = 0; a < starting.length; a++) for (let b = a + 1; b < starting.length; b++) {
    expect(busesConflict(starting[a].pose.vehicle, starting[b].pose.vehicle, 0), 'warm start has clear bodies').toBe(false)
  }
  const initial = [...traffic['states'].values()].map(s => {
    const sample = s.plan.sample
    // Controller plans include the current clearance. Feed an unshifted
    // course back in, just as computeVehiclePositions does on every frame.
    const plan = { ...s.plan, sample: (time: number) => {
      const pose = sample(time)
      return { ...pose, vehicle: { ...pose.vehicle, coordinates: [
        pose.vehicle.coordinates[0] - s.offsetX / (111320 * Math.cos(22.19 * Math.PI / 180)),
        pose.vehicle.coordinates[1] - s.offsetY / 111320,
      ] as [number, number] } }
    } }
    return { plan, nominal: s.nominal, distanceM: s.pose.distanceM }
  })
  const previous = new Map(initial.map(s => [s.plan.id, s.distanceM]))
  for (let t = .5; t <= seconds; t += .5) {
    const vehicles = traffic.sample(initial.map(s => ({ ...s.plan, elapsedSec: s.nominal + t })), start + t * 1000)
    expect(vehicles, `buses remain on their current runs at ${t}s`).toHaveLength(initial.length)
    for (let a = 0; a < vehicles.length; a++) for (let b = a + 1; b < vehicles.length; b++) {
      expect(busesConflict(vehicles[a], vehicles[b], 0)).toBe(false)
    }
    for (const state of traffic['states'].values()) {
      expect(state.pose.distanceM, `${state.plan.id} keeps its schedule progress`).toBeGreaterThanOrEqual(previous.get(state.plan.id)!)
      previous.set(state.plan.id, state.pose.distanceM)
      const angle = state.pose.vehicle.bearing * Math.PI / 180
      const side = state.offsetX * Math.cos(angle) - state.offsetY * Math.sin(angle)
      const lane = state.pose.laneAllowance
      if (lane) {
        expect(side).toBeGreaterThanOrEqual(-lane.leftM - .021)
        expect(side).toBeLessThanOrEqual(lane.rightM + .021)
      }
    }
  }
  for (const state of traffic['states'].values()) {
    const before = initial.find(s => s.plan.id === state.plan.id)!
    expect(state.pose.distanceM - before.distanceM, state.plan.id).toBeGreaterThan(20)
  }
}

it.each([
  [3773.2214132690233, 5688.328386158282],
  [3773.165322198848, 5688.335902786637],
])('creeps out of an angled merge without overlapping physical bus bodies (%s)', (front, rear) => {
  const { traffic, start } = pairAt('08:12:30', new Map([['37-2', front], ['102-2', rear]]))
  for (const [id, state] of traffic['states']) {
    state.speed = 0; state.stalledSec = 5; state.blocked = true
    state.leaderId = id === '37-2' ? '102-2' : '37-2'
  }
  const owner = traffic['states'].get('102-2')!
  // The rear approach already holds a corridor into the common exit. Only a
  // simultaneously checked manoeuvre may override this internal priority.
  owner.turnClaim = Array.from({ length: 20 }, (_, i) => {
    const pose = owner.plan.sample(owner.playhead + i * .12), v = pose.vehicle, angle = v.bearing * Math.PI / 180
    return { distanceM: pose.distanceM, body: { x: (v.coordinates[0] - 113.54) * 111320 * Math.cos(22.19 * Math.PI / 180),
      y: (v.coordinates[1] - 22.19) * 111320, fx: Math.sin(angle), fy: Math.cos(angle), half: 5.7, width: 1.325, z: 0 } }
  })
  advancePair(traffic, start, 60)
})

it('leaves the turning leaders tail room before its straight follower reaches the bend', () => {
  const { traffic, start } = pairAt('18:16:40', new Map([['3-0', 45021.90845671808], ['60-1', 43172.907375639625]]))
  advancePair(traffic, start, 40)
  expect(traffic['states'].get('3-0')!.pose.distanceM).toBeGreaterThan(163790)
  expect(traffic['states'].get('60-1')!.pose.distanceM).toBeGreaterThan(189200)
})

it.each([
  ['18:28:20', '52-3', 41612.314205477785, '50B-2', 39851.70350408285, -2.201722955932208, -1.184236473564778],
  ['08:40:50', '52-4', 5523.047499084991, '25B-2', 6564.389449462884, -.45216396003059106, -.21341919606599133],
] as const)('rejoins a retreat while the adjacent bus clears the bend (%s)', (clock, id, time, otherId, otherTime, x, y) => {
  const { traffic, start } = pairAt(clock, new Map([[id, time], [otherId, otherTime]]))
  const retreated = traffic['states'].get(id)!
  retreated.offsetX = x; retreated.offsetY = y
  retreated.pose = retreated.plan.sample(time)
  retreated.clearance = { x: 0, y: 0 }
  traffic['releasePassage'](retreated)
  for (const state of traffic['states'].values()) {
    state.speed = 0; state.stalledSec = 10; state.blocked = true
    state.leaderId = state === retreated ? otherId : id
  }
  advancePair(traffic, start, 90)
  expect(Math.hypot(retreated.offsetX, retreated.offsetY)).toBeLessThan(.02)
})

it('clears a three-bus turn with a retreated crossing vehicle', () => {
  const { traffic, start } = pairAt('18:30:00', new Map([
    ['H3-1', 41695.231830651224], ['MT2-0', 39985.08213876917], ['22-5', 40327.48650457611],
  ]))
  const retreat = traffic['states'].get('22-5')!
  retreat.offsetX = -.31902451907186036; retreat.offsetY = .38498246776984263
  retreat.pose = retreat.plan.sample(retreat.playhead)
  traffic['releasePassage'](retreat)
  const waits: Record<string, string> = { 'H3-1': 'MT2-0', 'MT2-0': '22-5', '22-5': 'H3-1' }
  for (const state of traffic['states'].values()) {
    state.leaderId = waits[state.plan.id]; state.speed = 0; state.blocked = true; state.stalledSec = 10
  }
  const owner = traffic['states'].get('H3-1')!
  owner.turnClaim = Array.from({ length: 16 }, (_, i) => {
    const distanceM = 321610.4353189148 + i * 2
    let lo = owner.playhead, hi = lo + 30
    for (let j = 0; j < 28; j++) {
      const mid = (lo + hi) / 2
      if (owner.plan.sample(mid).distanceM < distanceM) lo = mid
      else hi = mid
    }
    const v = owner.plan.sample((lo + hi) / 2).vehicle, angle = v.bearing * Math.PI / 180
    return { distanceM, body: { x: (v.coordinates[0] - 113.54) * 111320 * Math.cos(22.19 * Math.PI / 180),
      y: (v.coordinates[1] - 22.19) * 111320, fx: Math.sin(angle), fy: Math.cos(angle), half: 5.7, width: 1.325, z: 0 } }
  })
  advancePair(traffic, start, 90)
})

it('clears an opposing approach beside a tight reversing bend', () => {
  // Begin before the reversing corner: correcting the old backwards axle
  // changes its body footprint at the former mid-turn checkpoint.
  const { traffic, start } = pairAt('18:40:00', new Map([['1-1', 44944.91030337036], ['18-0', 45189.0269470735]]))
  for (const state of traffic['states'].values()) {
    state.speed = 0; state.blocked = true; state.stalledSec = 10
    state.leaderId = state.plan.id === '1-1' ? '18-0' : '1-1'
  }
  advancePair(traffic, start, 120)
})

it('does not oscillate between retreating and rejoining at a hairpin', () => {
  const { traffic, start } = pairAt('18:51:00', new Map([['25B-5', 41445.75988886798], ['25BS-1', 43208.09381831499]]))
  for (const [id, state] of traffic['states']) {
    const first = id === '25B-5'
    const angle = state.pose.vehicle.bearing * Math.PI / 180, retreat = first ? .4 : 4
    state.offsetX = -Math.sin(angle) * retreat; state.offsetY = -Math.cos(angle) * retreat
    state.pose = state.plan.sample(state.playhead)
    state.rejoinAfterM = state.pose.distanceM + 14
    state.cautiousUntilM = state.pose.distanceM + 20
    state.speed = 0; state.blocked = true; state.stalledSec = 10
    state.leaderId = first ? '25BS-1' : '25B-5'
    traffic['releasePassage'](state)
  }
  advancePair(traffic, start, 90)
})

it('includes a queued third bus when recovering an interlocked pair', () => {
  const { traffic, start } = pairAt('08:43:20', new Map([
    ['25B-0', 7662.31297418394], ['32-0', 8578.365606143725], ['MT1-1', 3336.434665931765],
  ]))
  for (const [id, state] of traffic['states']) {
    const offset = id === '25B-0' ? [-2.989021911098921, -.1384674851974111] :
      id === '32-0' ? [-1.15509302627301, 1.6321002009774586] : [-1.598632388473591, .06544063451196062]
    state.offsetX = offset[0]; state.offsetY = offset[1]
    state.pose = state.plan.sample(state.playhead)
    state.rejoinAfterM = state.pose.distanceM + 14
    state.speed = 0; state.blocked = true; state.stalledSec = 10
    state.leaderId = id === '25B-0' ? '32-0' : '25B-0'
  }
  advancePair(traffic, start, 90)
})

it('makes room with queued followers behind a retreated crossing pair', () => {
  const cases = [
    ['73-0', 41952.24885434431, -11.018191193675753, 3.726674870000005, 'MT2-2'],
    ['MT2-2', 39076.914586655505, -1.572962352311351, -2.9616539915038893, '73-0'],
    ['MT1-1', 39329.837366452775, -3.35222170536353, 3.1116971709651837, '73-0'],
    ['MT1-2', 39233.11343878074, -6.521321473683834, -9.778889413937195, 'MT2-2'],
  ] as const
  const { traffic, start } = pairAt('18:52:00', new Map(cases.map(([id, time]) => [id, time])))
  for (const [id, , x, y, leader] of cases) {
    const state = traffic['states'].get(id)!
    state.offsetX = x; state.offsetY = y; state.pose = state.plan.sample(state.playhead)
    state.rejoinAfterM = state.pose.distanceM + 14
    state.speed = 0; state.blocked = true; state.stalledSec = 10; state.leaderId = leader
    if (id === '73-0' || id === 'MT2-2') state.clearance = { x: 0, y: 0 }
  }
  advancePair(traffic, start, 120)
})
