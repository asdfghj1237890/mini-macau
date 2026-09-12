import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BusRoute, BusStop } from '../types'
import { BusWorkerRuntime } from './busWorkerRuntime'
import { BusTrafficController } from './busTraffic'
import { computeBusOnly } from './simulationEngine'

const routes: BusRoute[] = JSON.parse(readFileSync(new URL('../../public/data/bus-routes.json', import.meta.url), 'utf8'))
const stops: BusStop[] = JSON.parse(readFileSync(new URL('../../public/data/bus-stops.json', import.meta.url), 'utf8'))

describe('bus worker replay', () => {
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
})
