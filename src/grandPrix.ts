// GRAND PRIX — the Guia Circuit as a map layer.
//
// The fourth focus mode, on the same terms as WATER, POWER and WASTE: while it
// is on the city is cleared so the one thing left is the 6.2 km street circuit
// of the Macau Grand Prix — the racing line with its direction chevrons, the
// pit lane, the officially named corners in race order, and a single
// open-wheel car lapping in the record time on the simulation clock, with a
// fading wake behind it and its speed beside it. Unlike the utilities this
// mode keeps the clock controls: the car is the one thing on it with a time
// dimension, and 10× is how a two-minute lap becomes watchable.
//
// What is real and what is ours (the panel and the legend say the same):
// - the LINE is OpenStreetMap's `Circuito da Guia` relation, stitched by the
//   pipeline into one closed loop and cross-checked against the official lap
//   length;
// - the NAMES are the Grand Prix Committee's, quoted verbatim in all three
//   languages;
// - the corner POSITIONS are derived from the geometry by a documented rule
//   (the committee publishes no coordinates), so every one is `approximate`;
// - the LAP RECORD the car runs at is a secondary source (Wikipedia).
//
// Everything here is a pure function of the file; MapView owns the layers and
// the refs, App owns the switch. Same split as src/power.ts.

import type { Feature, LineString } from 'geojson'
import type { Lang, Translations } from './i18n'
import type {
  GrandPrixCircuit,
  GrandPrixCorner,
  GrandPrixCornerKind,
  GrandPrixText,
} from './types'
import { interpolateOnLineSmooth } from './engines/simulationEngine'

// The property the corner marker layer carries its id in, for the click
// handler and the selection ring.
export const GRAND_PRIX_FEATURE_ID_PROPERTY = 'cornerId'

// ---- Colours -----------------------------------------------------------------

// Everything that moves or glows, per theme: white-on-dark reads on the dark
// basemap and vanishes on Positron, so the light set is the same hue turned
// down to ink. The car is the exception to "same hue": it drives ON the rose
// line, so its body is the opposite of the line — white over the dark map,
// ink over the light one — with the rose kept for its wings.
export interface GrandPrixMotionColors {
  track: string // the racing line's core
  glow: string // the halo under it
  pit: string // the pit lane
  pulse: string // the wake behind the car
  car: string // the car's body
  carAccent: string // its wings
  label: string // corner names on the map
  halo: string // the halo behind those names
}

export function grandPrixMotionColors(dark: boolean): GrandPrixMotionColors {
  return dark
    ? {
      track: '#fb7185',
      glow: '#f43f5e',
      pit: '#94a3b8',
      pulse: '#fff1f2',
      car: '#f8fafc',
      carAccent: '#e11d48',
      label: '#fecdd3',
      halo: '#0b0b0c',
    }
    : {
      track: '#be123c',
      glow: '#fda4af',
      pit: '#64748b',
      pulse: '#4c0519',
      car: '#1f2937',
      carAccent: '#be123c',
      label: '#881337',
      halo: '#ffffff',
    }
}

// The one colour the legend row and the CITY chip wear regardless of theme
// (the map's own tones come from grandPrixMotionColors).
export const GRAND_PRIX_ROW_COLOR = '#f43f5e'

// ---- Provenance --------------------------------------------------------------

// The panel lists the file's sources in the order a reader checks them: the
// line first, then the names, the official facts, the record the car runs at,
// and last the landmarks the corner rules hang on. Unknown roles go to the
// end; within a role the file's own order is kept (the sort is stable).
const SOURCE_ROLE_ORDER: Record<string, number> = {
  geometry: 0, names: 1, facts: 2, lapRecord: 3, landmarks: 4,
}

export function sortGrandPrixSources<S extends { role: string }>(sources: readonly S[]): S[] {
  return [...sources].sort(
    (a, b) => (SOURCE_ROLE_ORDER[a.role] ?? 9) - (SOURCE_ROLE_ORDER[b.role] ?? 9),
  )
}

// ---- Text ------------------------------------------------------------------

// The UI language's form of a trilingual field, falling back to English —
// the committee prints every name in all three, so this only guards an empty
// string in a hand-edited file.
export function pickGrandPrixText(field: GrandPrixText | undefined, lang: Lang): string {
  if (!field) return ''
  const first = lang === 'zh' ? field.zh : lang === 'pt' ? field.pt : field.en
  return first || field.en || field.zh || field.pt || ''
}

// The feature property the corner label layer reads for a language. All three
// forms ride in the feature, so a language change is a `text-field` swap.
export function grandPrixLabelField(lang: Lang): string {
  return lang === 'zh' ? 'label_zh' : lang === 'pt' ? 'label_pt' : 'label_en'
}

// The MAP label of a corner. The basemap's glyph server has no image for the
// fullwidth brackets (see powerInletMapLabel), so they become ASCII here; the
// panel keeps the name as published.
export function grandPrixCornerMapLabel(name: string): string {
  return name.replace(/（/g, '(').replace(/）/g, ')')
}

export function grandPrixCornerKindLabel(t: Translations, kind: GrandPrixCornerKind): string {
  switch (kind) {
    case 'start_finish': return t.grandPrixKindStartFinish
    case 'section': return t.grandPrixKindSection
    default: return t.grandPrixKindBend
  }
}

// ---- Marker images -----------------------------------------------------------

// The corner badge is the numbered disc the WATER and POWER plates wear, one
// image per corner in race order; start/finish wears the chequered flag.
export const GRAND_PRIX_BADGE_ICON_PREFIX = 'grandprix-badge-'
export const GRAND_PRIX_FLAG_ICON = 'grandprix-flag'

export function grandPrixBadgeIconName(corner: Pick<GrandPrixCorner, 'kind' | 'order'>): string {
  return corner.kind === 'start_finish'
    ? GRAND_PRIX_FLAG_ICON
    : `${GRAND_PRIX_BADGE_ICON_PREFIX}${corner.order}`
}

// ---- GeoJSON for the sources -------------------------------------------------

// The racing line and the pit lane, one LineString each. `kind` is what the
// layers filter on. Null (layer off, file not loaded) draws nothing.
export function buildGrandPrixTrackFeatures(circuit: GrandPrixCircuit | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  if (circuit) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: circuit.track.coordinates },
      properties: { kind: 'track', circuitId: circuit.id },
    })
    if (circuit.pitLane && circuit.pitLane.coordinates.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: circuit.pitLane.coordinates },
        properties: { kind: 'pit', circuitId: circuit.id },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

// One point per corner, in race order, carrying its badge image and all three
// label forms (MapView picks one with `text-field`, see grandPrixLabelField).
export function buildGrandPrixCornerFeatures(circuit: GrandPrixCircuit | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const corner of circuit?.corners ?? []) {
    if (!Number.isFinite(corner.lng) || !Number.isFinite(corner.lat)) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [corner.lng, corner.lat] },
      properties: {
        [GRAND_PRIX_FEATURE_ID_PROPERTY]: corner.id,
        order: corner.order,
        kind: corner.kind,
        approximate: corner.approximate,
        icon: grandPrixBadgeIconName(corner),
        label_zh: grandPrixCornerMapLabel(pickGrandPrixText(corner.name, 'zh')),
        label_en: grandPrixCornerMapLabel(pickGrandPrixText(corner.name, 'en')),
        label_pt: grandPrixCornerMapLabel(pickGrandPrixText(corner.name, 'pt')),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// ---- The wake ----------------------------------------------------------------
//
// The utilities' pulse is a wave that walks the network on its own clock.
// Here the light is the car's own: the stretch of track it has just covered —
// the last GRAND_PRIX_WAKE_LENGTH_M behind it — drawn as ONE line whose
// gradient runs from transparent at the tail to full at the car. It is cut
// afresh from the track every tick, so the bright end is always exactly the
// car. (A free-running wave would lap in seconds and make the car look
// parked; a chunk-quantised tail would light a whole chunk ahead of it.)
export const GRAND_PRIX_WAKE_LENGTH_M = 600

// First vertex whose distance along the loop is strictly past `s`.
function indexAfterMetres(cumM: Float64Array, s: number): number {
  let lo = 0
  let hi = cumM.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (cumM[mid] <= s) lo = mid + 1
    else hi = mid
  }
  return lo
}

// The stretch of the closed loop from `fromM` to `toM` metres along it (both
// wrapping; toM − fromM at most one lap), as coordinates in travel order: the
// interpolated start, every vertex strictly inside, the interpolated end. The
// loop is closed (last vertex == first), so a stretch across start/finish is
// one continuous list.
export function sliceGrandPrixLoop(
  coords: readonly (readonly number[])[],
  cumM: Float64Array,
  totalM: number,
  fromM: number,
  toM: number,
): [number, number][] {
  const n = coords.length
  if (n < 2 || !(totalM > 0)) return []
  const length = Math.min(totalM, Math.max(0, toM - fromM))
  if (length <= 0) return []
  const wrap = (m: number) => ((m % totalM) + totalM) % totalM
  const start = wrap(fromM)
  const out: [number, number][] = [pointAtMetres(coords, cumM, totalM, start)]
  // Walk the vertices after `start`, in loop order, wrapping past the closing
  // vertex (index n−1, the same place as index 0) to index 1.
  let j = indexAfterMetres(cumM, start)
  for (let guard = 0; guard < n; guard++) {
    if (j > n - 1) j = 1
    const d = wrap(cumM[j] - start)
    if (d >= length) break
    if (d > 0) out.push([coords[j][0], coords[j][1]])
    j++
  }
  out.push(pointAtMetres(coords, cumM, totalM, start + length))
  return out
}

// The wake as a source's worth of GeoJSON: one LineString ending at the car,
// or nothing (layer off, file not landed, degenerate track).
export function grandPrixWakeFeatures(
  circuit: GrandPrixCircuit | null, distanceM: number | null,
): GeoJSON.FeatureCollection {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
  if (!circuit || distanceM === null || !Number.isFinite(distanceM)) return empty
  const profile = grandPrixSpeedProfile(circuit)
  if (!profile) return empty
  // Never the whole loop: a tail that meets its own head reads as a ring.
  const length = Math.min(GRAND_PRIX_WAKE_LENGTH_M, profile.totalM * 0.9)
  const coords = sliceGrandPrixLoop(
    circuit.track.coordinates, profile.cumM, profile.totalM, distanceM - length, distanceM,
  )
  if (coords.length < 2) return empty
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { kind: 'wake' },
    }],
  }
}

// ---- The car -----------------------------------------------------------------

// Lap time the car runs at: the record where the file has one, else a stated
// stand-in (about 150 km/h average) so a file without a record still animates.
export const GRAND_PRIX_FALLBACK_LAP_SECONDS = 150

export function grandPrixLapSeconds(circuit: GrandPrixCircuit): number {
  const s = circuit.lapRecord?.seconds
  return s !== undefined && s !== null && Number.isFinite(s) && s > 0 ? s : GRAND_PRIX_FALLBACK_LAP_SECONDS
}

// How far into the lap (0 ≤ p < 1, as a fraction of the lap TIME) a simulated
// instant is. The lap is anchored to the epoch rather than to when the layer
// went on, so pausing, scrubbing and speed changes all move the car exactly
// as they move a bus — and two viewers at the same simulated moment see it in
// the same place.
export function grandPrixLapProgress(simMs: number, lapSeconds: number): number {
  if (!(lapSeconds > 0) || !Number.isFinite(simMs)) return 0
  const lapMs = lapSeconds * 1000
  const r = ((simMs % lapMs) + lapMs) % lapMs
  return r / lapMs
}

// ---- The speed profile -------------------------------------------------------
//
// The car does not lap at one speed: it brakes for the hairpin and runs out
// along the Amizade straight, the way the lap is actually driven. The profile
// comes from the track's own geometry and three limits — how hard the car can
// corner, brake and accelerate — and is then stretched so that one lap takes
// exactly the record time. That keeps the record honest (the average over the
// drawn line is unchanged) while the shape of the lap is physical: the slowest
// point is the tightest corner, the fastest the end of the longest straight.
//
// The limits are round Formula 3 numbers — about 280 km/h flat out, 3 g in
// the corners and under braking — and with them the drawn line alone laps in
// 126.2 s against the 126.257 s record (stretch 0.999, checked in the tests),
// which is as much validation as the profile needs. It still claims nothing
// about a real lap trace: no gears, no kerbs, no weather.
export interface GrandPrixSpeedLimits {
  vMaxMs: number // top speed, the end of the straight
  vMinMs: number // the floor, the tightest hairpin
  lateral: number // m/s² — v² / r the car will carry through a bend
  brake: number // m/s²
  accel: number // m/s²
}
export const GRAND_PRIX_V_MAX_MS = 78 // ≈ 280 km/h
export const GRAND_PRIX_V_MIN_MS = 12 // ≈ 43 km/h, the floor at the Melco hairpin
export const GRAND_PRIX_LATERAL_ACCEL = 30 // ≈ 3 g
export const GRAND_PRIX_BRAKE_DECEL = 30 // ≈ 3 g
export const GRAND_PRIX_ACCEL = 11
export const GRAND_PRIX_SPEED_LIMITS: GrandPrixSpeedLimits = {
  vMaxMs: GRAND_PRIX_V_MAX_MS,
  vMinMs: GRAND_PRIX_V_MIN_MS,
  lateral: GRAND_PRIX_LATERAL_ACCEL,
  brake: GRAND_PRIX_BRAKE_DECEL,
  accel: GRAND_PRIX_ACCEL,
}
// Curvature is read over ±15 m so a vertex-by-vertex OSM wobble does not
// register as a corner, while a real hairpin (radius ~10 m) still does.
const GRAND_PRIX_CURVATURE_WINDOW_M = 15

export interface GrandPrixSpeedProfile {
  cumM: Float64Array // metres along the lap at each track vertex; the last is the total
  timeS: Float64Array // seconds into the lap at each vertex; the last is the lap time
  speedMs: Float64Array // the car's speed at each vertex, after stretching
  totalM: number
  lapSeconds: number
  // The stretch that put the physical profile onto the record: > 1 means the
  // limits alone would have lapped slower than the record.
  stretch: number
}

// Metres between two [lng, lat] — the same flat-earth-at-this-latitude
// arithmetic as the car's own boxes, precise to well under a metre over the
// segment lengths of a street circuit.
function metresBetween(a: readonly number[], b: readonly number[]): number {
  const kLat = 111320
  const kLng = 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180)
  return Math.hypot((b[0] - a[0]) * kLng, (b[1] - a[1]) * kLat)
}

// The point `m` metres along a closed loop (wrapping both ways).
function pointAtMetres(
  coords: readonly (readonly number[])[], cum: Float64Array, totalM: number, m: number,
): [number, number] {
  const s = ((m % totalM) + totalM) % totalM
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (cum[mid] <= s) lo = mid
    else hi = mid - 1
  }
  const i = Math.min(lo, coords.length - 2)
  const seg = cum[i + 1] - cum[i]
  const t = seg > 0 ? (s - cum[i]) / seg : 0
  return [
    coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
    coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
  ]
}

function headingRad(a: readonly number[], b: readonly number[]): number {
  const kLng = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180)
  return Math.atan2((b[0] - a[0]) * kLng, b[1] - a[1])
}

const profileCache = new WeakMap<GrandPrixCircuit, GrandPrixSpeedProfile | null>()

// The profile for a circuit, built once per file object (like the track line).
// Null for a degenerate track (fewer than three distinct points), in which
// case the car falls back to lapping at one speed.
export function grandPrixSpeedProfile(circuit: GrandPrixCircuit): GrandPrixSpeedProfile | null {
  if (profileCache.has(circuit)) return profileCache.get(circuit) ?? null
  const profile = buildGrandPrixSpeedProfile(circuit.track.coordinates, grandPrixLapSeconds(circuit))
  profileCache.set(circuit, profile)
  return profile
}

// The construction, exported for the tests. `coords` is a closed loop in the
// direction of travel; `lapSeconds` is what one lap must take.
export function buildGrandPrixSpeedProfile(
  coords: readonly (readonly number[])[],
  lapSeconds: number,
  limits: GrandPrixSpeedLimits = GRAND_PRIX_SPEED_LIMITS,
): GrandPrixSpeedProfile | null {
  const n = coords.length
  if (n < 3 || !(lapSeconds > 0)) return null
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + metresBetween(coords[i - 1], coords[i])
  const totalM = cum[n - 1]
  if (!(totalM > 0)) return null
  const w = Math.min(GRAND_PRIX_CURVATURE_WINDOW_M, totalM / 8)

  // 1. Cornering limit at every vertex from the curvature there: the heading
  //    change between the chord behind and the chord ahead, per metre.
  const limit = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const behind = pointAtMetres(coords, cum, totalM, cum[i] - w)
    const here = pointAtMetres(coords, cum, totalM, cum[i])
    const ahead = pointAtMetres(coords, cum, totalM, cum[i] + w)
    let turn = headingRad(here, ahead) - headingRad(behind, here)
    turn = Math.atan2(Math.sin(turn), Math.cos(turn)) // wrap to (−π, π]
    const curvature = Math.abs(turn) / w
    const v = curvature > 0 ? Math.sqrt(limits.lateral / curvature) : Infinity
    limit[i] = Math.min(limits.vMaxMs, Math.max(limits.vMinMs, v))
  }

  // 2. Acceleration and braking limits, run twice round the loop so the wrap
  //    at start/finish is consistent (the first vertex is the last vertex).
  const v = Float64Array.from(limit)
  const m = n - 1 // distinct vertices; index n−1 mirrors 0
  const segLen = (i: number) => cum[i + 1] - cum[i] // segment i → i+1, 0 ≤ i < m
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k <= m; k++) {
      const i = k % m
      const prev = (k - 1) % m
      const ds = segLen(prev)
      v[i] = Math.min(v[i], Math.sqrt(v[prev] * v[prev] + 2 * limits.accel * ds))
    }
    for (let k = m - 1; k >= -1; k--) {
      const i = (k + m) % m
      const next = (k + 1) % m
      const ds = segLen(i)
      v[i] = Math.min(v[i], Math.sqrt(v[next] * v[next] + 2 * limits.brake * ds))
    }
  }
  v[m] = v[0]

  // 3. Time along the lap at these speeds, then the stretch onto the record.
  const timeS = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    const avg = (v[i - 1] + v[i]) / 2
    timeS[i] = timeS[i - 1] + (avg > 0 ? segLen(i - 1) / avg : 0)
  }
  const physicalLap = timeS[n - 1]
  if (!(physicalLap > 0)) return null
  const stretch = physicalLap / lapSeconds
  for (let i = 0; i < n; i++) {
    timeS[i] /= stretch
    v[i] *= stretch
  }
  timeS[n - 1] = lapSeconds
  return { cumM: cum, timeS, speedMs: v, totalM, lapSeconds, stretch }
}

// Metres into the lap at a time into the lap (0 ≤ t < lapSeconds): the
// segment the time falls in, then constant speed within it.
export function grandPrixLapDistanceAt(profile: GrandPrixSpeedProfile, tSeconds: number): number {
  const { timeS, cumM, lapSeconds, totalM } = profile
  const t = ((tSeconds % lapSeconds) + lapSeconds) % lapSeconds
  let lo = 0
  let hi = timeS.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (timeS[mid] <= t) lo = mid
    else hi = mid - 1
  }
  const i = Math.min(lo, timeS.length - 2)
  const dt = timeS[i + 1] - timeS[i]
  const f = dt > 0 ? (t - timeS[i]) / dt : 0
  return Math.min(totalM, cumM[i] + (cumM[i + 1] - cumM[i]) * f)
}

// The car's speed at a time into the lap, in m/s — for a readout.
export function grandPrixLapSpeedAt(profile: GrandPrixSpeedProfile, tSeconds: number): number {
  const { timeS, speedMs, lapSeconds } = profile
  const t = ((tSeconds % lapSeconds) + lapSeconds) % lapSeconds
  let lo = 0
  let hi = timeS.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (timeS[mid] <= t) lo = mid
    else hi = mid - 1
  }
  const i = Math.min(lo, timeS.length - 2)
  const dt = timeS[i + 1] - timeS[i]
  const f = dt > 0 ? (t - timeS[i]) / dt : 0
  return speedMs[i] + (speedMs[i + 1] - speedMs[i]) * f
}

// The car's on-screen size. The polygon is drawn in metres, so a real-sized
// car would be a pixel at the zoom that shows the whole circuit; this grows it
// as the map zooms out, holding roughly a constant screen length down to city
// zoom (2^(16.5 − z): 1× at z16.5, 4× at z14.5) and capping the growth so it
// never turns into a blob at the extremes.
export const GRAND_PRIX_CAR_MAX_SCALE = 5

export function grandPrixCarScale(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(GRAND_PRIX_CAR_MAX_SCALE, Math.max(1, Math.pow(2, 16.5 - zoom)))
}

export interface GrandPrixCarPose {
  lng: number
  lat: number
  bearing: number
  scale: number
}

// The track as the simulation engine's kind of line, cached per circuit
// object: the engine keys its cumulative-distance cache on the Feature's
// identity, so handing it a fresh object every frame would rebuild that cache
// every frame.
const trackLineCache = new WeakMap<GrandPrixCircuit, Feature<LineString>>()

export function grandPrixTrackLine(circuit: GrandPrixCircuit): Feature<LineString> {
  let line = trackLineCache.get(circuit)
  if (!line) {
    line = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: circuit.track.coordinates },
    }
    trackLineCache.set(circuit, line)
  }
  return line
}

// Position and heading of the car at a fraction of the lap's LENGTH, sized
// for a zoom. The smoothed interpolation (a ±20 m chord) keeps the heading
// continuous through the hairpin instead of snapping at every vertex of the
// OSM line.
export function grandPrixPoseAtFraction(
  circuit: GrandPrixCircuit, fraction: number, zoom: number,
): GrandPrixCarPose | null {
  if (circuit.track.coordinates.length < 2) return null
  const at = interpolateOnLineSmooth(grandPrixTrackLine(circuit), fraction, 0.02)
  return {
    lng: at.coordinates[0],
    lat: at.coordinates[1],
    bearing: at.bearing,
    scale: grandPrixCarScale(zoom),
  }
}

export interface GrandPrixCarState {
  pose: GrandPrixCarPose
  distanceM: number // into the lap
  speedMs: number
  lapTimeS: number // seconds into the current lap
}

// The car at a simulated instant: the time into the lap, the distance the
// speed profile says the car has covered by then, the point that far along
// the line, and the speed there (for the readout). Without a profile (a
// degenerate track) the car laps at one speed.
export function grandPrixCarState(
  circuit: GrandPrixCircuit, simMs: number, zoom: number,
): GrandPrixCarState | null {
  if (circuit.track.coordinates.length < 2) return null
  const lapSeconds = grandPrixLapSeconds(circuit)
  const lapTimeS = grandPrixLapProgress(simMs, lapSeconds) * lapSeconds
  const profile = grandPrixSpeedProfile(circuit)
  const totalM = profile?.totalM ?? 0
  const distanceM = profile ? grandPrixLapDistanceAt(profile, lapTimeS) : 0
  const fraction = profile && totalM > 0 ? distanceM / totalM : lapTimeS / lapSeconds
  const pose = grandPrixPoseAtFraction(circuit, fraction, zoom)
  if (!pose) return null
  return {
    pose,
    distanceM,
    speedMs: profile ? grandPrixLapSpeedAt(profile, lapTimeS) : 0,
    lapTimeS,
  }
}

// Position and heading only — the tests' and the map's shorthand.
export function grandPrixCarPose(
  circuit: GrandPrixCircuit, simMs: number, zoom: number,
): GrandPrixCarPose | null {
  return grandPrixCarState(circuit, simMs, zoom)?.pose ?? null
}

// ---- Focusing the map --------------------------------------------------------
//
// Switching the layer on flies the map to the circuit: nothing else is left on
// the map, so the view had better be where the one thing is. The bounds cover
// the track and the pit lane; the zoom floor keeps the circuit at street
// scale even where a wide viewport could fit it at city scale.
export const GRAND_PRIX_FOCUS_MIN_ZOOM = 14.4

export function grandPrixBounds(
  circuit: GrandPrixCircuit | null,
): [[number, number], [number, number]] | null {
  if (!circuit) return null
  const coords = [...circuit.track.coordinates, ...(circuit.pitLane?.coordinates ?? [])]
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null
  return [[minLng, minLat], [maxLng, maxLat]]
}

// ---- The legend ---------------------------------------------------------------

export type GrandPrixLegendGlyph = 'flag' | 'corner' | 'track' | 'pit' | 'wake' | 'car'

export interface GrandPrixLegendRow {
  id: string
  label: string
  glyph: GrandPrixLegendGlyph
  color: string
  // The corner's number in race order (the badge on the map); 0 for a style row.
  stage: number
}

// The key: first the CHAIN — every named corner in race order, numbered as
// the map numbers them, so the sequence reads top to bottom the way the car
// drives it — then the style rows (the line, the pit lane, the wake, the car).
// `circuit` may be null before the file lands; the style rows still explain
// the marks the layer will draw.
export function grandPrixLegendRows(
  t: Translations,
  lang: Lang,
  circuit: GrandPrixCircuit | null,
  dark: boolean = true,
): GrandPrixLegendRow[] {
  const motion = grandPrixMotionColors(dark)
  const rows: GrandPrixLegendRow[] = []
  const corners = [...(circuit?.corners ?? [])].sort((a, b) => a.order - b.order)
  for (const corner of corners) {
    rows.push({
      id: corner.id,
      label: pickGrandPrixText(corner.name, lang),
      glyph: corner.kind === 'start_finish' ? 'flag' : 'corner',
      color: motion.track,
      stage: corner.order,
    })
  }
  rows.push(
    { id: 'track', label: t.grandPrixTrack, glyph: 'track', color: motion.track, stage: 0 },
    { id: 'pit', label: t.grandPrixPitLane, glyph: 'pit', color: motion.pit, stage: 0 },
    { id: 'wake', label: t.grandPrixWake, glyph: 'wake', color: motion.pulse, stage: 0 },
    {
      id: 'car',
      label: circuit?.lapRecord
        ? t.grandPrixCarAtRecord(circuit.lapRecord.time)
        : t.grandPrixCar,
      glyph: 'car', color: motion.car, stage: 0,
    },
  )
  return rows
}
