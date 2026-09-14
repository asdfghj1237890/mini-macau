import { describe, expect, it } from 'vitest'
import { buildBusPassages, passageAtDistance } from './busJunctions'
import { BusTrafficController, busesConflict, type BusTrafficPlan } from './busTraffic'
import type { BusRoadProfile } from '../types'

const mx = 111320 * Math.cos(22.19 * Math.PI / 180)
const keys = new Map<string, object>()
function crossing(id: string, time: number, north: boolean, delay = 0): BusTrafficPlan {
  if (!keys.has(id)) keys.set(id, {})
  const sample = (t: number) => {
    const d = Math.max(0, t - delay) * 5, p = d - 100
    return { distanceM: d, vehicle: { id, lineId: id, type: 'bus' as const, coordinates: [113.54 + (north ? 0 : p) / mx, 22.19 + (north ? p : 0) / 111320] as [number, number],
      bearing: north ? 0 : 90, scale: .5, progress: d / 500, color: '#fff',
      busMotion: { speedKmh: t <= delay ? 0 : 18, delaySec: 0, dirSec: t, returning: false, phase: 'cruising' as const } } }
  }
  return { id, routeKey: keys.get(id)!, elapsedSec: time, arrivalAgeSec: -1, sample,
    passageAt: distance => distance < 130 ? { keys: ['cross'], entryM: 70, exitM: 130 } : undefined }
}

describe('junction passage reservations', () => {
  it('does not cross an ungranted entry during a long accelerated step', () => {
    const traffic = new BusTrafficController()
    const make = (at: number) => {
      const p = crossing('fast-approach', at, false)
      return { ...p, sample: (t: number) => p.sample(t * 4),
        passageAt: () => ({ keys: ['held'], entryM: 160, exitM: 220 }) }
    }
    traffic.sample([make(0)], 0)
    traffic['junctionOwners'].set('held', new Map([['other-approach', 0]]))
    traffic.sample([make(8)], 8000)
    expect(traffic['states'].get('fast-approach')!.pose.distanceM).toBeLessThanOrEqual(159.7)
    expect(traffic['states'].get('fast-approach')!.passage).toBeUndefined()
  })

  it('serves two earlier requests from one approach before a later crossing request without alternating arms', () => {
    const traffic = new BusTrafficController(), crossed: string[] = []
    for (let time = 0; time <= 60; time += .5) {
      const plans = [crossing('first-east', time + 4, false), crossing('second-east', time, false),
        ...(time >= 4 ? [crossing('third-north', time - 4, true)] : [])]
        .map(plan => ({ ...plan, passageAt: (distance: number) => distance < 130 ? {
          keys: ['cross'], approaches: { cross: plan.id === 'third-north' ? 0 : 90 }, entryM: 70, exitM: 130,
          zones: [{ key: 'cross', entryM: 70, exitM: 130 }],
        } : undefined }))
      const vehicles = traffic.sample(plans, time * 1000)
      for (const vehicle of vehicles) {
        if (vehicle.progress >= .2 && !crossed.includes(vehicle.id)) crossed.push(vehicle.id)
        const state = traffic['states'].get(vehicle.id)!
        expect(state.offsetX).toBe(0)
        expect(state.offsetY).toBe(0)
      }
      for (let a = 0; a < vehicles.length; a++) for (let b = a + 1; b < vehicles.length; b++)
        expect(busesConflict(vehicles[a], vehicles[b], 0)).toBe(false)
    }
    expect(crossed).toEqual(['first-east', 'second-east', 'third-north'])
  })
  it.each([false, true])('lets a checked retreat vacate only its beneficiarys corridor (other reservation: %s)', otherReservation => {
    const traffic = new BusTrafficController()
    const make = (t: number) => [crossing('retreating', t + 20, false), crossing('beneficiary', t + 16, true),
      ...(otherReservation ? [crossing('outside-owner', t + 100, true)] : [])]
      .map(plan => ({ ...plan, passageAt: () => undefined, sample: (at: number) => {
        const pose = plan.sample(at)
        if (plan.id === 'beneficiary') pose.vehicle.coordinates[0] += 5 / mx
        return pose
      } }))
    traffic.sample(make(0), 0)
    const retreat = traffic['states'].get('retreating')!, owner = traffic['states'].get('beneficiary')!
    // A previously checked retreat leaves the entire northbound corridor
    // clear at x=-3. Its first small steps still occupy that same corridor.
    retreat.clearance = { x: -3, y: 0 }
    retreat.recoveryYield = { id: 'beneficiary', untilM: 120 }
    owner.turnClaim = Array.from({ length: 21 }, (_, i) => ({ distanceM: 80 + i * 2,
      body: { x: 5, y: -20 + i * 2, fx: 0, fy: 1, half: 5.7, width: 1.325, z: 0 } }))
    if (otherReservation) traffic['states'].get('outside-owner')!.turnClaim = Array.from({ length: 21 }, (_, i) => ({ distanceM: 700 + i * 2,
      body: { x: -8, y: -20 + i * 2, fx: 0, fy: 1, half: 5.7, width: 1.325, z: 0 } }))
    for (let t = .5; t <= 4; t += .5) {
      const vehicles = traffic.sample(make(t), t * 1000)
      expect(vehicles).toHaveLength(otherReservation ? 3 : 2)
      expect(busesConflict(vehicles[0], vehicles[1], 0)).toBe(false)
    }
    if (otherReservation) expect(retreat.offsetX).toBeGreaterThan(-1.1)
    else expect(retreat.offsetX).toBeCloseTo(-3)
    expect(owner.pose.distanceM).toBeGreaterThan(80)
  })

  it('protects a reserved crossing more than one spatial cell ahead of its owner', () => {
    const traffic = new BusTrafficController()
    const make = (t: number) => [crossing('long-owner', t, false), crossing('far-approach', t + 15, true)]
      .map(plan => ({ ...plan, passageAt: () => undefined }))
    traffic.sample(make(0), 0)
    // A linked-junction recovery has reserved a clear 160 m corridor. The
    // crossing bus is 100 m from the owner but close to its reserved path.
    const owner = traffic['states'].get('long-owner')!
    owner.turnClaim = Array.from({ length: 81 }, (_, i) => ({ distanceM: i * 2,
      body: { x: i * 2 - 100, y: 0, fx: 1, fy: 0, half: 5.7, width: 1.325, z: 0 } }))
    for (let t = .5; t <= 45; t += .5) {
      const vehicles = traffic.sample(make(t), t * 1000)
      expect(vehicles).toHaveLength(2)
      expect(busesConflict(vehicles[0], vehicles[1], 0)).toBe(false)
      const states = traffic.inspectQueues({ includeMoving: true })
      const east = states.find(s => s.id === 'long-owner')!, north = states.find(s => s.id === 'far-approach')!
      if (east.distanceM < 110) expect(north.distanceM).toBeLessThan(93)
    }
    expect(traffic.inspectQueues({ includeMoving: true }).every(s => s.distanceM > 130)).toBe(true)
  })

  it('joins overlapping junctions into one atomic reservation and reverses a return passage', () => {
    const profile = { junctions: [{ id: 'a', start: .1, end: .2 }, { id: 'b', start: .19, end: .3 }] } as BusRoadProfile
    const p = buildBusPassages(profile, 1000)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ keys: ['a', 'b'], entryM: 92, exitM: 304,
      zones: [{ entryM: 92, exitM: 204 }, { entryM: 182, exitM: 304 }] })
    expect(passageAtDistance(p, 1000, 1000, false)).toMatchObject({ keys: ['a', 'b'], entryM: 1696, exitM: 1908,
      zones: [{ entryM: 1696, exitM: 1818 }, { entryM: 1796, exitM: 1908 }] })
  })
  it('holds one approach before entry and lets both crossing buses clear without sideways motion', () => {
    const traffic = new BusTrafficController()
    let waited = false, last: ReturnType<BusTrafficController['sample']> = []
    for (let i = 0; i <= 350; i++) {
      const t = i * .2
      last = traffic.sample([crossing('east', t, false), crossing('north', t, true)], t * 1000)
      expect(last).toHaveLength(2)
      expect(busesConflict(last[0], last[1], 0)).toBe(false)
      for (const v of last) {
        waited ||= v.busMotion?.phase === 'queued'
        if (v.id === 'east') expect(v.coordinates[1]).toBe(22.19)
        else expect(v.coordinates[0]).toBe(113.54)
      }
    }
    expect(waited).toBe(true)
    expect(last.every(v => v.progress > .5), JSON.stringify(last.map(v => ({ id: v.id, progress: v.progress, motion: v.busMotion })))).toBe(true)
  })
  it('initialises a seek inside the crossing with only one admitted vehicle', () => {
    const traffic = new BusTrafficController()
    const vehicles = traffic.sample([crossing('east', 20, false), crossing('north', 20, true)], 20000)
    expect(vehicles).toHaveLength(2)
    expect(busesConflict(vehicles[0], vehicles[1], 0)).toBe(false)
    expect(vehicles.filter(v => v.progress > .14)).toHaveLength(1)
  })
  it('shares an approach with a bus that splits off co-directionally, not with one that turns across the exit', () => {
    // The rear bus follows the front bus to 100 m, then leaves its line at
    // the given bearing: a 30-degree split is driven as one queue, a 90-degree
    // turn sweeps across the front bus's course and waits for it to leave.
    const make = (id: string, time: number, turnTo?: number): BusTrafficPlan => {
      const base = crossing(id, time, false)
      return { ...base, sample: at => {
        const pose = base.sample(at), beyond = pose.distanceM - 100
        if (turnTo !== undefined && beyond > 0) {
          const angle = turnTo * Math.PI / 180
          pose.vehicle.coordinates = [113.54 + beyond * Math.sin(angle) / mx, 22.19 + beyond * Math.cos(angle) / 111320]
          pose.vehicle.bearing = turnTo
        }
        return pose
      }, passageAt: d => d < 130 ? { keys: ['cross'], approaches: { cross: 90 }, entryM: 70, exitM: 130,
        zones: [{ key: 'cross', entryM: 70, exitM: 130 }] } : undefined }
    }
    for (const [turnTo, held] of [[undefined, 2], [120, 2], [180, 1]] as const) {
      const traffic = new BusTrafficController()
      const vehicles = traffic.sample([make('front', 20), make('rear', 16, turnTo)], 20000)
      expect(vehicles).toHaveLength(2)
      expect(busesConflict(vehicles[0], vehicles[1], 0)).toBe(false)
      expect(traffic.inspectQueues().filter(s => s.held), `turn to ${turnTo}`).toHaveLength(held)
    }
  })
  it('keeps the front bus exempt from its convoy until the rear clears a longer linked passage', () => {
    const make = (id: string, t: number): BusTrafficPlan => {
      const base = crossing(id, t, false)
      return { ...base, passageAt: distance => distance < (id === 'front' ? 115 : 150) ? {
        keys: id === 'front' ? ['shared'] : ['shared', 'linked'], entryM: 70, exitM: id === 'front' ? 115 : 150,
        zones: [{ key: 'shared', entryM: 70, exitM: 115 }, ...(id === 'front' ? [] : [{ key: 'linked', entryM: 105, exitM: 150 }])],
      } : undefined }
    }
    const traffic = new BusTrafficController()
    let last: ReturnType<BusTrafficController['sample']> = []
    for (let t = 0; t <= 55; t += .5) {
      last = traffic.sample([make('front', t + 20), make('rear', t + 16)], t * 1000)
      expect(last).toHaveLength(2)
      expect(busesConflict(last[0], last[1], 0)).toBe(false)
    }
    expect(last.every(v => v.progress > .45)).toBe(true)
  })
  it('lets a closed convoy advance past its rear members retained turn reservation', () => {
    const traffic = new BusTrafficController()
    const make = (id: string, t: number) => ({ ...crossing(id, t, false),
      passageAt: (distance: number) => distance < 400 ? { keys: ['shared'], entryM: 0, exitM: 400,
        zones: [{ key: 'shared', entryM: 0, exitM: 400 }] } : undefined })
    traffic.sample([make('front', 24), make('rear', 20)], 0)
    // Warm-start a reservation retained as a front bus moves into its sweep.
    // This is the state observed in the 18A/30X replay: both buses already
    // hold admission, but the rear's old turn claim blocks the front's exit.
    const rear = traffic['states'].get('rear')!
    rear.turnClaim = Array.from({ length: 31 }, (_, i) => {
      const distanceM = rear.pose.distanceM + i * 2
      return { distanceM, body: { x: distanceM - 100, y: 0, fx: 1, fy: 0, half: 5.7, width: 1.325, z: 0 } }
    })
    let last: ReturnType<BusTrafficController['sample']> = [], queued = false
    for (let t = .5; t <= 45; t += .5) {
      last = traffic.sample([make('front', 24 + t), make('rear', 20 + t)], t * 1000)
      expect(last).toHaveLength(2)
      expect(busesConflict(last[0], last[1], 0)).toBe(false)
      queued ||= last.some(v => v.busMotion?.phase === 'queued')
    }
    expect(queued).toBe(true)
    expect(last.every(v => v.progress > .45), JSON.stringify(traffic.inspectQueues())).toBe(true)
  })
  it('replaces an internal retreat promise only with a collision-checked convoy step', () => {
    const traffic = new BusTrafficController()
    const make = (t: number) => {
      const plans = [crossing('front-retreat', 20 + t, false), crossing('rear-beneficiary', 16 + t, false)]
        .map(plan => ({ ...plan, passageAt: (distance: number) => distance < 400 ? { keys: ['shared'], entryM: 0, exitM: 400,
          zones: [{ key: 'shared', entryM: 0, exitM: 400 }] } : undefined }))
      const parked = crossing('distant-stop', t, false)
      parked.passageAt = () => undefined
      parked.sample = () => {
        const p = crossing('distant-stop', 70, false).sample(70)
        p.vehicle.busMotion = { ...p.vehicle.busMotion!, phase: 'stopped', speedKmh: 0 }
        return p
      }
      // The far stop prevents reserving the entire 400 m passage as an escape,
      // but leaves ample room for the two-bus convoy to make normal progress.
      return [...plans, parked]
    }
    traffic.sample(make(0), 0)
    const front = traffic['states'].get('front-retreat')!, rear = traffic['states'].get('rear-beneficiary')!
    front.recoveryYield = { id: rear.plan.id, untilM: rear.pose.distanceM + 30 }
    let last: ReturnType<BusTrafficController['sample']> = []
    for (let time = .5; time <= 30; time += .5) {
      last = traffic.sample(make(time), time * 1000)
      expect(last).toHaveLength(3)
      for (let a = 0; a < last.length; a++) for (let b = a + 1; b < last.length; b++) expect(busesConflict(last[a], last[b], 0)).toBe(false)
    }
    expect(front.recoveryYield).toBeUndefined()
    expect(last.every(v => v.progress > .3)).toBe(true)
  })
  it('leaves room for a leader body to swing back through a short imported path kink', () => {
    const make = (id: string, t: number): BusTrafficPlan => {
      const base = crossing(id, t, false)
      return { ...base, sample: at => {
        const p = base.sample(at), d = p.distanceM
        const position = d < 60 ? d : d < 68 ? 60 - (d - 60) / 2 : d - 12
        p.vehicle.coordinates[0] = 113.54 + (position - 100) / mx
        return p
      }, passageAt: d => d < 130 ? { keys: ['bend'], entryM: 20, exitM: 130,
        zones: [{ key: 'bend', entryM: 20, exitM: 130 }] } : undefined }
    }
    const traffic = new BusTrafficController()
    let last: ReturnType<BusTrafficController['sample']> = []
    for (let t = 0; t <= 60; t += .2) {
      last = traffic.sample([make('leader', t + 10), make('follower', t + 7)], t * 1000)
      expect(last).toHaveLength(2)
      expect(busesConflict(last[0], last[1], 0)).toBe(false)
    }
    expect(last.every(v => v.progress > .4)).toBe(true)
  })
  it('lets an older crossing request through a continuing stream of same-path arrivals', () => {
    const traffic = new BusTrafficController()
    let northClearedAt = Infinity
    const make = (id: string, time: number, north: boolean): BusTrafficPlan => ({ ...crossing(id, time, north),
      passageAt: d => d < 130 ? { keys: ['cross'], approaches: { cross: north ? 0 : 90 }, entryM: 70, exitM: 130,
        zones: [{ key: 'cross', entryM: 70, exitM: 130 }] } : undefined })
    for (let t = 0; t <= 90; t += .5) {
      const plans = Array.from({ length: Math.floor(t / 4) + 1 }, (_, i) => make(`stream-${i}`, t - i * 4, false))
      if (t >= 5) plans.push(make('waiting-north', t - 5, true))
      const vehicles = traffic.sample(plans, t * 1000)
      const north = vehicles.find(v => v.id === 'waiting-north')
      if (north && north.progress > .26) northClearedAt = Math.min(northClearedAt, t)
      for (let a = 0; a < vehicles.length; a++) for (let b = a + 1; b < vehicles.length; b++) expect(busesConflict(vehicles[a], vehicles[b], 0)).toBe(false)
    }
    expect(northClearedAt, JSON.stringify(traffic.inspectQueues().map(s => ({ id: s.id, d: s.distanceM, leader: s.leader, waitingFor: s.waitingFor, order: s.requestOrder, held: s.held?.keys })))).toBeLessThan(75)
  })
  it('lets an exit occupant clear before the older request waiting for that exit', () => {
    const traffic = new BusTrafficController()
    const make = (t: number) => {
      const older = crossing('older', t + 13.5, false)
      older.passageAt = d => d < 130 ? { keys: ['cross'], entryM: 70, exitM: 130,
        zones: [{ key: 'cross', entryM: 70, exitM: 130 }] } : undefined
      const occupant = crossing('occupant', t + 19.94, true), sample = occupant.sample
      occupant.sample = at => { const p = sample(at); p.vehicle.coordinates[0] += 38 / mx; return p }
      occupant.passageAt = d => d < 180 ? { keys: ['approach', 'cross'], entryM: 100, exitM: 180,
        zones: [{ key: 'approach', entryM: 100, exitM: 135 }, { key: 'cross', entryM: 100, exitM: 180 }] } : undefined
      const parked = crossing('parked', t, true)
      parked.passageAt = () => undefined
      parked.sample = () => {
        const p = crossing('parked', 36, true).sample(36)
        p.vehicle.coordinates[0] += 38 / mx
        p.vehicle.busMotion = { ...p.vehicle.busMotion!, speedKmh: 0, phase: 'stopped' }
        return p
      }
      return [older, occupant, parked]
    }
    let last: ReturnType<BusTrafficController['sample']> = []
    for (let t = 0; t <= 65; t += .5) {
      last = traffic.sample(make(t), t * 1000)
      expect(last).toHaveLength(3)
      for (let a = 0; a < last.length; a++) for (let b = a + 1; b < last.length; b++) expect(busesConflict(last[a], last[b], 0)).toBe(false)
      if (t === .5) expect(last.find(v => v.id === 'occupant')!.progress).toBeGreaterThan(.2)
    }
    expect(last.find(v => v.id === 'older')!.progress).toBeGreaterThan(.5)
    expect(last.find(v => v.id === 'occupant')!.progress).toBeGreaterThan(.27)
  })
  it('allows separated opposite lanes through one junction without treating them as crossing traffic', () => {
    const east = crossing('east', 20, false), west = crossing('west', 20, false)
    const base = west.sample
    west.sample = at => {
      const p = base(at)
      p.vehicle.coordinates = [2 * 113.54 - p.vehicle.coordinates[0], 22.19 + 4 / 111320]
      p.vehicle.bearing = 270
      return p
    }
    for (const plan of [east, west]) plan.passageAt = d => d < 130 ? { keys: ['shared-node'], entryM: 70, exitM: 130,
      zones: [{ key: 'shared-node', entryM: 70, exitM: 130 }] } : undefined
    const traffic = new BusTrafficController()
    const vehicles = traffic.sample([east, west], 20000)
    expect(vehicles).toHaveLength(2)
    expect(traffic.inspectQueues().filter(s => s.held)).toHaveLength(2)
    expect(busesConflict(vehicles[0], vehicles[1], 0)).toBe(false)
  })

  it('lets an exit occupant through an indirect three-request dependency', () => {
    const traffic = new BusTrafficController()
    const make = (time: number) => [crossing('older-chain', time - 3, false), crossing('middle-chain', time, false), crossing('exit-chain', time, true)]
    traffic.sample(make(10), 10000)
    const older = traffic['states'].get('older-chain')!, middle = traffic['states'].get('middle-chain')!, exit = traffic['states'].get('exit-chain')!
    older.requestOrder = 1; middle.requestOrder = 2; exit.requestOrder = 3
    older.waitingFor = middle.plan.id; older.waitReason = 'queue-front'
    middle.waitingFor = exit.plan.id; middle.waitReason = 'exit-space'
    traffic['junctionWaiters'].set('cross', [older, middle, exit].map(state => ({ state, passage: state.plan.passageAt!(state.pose.distanceM)! })))
    // The older bus is on another arm, so a straight-line "behind" check and
    // the immediate exit-occupant exception both miss this dependency.
    expect(traffic['claimPassage'](exit, exit.plan.passageAt!(exit.pose.distanceM)!)).toBe(true)
    let vehicles: ReturnType<BusTrafficController['sample']> = []
    for (let time = 10.5; time <= 80; time += .5) {
      vehicles = traffic.sample(make(time), time * 1000)
      for (let a = 0; a < vehicles.length; a++) for (let b = a + 1; b < vehicles.length; b++) expect(busesConflict(vehicles[a], vehicles[b], 0)).toBe(false)
    }
    expect(vehicles.every(v => v.progress > .26), JSON.stringify(vehicles.map(v => ({ id: v.id, progress: v.progress })))).toBe(true)
  })

  it('detects a detour between matching entry, middle and exit landmarks', () => {
    const front = crossing('front', 20, false), rear = crossing('rear', 16, false), base = rear.sample
    rear.sample = at => {
      const p = base(at), d = p.distanceM
      if (d > 88 && d < 102) {
        const angle = (d - 88) / 14 * Math.PI
        p.vehicle.coordinates[1] += Math.sin(angle) * 6 / 111320
        p.vehicle.bearing = Math.atan2(1, Math.cos(angle) * 6 * Math.PI / 14) * 180 / Math.PI
      }
      return p
    }
    for (const plan of [front, rear]) plan.passageAt = d => d < 130 ? { keys: ['cross'], approaches: { cross: 90 }, entryM: 70, exitM: 130,
      zones: [{ key: 'cross', entryM: 70, exitM: 130 }] } : undefined
    const traffic = new BusTrafficController()
    const vehicles = traffic.sample([front, rear], 20000)
    expect(vehicles).toHaveLength(2)
    expect(traffic.inspectQueues().filter(s => s.held)).toHaveLength(1)
  })
  it('does not let an older rear request block the front bus when their exits differ', () => {
    const make = (id: string, time: number): BusTrafficPlan => {
      const base = crossing(id, time, id === 'incumbent')
      return { ...base, sample: at => {
        const pose = base.sample(at)
        if (id === 'rear' && pose.distanceM > 100) {
          pose.vehicle.coordinates[1] += (pose.distanceM - 100) / 111320
          pose.vehicle.bearing = 45
        }
        return pose
      }, passageAt: d => d < 130 ? { keys: ['cross'], entryM: 70, exitM: 130,
        zones: [{ key: 'cross', entryM: 70, exitM: 130 }] } : undefined }
    }
    const traffic = new BusTrafficController()
    traffic.sample([make('incumbent', 20), make('rear', 10), make('front', 13)], 20000)
    let last: ReturnType<BusTrafficController['sample']> = []
    for (let dt = .5; dt <= 60; dt += .5) {
      last = traffic.sample([make('rear', 10 + dt), make('front', 13 + dt)], 20000 + dt * 1000)
      expect(busesConflict(last[0], last[1], 0)).toBe(false)
    }
    expect(last.every(v => v.progress > .3)).toBe(true)
  })
  it.each([false, true])('lets a bus leave a stop inside linked junctions before its following reservation holder (curved: %s)', curved => {
    const make = (id: string, t: number): BusTrafficPlan => {
      const base = crossing(id, t, false)
      return { ...base, elapsedSec: t + 20, sample: elapsed => {
        const at = elapsed - 20
        const time = id === 'front-stop' ? at <= 10 ? 20 : at + 10 : at + 16
        const p = base.sample(time)
        if (id === 'front-stop') {
          if (at <= 10) p.vehicle.busMotion = { ...p.vehicle.busMotion!, speedKmh: 0, phase: 'stopped' }
          const turnAt = curved ? 100 : 130
          if (p.distanceM >= turnAt) {
            p.vehicle.coordinates[1] += (p.distanceM - turnAt) * (curved ? Math.tan(Math.PI / 6) : 1) / 111320
            p.vehicle.bearing = curved ? 60 : 45
          }
        }
        return p
      }, passageAt: d => d < 160 ? { keys: ['entry', 'exit'], entryM: 70, exitM: 160,
        zones: [{ key: 'entry', entryM: 70, exitM: 110 }, { key: 'exit', entryM: 108, exitM: 160 }] } : undefined }
    }
    const traffic = new BusTrafficController()
    let last: ReturnType<BusTrafficController['sample']> = []
    for (let t = 0; t <= 60; t += .5) {
      last = traffic.sample([make('front-stop', t), make('following', t)], t * 1000)
      expect(last).toHaveLength(2)
      expect(busesConflict(last[0], last[1], 0)).toBe(false)
    }
    expect(last.every(v => v.progress > .4)).toBe(true)
  })
  it('retains junction admission during an eight-second pickup with a turning follower', () => {
    const traffic = new BusTrafficController()
    const make = (id: string, t: number): BusTrafficPlan => ({ ...crossing(id, t, false), sample: at => {
      const time = id === 'front' ? Math.min(at, 20) + Math.max(0, at - 28) : Math.max(0, at - 4)
      const p = crossing(id, time, false).sample(time)
      if (id === 'front' && at >= 20 && at <= 28) p.vehicle.busMotion = { ...p.vehicle.busMotion!, speedKmh: 0, phase: 'stopped' }
      if (id === 'follower' && p.distanceM > 100) {
        p.vehicle.coordinates = [113.54, 22.19 + (p.distanceM - 100) / 111320]
        p.vehicle.bearing = 0
      }
      return p
    }, passageAt: d => d < 150 ? { keys: ['pickup'], entryM: 70, exitM: 150,
      zones: [{ key: 'pickup', entryM: 70, exitM: 150 }] } : undefined })
    let last: ReturnType<BusTrafficController['sample']> = []
    for (let t = 10; t <= 65; t += .5) {
      last = traffic.sample([make('front', t), make('follower', t)], t * 1000)
      expect(last).toHaveLength(2)
      expect(busesConflict(last[0], last[1], 0)).toBe(false)
      if (t >= 20 && t <= 27) expect(traffic.inspectQueues({ includeMoving: true }).find(s => s.id === 'front')?.held?.keys ?? []).toContain('pickup')
    }
    expect(last.every(v => v.progress > .45)).toBe(true)
  })

  it('releases ordinary junction admission during an extended layover', () => {
    const traffic = new BusTrafficController()
    const make = (t: number): BusTrafficPlan => ({ ...crossing('layover', t, false), sample: at => {
      const time = Math.min(at, 20) + Math.max(0, at - 120), p = crossing('layover', time, false).sample(time)
      if (at >= 20 && at <= 120) p.vehicle.busMotion = { ...p.vehicle.busMotion!, speedKmh: 0, phase: 'stopped' }
      return p
    } })
    for (let t = 10; t <= 40; t += .5) traffic.sample([make(t)], t * 1000)
    expect(traffic.inspectQueues({ includeMoving: true })[0].held).toBeUndefined()
  })
  it('reserves the actual turning space when route metadata uses different junction ids', () => {
    for (const reverseOrder of [false, true]) {
      const traffic = new BusTrafficController()
      let waited = false, last: ReturnType<BusTrafficController['sample']> = []
      for (let t = 0; t <= 70; t += .2) {
        const plans = [crossing('a-east', t, false), crossing('z-north', t, true)]
        for (const p of plans) p.passageAt = d => d < 130 ? { keys: [p.id], entryM: 70, exitM: 130 } : undefined
        last = traffic.sample(reverseOrder ? plans.reverse() : plans, t * 1000)
        expect(last).toHaveLength(2)
        expect(busesConflict(last[0], last[1], 0)).toBe(false)
        for (const v of last) {
          waited ||= v.busMotion?.phase === 'queued'
          if (v.id === 'a-east') expect(v.coordinates[1]).toBe(22.19)
          else expect(v.coordinates[0]).toBe(113.54)
        }
      }
      expect(waited).toBe(true)
      expect(last.every(v => v.progress > .5)).toBe(true)
    }
  })
  it('reserves a junction across the circular route seam without releasing it early', () => {
    const profile = { junctions: [{ id: 'seam', start: 0, end: .02 }, { id: 'seam', start: .98, end: 1 }] } as BusRoadProfile
    const p = buildBusPassages(profile, 1000)
    expect(p).toHaveLength(1)
    expect(passageAtDistance(p, 1000, 980)).toMatchObject({ keys: ['seam'], entryM: 972, exitM: 1024 })
    expect(passageAtDistance(p, 1000, 1010)).toMatchObject({ keys: ['seam'], entryM: 972, exitM: 1024 })
    expect(passageAtDistance(p, 1000, 1010)?.zones).toEqual([{ key: 'seam', entryM: 972, exitM: 1000 }, { key: 'seam', entryM: 1000, exitM: 1024 }])
  })
  it('releases a removed vehicle and resets reservations after a backward seek', () => {
    const traffic = new BusTrafficController()
    traffic.sample([crossing('east', 20, false), crossing('north', 20, true)], 20000)
    let vehicles = traffic.sample([crossing('north', 21, true)], 21000)
    for (let t = 22; t <= 70; t++) vehicles = traffic.sample([crossing('north', t, true)], t * 1000)
    expect(vehicles[0].progress).toBeGreaterThan(.5)
    vehicles = traffic.sample([crossing('east', 20, false), crossing('north', 20, true)], 20000)
    expect(vehicles).toHaveLength(2)
    expect(busesConflict(vehicles[0], vehicles[1], 0)).toBe(false)
  })
  it('keeps a narrow street exclusive even after a long wait', () => {
    const traffic = new BusTrafficController()
    const make = (id: string, t: number, reverse: boolean): BusTrafficPlan => {
      const base = crossing(id, t, false)
      return { ...base, sample: at => {
        const pose = base.sample(at)
        if (reverse) { pose.vehicle.coordinates[0] = 2 * 113.54 - pose.vehicle.coordinates[0]; pose.vehicle.bearing = 270 }
        return pose
      }, passageAt: d => d < 150 ? { keys: ['n1'], entryM: 30, exitM: 150 } : undefined }
    }
    let last: ReturnType<BusTrafficController['sample']> = []
    for (let t = 0; t <= 100; t += .5) {
      last = traffic.sample(t <= 30 ? [make('narrow-a', t, false), make('narrow-b', t, true)] : [make('narrow-b', t, true)], t * 1000)
      if (last.length === 2) expect(busesConflict(last[0], last[1], 0)).toBe(false)
      if (t === 28) expect(last.filter(v => v.progress > .06)).toHaveLength(1)
      for (const v of last) expect(v.coordinates[1]).toBe(22.19)
    }
    expect(last.every(v => v.progress > .6)).toBe(true)
  })
  it('lets a ready approach pass while an older request has a blocked exit', () => {
    const traffic = new BusTrafficController()
    const make = (t: number) => {
      const parked = crossing('exit-queue', 0, true)
      const sample = parked.sample
      parked.sample = () => {
        const pose = sample(27.6)
        pose.vehicle.busMotion = { ...pose.vehicle.busMotion!, phase: 'stopped', speedKmh: 0 }
        return pose
      }
      parked.passageAt = () => undefined
      return [parked, crossing('older-north', t + 12, true), crossing('ready-east', t + 9, false)]
    }
    let last: ReturnType<BusTrafficController['sample']> = []
    for (let t = 0; t <= 55; t += .5) {
      last = traffic.sample(make(t), t * 1000)
      for (let a = 0; a < last.length; a++) for (let b = a + 1; b < last.length; b++) expect(busesConflict(last[a], last[b], 0)).toBe(false)
    }
    expect(last.find(v => v.id === 'ready-east')!.progress).toBeGreaterThan(.3)
    expect(traffic['states'].get('older-north')!.pose.distanceM).toBeLessThan(70)
  })
  it('records the blocking vehicle when a temporary offset cannot rejoin', () => {
    const traffic = new BusTrafficController()
    const make = (time: number) => {
      const parked = crossing('parked-neighbour', time, false), sample = parked.sample
      parked.sample = () => {
        const pose = sample(20)
        pose.vehicle.busMotion = { ...pose.vehicle.busMotion!, phase: 'stopped', speedKmh: 0 }
        return pose
      }
      return [parked, crossing('rejoining', time, false)].map(plan => ({ ...plan, passageAt: () => undefined }))
    }
    traffic.sample(make(26), 26000)
    const returning = traffic['states'].get('rejoining')!
    returning.playhead = 20; returning.offsetY = 2.8
    returning.pose = returning.plan.sample(20); returning.clearance = { x: 0, y: 0 }
    const vehicles = traffic.sample(make(26.5), 26500)
    expect(busesConflict(vehicles[0], vehicles[1], 0)).toBe(false)
    expect(returning.blocked).toBe(true)
    expect(returning.leaderId).toBe('parked-neighbour')
  })
})
