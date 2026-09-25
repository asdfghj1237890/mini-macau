import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { attachBusJunctions } from './busJunctions'
import type { BusRoute, BusStop } from '../types'
import { BusWorkerRuntime } from './busWorkerRuntime'
import { BusTrafficController } from './busTraffic'
import { computeBusOnly } from './simulationEngine'
import { BusPlayback } from './busPlayback'
import { busesConflict } from './busTraffic'

const routes: BusRoute[] = JSON.parse(readFileSync(new URL('../../public/data/bus-routes.json', import.meta.url), 'utf8'))
attachBusJunctions(routes, JSON.parse(readFileSync(new URL('../../public/data/bus-junctions.json', import.meta.url), 'utf8')))
const stops: BusStop[] = JSON.parse(readFileSync(new URL('../../public/data/bus-stops.json', import.meta.url), 'utf8'))

describe('bus worker replay', () => {
  it.each([4, 8])('presents intermediate checked poses through real Taipa bends with %is batches at 60×', interval => {
    const runtime = new BusWorkerRuntime(), playback = new BusPlayback()
    const selected = routes.filter(r => ['73', 'MT1', '21A'].includes(r.id))
    const start = new Date('2026-09-11T18:00:00+08:00').getTime()
    let previous = '', updates = 0
    for (let second = 0; second <= 120; second += interval) {
      const simMs = start + second * 1000, at = second / 60 * 1000 + 120
      const reply = runtime.sample({ id: second, epoch: 0, simMs, reset: false,
        routes: second === 0 ? selected.map((r, key) => [key, r]) : undefined,
        routeKeys: second === 0 ? selected.map((_, key) => key) : undefined,
        stops: second === 0 ? stops : undefined, view: { bounds: [113.5, 22.1, 113.6, 22.22] } })
      playback.accept(reply.vehicles, reply.trace, at, 120)
      for (let frame = 0; frame < interval; frame++) {
        const vehicles = playback.sample(simMs + 7200 + frame * 1000, at + frame * 1000 / 60)
        for (let i = 0; i < vehicles.length; i++) for (let j = i + 1; j < vehicles.length; j++) {
          expect(busesConflict(vehicles[i], vehicles[j], 0), `${vehicles[i].id}/${vehicles[j].id}`).toBe(false)
        }
        const key = vehicles.map(v => v.coordinates.join(',')).join(';')
        if (key !== previous) updates++
        previous = key
      }
    }
    expect(updates).toBeGreaterThan(60)
  }, 10000)
  it('retains traffic playheads and catches up in bounded jobs after a slow reply', () => {
    const runtime = new BusWorkerRuntime(), selected = routes.slice(0, 3)
    const start = new Date('2026-09-11T08:00:00+08:00').getTime()
    runtime.sample({ id: 1, epoch: 0, simMs: start, reset: false,
      routes: selected.map((r, key) => [key, r]), routeKeys: selected.map((_, i) => i), stops })
    const before = [...runtime['traffic']['states'].values()][0]
    const reply = runtime.sample({ id: 2, epoch: 0, simMs: start + 16000, reset: false })
    expect(runtime['traffic']['states'].get(before.plan.id)).toBe(before)
    expect(reply.trace?.startMs).toBe(start)
    expect(reply.simMs).toBe(start + 8000)
    expect(reply.trace?.steps.at(-1)).toBe(reply.simMs)
    const caughtUp = runtime.sample({ id: 3, epoch: 0, simMs: start + 16000, reset: false })
    expect(caughtUp.trace?.startMs).toBe(reply.simMs)
    expect(caughtUp.simMs).toBe(start + 16000)
    runtime.sample({ id: 3, epoch: 1, simMs: start + 21000, reset: true })
    expect(runtime['traffic']['states'].get(before.plan.id)).not.toBe(before)
  })
  it('matches synchronous traffic exactly, including a visibility change and clock seek', () => {
    const runtime = new BusWorkerRuntime()
    const traffic = new BusTrafficController()
    const selected = routes.slice(0, 3)
    const data = { busRoutes: selected, busStops: stops }
    const start = new Date('2026-09-11T08:00:00+08:00').getTime()
    for (let i = 0; i < 80; i++) {
      const simMs = start + (i < 60 ? i : i - 60) * 500
      const changed = i === 30 || i === 45
      if (changed) data.busRoutes = i === 30 ? selected.slice(1) : selected
      const reply = runtime.sample({ id: i, epoch: 0, simMs, reset: false,
        routes: i === 0 ? structuredClone(selected.map((r, key) => [key, r])) : undefined,
        routeKeys: i === 0 || changed ? data.busRoutes.map(r => selected.indexOf(r)) : undefined,
        stops: i === 0 ? structuredClone(stops) : undefined,
      })
      expect(reply.vehicles).toEqual(computeBusOnly(data, new Date(simMs), traffic))
    }
  })
  it('keeps overview traces continuous during bounded catch-up after a long stall', () => {
    const runtime = new BusWorkerRuntime(), selected = routes.slice(0, 3)
    const start = new Date('2026-09-11T08:00:00+08:00').getTime()
    runtime.sample({ id: 1, epoch: 0, simMs: start, reset: false,
      routes: selected.map((r, key) => [key, r]), routeKeys: selected.map((_, i) => i), stops, view: {} })
    const reply = runtime.sample({ id: 2, epoch: 0, simMs: start + 60000, reset: false, view: {} })
    expect(reply.trace?.startMs).toBe(start)
    expect(reply.simMs).toBe(start + 8000)
    expect(reply.vehicles.length).toBeGreaterThan(0)
    expect(reply.trace?.paths.every(p => p.points[0] === start)).toBe(true)
  })
})
