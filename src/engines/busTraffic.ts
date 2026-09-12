import type { VehiclePosition } from '../types'
import { BUS_HALF_LENGTH_M } from '../layers/busMesh'
import type { BusPassage } from './busJunctions'
import { closedWaitGroups, waitsForGroup } from './busWaitGroups'
import type { BusTraceRecorder } from './busMotionTrace'

export interface BusTrafficSample {
  vehicle: VehiclePosition
  // Additional clearance measured from the planned lane, never including
  // opposing lanes or the neighbouring carriageway.
  laneAllowance?: { leftM: number; rightM: number }
  // Monotonic distance, including completed circuits and the return leg.
  distanceM: number
}
export interface BusTrafficPlan {
  id: string
  routeKey: object
  elapsedSec: number
  arrivalAgeSec: number
  sample: (elapsedSec: number) => BusTrafficSample
  distanceAt?: (elapsedSec: number) => number
  passageAt?: (distanceM: number) => BusPassage | undefined
}
type State = {
  plan: BusTrafficPlan
  playhead: number
  nominal: number
  pose: BusTrafficSample
  speed: number
  active: boolean
  blocked: boolean
  leaderId?: string
  offsetX: number
  offsetY: number
  stalledSec: number
  rejoinAfterM: number
  passage?: BusPassage
  requestOrder: number
  requestUntilM?: number
  waitingFor?: string
  waitReason?: string
  exitPose?: { distanceM: number; pose: BusTrafficSample }
  cautiousUntilM?: number
  path?: { distanceM: number; body: Body }[]
  pathTime?: number
  yieldDistance?: number
  yieldTo?: string
  turnPriority?: boolean
  convoySpeed?: number
  tightConvoyUntilM?: number
  convoyBlockedBy?: string
  turnWaitOrder?: number
  turnWaitUntilM?: number
  footprint?: Body
  clearance?: { x: number; y: number }
  clearanceRetryAt?: number
  turnClaim?: TurnPoint[]
  recoveryYield?: { id: string; untilM: number }
  passageShapes?: Map<string, PassageShape>
  junctionRetryAt?: number
}
type Body = { x: number; y: number; fx: number; fy: number; half: number; width: number; z: number }
type TurnPoint = { distanceM: number; body: Body }
type TurnPair = { a: TurnPoint[]; b: TurnPoint[]; hits: [number, number][];
  current?: { a: Body; b: Body; distanceA: number; distanceB: number; entryA: number; entryB: number } }
type PassageShape = { entryM: number; exitM: number; landmarks: Body[]; points: Body[]; compatible: WeakMap<PassageShape, boolean> }
const CELL_M = 64
const LAT_METRES = 111320
const LNG_METRES = LAT_METRES * Math.cos(22.19 * Math.PI / 180)
const GAP_M = 5
const ACCEL = 1.5
const BRAKE = 3.5
const STEP_SEC = .5
const MAX_ADVANCE_SEC = 12
const BODY_CLEARANCE_M = .3
// A stopped, mutually blocked group may creep through a merge with a smaller
// bumper margin. It still checks every simultaneous swept body and never
// relaxes the physical bus width/length or another group's reserved corridor.
const CONVOY_CLEARANCE_M = .1
const CONVOY_SPEED_MPS = 1
const MAX_LANE_ADJUST_M = 4
const MAX_RECOVERY_VEHICLES = 4
const LANE_ADJUST_MPS = .8
const TURN_SAMPLE_M = 2
const YIELD_SPEED_MPS = 3
const CLEARANCE_HOLD_M = 14
const REJOIN_MPS = .5

// Collision grid addresses fit within a numeric integer key.
const cellKey = (x: number, y: number) => x * 1048576 + y

function recoveryClearance(state: State): number {
  return state.pose.distanceM < (state.tightConvoyUntilM ?? -Infinity) ? .05 : CONVOY_CLEARANCE_M
}

const bodies = new WeakMap<VehiclePosition, Body & { lng: number; lat: number; bearing: number; scale: number }>()
function body(v: VehiclePosition): Body {
  const cached = bodies.get(v)
  if (cached && cached.lng === v.coordinates[0] && cached.lat === v.coordinates[1] &&
      cached.bearing === v.bearing && cached.scale === (v.scale ?? 1) && cached.z === (v.altitude ?? 0)) return cached
  const angle = v.bearing * Math.PI / 180, scale = v.scale ?? 1
  const result = {
    lng: v.coordinates[0], lat: v.coordinates[1], bearing: v.bearing, scale,
    x: (v.coordinates[0] - 113.54) * LNG_METRES, y: (v.coordinates[1] - 22.19) * LAT_METRES,
    fx: Math.sin(angle), fy: Math.cos(angle), half: BUS_HALF_LENGTH_M * scale,
    width: 2.65 * scale, z: v.altitude ?? 0,
  }
  bodies.set(v, result)
  return result
}

function sameFlow(a: Body, b: Body): boolean {
  const dot = a.fx * b.fx + a.fy * b.fy
  if (dot < .35 || Math.abs(a.z - b.z) > 7) return false
  // Distinct parallel paths and opposite-direction roads are not a queue.
  // At a merge/curve, the oriented footprint test decides when paths conflict.
  const dx = b.x - a.x, dy = b.y - a.y
  return dot < .97 || Math.min(Math.abs(dx * a.fy - dy * a.fx), Math.abs(dx * b.fy - dy * b.fx)) < a.width + b.width + .15
}

function overlap(a: Body, b: Body, gap = GAP_M): boolean {
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.abs(dx) > a.half + b.half + gap + a.width + b.width ||
      Math.abs(dy) > a.half + b.half + gap + a.width + b.width) return false
  // Separating-axis test for two oriented vehicle bodies. Padding is along
  // travel only: an adjacent lane must not acquire a five-metre side gap.
  for (let axis = 0; axis < 4; axis++) {
    const x = axis === 0 ? a.fx : axis === 1 ? a.fy : axis === 2 ? b.fx : b.fy
    const y = axis === 0 ? a.fy : axis === 1 ? -a.fx : axis === 2 ? b.fy : -b.fx
    const ra = Math.abs(x * a.fx + y * a.fy) * (a.half + gap / 2) + Math.abs(x * a.fy - y * a.fx) * a.width
    const rb = Math.abs(x * b.fx + y * b.fy) * (b.half + gap / 2) + Math.abs(x * b.fy - y * b.fx) * b.width
    if (Math.abs(dx * x + dy * y) >= ra + rb) return false
  }
  return true
}

export function busesConflict(a: VehiclePosition, b: VehiclePosition, gap = GAP_M): boolean {
  const aa = body(a), bb = body(b)
  return Math.abs(aa.z - bb.z) <= 7 && overlap(aa, bb, gap)
}

function insideLane(pose: BusTrafficSample, offsetX: number, offsetY: number): boolean {
  return laneOverflow(pose, offsetX, offsetY) <= .02
}
function laneOverflow(pose: BusTrafficSample, offsetX: number, offsetY: number): number {
  if (!pose.laneAllowance) return 0
  const angle = pose.vehicle.bearing * Math.PI / 180
  const right = offsetX * Math.cos(angle) - offsetY * Math.sin(angle)
  return Math.max(0, -pose.laneAllowance.leftM - right, right - pose.laneAllowance.rightM)
}

function claimBlocks(owner: State, p: Body): boolean {
  return owner.turnClaim?.some(point => {
    const q = point.body
    if (point.distanceM < owner.pose.distanceM || Math.abs(p.z - q.z) > 7 || !overlap(p, q, 1)) return false
    // Clearance behind a front bus travelling away must not hold it back.
    return !(p.fx * q.fx + p.fy * q.fy > .97 && (p.x - q.x) * p.fx + (p.y - q.y) * p.fy > 0)
  }) ?? false
}


class Occupancy {
  private nearby?: { x0: number; x1: number; y0: number; y1: number; claims: boolean; states: State[] }
  private cells = new Map<number, Set<State>>()
  private keys = new Map<State, number>()
  private claimCells = new Map<number, Set<State>>()
  private claimKeys = new Map<State, { path: TurnPoint[]; keys: Set<number> }>()
  put(state: State): void {
    this.removeBody(state)
    if (!state.active) return
    const p = body(state.pose.vehicle), key = cellKey(Math.floor(p.x / CELL_M), Math.floor(p.y / CELL_M))
    state.footprint = p
    let cell = this.cells.get(key)
    if (!cell) { cell = new Set(); this.cells.set(key, cell) }
    cell.add(state); this.keys.set(state, key)
    this.reserve(state)
  }
  remove(state: State): void {
    this.removeBody(state)
    this.removeClaim(state)
  }
  private removeBody(state: State): void {
    this.nearby = undefined
    const key = this.keys.get(state)
    if (key !== undefined) {
      const cell = this.cells.get(key)
      cell?.delete(state)
      if (!cell?.size) this.cells.delete(key)
      this.keys.delete(state)
    }
  }
  private removeClaim(state: State): void {
    this.nearby = undefined
    for (const key of this.claimKeys.get(state)?.keys ?? []) {
      const cell = this.claimCells.get(key)
      cell?.delete(state)
      if (!cell?.size) this.claimCells.delete(key)
    }
    this.claimKeys.delete(state)
  }
  reserve(state: State): void {
    const path = state.active ? state.turnClaim : undefined
    if (this.claimKeys.get(state)?.path === path) return
    this.removeClaim(state)
    if (!path) return
    // Index the swept corridor, not just its owner's current position. Linked
    // junction reservations can reach hundreds of metres beyond that bus.
    const keys = new Set(path.map(p => cellKey(Math.floor(p.body.x / CELL_M), Math.floor(p.body.y / CELL_M))))
    for (const key of keys) {
      let cell = this.claimCells.get(key)
      if (!cell) { cell = new Set(); this.claimCells.set(key, cell) }
      cell.add(state)
    }
    this.claimKeys.set(state, { path, keys })
  }
  near(p: Body, radius = 100, includeClaims = false): State[] {
    const x0 = Math.floor((p.x - radius) / CELL_M), x1 = Math.floor((p.x + radius) / CELL_M)
    const y0 = Math.floor((p.y - radius) / CELL_M), y1 = Math.floor((p.y + radius) / CELL_M)
    const cached = this.nearby
    // Sweeps and bisections probe the same cells repeatedly while occupancy
    // is unchanged. Preserve the exact iteration order and invalidate on any
    // body/claim index edit; cached state references still expose fresh poses.
    if (cached && cached.x0 === x0 && cached.x1 === x1 && cached.y0 === y0 && cached.y1 === y1 && cached.claims === includeClaims) return cached.states
    const result: State[] = [], seen = includeClaims ? new Set<State>() : null
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = cellKey(x, y)
        for (const state of this.cells.get(key) ?? []) {
          if (!seen || !seen.has(state)) { result.push(state); seen?.add(state) }
        }
        if (seen) for (const state of this.claimCells.get(key) ?? []) {
          if (!seen.has(state)) { result.push(state); seen.add(state) }
        }
      }
    this.nearby = { x0, x1, y0, y1, claims: includeClaims, states: result }
    return result
  }
  blocked(pose: BusTrafficSample, self: State): boolean {
    return this.blocker(pose, self) !== undefined
  }
  blocker(pose: BusTrafficSample, self: State): State | undefined {
    const p = body(pose.vehicle)
    return this.near(p, 40, true).find(other => {
      if (other === self) return false
      const q = other.footprint ?? body(other.pose.vehicle)
      if (claimBlocks(other, p)) return true
      const ahead = (q.x - p.x) * (q.fx + p.fx) + (q.y - p.y) * (q.fy + p.fy)
      if (ahead > 0 && sameFlow(p, q) &&
          Math.abs((q.x - p.x) * p.fy - (q.y - p.y) * p.fx) < p.width + q.width + .5 &&
          other.path?.some(point => point.distanceM > other.pose.distanceM && point.distanceM <= other.pose.distanceM + 8 &&
            overlap(p, point.body, GAP_M))) return true
      const manoeuvring = !!self.turnClaim || other.recoveryYield?.id === self.plan.id || Math.hypot(self.offsetX, self.offsetY) > .1 || ahead < -.1 ||
        (self.cautiousUntilM !== undefined && self.pose.distanceM < self.cautiousUntilM)
      return Math.abs(p.z - q.z) <= 7 && overlap(p, q, manoeuvring ? BODY_CLEARANCE_M : GAP_M)
    })
  }
}

// Invert the monotonic schedule distance, keeping dwell time in the playhead.
// A queued bus reaches and serves its stop later; it never skips the dwell
// simply because the unimpeded timetable has already moved on.
function atDistance(plan: BusTrafficPlan, low: number, high: number, limit: number, iterations = 17): { time: number; pose: BusTrafficSample } {
  let pose = plan.sample(high)
  if (pose.distanceM <= limit + 1e-5) return { time: high, pose }
  const start = plan.sample(low)
  if (limit <= start.distanceM + 1e-5 && start.vehicle.busMotion?.phase !== 'stopped') return { time: low, pose: start }
  for (let i = 0; i < iterations; i++) {
    const mid = (low + high) / 2
    if ((plan.distanceAt?.(mid) ?? plan.sample(mid).distanceM) <= limit) low = mid
    else high = mid
  }
  pose = plan.sample(low)
  return { time: low, pose }
}

/** A map-owned traffic replay. No global state: changing the clock or rebuilding
 * the map cannot inherit a queue from another preview, date, or renderer. */
export class BusTrafficController {
  recorder?: BusTraceRecorder
  private maxAdvanceSec: number
  constructor(maxAdvanceSec = MAX_ADVANCE_SEC) { this.maxAdvanceSec = maxAdvanceSec }

  currentVehicles(): VehiclePosition[] {
    return [...this.states.values()].filter(state => state.active).map(state => state.pose.vehicle)
  }
  private states = new Map<string, State>()
  private lastMs = NaN
  private junctionOwners = new Map<string, Map<string, number>>()
  private junctionWaiters = new Map<string, { state: State; passage: BusPassage }[]>()
  private nextRequest = 1
  private recoverySequence = 0
  private turnPairs = new WeakMap<State, WeakMap<State, TurnPair>>()

  inspectQueues({ includeMoving = false, includeFuture = false } = {}) {
    return [...this.states.values()].filter(s => s.active && (includeMoving || s.blocked || s.passage)).map(s => ({
      id: s.plan.id, distanceM: s.pose.distanceM, playhead: s.playhead, nominal: s.nominal, speed: s.speed,
      blocked: s.blocked, phase: s.pose.vehicle.busMotion?.phase,
      blockerIds: this.waitDependencies(s).filter(other => other.active).map(other => other.plan.id),
      offset: [s.offsetX, s.offsetY], stalledSec: s.stalledSec,
      convoyBlockedBy: s.convoyBlockedBy,
      claimedThroughM: s.turnClaim?.at(-1)?.distanceM, requestOrder: s.requestOrder,
      clearance: s.clearance, recoveryYield: s.recoveryYield,
      yieldDistance: s.yieldDistance, yieldTo: s.yieldTo,
      preview: includeFuture && s.stalledSec >= 30 ? [0, .5, 1, 2, 4].map(dt => s.plan.sample(s.playhead + dt)) : undefined,
      path: includeFuture && s.stalledSec >= 30 ? s.path : undefined,
      coordinates: s.pose.vehicle.coordinates, bearing: s.pose.vehicle.bearing, leader: s.leaderId, waitingFor: s.waitingFor, waitReason: s.waitReason,
      held: s.passage, next: s.plan.passageAt?.(s.pose.distanceM),
      owners: (s.plan.passageAt?.(s.pose.distanceM)?.keys ?? []).flatMap(key => [...(this.junctionOwners.get(key)?.keys() ?? [])].map(id => [key, id])),
    }))
  }

  sample(plans: BusTrafficPlan[], timeMs: number): VehiclePosition[] {
    const dt = (timeMs - this.lastMs) / 1000
    const reset = !Number.isFinite(dt) || dt < 0 || dt > this.maxAdvanceSec
    if (reset) { this.states.clear(); this.junctionOwners.clear(); this.junctionWaiters.clear(); this.nextRequest = 1; this.recoverySequence = 0 }
    this.lastMs = timeMs
    const ids = new Set(plans.map(p => p.id))
    for (const id of this.states.keys()) if (!ids.has(id)) { this.releasePassage(this.states.get(id)!); this.states.delete(id) }
    const occupancy = new Occupancy()
    const fresh: State[] = []
    for (const plan of plans) {
      let state = this.states.get(plan.id)
      if (state && (state.plan.routeKey !== plan.routeKey || Math.abs(plan.elapsedSec - state.nominal - Math.max(0, dt)) > .01)) {
        this.releasePassage(state)
        this.states.delete(plan.id); state = undefined
      }
      if (!state) {
        const pose = plan.sample(plan.elapsedSec)
        state = { plan, pose, playhead: plan.elapsedSec, nominal: plan.elapsedSec,
          speed: (pose.vehicle.busMotion?.speedKmh ?? 0) / 3.6, active: true, blocked: false,
          offsetX: 0, offsetY: 0, stalledSec: 0, rejoinAfterM: 0, requestOrder: 0 }
        this.states.set(plan.id, state); fresh.push(state)
      } else {
        state.plan = plan; occupancy.put(state)
      }
      const current = state
      current.plan = { ...plan, passageAt: distanceM => {
        const passage = plan.passageAt?.(distanceM)
        if (!passage?.zones) return passage
        const zones = passage.zones.filter(z => z.exitM > distanceM + .01)
        return zones.length ? { ...passage, zones, keys: passage.keys.filter(key => zones.some(z => z.key === key)) } : undefined
      }, sample: at => {
        const pose = plan.sample(at)
        if (current.offsetX === 0 && current.offsetY === 0) return pose
        return { ...pose, vehicle: { ...pose.vehicle, coordinates: [
          pose.vehicle.coordinates[0] + current.offsetX / LNG_METRES,
          pose.vehicle.coordinates[1] + current.offsetY / LAT_METRES,
        ] } }
      } }
    }

    // Establish front-to-back order before resolving an initial frame or seek.
    // Coincident arrivals use arrival time, then vehicle id as a stable tie break.
    const raw = new Occupancy()
    for (const state of fresh) raw.put(state)
    const ordered: State[] = [], visited = new Set<State>(), visiting = new Set<State>()
    const rank = (a: State, b: State) => b.plan.arrivalAgeSec - a.plan.arrivalAgeSec || a.plan.id.localeCompare(b.plan.id)
    const visit = (state: State) => {
      if (visited.has(state) || visiting.has(state)) return
      visiting.add(state)
      const p = body(state.pose.vehicle)
      for (const other of raw.near(p, 40)) {
        if (other === state || !sameFlow(p, body(other.pose.vehicle))) continue
        const q = body(other.pose.vehicle), ahead = (q.x - p.x) * (q.fx + p.fx) + (q.y - p.y) * (q.fy + p.fy)
        if (ahead > .1 || Math.abs(ahead) <= .1 && rank(other, state) < 0) visit(other)
      }
      visiting.delete(state); visited.add(state); ordered.push(state)
    }
    for (const state of fresh.sort(rank)) visit(state)
    for (const state of ordered) {
      const original = state.pose.distanceM
      let searchTime = state.playhead
      for (let metres = 0; (occupancy.blocked(state.pose, state) || !this.initialPassage(state, occupancy)) && metres < 600; metres += 4) {
        // Search backwards in schedule space only on first placement/seek.
        // During playback, existing schedule playheads are never rewound.
        const target = Math.max(0, original - metres - 4)
        let low = Math.max(0, searchTime - 120)
        while (low > 0 && state.plan.sample(low).distanceM > target) low = Math.max(0, low - 120)
        const next = atDistance(state.plan, low, searchTime, target)
        state.playhead = next.time; state.pose = next.pose; searchTime = next.time
        this.releasePassage(state)
        state.speed = 0; state.blocked = true
        if (searchTime === 0) break
      }
      // At a terminal with no space behind the origin, wait off-map instead
      // of shifting sideways into another bus or drawing stacked bodies.
      state.active = !occupancy.blocked(state.pose, state) && this.initialPassage(state, occupancy)
      occupancy.put(state)
    }

    const recorder = this.recorder, newStates = new Set(fresh)
    if (recorder) {
      recorder.begin(reset ? timeMs : timeMs - dt * 1000)
      for (const state of this.states.values()) if (state.active) {
        recorder.add(this.vehicle(state, state.nominal), reset || newStates.has(state) ? timeMs : timeMs - dt * 1000)
      }
    }
    if (!reset && dt > 0) {
      const steps = Math.ceil(dt / STEP_SEC), step = dt / steps
      for (let i = 0; i < steps; i++) {
        const ordered = [...this.states.values()]
        const before = recorder ? new Map(ordered.map(s => [s, { pose: s.pose, playhead: s.playhead,
          offsetX: s.offsetX, offsetY: s.offsetY, active: s.active }])) : undefined
        this.junctionWaiters.clear()
        for (const state of ordered) {
          if (state.passage && state.pose.distanceM >= state.passage.exitM) this.releasePassage(state)
          else if (state.passage?.zones) {
            for (const key of state.passage.keys) {
              const zones = state.passage.zones.filter(z => z.key === key)
              if (zones.length && zones.every(z => z.exitM <= state.pose.distanceM)) {
                const owners = this.junctionOwners.get(key)
                owners?.delete(state.plan.id)
                if (!owners?.size) this.junctionOwners.delete(key)
              }
            }
          }
          const next = state.plan.passageAt?.(state.pose.distanceM)
          if (state.requestUntilM !== undefined && state.pose.distanceM >= state.requestUntilM) state.requestOrder = 0
          if (!state.passage && next && next.entryM - state.pose.distanceM < 45 && !state.requestOrder) {
            state.requestOrder = this.nextRequest++; state.requestUntilM = next.exitM
          }
          if (state.active && !state.passage && !state.recoveryYield && next && state.requestOrder) for (const key of next.keys) {
            let waiters = this.junctionWaiters.get(key)
            if (!waiters) { waiters = []; this.junctionWaiters.set(key, waiters) }
            waiters.push({ state, passage: next })
          }
        }
        ordered.sort((a, b) => Number(!!b.passage) - Number(!!a.passage) || (a.requestOrder || Infinity) - (b.requestOrder || Infinity))
        this.prepareTurns(ordered, occupancy)
        for (const state of ordered) {
          if (newStates.has(state)) continue
          const nominal = state.nominal + step * (i + 1)
          this.advance(state, nominal, step, occupancy)
        }
        this.advanceBlockedGroups(ordered.filter(s => !newStates.has(s)), step, i + 1, occupancy)
        if (recorder && before) {
          const endMs = timeMs - (dt - step * (i + 1)) * 1000
          recorder.step(endMs)
          for (const state of ordered) {
            if (newStates.has(state)) continue
            const previous = before.get(state)!, motion = state.pose.vehicle.busMotion, oldMotion = previous.pose.vehicle.busMotion
            if (!state.active) { recorder.clear(state.plan.id); continue }
            const handover = !previous.active || (motion && oldMotion &&
              (motion.returning !== oldMotion.returning || motion.dirSec < oldMotion.dirSec - .01))
            if (handover) recorder.clear(state.plan.id)
            else if (recorder.detailed(state.pose.vehicle) || recorder.detailed(previous.pose.vehicle)) {
              // Follow the actual lane course through a bend, instead of
              // drawing a chord between widely spaced worker replies.
              const distance = state.pose.distanceM - previous.pose.distanceM
              if (distance > 2 && previous.offsetX === state.offsetX && previous.offsetY === state.offsetY) {
                const parts = Math.min(128, Math.ceil(distance / 2))
                for (let p = 1; p < parts; p++) {
                  const fraction = p / parts, at = previous.playhead + (state.playhead - previous.playhead) * fraction
                  const pose = state.plan.sample(at), nominal = state.nominal + step * (i + fraction)
                  recorder.add({ ...pose.vehicle, busMotion: pose.vehicle.busMotion ? { ...pose.vehicle.busMotion,
                    speedKmh: pose.vehicle.busMotion.phase === 'stopped' ? 0 : state.speed * 3.6,
                    delaySec: Math.max(0, nominal - at) } : undefined }, endMs - step * 1000 * (1 - fraction))
                }
              }
            }
            recorder.add(this.vehicle(state, state.nominal + step * (i + 1)), endMs)
          }
        }
      }
    }
    const result: VehiclePosition[] = []
    for (const state of this.states.values()) {
      state.nominal = state.plan.elapsedSec
      if (!state.active) continue
      const vehicle = state.pose.vehicle, motion = vehicle.busMotion
      result.push({ ...vehicle, busMotion: motion ? { ...motion,
        speedKmh: state.speed * 3.6, delaySec: Math.max(0, state.nominal - state.playhead),
        phase: state.blocked ? 'queued' : motion.phase,
        leaderId: state.leaderId,
      } : undefined })
    }
    return result
  }

  private vehicle(state: State, nominal: number): VehiclePosition {
    const vehicle = state.pose.vehicle, motion = vehicle.busMotion
    return { ...vehicle, busMotion: motion ? { ...motion,
      speedKmh: motion.phase === 'stopped' && !state.blocked ? 0 : state.speed * 3.6,
      delaySec: Math.max(0, nominal - state.playhead),
      phase: state.blocked ? 'queued' : motion.phase,
      leaderId: state.leaderId,
    } : undefined }
  }

  private advance(state: State, nominal: number, dt: number, occupancy: Occupancy): void {
    if (!state.active) {
      if (occupancy.blocked(state.pose, state) || !this.initialPassage(state, occupancy)) return
      state.active = true; occupancy.put(state)
    }
    if (state.clearance) {
      const dx = state.clearance.x - state.offsetX, dy = state.clearance.y - state.offsetY
      const length = Math.hypot(dx, dy)
      if (length > .01) {
        const fraction = Math.min(1, LANE_ADJUST_MPS * dt / length)
        if (!this.shift(state, state.offsetX + dx * fraction, state.offsetY + dy * fraction, occupancy)) {
          state.clearance = undefined; state.recoveryYield = undefined
        }
        state.speed = 0; state.blocked = true; state.stalledSec += dt; occupancy.put(state)
        return
      }
      state.clearance = undefined
    }
    if (state.recoveryYield) {
      // A checked retreat explicitly gives this bus's neighbour room to turn.
      // Do not immediately reclaim the same junction while waiting for it.
      state.speed = 0; state.blocked = true; state.stalledSec += dt
      state.leaderId = state.recoveryYield.id; state.waitingFor = undefined; state.waitReason = 'retreat'
      return
    }
    const start = state.playhead, startDistance = state.pose.distanceM
    // Modest recovery when the road clears, bounded by acceleration and space.
    const end = Math.min(nominal, start + dt * (nominal - start > 1 ? 1.12 : 1))
    if (end <= start) return
    const desired = state.plan.sample(end)
    if (!insideLane(desired, state.offsetX, state.offsetY)) {
      // A temporary clearance cannot drift into an opposing lane when the
      // road curves or narrows. Return to the planned course before advancing.
      state.clearance = { x: 0, y: 0 }; state.speed = 0; state.blocked = true
      state.stalledSec += dt
      return
    }
    const currentMotion = state.pose.vehicle.busMotion, nextMotion = desired.vehicle.busMotion
    const terminalChange = currentMotion && nextMotion &&
      (nextMotion.dirSec < currentMotion.dirSec - .01 || nextMotion.returning !== currentMotion.returning)
    const currentBody = body(state.pose.vehicle), desiredBody = body(desired.vehicle)
    if (terminalChange && desired.distanceM - startDistance < .01 &&
        Math.hypot(currentBody.x - desiredBody.x, currentBody.y - desiredBody.y) > 1) {
      // Some published circular traces end beside, rather than at, their
      // origin. End the old trip before admitting the next one at its berth;
      // never teleport backwards through the following queue at the seam.
      this.releasePassage(state)
      state.offsetX = 0; state.offsetY = 0; state.path = undefined; state.exitPose = undefined; state.clearance = undefined; state.turnClaim = undefined; state.recoveryYield = undefined
      state.playhead = end; state.pose = state.plan.sample(end); state.speed = 0
      state.active = false; state.blocked = true; state.leaderId = undefined; state.stalledSec = 0
      occupancy.remove(state)
      return
    }
    // Retain admission during an ordinary stop: releasing it lets a follower
    // reserve the same junction against this front bus before it departs.
    // Only an extended layover releases ordinary junctions. A genuinely
    // single-lane street remains exclusive even during a long stop.
    const layingOver = desired.vehicle.busMotion?.phase === 'stopped' && Math.abs(desired.distanceM - startDistance) < .001
    if (layingOver) {
      state.turnClaim = undefined
      if (this.extendedLayover(state) && !state.passage?.keys.some(key => key.startsWith('n'))) this.releasePassage(state)
      state.waitingFor = undefined
      if (Math.hypot(currentBody.x - desiredBody.x, currentBody.y - desiredBody.y) < 1e-6 &&
          Math.abs(currentBody.fx - desiredBody.fx) + Math.abs(currentBody.fy - desiredBody.fy) < 1e-6) {
        // A stationary stop consumes time even when the following queue has
        // closed its comfort gap. Only a truly unchanged footprint may bypass
        // the sweep; disconnected terminal handovers were handled above.
        state.playhead = end; state.pose = desired; state.speed = 0; state.blocked = false
        state.leaderId = undefined; state.stalledSec = 0; state.convoySpeed = undefined
        occupancy.put(state)
        return
      }
    }
    let speed = Math.min(Math.max(0, (desired.distanceM - startDistance) / dt), state.speed + ACCEL * dt)
    if (state.turnPriority && (state.yieldDistance ?? Infinity) > startDistance + 2 && state.stalledSec >= 2) {
      state.cautiousUntilM = Math.min(startDistance + 15, state.yieldDistance ?? Infinity)
    }
    if (Math.hypot(state.offsetX, state.offsetY) > .01 ||
        state.cautiousUntilM !== undefined && startDistance < state.cautiousUntilM) speed = Math.min(speed, YIELD_SPEED_MPS)
    let following = false
    let bodyBlocked = false
    state.leaderId = undefined
    const p = body(state.pose.vehicle)
    const passage = state.plan.passageAt?.(startDistance)
    if (!layingOver && !state.passage && passage && passage.entryM - startDistance < 45) {
      if (!this.claimPassage(state, passage, occupancy)) {
        const space = Math.max(0, passage.entryM - .3 - startDistance)
        const safe = Math.max(0, Math.sqrt(BRAKE * BRAKE + 2 * BRAKE * space) - BRAKE)
        if (safe < speed) { speed = safe; following = true; state.leaderId = state.waitingFor }
      }
    }
    for (const other of occupancy.near(p)) {
      if (other === state) continue
      const q = body(other.pose.vehicle)
      // A clear reserved turn is governed by its swept footprint. Projecting
      // a car on another arm onto the current heading invents a stopped leader
      // precisely when the bus is turning away from that arm.
      if (state.turnClaim || other.recoveryYield?.id === state.plan.id || p.fx * q.fx + p.fy * q.fy < .97) continue
      if (!sameFlow(p, q)) continue
      if ((q.x - p.x) * (q.fx + p.fx) + (q.y - p.y) * (q.fy + p.fy) <= 0) continue
      const along = (q.x - p.x) * p.fx + (q.y - p.y) * p.fy
      const side = Math.abs((q.x - p.x) * p.fy - (q.y - p.y) * p.fx)
      if (along <= 0 || side > p.width + q.width || along > 100) continue
      const space = Math.max(0, along - p.half - q.half - GAP_M)
      const safe = Math.max(0, Math.sqrt(BRAKE * BRAKE + other.speed ** 2 + 2 * BRAKE * space) - BRAKE)
      if (safe < speed) { speed = safe; following = true; state.leaderId = other.plan.id }
    }

    if (following && speed < .05) speed = 0
    if (state.yieldDistance !== undefined) {
      const space = Math.max(0, state.yieldDistance - startDistance)
      const safe = Math.max(0, Math.sqrt(BRAKE * BRAKE + 2 * BRAKE * space) - BRAKE)
      if (safe < speed) { speed = safe; following = true; state.leaderId = state.yieldTo }
    }
    let next = atDistance(state.plan, start, end, Math.min(startDistance + speed * dt, state.yieldDistance ?? Infinity))
    let lastClear = start
    // Sweep in small distance steps as well as simulated time. At 60x, the
    // candidate must not leap through the leader and land clear on its far side.
    const parts = Math.max(1, Math.ceil((next.pose.distanceM - startDistance) / 2))
    for (let i = 1; i <= parts; i++) {
      const time = start + (next.time - start) * i / parts
      const candidate = state.plan.sample(time)
      const blocker = occupancy.blocker(candidate, state)
      if (blocker) {
        bodyBlocked = busesConflict(state.plan.sample(time).vehicle, blocker.pose.vehicle, BODY_CLEARANCE_M)
        state.leaderId = blocker.plan.id
        let lo = lastClear, hi = time
        for (let j = 0; j < 12; j++) {
          const mid = (lo + hi) / 2
          const pose = state.plan.sample(mid)
          if (occupancy.blocked(pose, state)) hi = mid
          else lo = mid
        }
        next = { time: lo, pose: state.plan.sample(lo) }; following = true
        break
      }
      lastClear = time
    }
    state.playhead = next.time; state.pose = next.pose
    state.speed = Math.max(0, (next.pose.distanceM - startDistance) / dt)
    state.blocked = following || (state.speed < .1 && desired.distanceM > next.pose.distanceM + .01)
    if (!state.blocked) state.convoySpeed = undefined
    if (state.passage && state.pose.distanceM < state.passage.entryM - .5 && state.leaderId && state.speed < .1) this.releasePassage(state)
    state.stalledSec = state.blocked && state.speed < .2 ? state.stalledSec + dt : 0
    if (state.pose.distanceM >= (state.tightConvoyUntilM ?? Infinity)) state.tightConvoyUntilM = undefined
    if (state.turnWaitUntilM !== undefined && state.pose.distanceM >= state.turnWaitUntilM) {
      state.turnWaitOrder = undefined; state.turnWaitUntilM = undefined
    }
    if (state.stalledSec >= 2 && state.yieldTo && !state.turnWaitOrder) {
      state.turnWaitOrder = this.nextRequest++; state.turnWaitUntilM = state.pose.distanceM + 25
    }
    // Imported route centre-lines can converge at slightly different angles.
    // After stopping, use bounded lateral clearance to finish such a turn.
    // A straight queue never sidesteps its leader. Every adjustment is checked
    // against bodies, and the bus returns to its route after clearing the merge.
    const waitingOwner = state.waitingFor && this.states.get(state.waitingFor)
    const blocksOwner = !!waitingOwner && waitingOwner.leaderId === state.plan.id
    if (state.stalledSec >= 2 && state.leaderId) {
      const other = this.states.get(state.leaderId)
      if (other) {
        const p = body(state.pose.vehicle), q = body(other.pose.vehicle)
        const side = (p.x - q.x) * p.fy - (p.y - q.y) * p.fx
        const angle = p.fx * q.fx + p.fy * q.fy
        const obstructed = bodyBlocked || blocksOwner || this.turnPath(state).some(point =>
          point.distanceM <= state.pose.distanceM + 8 && overlap(point.body, q, BODY_CLEARANCE_M))
        if (obstructed && (angle < .96 || Math.abs(side) > p.width + q.width - 1)) {
          if (!state.clearance && nominal >= (state.clearanceRetryAt ?? 0)) {
            state.clearance = this.findClearance(state, occupancy, blocksOwner)
            state.clearanceRetryAt = nominal + 2
          }
          if (state.clearance) {
            const dx = state.clearance.x - state.offsetX, dy = state.clearance.y - state.offsetY
            const fraction = Math.min(1, LANE_ADJUST_MPS * dt / Math.hypot(dx, dy))
            if (this.shift(state, state.offsetX + dx * fraction, state.offsetY + dy * fraction, occupancy)) {
              state.rejoinAfterM = state.pose.distanceM + CLEARANCE_HOLD_M
              state.cautiousUntilM = state.rejoinAfterM + Math.hypot(state.clearance.x, state.clearance.y) * YIELD_SPEED_MPS / REJOIN_MPS + 2
            }
            else state.clearance = undefined
          }
        }
      }
    } else if (state.pose.distanceM >= state.rejoinAfterM && state.speed > .5) {
      const length = Math.hypot(state.offsetX, state.offsetY)
      if (length > 0) {
        state.clearance = undefined
        const fraction = Math.max(0, 1 - REJOIN_MPS * dt / length)
        this.shift(state, state.offsetX * fraction, state.offsetY * fraction, occupancy)
      }
    }
    occupancy.put(state)
  }
  private releasePassage(state: State): void {
    for (const key of state.passage?.keys ?? []) {
      const owners = this.junctionOwners.get(key)
      owners?.delete(state.plan.id)
      if (!owners?.size) this.junctionOwners.delete(key)
    }
    state.passage = undefined; state.passageShapes = undefined
    if (state.requestUntilM === undefined || state.pose.distanceM >= state.requestUntilM) state.requestOrder = 0
  }
  private findClearance(state: State, occupancy: Occupancy, yieldOnly = false): { x: number; y: number } | undefined {
    const p = body(state.pose.vehicle), obstacles = occupancy.near(p, 60, true).filter(s => s !== state)
      .flatMap(s => [body(s.pose.vehicle), ...(s.turnClaim ?? []).filter(point => point.distanceM >= s.pose.distanceM).map(point => point.body)])
    const path: Body[] = [], samples: BusTrafficSample[] = []
    for (let ahead = 0; ahead <= CLEARANCE_HOLD_M + MAX_LANE_ADJUST_M * YIELD_SPEED_MPS / REJOIN_MPS + 2; ahead += 1) {
      // This search spans 120 seconds, unlike a normal half-second frame.
      // Frame-level bisection precision can undershoot the 1 cm reachability
      // check for faster routes and reject an otherwise possible manoeuvre.
      const pose = atDistance(state.plan, state.playhead, state.playhead + 120, state.pose.distanceM + ahead, 24).pose
      if (pose.distanceM < state.pose.distanceM + ahead - .01) return
      const motion = state.pose.vehicle.busMotion, next = pose.vehicle.busMotion
      if (motion && next && (motion.returning !== next.returning || next.dirSec < motion.dirSec - .01)) return
      path.push(body(pose.vehicle))
      samples.push(pose)
    }
    const clear = (b: Body) => !obstacles.some(q => Math.abs(b.z - q.z) <= 7 && overlap(b, q, BODY_CLEARANCE_M))
    for (let radius = .5; !yieldOnly && radius <= MAX_LANE_ADJUST_M; radius += .5) for (const sign of [1, -1]) {
      const x = p.fy * sign * radius, y = -p.fx * sign * radius
      const dx = x - state.offsetX, dy = y - state.offsetY
      // Validate the return as well as the outward manoeuvre. Holding an
      // offset past an upcoming lane drop can strand parallel buses even
      // though both of their original courses were clear.
      if (!samples.every((pose, ahead) => {
        const remaining = Math.max(0, 1 - Math.max(0, ahead - CLEARANCE_HOLD_M) * REJOIN_MPS / (YIELD_SPEED_MPS * radius))
        return insideLane(pose, x * remaining, y * remaining) &&
          clear({ ...path[ahead], x: path[ahead].x + x * remaining - state.offsetX, y: path[ahead].y + y * remaining - state.offsetY })
      })) continue
      const parts = Math.ceil(Math.hypot(dx, dy) / .25)
      if (!Array.from({ length: parts }, (_, i) => (i + 1) / parts).every(f => clear({ ...p, x: p.x + dx * f, y: p.y + dy * f }))) continue
      return { x, y }
    }
    // With interlocking swept turns, moving the blocked car forward may have
    // no solution. A small, checked retreat can leave the other car's complete
    // turn clear without reversing the schedule or changing queue order.
    const leader = state.leaderId && this.states.get(state.leaderId)
    if (!leader || leader.recoveryYield?.id === state.plan.id || state.passage?.keys.some(key => key.startsWith('n'))) return
    const exit: Body[] = []
    for (let ahead = 0; ahead <= 14; ahead++) {
      const pose = atDistance(leader.plan, leader.playhead, leader.playhead + 120, leader.pose.distanceM + ahead, 24).pose
      if (pose.distanceM < leader.pose.distanceM + ahead - .01) return
      exit.push(body(pose.vehicle))
    }
    const others = occupancy.near(p, 60).filter(s => s !== state && s !== leader)
    if (exit.some(b => others.some(s => overlap(b, s.footprint!, BODY_CLEARANCE_M)))) return
    // This manoeuvre vacates the beneficiary's swept corridor. Testing each
    // intermediate retreat against that same corridor would forbid leaving
    // it at all. Current bodies and every OTHER reservation stay binding; the
    // final position must also leave the beneficiary's whole exit clear.
    const retreatClear = (b: Body) => occupancy.near(b, 40, true).every(other => other === state ||
      ((Math.abs(b.z - other.footprint!.z) > 7 || !overlap(b, other.footprint!, recoveryClearance(state))) &&
        (other === leader || !claimBlocks(other, b))))
    for (let radius = .5; radius <= MAX_LANE_ADJUST_M; radius += .5) for (const angle of [Math.PI, Math.PI * .75, -Math.PI * .75, Math.PI * .5, -Math.PI * .5]) {
      const x = (p.fx * Math.cos(angle) + p.fy * Math.sin(angle)) * radius
      const y = (p.fy * Math.cos(angle) - p.fx * Math.sin(angle)) * radius
      const dx = x - state.offsetX, dy = y - state.offsetY
      // A retreat stays on the current lane and waits here. It does not carry
      // this world-space offset around the coming bend: advance() requires
      // rejoining before the offset would exceed the next lane's allowance.
      if (!insideLane(state.pose, x, y)) continue
      const target = { ...p, x: p.x + dx, y: p.y + dy }
      if (!retreatClear(target) || exit.some(b => overlap(target, b, 1))) continue
      const parts = Math.ceil(Math.hypot(dx, dy) / .25)
      if (!Array.from({ length: parts }, (_, i) => (i + 1) / parts).every(f => retreatClear({ ...p, x: p.x + dx * f, y: p.y + dy * f }))) continue
      state.recoveryYield = { id: leader.plan.id, untilM: leader.pose.distanceM + 14 }
      leader.cautiousUntilM = Math.max(leader.cautiousUntilM ?? 0, leader.pose.distanceM + 14)
      state.turnClaim = undefined; this.releasePassage(state)
      return { x, y }
    }
  }
  private ensureTurnPath(state: State): TurnPoint[] {
    const distance = state.pose.distanceM
    if (!state.path || distance - state.path[0].distanceM > 4 ||
        state.path.at(-1)!.distanceM - distance < 20 && state.playhead - (state.pathTime ?? 0) >= .5) {
      const path = [{ distanceM: distance, body: body(state.pose.vehicle) }]
      let time = state.playhead
      let previous = state.plan.sample(time)
      const end = time + 120
      while (time < end && path.at(-1)!.distanceM < distance + 45) {
        const speed = Math.max(2, (previous.vehicle.busMotion?.speedKmh ?? 0) / 3.6)
        time += Math.min(1, TURN_SAMPLE_M / speed)
        const pose = state.plan.sample(time)
        const before = previous.vehicle.busMotion, after = pose.vehicle.busMotion
        if (before && after && (before.returning !== after.returning || after.dirSec < before.dirSec - .01)) break
        previous = pose
        if (pose.distanceM > path.at(-1)!.distanceM + .5) path.push({ distanceM: pose.distanceM, body: body(pose.vehicle) })
        else if (time > state.playhead + 3 && path.length === 1) break
      }
      state.path = path
      state.pathTime = state.playhead
    }
    return state.path
  }
  private turnPath(state: State): TurnPoint[] {
    const path = this.ensureTurnPath(state), distanceM = state.pose.distanceM
    return [{ distanceM, body: body(state.pose.vehicle) }, ...path.filter(p => p.distanceM > distanceM + .5)]
  }
  private prepareTurns(states: State[], occupancy: Occupancy): void {
    for (const state of states) {
      if (state.active) this.ensureTurnPath(state)
      state.yieldDistance = undefined; state.yieldTo = undefined; state.turnPriority = false
      if (state.turnClaim && state.pose.distanceM >= state.turnClaim.at(-1)!.distanceM) {
        state.turnClaim = undefined; state.turnWaitOrder = undefined; state.turnWaitUntilM = undefined
      }
    }
    const conflicts: { a: State; b: State; entryA: number; entryB: number; queueWinner?: State }[] = []
    const precedes = new Map<State, Set<State>>()
    const before = (front: State, rear: State) => {
      let list = precedes.get(rear)
      if (!list) { list = new Set(); precedes.set(rear, list) }
      list.add(front)
    }
    const paths = new Map<State, ReturnType<BusTrafficController['turnPath']>>()
    const getPath = (state: State) => {
      if (!paths.has(state)) paths.set(state, this.turnPath(state))
      return paths.get(state)!
    }
    for (const a of states) {
      if (!a.active) continue
      const pa = body(a.pose.vehicle)
      for (const b of occupancy.near(pa, 65)) {
        if (b === a || a.plan.id > b.plan.id) continue
        const pb = body(b.pose.vehicle), dot = pa.fx * pb.fx + pa.fy * pb.fy
        if (Math.abs(pa.z - pb.z) > 7 || Math.hypot(pa.x - pb.x, pa.y - pb.y) > 65) continue
        const ap = getPath(a), bp = getPath(b)
        // A shared straight approach can lead into a tight turn. Waiting for
        // the front bus to rotate lets its follower enter the area swept by
        // the turning tail. A straight leader still uses ordinary following.
        if (dot > .985 && Math.abs((pb.x - pa.x) * pa.fy - (pb.y - pa.y) * pa.fx) < 2 &&
            ((pb.x - pa.x) * pa.fx + (pb.y - pa.y) * pa.fy > 0
              ? bp.every(p => p.body.fx * pb.fx + p.body.fy * pb.fy > .7)
              : ap.every(p => p.body.fx * pa.fx + p.body.fy * pa.fy > .7))) continue
        let entryA = Infinity, entryB = Infinity
        let pairs = this.turnPairs.get(a)
        if (!pairs) { pairs = new WeakMap(); this.turnPairs.set(a, pairs) }
        let pair = pairs.get(b)
        if (!pair || pair.a !== a.path || pair.b !== b.path) {
          pair = { a: a.path!, b: b.path!, hits: [] }
          for (const aa of pair.a) for (const bb of pair.b) {
            if (Math.abs(aa.body.z - bb.body.z) <= 7 && overlap(aa.body, bb.body, GAP_M)) pair.hits.push([aa.distanceM, bb.distanceM])
          }
          pairs.set(b, pair)
        }
        const cached = pair.current
        const unchanged = (old: Body, now: Body) => old.x === now.x && old.y === now.y && old.fx === now.fx && old.fy === now.fy &&
          old.z === now.z && old.half === now.half && old.width === now.width
        if (cached && cached.distanceA === a.pose.distanceM && cached.distanceB === b.pose.distanceM &&
            unchanged(cached.a, pa) && unchanged(cached.b, pb)) {
          entryA = cached.entryA; entryB = cached.entryB
        } else {
          for (const [ad, bd] of pair.hits) if (ad > a.pose.distanceM + .5 && bd > b.pose.distanceM + .5) {
            entryA = Math.min(entryA, ad - a.pose.distanceM)
            entryB = Math.min(entryB, bd - b.pose.distanceM)
          }
          const compare = (aa: TurnPoint, bb: TurnPoint) => {
            if (Math.abs(aa.body.z - bb.body.z) <= 7 && overlap(aa.body, bb.body, GAP_M)) {
              entryA = Math.min(entryA, aa.distanceM - a.pose.distanceM)
              entryB = Math.min(entryB, bb.distanceM - b.pose.distanceM)
            }
          }
          for (const bb of bp) compare(ap[0], bb)
          for (let i = 1; i < ap.length; i++) compare(ap[i], bp[0])
          pair.current = { a: pa, b: pb, distanceA: a.pose.distanceM, distanceB: b.pose.distanceM, entryA, entryB }
        }
        if (!Number.isFinite(entryA)) continue
        // A vehicle already occupying the turning area must clear it first.
        const ahead = (pb.x - pa.x) * (pa.fx + pb.fx) + (pb.y - pa.y) * (pa.fy + pb.fy)
        const queue = sameFlow(pa, pb) && Math.abs(ahead) > .1 && Math.hypot(pa.x - pb.x, pa.y - pb.y) < 25
        if (entryA === 0 && entryB > 0) before(a, b)
        else if (entryB === 0 && entryA > 0) before(b, a)
        else if (queue) before(ahead < 0 ? a : b, ahead < 0 ? b : a)
        conflicts.push({ a, b, entryA, entryB, queueWinner: queue ? (ahead < 0 ? a : b) : undefined })
      }
    }
    // Resolve one order for the whole approach network. Independent pairwise
    // priorities can say A yields to B, B follows C, and C yields to A.
    // Physical leaders and vehicles already occupying a turn precede their
    // dependants; waiting approaches then use a stable arrival order.
    const rank = new Map<State, number>(), visiting = new Set<State>()
    const visit = (state: State) => {
      if (rank.has(state) || visiting.has(state)) return
      visiting.add(state)
      for (const front of precedes.get(state) ?? []) visit(front)
      visiting.delete(state); rank.set(state, rank.size)
    }
    for (const state of [...states].sort((a, b) => (a.turnWaitOrder ?? Infinity) - (b.turnWaitOrder ?? Infinity) || a.plan.id.localeCompare(b.plan.id))) visit(state)
    for (const { a, b, entryA, entryB, queueWinner } of conflicts) {
      const aWins = entryA === 0 && entryB > 0 ? true : entryB === 0 && entryA > 0 ? false
        : queueWinner ? queueWinner === a : rank.get(a)! < rank.get(b)!
      const loser = aWins ? b : a, entry = aWins ? entryB : entryA
      const winner = aWins ? a : b
      winner.turnPriority = true
      // Both comfort envelopes can touch while the bodies are still clear,
      // especially in adjacent lanes entering a bend. Keep the rear approach
      // stopped instead of dropping its yield exactly when space is tightest.
      const limit = loser.pose.distanceM + Math.max(0, entry - TURN_SAMPLE_M - .5)
      if (limit < (loser.yieldDistance ?? Infinity)) {
        loser.yieldDistance = limit; loser.yieldTo = winner.plan.id
      }
    }
    const claims = states.filter(s => s.active && s.turnClaim)
    const claimStops = new Map<State, number>()
    for (const owner of claims) {
      const end = owner.turnClaim!.at(-1)!.distanceM
      if (end - owner.pose.distanceM >= 30 || !conflicts.some(c => {
        if (c.a !== owner && c.b !== owner) return false
        const other = (c.a === owner ? c.b : c.a).footprint!, own = owner.footprint!
        return own.fx * other.fx + own.fy * other.fy < .35
      })) continue
      const path = getPath(owner)
      const clear = path.at(-1)!.distanceM > end + 2 &&
        path.every(p => occupancy.near(p.body, 20, true).filter(s => s !== owner).every(s => Math.abs(p.body.z - s.footprint!.z) > 7 ||
          !overlap(p.body, s.footprint!, 1) && !claimBlocks(s, p.body)))
      if (clear) {
        owner.turnClaim = path
        occupancy.reserve(owner)
      } else if (end - owner.pose.distanceM <= 14.1) {
        // Hand back priority with a whole bus length still available. Waiting
        // until the reservation ends can put the nose against a newly arrived
        // crossing bus, leaving neither route enough room to finish.
        owner.turnClaim = undefined
      } else claimStops.set(owner, end - 14)
    }
    const turning = new Set(conflicts.filter(c => !c.queueWinner && Math.min(c.entryA, c.entryB) < 25).flatMap(c => [c.a, c.b]))
    for (const state of [...turning].sort((a, b) => rank.get(a)! - rank.get(b)!)) {
      if (state.turnClaim || state.recoveryYield) continue
      // Reserve the complete preview through the bend. A short reservation can
      // expire halfway through a reversing curve, inviting the opposing bus
      // into the second half before the first bus can finish its turn.
      const path = getPath(state)
      if (!path.length || path.at(-1)!.distanceM < state.pose.distanceM + 40) continue
      const neighbours = occupancy.near(body(state.pose.vehicle), 60).filter(s => s !== state)
      if (path.some(p => neighbours.some(s => overlap(p.body, s.footprint ?? body(s.pose.vehicle), 1)))) continue
      if (claims.some(s => s.turnClaim &&
          path.some(p => claimBlocks(s, p.body)))) continue
      const passage = state.plan.passageAt?.(state.pose.distanceM)
      if (passage && !state.passage && passage.entryM <= path.at(-1)!.distanceM && !this.claimPassage(state, passage, occupancy)) continue
      state.turnClaim = path; state.cautiousUntilM = path.at(-1)!.distanceM; claims.push(state)
      occupancy.reserve(state)
    }
    for (const owner of claims) {
      if (!owner.turnClaim) continue
      owner.yieldDistance = claimStops.get(owner); owner.yieldTo = undefined; owner.turnPriority = true
      for (const other of occupancy.near(owner.footprint!, 65)) {
        if (other === owner || !other.active || other.turnClaim) continue
        const hit = getPath(other).find(p => claimBlocks(owner, p.body))
        if (!hit) continue
        const limit = Math.max(other.pose.distanceM, hit.distanceM - TURN_SAMPLE_M - .5)
        if (limit < (other.yieldDistance ?? Infinity)) { other.yieldDistance = limit; other.yieldTo = owner.plan.id }
      }
    }
    for (const state of states) if (state.recoveryYield) {
      const leader = this.states.get(state.recoveryYield.id)
      if (!leader?.active || leader.pose.distanceM >= state.recoveryYield.untilM) state.recoveryYield = undefined
      else { state.yieldDistance = state.pose.distanceM; state.yieldTo = leader.plan.id; state.turnClaim = undefined }
    }
    for (const state of states) occupancy.reserve(state)
  }
  private waitDependencies(state: State): State[] {
    const blockers = [state.leaderId, state.waitingFor, state.recoveryYield?.id,
      (state.yieldDistance ?? Infinity) <= state.pose.distanceM + .5 ? state.yieldTo : undefined]
      .flatMap(id => id && this.states.has(id) ? [this.states.get(id)!] : [])
    const passage = !state.passage && state.plan.passageAt?.(state.pose.distanceM)
    if (passage && state.pose.distanceM + .5 >= passage.entryM) {
      // Admission needs every linked zone. Recording only the first owner
      // hides a cycle through a later zone and the rest of the roundabout.
      for (const key of passage.keys) for (const id of this.junctionOwners.get(key)?.keys() ?? []) {
        const owner = this.states.get(id)
        if (owner && owner !== state && owner.passage &&
            (key.startsWith('n') || !this.canSharePassage(state, passage, owner, owner.passage, key, true))) blockers.push(owner)
      }
    }
    return [...new Set(blockers)].filter(other => other !== state)
  }
  private advanceBlockedGroups(states: State[], dt: number, stepIndex: number, occupancy: Occupancy): void {
    const visited = new Set<State>()
    const waiting = states.filter(s => s.active && (s.stalledSec >= 2 || !!s.convoySpeed))
    const waitGraph = new Map<State, State[]>()
    const dependencies = (state: State): State[] => {
      const cached = waitGraph.get(state)
      if (cached) return cached
      const result = this.waitDependencies(state)
      waitGraph.set(state, result)
      return result
    }
    for (const component of closedWaitGroups(waiting, dependencies)) {
      if (component.some(s => visited.has(s))) continue
      const group = component.sort((a, b) => a.plan.id.localeCompare(b.plan.id))
      // A sustained same-direction bend lock may use a closer bumper margin
      // while it clears. Keep that decision through the turn, rather than
      // switching back to a larger gap halfway through the checked manoeuvre.
      // Crossing/opposing approaches retain their ordinary recovery margin.
      if (group.every(s => s.stalledSec >= 30) && group.every(a => group.every(b => sameFlow(body(a.pose.vehicle), body(b.pose.vehicle))))) {
        for (const state of group) state.tightConvoyUntilM ??= state.pose.distanceM + 26
      }
      const convoyClearance = Math.min(...group.map(recoveryClearance))
      for (const state of group) visited.add(state)
      // advance() is already carrying out a checked retreat for this group.
      // Do not let the simultaneous fallback undo its first step by choosing
      // a rejoin before the clearance target is reached. If the retreat hits
      // an obstacle, advance() cancels it and this solver can take over.
      if (group.length <= MAX_RECOVERY_VEHICLES && group.some(state => state.recoveryYield && state.clearance &&
          Math.hypot(state.clearance.x, state.clearance.y) > .01 &&
          Math.hypot(state.clearance.x - state.offsetX, state.clearance.y - state.offsetY) > .01)) continue
      const members = new Set(group)
      // Linked junctions and stops can create a circular permission wait even
      // when one bus has a completely clear exit. Resolve that wait only after
      // checking and reserving its ENTIRE remaining passage, not a short nudge
      // that could strand it at the next bend. The reserved swept body corridor
      // prevents every other bus from entering until its tail has passed.
      for (const state of [...group].sort((a, b) => (a.requestOrder || Infinity) - (b.requestOrder || Infinity))) {
        const now = state.nominal + dt * stepIndex
        if (now < (state.junctionRetryAt ?? 0)) continue
        state.junctionRetryAt = now + 2
        const passage = state.plan.passageAt?.(state.pose.distanceM)
        if (!passage || passage.keys.some(key => key.startsWith('n')) || state.clearance) continue
        const end = Math.max(state.pose.distanceM + 26, passage.exitM + 8)
        if (end - state.pose.distanceM > 500) continue
        const path: TurnPoint[] = []
        const motion = state.pose.vehicle.busMotion
        let clear = true
        for (let distanceM = state.pose.distanceM; distanceM <= end + 2; distanceM += 2) {
          const target = Math.min(distanceM, end)
          const pose = atDistance(state.plan, state.playhead, state.playhead + 1200, target, 24).pose
          const next = pose.vehicle.busMotion, p = body(pose.vehicle)
          if (pose.distanceM < target - .01 || motion && next && (motion.returning !== next.returning || next.dirSec < motion.dirSec - .01) ||
              occupancy.near(p, 50, true).some(other => other !== state &&
                (Math.abs(p.z - other.footprint!.z) <= 7 && overlap(p, other.footprint!, 1) ||
                  !members.has(other) && claimBlocks(other, p)))) {
            clear = false; break
          }
          path.push({ distanceM: target, body: p })
          if (target === end) break
        }
        if (!clear) continue
        for (const other of group) { other.turnClaim = undefined; other.recoveryYield = undefined }
        this.holdPassage(state, passage)
        state.turnClaim = path; state.cautiousUntilM = end
        occupancy.reserve(state)
        state.yieldDistance = undefined; state.yieldTo = undefined
        break
      }
      const dependsOnGroup = (id: string): boolean => {
        const other = this.states.get(id)
        return !!other && waitsForGroup(other, members, dependencies)
      }
      const sampleOffset = (state: State, time: number, x: number, y: number): BusTrafficSample => {
        const pose = state.plan.sample(time)
        return { ...pose, vehicle: { ...pose.vehicle, coordinates: [
          pose.vehicle.coordinates[0] + (x - state.offsetX) / LNG_METRES,
          pose.vehicle.coordinates[1] + (y - state.offsetY) / LAT_METRES,
        ] } }
      }
      const makeMove = (state: State) => {
        const nominal = state.nominal + dt * stepIndex
        // A rear member's swept reservation must not freeze its own front
        // member. A closed group can replace those internal turn priorities
        // with one simultaneous, collision-checked step; outside reservations
        // and narrow-street admission remain binding.
        const yieldOwner = state.yieldTo ? this.states.get(state.yieldTo) : undefined
        const groupYield = state.yieldTo && (!state.recoveryYield || !!yieldOwner && members.has(yieldOwner)) &&
          (!yieldOwner?.turnClaim || members.has(yieldOwner)) && dependsOnGroup(state.yieldTo)
        let limit = Math.min(state.pose.distanceM + Math.min(CONVOY_SPEED_MPS, Math.max(state.speed, state.convoySpeed ?? 0) + ACCEL * dt) * dt,
          groupYield ? Infinity : state.yieldDistance ?? Infinity)
        if (state.clearance && (state.clearance.x !== 0 || state.clearance.y !== 0)) limit = state.pose.distanceM
        const passage = state.plan.passageAt?.(state.pose.distanceM)
        let admission: BusPassage | undefined
        if (passage && !state.passage) {
          // A bus already obstructing a holder's exit cannot wait for that
          // same holder to leave. Share admission only within this closed
          // group, with no conflicting outside holder and no narrow street.
          // Commit it only if the complete simultaneous body sweep succeeds.
          const owners = passage.keys.flatMap(key => [...(this.junctionOwners.get(key)?.keys() ?? [])].map(id => ({ key, owner: this.states.get(id) })))
          if (!passage.keys.some(key => key.startsWith('n')) && state.pose.distanceM + 6 >= passage.entryM &&
              owners.some(({ owner }) => owner && members.has(owner)) &&
              owners.every(({ key, owner }) => !owner || members.has(owner) ||
                owner.passage && this.canSharePassage(state, passage, owner, owner.passage, key, true))) admission = passage
          else limit = Math.min(limit, Math.max(state.pose.distanceM, passage.entryM - .3))
        }
        const move = atDistance(state.plan, state.playhead, Math.min(nominal, state.playhead + dt), limit)
        const offsetLength = Math.hypot(state.offsetX, state.offsetY)
        // Rejoining a retreat is physical movement, even while schedule
        // distance is held. A frozen neighbour can block that rejoin while
        // also needing this bus to move: include both movements in the same
        // swept-body check instead of freezing every clearance manoeuvre.
        const rejoin = state.clearance?.x === 0 && state.clearance.y === 0 ||
          !insideLane(move.pose, state.offsetX, state.offsetY)
        if (rejoin && offsetLength > .01 && (!state.recoveryYield || members.has(this.states.get(state.recoveryYield.id)!))) {
          if (move.pose.distanceM > state.pose.distanceM + .001) {
            // Keep a longitudinal retreat aligned with its lane through a
            // curve. A fixed world vector would become a lateral excursion
            // and forbid the very turn needed to make room for rejoining.
            const rotated = (fraction: number) => {
              const time = state.playhead + (move.time - state.playhead) * fraction, pose = state.plan.sample(time)
              const angle = (pose.vehicle.bearing - state.pose.vehicle.bearing) * Math.PI / 180
              const x = state.offsetX * Math.cos(angle) + state.offsetY * Math.sin(angle)
              const y = state.offsetY * Math.cos(angle) - state.offsetX * Math.sin(angle)
              return { time, pose, x, y }
            }
            const fits = (p: ReturnType<typeof rotated>) => Math.hypot(p.x - state.offsetX, p.y - state.offsetY) <= LANE_ADJUST_MPS * dt && insideLane(p.pose, p.x, p.y)
            let turn = rotated(1)
            if (!fits(turn)) {
              // A long retreat needs more offset rotation at a tight corner.
              // Reduce forward pace instead of replacing the turn with a
              // rejoin that would be undone by the next retreat attempt.
              let lo = 0, hi = 1
              for (let i = 0; i < 12; i++) {
                const mid = (lo + hi) / 2
                if (fits(rotated(mid))) lo = mid
                else hi = mid
              }
              turn = rotated(lo)
            }
            if (turn.pose.distanceM > state.pose.distanceM + .001 && fits(turn)) {
              return { state, admission, time: turn.time, pose: sampleOffset(state, turn.time, turn.x, turn.y), x: turn.x, y: turn.y }
            }
          }
          const scale = Math.max(0, 1 - LANE_ADJUST_MPS * dt / offsetLength)
          const x = state.offsetX * scale, y = state.offsetY * scale
          return { state, admission: undefined, time: state.playhead, pose: sampleOffset(state, state.playhead, x, y), x, y }
        }
        if (!insideLane(move.pose, state.offsetX, state.offsetY)) return {
          state, admission: undefined, time: state.playhead, pose: state.pose, x: state.offsetX, y: state.offsetY,
        }
        return { state, admission, ...move, x: state.offsetX, y: state.offsetY }
      }
      const moves = group.map(state => ({ ...makeMove(state), holdOffset: false }))
      const rootCount = moves.length
      const roots = new Set(group)
      const proposals = moves.map(m => ({ ...m }))
      type Move = typeof moves[number]
      const progress = (m: Move) => m.pose.distanceM - m.state.pose.distanceM + Math.hypot(m.x - m.state.offsetX, m.y - m.state.offsetY)
      const sampleMove = (m: Move, f: number) => sampleOffset(m.state, m.state.playhead + (m.time - m.state.playhead) * f,
        m.state.offsetX + (m.x - m.state.offsetX) * f, m.state.offsetY + (m.y - m.state.offsetY) * f)
      const laneSafe = (m: Move, pose: BusTrafficSample, f: number) => {
        const overflow = laneOverflow(pose, m.state.offsetX + (m.x - m.state.offsetX) * f, m.state.offsetY + (m.y - m.state.offsetY) * f)
        return overflow <= .02 || overflow < laneOverflow(m.state.pose, m.state.offsetX, m.state.offsetY) - .001
      }
      let mergeOrder: { first: State; second: State } | undefined
      const pause = (index: number, blocker: string) => {
        const move = moves[index]
        move.time = move.state.playhead; move.pose = move.state.pose
        move.x = move.state.offsetX; move.y = move.state.offsetY
        move.state.convoyBlockedBy = blocker
      }
      if (moves.length === 2) {
        const [a, b] = moves, pa = body(a.state.pose.vehicle), pb = body(b.state.pose.vehicle)
        if (sameFlow(pa, pb)) {
          // At a merge, allowing the follower a few apparently clear metres
          // can trap the leader's tail at the next bend. If either bus can
          // clear a whole body length while its neighbour waits, keep that
          // order before considering simultaneous creeping.
          const ahead = (pb.x - pa.x) * (pa.fx + pb.fx) + (pb.y - pa.y) * (pa.fy + pb.fy)
          for (const index of ahead >= 0 ? [1, 0] : [0, 1]) {
            const move = moves[index], other = moves[1 - index]
            if (move.pose.distanceM <= move.state.pose.distanceM + .001) continue
            const path = this.turnPath(move.state), end = move.state.pose.distanceM + 14
            if (path.at(-1)!.distanceM < end) continue
            if (path.filter(p => p.distanceM <= end + TURN_SAMPLE_M).some(p =>
              overlap(p.body, body(other.state.pose.vehicle), BODY_CLEARANCE_M))) continue
            pause(1 - index, move.state.plan.id)
            mergeOrder = { first: move.state, second: other.state }
            break
          }
        }
      }
      const pacePair = (a: number, b: number): boolean => {
        const aa = moves[a], bb = moves[b]
        const ad = progress(aa), bd = progress(bb)
        if (ad < .001 || bd < .001) return false
        // Adjacent lanes have different turn radii. Equal-distance steps can
        // collide, while freezing either bus also blocks the other's tail.
        // Try unequal forward paces before stopping a whole member. Reductions
        // are monotonic; the outer loop still checks every outside obstacle.
        const fractions = [1, .75, .5, .25, .125, .0625, .03125, .015625, 0]
        const choices = fractions.flatMap(fa => fractions.map(fb => ({ fa, fb, progress: ad * fa + bd * fb })))
          .filter(c => c.progress > .001 && (c.fa < 1 || c.fb < 1)).sort((a, b) => b.progress - a.progress)
        for (const { fa, fb } of choices) {
          if (![1, .25, .5, .75].every(f => {
            const p = sampleMove(aa, fa * f), q = sampleMove(bb, fb * f)
            return laneSafe(aa, p, fa * f) && laneSafe(bb, q, fb * f) &&
              !busesConflict(p.vehicle, q.vehicle, convoyClearance)
          })) continue
          for (const [move, fraction] of [[aa, fa], [bb, fb]] as const) {
            move.pose = sampleMove(move, fraction)
            move.time = move.state.playhead + (move.time - move.state.playhead) * fraction
            move.x = move.state.offsetX + (move.x - move.state.offsetX) * fraction
            move.y = move.state.offsetY + (move.y - move.state.offsetY) * fraction
          }
          return true
        }
        return false
      }
      let clear = false
      // A sequential update sees every neighbour frozen. At a tight merge,
      // two buses can each be blocked by the other's old footprint even though
      // moving together is clear. Validate the whole convoy at matching times.
      for (let attempt = 0; attempt < 64; attempt++) {
        let changed = false
        sweep: for (const fraction of [.25, .5, .75, 1]) {
          const poses = moves.map(m => sampleMove(m, fraction))
          for (let a = 0; a < poses.length; a++) {
            if (!laneSafe(moves[a], poses[a], fraction)) {
              if (progress(moves[a]) <= .001) break sweep
              pause(a, moves[a].state.plan.id); changed = true; break sweep
            }
            for (let b = a + 1; b < poses.length; b++) {
              const pa = body(poses[a].vehicle), pb = body(poses[b].vehicle)
              if (Math.abs(pa.x - pb.x) > 40 || Math.abs(pa.y - pb.y) > 40) continue
              if (!busesConflict(poses[a].vehicle, poses[b].vehicle, convoyClearance)) continue
              const movingA = progress(moves[a]) > .001
              const movingB = progress(moves[b]) > .001
              if (!movingA && !movingB) break sweep
              if (pacePair(a, b)) { changed = true; break sweep }
              const ahead = (pb.x - pa.x) * (pa.fx + pb.fx) + (pb.y - pa.y) * (pa.fy + pb.fy)
              const rear = !movingA ? b : !movingB ? a : ahead >= 0 ? a : b
              pause(rear, moves[rear === a ? b : a].state.plan.id)
              changed = true; break sweep
            }
            const outside = occupancy.near(body(poses[a].vehicle), 40, true).find(other => !members.has(other) &&
              (busesConflict(poses[a].vehicle, other.pose.vehicle, BODY_CLEARANCE_M) || claimBlocks(other, body(poses[a].vehicle))))
            if (!outside) continue
            if (outside.stalledSec >= 2 && dependsOnGroup(outside.plan.id)) {
              members.add(outside); group.push(outside); visited.add(outside)
              const proposal = { ...makeMove(outside), holdOffset: false }
              moves.push(proposal)
              if (proposals.length < MAX_RECOVERY_VEHICLES) proposals.push({ ...proposal })
            } else {
              if (progress(moves[a]) <= .001) break sweep
              pause(a, outside.plan.id)
            }
            changed = true; break sweep
          }
          if (fraction === 1) clear = true
        }
        if (!changed) break
      }
      if (!clear || !moves.slice(0, rootCount).some(m => m.pose.distanceM - m.state.pose.distanceM > .001)) {
        // Pairwise reductions can freeze a three-way crossing: fixing A/B
        // first may remove the pace that B/C needs. Search a small joint set
        // of forward paces and retreat rejoins, checking all bodies together.
        // Offset-only movement can oscillate forever without clearing a bus.
        // Also search when a group can adjust its position but cannot advance.
        // A dependent queue may have joined the sweep above. Keep that queue
        // stationary for this local search instead of disabling recovery when
        // it grows beyond four buses. Its bodies still constrain every choice.
        let localProposals = proposals
        if (group.length > MAX_RECOVERY_VEHICLES) {
          // Include the queued followers added by the sweep: they may need
          // room farther back even when the original cycle was only a pair.
          // Rotate through clusters instead of fixing the same front four.
          // Other members stay fixed, so this is still a local body sweep.
          const eligible = group.filter(state => !(state.recoveryYield && state.clearance &&
            Math.hypot(state.clearance.x, state.clearance.y) > .01))
          const turning = eligible.filter(state => Math.hypot(state.offsetX, state.offsetY) > .01 ||
            state.leaderId && this.states.has(state.leaderId) && !sameFlow(body(state.pose.vehicle), body(this.states.get(state.leaderId)!.pose.vehicle)))
          const anchors = turning.length ? turning : eligible
          if (!anchors.length) continue
          const anchor = anchors[this.recoverySequence++ % anchors.length], p = body(anchor.pose.vehicle)
          const distance = (state: State) => { const q = body(state.pose.vehicle); return Math.hypot(p.x - q.x, p.y - q.y) }
          localProposals = eligible.filter(state => distance(state) < 40).sort((a, b) => distance(a) - distance(b)).slice(0, MAX_RECOVERY_VEHICLES)
            .map(state => ({ ...makeMove(state), holdOffset: false }))
        }
        // A retreat can need a follower to move even when the forward/rejoin
        // proposal never touches it. Include nearby dependent followers before
        // choosing offset variants, otherwise they remain frozen obstacles
        // outside the solver that needs them to make room.
        if (rootCount <= MAX_RECOVERY_VEHICLES && localProposals.length < MAX_RECOVERY_VEHICLES) {
          const neighbours = new Map<State, number>()
          for (const move of localProposals) {
            const p = body(move.state.pose.vehicle)
            for (const other of occupancy.near(p, 16)) {
              if (members.has(other) || other.stalledSec < 2 || !dependsOnGroup(other.plan.id)) continue
              const q = body(other.pose.vehicle), distance = Math.hypot(p.x - q.x, p.y - q.y)
              if (distance < 16) neighbours.set(other, Math.min(neighbours.get(other) ?? Infinity, distance))
            }
          }
          const nearby = [...neighbours].sort((a, b) => a[1] - b[1])
          // A farther follower may block the retreat while the nearest one
          // is beside it. Rotate the subset while retaining the search bound.
          const cursor = nearby.length ? Math.floor((group[0].nominal + dt * stepIndex) / 2) % nearby.length : 0
          const candidates = [...nearby.slice(cursor), ...nearby.slice(0, cursor)]
          for (const [state] of candidates.slice(0, MAX_RECOVERY_VEHICLES - localProposals.length)) {
            // The earlier sweep covered only the old group. No proposal for
            // this larger group may be applied unless the joint search passes.
            clear = false
            members.add(state); group.push(state); visited.add(state)
            const proposal = { ...makeMove(state), holdOffset: false }
            moves.push({ ...proposal }); localProposals.push(proposal)
          }
        }
        const localMembers = new Set(localProposals.map(m => m.state))
        const fractions = [1, .75, .5, .25, .125, .0625, .03125, .015625, 0]
        const clearance = convoyClearance
        const choices = localProposals.map(proposal => {
          const state = proposal.state, variants = [proposal]
          const length = Math.hypot(state.offsetX, state.offsetY)
          if (length > .01 && (!state.recoveryYield || members.has(this.states.get(state.recoveryYield.id)!))) {
            const scale = Math.max(0, 1 - LANE_ADJUST_MPS * dt / length)
            const x = state.offsetX * scale, y = state.offsetY * scale
            variants.push({ ...proposal, admission: undefined, time: state.playhead, x, y,
              pose: sampleOffset(state, state.playhead, x, y) })
          }
          if (!state.passage?.keys.some(key => key.startsWith('n')) &&
              (!state.recoveryYield || members.has(this.states.get(state.recoveryYield.id)!))) {
            const p = body(state.pose.vehicle), step = LANE_ADJUST_MPS * dt
            for (const angle of [Math.PI, .75 * Math.PI, -.75 * Math.PI, .5 * Math.PI, -.5 * Math.PI]) {
              const x = state.offsetX + (p.fx * Math.cos(angle) + p.fy * Math.sin(angle)) * step
              const y = state.offsetY + (p.fy * Math.cos(angle) - p.fx * Math.sin(angle)) * step
              const along = x * p.fx + y * p.fy, side = x * p.fy - y * p.fx
              // Leave room for a crossing vehicle and its turning tail: at
              // most two displayed lengths, still swept against followers
              // and bounded laterally by this carriageway's usable lanes.
              if (along < -p.half * 4 || along > MAX_LANE_ADJUST_M || Math.abs(side) > MAX_LANE_ADJUST_M ||
                  !insideLane(state.pose, x, y)) continue
              variants.push({ ...proposal, admission: undefined, time: state.playhead, x, y, holdOffset: true,
                pose: sampleOffset(state, state.playhead, x, y) })
            }
          }
          return variants.flatMap(variant => fractions.map(f => {
            const move = { ...variant, time: state.playhead + (variant.time - state.playhead) * f,
              x: state.offsetX + (variant.x - state.offsetX) * f, y: state.offsetY + (variant.y - state.offsetY) * f,
              pose: sampleMove(variant, f) }
            const sweep = [.25, .5, .75, 1].map(fraction => ({ pose: sampleMove(move, fraction), fraction }))
            // A held retreat must not win points for undoing itself on the
            // next frame. Prefer continuing it until another member advances;
            // necessary rejoins remain available after the hold or lane change.
            const offsetProgress = state.pose.distanceM < state.rejoinAfterM && insideLane(state.pose, state.offsetX, state.offsetY)
              ? Math.hypot(move.x, move.y) - length : Math.hypot(move.x - state.offsetX, move.y - state.offsetY)
            return { move, score: move.pose.distanceM - state.pose.distanceM + offsetProgress * .05, sweep }
          })).filter(choice => choice.sweep.every(({ pose, fraction }) => laneSafe(choice.move, pose, fraction) &&
            !occupancy.near(body(pose.vehicle), 40, true).some(other => !localMembers.has(other) &&
              (busesConflict(pose.vehicle, other.pose.vehicle, members.has(other) ? clearance : BODY_CLEARANCE_M) || !members.has(other) && claimBlocks(other, body(pose.vehicle))))))
            .sort((a, b) => b.score - a.score)
        })
        type Choice = typeof choices[number][number]
        const selected: Choice[] = [], compatible = new Map<Choice, Map<Choice, boolean>>()
        let best: Choice[] | undefined, bestScore = .001, visits = 0
        const search = (index: number, score: number) => {
          if (++visits > 20000 || score + choices.slice(index).reduce((sum, c) => sum + (c[0]?.score ?? 0), 0) <= bestScore) return
          if (index === choices.length) {
            // Vacate one original blocking approach at a time. Its queued
            // followers may retreat together to create room; moving both
            // original approaches backwards would preserve the interlock.
            if (!selected.some(c => c.move.pose.distanceM - c.move.state.pose.distanceM > .001) &&
                selected.filter(c => roots.has(c.move.state) && progress(c.move) > .001).length > 1) return
            best = [...selected]; bestScore = score; return
          }
          for (const choice of choices[index]) {
            if (!selected.every(other => {
              let pairs = compatible.get(choice)
              if (!pairs) { pairs = new Map(); compatible.set(choice, pairs) }
              if (!pairs.has(other)) pairs.set(other, choice.sweep.every((point, i) =>
                !busesConflict(point.pose.vehicle, other.sweep[i].pose.vehicle, clearance)))
              return pairs.get(other)!
            })) continue
            selected.push(choice); search(index + 1, score + choice.score); selected.pop()
          }
        }
        search(0, 0)
        if (best) {
          for (let i = 0; i < moves.length; i++) pause(i, localProposals[0].state.plan.id)
          for (const choice of best) Object.assign(moves.find(m => m.state === choice.move.state)!, choice.move)
          clear = true
          if (clearance < CONVOY_CLEARANCE_M) for (const state of group) state.tightConvoyUntilM ??= state.pose.distanceM + 26
        }
      }
      if (!clear || !moves.some(m => progress(m) > .001)) continue
      if (mergeOrder && moves.some(m => m.state === mergeOrder!.first && m.pose.distanceM > m.state.pose.distanceM + .001)) {
        // The yielding member must not retain a swept corridor across the
        // departing leader; doing so would recreate the same permission loop
        // on the next frame and let the follower creep back into the merge.
        mergeOrder.second.turnClaim = undefined
        occupancy.reserve(mergeOrder.second)
      }
      for (const move of moves) {
        const state = move.state
        // An internal retreat promise must not deadlock its own beneficiary.
        // Replace it only after the entire closed group's simultaneous sweep
        // has succeeded; an outside beneficiary still retains its priority.
        if (state.recoveryYield && members.has(this.states.get(state.recoveryYield.id)!) &&
            progress(move) > .001) state.recoveryYield = undefined
        if (move.admission && move.pose.distanceM > state.pose.distanceM + .001) this.holdPassage(state, move.admission)
        if (progress(move) > .001) state.convoyBlockedBy = undefined
        state.speed = progress(move) / dt
        state.convoySpeed = state.speed
        if (Math.hypot(move.x - state.offsetX, move.y - state.offsetY) > 1e-6) {
          state.offsetX = move.x; state.offsetY = move.y
          state.path = undefined; state.exitPose = undefined; state.turnClaim = undefined; state.passageShapes = undefined
          state.clearance = !move.holdOffset && Math.hypot(move.x, move.y) > .01 ? { x: 0, y: 0 } : undefined
          if (move.holdOffset) {
            state.rejoinAfterM = move.pose.distanceM + CLEARANCE_HOLD_M
            state.cautiousUntilM = state.rejoinAfterM + Math.hypot(move.x, move.y) * YIELD_SPEED_MPS / REJOIN_MPS + 2
          }
        }
        state.playhead = move.time; state.pose = move.pose
        if (state.speed > .01) state.stalledSec = 0
        occupancy.put(state)
      }
    }
  }
  private initialPassage(state: State, occupancy: Occupancy): boolean {
    const passage = state.plan.passageAt?.(state.pose.distanceM)
    if (!passage || state.pose.distanceM < passage.entryM) return true
    if (this.extendedLayover(state) && !passage.keys.some(key => key.startsWith('n'))) return true
    return this.claimPassage(state, passage, occupancy)
  }
  private extendedLayover(state: State): boolean {
    if (state.pose.vehicle.busMotion?.phase !== 'stopped') return false
    const later = state.plan.sample(state.playhead + 30)
    return later.vehicle.busMotion?.phase === 'stopped' && Math.abs(later.distanceM - state.pose.distanceM) < .001
  }
  private claimPassage(state: State, passage: BusPassage, occupancy?: Occupancy): boolean {
    // Acquire every conflicting zone before entry. Arrival priority applies
    // between approaches; it must never reserve a junction against the front
    // of the requester's own queue.
    if (passage.zones) {
      const zones = passage.zones.filter(zone => zone.exitM > state.pose.distanceM)
      const keys = passage.keys.filter(key => zones.some(zone => zone.key === key))
      if (!keys.length) return true
      passage = { ...passage, keys, zones }
    }
    const narrow = passage.keys.some(key => key.startsWith('n'))
    state.waitingFor = undefined; state.waitReason = undefined
    if (state.passage) return true
    if (state.requestOrder && state.pose.distanceM < passage.entryM) {
      const front = body(state.pose.vehicle)
      const behind = (other: State) => {
        const rear = other.footprint ?? body(other.pose.vehicle), dx = front.x - rear.x, dy = front.y - rear.y
        return sameFlow(front, rear) && Math.hypot(dx, dy) < 100 && dx * rear.fx + dy * rear.fy > 0 &&
          Math.abs(dx * rear.fy - dy * rear.fx) < front.width + rear.width + .5
      }
      const waitsForApplicant = (waiter: State): boolean => {
        const seen = new Set<State>()
        let cursor: State | undefined = waiter
        while (cursor && !seen.has(cursor)) {
          if (cursor === state) return true
          seen.add(cursor)
          const id: string | undefined = cursor.waitingFor ?? cursor.leaderId
          cursor = id ? this.states.get(id) : undefined
        }
        return false
      }
      const earlier = passage.keys.flatMap(key => (this.junctionWaiters.get(key) ?? []).filter(waiter =>
        waiter.state !== state && this.states.get(waiter.state.plan.id) === waiter.state && !waiter.state.passage &&
        waiter.state.requestOrder > 0 && waiter.state.requestOrder < state.requestOrder &&
        // A request cannot prevent the very queue/exit it depends on from
        // clearing. Follow the complete dependency chain: a curved three-bus
        // queue or several linked approaches need not be direct neighbours.
        // Only FIFO priority is bypassed; holders, exits and body sweeps still
        // decide admission, and narrow streets remain exclusive.
        !(!narrow && waitsForApplicant(waiter.state)) &&
        // A request with a blocked exit is not ready to enter. Holding FIFO
        // priority across every arm can stop the other traffic needed to
        // drain that exit. Keep its arrival ticket, but let a ready approach
        // proceed while the older exit is still physically unavailable.
        !(!narrow && occupancy && waiter.state.waitReason === 'exit-space' && waiter.state.exitPose &&
          occupancy.blocked(waiter.state.exitPose.pose, waiter.state)) &&
        !behind(waiter.state) &&
        !this.canSharePassage(state, passage, waiter.state, waiter.passage, key)))
        .sort((a, b) => a.state.requestOrder - b.state.requestOrder)[0]
      if (earlier) { state.waitingFor = earlier.state.plan.id; state.waitReason = 'arrival-order'; return false }
    }
    if (passage.keys.some(key => [...(this.junctionOwners.get(key)?.keys() ?? [])].some(id => {
      if (id === state.plan.id) return false
      const owner = this.states.get(id)
      if (!narrow && owner?.passage && this.canSharePassage(state, passage, owner, owner.passage, key, true)) return false
      if (!narrow && owner?.passage?.zones) {
        const p = body(state.pose.vehicle), q = body(owner.pose.vehicle)
        const dx = p.x - q.x, dy = p.y - q.y
        const entry = Math.min(...owner.passage.zones.filter(z => z.key === key).map(z => z.entryM))
        if (owner.pose.distanceM < entry && sameFlow(p, q) &&
            dx * q.fx + dy * q.fy > 0 && Math.hypot(dx, dy) < 100 && Math.abs(dx * q.fy - dy * q.fx) < 3.2) {
          // A stop inside a linked junction can put an unreserved bus ahead
          // of a holder. Relinquish only the holder's unentered zones; keeping
          // those future claims would reserve a turn against its own leader.
          const relinquished = owner.passage.keys.filter(k => owner.passage!.zones!.filter(z => z.key === k).every(z => z.entryM > owner.pose.distanceM))
          const until = Math.min(...owner.passage.zones.filter(z => relinquished.includes(z.key!)).map(z => z.entryM))
          for (const k of relinquished) this.junctionOwners.get(k)?.delete(id)
          owner.passage = { ...owner.passage, keys: owner.passage.keys.filter(k => !relinquished.includes(k)),
            zones: owner.passage.zones.filter(z => !relinquished.includes(z.key!)), exitM: Math.min(owner.passage.exitM, until) }
          owner.turnClaim = undefined
          return false
        }
      }
      state.waitingFor = id; state.waitReason = `owner:${key}`; return true
    }))) return false
    if (occupancy) {
      const p = body(state.pose.vehicle)
      // A rear vehicle must never reserve the junction against the front of
      // its own queue. Different bus routes can share the same approach lane.
      const front = occupancy.near(p, 60).find(other => {
        if (other === state) return false
        const q = body(other.pose.vehicle), dx = q.x - p.x, dy = q.y - p.y
        const along = dx * p.fx + dy * p.fy, side = Math.abs(dx * p.fy - dy * p.fx)
        return sameFlow(p, q) && along > 0 && along < passage.entryM - state.pose.distanceM + 8 && side < p.width + q.width + .5
      })
      if (front) { state.waitingFor = front.plan.id; state.waitReason = 'queue-front'; return false }
      // Leave room beyond the junction before admitting another bus. Linked
      // junction ids are acquired together; the body sweep still checks turns.
      const exitDistance = Math.min(passage.exitM, ...(passage.zones ?? []).filter(z => z.exitM > state.pose.distanceM + 1).map(z => z.exitM))
      if (state.exitPose?.distanceM !== exitDistance) {
        let high = state.playhead + 30
        while (high < state.playhead + 1200 && state.plan.sample(high).distanceM < exitDistance + 8) high += 30
        state.exitPose = { distanceM: exitDistance, pose: atDistance(state.plan, state.playhead, high, exitDistance + 8).pose }
      }
      const exit = state.exitPose.pose
      const blocker = occupancy.blocker(exit, state)
      if (blocker) { state.waitingFor = blocker.plan.id; state.waitReason = 'exit-space'; return false }
    }
    this.holdPassage(state, passage)
    return true
  }
  private holdPassage(state: State, passage: BusPassage): void {
    for (const key of passage.keys) {
      let owners = this.junctionOwners.get(key)
      if (!owners) { owners = new Map(); this.junctionOwners.set(key, owners) }
      owners.set(state.plan.id, passage.approaches?.[key] ?? state.pose.vehicle.bearing)
    }
    state.passage = passage; state.waitingFor = undefined; state.waitReason = undefined
  }
  private canSharePassage(a: State, ap: BusPassage, b: State, bp: BusPassage, key: string, checkRemaining = false): boolean {
    const shape = (state: State, passage: BusPassage) => {
      const zones = passage.zones?.filter(z => z.key === key)
      if (!zones?.length) return
      const entryM = Math.min(...zones.map(z => z.entryM)), exitM = Math.max(...zones.map(z => z.exitM)) + 8
      const cached = state.passageShapes?.get(key)
      if (cached?.entryM === entryM && cached.exitM === exitM) return cached
      let low = Math.max(0, state.playhead - 120), high = state.playhead + 120
      while (low > 0 && state.plan.sample(low).distanceM > entryM) low = Math.max(0, low - 120)
      while (high < state.playhead + 1200 && state.plan.sample(high).distanceM < exitM) high += 120
      const at = (d: number) => body(atDistance(state.plan, low, high, d).pose.vehicle)
      const landmarks = [entryM, (entryM + exitM) / 2, exitM].map(at)
      const count = Math.max(1, Math.ceil((exitM - entryM) / 2))
      const points = Array.from({ length: count + 1 }, (_, i) => at(entryM + (exitM - entryM) * i / count))
      const result: PassageShape = { entryM, exitM, landmarks, points, compatible: new WeakMap() }
      state.passageShapes ??= new Map()
      state.passageShapes.set(key, result)
      return result
    }
    const aa = shape(a, ap), bb = shape(b, bp)
    if (!aa || !bb) return false
    // Past turns no longer conflict with a bus departing a stop inside a
    // junction. Check the remaining swept traces before consulting the full
    // passage cache; the physical following guard still keeps their spacing.
    if (checkRemaining && (a.pose.distanceM > aa.entryM || b.pose.distanceM > bb.entryM)) {
      const remaining = (s: State, shape: PassageShape) => [body(s.pose.vehicle), ...shape.points.filter((_, i) =>
        shape.entryM + (shape.exitM - shape.entryM) * i / (shape.points.length - 1) > s.pose.distanceM)]
      const ar = remaining(a, aa), br = remaining(b, bb)
      if (ar.every(p => br.every(q => Math.abs(p.z - q.z) > 7 || !overlap(p, q, 1) || p.fx * q.fx + p.fy * q.fy > .97))) return true
    }
    const cached = aa.compatible.get(bb)
    if (cached !== undefined) return cached
    const similar = aa.landmarks.every((p, i) => Math.hypot(p.x - bb.landmarks[i].x, p.y - bb.landmarks[i].y) < 1.5 &&
      p.fx * bb.landmarks[i].fx + p.fy * bb.landmarks[i].fy > .99)
    // Match the complete ordered traces, including short detours and U-turns
    // between landmarks. Equal entry/exit bearings alone do not make a convoy.
    let row = new Uint8Array(bb.points.length)
    if (similar) for (let i = 0; i < aa.points.length; i++) {
      const next = new Uint8Array(bb.points.length), p = aa.points[i]
      for (let j = 0; j < bb.points.length; j++) {
        const q = bb.points[j]
        if (Math.hypot(p.x - q.x, p.y - q.y) < 1.5 && p.fx * q.fx + p.fy * q.fy > .99 &&
            (i === 0 && j === 0 || row[j] || j > 0 && (next[j - 1] || row[j - 1]))) next[j] = 1
      }
      row = next
    }
    const same = similar && row.at(-1) === 1
    const disjoint = !same && aa.points.every(p => bb.points.every(q => Math.abs(p.z - q.z) > 7 || !overlap(p, q, 1)))
    aa.compatible.set(bb, same || disjoint); bb.compatible.set(aa, same || disjoint)
    return same || disjoint
  }
  private shift(state: State, x: number, y: number, occupancy: Occupancy): boolean {
    this.ensureTurnPath(state)
    const oldX = state.offsetX, oldY = state.offsetY
    state.offsetX = x; state.offsetY = y
    const pose = state.plan.sample(state.playhead)
    // A lane drop can leave an existing offset outside the new allowance.
    // Permit continuous movement back inward; requiring the first small step
    // to be fully inside would prevent every subsequent rejoining step.
    if (!insideLane(pose, x, y) && laneOverflow(pose, x, y) >= laneOverflow(pose, oldX, oldY) - 1e-6) {
      state.offsetX = oldX; state.offsetY = oldY; return false
    }
    const candidate = body(pose.vehicle)
    const blocker = occupancy.near(candidate, 40, true).find(other => other !== state &&
      (busesConflict(pose.vehicle, other.pose.vehicle, state.recoveryYield ? recoveryClearance(state) : BODY_CLEARANCE_M) ||
        other.plan.id !== state.recoveryYield?.id && claimBlocks(other, candidate)))
    if (blocker) {
      // A blocked rejoin is a real waiting dependency. Without this edge a
      // whole queue can end at a motionless bus that appears to wait on nobody.
      state.leaderId = blocker.plan.id
      state.offsetX = oldX; state.offsetY = oldY; return false
    }
    state.pose = pose
    state.exitPose = undefined
    state.path = undefined
    // The old swept corridor no longer describes this shifted path. Rebuild
    // and revalidate it before granting another reservation.
    state.turnClaim = undefined
    state.passageShapes = undefined
    return true
  }
}
