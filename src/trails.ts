// Walking-trail (IAM 步行徑) helpers shared by MapView, the 2D fallback, the
// legend and the info panel. The colour table, the closed rule and the feature
// builders live here once, so the lines, the swatches and the panel header can
// never disagree.
//
// Unlike the toilets the overlay has a time dimension: IAM publishes each
// suspension as a date window, so whether a trail is closed depends on the
// simulated date (the same YYYY-MM-DD comparison as the road works). The
// `closed` flag is data.gov.mo's tempClose on the day the file was fetched and
// carries no dates, so it counts as closed whatever the simulated date.
import type { Lang } from './i18n'
import type { Trail, TrailKind, TrailPavilion, TrailPost, TrailSpur, TrailSummit, TrailSummitAccess, TrailSuspension, TrailText } from './types'

export const TRAIL_KIND_ORDER: readonly TrailKind[] = ['walk', 'cycle'] as const

// Line colours: lime for the walking trails, sky for the two cycle tracks.
// Deliberately outside the housing (orange/teal/violet) and school hue families
// and brighter than the parish tint, since trails sit on top of both. A closed
// trail is drawn grey and dashed whatever its kind.
export const TRAIL_COLORS: Record<TrailKind, string> = {
  walk: '#84cc16',
  cycle: '#0ea5e9',
}
export const TRAIL_CLOSED_COLOR = '#9ca3af'
// The pavilion marker, a darker lime so it reads as part of the trail family
// without being mistaken for an entrance.
export const TRAIL_PAVILION_COLOR = '#4d7c0f'

// How far ahead the panel announces a suspension that has not started yet.
export const TRAIL_UPCOMING_DAYS = 14
const MS_PER_DAY = 86_400_000

// The summit triangle, a warm brown that reads on both basemaps and apart
// from the lime trail family.
export const TRAIL_SUMMIT_COLOR = '#92400e'

export function trailEntranceIconName(kind: TrailKind): string {
  return `trail-entrance-${kind}`
}
export const TRAIL_PAVILION_ICON = 'trail-pavilion'
export const TRAIL_SUMMIT_ICON = 'trail-summit'

// "158.2 m": the official heights have one decimal, and the unit is the same
// in all three languages.
export function summitHeightText(summit: TrailSummit): string {
  return `${summit.heightM.toFixed(1)} m`
}

// Localised field text. The IAM feed is trilingual, so English readers get the
// English string (the toilets' rule, not the road works' en → pt one).
export function pickTrailText(field: TrailText | undefined, lang: Lang): string {
  if (!field) return ''
  if (lang === 'zh') return field.zh || field.en || field.pt || ''
  if (lang === 'pt') return field.pt || field.en || field.zh || ''
  return field.en || field.pt || field.zh || ''
}

// Name of the feature property holding the name in a language, for a symbol
// layer's text-field (all three forms ride in the feature, so a language change
// is a layout swap rather than a source rebuild).
export function trailLabelField(lang: Lang): string {
  return lang === 'zh' ? 'name_zh' : lang === 'pt' ? 'name_pt' : 'name_en'
}

// The suspension in force on `ymd`, if any.
export function trailSuspensionAt(trail: Trail, ymd: string): TrailSuspension | null {
  return trail.suspensions.find(s => s.from <= ymd && ymd <= s.to) ?? null
}

// The earliest suspension that starts after `ymd` and within `days` of it.
export function upcomingTrailSuspension(trail: Trail, ymd: string, days = TRAIL_UPCOMING_DAYS): TrailSuspension | null {
  const horizon = addDays(ymd, days)
  let best: TrailSuspension | null = null
  for (const s of trail.suspensions) {
    if (s.from > ymd && s.from <= horizon && (!best || s.from < best.from)) best = s
  }
  return best
}

export function isTrailClosed(trail: Trail, ymd: string): boolean {
  return trail.closed || trailSuspensionAt(trail, ymd) !== null
}

function addDays(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + days * MS_PER_DAY
  return new Date(t).toISOString().slice(0, 10)
}

// One MultiLineString per trail. `closed` (on the simulated date) drives the
// grey dash, `color` the stroke, `id` what the click handler looks the trail
// up by; the three names feed the along-line label. Each climb (spur) is one
// more feature with `spur: true`, drawn dotted in the walking colour; its
// `trailId` is the first trail it starts on, which a click opens.
export function buildTrailLineFeatures(trails: Trail[], ymd: string, spurs: TrailSpur[] = []): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const trail of trails) {
    const lines = trail.geometry.lines.filter(line => line.length >= 2)
    if (lines.length === 0) continue
    const closed = isTrailClosed(trail, ymd)
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: lines },
      properties: {
        id: trail.id,
        kind: trail.kind,
        closed,
        color: closed ? TRAIL_CLOSED_COLOR : TRAIL_COLORS[trail.kind],
        name_zh: trail.name.zh,
        name_pt: trail.name.pt || trail.name.en || trail.name.zh,
        name_en: trail.name.en || trail.name.pt || trail.name.zh,
      },
    })
  }
  const present = new Set(trails.map(trail => trail.id))
  for (const spur of spurs) {
    const trailId = spur.trails.find(id => present.has(id))
    const lines = spur.lines.filter(line => line.length >= 2)
    if (!trailId || lines.length === 0) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: lines },
      properties: {
        id: spur.id,
        spur: true,
        trailId,
        kind: 'walk',
        closed: false,
        color: TRAIL_COLORS.walk,
        name_zh: spur.name.zh,
        name_pt: spur.name.pt || spur.name.en || spur.name.zh,
        name_en: spur.name.en || spur.name.pt || spur.name.zh,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// The points along the trails, one source with a `kind` per feature:
// `entrance` (IAM's published entrances, in the trail's colour), `post` (the
// 標距柱 distance posts, labelled with their code at street zoom) and
// `pavilion`. Posts carry their trail's id so a click can open it; a post
// whose trail is not in `trails` (its kind is switched off) is dropped.
//
// Summits are `summit` features, labelled with the name and the height on two
// lines in all three languages; a summit whose trails are all switched off is
// dropped.
export function buildTrailPointFeatures(
  trails: Trail[], posts: TrailPost[], pavilions: TrailPavilion[], ymd: string, summits: TrailSummit[] = [],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const byCode = new Map<string, Trail>()
  for (const trail of trails) {
    if (trail.code) byCode.set(trail.code, trail)
    const closed = isTrailClosed(trail, ymd)
    trail.entrances.forEach((coordinates, index) => {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: { kind: 'entrance', trailId: trail.id, trailKind: trail.kind, index, closed, icon: trailEntranceIconName(trail.kind) },
      })
    })
  }
  for (const post of posts) {
    const trail = byCode.get(post.trail)
    if (!trail) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: post.coordinates },
      properties: { kind: 'post', trailId: trail.id, code: post.code },
    })
  }
  pavilions.forEach((pavilion, index) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pavilion.coordinates },
      properties: { kind: 'pavilion', index, name: pavilion.name ?? '', icon: TRAIL_PAVILION_ICON },
    })
  })
  const present = new Set(trails.map(trail => trail.id))
  for (const summit of summits) {
    if (!summit.access.some(a => present.has(a.trail))) continue
    const height = summitHeightText(summit)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: summit.coordinates },
      properties: {
        kind: 'summit',
        summitId: summit.id,
        icon: TRAIL_SUMMIT_ICON,
        height: summit.heightM,
        name_zh: `${summit.name.zh}\n${height}`,
        name_pt: `${summit.name.pt || summit.name.zh}\n${height}`,
        name_en: `${summit.name.en || summit.name.pt || summit.name.zh}\n${height}`,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// The summits a trail reaches or passes, with how, closest way up first —
// what the panel lists under the trail.
export function trailSummitsFor(summits: TrailSummit[], trail: Trail): { summit: TrailSummit; access: TrailSummitAccess }[] {
  const out: { summit: TrailSummit; access: TrailSummitAccess }[] = []
  for (const summit of summits) {
    const access = summit.access.find(a => a.trail === trail.id)
    if (access) out.push({ summit, access })
  }
  const order = { trail: 0, spur: 1, near: 2 }
  return out.sort((a, b) => order[a.access.via] - order[b.access.via] || b.summit.heightM - a.summit.heightM)
}

// The trail a click on a summit opens: the first of its access entries whose
// trail is on the map (the file lists the closest way up first).
export function summitTrail(summit: TrailSummit, trails: Trail[]): Trail | null {
  for (const access of summit.access) {
    const trail = trails.find(t => t.id === access.trail)
    if (trail) return trail
  }
  return null
}

// ---------------------------------------------------------------------------
// Per-kind visibility. The legend's TRAILS row toggles walking trails and cycle
// tracks separately, so App filters the arrays before they reach MapView — the
// same contract as the religion categories. Distance posts follow their trail;
// the pavilions all stand on walking trails, so they follow `walk`.
// ---------------------------------------------------------------------------

export type TrailKindSet = ReadonlySet<TrailKind>

export const ALL_TRAIL_KINDS: TrailKindSet = new Set(TRAIL_KIND_ORDER)

const LS_TRAIL_KINDS_KEY = 'mini-macau-trails-kinds-on'

// Trails whose kind is switched on. The input array comes back as-is when both
// kinds are on, so the caller's memo keeps its identity.
export function filterTrailsByKind(trails: Trail[], on: TrailKindSet): Trail[] {
  if (TRAIL_KIND_ORDER.every(kind => on.has(kind))) return trails
  return trails.filter(trail => on.has(trail.kind))
}

export function countTrailsByKind(trails: Trail[]): Record<TrailKind, number> {
  const counts: Record<TrailKind, number> = { walk: 0, cycle: 0 }
  for (const trail of trails) if (trail.kind in counts) counts[trail.kind]++
  return counts
}

// Anything unreadable, non-array, or holding unknown ids degrades to "all on"
// rather than hiding the layer.
export function loadTrailKindsOn(): TrailKindSet {
  try {
    const raw = localStorage.getItem(LS_TRAIL_KINDS_KEY)
    if (!raw) return ALL_TRAIL_KINDS
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return ALL_TRAIL_KINDS
    return new Set(TRAIL_KIND_ORDER.filter(kind => arr.includes(kind)))
  } catch {
    return ALL_TRAIL_KINDS
  }
}

// Storage can throw (private mode, quota) — losing the preference is never
// worth breaking the toggle.
export function saveTrailKindsOn(on: TrailKindSet): void {
  try {
    localStorage.setItem(LS_TRAIL_KINDS_KEY, JSON.stringify(TRAIL_KIND_ORDER.filter(kind => on.has(kind))))
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Selection. A click on a line or an entrance opens the trail; a click on a
// distance post or a pavilion opens the trail it stands on and names the point.
// ---------------------------------------------------------------------------

export type TrailPoint =
  | { kind: 'entrance'; index: number }
  | { kind: 'post'; code: string }
  | { kind: 'pavilion'; name: string | null }
  | { kind: 'summit'; summit: TrailSummit }
  | { kind: 'spur'; spur: TrailSpur }

export interface TrailSelection {
  trail: Trail
  point: TrailPoint | null
}

// The trail nearest a point (a pavilion carries no trail id in the GIS). Plain
// equirectangular metres — the trails span a few kilometres.
export function nearestTrail(trails: Trail[], [lng, lat]: [number, number]): { trail: Trail; distanceM: number } | null {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_574
  let best: { trail: Trail; distanceM: number } | null = null
  for (const trail of trails) {
    for (const line of trail.geometry.lines) {
      for (let i = 1; i < line.length; i++) {
        const ax = (line[i - 1][0] - lng) * kx, ay = (line[i - 1][1] - lat) * ky
        const bx = (line[i][0] - lng) * kx, by = (line[i][1] - lat) * ky
        const dx = bx - ax, dy = by - ay
        const len2 = dx * dx + dy * dy
        const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
        const d = Math.hypot(ax + t * dx, ay + t * dy)
        if (!best || d < best.distanceM) best = { trail, distanceM: d }
      }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Hikers. From zoom 19 a 3D figure stands at each entrance of an open walking
// trail, facing the way the trail leads (src/layers/TrailFigure3DLayer.ts).
// ---------------------------------------------------------------------------

// How far up the trail the facing direction is taken.
const HIKER_AHEAD_M = 30
// An entrance further than this from its trail line faces the line itself.
const HIKER_ON_LINE_M = 25

// Compass bearing (0 = north, clockwise) from an entrance into its trail: to
// the point HIKER_AHEAD_M along the line from the vertex nearest the entrance,
// in whichever direction leads further away from it (so a loop's start/finish
// faces one way in). Plain equirectangular metres.
export function entranceBearing(trail: Trail, point: [number, number]): number {
  return bearingAlong(trail.geometry.lines, point)
}

// The same walk along any set of lines (a trail's, or a climb's).
function bearingAlong(lines: [number, number][][], [lng, lat]: [number, number]): number {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_574
  const xy = (p: [number, number]) => [(p[0] - lng) * kx, (p[1] - lat) * ky] as const
  let best: { line: [number, number][]; i: number; d: number } | null = null
  for (const line of lines) {
    line.forEach((p, i) => {
      const [x, y] = xy(p)
      const d = Math.hypot(x, y)
      if (!best || d < best.d) best = { line, i, d }
    })
  }
  if (!best) return 0
  const { line, i, d } = best as { line: [number, number][]; i: number; d: number }
  const toward = (p: [number, number]) => {
    const [x, y] = xy(p)
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  }
  if (d > HIKER_ON_LINE_M) return toward(line[i])
  const walk = (step: 1 | -1): [number, number] | null => {
    let travelled = 0
    let j = i
    while (j + step >= 0 && j + step < line.length && travelled < HIKER_AHEAD_M) {
      const [x1, y1] = xy(line[j]), [x2, y2] = xy(line[j + step])
      travelled += Math.hypot(x2 - x1, y2 - y1)
      j += step
    }
    return j === i ? null : line[j]
  }
  const ends = [walk(1), walk(-1)].filter((p): p is [number, number] => p !== null)
  if (!ends.length) return 0
  const far = ends.reduce((a, b) => (Math.hypot(...xy(b)) > Math.hypot(...xy(a)) ? b : a))
  return toward(far)
}

// One hiker per entrance of every walking trail open on `ymd`, in the trail's
// colour (their jacket).
export function trailHikerPoses(trails: Trail[], ymd: string): { coordinates: [number, number]; bearing: number; color: string }[] {
  const poses: { coordinates: [number, number]; bearing: number; color: string }[] = []
  for (const trail of trails) {
    if (trail.kind !== 'walk' || isTrailClosed(trail, ymd)) continue
    for (const entrance of trail.entrances) {
      poses.push({ coordinates: entrance, bearing: entranceBearing(trail, entrance), color: TRAIL_COLORS.walk })
    }
  }
  return poses
}

// ---------------------------------------------------------------------------
// Summit photographers. From zoom 19 a 3D figure taking a photo stands on each
// summit an open walking trail reaches — its line, or a climb from it, within
// SUMMIT_REACH_M of the top (小潭山's mapped climb stops 38 m short: none there).
// ---------------------------------------------------------------------------

const SUMMIT_REACH_M = 30
// The toy's classic red torso, so the photographers read apart from the
// hikers in the trail colour.
export const SUMMIT_PHOTOGRAPHER_COLOR = '#c91a09'

// The trail on the map, open on `ymd`, from which a summit is reached; null
// when there is none.
export function summitReachedFrom(summit: TrailSummit, trails: Trail[], ymd: string): { trail: Trail; via: 'trail' | 'spur' } | null {
  for (const access of summit.access) {
    if (access.via === 'near' || access.distanceM > SUMMIT_REACH_M) continue
    const trail = trails.find(t => t.id === access.trail)
    if (trail && trail.kind === 'walk' && !isTrailClosed(trail, ymd)) return { trail, via: access.via }
  }
  return null
}

// One photographer per reached summit, facing onward past the top: the
// opposite of the way back down the climb (or along the trail that passes).
export function summitPhotographerPoses(
  summits: TrailSummit[], trails: Trail[], spurs: TrailSpur[], ymd: string,
): { coordinates: [number, number]; bearing: number; color: string }[] {
  const poses: { coordinates: [number, number]; bearing: number; color: string }[] = []
  for (const summit of summits) {
    const reached = summitReachedFrom(summit, trails, ymd)
    if (!reached) continue
    const climb = reached.via === 'spur' ? spurs.find(sp => sp.summit === summit.id) : undefined
    const back = bearingAlong(climb?.lines ?? reached.trail.geometry.lines, summit.coordinates)
    poses.push({ coordinates: summit.coordinates, bearing: (back + 180) % 360, color: SUMMIT_PHOTOGRAPHER_COLOR })
  }
  return poses
}

// How many distance posts a trail has, for the panel.
export function countTrailPosts(posts: TrailPost[], trail: Trail): number {
  if (!trail.code) return 0
  let n = 0
  for (const post of posts) if (post.trail === trail.code) n++
  return n
}
