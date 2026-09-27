import { describe, expect, it } from 'vitest'
import { HIKER_HEIGHT_M, createHikerMesh, createPhotographerMesh } from './hikerMesh'
import { besideOnScreen, hikerScale } from './TrailFigure3DLayer'

const FLOATS = 10 // position, normal, RGB + livery weight

describe('createHikerMesh', () => {
  const mesh = createHikerMesh()
  const vertices = Array.from({ length: mesh.length / FLOATS }, (_, i) => mesh.subarray(i * FLOATS, i * FLOATS + FLOATS))

  it('is whole triangles of finite numbers with unit normals', () => {
    expect(mesh.length % (FLOATS * 3)).toBe(0)
    expect(mesh.every(Number.isFinite)).toBe(true)
    for (const v of vertices) expect(Math.hypot(v[3], v[4], v[5])).toBeCloseTo(1, 5)
  })

  it('stands on the ground at about 1.78 m, facing +Y', () => {
    const zs = vertices.map(v => v[2])
    expect(Math.min(...zs)).toBeCloseTo(0, 5)
    expect(Math.max(...zs)).toBeGreaterThan(HIKER_HEIGHT_M - 0.05)
    expect(Math.max(...zs)).toBeLessThan(HIKER_HEIGHT_M + 0.05)
    // The pole is planted ahead and the pack hangs behind.
    expect(Math.max(...vertices.map(v => v[1]))).toBeGreaterThan(0.45)
    expect(Math.min(...vertices.map(v => v[1]))).toBeLessThan(-0.35)
  })

  it('colours only the jacket with the per-instance colour', () => {
    const livery = vertices.filter(v => v[9] === 1)
    expect(livery.length).toBeGreaterThan(0)
    expect(livery.length).toBeLessThan(vertices.length / 2)
    expect(vertices.every(v => v[9] === 0 || v[9] === 1)).toBe(true)
  })
})

describe('createPhotographerMesh', () => {
  const mesh = createPhotographerMesh()
  const vertices = Array.from({ length: mesh.length / FLOATS }, (_, i) => mesh.subarray(i * FLOATS, i * FLOATS + FLOATS))
  const isGlass = (v: Float32Array) => Math.abs(v[6] - .2) < 1e-6 && Math.abs(v[7] - .36) < 1e-6 && Math.abs(v[8] - .58) < 1e-6

  it('is the same 1.78 m figure standing on the ground', () => {
    expect(mesh.every(Number.isFinite)).toBe(true)
    const zs = vertices.map(v => v[2])
    expect(Math.min(...zs)).toBeCloseTo(0, 5)
    expect(Math.max(...zs)).toBeCloseTo(HIKER_HEIGHT_M, 2)
  })

  it('holds the camera up in one hand, in front of the right eye, lens forward', () => {
    const glass = vertices.filter(isGlass)
    expect(glass.length).toBeGreaterThan(0)
    // The eyes are at about 80 % of the figure's height; the right eye at +X.
    for (const v of glass) {
      expect(v[2] / HIKER_HEIGHT_M).toBeGreaterThan(.72)
      expect(v[2] / HIKER_HEIGHT_M).toBeLessThan(.9)
      expect(v[1]).toBeGreaterThan(.45)
      expect(v[0]).toBeGreaterThan(.05)
      expect(v[0]).toBeLessThan(.35)
    }
  })

  it('has no trekking pole reaching the ground ahead', () => {
    const ahead = vertices.filter(v => v[1] > .3 && v[2] < .3)
    expect(ahead.length).toBeLessThan(vertices.length * .02)
  })
})

describe('besideOnScreen', () => {
  const top: [number, number] = [113.5659, 22.1588]
  const metresBetween = (a: [number, number], b: [number, number]) =>
    Math.hypot((a[0] - b[0]) * 111_320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110_574)

  it('moves a figure to the left of the screen, whichever way the map is turned', () => {
    // North up: left is west.
    const northUp = besideOnScreen(top, 6, 0)
    expect(northUp[0]).toBeLessThan(top[0])
    expect(northUp[1]).toBeCloseTo(top[1], 7)
    // East up: left is north.
    const eastUp = besideOnScreen(top, 6, 90)
    expect(eastUp[1]).toBeGreaterThan(top[1])
    expect(eastUp[0]).toBeCloseTo(top[0], 7)
    expect(metresBetween(top, northUp)).toBeCloseTo(6, 3)
    expect(metresBetween(top, eastUp)).toBeCloseTo(6, 3)
  })
})

describe('hikerScale', () => {
  it('keeps roughly the same on-screen size, never below life size', () => {
    expect(hikerScale(19)).toBeCloseTo(3.7)
    expect(hikerScale(18)).toBeCloseTo(7.4)
    expect(hikerScale(22)).toBe(1)
    expect(hikerScale(Number.NaN)).toBe(1)
  })
})
