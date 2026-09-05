// Macao Water (澳門自來水) supply-facility helpers, shared by MapView (the
// extrusion / fill / marker layers), the legend and the info panel. The colour
// table and the feature builders live here exactly once so the blocks on the
// map, the swatches in the legend and the panel header can never disagree.
//
// The overlay has three geometry flavours because the upstream facts and the
// available geometry differ per facility:
//
//   * `buildings[]` — OSM footprints, drawn as coloured fill-extrusions using
//     the SAME contract as the schools overlay (see the header of
//     src/schools.ts for why we draw our own blocks instead of tinting the
//     basemap: OpenFreeMap merges same-height buildings into one feature).
//   * `water[]` — reservoir surfaces, drawn as a translucent fill.
//   * every facility, geometry or not, also gets a marker. The ones Macao
//     Water lists but OSM has no footprint for are flagged `approximate` and
//     drawn hollow at the facility they are co-located with (`anchor`).
//
// The overlay is time-independent: nothing here takes a clock.
import { focusSnapshotKey, loadFocusSnapshot, saveFocusSnapshot } from './focusMode'
import type { LayerVisibilityState } from './focusMode'
import type { Lang, Translations } from './i18n'
import type {
  WaterFacility,
  WaterFacilityType,
  WaterDistributionRoad,
  WaterNetwork,
  WaterOperator,
  WaterPipe,
  WaterPipeKind,
  WaterText,
} from './types'

// Type → colour. Cyan for the treatment plants, sky for the reservoirs,
// indigo for the elevated tanks, and two blues for the pumping stations
// (raw-water darker than treated).
export const WATER_COLORS: Record<WaterFacilityType, string> = {
  plant: '#22d3ee',
  reservoir: '#38bdf8',
  tank: '#818cf8',
  raw_pumping: '#0ea5e9',
  pumping: '#7dd3fc',
}

// Display order: the supply chain as water actually travels it. Macao Water's
// own list is numbered differently (plants 1–4, reservoirs 5–7, tanks 8–11,
// raw pumping 12–15, pumping 16–22) — that number is still on every info
// panel, but the map, the legend and the marker badges all read in FLOW order,
// because "where does the water go next" is the question this overlay exists
// to answer. Keep this in step with WATER_STAGES below.
export const WATER_TYPE_ORDER: readonly WaterFacilityType[] = [
  'reservoir', 'raw_pumping', 'plant', 'pumping', 'tank',
] as const

// ---------------------------------------------------------------------------
// STAGES. The chain as one numbered story — raw water in, storage, raw-water
// pumping, treatment, treated-water pumping, elevated storage, and finally the
// street mesh — so the legend, the badge on every marker and the info panel
// can all say "step ④" and mean the same thing. `inlet` is a network node and
// `distribution` the mesh: neither is a facility, but both are chapters.
// ---------------------------------------------------------------------------
export type WaterStageKind = WaterFacilityType | 'inlet' | 'distribution'

export const WATER_STAGES: readonly WaterStageKind[] = [
  'inlet', 'reservoir', 'raw_pumping', 'plant', 'pumping', 'tank', 'distribution',
] as const

// 1-based stage number of a facility type or network-node kind, or 0 for a
// kind the chain does not know — a future node type gets no badge rather than
// a wrong one, and callers filter on `> 0`.
export function waterStage(kind: string): number {
  const i = (WATER_STAGES as readonly string[]).indexOf(kind)
  return i < 0 ? 0 : i + 1
}

// Name of the registered badge image for a stage — the small numbered disc
// drawn at the corner of a marker plate. Kept here for the same reason as
// waterIconName: MapView's addImage loop and the symbol layer's `icon-image`
// expression must spell it identically.
export const WATER_BADGE_ICON_PREFIX = 'water-badge'
export function waterBadgeIconName(stage: number): string {
  return `${WATER_BADGE_ICON_PREFIX}-${stage}`
}

// The feature property MapView promotes to the GeoJSON feature id
// (`promoteId`). Every building of a facility carries the same value, so ONE
// setFeatureState call lights up the whole site — same trick as the schools
// source.
export const WATER_FEATURE_ID_PROPERTY = 'facilityId'

// Same margin, and same reason, as SCHOOL_HEIGHT_MARGIN_M: the data stores each
// footprint at the height the basemap draws it, so our block is rendered this
// much taller to win the depth test against the basemap roof underneath. 0.5 m
// was not enough — large, low roofs z-fought into white streaks at 60° pitch.
export const WATER_HEIGHT_MARGIN_M = 2

// ---------------------------------------------------------------------------
// The pipe network. IMPORTANT: this is OUR schematic — an edge list we drew
// between the facilities Macao Water publishes, with the geometry snapped to
// real streets by OSRM — and NOT Macao Water's actual mains, whose alignment is
// not public. Every surface that renders it says so: the legend row's tooltip
// and the info-panel footer both carry `waterNetworkNote`.
// ---------------------------------------------------------------------------

// Core colour by what the pipe carries. Raw water gets the darker blue and is
// drawn dashed; treated water gets the pale blue of the pumping stations and is
// drawn solid, so the two halves of the chain read apart at a glance.
export const WATER_PIPE_COLORS: Record<WaterPipeKind, string> = {
  raw: '#2563eb',
  treated: '#7dd3fc',
}

// A pipe OSRM could not route is a straight line between two markers, not a
// road-following main — grey (and dashed) so it never passes for one.
export const WATER_PIPE_FALLBACK_COLOR = '#94a3b8'

// The wide translucent halo drawn under both cores.
export const WATER_PIPE_GLOW_COLOR = '#38bdf8'

// The moving dots on the treated mains. Pure white, not a tinted white: the
// core underneath is already pale blue, and anything close to it turned the
// flow into a shimmer you had to look for instead of motion you notice.
export const WATER_PIPE_FLOW_COLOR = '#ffffff'

// The distribution net is deliberately a DESATURATED version of the treated
// blue: same family, visibly quieter, so the trunk mains stay dominant even
// where a trunk runs down the same street as the distribution grid.
export const WATER_DISTRIBUTION_COLOR = '#67c7f0'

// One full dash cycle per entry, each shifting the pattern FORWARD along the
// line — the direction MapLibre walks a LineString's vertices, which is
// `from` → `to` because that is the order buildWaterPipeFeatures emits. Play
// the array in order and the dashes travel the way the water does.
//
// The maths: a cycle is `dash + gap` long, and shifting the whole pattern by
// `o` means the first dash must begin at distance `o` from the line's start.
// While `o` is still inside the gap that is a leading zero-length dash plus a
// gap of `o`; once `o` passes the gap the dash wraps around the cycle
// boundary and the entry starts with its tail instead. A zero-length trailing
// gap keeps every entry four numbers long (MapLibre alternates dash/gap and
// would flip the roles on an odd-length array).
export function buildDashFlowSteps(dash: number, gap: number, steps: number): number[][] {
  const cycle = dash + gap
  const out: number[][] = []
  for (let i = 0; i < steps; i++) {
    const o = (i * cycle) / steps
    if (o === 0) out.push([dash, gap])
    else if (o < gap) out.push([0, o, dash, gap - o])
    else out.push([o + dash - cycle, gap, cycle - o, 0])
  }
  return out
}

// The Zhuhai raw-water inlet. Not one of the 22 facilities, so it gets its own
// colour and its own marker image rather than a facility-type variant.
export const WATER_INLET_COLOR = '#60a5fa'
export const WATER_INLET_ICON = 'water-inlet'

// Marker-feature property holding the label for one UI language. Only the
// network nodes carry these (the 22 facilities are labelled by the info panel,
// not on the map), and MapView swaps `text-field` between them on a language
// change — the same trick as the LRT station labels, so no source is rebuilt.
export function waterLabelField(lang: Lang): string {
  return `label_${lang}`
}

// ---------------------------------------------------------------------------
// Legend key. A Cities-Skylines-style block under the WATER row that names
// every mark the overlay puts on the map: five facility colours, the hollow
// "approximate" marker, and the pipe styles. Pure and data-aware, so a row can
// only claim something the map is actually drawing — the straight-line row
// appears only when a pipe really did fall back, and the pipe/inlet rows only
// when the file has a network at all.
// ---------------------------------------------------------------------------

// How a key row draws its swatch. `square` is a facility block, `squareFill` a
// reservoir surface (translucent + rim), `droplet` / `dropletHollow` the two
// marker plates, `line` a pipe sample, `inlet` the arrow disc and `pulse` the
// bright wave that walks the chain.
export type WaterLegendGlyph =
  | 'square' | 'squareFill' | 'droplet' | 'dropletHollow' | 'line' | 'inlet' | 'pulse'

export interface WaterLegendRow {
  id: string
  label: string
  glyph: WaterLegendGlyph
  color: string
  dashed: boolean // `line` rows only; false everywhere else
  // `line` rows only: the distribution network is drawn thinner and fainter
  // than a trunk main, and its swatch says so — otherwise it would be
  // indistinguishable from the treated-water row above it.
  thin: boolean
  // Stage number (1–7, see WATER_STAGES) for the rows that ARE the chain, in
  // the order water travels it; 0 for the style rows (pipe kinds, the hollow
  // plate, the wave) that explain a mark without being a step. The legend
  // draws the numbered rows as a linked chain and the rest as a plain key.
  stage: number
}

export function waterLegendRows(
  t: Translations,
  network?: WaterNetwork | null,
): WaterLegendRow[] {
  const box = { dashed: false, thin: false }
  const pipes = network?.pipes ?? []
  const rows: WaterLegendRow[] = []
  // The chain, one row per stage in FLOW order — the same order the wave on
  // the map lights them. The inlet row only when the file has an inlet node,
  // but its NUMBER is fixed either way (waterStage), so a badge on the map
  // never means something different from the legend.
  if (network?.nodes?.some(n => n.kind === 'inlet')) {
    rows.push({
      id: 'inlet', label: t.waterTypeInlet, glyph: 'inlet', color: WATER_INLET_COLOR, ...box,
      stage: waterStage('inlet'),
    })
  }
  rows.push(
    { id: 'reservoir', label: t.waterTypeReservoir, glyph: 'squareFill', color: WATER_COLORS.reservoir, ...box, stage: waterStage('reservoir') },
    { id: 'raw_pumping', label: t.waterTypeRawPumping, glyph: 'droplet', color: WATER_COLORS.raw_pumping, ...box, stage: waterStage('raw_pumping') },
    { id: 'plant', label: t.waterTypePlant, glyph: 'square', color: WATER_COLORS.plant, ...box, stage: waterStage('plant') },
    { id: 'pumping', label: t.waterTypePumping, glyph: 'droplet', color: WATER_COLORS.pumping, ...box, stage: waterStage('pumping') },
    { id: 'tank', label: t.waterTypeTank, glyph: 'square', color: WATER_COLORS.tank, ...box, stage: waterStage('tank') },
    // Unconditional: the distribution network is on the map whenever the
    // layer is, network file or not.
    {
      id: 'distribution', label: t.waterLegendDistribution, glyph: 'line',
      color: WATER_DISTRIBUTION_COLOR, dashed: false, thin: true, stage: waterStage('distribution'),
    },
  )
  // The style rows: what a mark looks like, not which step it is. The wave
  // first, because it is the thing the numbers above are explaining.
  rows.push({ id: 'pulse', label: t.waterPulse, glyph: 'pulse', color: WATER_PULSE_COLOR, ...box, stage: 0 })
  if (pipes.length) {
    rows.push(
      { id: 'pipe-raw', label: t.waterPipeRaw, glyph: 'line', color: WATER_PIPE_COLORS.raw, dashed: true, thin: false, stage: 0 },
      { id: 'pipe-treated', label: t.waterPipeTreated, glyph: 'line', color: WATER_PIPE_COLORS.treated, dashed: false, thin: false, stage: 0 },
    )
  }
  // Only when the map really is drawing a straight-line stand-in somewhere;
  // otherwise the row would explain a mark that is not on screen.
  if (pipes.some(p => p.fallback)) {
    rows.push({
      id: 'pipe-fallback', label: t.waterPipeFallback, glyph: 'line',
      color: WATER_PIPE_FALLBACK_COLOR, dashed: true, thin: false, stage: 0,
    })
  }
  // The hollow plate is a statement about certainty, not about type, so the
  // row uses the commonest approximate type's colour and says what it means.
  rows.push({
    id: 'approximate', label: t.waterApproximate, glyph: 'dropletHollow',
    color: WATER_COLORS.pumping, ...box, stage: 0,
  })
  return rows
}

// UI label for a facility type. Uses the normalised enum (not the facility's
// own name) so the three UI languages stay consistent.
export function waterTypeLabel(t: Translations, type: WaterFacilityType): string {
  switch (type) {
    case 'plant': return t.waterTypePlant
    case 'reservoir': return t.waterTypeReservoir
    case 'tank': return t.waterTypeTank
    case 'raw_pumping': return t.waterTypeRawPumping
    default: return t.waterTypePumping
  }
}

// Localised facility name. Macao Water publishes zh + en for all 22, but a
// Portuguese form only for the ones OSM tags with `name:pt` — so the pt slot
// falls back pt → en → zh rather than dropping to Chinese straight away.
export function pickWaterText(field: WaterText | undefined, lang: Lang): string {
  if (!field) return ''
  if (lang === 'zh') return field.zh || field.en || field.pt || ''
  if (lang === 'pt') return field.pt || field.en || field.zh || ''
  return field.en || field.pt || field.zh || ''
}

// Name of the registered MapLibre image for a facility. Kept next to the
// colour table so MapView's `map.addImage` loop and the symbol layer's
// `['get','icon']` read the same strings. Approximate facilities get their own
// hollow image rather than a paint tweak, so the two read differently even
// when they overlap.
export function waterIconName(type: WaterFacilityType, approximate: boolean): string {
  return `water-${type}${approximate ? '-approx' : ''}`
}

// Who runs this facility. The field is defaulted in the zod schema rather than
// required (an older file has no `operator`), and `parseData` hands the runtime
// the RAW object — so the default has to be applied here too, in the one place
// every reader goes through.
export function waterOperator(facility: WaterFacility): WaterOperator {
  return facility.operator === 'dsama' ? 'dsama' : 'macao_water'
}

// The one-line ownership statement the info panel shows. A government reservoir
// is NOT a Macao Water facility, and the panel says so rather than leaving the
// Macao Water header to imply otherwise.
export function waterOperatorLabel(t: Translations, facility: WaterFacility): string {
  return waterOperator(facility) === 'dsama' ? t.waterOperatorDsama : t.waterOperatorMacaoWater
}

// The facility an approximate marker is co-located with, or null when the
// anchor is a district point (`district:<slug>`, which names no facility) or
// the facility is exact. Used by the info panel to say WHERE the pin actually
// sits, so an approximate marker never pretends to be a survey position.
export function waterAnchorFacility(
  anchor: string | null | undefined,
  facilities: WaterFacility[],
): WaterFacility | null {
  if (!anchor || anchor.startsWith('district:')) return null
  return facilities.find(f => f.id === anchor) ?? null
}

// How many footprints a facility contributes to the extrusion layer — the
// count the panel shows. Rings that are empty are skipped by the builder
// below, so this counts the same buildings the map actually draws.
export function countWaterFootprints(facility: WaterFacility): number {
  return facility.buildings.filter(b => b.coordinates?.length && b.coordinates[0]?.length).length
}

// How many pipes of the schematic network touch this node, counting both
// directions — the number the info panel shows next to the "schematic" note.
// `nodeId` is a facility id or one of the network's own node ids (the inlet).
// A missing network is 0, not a throw: the `network` block is optional.
export function waterPipeCount(
  network: WaterNetwork | null | undefined,
  nodeId: string,
): number {
  if (!nodeId) return 0
  let count = 0
  for (const pipe of network?.pipes ?? []) {
    if (pipe.from === nodeId || pipe.to === nodeId) count++
  }
  return count
}

// ---------------------------------------------------------------------------
// WATER is a FOCUS mode, not just another overlay: switching it on clears every
// other layer so the supply network is read against an empty city, and
// switching it off puts the map back exactly as it was.
//
// POWER works exactly the same way, so the machinery now lives in
// src/focusMode.ts and both overlays share it — one implementation, one storage
// convention, no way for the two to drift. What stays here is WATER's own names
// for it, so every existing caller (and the water tests) keep reading the same
// module they always did.
// ---------------------------------------------------------------------------
export type { LayerVisibilityApply, LayerVisibilityState } from './focusMode'
export {
  applyLayerSnapshot,
  captureLayerSnapshot,
  // WATER's storage key, spelled by the shared convention.
  applyFocusMode as applyWaterFocus,
} from './focusMode'

export const WATER_FOCUS_SNAPSHOT_KEY = focusSnapshotKey('water')

export function loadWaterFocusSnapshot(): LayerVisibilityState | null {
  return loadFocusSnapshot('water')
}

export function saveWaterFocusSnapshot(snapshot: LayerVisibilityState | null): void {
  saveFocusSnapshot('water', snapshot)
}

// One Polygon feature per building footprint, coloured by its facility's type.
// Buildings with no usable ring are skipped rather than emitted as empty
// geometry (MapLibre would warn on every tile). `color` is baked into the
// feature so the paint expression stays a plain ['get', 'color'], and
// `facilityId` (WATER_FEATURE_ID_PROPERTY) doubles as the promoted feature id
// used for the selection highlight.
export function buildWaterBuildingFeatures(
  facilities: WaterFacility[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const facility of facilities) {
    const color = WATER_COLORS[facility.type] ?? WATER_COLORS.pumping
    for (const building of facility.buildings) {
      const rings = building.coordinates
      if (!rings?.length || !rings[0]?.length) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: rings },
        properties: {
          facilityId: facility.id,
          type: facility.type,
          color,
          height: building.height + WATER_HEIGHT_MARGIN_M,
          minHeight: building.minHeight,
          name: building.name,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

// One Polygon feature per reservoir surface. No height — MapView draws these as
// a flat translucent fill, because a reservoir is a water body, not a building.
// Same empty-ring guard as the buildings above.
export function buildWaterSurfaceFeatures(
  facilities: WaterFacility[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const facility of facilities) {
    const color = WATER_COLORS[facility.type] ?? WATER_COLORS.reservoir
    for (const surface of facility.water) {
      const rings = surface.coordinates
      if (!rings?.length || !rings[0]?.length) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: rings },
        properties: {
          facilityId: facility.id,
          type: facility.type,
          color,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

// One Point feature per facility — ALL of them, geometry or not, because the
// marker is what makes a facility findable. `approximate` drives the hollow
// icon variant, and `facilityId` is what the click handler looks the facility
// up by. Records with no usable coordinate pair are skipped rather than
// emitted as broken geometry.
export function buildWaterMarkerFeatures(
  facilities: WaterFacility[],
  network?: WaterNetwork | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const facility of facilities) {
    const coords = facility.coordinates
    if (!coords || coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties: {
        facilityId: facility.id,
        type: facility.type,
        approximate: facility.approximate,
        icon: waterIconName(facility.type, facility.approximate),
        // The step number at the plate's corner (see WATER_STAGES). `badge`
        // is the image name so the symbol layer stays a plain ['get'].
        stage: waterStage(facility.type),
        badge: waterBadgeIconName(waterStage(facility.type)),
      },
    })
  }
  // The network's own nodes — the raw-water inlets — ride the SAME source and
  // symbol layer as the facilities, so one click handler and one selection
  // ring cover both. They are the only markers with a map label: an inlet is a
  // place a reader has to be told about, whereas a facility is named by the
  // panel its marker opens. All three languages are baked in and MapView picks
  // one with `text-field` (see waterLabelField) rather than rebuilding the
  // source when the language changes.
  for (const node of network?.nodes ?? []) {
    const coords = node.coordinates
    if (!coords || coords.length < 2) continue
    const stage = waterStage(node.kind)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties: {
        facilityId: node.id,
        type: node.kind,
        // A node whose real crossing is not published is flagged in the data;
        // the symbol layer fades it a little, and the panel says why.
        approximate: node.approximate === true,
        icon: WATER_INLET_ICON,
        // 0 for a kind the chain does not know; the badge layer filters it out.
        stage,
        badge: waterBadgeIconName(stage),
        label_zh: pickWaterText(node.name, 'zh'),
        label_en: pickWaterText(node.name, 'en'),
        label_pt: pickWaterText(node.name, 'pt'),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// The road classes drawn as WIDE distribution pipes; everything else gets the
// thin branch. Exported so the paint expression in MapView and any future
// consumer read the same list.
export const WATER_DISTRIBUTION_MAJOR_CLASSES: readonly string[] = [
  'motorway', 'trunk', 'primary',
] as const

// One LineString per road, carrying its class and its pulse bucket (the road's
// distance from the nearest treated-water source in WATER_PULSE_BUCKET_M
// steps — null where the outward walk never reached it, so it never lights).
// Deliberately NOT one MultiLineString per class: the per-road features are
// what let MapLibre cull, query and width-ramp each street individually, and
// the source is written once (on load and after a style swap) rather than per
// frame, so the feature count costs nothing at runtime. Roads with fewer than
// two points are skipped.
export function buildWaterDistributionFeatures(
  roads: WaterDistributionRoad[] | null | undefined,
  bucketM: number = WATER_PULSE_BUCKET_M,
  buckets: number = WATER_MESH_PULSE_BUCKETS,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const road of roads ?? []) {
    const coords = road.coordinates
    if (!coords || coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        class: road.class,
        bucket: waterDistanceBucket(road.dist, bucketM, buckets),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// How many mesh buckets the loaded roads actually fill — the wave walks this
// far and no further (see WaterPulseBuild.buckets for the trunk twin).
export function waterDistributionBucketCount(
  roads: WaterDistributionRoad[] | null | undefined,
  bucketM: number = WATER_PULSE_BUCKET_M,
  buckets: number = WATER_MESH_PULSE_BUCKETS,
): number {
  let max = -1
  for (const road of roads ?? []) {
    const b = waterDistanceBucket(road.dist, bucketM, buckets)
    if (b !== null && b > max) max = b
  }
  return max + 1
}

// One LineString per pipe. `sortKey` puts treated water above raw where the two
// share a street, and `fallback` lets the paint expression grey out the
// straight-line stand-ins. Pipes with fewer than two points are skipped rather
// than emitted as broken geometry (MapLibre would warn on every tile).
//
// VERTEX ORDER IS LOAD-BEARING: the coordinates are copied through untouched,
// `from` end first, because MapLibre lays a dash pattern along a line in vertex
// order and the flow animation (buildDashFlowSteps) shifts that pattern
// forward. Reverse a pipe here and its water would visibly run uphill.
export function buildWaterPipeFeatures(
  network: WaterNetwork | null | undefined,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const pipe of network?.pipes ?? []) {
    const coords = pipe.coordinates
    if (!coords || coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        pipeId: pipe.id,
        kind: pipe.kind,
        fallback: !!pipe.fallback,
        // A short straight stub between co-located facilities. Carried so the
        // data is inspectable, but NOT styled: unlike `fallback` it is the
        // intended geometry, so it draws exactly like its `kind`.
        direct: !!pipe.direct,
        lengthM: pipe.lengthM,
        sortKey: pipe.kind === 'treated' ? 1 : 0,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// ---------------------------------------------------------------------------
// THE PULSE. A bright wave that walks the whole chain in order — out of the
// inlets (and the catchment reservoirs, which have no upstream), along the raw
// mains into the plants, on through the treated mains to the tanks, and then
// outward through the street mesh — so the SEQUENCE is visible, not just the
// direction. The per-pipe dash and dot flows show which way each pipe runs;
// only a wave that starts somewhere and arrives somewhere shows what comes
// before what.
//
// It is drawn with the same no-relayout trick as the flows: every pipe is cut
// into chunks by distance from the wave's start, each chunk tagged with a
// bucket number, and MapView adds ONE line layer per bucket (filtered on it)
// whose only per-tick change is `line-opacity`. `advanceWaterPulse` is the
// state machine that says which buckets are lit how brightly on a given tick.
//
// Distances are metres ALONG the network. Arrival at a node is the shortest
// path from any root (multi-source Dijkstra over the pipe graph), so a plant
// fed two ways lights when the first water reaches it, and everything
// downstream continues from there.
// ---------------------------------------------------------------------------

// Bucket length. 400 m per step at two ticks a step (WATER_PULSE_STEP_TICKS)
// walks the ~13 km from the Ilha Verde inlet to the Taipa tanks in about 4.5 s
// — slow enough to follow with the eye at city zoom, fast enough that the
// whole story fits one cycle.
export const WATER_PULSE_BUCKET_M = 400
// Layer budgets. Both groups are built ONCE per style with this many layers,
// before any data has arrived, so the counts are fixed caps rather than
// data-derived: a chunk past the last bucket is clamped into it. 40 × 400 m
// covers a 16 km trunk chain; 20 × 400 m an 8 km walk from the nearest
// treated-water source, beyond the mesh's 7.7 km maximum.
export const WATER_TRUNK_PULSE_BUCKETS = 40
export const WATER_MESH_PULSE_BUCKETS = 20
// The head and the fading tail behind it, as opacities: bucket `head` gets
// tail[0], `head-1` tail[1], … and the bucket behind the tail is written to 0.
export const WATER_PULSE_TAIL: readonly number[] = [1, 0.55, 0.25]
// Ticks per step (a tick is MapView's FLOW_TICK_MS), and the rest at the end
// of a cycle in steps, so the story has a beat of silence before it repeats.
export const WATER_PULSE_STEP_TICKS = 2
export const WATER_PULSE_REST_STEPS = 10
// Pale cyan-white: brighter than every base colour it passes over, so a lit
// chunk reads as the pipe itself lighting up rather than a new line on top.
export const WATER_PULSE_COLOR = '#e0fbff'

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

// Length of a pipe along its own vertices — the distance the wave walks. The
// file's `lengthM` is the same number rounded; recomputing keeps the chunk
// boundaries and the node arrivals in exactly one unit.
export function waterPipeLengthM(pipe: WaterPipe): number {
  const c = pipe.coordinates
  let m = 0
  for (let i = 1; i < c.length; i++) m += haversineM(c[i - 1], c[i])
  return m
}

// Metres along the network from the nearest ROOT to every node. A root is a
// node nothing flows into: the inlets, and a catchment reservoir that has no
// pipe feeding it. Roots sit at 0 and light first. A node with no route from
// any root (only possible inside a cycle) is absent from the map, and the
// pulse builder treats it as its own start.
export function waterArrivalDistances(
  network: WaterNetwork | null | undefined,
): Map<string, number> {
  const pipes = (network?.pipes ?? []).filter(p => (p.coordinates?.length ?? 0) >= 2)
  const ids = new Set<string>()
  const inbound = new Set<string>()
  for (const p of pipes) { ids.add(p.from); ids.add(p.to); inbound.add(p.to) }
  for (const n of network?.nodes ?? []) ids.add(n.id)
  const dist = new Map<string, number>()
  for (const id of ids) if (!inbound.has(id)) dist.set(id, 0)
  // Dijkstra with a linear scan: two dozen nodes, so a heap would be noise.
  const settled = new Set<string>()
  for (;;) {
    let best: string | null = null
    let bestD = Infinity
    for (const [id, d] of dist) {
      if (!settled.has(id) && d < bestD) { best = id; bestD = d }
    }
    if (best === null) break
    settled.add(best)
    for (const p of pipes) {
      if (p.from !== best) continue
      const nd = bestD + waterPipeLengthM(p)
      const cur = dist.get(p.to)
      if (cur === undefined || nd < cur) dist.set(p.to, nd)
    }
  }
  return dist
}

// Bucket index of a distance, clamped into the layer budget; null where the
// distance is unknown (a mesh road the outward walk never reached), so the
// filter matches nothing and the road simply never lights.
export function waterDistanceBucket(
  distM: number | null | undefined, bucketM: number, buckets: number,
): number | null {
  if (distM === null || distM === undefined || !Number.isFinite(distM) || distM < 0) return null
  return Math.min(Math.floor(distM / bucketM), buckets - 1)
}

export interface WaterPulseBuild {
  features: GeoJSON.FeatureCollection
  // How many buckets the network actually fills (≤ the layer budget) — the
  // animation walks this far and no further, so a short network does not
  // spend half its cycle sweeping empty layers.
  buckets: number
}

// Every pipe cut into chunks of one bucket each. Chunk boundaries fall exactly
// at bucket-length distances from the wave's start (arrival at `from` plus the
// distance along the pipe), interpolated onto the segment they land in, so
// consecutive chunks share their boundary vertex and the lit wave has no gaps.
// Vertex order is preserved, `from` end first, like buildWaterPipeFeatures.
export function buildWaterPulseFeatures(
  network: WaterNetwork | null | undefined,
  bucketM: number = WATER_PULSE_BUCKET_M,
  buckets: number = WATER_TRUNK_PULSE_BUCKETS,
): WaterPulseBuild {
  const features: GeoJSON.Feature[] = []
  const arrival = waterArrivalDistances(network)
  let maxBucket = -1
  const emit = (coords: number[][], bucket: number, pipe: WaterPipe) => {
    // A chunk with no extent (a boundary landing exactly on a vertex) would
    // draw as a round-cap dot, so it is dropped rather than emitted.
    if (coords.length < 2) return
    if (coords.every(c => c[0] === coords[0][0] && c[1] === coords[0][1])) return
    const b = Math.min(bucket, buckets - 1)
    if (b > maxBucket) maxBucket = b
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { bucket: b, kind: pipe.kind, pipeId: pipe.id },
    })
  }
  for (const pipe of network?.pipes ?? []) {
    const c = pipe.coordinates
    if (!c || c.length < 2) continue
    const d0 = arrival.get(pipe.from) ?? 0
    let bucket = Math.floor(d0 / bucketM)
    let s = 0 // metres along the pipe at the start of the current segment
    let chunk: number[][] = [[c[0][0], c[0][1]]]
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1]
      const b = c[i]
      const seg = haversineM(a, b)
      // Walk every bucket boundary that falls strictly inside this segment.
      for (;;) {
        const boundary = (bucket + 1) * bucketM - d0 // pipe metres where the next bucket starts
        if (!(seg > 0) || boundary >= s + seg) break
        const t = Math.max(0, (boundary - s) / seg)
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        chunk.push(p)
        emit(chunk, bucket, pipe)
        chunk = [p]
        bucket++
      }
      chunk.push([b[0], b[1]])
      s += seg
    }
    emit(chunk, bucket, pipe)
  }
  return { features: { type: 'FeatureCollection', features }, buckets: maxBucket + 1 }
}

export type WaterPulsePhase = 'trunk' | 'mesh' | 'rest'

export interface WaterPulseState {
  phase: WaterPulsePhase
  // Bucket index of the wave's head; in `rest`, the number of steps rested.
  head: number
  tick: number
}

export interface WaterPulseCounts {
  trunk: number
  mesh: number
}

export interface WaterPulseWrite {
  group: 'trunk' | 'mesh'
  index: number
  opacity: number
}

// Fresh layers are all at opacity 0, and the first step lights bucket 0.
export function initialWaterPulseState(): WaterPulseState {
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
export function advanceWaterPulse(
  state: WaterPulseState,
  counts: WaterPulseCounts,
  stepTicks: number = WATER_PULSE_STEP_TICKS,
  restSteps: number = WATER_PULSE_REST_STEPS,
  tail: readonly number[] = WATER_PULSE_TAIL,
): { next: WaterPulseState; writes: WaterPulseWrite[] } {
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
  const writes: WaterPulseWrite[] = []
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
