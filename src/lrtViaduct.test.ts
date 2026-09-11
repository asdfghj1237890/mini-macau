/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LRTLine } from './types'
import { buildLrtViaduct } from './lrtViaduct'

type Point = [number, number]
const lngUnit = 111320 * Math.cos(22.16 * Math.PI / 180)
const coordinate = ([x, y]: Point): Point => [113.57 + x / lngUnit, 22.16 + y / 111320]
const local = ([lng, lat]: number[]): Point => [(lng - 113.57) * lngUnit, (lat - 22.16) * 111320]
const line = (points: Point[]): GeoJSON.LineString => ({ type: 'LineString', coordinates: points.map(coordinate) })

describe('continuous LRT viaduct', () => {
  it('joins a right-angle bend at shared offset intersections, preserving track width', () => {
    const corridor = buildLrtViaduct(line([[0, 0], [0, 100], [100, 100]]), 3.5)
    expect(corridor.geometry.coordinates).toHaveLength(1)
    const ring = corridor.geometry.coordinates[0][0].map(local)
    const expected: Point[] = [[3.5, 0], [3.5, 96.5], [100, 96.5], [100, 103.5], [-3.5, 103.5], [-3.5, 0], [3.5, 0]]
    expect(ring).toHaveLength(expected.length)
    ring.forEach((p, i) => p.forEach((value, j) => expect(value).toBeCloseTo(expected[i][j], 5)))
    const area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2
    expect(area).toBeCloseTo(200 * 7, 4)
  })

  it('has only an outer perimeter along a densely sampled curve, with no internal end walls', () => {
    const arc: Point[] = Array.from({ length: 81 }, (_, i) => [70 * (1 - Math.cos(i / 80)), 70 * Math.sin(i / 80)])
    const corridor = buildLrtViaduct(line(arc), 3.5)
    expect(corridor.geometry.coordinates).toHaveLength(1)
    expect(corridor.geometry.coordinates[0]).toHaveLength(1)
    const ring = corridor.geometry.coordinates[0][0].map(local)
    expect(ring).toHaveLength(arc.length * 2 + 1)
    expect(ring[0]).toEqual(ring.at(-1))
    // Only the two terminus edges cross the track width; all other edges
    // follow the left or right boundary instead of closing each segment.
    for (let i = 0; i < arc.length - 1; i++) {
      expect(Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1])).toBeLessThan(1.1)
    }
  })

  it('ignores repeated points and handles collapsed or sharply turning input without invalid vertices', () => {
    expect(buildLrtViaduct(line([[0, 0], [0, 0], [0, 100]]), 3.5)).toEqual(buildLrtViaduct(line([[0, 0], [0, 100]]), 3.5))
    for (const points of [[], [[0, 0]], [[0, 0], [0, 0]]] as Point[][]) {
      expect(buildLrtViaduct(line(points), 3.5).geometry.coordinates).toEqual([])
    }
    const source: Point[] = [[0, 0], [0, 100], [.1, 0]]
    const ring = buildLrtViaduct(line(source), 3.5).geometry.coordinates[0][0].map(local)
    expect(ring.flat().every(Number.isFinite)).toBe(true)
    expect(Math.hypot(ring[1][0], ring[1][1] - 100)).toBeLessThanOrEqual(10.5001)
  })

  it('builds a finite closed perimeter for each published LRT route', () => {
    const lines = JSON.parse(readFileSync(resolve(__dirname, '../public/data/lrt-lines.json'), 'utf8')) as LRTLine[]
    for (const route of lines) {
      const result = buildLrtViaduct(route.geometry, 3.5)
      expect(result.geometry.coordinates, route.id).toHaveLength(1)
      const [ring] = result.geometry.coordinates[0]
      expect(ring[0], route.id).toEqual(ring.at(-1))
      expect(ring.flat().every(Number.isFinite), route.id).toBe(true)
    }
  })
})
