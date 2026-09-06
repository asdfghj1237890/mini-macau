// THE PULSE — the machinery behind the bright wave that walks a supply chain
// in order, shared by the WATER and POWER overlays (src/water.ts and
// src/power.ts wrap it under their own names, the way both wrap
// src/focusMode.ts).
//
// The per-edge dash and dot flows show which way each pipe or cable runs;
// only a wave that starts somewhere and arrives somewhere shows what comes
// BEFORE what. So: every edge of a network is cut into chunks by distance
// from the wave's start, each chunk tagged with a bucket number, and MapView
// adds ONE line layer per bucket (filtered on it) whose only per-tick change
// is `line-opacity` — the same no-relayout rule as the phase groups (see
// addPhaseLayers in MapView for why the dash phase is never animated).
// `advancePulse` is the state machine that says which buckets are lit how
// brightly on a given tick.
//
// Distances are metres ALONG the network. Arrival at a node is the shortest
// path from any ROOT — a node nothing flows into: an inlet, a generator, a
// catchment reservoir — by multi-source Dijkstra over the edge graph, so a
// node fed two ways lights when the first water (or power) reaches it, and
// everything downstream continues from there. The street mesh has no graph
// here: its roads already carry a `dist` from the nearest source, so it is
// bucketed by that (distanceBucket) and swept after the trunk wave.
//
// Everything here is pure and network-agnostic; nothing takes a clock.

// The shape of an edge as the wave sees it: an id for the chunk properties,
// the endpoints as node ids, and the geometry in flow order (`from` first).
export interface PulseEdge {
  id: string
  from: string
  to: string
  coordinates: readonly (readonly number[])[]
}

// Bucket length. 400 m per step at two ticks a step (PULSE_STEP_TICKS) walks
// the ~13 km from the Ilha Verde inlet to the Taipa tanks in about 4.5 s —
// slow enough to follow with the eye at city zoom, fast enough that the whole
// story fits one cycle.
export const PULSE_BUCKET_M = 400
// The head and the fading tail behind it, as opacities: bucket `head` gets
// tail[0], `head-1` tail[1], … and the bucket behind the tail is written to 0.
export const PULSE_TAIL: readonly number[] = [1, 0.55, 0.25]
// Ticks per step (a tick is MapView's FLOW_TICK_MS), and the rest at the end
// of a cycle in steps, so the story has a beat of silence before it repeats.
export const PULSE_STEP_TICKS = 2
export const PULSE_REST_STEPS = 10

const EARTH_RADIUS_M = 6371008.8

// Great-circle distance in metres between two [lng, lat] points.
export function haversineM(a: readonly number[], b: readonly number[]): number {
  const toRad = Math.PI / 180
  const dLat = (b[1] - a[1]) * toRad
  const dLng = (b[0] - a[0]) * toRad
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

// Length of an edge along its own vertices — the distance the wave walks. The
// files' `lengthM` is the same number rounded; recomputing keeps the chunk
// boundaries and the node arrivals in exactly one unit.
export function edgeLengthM(edge: PulseEdge): number {
  const c = edge.coordinates
  let m = 0
  for (let i = 1; i < c.length; i++) m += haversineM(c[i - 1], c[i])
  return m
}

// Metres along the network from the nearest ROOT to every node. A root is a
// node nothing flows into. Roots sit at 0 and light first. `extraNodeIds` are
// the network's own non-facility nodes (inlets), so an inlet with no edge at
// all still counts as a root. A node with no route from any root (only
// possible inside a cycle) is absent from the map, and the chunk builder
// treats it as its own start.
export function arrivalDistances(
  edges: readonly PulseEdge[],
  extraNodeIds: Iterable<string> = [],
): Map<string, number> {
  const usable = edges.filter(e => (e.coordinates?.length ?? 0) >= 2)
  const ids = new Set<string>()
  const inbound = new Set<string>()
  for (const e of usable) { ids.add(e.from); ids.add(e.to); inbound.add(e.to) }
  for (const id of extraNodeIds) ids.add(id)
  const dist = new Map<string, number>()
  for (const id of ids) if (!inbound.has(id)) dist.set(id, 0)
  // Dijkstra with a linear scan: a few dozen nodes, so a heap would be noise.
  const settled = new Set<string>()
  for (;;) {
    let best: string | null = null
    let bestD = Infinity
    for (const [id, d] of dist) {
      if (!settled.has(id) && d < bestD) { best = id; bestD = d }
    }
    if (best === null) break
    settled.add(best)
    for (const e of usable) {
      if (e.from !== best) continue
      const nd = bestD + edgeLengthM(e)
      const cur = dist.get(e.to)
      if (cur === undefined || nd < cur) dist.set(e.to, nd)
    }
  }
  return dist
}

// Bucket index of a distance, clamped into the layer budget; null where the
// distance is unknown (a mesh road the outward walk never reached), so the
// filter matches nothing and the road simply never lights.
export function distanceBucket(
  distM: number | null | undefined, bucketM: number, buckets: number,
): number | null {
  if (distM === null || distM === undefined || !Number.isFinite(distM) || distM < 0) return null
  return Math.min(Math.floor(distM / bucketM), buckets - 1)
}

export interface PulseBuild {
  features: GeoJSON.FeatureCollection
  // How many buckets the network actually fills (≤ the layer budget) — the
  // animation walks this far and no further, so a short network does not
  // spend half its cycle sweeping empty layers.
  buckets: number
}

// Every edge cut into chunks of one bucket each. Chunk boundaries fall exactly
// at bucket-length distances from the wave's start (arrival at `from` plus the
// distance along the edge), interpolated onto the segment they land in, so
// consecutive chunks share their boundary vertex and the lit wave has no gaps.
// Vertex order is preserved, `from` end first. `extraProps` lets an overlay
// add its own properties (a pipe's kind, a line's voltage) next to `bucket`.
export function buildPulseFeatures<E extends PulseEdge>(
  edges: readonly E[],
  bucketM: number,
  buckets: number,
  extraProps?: (edge: E) => Record<string, unknown>,
): PulseBuild {
  const features: GeoJSON.Feature[] = []
  const arrival = arrivalDistances(edges)
  let maxBucket = -1
  const emit = (coords: number[][], bucket: number, edge: E) => {
    // A chunk with no extent (a boundary landing exactly on a vertex) would
    // draw as a round-cap dot, so it is dropped rather than emitted.
    if (coords.length < 2) return
    if (coords.every(c => c[0] === coords[0][0] && c[1] === coords[0][1])) return
    const b = Math.min(bucket, buckets - 1)
    if (b > maxBucket) maxBucket = b
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { bucket: b, ...(extraProps ? extraProps(edge) : {}) },
    })
  }
  for (const edge of edges) {
    const c = edge.coordinates
    if (!c || c.length < 2) continue
    const d0 = arrival.get(edge.from) ?? 0
    let bucket = Math.floor(d0 / bucketM)
    let s = 0 // metres along the edge at the start of the current segment
    let chunk: number[][] = [[c[0][0], c[0][1]]]
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1]
      const b = c[i]
      const seg = haversineM(a, b)
      // Walk every bucket boundary that falls strictly inside this segment.
      for (;;) {
        const boundary = (bucket + 1) * bucketM - d0 // edge metres where the next bucket starts
        if (!(seg > 0) || boundary >= s + seg) break
        const t = Math.max(0, (boundary - s) / seg)
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        chunk.push(p)
        emit(chunk, bucket, edge)
        chunk = [p]
        bucket++
      }
      chunk.push([b[0], b[1]])
      s += seg
    }
    emit(chunk, bucket, edge)
  }
  return { features: { type: 'FeatureCollection', features }, buckets: maxBucket + 1 }
}

export type PulsePhase = 'trunk' | 'mesh' | 'rest'

export interface PulseState {
  phase: PulsePhase
  // Bucket index of the wave's head; in `rest`, the number of steps rested.
  head: number
  tick: number
}

export interface PulseCounts {
  trunk: number
  mesh: number
}

export interface PulseWrite {
  group: 'trunk' | 'mesh'
  index: number
  opacity: number
}

// Fresh layers are all at opacity 0, and the first step lights bucket 0.
export function initialPulseState(): PulseState {
  return { phase: 'trunk', head: -1, tick: 0 }
}

// One tick of the wave. Returns the next state and the opacity writes that
// take the layers from the previous tick's picture to this one — at most
// tail.length + 1 of them, and none at all on the ticks between steps.
//
// A phase walks its head from bucket 0 to `count - 1 + tail.length`, so the
// tail fades out past the last bucket instead of being cut off; a phase with
// nothing to light (no network yet; the mesh not loaded, or absent on a phone)
// is skipped in the same step. Rest counts steps and then hands back to the
// trunk. Pure: the caller keeps the state and applies the writes.
export function advancePulse(
  state: PulseState,
  counts: PulseCounts,
  stepTicks: number = PULSE_STEP_TICKS,
  restSteps: number = PULSE_REST_STEPS,
  tail: readonly number[] = PULSE_TAIL,
): { next: PulseState; writes: PulseWrite[] } {
  const tick = state.tick + 1
  if (tick % stepTicks !== 0) return { next: { ...state, tick }, writes: [] }
  let phase = state.phase
  let head = state.head + 1
  // Hop past empty or finished phases. Three phases, so three hops is enough
  // to land somewhere that either lights or rests.
  for (let hop = 0; hop < 3; hop++) {
    if (phase === 'rest') {
      if (head < restSteps) break
      phase = 'trunk'
      head = 0
      continue
    }
    const count = phase === 'trunk' ? counts.trunk : counts.mesh
    if (count > 0 && head < count + tail.length) break
    phase = phase === 'trunk' ? 'mesh' : 'rest'
    head = 0
  }
  const writes: PulseWrite[] = []
  if (phase !== 'rest') {
    const count = phase === 'trunk' ? counts.trunk : counts.mesh
    for (let o = 0; o <= tail.length; o++) {
      const index = head - o
      if (index < 0 || index >= count) continue
      writes.push({ group: phase, index, opacity: o < tail.length ? tail[o] : 0 })
    }
  }
  return { next: { phase, head, tick }, writes }
}
