import type { BusRoadProfile, BusRoadSection } from '../types'

// Mirrored by the offline generator and Python validator. Geometry edits must
// invalidate road spans rather than assign old classifications to new vertices.
export function busGeometryKey(coords: number[][]): string {
  let hash = 2166136261
  for (const point of coords) for (const value of point) hash = Math.imul(hash ^ Math.round(value * 1e6), 16777619)
  return `${coords.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

type CachedProfile = { valid: boolean; sections: BusRoadSection[] }
const cache = new WeakMap<BusRoadProfile, WeakMap<number[][], CachedProfile>>()
const UNKNOWN: BusRoadSection = { start: 0, end: 0, kind: 'unknown', evidence: 'unmatched' }

/** Cached road classification. Widths without an OSM tag remain estimates;
 * lane positioning and junction reservations are handled by separate modules. */
export function sampleBusRoad(
  profile: BusRoadProfile | undefined, coords: number[][], cumKm: Float64Array, targetKm: number,
): BusRoadSection {
  if (!profile) return UNKNOWN
  let byGeometry = cache.get(profile)
  if (!byGeometry) { byGeometry = new WeakMap(); cache.set(profile, byGeometry) }
  let cached = byGeometry.get(coords)
  if (!cached) {
    const sections = profile.sections
    const valid = profile.version === 1 && profile.geometryKey === busGeometryKey(coords) && sections.length > 0 &&
      sections[0].start === 0 && sections.at(-1)!.end === coords.length - 1 &&
      sections.every((s, i) => s.end > s.start && s.end < coords.length && (!i || sections[i - 1].end === s.start))
    cached = { valid, sections }
    byGeometry.set(coords, cached)
  }
  if (!cached.valid) return UNKNOWN
  const { sections } = cached
  let lo = 0, hi = sections.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (cumKm[sections[mid].start] <= targetKm) lo = mid
    else hi = mid - 1
  }
  return sections[lo]
}
