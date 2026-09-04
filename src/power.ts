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
// `boltHollow` the two marker plates, `line` a corridor sample and `inlet` the
// arrow disc.
export type PowerLegendGlyph = 'square' | 'bolt' | 'boltHollow' | 'line' | 'inlet'

export interface PowerLegendRow {
  id: string
  label: string
  glyph: PowerLegendGlyph
  color: string
  // `line` rows only: the distribution network is drawn thinner and fainter
  // than a trunk corridor, and its swatch says so — otherwise it would be
  // indistinguishable from the 66 kV row above it.
  thin: boolean
}

export function powerLegendRows(
  t: Translations,
  network?: PowerNetwork | null,
): PowerLegendRow[] {
  const rows: PowerLegendRow[] = [
    { id: 'plant', label: t.powerTypePlant, glyph: 'square', color: POWER_COLORS.plant, thin: false },
    { id: 'incinerator', label: t.powerTypeIncinerator, glyph: 'square', color: POWER_COLORS.incinerator, thin: false },
    { id: 'sub220', label: t.powerTypeSub220, glyph: 'bolt', color: POWER_COLORS.sub220, thin: false },
    { id: 'sub110', label: t.powerTypeSub110, glyph: 'bolt', color: POWER_COLORS.sub110, thin: false },
    { id: 'sub66', label: t.powerTypeSub66, glyph: 'bolt', color: POWER_COLORS.sub66, thin: false },
    // The hollow plate is a statement about certainty, not about type, so the
    // row uses the commonest approximate tier's colour and says what it means.
    { id: 'approximate', label: t.powerApproximate, glyph: 'boltHollow', color: POWER_COLORS.sub66, thin: false },
  ]
  // One row per voltage the file actually carries — a network with no 220 kV
  // corridors must not advertise a mark that is not on screen.
  const lines = network?.lines ?? []
  for (const kv of POWER_VOLTAGES) {
    if (!lines.some(l => l.voltageKv === kv)) continue
    rows.push({
      id: `line-${kv}`, label: t.powerLineVoltage(kv), glyph: 'line',
      color: POWER_LINE_COLORS[kv], thin: false,
    })
  }
  // Unconditional: the distribution network is Macau's own streets restyled, so
  // it is on the map whenever the layer is, network file or not.
  rows.push({
    id: 'distribution', label: t.powerLegendDistribution, glyph: 'line',
    color: POWER_DISTRIBUTION_COLOR, thin: true,
  })
  if (network?.nodes?.some(n => n.kind === 'inlet')) {
    rows.push({
      id: 'inlet', label: t.powerTypeInlet, glyph: 'inlet', color: POWER_INLET_COLOR, thin: false,
    })
  }
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
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties: {
        facilityId: node.id,
        type: node.kind,
        // A node is a point we chose deliberately, not an inferred stand-in for
        // a facility we could not locate — so it never draws hollow.
        approximate: false,
        icon: POWER_INLET_ICON,
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

// One LineString per road, carrying only its class. Same contract (and same
// reasoning) as buildWaterDistributionFeatures: per-road features are what let
// MapLibre cull, query and width-ramp each street individually, and the source
// is written once rather than per frame. Roads with fewer than two points are
// skipped.
export function buildPowerDistributionFeatures(
  roads: PowerDistributionRoad[] | null | undefined,
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
