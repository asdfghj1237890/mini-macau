import { describe, expect, it } from 'vitest'
import { BusTrafficController, busesConflict, type BusTrafficPlan } from './busTraffic'

// Two concentric lane courses, translated to a local origin from a public bus
// geometry replay. Columns are route metres, east, north, heading east/north.
// The inner bus must cover less distance while the outer bus clears its tail.
const courses = [
  [
    [0.0, 0.0, 0.0, -0.59513544, 0.80362542],
    [0.713565, -0.517241, 0.540442, -0.61139011, 0.79132935],
    [2.713565, -2.030535, 2.014866, -0.6531696, 0.75721164],
    [4.713565, -3.619263, 3.342199, -0.69852444, 0.7155862],
    [6.713565, -5.321847, 4.60927, -0.7406757, 0.67186272],
    [8.713565, -7.068178, 5.671251, -0.78664083, 0.61741089],
    [10.713565, -8.935994, 6.656694, -0.82735412, 0.56168066],
    [12.713565, -10.800106, 7.493058, -0.86229734, 0.5064023],
    [14.713565, -12.784089, 8.198776, -0.89665862, 0.44272263],
    [16.713565, -14.777455, 8.778084, -0.92413851, 0.38205762],
    [18.713565, -16.82908, 9.149346, -0.95198395, 0.30614792],
    [20.713565, -18.892171, 9.425037, -0.97051928, 0.2410235],
    [22.713565, -20.961592, 9.481523, -0.98694189, 0.16107672],
    [24.713565, -23.059834, 9.444087, -0.99566608, 0.0930003],
    [26.713565, -25.095927, 9.176351, -0.99995943, 0.00900798],
    [28.713565, -27.147394, 8.792287, -0.99789739, -0.06481363],
    [30.713565, -29.122897, 8.256752, -0.99024865, -0.13931123],
    [32.713565, -31.118503, 7.58442, -0.97787002, -0.20921332],
    [34.713565, -32.948155, 6.754364, -0.95809205, -0.28646052],
    [36.713565, -34.754281, 5.827018, -0.93615074, -0.35159891],
    [38.713565, -36.483618, 4.883977, -0.91689181, -0.39913584],
    [40.713565, -38.206632, 3.89229, -0.89967915, -0.43655174],
    [42.713565, -39.91873, 2.870822, -0.88532507, -0.46497261],
    [44.713565, -41.620197, 1.827383, -0.87362145, -0.48660617]
  ],
  [
    [0.0, 0.609482, -6.424634, -0.49573694, 0.86847273],
    [2.0, -0.470862, -4.935904, -0.52860761, 0.8488663],
    [4.0, -1.584674, -3.470097, -0.55600626, 0.8311781],
    [6.0, -2.841201, -2.125427, -0.60232794, 0.79824874],
    [8.0, -4.142514, -0.834349, -0.64148391, 0.76713649],
    [10.0, -5.552727, 0.361112, -0.68654785, 0.72708462],
    [12.0, -6.987084, 1.456968, -0.72616118, 0.6875245],
    [14.0, -8.540337, 2.419723, -0.77310897, 0.63427323],
    [16.0, -10.117193, 3.276086, -0.81284966, 0.58247354],
    [18.0, -11.807055, 4.059649, -0.84973535, 0.52720949],
    [20.0, -13.485474, 4.679861, -0.88419254, 0.46712263],
    [22.0, -15.231088, 5.216183, -0.91295698, 0.40805581],
    [24.0, -16.981793, 5.553982, -0.94225124, 0.33490686],
    [26.0, -18.786051, 5.826535, -0.96253737, 0.27114904],
    [28.0, -20.578522, 5.898758, -0.98127404, 0.19261689],
    [30.0, -22.38455, 5.903295, -0.99188637, 0.1271276],
    [32.0, -24.164212, 5.69069, -0.99909231, 0.04259762],
    [34.0, -25.941858, 5.390184, -0.99954878, -0.03003719],
    [36.0, -27.714727, 4.937589, -0.99428896, -0.10672146],
    [38.0, -29.42124, 4.398557, -0.98464908, -0.17454568],
    [40.0, -31.090073, 3.663432, -0.96668534, -0.25596767],
    [42.0, -32.763711, 2.832529, -0.94595921, -0.32428564],
    [44.0, -34.50654, 1.906314, -0.92554274, -0.37864316],
    [46.0, -36.227857, 0.934915, -0.90711401, -0.42088498]
  ]
]

describe('parallel bus convoy turns', () => {
  it('uses different forward paces instead of freezing both buses in a bend', () => {
    const traffic = new BusTrafficController(), key = {}
    const mx = 111320 * Math.cos(22.19 * Math.PI / 180)
    let seed = true
    const make = (index: number, time: number): BusTrafficPlan => ({ id: `turn-${index}`, routeKey: key, elapsedSec: time, arrivalAgeSec: 0,
      sample: at => {
        const distanceM = Math.max(0, at * 3), course = courses[index]
        const end = course.findIndex(p => p[0] >= distanceM)
        let x: number, y: number, fx: number, fy: number
        if (end < 0) {
          const p = course.at(-1)!, extra = distanceM - p[0]
          x = p[1] + extra * p[3]; y = p[2] + extra * p[4]; fx = p[3]; fy = p[4]
        } else {
          const p = course[Math.max(0, end - 1)], q = course[end]
          const f = q[0] === p[0] ? 0 : (distanceM - p[0]) / (q[0] - p[0])
          x = p[1] + (q[1] - p[1]) * f; y = p[2] + (q[2] - p[2]) * f
          fx = p[3] + (q[3] - p[3]) * f; fy = p[4] + (q[4] - p[4]) * f
        }
        return { distanceM, laneAllowance: { leftM: 0, rightM: 0 }, vehicle: {
          id: `turn-${index}`, lineId: 'test', type: 'bus', color: '#fff', scale: .5, progress: distanceM / 100,
          coordinates: [113.54 + (x + (seed ? index * 100 : 0)) / mx, 22.19 + y / 111320], bearing: Math.atan2(fx, fy) * 180 / Math.PI,
          busMotion: { phase: 'cruising', dirSec: at, returning: false, speedKmh: 10.8, delaySec: 0 },
        } }
      },
    })
    traffic.sample([make(0, 0), make(1, 0)], 0)
    seed = false
    for (const [id, state] of traffic['states']) {
      state.pose = state.plan.sample(0); state.speed = 0; state.stalledSec = 3; state.blocked = true
      state.leaderId = id === 'turn-0' ? 'turn-1' : 'turn-0'
    }
    let unequal = false
    for (let time = .5; time <= 30; time += .5) {
      const vehicles = traffic.sample([make(0, time), make(1, time)], time * 1000)
      expect(vehicles).toHaveLength(2)
      expect(busesConflict(vehicles[0], vehicles[1], 0)).toBe(false)
      unequal ||= Math.abs(vehicles[0].progress - vehicles[1].progress) > .005
    }
    expect(unequal).toBe(true)
    expect(traffic.inspectQueues({ includeMoving: true }).every(s => s.distanceM > 20)).toBe(true)
  })
})
