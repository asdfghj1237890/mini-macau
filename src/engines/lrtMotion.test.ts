import { describe, expect, it } from 'vitest'
import { createLrtMotionProfile, LRT_MAX_SPEED_KMH, sampleLrtMotion } from './lrtMotion'

describe('LRT motion with fixed timetable endpoints', () => {
  it.each([[1200, 120], [1200, 60], [60, 30], [3000, 240]])(
    'covers %i metres in exactly %i seconds, with no overspeed or backwards motion', (distance, duration) => {
      const profile = createLrtMotionProfile(distance, duration)!
      expect(profile).not.toBeNull()
      expect(sampleLrtMotion(profile, 0)).toEqual({ progress: 0, speedKmh: 0, phase: 'stopped' })
      expect(sampleLrtMotion(profile, duration)).toEqual({ progress: 1, speedKmh: 0, phase: 'stopped' })
      let previous = 0
      for (let i = 1; i < 1000; i++) {
        const t = duration * i / 1000
        const state = sampleLrtMotion(profile, t)
        expect(state.progress).toBeGreaterThanOrEqual(previous)
        expect(state.progress).toBeLessThanOrEqual(1)
        expect(state.speedKmh).toBeGreaterThanOrEqual(0)
        expect(state.speedKmh).toBeLessThanOrEqual(LRT_MAX_SPEED_KMH)
        // Independently differentiate travelled distance: the label must match
        // the movement itself, rather than merely capping a reported speed.
        const dt = .0001
        const delta = sampleLrtMotion(profile, t + dt).progress - sampleLrtMotion(profile, t - dt).progress
        expect(delta * distance / (2 * dt) * 3.6).toBeCloseTo(state.speedKmh, 4)
        previous = state.progress
      }
    },
  )

  it('joins departure, cruise, braking and arrival without velocity or acceleration jumps', () => {
    const profile = createLrtMotionProfile(1200, 120)!
    const dt = .001
    for (const t of [0, profile.accelerationSec, 120 - profile.brakingSec, 120]) {
      const before = sampleLrtMotion(profile, t - dt)
      const here = sampleLrtMotion(profile, t)
      const after = sampleLrtMotion(profile, t + dt)
      expect(Math.abs(after.speedKmh - before.speedKmh)).toBeLessThan(.001)
      const accelerationBefore = (here.speedKmh - before.speedKmh) / dt / 3.6
      const accelerationAfter = (after.speedKmh - here.speedKmh) / dt / 3.6
      expect(Math.abs(accelerationBefore - accelerationAfter)).toBeLessThan(.001)
    }
    expect(sampleLrtMotion(profile, 5).phase).toBe('accelerating')
    expect(sampleLrtMotion(profile, 60).phase).toBe('cruising')
    expect(sampleLrtMotion(profile, 115).phase).toBe('braking')
  })

  it('uses up to 80 km/h when a tighter timetable needs it', () => {
    const profile = createLrtMotionProfile(1200, 60)!
    expect(sampleLrtMotion(profile, 30).speedKmh).toBeCloseTo(80, 8)
    expect(sampleLrtMotion(profile, 59.999).progress).toBeCloseTo(1, 8)
  })

  it.each([[2000, 60], [80000, 3600], [-1, 60], [100, 0], [100, -1], [Infinity, 10], [100, NaN]])(
    'rejects infeasible or invalid inputs (%s m, %s s) instead of shifting station times', (distance, duration) => {
      expect(createLrtMotionProfile(distance, duration)).toBeNull()
    },
  )

  it('keeps coincident stations stationary without division by zero', () => {
    const profile = createLrtMotionProfile(0, 60)!
    for (const t of [0, 15, 60]) expect(sampleLrtMotion(profile, t).speedKmh).toBe(0)
  })
})
