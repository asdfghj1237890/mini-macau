import { describe, expect, it } from 'vitest'
import type { VehiclePosition } from '../types'
import { BusPlayback } from './busPlayback'
import { BusTraceRecorder } from './busMotionTrace'
import { busesConflict } from './busTraffic'

const LNG_M = 111320 * Math.cos(22.19 * Math.PI / 180)
const vehicle = (id: string, x: number, y = 0, bearing = 90): VehiclePosition => ({
  id, lineId: id, type: 'bus', color: '#123456', scale: 1,
  coordinates: [113.54 + x / LNG_M, 22.19 + y / 111320], bearing, progress: x / 1000,
  busMotion: { dirSec: x, speedKmh: 36, phase: 'cruising', returning: false, delaySec: 0 },
})
const xy = (v: VehiclePosition) => [(v.coordinates[0] - 113.54) * LNG_M, (v.coordinates[1] - 22.19) * 111320]
function trace(frames: [number, VehiclePosition[]][]) {
  const recorder = new BusTraceRecorder()
  recorder.begin(frames[0][0])
  for (const [at, vehicles] of frames) {
    recorder.step(at)
    for (const v of vehicles) recorder.add(v, at)
  }
  return recorder.finish(frames.at(-1)![1], frames.at(-1)![0])
}
function start(vehicles: VehiclePosition[]) {
  const playback = new BusPlayback()
  playback.accept(vehicles, trace([[0, vehicles]]), 0, 0)
  playback.sample(0, 0)
  return playback
}

describe('checked bus presentation', () => {
  it('continues moving between slow worker replies without extrapolating beyond them', () => {
    const a = vehicle('a', 0), b = vehicle('a', 100)
    const playback = start([a])
    playback.accept([b], trace([[0, [a]], [2000, [b]]]), 200, 100)
    playback.sample(2000, 200)
    const first = playback.sample(3000, 300)[0]
    const second = playback.sample(3100, 310)[0]
    expect(xy(second)[0]).toBeGreaterThan(xy(first)[0])
    expect(xy(second)[0]).toBeLessThan(100)
    expect(xy(playback.sample(10000, 1000)[0])[0]).toBeCloseTo(100, 6)
  })

  it('follows intermediate route points instead of cutting a corner', () => {
    const a = vehicle('a', 0), corner = vehicle('a', 50), b = vehicle('a', 50, 50, 0)
    const playback = start([a])
    playback.accept([b], trace([[0, [a]], [500, [corner]], [1000, [b]]]), 1000, 1000)
    const result = playback.sample(1100, 1100)[0]
    expect(xy(result)[0]).toBeCloseTo(50, 6)
    expect(xy(result)[1]).toBeCloseTo(0, 6)
  })

  it('keeps the whole fleet clear if two individually clear endpoint paths cross between steps', () => {
    const a = [vehicle('a', -50), vehicle('b', 0, -50, 0)]
    const b = [vehicle('a', 50), vehicle('b', 0, 50, 0)]
    const playback = start(a)
    playback.accept(b, trace([[0, a], [1000, b]]), 1000, 1000)
    const result = playback.sample(1100, 1100)
    expect(result).toHaveLength(2)
    expect(busesConflict(result[0], result[1], 0)).toBe(false)
    expect(xy(result[0])[0]).toBeCloseTo(50, 6)
    expect(xy(result[1])[1]).toBeCloseTo(50, 6)
  })

  it('flushes and freezes a paused clock, clears seeks, and immediately removes ended vehicles', () => {
    const a = vehicle('a', 0), b = vehicle('a', 100)
    const playback = start([a])
    playback.accept([b], trace([[0, [a]], [2000, [b]]]), 200, 100)
    playback.sample(3000, 300)
    const paused = playback.sample(3000, 400)
    expect(paused).toEqual([b])
    expect(playback.sample(3000, 500)).toBe(paused)
    playback.accept([], trace([[2000, [b]], [3000, []]]), 500, 100)
    expect(playback.sample(3000, 600)).toEqual([])
    playback.clear()
    expect(playback.sample(1000, 700)).toEqual([])
  })

  it('does not freeze visible models for coarse marker paths outside the view', () => {
    const a = [vehicle('a', -50), vehicle('b', 0, -50, 0), vehicle('visible', 1000)]
    const b = [vehicle('a', 50), vehicle('b', 0, 50, 0), vehicle('visible', 1100)]
    const playback = start(a)
    playback.accept(b, trace([[0, a], [1000, b]]), 1000, 1000)
    const result = playback.sample(1100, 1100, 1, { trackedId: 'visible' })
    expect(xy(result.find(v => v.id === 'visible')!)[0]).toBeCloseTo(1050, 6)
    const tracked = start(a)
    tracked.accept(b, trace([[0, a], [1000, b]]), 1000, 1000)
    const guarded = tracked.sample(1100, 1100, 1, { trackedId: 'a' })
    expect(busesConflict(guarded[0], guarded[1], 0)).toBe(false)
  })

  it('does not render a new departure before its first checked point', () => {
    const a = vehicle('a', 0), b = vehicle('a', 100), newBus = vehicle('b', 0, 50)
    const playback = start([a])
    playback.accept([b, newBus], trace([[0, [a]], [1000, [b, newBus]]]), 1000, 1000)
    expect(playback.sample(1100, 1100).map(v => v.id)).toEqual(['a'])
  })
})
