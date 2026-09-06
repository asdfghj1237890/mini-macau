// Macau electricity (澳電 CEM) network helpers, shared by MapView (the
// extrusion / marker / line layers), the legend and the info panel. The colour
// table and the feature builders live here exactly once so the blocks on the
// map, the swatches in the legend and the panel header can never disagree.
//
// Deliberately the same shape as src/water.ts — same `buildings[]` contract
// (see src/schools.ts for why we draw our own blocks instead of tinting the
// basemap: OpenFreeMap merges same-height buildings into one feature), same
// hollow-marker rule for facilities we could only place approximately, same
// focus-mode machinery (now shared, in src/focusMode.ts).
//
// WHAT IS AND IS NOT REAL HERE. The facilities are real: CEM publishes its
// station list and OSM has most of them. The NETWORK is not surveyed — CEM's
// 1,088 km of HV cable is almost entirely underground and is in no public
// dataset, so `network` is OUR schematic edge list with the geometry snapped to
// streets by OSRM. Every surface that draws it says so (`powerNetworkNote`).
//
// The overlay is time-independent: nothing here takes a clock.
import {
  PULSE_BUCKET_M, arrivalDistances, buildPulseFeatures, distanceBucket,
} from './flowPulse'
import type { PulseBuild } from './flowPulse'
import type { Lang, Translations } from './i18n'
import type {
  PowerDistributionRoad,
  PowerFacility,
  PowerFacilityType,
  PowerNetwork,
  PowerOperator,
  PowerText,
  PowerVoltage,
} from './types'

// Type → colour. One amber family, darkening with importance: orange for the
// generating plant, lime for the incinerator (it is a waste plant that happens
// to sell power, not a CEM asset), then the three substation tiers stepping
// from deep amber at 220 kV to pale at 66 kV — so voltage reads as weight.
export const POWER_COLORS: Record<PowerFacilityType, string> = {
  plant: '#fb923c',
  incinerator: '#a3e635',
  sub220: '#f59e0b',
  sub110: '#facc15',
  sub66: '#fde68a',
}

// Display order: the way power actually travels — generation first, then the
// substation tiers in descending voltage, which is also the order the legend
// and the marker-image loop walk.
export const POWER_TYPE_ORDER: readonly PowerFacilityType[] = [
  'plant', 'incinerator', 'sub220', 'sub110', 'sub66',
] as const

// ---------------------------------------------------------------------------
// STAGES. The grid as one numbered story — where the power comes from, then
// the substation tiers in descending voltage, then the street mesh — so the
// legend, the badge on every marker and the info panel all say "step ③" and
// mean the same thing. Step ① is SOURCE and covers three kinds at once: the
// Guangdong import points (91 % of the energy), the Coloane power station and
// the incinerator — one chapter, several doors. `inlet` is a network node and
// `distribution` the mesh: neither is a facility, but both are chapters.
// ---------------------------------------------------------------------------
export type PowerStageKind = 'source' | 'sub220' | 'sub110' | 'sub66' | 'distribution'

export const POWER_STAGES: readonly PowerStageKind[] = [
  'source', 'sub220', 'sub110', 'sub66', 'distribution',
] as const

// The facility types and node kinds that share step ①.
export const POWER_SOURCE_KINDS: readonly string[] = ['inlet', 'plant', 'incinerator'] as const

// 1-based stage number of a facility type or network-node kind, or 0 for a
// kind the chain does not know — a future node type gets no badge rather than
// a wrong one, and callers filter on `> 0`.
export function powerStage(kind: string): number {
  const stageKind = POWER_SOURCE_KINDS.includes(kind) ? 'source' : kind
  const i = (POWER_STAGES as readonly string[]).indexOf(stageKind)
  return i < 0 ? 0 : i + 1
}

// Name of the registered badge image for a stage — the small numbered disc at
// the corner of a marker plate. Kept next to powerIconName for the same
// reason: MapView's addImage loop and the symbol layer's `icon-image` must
// spell it identically.
export const POWER_BADGE_ICON_PREFIX = 'power-badge'
export function powerBadgeIconName(stage: number): string {
  return `${POWER_BADGE_ICON_PREFIX}-${stage}`
}

// The feature property MapView promotes to the GeoJSON feature id
// (`promoteId`). Every building of a facility carries the same value, so ONE
// setFeatureState call lights up the whole site — same trick as the schools
// and water sources.
export const POWER_FEATURE_ID_PROPERTY = 'facilityId'

// Same margin, and same reason, as WATER_HEIGHT_MARGIN_M: the data stores each
// footprint at the height the basemap draws it, so our block is rendered this
// much taller to win the depth test against the basemap roof underneath.
export const POWER_HEIGHT_MARGIN_M = 2

// ---------------------------------------------------------------------------
// The HV network. IMPORTANT: this is OUR schematic — an edge list between the
// stations CEM publishes, snapped to real streets by OSRM — and NOT CEM's
// actual cable routes, which are underground and not public.
// ---------------------------------------------------------------------------

// The three transmission tiers CEM runs. Ordered high → low, which is the order
// the legend lists them and the order the width/colour `match` expressions are
// built in.
export const POWER_VOLTAGES: readonly PowerVoltage[] = [220, 110, 66] as const

// A line is drawn in the colour of the substations it joins, so a corridor and
// its endpoints read as one system.
export const POWER_LINE_COLORS: Record<PowerVoltage, string> = {
  220: POWER_COLORS.sub220,
  110: POWER_COLORS.sub110,
  66: POWER_COLORS.sub66,
}

// Core width per voltage, as [width at z12, width at z16]. The spread is the
// whole point: at a glance the 220 kV import corridors have to dominate the
// 66 kV distribution ties, the way a transmission diagram draws them.
export const POWER_LINE_WIDTHS: Record<PowerVoltage, readonly [number, number]> = {
  220: [5, 8],
  110: [3.5, 6],
  66: [2.2, 4],
}

// A line OSRM could not route is a straight line between two markers, not a
// street-following corridor — grey so it never passes for one.
export const POWER_LINE_FALLBACK_COLOR = '#94a3b8'

// The wide translucent halo drawn under the cores.
export const POWER_LINE_GLOW_COLOR = '#f59e0b'

// The moving dots on the lines. Pure white, not a tinted white: the cores are
// already amber, and anything close to them turned the flow into a shimmer you
// had to look for instead of motion you notice.
export const POWER_LINE_FLOW_COLOR = '#ffffff'

// The distribution net is a DESATURATED amber: same family as the trunk lines,
// visibly quieter, so the corridors stay dominant even where one runs down the
// same street as the distribution grid.
export const POWER_DISTRIBUTION_COLOR = '#fbbf24'

// Is this one of the three tiers we style? A line whose voltage the pipeline
// widens later must still draw, so every lookup goes through here and falls
// back to the lowest tier rather than dropping the feature.
export function isPowerVoltage(kv: number | null | undefined): kv is PowerVoltage {
  return kv === 220 || kv === 110 || kv === 66
}

// Colour for a line of this voltage; the 66 kV tone for anything unrecognised.
export function powerLineColor(kv: number | null | undefined): string {
  return isPowerVoltage(kv) ? POWER_LINE_COLORS[kv] : POWER_LINE_COLORS[66]
}

// Width for a line of this voltage at one end of the zoom ramp (`at` is the
// index into POWER_LINE_WIDTHS: 0 = z12, 1 = z16).
export function powerLineWidth(kv: number | null | undefined, at: 0 | 1): number {
  return (isPowerVoltage(kv) ? POWER_LINE_WIDTHS[kv] : POWER_LINE_WIDTHS[66])[at]
}

// The Guangdong import points. Not CEM facilities, so they get their own colour
// and their own marker image rather than a facility-type variant.
export const POWER_INLET_COLOR = '#fb7185'
export const POWER_INLET_ICON = 'power-inlet'

// Marker-feature property holding the label for one UI language. Only the
// network nodes carry these (the facilities are labelled by the info panel, not
// on the map), and MapView swaps `text-field` between them on a language change
// — the same trick as the LRT station labels, so no source is rebuilt.
export function powerLabelField(lang: Lang): string {
  return `label_${lang}`
}

// ---------------------------------------------------------------------------
// Legend key. A Cities-Skylines-style block under the POWER row that names
// every mark the overlay puts on the map: the facility colours, the hollow
// "approximate" plate, one row per voltage actually present, the distribution
// mesh and the import points. Pure and data-aware, so a row can only claim
// something the map is really drawing.
// ---------------------------------------------------------------------------

// How a key row draws its swatch. `square` is a facility block, `bolt` /
// `boltHollow` the two marker plates, `line` a corridor sample, `inlet` the
// arrow disc and `pulse` the bright wave that walks the grid.
export type PowerLegendGlyph = 'square' | 'bolt' | 'boltHollow' | 'line' | 'inlet' | 'pulse'

export interface PowerLegendRow {
  id: string
  label: string
  glyph: PowerLegendGlyph
  color: string
  // `line` rows only: the distribution network is drawn thinner and fainter
  // than a trunk corridor, and its swatch says so — otherwise it would be
  // indistinguishable from the 66 kV row above it.
  thin: boolean
  // Stage number (1–5, see POWER_STAGES) for the rows that ARE the chain, in
  // the order power travels it; 0 for the style rows (voltage samples, the
  // hollow plate, the wave) that explain a mark without being a step. The
  // legend draws the numbered rows as a linked chain and the rest as a key.
  stage: number
}

export function powerLegendRows(
  t: Translations,
  network?: PowerNetwork | null,
): PowerLegendRow[] {
  const lines = network?.lines ?? []
  const rows: PowerLegendRow[] = []
  // The chain, in FLOW order — the order the wave on the map lights it. Step ①
  // is three rows (import points, the plant, the incinerator) that share one
  // number; the inlet row only when the file has import nodes.
  if (network?.nodes?.some(n => n.kind === 'inlet')) {
    rows.push({
      id: 'inlet', label: t.powerTypeInlet, glyph: 'inlet', color: POWER_INLET_COLOR,
      thin: false, stage: powerStage('inlet'),
    })
  }
  rows.push(
    { id: 'plant', label: t.powerTypePlant, glyph: 'square', color: POWER_COLORS.plant, thin: false, stage: powerStage('plant') },
    { id: 'incinerator', label: t.powerTypeIncinerator, glyph: 'square', color: POWER_COLORS.incinerator, thin: false, stage: powerStage('incinerator') },
    { id: 'sub220', label: t.powerTypeSub220, glyph: 'bolt', color: POWER_COLORS.sub220, thin: false, stage: powerStage('sub220') },
    { id: 'sub110', label: t.powerTypeSub110, glyph: 'bolt', color: POWER_COLORS.sub110, thin: false, stage: powerStage('sub110') },
    { id: 'sub66', label: t.powerTypeSub66, glyph: 'bolt', color: POWER_COLORS.sub66, thin: false, stage: powerStage('sub66') },
    // Unconditional: the distribution network is Macau's own streets restyled,
    // so it is on the map whenever the layer is, network file or not.
    {
      id: 'distribution', label: t.powerLegendDistribution, glyph: 'line',
      color: POWER_DISTRIBUTION_COLOR, thin: true, stage: powerStage('distribution'),
    },
  )
  // The style rows: what a mark looks like, not which step it is. The wave
  // first, because it is the thing the numbers above are explaining.
  rows.push({ id: 'pulse', label: t.powerPulse, glyph: 'pulse', color: POWER_PULSE_COLOR, thin: false, stage: 0 })
  // One row per voltage the file actually carries — a network with no 220 kV
  // corridors must not advertise a mark that is not on screen.
  for (const kv of POWER_VOLTAGES) {
    if (!lines.some(l => l.voltageKv === kv)) continue
    rows.push({
      id: `line-${kv}`, label: t.powerLineVoltage(kv), glyph: 'line',
      color: POWER_LINE_COLORS[kv], thin: false, stage: 0,
    })
  }
  // The hollow plate is a statement about certainty, not about type, so the
  // row uses the commonest approximate tier's colour and says what it means.
  rows.push({
    id: 'approximate', label: t.powerApproximate, glyph: 'boltHollow',
    color: POWER_COLORS.sub66, thin: false, stage: 0,
  })
  return rows
}

// UI label for a facility type. Uses the normalised enum (not the facility's
// own name) so the three UI languages stay consistent.
export function powerTypeLabel(t: Translations, type: PowerFacilityType): string {
  switch (type) {
    case 'plant': return t.powerTypePlant
    case 'incinerator': return t.powerTypeIncinerator
    case 'sub220': return t.powerTypeSub220
    case 'sub110': return t.powerTypeSub110
    default: return t.powerTypeSub66
  }
}

// Localised facility name. CEM publishes zh (and mostly en); a Portuguese form
// only exists where OSM tags `name:pt` — so the pt slot falls back pt → en → zh
// rather than dropping to Chinese straight away.
export function pickPowerText(field: PowerText | undefined, lang: Lang): string {
  if (!field) return ''
  if (lang === 'zh') return field.zh || field.en || field.pt || ''
  if (lang === 'pt') return field.pt || field.en || field.zh || ''
  return field.en || field.pt || field.zh || ''
}

// Name of the registered MapLibre image for a facility. Kept next to the colour
// table so MapView's `map.addImage` loop and the symbol layer's
// `['get','icon']` read the same strings. Approximate facilities get their own
// hollow image rather than a paint tweak, so the two read differently even when
// they overlap.
export function powerIconName(type: PowerFacilityType, approximate: boolean): string {
  return `power-${type}${approximate ? '-approx' : ''}`
}

// Who runs this facility. Defaulted here (not required by the zod schema) for
// the same reason as `waterOperator`: `parseData` hands the runtime the RAW
// object, so the default has to be applied in the one place every reader goes
// through.
export function powerOperator(facility: PowerFacility): PowerOperator {
  return facility.operator === 'dspa' ? 'dspa' : 'cem'
}

// The one-line ownership statement the info panel shows. The incinerator is a
// GOVERNMENT waste plant that sells its output to CEM, not a CEM asset, and the
// panel says so rather than letting the POWER header imply otherwise.
export function powerOperatorLabel(t: Translations, facility: PowerFacility): string {
  return powerOperator(facility) === 'dspa' ? t.powerOperatorDspa : t.powerOperatorCem
}

// The facility an approximate marker is co-located with, or null when the
// anchor is a district point (`district:<slug>`, which names no facility) or
// the facility is exact. Used by the info panel to say WHERE the pin actually
// sits, so an approximate marker never pretends to be a survey position.
export function powerAnchorFacility(
  anchor: string | null | undefined,
  facilities: PowerFacility[],
): PowerFacility | null {
  if (!anchor || anchor.startsWith('district:')) return null
  return facilities.find(f => f.id === anchor) ?? null
}

// How many footprints a facility contributes to the extrusion layer — the count
// the panel shows. Rings that are empty are skipped by the builder below, so
// this counts the same buildings the map actually draws.
export function countPowerFootprints(facility: PowerFacility): number {
  return facility.buildings.filter(b => b.coordinates?.length && b.coordinates[0]?.length).length
}

// How many lines of the schematic network touch this node, counting both
// directions — the number the info panel shows next to the "schematic" note.
// `nodeId` is a facility id or one of the network's own node ids (an inlet).
// A missing network is 0, not a throw: the `network` block is optional.
export function powerLineCount(
  network: PowerNetwork | null | undefined,
  nodeId: string,
): number {
  if (!nodeId) return 0
  let count = 0
  for (const line of network?.lines ?? []) {
    if (line.from === nodeId || line.to === nodeId) count++
  }
  return count
}

// The generating units, in the reading language. Only 路環發電廠 carries the full
// trilingual prose; a station with just the language-neutral `units` string
// falls back to it, and everything else yields '' so the panel shows no row.
export function powerPlantUnits(
  facility: PowerFacility,
  lang: Lang,
): string {
  const d = facility.details
  if (!d) return ''
  const neutral = d.units ?? ''
  if (lang === 'zh') return d.unitsZh || d.unitsEn || d.unitsPt || neutral
  if (lang === 'pt') return d.unitsPt || d.unitsEn || d.unitsZh || neutral
  return d.unitsEn || d.unitsPt || d.unitsZh || neutral
}

// One Polygon feature per building footprint, coloured by its facility's type.
// Buildings with no usable ring are skipped rather than emitted as empty
// geometry (MapLibre would warn on every tile). `color` is baked into the
// feature so the paint expression stays a plain ['get', 'color'], and
// `facilityId` (POWER_FEATURE_ID_PROPERTY) doubles as the promoted feature id
// used for the selection highlight.
export function buildPowerBuildingFeatures(
  facilities: PowerFacility[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const facility of facilities) {
    const color = POWER_COLORS[facility.type] ?? POWER_COLORS.sub66
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
          height: building.height + POWER_HEIGHT_MARGIN_M,
          minHeight: building.minHeight,
          name: building.name,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

// One Point feature per facility — ALL of them, footprint or not, because the
// marker is what makes a facility findable. `approximate` drives the hollow
// icon variant, and `facilityId` is what the click handler looks the facility
// up by. Records with no usable coordinate pair are skipped rather than emitted
// as broken geometry.
export function buildPowerMarkerFeatures(
  facilities: PowerFacility[],
  network?: PowerNetwork | null,
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
        icon: powerIconName(facility.type, facility.approximate),
        // The step number at the plate's corner (see POWER_STAGES). `badge`
        // is the image name so the symbol layer stays a plain ['get'].
        stage: powerStage(facility.type),
        badge: powerBadgeIconName(powerStage(facility.type)),
      },
    })
  }
  // The network's own nodes — the three Guangdong import points — ride the SAME
  // source and symbol layer as the facilities, so one click handler and one
  // selection ring cover both. They are the only markers with a map label: an
  // inlet is a place a reader has to be told about, whereas a facility is named
  // by the panel its marker opens. All three languages are baked in and MapView
  // picks one with `text-field` (see powerLabelField) rather than rebuilding
  // the source when the language changes.
  for (const node of network?.nodes ?? []) {
    const coords = node.coordinates
    if (!coords || coords.length < 2) continue
    const stage = powerStage(node.kind)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties: {
        facilityId: node.id,
        type: node.kind,
        // A landing point the pipeline could only estimate is flagged in the
        // data (the 北安 corridor); the symbol layer fades it a little and the
        // panel says so. The other inlets are chosen points and draw solid.
        approximate: node.approximate === true,
        icon: POWER_INLET_ICON,
        // 0 for a kind the chain does not know; the badge layer filters it out.
        stage,
        badge: powerBadgeIconName(stage),
        label_zh: pickPowerText(node.name, 'zh'),
        label_en: pickPowerText(node.name, 'en'),
        label_pt: pickPowerText(node.name, 'pt'),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// The road classes drawn as WIDE distribution feeders; everything else gets the
// thin branch. Exported so the paint expression in MapView and any future
// consumer read the same list.
export const POWER_DISTRIBUTION_MAJOR_CLASSES: readonly string[] = [
  'motorway', 'trunk', 'primary',
] as const

// One LineString per road, carrying its class and its pulse bucket (the road's
// distance from the nearest substation in PULSE_BUCKET_M steps — null where
// the outward walk never reached it, so it never lights). Same contract (and
// same reasoning) as buildWaterDistributionFeatures: per-road features are
// what let MapLibre cull, query and width-ramp each street individually, and
// the source is written once rather than per frame. Roads with fewer than two
// points are skipped.
export function buildPowerDistributionFeatures(
  roads: PowerDistributionRoad[] | null | undefined,
  bucketM: number = PULSE_BUCKET_M,
  buckets: number = POWER_MESH_PULSE_BUCKETS,
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
        bucket: distanceBucket(road.dist, bucketM, buckets),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// How many mesh buckets the loaded roads actually fill — the wave walks this
// far and no further (see PulseBuild.buckets for the trunk twin).
export function powerDistributionBucketCount(
  roads: PowerDistributionRoad[] | null | undefined,
  bucketM: number = PULSE_BUCKET_M,
  buckets: number = POWER_MESH_PULSE_BUCKETS,
): number {
  let max = -1
  for (const road of roads ?? []) {
    const b = distanceBucket(road.dist, bucketM, buckets)
    if (b !== null && b > max) max = b
  }
  return max + 1
}

// ---------------------------------------------------------------------------
// THE PULSE — the bright wave that walks the grid in order: out of the import
// points, the plant and the incinerator (the roots: nothing flows into them),
// along the 220 kV backbone to the landing substations, down the 110 kV and
// 66 kV ties, and then outward through the street mesh. The machinery lives
// in src/flowPulse.ts, shared with WATER; this is POWER's tuning and names.
// ---------------------------------------------------------------------------

// Layer budgets. Both groups are built ONCE per style with this many layers,
// before any data has arrived, so the counts are fixed caps rather than
// data-derived: a chunk past the last bucket is clamped into it. 50 × 400 m
// covers a 20 km chain (the 北通道 backbone alone is 8.7 km before it fans
// out); 15 × 400 m a 6 km walk from the nearest substation, beyond the mesh's
// 5.6 km maximum.
export const POWER_TRUNK_PULSE_BUCKETS = 50
export const POWER_MESH_PULSE_BUCKETS = 15
// Warm white: brighter than every amber it passes over, so a lit chunk reads
// as the cable itself lighting up rather than a new line on top.
export const POWER_PULSE_COLOR = '#fff3c4'

// Metres along the network from the nearest root to every node. The network's
// own nodes (the import points) count even with no line attached.
export function powerArrivalDistances(
  network: PowerNetwork | null | undefined,
): Map<string, number> {
  return arrivalDistances(network?.lines ?? [], (network?.nodes ?? []).map(n => n.id))
}

// Every line cut into one-bucket chunks (see buildPulseFeatures), each tagged
// with its voltage, its line id and the voltage's core widths — so the lit
// chunk can be drawn a multiple of the corridor it rides, the way the glow and
// the dots are. Vertex order is preserved, `from` end first, like
// buildPowerLineFeatures.
export function buildPowerPulseFeatures(
  network: PowerNetwork | null | undefined,
  bucketM: number = PULSE_BUCKET_M,
  buckets: number = POWER_TRUNK_PULSE_BUCKETS,
): PulseBuild {
  return buildPulseFeatures(
    network?.lines ?? [], bucketM, buckets,
    line => ({
      voltageKv: line.voltageKv,
      lineId: line.id,
      width12: powerLineWidth(line.voltageKv, 0),
      width16: powerLineWidth(line.voltageKv, 1),
    }),
  )
}

// One LineString per HV line. `sortKey` puts the higher voltage on top where
// two share a street, `color`/`width12`/`width16` are baked in so the paint
// expressions stay plain `['get', …]` lookups, and `fallback` lets the colour
// fall to grey for a straight-line stand-in. Lines with fewer than two points
// are skipped rather than emitted as broken geometry.
//
// VERTEX ORDER IS LOAD-BEARING: the coordinates are copied through untouched,
// `from` end first, because MapLibre lays a dash pattern along a line in vertex
// order and the flow animation (buildDashFlowSteps) shifts that pattern
// forward. The pipeline orients every line away from an inlet or the plant, so
// the dots travel the way the power does; reverse one here and it would
// visibly feed backwards.
export function buildPowerLineFeatures(
  network: PowerNetwork | null | undefined,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const line of network?.lines ?? []) {
    const coords = line.coordinates
    if (!coords || coords.length < 2) continue
    const kv = line.voltageKv
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        lineId: line.id,
        voltageKv: kv,
        fallback: !!line.fallback,
        // A short straight stub between co-located stations. Carried so the
        // data is inspectable, but NOT styled: unlike `fallback` it is the
        // intended geometry, so it draws exactly like its voltage.
        direct: !!line.direct,
        lengthM: line.lengthM,
        color: line.fallback ? POWER_LINE_FALLBACK_COLOR : powerLineColor(kv),
        width12: powerLineWidth(kv, 0),
        width16: powerLineWidth(kv, 1),
        // Higher voltage draws over lower where the two share a street.
        sortKey: isPowerVoltage(kv) ? kv : 0,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}
