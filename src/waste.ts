// WASTE · 垃圾回收 — helpers shared by MapView (the marker layer), the legend
// (the type key) and the info panel. The type order, the colour table and the
// per-type visibility rule live here exactly once so the icons on the map, the
// swatches in the key and the panel header can never disagree.
//
// The overlay is time-independent: like the toilets and unlike the road works
// there is no "in force today" notion, so nothing here takes a clock.
import type { Lang, Translations } from './i18n'
import type {
  PowerFacility,
  WasteEcoStation,
  WasteFacility,
  WasteIncineratorMonth,
  WasteSite,
  WasteSiteType,
  WasteSource,
  WasteText,
} from './types'

// Registration order for the marker images, the legend's reading order, and
// the order the per-type toggles appear in: the two IAM collection kinds first,
// then DSPA's four recycling kinds.
export const WASTE_TYPES: readonly WasteSiteType[] = [
  'refuse_room', 'compactor', 'refuse_station',
  'smart_machine', 'three_colour', 'e_waste', 'lamp_battery',
] as const

// Marker colours, chosen against the dark basemap and away from the other city
// overlays (WORKS amber, WC teal, PARKING blue, WATER cyan, POWER amber):
// the two IAM disposal kinds are neutral greys, the four recycling kinds each
// get their own hue.
export const WASTE_COLORS: Record<WasteSiteType, string> = {
  refuse_room: '#a1a1aa',
  compactor: '#e4e4e7',
  // Sand, so the 垃圾站 markers read apart from the two greys either side of
  // them in the key — all three are IAM disposal points, and at city zoom the
  // shape alone is not enough to tell them apart.
  refuse_station: '#f5d0a9',
  smart_machine: '#2dd4bf',
  three_colour: '#4ade80',
  e_waste: '#c084fc',
  lamp_battery: '#f9a8d4',
}

// The three bins a 三色 point actually holds — blue paper, yellow plastic,
// brown metal. Drawn into that type's marker and its legend swatch, so the key
// explains a mark the map really makes.
export const WASTE_THREE_COLOUR_BINS: readonly string[] = ['#3b82f6', '#facc15', '#92400e'] as const

// Symbol placement priority (lower wins). The marker layer collides icons, so
// at city zoom the RARE types have to survive: 67 smart machines would vanish
// under 406 lamp/battery points otherwise. Ascending scarcity, which is also
// "the more specialised the service, the more worth showing".
export const WASTE_SORT_KEY: Record<WasteSiteType, number> = {
  smart_machine: 0,
  e_waste: 1,
  three_colour: 2,
  refuse_room: 3,
  refuse_station: 4,
  compactor: 5,
  lamp_battery: 6,
}

// ---------------------------------------------------------------------------
// The incineration plant. 澳門垃圾焚化中心 is where Macau's collected refuse
// actually ENDS UP, so the waste overlay would be telling half a story without
// it — but it is not one of the six point datasets: it is a building complex,
// and it is already loaded at startup as the `incinerator` record of
// power-facilities.json (the POWER layer draws it as a generating station,
// because it sells its electricity to CEM). Rather than add a pipeline step
// that would duplicate 11 footprints into a second file, the waste overlay
// reads that same record and draws it in the same lime the POWER layer uses.
//
// It shares a key row with the OTHER end-of-life sites — the hazardous waste
// station beside it and the two landfills — under 處理設施 (`facility`), because
// what they have in common is that refuse arrives there rather than leaves.
// None of them is a WasteSiteType, hence the wider `WasteLayerType` below.
// ---------------------------------------------------------------------------

export const WASTE_INCINERATOR_ID = 'incinerator'

// The lime POWER already draws this plant in, repeated here so the waste
// marker, the waste blocks and the key swatch can never drift from it.
export const WASTE_INCINERATOR_COLOR = '#a3e635'

// The DSPA 環保加Fun站 recycling centres — a key row of their own, because they
// are staffed drop-off centres rather than street furniture.
export const WASTE_ECO_STATION_ID = 'eco_station'
export const WASTE_ECO_STATION_COLOR = '#86efac'

// The 處理設施 row: the incinerator, the hazardous-waste station and the two
// landfills, toggled together.
export const WASTE_FACILITY_ID = 'facility'

// Per-kind colours inside that row. The station is a warning red-orange; the
// landfills are the same stone the polygons are filled with.
export const WASTE_HAZARDOUS_COLOR = '#fb7185'
export const WASTE_LANDFILL_COLOR = '#a8a29e'

// The landfill polygons' fill opacity — low enough that the basemap's coastline
// and the roads across the site still read through them.
export const WASTE_AREA_FILL_OPACITY = 0.35

// Every togglable row of the WASTE key: the seven site types, the eco stations
// and the treatment facilities.
export type WasteLayerType =
  | WasteSiteType | typeof WASTE_ECO_STATION_ID | typeof WASTE_FACILITY_ID

export const WASTE_LAYER_TYPES: readonly WasteLayerType[] = [
  ...WASTE_TYPES, WASTE_ECO_STATION_ID, WASTE_FACILITY_ID,
] as const

// Registered MapLibre images for the marks that are not collection points.
// Same naming rule as `wasteIconName`, so the addImage loop and the symbol
// layer's `['get','icon']` still read one string. The `-approx` variants are
// hollow, exactly as the water and power markers distinguish a placed marker
// from a surveyed one.
export const WASTE_INCINERATOR_ICON = `waste-${WASTE_INCINERATOR_ID}`
export const WASTE_LANDFILL_ICON = 'waste-landfill'
export const WASTE_HAZARDOUS_ICON = 'waste-hazardous'
export const WASTE_HAZARDOUS_ICON_APPROX = `${WASTE_HAZARDOUS_ICON}-approx`
export const WASTE_ECO_STATION_ICON = `waste-${WASTE_ECO_STATION_ID}`
export const WASTE_ECO_STATION_ICON_APPROX = `${WASTE_ECO_STATION_ICON}-approx`

export function wasteEcoStationIcon(approximate: boolean): string {
  return approximate ? WASTE_ECO_STATION_ICON_APPROX : WASTE_ECO_STATION_ICON
}

export function wasteFacilityIcon(facility: WasteFacility): string {
  if (facility.kind === 'landfill') return WASTE_LANDFILL_ICON
  return facility.approximate ? WASTE_HAZARDOUS_ICON_APPROX : WASTE_HAZARDOUS_ICON
}

// Collision priority for the non-collection marks. NEGATIVE, so all fourteen of
// them outrank every bin: there are four facilities and ten eco stations among
// ~1,150 marks, and losing one to a lamp-and-battery point would be losing the
// only mark of its kind on the map.
export const WASTE_FACILITY_SORT_KEY = -2
export const WASTE_ECO_STATION_SORT_KEY = -1

// The incinerator record out of the POWER facility list, or null when
// power-facilities.json has not landed (or ever loses that record). Matched on
// BOTH the id and the type so a future renumbering cannot silently promote some
// other station into the waste overlay.
export function wasteIncinerator(facilities: PowerFacility[] | undefined): PowerFacility | null {
  return facilities?.find(
    f => f.id === WASTE_INCINERATOR_ID && f.type === 'incinerator'
  ) ?? null
}

// Which agency publishes a type — the panel's provenance line, and nothing
// else. IAM runs the disposal points, DSPA the recycling ones — and the
// incineration plant is DSPA's too.
export type WasteAgency = 'iam' | 'dspa'

export function wasteAgency(type: WasteLayerType): WasteAgency {
  return type === 'refuse_room' || type === 'compactor' || type === 'refuse_station'
    ? 'iam'
    : 'dspa'
}

// Name of the registered MapLibre image for a type. Kept next to the colour
// table so MapView's `map.addImage` loop and the symbol layer's
// `['get','icon']` read the same strings.
export function wasteIconName(type: WasteSiteType): string {
  return `waste-${type}`
}

// Localised field text. The DSPA feeds carry no English at all and the IAM
// address block is zh/pt only, so `en` falls back to Portuguese before Chinese
// (en → pt → zh) — the same rule the water overlay uses, and what a
// non-Chinese reader can actually use.
export function pickWasteText(field: WasteText | null | undefined, lang: Lang): string {
  if (!field) return ''
  if (lang === 'zh') return field.zh || field.en || field.pt || ''
  if (lang === 'pt') return field.pt || field.en || field.zh || ''
  return field.en || field.pt || field.zh || ''
}

// UI label for a site type. Uses the normalised enum (not the site's own name)
// so the three UI languages stay consistent.
export function wasteTypeLabel(t: Translations, type: WasteLayerType): string {
  switch (type) {
    case WASTE_FACILITY_ID: return t.wasteTypeFacility
    case WASTE_ECO_STATION_ID: return t.wasteTypeEcoStation
    case 'refuse_room': return t.wasteTypeRefuseRoom
    case 'compactor': return t.wasteTypeCompactor
    case 'refuse_station': return t.wasteTypeRefuseStation
    case 'smart_machine': return t.wasteTypeSmartMachine
    case 'three_colour': return t.wasteTypeThreeColour
    case 'e_waste': return t.wasteTypeEWaste
    default: return t.wasteTypeLampBattery
  }
}

// ---------------------------------------------------------------------------
// Per-type visibility. The legend's WASTE row toggles individual site types, so
// App filters the array before it reaches MapView (the map layer itself stays a
// single source rebuilt on array identity change).
//
// Stored as the HIDDEN set rather than the visible one, deliberately: a type
// added later must appear by default, and "hidden" is the only encoding where
// an older stored value cannot silently suppress it.
// ---------------------------------------------------------------------------

export type WasteTypeSet = ReadonlySet<WasteLayerType>

// Nothing hidden — the default, and the fallback for missing/corrupt storage.
export const NO_HIDDEN_WASTE_TYPES: WasteTypeSet = new Set<WasteLayerType>()

// What a first-time visitor sees: the collection and treatment rows (refuse
// rooms, compactors, refuse stations, treatment facilities) are on, the five
// recycling rows start hidden — 850 recycling points would otherwise bury the
// 300 collection points the layer is named after. Applies only when nothing is
// stored; a visitor who has toggled anything keeps their own set.
export const DEFAULT_HIDDEN_WASTE_TYPES: WasteTypeSet = new Set<WasteLayerType>([
  'smart_machine', 'three_colour', 'e_waste', 'lamp_battery', 'eco_station',
])

// localStorage key for the hidden types (a JSON array of type ids).
export const LS_WASTE_TYPES_KEY = 'mini-macau-waste-types'

// Sites whose type is not hidden. With nothing hidden the input array is
// returned as-is, so the caller's memo keeps its identity and MapView skips a
// needless setData.
export function visibleWasteSites(sites: WasteSite[], hidden: WasteTypeSet): WasteSite[] {
  if (hidden.size === 0) return sites
  return sites.filter(site => !hidden.has(site.type))
}

// Everything the WASTE overlay draws besides the collection points. Grouped
// into one bag so the count, the visibility filter and the feature builders all
// take the same argument and cannot be given three inconsistent halves.
export interface WasteExtras {
  incinerator?: PowerFacility | null
  ecoStations?: WasteEcoStation[]
  facilities?: WasteFacility[]
}

// How many marks each key row stands for. Always has all NINE keys, so a row
// with nothing behind it reads 0 rather than undefined. `facility` is the sum
// of the plant (from the POWER record) and the treatment facilities, because
// they share one row.
export function countWasteByType(
  sites: WasteSite[],
  extras?: WasteExtras | null,
): Record<WasteLayerType, number> {
  const bag = extras ?? {}
  const counts = Object.fromEntries(
    WASTE_LAYER_TYPES.map(type => [type, 0])
  ) as Record<WasteLayerType, number>
  for (const site of sites) {
    if (site.type in counts) counts[site.type] += 1
  }
  counts[WASTE_ECO_STATION_ID] = bag.ecoStations?.length ?? 0
  counts[WASTE_FACILITY_ID] =
    (bag.incinerator ? 1 : 0) + (bag.facilities?.length ?? 0)
  return counts
}

// How many marks are actually drawn, given the hidden set — the number the
// legend row shows next to WASTE (1,150 with everything on: 1,136 collection
// points, 10 eco stations and 4 treatment facilities).
export function visibleWasteCount(
  counts: Record<WasteLayerType, number>,
  hidden: WasteTypeSet,
): number {
  return WASTE_LAYER_TYPES.reduce(
    (sum, type) => (hidden.has(type) ? sum : sum + (counts[type] ?? 0)), 0
  )
}

// The plant, unless the 處理設施 row is switched off. Null also when the POWER
// file has not landed — the one place every waste reader asks "do we draw it?".
export function visibleWasteIncinerator(
  incinerator: PowerFacility | null,
  hidden: WasteTypeSet,
): PowerFacility | null {
  return incinerator && !hidden.has(WASTE_FACILITY_ID) ? incinerator : null
}

// Stable empties, so a hidden row hands the caller's memo the SAME array every
// render and MapView skips a needless setData.
const NO_ECO_STATIONS: WasteEcoStation[] = []
const NO_FACILITIES: WasteFacility[] = []

export function visibleWasteEcoStations(
  stations: WasteEcoStation[] | undefined,
  hidden: WasteTypeSet,
): WasteEcoStation[] {
  if (!stations?.length || hidden.has(WASTE_ECO_STATION_ID)) return NO_ECO_STATIONS
  return stations
}

// The treatment facilities share the plant's row, so one toggle empties both.
export function visibleWasteFacilities(
  facilities: WasteFacility[] | undefined,
  hidden: WasteTypeSet,
): WasteFacility[] {
  if (!facilities?.length || hidden.has(WASTE_FACILITY_ID)) return NO_FACILITIES
  return facilities
}

// Restore the hidden types. Anything unreadable, non-array or naming unknown
// types degrades to "nothing hidden" rather than emptying the layer.
export function loadHiddenWasteTypes(): WasteTypeSet {
  try {
    const raw = localStorage.getItem(LS_WASTE_TYPES_KEY)
    if (!raw) return DEFAULT_HIDDEN_WASTE_TYPES
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return DEFAULT_HIDDEN_WASTE_TYPES
    return new Set(WASTE_LAYER_TYPES.filter(type => arr.includes(type)))
  } catch {
    return DEFAULT_HIDDEN_WASTE_TYPES
  }
}

// Persist the hidden types, in WASTE_TYPES order so the stored value is stable.
// Storage can throw (private mode, quota) — losing the preference is never
// worth breaking the toggle.
export function saveHiddenWasteTypes(hidden: WasteTypeSet): void {
  try {
    localStorage.setItem(
      LS_WASTE_TYPES_KEY,
      JSON.stringify(WASTE_LAYER_TYPES.filter(type => hidden.has(type)))
    )
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Legend key
// ---------------------------------------------------------------------------

export interface WasteLegendRow {
  id: WasteLayerType
  label: string
  color: string
  count: number
  on: boolean // this type is NOT hidden
}

// The swatch colour for a key row.
export function wasteLayerColor(type: WasteLayerType): string {
  if (type === WASTE_FACILITY_ID) return WASTE_INCINERATOR_COLOR
  if (type === WASTE_ECO_STATION_ID) return WASTE_ECO_STATION_COLOR
  return WASTE_COLORS[type]
}

// One row per type, always all NINE — a row with nothing behind it still reads 0
// so the key describes the whole dataset rather than today's subset. The two
// destination rows come last: they are where the seven collection kinds feed,
// not one of them.
export function wasteLegendRows(
  t: Translations,
  counts: Record<WasteLayerType, number>,
  hidden: WasteTypeSet,
): WasteLegendRow[] {
  return WASTE_LAYER_TYPES.map(type => ({
    id: type,
    label: wasteTypeLabel(t, type),
    color: wasteLayerColor(type),
    count: counts[type] ?? 0,
    on: !hidden.has(type),
  }))
}

// ---------------------------------------------------------------------------
// What the user clicked. One slot rather than two pieces of App state, because
// the two kinds of mark share a symbol layer, a highlight and an exclusivity
// rule — only the panel that opens differs.
// ---------------------------------------------------------------------------
export type WasteSelection =
  | { kind: 'site'; site: WasteSite }
  | { kind: 'incinerator'; facility: PowerFacility }
  | { kind: 'ecoStation'; station: WasteEcoStation }
  | { kind: 'facility'; facility: WasteFacility }

// The feature id the marker ring filters on, for every kind.
export function wasteSelectionId(selection: WasteSelection | null | undefined): string | null {
  if (!selection) return null
  switch (selection.kind) {
    case 'site': return selection.site.id
    case 'ecoStation': return selection.station.id
    default: return selection.facility.id
  }
}

// The key row a selection belongs to, so App can close a panel whose row the
// user has just switched off.
export function wasteSelectionType(selection: WasteSelection): WasteLayerType {
  switch (selection.kind) {
    case 'site': return selection.site.type
    case 'ecoStation': return WASTE_ECO_STATION_ID
    default: return WASTE_FACILITY_ID
  }
}

// The dataset a site came from, for the panel's provenance link and "as of"
// stamp. `lamp_battery` is published twice (光管 + 電池) — the first entry wins,
// which is the 光管 list the ids come from.
export function wasteSourceForType(
  sources: WasteSource[] | undefined,
  type: WasteSiteType,
): WasteSource | null {
  return sources?.find(source => source.type === type) ?? null
}

// One Point feature per site. `icon` drives the marker image, `closed` the 45 %
// dimming and `sortKey` the collision priority; `id` is what the click handler
// looks the site up by. Records with no usable coordinate pair are skipped
// rather than emitted as broken geometry (MapLibre would warn on every tile).
export function buildWasteFeatures(
  sites: WasteSite[],
  extras?: WasteExtras | null,
): GeoJSON.FeatureCollection {
  const bag = extras ?? {}
  const features: GeoJSON.Feature[] = []
  const point = (
    coords: [number, number] | undefined,
    properties: Record<string, string | number | boolean>,
  ) => {
    if (!coords || coords.length < 2) return
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties,
    })
  }

  for (const site of sites) {
    point(site.coordinates, {
      id: site.id,
      type: site.type,
      icon: wasteIconName(site.type),
      closed: !!site.closed,
      sortKey: WASTE_SORT_KEY[site.type] ?? WASTE_TYPES.length,
    })
  }
  // Everything below rides in the SAME symbol source as the bins, so it collides
  // with them, dims with them and is picked up by the one click handler — the
  // only difference is where each record came from.
  for (const station of bag.ecoStations ?? []) {
    point(station.coordinates, {
      id: station.id,
      type: WASTE_ECO_STATION_ID,
      icon: wasteEcoStationIcon(station.approximate),
      closed: false,
      sortKey: WASTE_ECO_STATION_SORT_KEY,
    })
  }
  for (const facility of bag.facilities ?? []) {
    // A landfill's mark sits at its ring's centroid, so clicking either the
    // polygon or the mound opens the same panel.
    point(facility.coordinates, {
      id: facility.id,
      type: WASTE_FACILITY_ID,
      icon: wasteFacilityIcon(facility),
      closed: false,
      sortKey: WASTE_FACILITY_SORT_KEY,
    })
  }
  point(bag.incinerator?.coordinates, {
    id: WASTE_INCINERATOR_ID,
    type: WASTE_FACILITY_ID,
    icon: WASTE_INCINERATOR_ICON,
    closed: false,
    sortKey: WASTE_FACILITY_SORT_KEY,
  })
  return { type: 'FeatureCollection', features }
}

// The landfill outlines as fill polygons for the `waste-areas` layer. Only the
// facilities that HAVE a ring appear — the hazardous station is a marker only,
// because its position is approximate and inventing an outline for it would be
// claiming something false.
export function buildWasteAreaFeatures(
  facilities: WasteFacility[] | undefined,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const facility of facilities ?? []) {
    const ring = facility.polygon
    if (!ring || ring.length < 4) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        id: facility.id,
        [WASTE_FEATURE_ID_PROPERTY]: facility.id,
        color: WASTE_LANDFILL_COLOR,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// ---------------------------------------------------------------------------
// Incinerator statistics, for the plant panel's stats block.
// ---------------------------------------------------------------------------

// A published tonnage/MWh figure as the panel prints it: thousands separated,
// no decimals. These are monthly totals in the tens of thousands — the two
// decimal places upstream publishes are noise at that scale.
export function formatWasteAmount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('en-US')
}

// "2026-06" → the label under a bar. Kept numeric so it reads the same in all
// three UI languages.
export function wasteMonthLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  return m ? `${m[2]}` : period
}

// Each month's bar height as a percentage of the tallest, floored at 4 % so a
// quiet month is still a visible mark rather than a gap in the strip.
export function wasteMonthBars(
  months: WasteIncineratorMonth[] | undefined,
): { period: string; label: string; value: number; percent: number }[] {
  const rows = months ?? []
  const max = rows.reduce((m, r) => Math.max(m, r.receivedT || 0), 0)
  return rows.map(r => ({
    period: r.period,
    label: wasteMonthLabel(r.period),
    value: r.receivedT,
    percent: max > 0 ? Math.max(4, Math.round((r.receivedT / max) * 100)) : 0,
  }))
}

// The plant's 11 footprints as extrusion polygons — deliberately the same
// contract as `buildPowerBuildingFeatures` (the record IS a POWER record), so
// the waste blocks share the schools/water/power +2 m margin and z14→15.5
// height ramp. `facilityId` doubles as the promoted feature id used for the
// selection highlight. Null (layer off, type hidden, file missing) draws
// nothing rather than an empty-geometry warning per tile.
export const WASTE_BUILDING_HEIGHT_MARGIN_M = 2
export const WASTE_FEATURE_ID_PROPERTY = 'facilityId'

export function buildWasteBuildingFeatures(
  incinerator: PowerFacility | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const building of incinerator?.buildings ?? []) {
    const rings = building.coordinates
    if (!rings?.length || !rings[0]?.length) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: rings },
      properties: {
        facilityId: WASTE_INCINERATOR_ID,
        color: WASTE_INCINERATOR_COLOR,
        height: building.height + WASTE_BUILDING_HEIGHT_MARGIN_M,
        minHeight: building.minHeight,
        name: building.name,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}
