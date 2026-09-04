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
import type { Lang, Translations } from './i18n'
import type {
  WaterFacility,
  WaterFacilityType,
  WaterDistributionRoad,
  WaterNetwork,
  WaterOperator,
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

// Display order: the supply chain as water actually travels it — reservoir →
// raw-water pump → plant is the physical order, but the LIST is ordered the
// way Macao Water numbers its facilities (plants 1–4, reservoirs 5–7, tanks
// 8–11, raw pumping 12–15, pumping 16–22), which is what a reader comparing
// the map against the source page expects.
export const WATER_TYPE_ORDER: readonly WaterFacilityType[] = [
  'plant', 'reservoir', 'tank', 'raw_pumping', 'pumping',
] as const

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
// marker plates, `line` a pipe sample and `inlet` the arrow disc.
export type WaterLegendGlyph =
  | 'square' | 'squareFill' | 'droplet' | 'dropletHollow' | 'line' | 'inlet'

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
}

export function waterLegendRows(
  t: Translations,
  network?: WaterNetwork | null,
): WaterLegendRow[] {
  const box = { dashed: false, thin: false }
  const rows: WaterLegendRow[] = [
    { id: 'plant', label: t.waterTypePlant, glyph: 'square', color: WATER_COLORS.plant, ...box },
    { id: 'reservoir', label: t.waterTypeReservoir, glyph: 'squareFill', color: WATER_COLORS.reservoir, ...box },
    { id: 'tank', label: t.waterTypeTank, glyph: 'square', color: WATER_COLORS.tank, ...box },
    { id: 'raw_pumping', label: t.waterTypeRawPumping, glyph: 'droplet', color: WATER_COLORS.raw_pumping, ...box },
    { id: 'pumping', label: t.waterTypePumping, glyph: 'droplet', color: WATER_COLORS.pumping, ...box },
    // The hollow plate is a statement about certainty, not about type, so the
    // row uses the commonest approximate type's colour and says what it means.
    { id: 'approximate', label: t.waterApproximate, glyph: 'dropletHollow', color: WATER_COLORS.pumping, ...box },
  ]
  const pipes = network?.pipes ?? []
  if (pipes.length) {
    rows.push(
      { id: 'pipe-raw', label: t.waterPipeRaw, glyph: 'line', color: WATER_PIPE_COLORS.raw, dashed: true, thin: false },
      { id: 'pipe-treated', label: t.waterPipeTreated, glyph: 'line', color: WATER_PIPE_COLORS.treated, dashed: false, thin: false },
    )
  }
  // Unconditional: the distribution network is the basemap's own roads
  // restyled, so it is on the map whenever the layer is, network file or not.
  rows.push({
    id: 'distribution', label: t.waterLegendDistribution, glyph: 'line',
    color: WATER_DISTRIBUTION_COLOR, dashed: false, thin: true,
  })
  // Only when the map really is drawing a straight-line stand-in somewhere;
  // otherwise the row would explain a mark that is not on screen.
  if (pipes.some(p => p.fallback)) {
    rows.push({
      id: 'pipe-fallback', label: t.waterPipeFallback, glyph: 'line',
      color: WATER_PIPE_FALLBACK_COLOR, dashed: true, thin: false,
    })
  }
  if (network?.nodes?.some(n => n.kind === 'inlet')) {
    rows.push({
      id: 'inlet', label: t.waterTypeInlet, glyph: 'inlet', color: WATER_INLET_COLOR, ...box,
    })
  }
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
// switching it off puts the map back exactly as it was. The snapshot is taken
// at the moment water goes on and wins on restore even if the user poked other
// switches meanwhile, so the two states can never drift apart.
//
// The pure half lives here (capture / apply / persist); App owns the React
// setters and passes them in, which is what makes this testable without a DOM.
// ---------------------------------------------------------------------------

// Everything the focus mode has to put back. Bus visibility is TWO facts, not
// one: `busAuto` records that the user was in auto-by-time mode, so restoring
// re-enters auto (and lets the clock repopulate the routes) instead of pinning
// whatever happened to be in service at snapshot time.
export interface LayerVisibilityState {
  lrt: string[] // LRT line ids that were switched on
  busAuto: boolean // auto-by-time mode was active
  busRoutes: string[] // explicitly visible route ids; empty when busAuto
  flights: boolean
  ferries: boolean
  roadWorks: boolean
  schools: boolean // the master switch only — per-level set is left alone
  toilets: boolean
  carParks: boolean
}

// The setters the focus mode drives. `setBus` takes both facts at once because
// the two must move together (an empty route set with auto still on would just
// be refilled by the next clock tick).
export interface LayerVisibilityApply {
  setLrt: (ids: string[]) => void
  setBus: (routeIds: string[], auto: boolean) => void
  setFlights: (on: boolean) => void
  setFerries: (on: boolean) => void
  setRoadWorks: (on: boolean) => void
  setSchools: (on: boolean) => void
  setToilets: (on: boolean) => void
  setCarParks: (on: boolean) => void
}

// Persisted so a reload while water is on can still restore later. The
// per-layer keys read "off" during focus mode — that is fine and expected: this
// snapshot is what restore reads, not those.
export const WATER_FOCUS_SNAPSHOT_KEY = 'mini-macau-water-focus-snapshot'

// Normalising copy of the current layer state. Arrays are copied (the caller
// passes live Sets spread into arrays) so a later mutation can't rewrite
// history, and the route list is dropped in auto mode because it is derived
// from the clock rather than chosen by the user.
export function captureLayerSnapshot(state: LayerVisibilityState): LayerVisibilityState {
  return {
    lrt: [...state.lrt],
    busAuto: !!state.busAuto,
    busRoutes: state.busAuto ? [] : [...state.busRoutes],
    flights: !!state.flights,
    ferries: !!state.ferries,
    roadWorks: !!state.roadWorks,
    schools: !!state.schools,
    toilets: !!state.toilets,
    carParks: !!state.carParks,
  }
}

// Everything off. Buses go to "no routes AND not auto" deliberately: leaving
// auto on would let the next clock tick refill the map behind the focus mode.
export function applyWaterFocus(apply: LayerVisibilityApply): void {
  apply.setLrt([])
  apply.setBus([], false)
  apply.setFlights(false)
  apply.setFerries(false)
  apply.setRoadWorks(false)
  apply.setSchools(false)
  apply.setToilets(false)
  apply.setCarParks(false)
}

// Put the snapshot back, exactly.
export function applyLayerSnapshot(
  snapshot: LayerVisibilityState,
  apply: LayerVisibilityApply,
): void {
  apply.setLrt(snapshot.lrt)
  apply.setBus(snapshot.busAuto ? [] : snapshot.busRoutes, snapshot.busAuto)
  apply.setFlights(snapshot.flights)
  apply.setFerries(snapshot.ferries)
  apply.setRoadWorks(snapshot.roadWorks)
  apply.setSchools(snapshot.schools)
  apply.setToilets(snapshot.toilets)
  apply.setCarParks(snapshot.carParks)
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// Restore the persisted snapshot. Anything unreadable, non-object or of the
// wrong shape yields null — a missing snapshot just means "restore nothing",
// which leaves the map as the user last left it rather than throwing.
export function loadWaterFocusSnapshot(): LayerVisibilityState | null {
  try {
    const raw = localStorage.getItem(WATER_FOCUS_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const o = parsed as Record<string, unknown>
    return captureLayerSnapshot({
      lrt: stringArray(o.lrt),
      busAuto: o.busAuto === true,
      busRoutes: stringArray(o.busRoutes),
      flights: o.flights === true,
      ferries: o.ferries === true,
      roadWorks: o.roadWorks === true,
      schools: o.schools === true,
      toilets: o.toilets === true,
      carParks: o.carParks === true,
    })
  } catch {
    return null
  }
}

// Persist (or, with null, forget) the snapshot. Storage can throw in private
// mode — losing the snapshot is never worth breaking the toggle.
export function saveWaterFocusSnapshot(snapshot: LayerVisibilityState | null): void {
  try {
    if (snapshot === null) localStorage.removeItem(WATER_FOCUS_SNAPSHOT_KEY)
    else localStorage.setItem(WATER_FOCUS_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch { /* ignore */ }
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
      },
    })
  }
  // The network's own nodes — today just the Zhuhai raw-water inlet — ride the
  // SAME source and symbol layer as the facilities, so one click handler and
  // one selection ring cover both. They are the only markers with a map label:
  // the inlet is a place a reader has to be told about, whereas a facility is
  // named by the panel its marker opens. All three languages are baked in and
  // MapView picks one with `text-field` (see waterLabelField) rather than
  // rebuilding the source when the language changes.
  for (const node of network?.nodes ?? []) {
    const coords = node.coordinates
    if (!coords || coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties: {
        facilityId: node.id,
        type: node.kind,
        // A node is a point we chose deliberately, not an inferred stand-in for
        // a facility we could not locate — so it never draws hollow.
        approximate: false,
        icon: WATER_INLET_ICON,
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

// One LineString per road, carrying only its class. Deliberately NOT one
// MultiLineString per class: the per-road features are what let MapLibre cull,
// query and width-ramp each street individually, and the source is written once
// (on load and after a style swap) rather than per frame, so the feature count
// costs nothing at runtime. Roads with fewer than two points are skipped.
export function buildWaterDistributionFeatures(
  roads: WaterDistributionRoad[] | null | undefined,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const road of roads ?? []) {
    const coords = road.coordinates
    if (!coords || coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { class: road.class },
    })
  }
  return { type: 'FeatureCollection', features }
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
