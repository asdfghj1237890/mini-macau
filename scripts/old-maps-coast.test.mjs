import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Exercise the builder's actual deformation without running its download/render
// entry point. Synthetic identity coordinates use kilometres and source pixels.
const builder = fs.readFileSync(new URL('./build-old-maps.mjs', import.meta.url), 'utf8')
const coastFunction = builder.slice(builder.indexOf('function buildCoastSnap('), builder.indexOf('async function warp('))
function syntheticSnap(axis) {
  const data = { stretches: [{ samples: [[-50, 0, 0, 0]] }] }
  const load = new Function('fs', 'path', 'ROOT', 'CACHE', 'toXY', 'toLL', 'console', 'process', `${coastFunction}; return buildCoastSnap`)
  const snap = load({ readFileSync: () => JSON.stringify(data) }, path, '.', '.', (x, y) => [x, y], (x, y) => [x, y], { log() {} }, { env: {} })
  const guard = axis === 'north' ? [0, 0.8] : axis === 'south' ? [0, -0.8] : axis === 'east' ? [0.8, 0] : [-0.8, 0]
  return {
    ...snap({ id: 'synthetic', source: {}, coastSnap: { steps: 1, radiusM: 1000, cellM: 10 } },
      [{ name: 'fixed landmark', lng: guard[0], lat: guard[1] }], x => x * 1000, (_x, y) => -y * 1000),
    guard,
  }
}

describe('coast deformation field continuity', () => {
  it.each(['north', 'south', 'east', 'west'])('keeps the field continuous beyond the shore toward a %s landmark', axis => {
    const snap = syntheticSnap(axis)
    const vertical = axis === 'north' || axis === 'south', sign = axis === 'north' || axis === 'east' ? 1 : -1
    const a = vertical ? [0, sign * (1 - 1e-6)] : [sign * (1 - 1e-6), 0]
    const b = vertical ? [0, sign * (1 + 1e-6)] : [sign * (1 + 1e-6), 0]
    const p = snap.undo(...a), q = snap.undo(...b)
    // Crossing the former coast-only field edge by 2 mm cannot jump centimetres.
    expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-5)
    const guard = snap.undo(...snap.guard)
    expect(Math.hypot(guard[0] - snap.guard[0], guard[1] - snap.guard[1])).toBeLessThan(1e-6)
    expect(snap.undo(3, 3)).toEqual([3, 3])
  })
})
