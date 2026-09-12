import { describe, expect, it } from 'vitest'
import type { Feature, LineString } from 'geojson'
import type { BusRoadProfile, VehiclePosition } from '../types'
import { BusTrafficController, busesConflict, type BusTrafficPlan } from './busTraffic'
import { busGeometryKey } from './busRoadProfile'
import { sampleBusPose } from './simulationEngine'
import type { BusLanePlan } from './busLaneGeometry'

const mx = 111320 * Math.cos(22.19 * Math.PI / 180)
const coords = Array.from({ length: 21 }, (_, i) => [113.54 + i * 50 / mx, 22.19])
const geometry: Feature<LineString> = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
const profile = (drop = false): BusRoadProfile => ({ version: 1, geometryKey: busGeometryKey(coords), fetchedAtUtc: '2026-09-12T00:00:00Z',
  sections: drop ? [
    { start: 0, end: 12, kind: 'one-way', evidence: 'tag', lanes: 3, wayId: 1, direction: 1 },
    { start: 12, end: 20, kind: 'one-way', evidence: 'tag', lanes: 1, wayId: 2, direction: 1 },
  ] : [{ start: 0, end: 20, kind: 'one-way', evidence: 'tag', lanes: 3, wayId: 1, direction: 1 }],
})
const x = (v: VehiclePosition) => (v.coordinates[0] - 113.54) * mx

function makePlan(id: string, road: BusRoadProfile, lane: BusLanePlan, offset = 0, stopped = false) {
  const key = {}
  return (time: number): BusTrafficPlan => ({ id, routeKey: key, elapsedSec: time, arrivalAgeSec: stopped ? time : -1,
    sample: at => {
      const distanceM = offset + (stopped ? 250 : at * 6), pos = sampleBusPose(geometry, distanceM / 1000, false, road, lane)
      return { distanceM, laneAllowance: pos.laneAllowance, vehicle: { id, lineId: id, type: 'bus', color: '#fff', scale: .5,
        coordinates: pos.coordinates, bearing: pos.bearing, progress: distanceM / 1000,
        busMotion: { speedKmh: stopped ? 0 : 21.6, delaySec: 0, dirSec: at, returning: false, phase: stopped ? 'stopped' : 'cruising' },
      } }
    },
  })
}
function noIntersections(vehicles: VehiclePosition[]) {
  for (let i = 0; i < vehicles.length; i++) for (let j = i + 1; j < vehicles.length; j++)
    expect(busesConflict(vehicles[i], vehicles[j], 0), `${vehicles[i].id}/${vehicles[j].id}`).toBe(false)
}

describe('same-direction bus lanes', () => {
  it('waits before a lane drop when a temporary offset has no clear return path', () => {
    const traffic = new BusTrafficController(), key = {}
    const make = (id: string, time: number): BusTrafficPlan => ({ id, routeKey: key, elapsedSec: time, arrivalAgeSec: 0,
      sample: at => {
        const stopped = id === 'parked', distanceM = stopped ? 20 : at * 5
        return { distanceM, laneAllowance: { leftM: 0, rightM: distanceM < 25 ? 4 : 0 }, vehicle: {
          id, lineId: id, type: 'bus', color: '#fff', scale: .5, progress: distanceM / 200,
          coordinates: [113.54 - (stopped ? 1 : 0) / mx, 22.19 + distanceM / 111320], bearing: stopped ? 18 : 0,
          busMotion: { speedKmh: stopped ? 0 : 18, delaySec: 0, dirSec: at, returning: false, phase: stopped ? 'stopped' : 'cruising' },
        } }
      },
    })
    for (let time = 0; time <= 15; time += .5) {
      const vehicles = traffic.sample([make('parked', time), make('approach', time)], time * 1000)
      noIntersections(vehicles)
      expect(traffic['states'].get('approach')!.offsetX).toBe(0)
    }
    expect(traffic['states'].get('approach')!.blocked).toBe(true)
  })

  it('rejoins gradually when a lane drop narrows the allowance around an existing offset', () => {
    const road = profile(true), traffic = new BusTrafficController()
    const make = makePlan('rejoining', road, { preference: 0, stops: [] })
    traffic.sample([make(101)], 101000)
    // Reproduce a retained clearance offset at the three-to-one lane boundary.
    // The first inward step is still outside the new allowance and must be
    // allowed to reduce the error without jumping straight to the centre.
    const state = traffic['states'].get('rejoining')!
    state.offsetY = 1.1
    state.pose = state.plan.sample(state.playhead)
    state.clearance = { x: 0, y: 0 }
    let previous = state.offsetY
    for (let time = 101.5; time <= 106; time += .5) {
      traffic.sample([make(time)], time * 1000)
      expect(state.offsetY).toBeLessThanOrEqual(previous)
      expect(previous - state.offsetY).toBeLessThanOrEqual(.401)
      previous = state.offsetY
    }
    expect(state.offsetY).toBeCloseTo(0)
    expect(state.pose.distanceM).toBeGreaterThan(610)
  })

  it('passes a stopped adjacent lane without joining its queue and replays deterministically', () => {
    const road = profile(), traffic = new BusTrafficController()
    const stopped = makePlan('kerb', road, { preference: 0, stops: [] }, 0, true)
    const through = makePlan('through', road, { preference: 1, stops: [] })
    let vehicles: VehiclePosition[] = []
    const first = traffic.sample([stopped(30), through(30)], 30000)
    for (let time = 30; time <= 70; time += .5) {
      vehicles = traffic.sample([stopped(time), through(time)], time * 1000)
      noIntersections(vehicles)
      expect(vehicles.find(v => v.id === 'through')!.busMotion!.delaySec).toBeLessThan(.01)
    }
    expect(x(vehicles.find(v => v.id === 'through')!)).toBeGreaterThan(410)
    expect(traffic.sample([stopped(30), through(30)], 30000)).toEqual(first)
  })

  it('lets three parallel lanes merge into one without intersecting or getting stuck', () => {
    const road = profile(true), traffic = new BusTrafficController()
    const factories = [0, 1, 2].map(preference => makePlan(`lane-${preference}`, road, { preference, stops: [] }, preference * 3))
    let vehicles: VehiclePosition[] = [], merged = false
    for (let time = 55; time <= 150; time += .5) {
      vehicles = traffic.sample(factories.map(make => make(time)), time * 1000)
      noIntersections(vehicles)
      merged ||= vehicles.some(v => v.busMotion!.phase === 'queued')
    }
    expect(vehicles).toHaveLength(3)
    expect(merged).toBe(true)
    for (const vehicle of vehicles) expect(x(vehicle)).toBeGreaterThan(650)
  })

  it('keeps same-direction lanes separate from both opposing lanes', () => {
    const road = profile()
    road.sections[0] = { ...road.sections[0], kind: 'two-way', lanes: 4 }
    const vehicles: VehiclePosition[] = []
    for (const returning of [false, true]) for (const preference of [0, 1]) {
      const pose = sampleBusPose(geometry, .5, returning, road, { preference, stops: [] })
      vehicles.push({ id: `${returning}-${preference}`, lineId: 'test', type: 'bus', color: '#fff', scale: .5,
        progress: .5, coordinates: pose.coordinates, bearing: pose.bearing })
    }
    noIntersections(vehicles)
    expect(new Set(vehicles.map(v => v.coordinates[1].toFixed(6))).size).toBe(4)
  })
})
