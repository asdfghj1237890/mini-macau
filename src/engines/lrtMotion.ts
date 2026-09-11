export const LRT_MAX_SPEED_KMH = 80
const MAX_SPEED_MPS = LRT_MAX_SPEED_KMH / 3.6

export type LrtMotionPhase = 'stopped' | 'accelerating' | 'cruising' | 'braking'
export interface LrtMotionProfile {
  distanceM: number
  durationSec: number
  accelerationSec: number
  brakingSec: number
  cruiseMps: number
}

// Timetable endpoints are fixed. These are animation ramp durations, not
// measured vehicle specifications; braking is deliberately more gradual.
// Smoothstep velocity gives zero acceleration at start, cruise and arrival.
export function createLrtMotionProfile(distanceM: number, durationSec: number): LrtMotionProfile | null {
  if (!Number.isFinite(distanceM) || !Number.isFinite(durationSec) || distanceM < 0 || durationSec <= 0) return null
  if (distanceM === 0) return { distanceM, durationSec, accelerationSec: 0, brakingSec: 0, cruiseMps: 0 }
  // At or above the speed limit on average, a start/stop journey is impossible.
  // Do not silently overspeed or change a station time to make it fit.
  const rampBudget = durationSec - distanceM / MAX_SPEED_MPS
  if (rampBudget <= 1e-6) return null
  let accelerationSec = Math.min(20, durationSec * .4)
  let brakingSec = Math.min(24, durationSec * .4)
  // Each smooth ramp covers half the distance of cruising for the same time.
  const compression = Math.min(1, rampBudget / ((accelerationSec + brakingSec) / 2))
  accelerationSec *= compression
  brakingSec *= compression
  const cruiseMps = Math.min(MAX_SPEED_MPS, distanceM / (durationSec - (accelerationSec + brakingSec) / 2))
  return { distanceM, durationSec, accelerationSec, brakingSec, cruiseMps }
}

const smoothVelocity = (t: number) => t * t * (3 - 2 * t)
const integratedVelocity = (t: number) => t * t * t * (1 - t / 2)

export function sampleLrtMotion(profile: LrtMotionProfile, elapsedSec: number): {
  progress: number; speedKmh: number; phase: LrtMotionPhase
} {
  const { distanceM, durationSec, accelerationSec, brakingSec, cruiseMps } = profile
  if (elapsedSec <= 0 || distanceM === 0) return { progress: 0, speedKmh: 0, phase: 'stopped' }
  if (elapsedSec >= durationSec) return { progress: 1, speedKmh: 0, phase: 'stopped' }
  let positionM: number, speedMps: number, phase: LrtMotionPhase
  if (elapsedSec < accelerationSec) {
    const u = elapsedSec / accelerationSec
    positionM = cruiseMps * accelerationSec * integratedVelocity(u)
    speedMps = cruiseMps * smoothVelocity(u)
    phase = 'accelerating'
  } else if (elapsedSec > durationSec - brakingSec) {
    const u = (durationSec - elapsedSec) / brakingSec
    positionM = distanceM - cruiseMps * brakingSec * integratedVelocity(u)
    speedMps = cruiseMps * smoothVelocity(u)
    phase = 'braking'
  } else {
    positionM = cruiseMps * (elapsedSec - accelerationSec / 2)
    speedMps = cruiseMps
    phase = 'cruising'
  }
  return { progress: Math.max(0, Math.min(1, positionM / distanceM)), speedKmh: Math.min(LRT_MAX_SPEED_KMH, speedMps * 3.6), phase }
}
