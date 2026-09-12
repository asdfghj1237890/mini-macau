import { describe, expect, it, vi } from 'vitest'
import type { BusRoute } from '../types'
import { BusWorkerRuntime, type BusWorkerRequest } from './busWorkerRuntime'
import { busesConflict, type BusTrafficPlan } from './busTraffic'

const LNG_M = 111320 * Math.cos(22.19 * Math.PI / 180)
vi.mock('./simulationEngine', () => ({ computeBusOnly: (
  data: { busRoutes: BusRoute[] }, time: Date, traffic: { sample: (plans: BusTrafficPlan[], at: number) => unknown },
) => {
  const at = time.getTime(), elapsedSec = at / 1000
  const plan = (id: string, offset: number, speed: number): BusTrafficPlan => ({
    id, routeKey: data.busRoutes[0], elapsedSec, arrivalAgeSec: -1,
    sample: t => ({ distanceM: offset + t * speed, vehicle: {
      id, lineId: 'queue', type: 'bus', color: '#fff', bearing: 90, progress: t / 2000,
      coordinates: [113.54 + (offset + t * speed) / LNG_M, 22.19],
      busMotion: { speedKmh: speed * 3.6, dirSec: t, delaySec: 0, returning: false, phase: speed ? 'cruising' : 'stopped' },
    } }),
  })
  return traffic.sample(data.busRoutes.length ? [plan('leader', 60, 0),
    ...Array.from({ length: 10 }, (_, i) => plan(`bus-${i}`, -20 * i, 10))] : [], at)
} }))

function setup() {
  const runtime = new BusWorkerRuntime()
  const view = { bounds: [113.5375, 22.189, 113.541, 22.191] as [number, number, number, number] }
  let id = 0
  const sample = (simMs: number, extra: Partial<BusWorkerRequest> = {}) => runtime.sample({
    id: id++, epoch: 0, simMs, reset: false, view, ...extra,
  })
  let reply = sample(0, { routes: [[0, { id: 'queue' } as BusRoute]], routeKeys: [0] })
  for (let at = 8000; at <= 32000; at += 8000) reply = sample(at)
  return { runtime, sample, reply }
}

describe('worker queue continuity', () => {
  it('does not clear or relocate the visible queue when the clock gets far ahead', () => {
    const { runtime, sample, reply: before } = setup()
    expect(before.vehicles.length).toBeGreaterThan(5)
    const states = new Map(runtime['traffic']['states'])
    let previous = before
    for (let i = 0; i < 5; i++) {
      const reply = sample(72000)
      expect(reply.simMs - previous.simMs).toBe(8000)
      expect(reply.trace?.startMs).toBe(previous.simMs)
      for (const v of before.vehicles) {
        const current = reply.vehicles.find(x => x.id === v.id)!
        expect(current).toBeDefined()
        expect(current.coordinates[0]).toBeLessThan(113.541)
        expect(runtime['traffic']['states'].get(v.id)).toBe(states.get(v.id))
      }
      for (let a = 0; a < reply.vehicles.length; a++) for (let b = a + 1; b < reply.vehicles.length; b++) {
        expect(busesConflict(reply.vehicles[a], reply.vehicles[b], 0)).toBe(false)
      }
      previous = reply
    }
    expect(previous.simMs).toBe(72000)
  })

  it('holds a paused queue through view refreshes, but still resets an explicit seek', () => {
    const { runtime, sample, reply } = setup()
    const before = new Map(runtime['traffic']['states'])
    const held = sample(72000, { hold: true })
    expect(held.simMs).toBe(reply.simMs)
    // Distant, previously unplaced buses can become coarse markers when the
    // approach buffer shrinks at pause. Every visible physical bus stays put.
    for (const v of reply.vehicles) {
      expect(held.vehicles.find(x => x.id === v.id)?.coordinates).toEqual(v.coordinates)
      expect(runtime['traffic']['states'].get(v.id)).toBe(before.get(v.id))
    }
    expect(held.vehicles.filter(v => v.coordinates[0] < 113.541).map(v => v.id))
      .toEqual(reply.vehicles.map(v => v.id))
    expect(sample(72000, { hold: true, view: { trackedId: 'leader' } }).simMs).toBe(reply.simMs)
    const jumped = sample(72000, { reset: true, hold: true })
    expect(jumped.simMs).toBe(72000)
    expect(runtime['traffic']['states'].get('leader')).not.toBe(before.get('leader'))
    expect(sample(72000, { hold: true, routeKeys: [] }).vehicles).toEqual([])
  })
})
