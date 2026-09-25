import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { attachBusJunctions } from './busJunctions'
import type { BusRoute, BusStop, TransitData } from '../types'
import { sampleBusPose, computeBusOnly } from './simulationEngine'
import { BusTrafficController, busesConflict } from './busTraffic'
import { BusTrafficScope } from './busTrafficScope'
import { BusTraceRecorder } from './busMotionTrace'
import { busLaneLayout } from './busLaneGeometry'

const routes: BusRoute[] = JSON.parse(readFileSync(new URL('../../public/data/bus-routes.json', import.meta.url), 'utf8'))
attachBusJunctions(routes, JSON.parse(readFileSync(new URL('../../public/data/bus-junctions.json', import.meta.url), 'utf8')))
const stops: BusStop[] = JSON.parse(readFileSync(new URL('../../public/data/bus-stops.json', import.meta.url), 'utf8'))
const mx = 111320 * Math.cos(22.19 * Math.PI / 180)
const distance = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * mx, (a[1] - b[1]) * 111320)

describe('Amaral terminal routing', () => {
  it('places each platform visit beside its own stop pole on its assigned lane', () => {
    const platforms = new Map(stops.filter(s => s.id.startsWith('M172/')).map(s => [s.id, s]))
    expect(platforms.size).toBe(17)
    let visits = 0
    for (const route of routes) {
      const coords = route.geometry.geometry.coordinates, cumulative = [0]
      for (let i = 1; i < coords.length; i++) cumulative.push(cumulative[i - 1] + distance(coords[i - 1], coords[i]))
      route.stopsForward.forEach((id, i) => {
        const stop = platforms.get(id)
        if (!stop) return
        visits++
        const at = route.stopOffsets[i]
        const road = route.roadProfile!.sections.find(s => at >= s.start && at < s.end) ?? route.roadProfile!.sections.at(-1)!
        expect(road.lanePath, `${route.id} ${id}`).toBe(`amaral/${stop.platform![0]}`)
        expect(busLaneLayout(road).offsets).toEqual([0])
        expect(distance(coords[at], stop.coordinates), `${route.id} ${id} path`).toBeLessThan(2)
        const pose = sampleBusPose(route.geometry, cumulative[at] / cumulative.at(-1)!, false, route.roadProfile)
        expect(distance(pose.coordinates, stop.coordinates), `${route.id} ${id} body`).toBeLessThan(4)
      })
    }
    expect(visits).toBeGreaterThan(50)
  })

  it('keeps Sunday afternoon traffic collision-free through the terminal and its approaches', () => {
    const traffic = new BusTrafficController(), scope = new BusTrafficScope(traffic)
    const view = { bounds: [113.5418, 22.187, 113.5453, 22.1915] as [number, number, number, number] }
    const data = { busRoutes: routes, busStops: stops } as TransitData
    const start = Date.parse('2026-09-13T15:50:00+08:00')
    let samples = 0, movingLate = 0
    for (let second = 0; second <= 600; second += 2) {
      computeBusOnly(data, new Date(start + second * 1000), { sample: (plans, time) => scope.sample(plans, time, view, new BusTraceRecorder(view)) })
      const buses = traffic.currentVehicles()
      for (let i = 0; i < buses.length; i++) for (let j = i + 1; j < buses.length; j++) {
        if (distance(buses[i].coordinates, buses[j].coordinates) > 30) continue
        expect(busesConflict(buses[i], buses[j], 0), `${second}s ${buses[i].id}/${buses[j].id}`).toBe(false)
      }
      samples += buses.length
      // The busiest instant of the second half: one instant alone swings with
      // the timetable (a route data change left 3 buses at +600 s while +180 s
      // had 8 and +420 s had 6, with the box empty at +540 s).
      if (second >= 300) movingLate = Math.max(movingLate, buses.filter(v => v.coordinates[0] > 113.5427 && v.coordinates[0] < 113.5443 &&
        v.coordinates[1] > 22.1876 && v.coordinates[1] < 22.1900 && (v.busMotion?.speedKmh ?? 0) > 2).length)
    }
    // Fewer buses linger in the scope now that the terminal keeps moving;
    // the bound only guards against an empty or collapsed replay.
    expect(samples).toBeGreaterThan(3000)
    expect(movingLate).toBeGreaterThan(3)
  }, 60000)
})
