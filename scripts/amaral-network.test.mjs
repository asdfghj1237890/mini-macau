import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildAmaralNetwork, streetGraph, findPath, key } from './amaral-network.mjs'
import { patchAmaral } from './patch-amaral-terminal.mjs'
const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const source = load('../data/bus_reference/amaral-terminal.json')

describe('terminal data generation', () => {
  it('connects every platform in its directed lane to an entrance and exit', () => {
    const { ways, platforms } = buildAmaralNetwork(source), edges = streetGraph(ways)
    const north = [113.5431366, 22.1896628], south = [113.5433492, 22.1889906]
    for (const p of platforms.values()) {
      expect(findPath(edges, north, p.vehiclePoint).at(-1)).toEqual(p.vehiclePoint)
      const exit = south
      expect(findPath(edges, p.vehiclePoint, exit)[0]).toEqual(p.vehiclePoint)
      expect(edges.some(e => key(e.a) === key(p.vehiclePoint) || key(e.b) === key(p.vehiclePoint))).toBe(true)
    }
    expect(ways.some(w => w.tags.tunnel)).toBe(false)
  })
  it('does not change a generated route again, or create stops on through services', () => {
    const routes = load('../public/data/bus-routes.json'), stops = load('../public/data/bus-stops.json')
    const before = structuredClone(routes)
    expect(patchAmaral(routes, stops, source, load('../data/bus_reference/amaral-route-paths.json'))).toEqual([])
    expect(routes).toEqual(before)
    for (const id of ['102', 'H3']) expect(routes.find(r => r.id === id).stopsForward.some(s => s.startsWith('M172/'))).toBe(false)
  })
  it('takes route 33 through the terminal twice without extra diagonal passes or roundabout loops', () => {
    const route = load('../public/data/bus-routes.json').find(r => r.id === '33')
    const inside = p => p[0] > 113.5424 && p[0] < 113.5443 && p[1] > 22.1876 && p[1] < 22.1902
    const coords = route.geometry.geometry.coordinates
    expect(coords.filter((p, i) => inside(p) && (!i || !inside(coords[i - 1])))).toHaveLength(2)
    expect(route.stopsForward.filter(id => id.startsWith('M172/'))).toEqual(['M172/11', 'M172/3'])
  })
  it('routes G16 east along the roundabout, away from the northbound tunnel exit', () => {
    const { ways, platforms } = buildAmaralNetwork(source)
    const path = findPath(streetGraph(ways), platforms.get(16).vehiclePoint, [113.5433492,22.1889906])
    expect(path.every(p => p[1] < 22.18905)).toBe(true)
    expect(path.at(-1)[0]).toBeGreaterThan(path[0][0])
  })
  it('keeps 39/MT2 returns and the 102/H3 through services outside the platform islands', () => {
    const routes = load('../public/data/bus-routes.json')
    const core = p => p[0] > 113.54310 && p[0] < 113.54358 && p[1] > 22.18918 && p[1] < 22.18960
    for (const id of ['39', 'MT2', '102', 'H3']) {
      const route = routes.find(r => r.id === id)
      // 39 calls at D10 outbound. Check the journey after the next Taipa stop.
      const call = route.stopsForward.findIndex(id => id.startsWith('M172/'))
      const from = call < 0 ? 0 : route.stopOffsets[call + 1]
      const points = route.geometry.geometry.coordinates.slice(from)
      for (let i = 1; i < points.length; i++) {
        for (let j = 0; j <= 10; j++) expect(core(points[i].map((v, k) => v + (points[i - 1][k] - v) * j / 10)), id).toBe(false)
      }
    }
  })
  it('keeps MT2 adjacent stop locations while replacing the misplaced approach vertex', () => {
    const route = load('../public/data/bus-routes.json').find(r => r.id === 'MT2')
    expect(route.geometry.geometry.coordinates[route.stopOffsets[2]]).toEqual([113.548399, 22.16412])
    expect(route.stopsForward.slice(0, 3)).toEqual(['M268', 'M172/12', 'T330/4'])
    const inside = p => p[0] > 113.5424 && p[0] < 113.5443 && p[1] > 22.1876 && p[1] < 22.1902
    const coords = route.geometry.geometry.coordinates
    expect(coords.filter((p, i) => inside(p) && (!i || !inside(coords[i - 1])))).toHaveLength(2)
  })
  it('matches all three 25AX terminal visits without altering its concatenated service stops', () => {
    const route = load('../public/data/bus-routes.json').find(r => r.id === '25AX')
    expect(route.stopsForward).toEqual(['C690/2', 'C689/2', 'T376/2', 'T363/2', 'T311/1', 'T308/1',
      'M172/16', 'M64', 'M9/3', 'M50', 'M172/14', 'T403', 'T309', 'T375', 'T380', 'C690/2',
      'C690/2', 'C689/2', 'T376/2', 'T363/2', 'T311/1', 'T308/1', 'M172/16', 'M64', 'M9/5'])
    const inside = p => p[0] > 113.5424 && p[0] < 113.5443 && p[1] > 22.1876 && p[1] < 22.1902
    const coords = route.geometry.geometry.coordinates
    expect(coords.filter((p, i) => inside(p) && (!i || !inside(coords[i - 1])))).toHaveLength(3)
  })
})
