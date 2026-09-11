/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Feature, LineString } from 'geojson'
import type { LRTLine, VehiclePosition } from './types'
import { getLrtTrack, LRT_DIRECTIONS, LRT_TRACK_OFFSET_M, offsetLrtCoordinates } from './lrtTracks'
import { buildLrtDoubleViaduct } from './lrtViaduct'
import { interpolateOnLineSmooth } from './engines/simulationEngine'
import { lrtArticulation } from './layers/lrtArticulation'
import { buildLrtFeatures } from './layers/lrtGeometry'

type Point = [number, number]
const lngM = 111320 * Math.cos(22.16 * Math.PI / 180)
const coordinate = ([x, y]: Point): Point => [113.57 + x / lngM, 22.16 + y / 111320]
const local = ([lng, lat]: number[]): Point => [(lng - 113.57) * lngM, (lat - 22.16) * 111320]
const line = (points: Point[]): Feature<LineString> => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(coordinate) } })

function envelope(source: Feature<LineString>, progress: number, lrtDirection: 'forward' | 'backward') {
  const pos = interpolateOnLineSmooth(getLrtTrack(source, lrtDirection), progress)
  const vehicle: VehiclePosition = {
    id: lrtDirection, lineId: 'test', type: 'lrt', color: '#80bd43', progress, lrtDirection,
    ...pos, bearing: pos.bearing + (lrtDirection === 'backward' ? 180 : 0),
  }
  const pose = lrtArticulation(vehicle, source)
  return {
    center: local(pos.coordinates), progress,
    polygons: buildLrtFeatures([vehicle], [pose]).flatMap(f => f.geometry.coordinates.map(([ring]) => ring.slice(0, -1).map(local))),
  }
}

// Separating-axis check of the actual articulated picking envelopes, which
// conservatively contain the rounded bodies, cabs and connecting accordion.
function overlaps(a: Point[], b: Point[]) {
  for (const ring of [a, b]) for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length]
    const nx = q[1] - p[1], ny = p[0] - q[0]
    const pa = a.map(([x, y]) => x * nx + y * ny), pb = b.map(([x, y]) => x * nx + y * ny)
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false
  }
  return true
}

function checkPassing(source: Feature<LineString>) {
  const coords = source.geometry.coordinates.map(local)
  const length = coords.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - coords[i][0], p[1] - coords[i][1]), 0)
  const samples = Math.ceil(length / 4)
  const cells = new Map<string, ReturnType<typeof envelope>[]>()
  for (let i = 0; i <= samples; i++) {
    const e = envelope(source, i / samples, 'backward')
    const key = `${Math.floor(e.center[0] / 80)}:${Math.floor(e.center[1] / 80)}`
    const cell = cells.get(key) ?? []
    cell.push(e); cells.set(key, cell)
  }
  for (let i = 0; i <= samples; i++) {
    const a = envelope(source, i / samples, 'forward')
    const x = Math.floor(a.center[0] / 80), y = Math.floor(a.center[1] / 80)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const b of cells.get(`${x + dx}:${y + dy}`) ?? []) {
        if (Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) > 70) continue
        if (a.polygons.some(pa => b.polygons.some(pb => overlaps(pa, pb)))) {
          throw new Error(`Opposing car envelopes overlap at forward=${a.progress}, backward=${b.progress}`)
        }
      }
    }
  }
}

describe('directional LRT tracks', () => {
  it('keeps opposing tracks on separate sides through termini and caches immutable geometry', () => {
    const source = line([[0, 0], [0, 200]]), original = structuredClone(source)
    const f = getLrtTrack(source, 'forward'), b = getLrtTrack(source, 'backward')
    expect(getLrtTrack(source, 'forward')).toBe(f)
    expect(getLrtTrack(source, 'backward')).toBe(b)
    for (const p of f.geometry.coordinates.map(local)) expect(p[0]).toBeCloseTo(-LRT_TRACK_OFFSET_M, 5)
    for (const p of b.geometry.coordinates.map(local)) expect(p[0]).toBeCloseTo(LRT_TRACK_OFFSET_M, 5)
    expect(source).toEqual(original)
    expect(offsetLrtCoordinates([[0, 0], [0, 0]], 7.5)).toEqual([[0, 0]])
  })

  it('builds two continuous guideways with no internal segment walls', () => {
    const source = line([[0, 0], [0, 100], [20, 150]])
    const polygons = buildLrtDoubleViaduct(source).geometry.coordinates
    expect(polygons).toHaveLength(2)
    for (const [ring] of polygons) {
      expect(ring).toHaveLength(7)
      expect(ring[0]).toEqual(ring.at(-1))
    }
  })

  it('bypasses a short reversed terminus stub without moving either endpoint along the route', () => {
    const source = line([[0, 0], [0, -6], [0, 100], [0, 206], [0, 200]])
    for (const direction of LRT_DIRECTIONS) {
      const points = getLrtTrack(source, direction).geometry.coordinates.map(local)
      expect(points).toHaveLength(3)
      expect(points[0][1]).toBeCloseTo(0, 5)
      expect(points.at(-1)![1]).toBeCloseTo(200, 5)
    }
    checkPassing(source)
  })

  it.each(['straight', 'left', 'right', 's'])('leaves passing clearance on %s geometry', kind => {
    const source = line(Array.from({ length: 241 }, (_, i): Point => {
      const a = (i - 120) / 100, y = i - 120
      if (kind === 'straight') return [0, y]
      if (kind === 's') return [25 * Math.sin(y / 40), y]
      return [(kind === 'left' ? -1 : 1) * 65 * (1 - Math.cos(a)), 65 * Math.sin(a)]
    }))
    checkPassing(source)
  })

  const routes = JSON.parse(readFileSync(resolve(__dirname, '../public/data/lrt-lines.json'), 'utf8')) as LRTLine[]
  it.each(routes)('leaves passing clearance along the full $id route', route => {
    for (const direction of LRT_DIRECTIONS) {
      expect(getLrtTrack(route.geometry, direction).geometry.coordinates.flat().every(Number.isFinite)).toBe(true)
    }
    checkPassing(route.geometry)
  })
})
