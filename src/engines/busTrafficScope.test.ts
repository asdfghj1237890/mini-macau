import { describe, expect, it } from 'vitest'
import { BusTrafficController, busesConflict, type BusTrafficPlan } from './busTraffic'
import { BusTrafficScope } from './busTrafficScope'
import { BusTraceRecorder, type BusDetailView } from './busMotionTrace'

const LNG_M = 111320 * Math.cos(22.19 * Math.PI / 180)
const route = {}
const view: BusDetailView = { bounds: [113.5399, 22.1899, 113.5401, 22.1901] }
function plan(id: string, elapsedSec: number, offset: number, speed = 0): BusTrafficPlan {
  return { id, routeKey: route, elapsedSec, arrivalAgeSec: -1, sample: at => ({ distanceM: offset + at * speed,
    vehicle: { id, lineId: id, type: 'bus', coordinates: [113.54 + (offset + at * speed) / LNG_M, 22.19],
      bearing: 90, progress: at / 2000, color: '#fff',
      busMotion: { speedKmh: speed * 3.6, dirSec: at, delaySec: 0, returning: false, phase: speed ? 'cruising' : 'stopped' } },
  }) }
}

describe('bus traffic detail scope', () => {
  it('keeps the whole marker fleet while limiting detailed traffic to the approach buffer', () => {
    const traffic = new BusTrafficController(120), scope = new BusTrafficScope(traffic)
    const sample = (at: number) => scope.sample([plan('visible', at, 0, 2), plan('approaching', at, 200, 2),
      plan('distant', at, 2000, 2)], at * 1000, view, new BusTraceRecorder(view))
    sample(0)
    const vehicles = sample(8)
    expect(traffic.currentVehicles().map(v => v.id)).toEqual(['visible', 'approaching'])
    expect(vehicles.map(v => v.id)).toEqual(['visible', 'approaching', 'distant'])
    expect(vehicles.at(-1)?.coordinates).toEqual(plan('distant', 8, 2000, 2).sample(8).vehicle.coordinates)
  })

  it('retains a physical queue after its timetable position has left the buffer', () => {
    const traffic = new BusTrafficController(120), scope = new BusTrafficScope(traffic)
    const sample = (at: number) => scope.sample([plan('stopped', at, 60), plan('following', at, 0, 10)],
      at * 1000, view, new BusTraceRecorder(view))
    sample(0)
    const state = traffic['states'].get('following')
    for (let at = 8; at <= 160; at += 8) {
      const vehicles = sample(at)
      expect(traffic['states'].get('following')).toBe(state)
      expect(busesConflict(vehicles[0], vehicles[1], 0)).toBe(false)
    }
    expect(state!.pose.vehicle.coordinates[0]).toBeLessThan(113.54 + 60 / LNG_M)
  })

  it('keeps the tracked bus and nearby traffic detailed at overview zoom', () => {
    const traffic = new BusTrafficController(120), scope = new BusTrafficScope(traffic)
    const plans = [plan('tracked', 0, 2000), plan('neighbour', 0, 2100), plan('distant', 0, 0)]
    const overview = { trackedId: 'tracked' }
    const vehicles = scope.sample(plans, 0, overview, new BusTraceRecorder(overview))
    expect(traffic.currentVehicles().map(v => v.id)).toEqual(['tracked', 'neighbour'])
    expect(vehicles).toHaveLength(3)
  })

  it('refreshes detailed membership while paused without recreating queues that remain in view', () => {
    const traffic = new BusTrafficController(120), scope = new BusTrafficScope(traffic)
    const plans = [plan('near', 0, 0), plan('far', 0, 2000)]
    scope.sample(plans, 0, view, new BusTraceRecorder(view))
    const near = traffic['states'].get('near')
    scope.sample(plans, 0, { bounds: [113.5398, 22.1898, 113.5402, 22.1902] }, new BusTraceRecorder())
    expect(traffic['states'].get('near')).toBe(near)
    const panned: BusDetailView = { bounds: [113.559, 22.1899, 113.56, 22.1901] }
    scope.sample(plans, 0, panned, new BusTraceRecorder(panned))
    expect(traffic.currentVehicles().map(v => v.id)).toEqual(['far'])
  })

  it('uses nominal markers with no detailed view, and provides contiguous overview traces', () => {
    const traffic = new BusTrafficController(120), scope = new BusTrafficScope(traffic)
    const sample = (at: number) => {
      const recorder = new BusTraceRecorder({})
      const vehicles = scope.sample([plan('dot', at, 0, 2)], at * 1000, {}, recorder)
      return recorder.finish(vehicles, at * 1000)
    }
    sample(0)
    const trace = sample(8)
    expect(traffic.currentVehicles()).toHaveLength(0)
    expect(trace.startMs).toBe(0)
    expect(trace.endMs).toBe(8000)
    expect(trace.paths[0].points[0]).toBe(0)
    expect(trace.paths[0].points[9]).toBe(8000)
  })
})
