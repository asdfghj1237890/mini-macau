import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { TransitData } from '../types'
import { BusTrafficController, busesConflict } from './busTraffic'
import { computeVehiclePositions } from './simulationEngine'
import { progressWaitGroups } from './busWaitGroups'
import kerbTurn from './__fixtures__/bus-kerb-turn.json'

// Public bus geometry only. These regressions need no timetable API or LRT data.
const data: TransitData = {
  busRoutes: JSON.parse(readFileSync(new URL('../../public/data/bus-routes.json', import.meta.url), 'utf8')),
  busStops: JSON.parse(readFileSync(new URL('../../public/data/bus-stops.json', import.meta.url), 'utf8')),
  lrtLines: [], stations: [], trips: [], flights: [], ferries: [], roadWorks: [],
  schools: [], publicHousing: [], parishes: [], toilets: [], carParks: [], waste: [],
  wasteSources: [], wasteFacilities: [], wasteEcoStations: [], dspaStats: null,
  waterFacilities: [], waterNetwork: null, waterFacts: null,
  powerFacilities: [], powerNetwork: null, powerFacts: null,
  grandPrix: null, grandPrixSources: [], loading: false,
}

describe('citywide bus traffic replay', () => {
  it('clears a kerb-lane turn with closely queued followers without changing lanes', () => {
    // Current lane-holding courses: reproduce the 18:54 turn and its queue.
    // These are simulation playheads/clearances on public bus routes, not
    // scheduled arrival records. No legacy lane fixture is used here.
    const cases = Object.entries(kerbTurn)
    const controller = new BusTrafficController(), start = new Date('2026-09-11T18:54:00+08:00').getTime()
    // These saved playheads/distances belong to the captured geometry. Keep
    // that exact public bus scene even when terminal routing is updated;
    // otherwise unrelated buses are relocated on top of each other before
    // the first physics step. The current network has its own replay below.
    const scene: TransitData = { ...data, busRoutes: JSON.parse(gunzipSync(readFileSync(
      new URL('./__fixtures__/bus-replay-routes.json.gz', import.meta.url))).toString('utf8')) }
    computeVehiclePositions(scene, new Date(start), { busTraffic: controller })
    controller['junctionOwners'].clear(); controller['junctionWaiters'].clear()
    for (const id of controller['states'].keys()) if (!cases.some(c => c[0] === id)) controller['states'].delete(id)
    const initial = new Map<string, number>()
    const plans = cases.map(([id, saved]) => {
      const state = controller['states'].get(id)!
      Object.assign(state, saved)
      state.pose = state.plan.sample(state.playhead)
      state.passage = undefined; state.path = undefined; state.exitPose = undefined
      const passage = state.plan.passageAt?.(state.pose.distanceM)
      if ('passage' in saved && passage) controller['holdPassage'](state, passage)
      initial.set(id, state.pose.distanceM)
      const sample = state.plan.sample
      return { ...state.plan, sample: (at: number) => {
        const pose = sample(at)
        return { ...pose, vehicle: { ...pose.vehicle, coordinates: [
          pose.vehicle.coordinates[0] - state.offsetX / (111320 * Math.cos(22.19 * Math.PI / 180)),
          pose.vehicle.coordinates[1] - state.offsetY / 111320,
        ] as [number, number] } }
      } }
    })
    const clear = (vehicles: ReturnType<BusTrafficController['sample']>) => {
      for (let a = 0; a < vehicles.length; a++) for (let b = a + 1; b < vehicles.length; b++)
        expect(busesConflict(vehicles[a], vehicles[b], 0), `${vehicles[a].id}/${vehicles[b].id}`).toBe(false)
    }
    clear([...controller['states'].values()].map(s => s.pose.vehicle))
    for (let second = .5; second <= 120; second += .5) {
      clear(controller.sample(plans.map(p => ({ ...p, elapsedSec: p.elapsedSec + second })), start + second * 1000))
      for (const state of controller['states'].values()) {
        const angle = state.pose.vehicle.bearing * Math.PI / 180
        const side = state.offsetX * Math.cos(angle) - state.offsetY * Math.sin(angle)
        expect(side).toBeGreaterThanOrEqual(-state.pose.laneAllowance!.leftM - .021)
        expect(side).toBeLessThanOrEqual(state.pose.laneAllowance!.rightM + .021)
      }
    }
    for (const id of ['101-0', 'H3-2']) expect(controller['states'].get(id)!.pose.distanceM - initial.get(id)!, id).toBeGreaterThan(20)
    // This integration replay also initializes the complete route network.
    // Allow shared CI runners the same budget as the neighboring bend replay.
  }, 30000)
  it('keeps opposing buses clear through the complete Taipa bend', () => {
    const controller = new BusTrafficController()
    const start = new Date('2026-09-11T18:00:00+08:00').getTime()
    const initial = new Map<string, number>()
    for (let second = 0; second <= 180; second += 2) {
      const vehicles = computeVehiclePositions(data, new Date(start + second * 1000), { busTraffic: controller })
      const pair = vehicles.filter(v => v.id === '73-1' || v.id === 'MT1-1')
      expect(pair).toHaveLength(2)
      expect(busesConflict(pair[0], pair[1], 0)).toBe(false)
      for (const state of controller.inspectQueues({ includeMoving: true })) {
        if (!pair.some(v => v.id === state.id)) continue
        if (!second) initial.set(state.id, state.distanceM)
        // A reservation ending halfway through the bend used to strand these
        // two routes head-to-head by +82 s, without any body intersection.
        if (second === 180) expect(state.distanceM - initial.get(state.id)!, state.id).toBeGreaterThan(state.id === '73-1' ? 900 : 450)
      }
    }
  }, 30000)

  it.each(['08:00', '18:00'])('keeps the %s fleet separate and its waiting groups progressing for an hour at 60x', clock => {
    const controller = new BusTrafficController()
    const start = new Date(`2026-09-11T${clock}:00+08:00`).getTime()
    const history = new Map<number, Map<string, { distanceM: number; playhead: number }>>()
    let overlaps = 0, fleetSize = 0
    for (let second = 0; second <= 3600; second += 2) {
      // 2 simulated seconds per update corresponds to 60x at 30 uploads/sec.
      const vehicles = computeVehiclePositions(data, new Date(start + second * 1000), { busTraffic: controller })
      fleetSize = Math.max(fleetSize, vehicles.length)
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i]
        for (let j = i + 1; j < vehicles.length; j++) {
          // All public bus bodies here are under 12 m long. A loose 100 m
          // geographic rejection avoids running SAT for distant city blocks.
          if (Math.abs(v.coordinates[0] - vehicles[j].coordinates[0]) > .001 ||
              Math.abs(v.coordinates[1] - vehicles[j].coordinates[1]) > .001) continue
          if (busesConflict(v, vehicles[j], 0)) {
            overlaps++
            if (process.env.BUS_TRAFFIC_REPORT_DIR) writeFileSync(join(process.env.BUS_TRAFFIC_REPORT_DIR, `bus-collision-${clock.replace(':', '')}.json`), JSON.stringify({
              clock, second, pair: [v.id, vehicles[j].id], queues: controller.inspectQueues({ includeFuture: true }),
              checkpoint: { lastMs: controller['lastMs'], nextRequest: controller['nextRequest'], recoverySequence: controller['recoverySequence'],
                junctionOwners: [...controller['junctionOwners']].map(([key, owners]) => [key, [...owners]]),
                states: [...controller['states']].map(([id, value]) => [id, { ...value, plan: undefined, passageShapes: undefined }]),
              },
            }))
            expect(overlaps, `${clock}: body intersection at +${second}s: ${v.id}, ${vehicles[j].id}`).toBe(0)
          }
        }
      }
      if (second % 20 === 0) {
        if (process.env.BUS_TRAFFIC_REPORT_DIR && second % 60 === 0) writeFileSync(join(process.env.BUS_TRAFFIC_REPORT_DIR, 'bus-replay-progress.json'),
          JSON.stringify({ clock, second, fleetSize, overlaps }))
        const states = controller.inspectQueues({ includeMoving: true }), all = new Map(states.map(s => [s.id, s]))
        const waits = (state: typeof states[number]) => state.blockerIds.flatMap(id => all.has(id) ? [all.get(id)!] : [])
        const previous = history.get(second - 600)
        const recent = history.get(second - 20)
        history.set(second, new Map(states.map(s => [s.id, { distanceM: s.distanceM, playhead: s.playhead }])))
        history.delete(second - 620)
        if (!previous) continue
        // A queue can wait while its outlet drains. Watch every circular wait
        // AND every outlet, so an unrelated moving branch cannot hide a
        // locked cycle or an unreported stationary blocker. Every 20 seconds,
        // require real route progress over the preceding ten minutes; offset
        // adjustments and changes in waiting state do not count as progress.
        const groups = progressWaitGroups(states, waits)
        for (const group of groups) {
          if (group.some(s => !previous.has(s.id))) continue
          if (group.some(s => !s.blocked && s.speed > .2)) continue
          // A queue outlet that has just restarted has already resolved its
          // wait. Confirm route movement in the latest interval, rather than
          // failing it for the congestion that preceded that restart.
          if (group.some(s => recent?.has(s.id) && s.distanceM - recent.get(s.id)!.distanceM > 1)) continue
          // A bus can clear a queue and start an ordinary dwell within this
          // ten-minute window. Its route distance stays fixed while its stop
          // clock advances. Frozen or physically blocked stops remain checked.
          if (group.length === 1 && group[0].phase === 'stopped' && !group[0].blocked &&
              recent?.has(group[0].id) && group[0].playhead > recent.get(group[0].id)!.playhead + .001) continue
          const advanced = Math.max(...group.map(s => s.distanceM - previous.get(s.id)!.distanceM))
          const state = group[0]
          if (advanced <= 20) {
            if (process.env.BUS_TRAFFIC_REPORT_DIR) writeFileSync(join(process.env.BUS_TRAFFIC_REPORT_DIR, `bus-replay-${clock.replace(':', '')}.json`), JSON.stringify({
              clock, second, failed: state.id, group: group.map(s => s.id),
              queues: controller.inspectQueues({ includeFuture: true }),
              checkpoint: { lastMs: controller['lastMs'], nextRequest: controller['nextRequest'],
                recoverySequence: controller['recoverySequence'],
                junctionOwners: [...controller['junctionOwners']].map(([key, owners]) => [key, [...owners]]),
                states: [...controller['states']].map(([id, value]) => [id, { ...value, plan: undefined, passageShapes: undefined }]),
              },
            }))
          }
          expect(advanced, `${clock}: waiting group has no route progress by +${second}s: ${group.map(s => s.id).join(', ')}`).toBeGreaterThan(20)
        }
      }
    }
    expect(fleetSize).toBeGreaterThan(300)
    expect(overlaps, 'Bus body intersections across the entire fleet').toBe(0)
  }, 600000)
})
