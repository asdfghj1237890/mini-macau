import { describe, expect, it } from 'vitest'
import { BusTrafficController, busesConflict, type BusTrafficPlan } from './busTraffic'
import type { VehiclePosition } from '../types'

const lngM = 111320 * Math.cos(22.19 * Math.PI / 180)
type Options = { speed?: number; offset?: number; lane?: number; reverse?: boolean; stopAt?: number; stopFor?: number; merge?: boolean }
const routeKeys = new Map<string, object>()
function plan(id: string, elapsedSec: number, options: Options = {}): BusTrafficPlan {
  if (!routeKeys.has(id)) routeKeys.set(id, {})
  const { speed = 4, offset = 0, lane = 0, reverse = false, stopAt = Infinity, stopFor = 0, merge = false } = options
  return { id, routeKey: routeKeys.get(id)!, elapsedSec, arrivalAgeSec: elapsedSec >= stopAt && elapsedSec <= stopAt + stopFor ? elapsedSec - stopAt : -1,
    sample: at => {
      const dwell = at >= stopAt && at <= stopAt + stopFor
      const move = Math.min(at, stopAt) + Math.max(0, at - stopAt - stopFor)
      const distanceM = move * speed + offset
      const x = reverse ? -distanceM : distanceM
      const y = lane + (merge ? Math.max(0, 400 - distanceM) * .5 : 0)
      return { distanceM, vehicle: { id, lineId: id, type: 'bus', coordinates: [113.54 + x / lngM, 22.19 + y / 111320],
        bearing: reverse ? 270 : merge && distanceM < 400 ? 116.565 : 90, progress: distanceM / 2000, color: '#3498db',
        busMotion: { speedKmh: dwell ? 0 : speed * 3.6, delaySec: 0, dirSec: at, returning: reverse, phase: dwell ? 'stopped' : 'cruising' } } }
    } }
}
const x = (v: VehiclePosition) => (v.coordinates[0] - 113.54) * lngM
function clear(vehicles: VehiclePosition[]) {
  for (let i = 0; i < vehicles.length; i++) for (let j = i + 1; j < vehicles.length; j++)
    expect(busesConflict(vehicles[i], vehicles[j], 4.95), `${vehicles[i].id}/${vehicles[j].id}`).toBe(false)
}

describe('bus following', () => {
  it('uses the same conflict decision from either end of a curved queue', () => {
    const a = plan('curve-a', 100).sample(100).vehicle
    const b = { ...a, id: 'curve-b', bearing: 80, coordinates: [a.coordinates[0] + 20 / lngM, a.coordinates[1] + 3.5 / 111320] as [number, number] }
    expect(busesConflict(a, b)).toBe(true)
    expect(busesConflict(b, a)).toBe(true)
  })
  it('initialises overlapping buses in deterministic front-to-back order across routes', () => {
    const controller = new BusTrafficController()
    const plans = [plan('rear', 100, { offset: -7 }), plan('front', 100), plan('middle', 100, { offset: -3 })]
    const vehicles = controller.sample(plans, 100000)
    clear(vehicles)
    expect(x(vehicles.find(v => v.id === 'front')!)).toBeGreaterThan(x(vehicles.find(v => v.id === 'middle')!))
    expect(x(vehicles.find(v => v.id === 'middle')!)).toBeGreaterThan(x(vehicles.find(v => v.id === 'rear')!))
    const again = new BusTrafficController().sample([...plans].reverse(), 100000)
    expect(again.map(v => [v.id, x(v)]).sort()).toEqual(vehicles.map(v => [v.id, x(v)]).sort())
  })

  it('brakes behind a stopped leader, keeps its order and moves off without reversing', () => {
    const controller = new BusTrafficController(), previous = new Map<string, number>()
    let queued = false, stopped = false, resumed = false
    for (let tick = 0; tick <= 400; tick++) {
      const at = 100 + tick * .2
      const vehicles = controller.sample([plan('leader', at, { stopAt: 110, stopFor: 25 }), plan('follower', at, { speed: 5, offset: -130 })], at * 1000)
      clear(vehicles)
      const leader = vehicles.find(v => v.id === 'leader')!, follower = vehicles.find(v => v.id === 'follower')!
      expect(x(leader) - x(follower)).toBeGreaterThanOrEqual(27.74)
      for (const vehicle of vehicles) {
        expect(x(vehicle) + .001).toBeGreaterThanOrEqual(previous.get(vehicle.id) ?? -Infinity)
        previous.set(vehicle.id, x(vehicle))
      }
      queued ||= follower.busMotion!.phase === 'queued'
      stopped ||= at > 115 && follower.busMotion!.speedKmh < .2
      resumed ||= at > 145 && follower.busMotion!.speedKmh > 5
    }
    expect(queued).toBe(true); expect(stopped).toBe(true); expect(resumed).toBe(true)
  })

  it('reserves space where different routes merge', () => {
    const controller = new BusTrafficController()
    let vehicles: VehiclePosition[] = []
    for (let tick = 0; tick < 500; tick++) {
      const at = 90 + tick * .2
      vehicles = controller.sample([plan('straight', at, { offset: 5, stopAt: 115, stopFor: 20 }), plan('merging', at, { merge: true })], at * 1000)
      for (let i = 0; i < vehicles.length; i++) for (let j = i + 1; j < vehicles.length; j++)
        expect(busesConflict(vehicles[i], vehicles[j], 0)).toBe(false)
    }
    expect(vehicles).toHaveLength(2)
    for (const vehicle of vehicles) expect(x(vehicle)).toBeGreaterThan(550)
  })

  it('does not treat parallel lanes or opposite-direction traffic as a shared queue', () => {
    const plans = [plan('one', 100), plan('other-lane', 100, { lane: 7 }), plan('opposite', 100, { reverse: true, offset: -800, lane: -7 })]
    const vehicles = new BusTrafficController().sample(plans, 100000)
    expect(vehicles.map(v => v.busMotion!.delaySec)).toEqual([0, 0, 0])
  })

  it('pauses exactly, resets seeks, and does not tunnel through a leader at 60x', () => {
    const controller = new BusTrafficController()
    const make = (at: number) => [plan('a', at, { stopAt: 110, stopFor: 30 }), plan('b', at, { speed: 6, offset: -250 })]
    const first = controller.sample(make(100), 100000)
    expect(controller.sample(make(100), 100000)).toEqual(first)
    for (let at = 102; at <= 160; at += 2) clear(controller.sample(make(at), at * 1000))
    expect(controller.sample(make(100), 100000)).toEqual(first)
    const later = controller.sample(make(500), 500000)
    expect(later).toEqual(new BusTrafficController().sample(make(500), 500000))
    expect(controller.sample([], 500000)).toEqual([])
    clear(controller.sample(make(500), 500000))
  })

  it('waits off-map when a terminal origin has no room instead of stacking vehicles', () => {
    const controller = new BusTrafficController()
    const first = controller.sample([plan('a', 0), plan('b', 0)], 0)
    expect(first).toHaveLength(1)
    let later: VehiclePosition[] = []
    for (let at = .2; at <= 20; at += .2) {
      later = controller.sample([plan('a', at), plan('b', at)], at * 1000)
      clear(later)
    }
    expect(later).toHaveLength(2)
  })

  it('ends a disconnected circular trip before queuing for a free origin berth', () => {
    const traffic = new BusTrafficController(), key = {}
    let handedOver = false, resumed = false
    let vehicles: VehiclePosition[] = []
    for (let time = 0; time <= 70; time += .5) {
      const loop: BusTrafficPlan = {
        id: 'loop', routeKey: key, elapsedSec: time, arrivalAgeSec: 0,
        sample: at => {
          const movement = Math.max(0, at - 30) * 4
          const position = at < 10 ? 100 : 80 + movement
          return { distanceM: 100 + movement, vehicle: {
            id: 'loop', lineId: 'loop', type: 'bus', scale: .5, color: '#fff', progress: movement / 500,
            coordinates: [113.54 + position / lngM, 22.19], bearing: 90,
            busMotion: { dirSec: at < 10 ? 30 + at : at - 10, returning: false, delaySec: 0,
              speedKmh: movement ? 14.4 : 0, phase: movement ? 'cruising' : 'stopped' },
          } }
        },
      }
      const through = plan('through', time, { offset: 82, speed: 2 })
      const sample = through.sample
      through.sample = at => { const p = sample(at); p.vehicle.scale = .5; return p }
      vehicles = traffic.sample([loop, through], time * 1000)
      clear(vehicles)
      handedOver ||= time >= 10 && !vehicles.some(v => v.id === 'loop')
      resumed ||= time > 30 && vehicles.some(v => v.id === 'loop' && v.busMotion!.speedKmh > 1)
    }
    expect(handedOver).toBe(true)
    expect(resumed).toBe(true)
    expect(x(vehicles.find(v => v.id === 'through')!)).toBeGreaterThan(150)
  })

  it('moves a full roundabout together instead of making every bus wait for the next', () => {
    const traffic = new BusTrafficController(), radius = 50, length = 2 * Math.PI * radius
    const routes = Array.from({ length: 18 }, () => ({})), first = new Map<string, number>()
    let last: VehiclePosition[] = []
    for (let time = 0; time <= 120; time += .5) {
      const plans = routes.map((routeKey, i): BusTrafficPlan => ({
        id: `ring-${i}`, routeKey, elapsedSec: time, arrivalAgeSec: -1,
        sample: at => {
          const distanceM = i * length / routes.length + at * 3, angle = distanceM / radius
          return { distanceM, vehicle: {
            id: `ring-${i}`, lineId: 'ring', type: 'bus', scale: .5, color: '#fff', progress: distanceM / length,
            coordinates: [113.54 + radius * Math.cos(angle) / lngM, 22.19 + radius * Math.sin(angle) / 111320],
            bearing: -angle * 180 / Math.PI,
            busMotion: { dirSec: at, returning: false, delaySec: 0, speedKmh: 10.8, phase: 'cruising' },
          } }
        },
      }))
      last = traffic.sample(plans, time * 1000)
      expect(last).toHaveLength(routes.length)
      for (let i = 0; i < last.length; i++) {
        if (time === 0) first.set(last[i].id, last[i].progress)
        for (let j = i + 1; j < last.length; j++) expect(busesConflict(last[i], last[j], 0)).toBe(false)
      }
    }
    for (const v of last) expect((v.progress - first.get(v.id)!) * length).toBeGreaterThan(80)
  })
})
