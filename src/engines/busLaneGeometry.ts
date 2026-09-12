import type { BusRoadProfile, BusRoadSection } from '../types'

/** Lane zero is nearest the left kerb. OSM lanes counts the entire way: a
 * separately mapped carriageway has its own count, a two-way road does not.
 * Untagged widths use a display estimate, never extra inferred lanes. */
type LaneLayout = { readonly offsets: readonly number[]; readonly estimated: boolean }
const layouts = new WeakMap<BusRoadSection, { forward?: LaneLayout; reverse?: LaneLayout }>()

// Road sections are immutable dataset records. Every vehicle and every swept
// pose can share their directional layout; do not allocate it per sample.
export function busLaneLayout(section: BusRoadSection, returning = false): LaneLayout {
  let cached = layouts.get(section)
  if (!cached) { cached = {}; layouts.set(section, cached) }
  const direction = returning ? 'reverse' : 'forward'
  return cached[direction] ??= buildLaneLayout(section, returning)
}

function buildLaneLayout(section: BusRoadSection, returning: boolean): LaneLayout {
  const estimated = section.widthM === undefined
  // A mismatched one-way match does not establish a lane on either side of
  // the imported trace. Keep its centre unless the route-pair scan found
  // overlapping opposing traces. An unconditional 3.25 m shift can place a
  // separately drawn reverse trace onto the neighbouring carriageway.
  if (section.evidence === 'direction-mismatch' && !section.opposingRouteGeometry) return { offsets: [0], estimated: true }
  if (section.kind === 'unknown' || section.opposingRouteGeometry) return { offsets: [3.25], estimated: true }
  const twoWay = section.kind === 'two-way', total = section.lanes
  if (twoWay && (total === 1 || (section.widthM !== undefined && section.widthM < 5.9))) return { offsets: [0], estimated }
  // An old route traversing a tagged one-way in reverse is not evidence of
  // usable opposing lanes. Keep the conservative legacy fallback.
  if (returning && !twoWay) return { offsets: [3.25], estimated: true }
  const direction = returning
    ? total !== undefined && section.directionalLanes !== undefined ? total - section.directionalLanes : undefined
    : section.directionalLanes
  let count = twoWay ? direction ?? Math.max(1, Math.floor((total ?? 2) / 2)) : direction ?? total ?? 1
  if (count < 1 || (total !== undefined && count > total - (twoWay ? 1 : 0))) count = 1
  // An odd total without directional tags leaves the unassigned centre lane
  // unused. A tagged narrow width must not squeeze parallel bus bodies in.
  const physicalTotal = total ?? (twoWay ? count * 2 : count)
  const width = section.widthM ?? physicalTotal * 3.5
  const laneWidth = width / physicalTotal
  if (laneWidth < 2.95) return { offsets: [twoWay ? width / 4 : 0], estimated }
  if (estimated && total === undefined && direction === undefined) return { offsets: [twoWay ? 3.25 : 0], estimated }
  const offsets = Array.from({ length: count }, (_, i) => width / 2 - laneWidth * (i + .5))
  const usable = offsets.filter(offset => offset >= (section.minLaneOffsetM ?? -Infinity))
  return { offsets: usable.length ? usable : offsets.slice(0, 1), estimated }
}

export function busLaneOffset(section: BusRoadSection, lane = 0, returning = false): number {
  const { offsets } = busLaneLayout(section, returning)
  return offsets[Math.min(Math.max(0, lane), offsets.length - 1)]
}

/** Preference selects the initial lane only, not a lane to return to. */
export type BusLanePlan = { preference: number; stops: readonly number[] }
const courses = new WeakMap<object, { line: object; profile?: BusRoadProfile; lengthM: number; returning: boolean; values: Float32Array }>()
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

/** A stable route-distance course that holds its lane after each necessary
 * change. Stops select lane zero; lane drops keep a surviving lane. Neither
 * leaving a stop nor a lane opening restores the initial preference.
 * The traffic controller sweeps this entire course and yields at merges.
 * No animation-frame choice or lateral teleport is involved. */
export function sampleBusLaneCourse(line: object, profile: BusRoadProfile | undefined, lengthM: number,
  progress: number, returning: boolean, roadAt: (metres: number) => BusRoadSection, plan: BusLanePlan): number {
  let cached = courses.get(plan)
  if (!cached || cached.line !== line || cached.profile !== profile || cached.lengthM !== lengthM || cached.returning !== returning) {
    const count = Math.max(1, Math.ceil(lengthM / 2)), step = lengthM / count
    const values = new Float32Array(count + 1), low = new Float32Array(count + 1), high = new Float32Array(count + 1)
    const stops = plan.stops.map(p => (returning ? 1 - p : p) * lengthM).sort((a, b) => a - b)
    let stopIndex = 0, lane = Math.max(0, plan.preference)
    for (let i = 0; i <= count; i++) {
      const metres = i * step
      while (stopIndex < stops.length && stops[stopIndex] < metres - 12) stopIndex++
      const layout = busLaneLayout(roadAt(returning ? lengthM - metres : metres), returning)
      const offsets = layout.offsets
      const atStop = stopIndex < stops.length && Math.abs(stops[stopIndex] - metres) <= 12
      // Carry this choice in travel order, including on the return journey.
      // Precomputation also makes a time seek agree with driving to that point.
      lane = atStop ? 0 : Math.min(lane, offsets.length - 1)
      values[i] = offsets[lane]
      low[i] = atStop ? offsets[0] : offsets.at(-1)!
      high[i] = offsets[0]
    }
    // Limit lateral motion to 4 cm per metre of route progress (~88 m for a
    // lane change). Bound every sample by that road's usable lane centres.
    // Forward passes handle lane openings; backward passes plan lane drops
    // and stop approaches. Adjacent imported centre-line mismatches remain
    // bounded by their conservative road profiles.
    const change = step * .04
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i <= count; i++) values[i] = clamp(clamp(values[i], values[i - 1] - change, values[i - 1] + change), low[i], high[i])
      for (let i = count - 1; i >= 0; i--) values[i] = clamp(clamp(values[i], values[i + 1] - change, values[i + 1] + change), low[i], high[i])
    }
    cached = { line, profile, lengthM, returning, values }; courses.set(plan, cached)
  }
  const at = clamp(returning ? 1 - progress : progress, 0, 1) * (cached.values.length - 1)
  const index = Math.min(Math.floor(at), cached.values.length - 2), fraction = at - index
  return cached.values[index] * (1 - fraction) + cached.values[index + 1] * fraction
}

type LanePoint = { x: number; y: number; fx: number; fy: number }
type BodyPath = { count: number; values: Float32Array }
const bodyPaths = new WeakMap<object, { line: object; profile: BusRoadProfile | undefined; lengthM: number; frontLeadM: number; forward?: BodyPath; reverse?: BodyPath }>()

/** The rear axle follows the front axle at a fixed wheelbase. This makes the
 * body turn continuously through short imported bends instead of rotating it
 * about its centre. Tables use local metres and are reused by every vehicle on
 * the route; the simulation clock and schedule distances remain unchanged. */
export function sampleBusLaneBody(line: object, profile: BusRoadProfile | undefined, lengthM: number,
  progress: number, returning: boolean, sampleFront: (distanceM: number) => LanePoint, frontLeadM = 3.4, variant: object = line): LanePoint {
  if (!(lengthM > 0)) return sampleFront(0)
  let cache = bodyPaths.get(variant)
  if (!cache || cache.line !== line || cache.profile !== profile || cache.lengthM !== lengthM || cache.frontLeadM !== frontLeadM) {
    cache = { line, profile, lengthM, frontLeadM }; bodyPaths.set(variant, cache)
  }
  const direction = returning ? 'reverse' : 'forward'
  let path = cache[direction]
  if (!path) {
    const count = Math.max(1, Math.ceil(lengthM / 2)), values = new Float32Array((count + 1) * 4)
    let rearX = 0, rearY = 0
    for (let i = 0; i <= count; i++) {
      const distance = (returning ? 1 - i / count : i / count) * lengthM + (returning ? -frontLeadM : frontLeadM)
      const front = sampleFront(distance)
      if (i === 0) { rearX = front.x - front.fx * 6.8; rearY = front.y - front.fy * 6.8 }
      const dx = front.x - rearX, dy = front.y - rearY, length = Math.hypot(dx, dy)
      let fx = length > .0001 ? dx / length : front.fx, fy = length > .0001 ? dy / length : front.fy
      if (i > 0 && (front.x - fx * 6.8 - rearX) * fx + (front.y - fy * 6.8 - rearY) * fy < -.001) {
        // Very short imported U-bends can put the old rear axle ahead of the
        // moving front. A distance-only projection then drags it backwards
        // indefinitely. Recover its trailing direction from the driven path;
        // retain the fixed wheelbase and ordinary follower on normal bends.
        const trail = sampleFront(distance + (returning ? 6.8 : -6.8))
        const tx = front.x - trail.x, ty = front.y - trail.y, span = Math.hypot(tx, ty)
        fx = span > .1 ? tx / span : front.fx; fy = span > .1 ? ty / span : front.fy
      }
      rearX = front.x - fx * 6.8; rearY = front.y - fy * 6.8
      values.set([(front.x + rearX) / 2, (front.y + rearY) / 2, fx, fy], i * 4)
    }
    path = { count, values }; cache[direction] = path
  }
  const at = Math.max(0, Math.min(1, returning ? 1 - progress : progress)) * path.count
  const index = Math.min(Math.floor(at), path.count - 1), fraction = at - index, values = path.values
  const component = (axis: number) => values[index * 4 + axis] * (1 - fraction) + values[(index + 1) * 4 + axis] * fraction
  const fx = component(2), fy = component(3), length = Math.hypot(fx, fy) || 1
  return { x: component(0), y: component(1), fx: fx / length, fy: fy / length }
}
