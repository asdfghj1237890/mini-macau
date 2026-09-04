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
  WasteSite,
  WasteSiteType,
  WasteSource,
  WasteText,
} from './types'

// Registration order for the marker images, the legend's reading order, and
// the order the per-type toggles appear in: the three IAM collection kinds
// first, then DSPA's four recycling kinds, then IAM's two single-material banks
// (glass and clothing), which come from a different IAM source again.
export const WASTE_TYPES: readonly WasteSiteType[] = [
  'refuse_room', 'compactor', 'refuse_station',
  'smart_machine', 'three_colour', 'e_waste', 'lamp_battery',
  'glass', 'clothing',
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
  // The two single-material banks. Cyan reads as glass against the greens and
  // teals around it; rose keeps the clothing bins apart from the pink
  // lamp/battery points they are most often confused with in the key.
  glass: '#67e8f9',
  clothing: '#fda4af',
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
  // Five glass banks and sixteen clothing banks in the whole territory: they
  // are the scarcest marks on the layer, so they win every collision.
  glass: 0,
  clothing: 1,
  smart_machine: 2,
  e_waste: 3,
  three_colour: 4,
  refuse_room: 5,
  refuse_station: 6,
  compactor: 7,
  lamp_battery: 8,
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

// The five DSPA sewage works. Their own row rather than part of 處理設施: they
// treat water, not refuse, and a reader looking for "where does my rubbish go"
// should not have to switch them off to answer it.
export const WASTE_WWTP_ID = 'wwtp'
export const WASTE_WWTP_COLOR = '#a78bfa'

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
  | WasteSiteType
  | typeof WASTE_ECO_STATION_ID | typeof WASTE_FACILITY_ID | typeof WASTE_WWTP_ID

export const WASTE_LAYER_TYPES: readonly WasteLayerType[] = [
  ...WASTE_TYPES, WASTE_ECO_STATION_ID, WASTE_FACILITY_ID, WASTE_WWTP_ID,
] as const

// Which key row a treatment facility belongs to: the sewage works have their
// own, everything else shares 處理設施 with the incineration plant.
export function wasteFacilityRow(facility: WasteFacility): WasteLayerType {
  return facility.kind === 'wwtp' ? WASTE_WWTP_ID : WASTE_FACILITY_ID
}

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
export const WASTE_WWTP_ICON = `waste-${WASTE_WWTP_ID}`

export function wasteEcoStationIcon(approximate: boolean): string {
  return approximate ? WASTE_ECO_STATION_ICON_APPROX : WASTE_ECO_STATION_ICON
}

export function wasteFacilityIcon(facility: WasteFacility): string {
  if (facility.kind === 'wwtp') return WASTE_WWTP_ICON
  if (facility.kind === 'landfill') return WASTE_LANDFILL_ICON
  return facility.approximate ? WASTE_HAZARDOUS_ICON_APPROX : WASTE_HAZARDOUS_ICON
}

// The colour a facility's marker plate, blocks and panel accent share.
export function wasteFacilityColor(facility: WasteFacility): string {
  if (facility.kind === 'wwtp') return WASTE_WWTP_COLOR
  if (facility.kind === 'landfill') return WASTE_LANDFILL_COLOR
  return WASTE_HAZARDOUS_COLOR
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

// The two banks IAM publishes on its own 環境資訊網 facility map instead of
// data.gov.mo. Their panels credit that map rather than the open-data portal,
// because that is where the record actually comes from.
export const WASTE_IAM_MAP_URL = 'https://www.iam.gov.mo/macaohygiene/c/allgarbage/map'

const WASTE_IAM_MAP_TYPES = new Set<WasteLayerType>(['glass', 'clothing'])

export function wasteFromIamMap(type: WasteLayerType): boolean {
  return WASTE_IAM_MAP_TYPES.has(type)
}

export function wasteAgency(type: WasteLayerType): WasteAgency {
  return type === 'refuse_room' || type === 'compactor' || type === 'refuse_station'
    || wasteFromIamMap(type)
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
    case WASTE_WWTP_ID: return t.wasteTypeWwtp
    case WASTE_FACILITY_ID: return t.wasteTypeFacility
    case WASTE_ECO_STATION_ID: return t.wasteTypeEcoStation
    case 'refuse_room': return t.wasteTypeRefuseRoom
    case 'compactor': return t.wasteTypeCompactor
    case 'refuse_station': return t.wasteTypeRefuseStation
    case 'smart_machine': return t.wasteTypeSmartMachine
    case 'three_colour': return t.wasteTypeThreeColour
    case 'e_waste': return t.wasteTypeEWaste
    case 'glass': return t.wasteTypeGlass
    case 'clothing': return t.wasteTypeClothing
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
// rooms, compactors, refuse stations, treatment facilities) are on, the seven
// recycling rows start hidden — 870 recycling points would otherwise bury the
// 300 collection points the layer is named after. Applies only when nothing is
// stored; a visitor who has toggled anything keeps their own set.
export const DEFAULT_HIDDEN_WASTE_TYPES: WasteTypeSet = new Set<WasteLayerType>([
  'smart_machine', 'three_colour', 'e_waste', 'lamp_battery',
  'glass', 'clothing', 'eco_station',
])

// localStorage key for the hidden types (a JSON array of type ids).
export const LS_WASTE_TYPES_KEY = 'mini-macau-waste-types'
// The default-hidden ids this browser has already been shown. A row that is
// added to DEFAULT_HIDDEN_WASTE_TYPES later starts hidden for returning
// visitors too — their stored set predates the row and cannot have an opinion
// about it — while everything they toggled themselves is kept.
export const LS_WASTE_TYPES_SEEN_KEY = 'mini-macau-waste-types-seen'

function readIdList(key: string): WasteLayerType[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return WASTE_LAYER_TYPES.filter(type => arr.includes(type))
  } catch {
    return null
  }
}

function writeIdList(key: string, ids: Iterable<WasteLayerType>): void {
  try {
    const set = new Set(ids)
    localStorage.setItem(key, JSON.stringify(WASTE_LAYER_TYPES.filter(type => set.has(type))))
  } catch { /* ignore */ }
}

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
  // The two destination rows split the same `facilities` array by kind, and the
  // incineration plant (a POWER record) counts towards 處理設施.
  const facilities = bag.facilities ?? []
  counts[WASTE_WWTP_ID] = facilities.filter(f => f.kind === 'wwtp').length
  counts[WASTE_FACILITY_ID] =
    (bag.incinerator ? 1 : 0) + facilities.length - counts[WASTE_WWTP_ID]
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

// The treatment facilities are filtered by the row each one belongs to: 處理設施
// covers the station and the landfills (with the incineration plant), 污水處理廠
// the five sewage works. With both rows on the input array is returned as-is, so
// the caller's memo keeps its identity and MapView skips a needless setData.
export function visibleWasteFacilities(
  facilities: WasteFacility[] | undefined,
  hidden: WasteTypeSet,
): WasteFacility[] {
  if (!facilities?.length) return NO_FACILITIES
  const treatmentOff = hidden.has(WASTE_FACILITY_ID)
  const wwtpOff = hidden.has(WASTE_WWTP_ID)
  if (treatmentOff && wwtpOff) return NO_FACILITIES
  if (!treatmentOff && !wwtpOff) return facilities
  return facilities.filter(f => !hidden.has(wasteFacilityRow(f)))
}

// Restore the hidden types. Anything unreadable, non-array or naming unknown
// types degrades to "nothing hidden" rather than emptying the layer.
export function loadHiddenWasteTypes(): WasteTypeSet {
  const stored = readIdList(LS_WASTE_TYPES_KEY)
  if (stored === null) {
    writeIdList(LS_WASTE_TYPES_SEEN_KEY, DEFAULT_HIDDEN_WASTE_TYPES)
    return DEFAULT_HIDDEN_WASTE_TYPES
  }
  // Defaults this browser has not been shown yet (a stored set from before
  // the row existed) are applied on top of what the visitor chose.
  const seen = new Set(readIdList(LS_WASTE_TYPES_SEEN_KEY) ?? [])
  const hidden = new Set<WasteLayerType>(stored)
  let changed = false
  for (const type of DEFAULT_HIDDEN_WASTE_TYPES) {
    if (!seen.has(type)) { hidden.add(type); changed = true }
  }
  if (changed) {
    writeIdList(LS_WASTE_TYPES_SEEN_KEY, DEFAULT_HIDDEN_WASTE_TYPES)
    writeIdList(LS_WASTE_TYPES_KEY, hidden)
  }
  return hidden
}

// Persist the hidden types, in WASTE_TYPES order so the stored value is stable.
// Storage can throw (private mode, quota) — losing the preference is never
// worth breaking the toggle.
export function saveHiddenWasteTypes(hidden: WasteTypeSet): void {
  writeIdList(LS_WASTE_TYPES_KEY, hidden)
  // A visitor who toggles has seen every current default; never re-apply them.
  writeIdList(LS_WASTE_TYPES_SEEN_KEY, DEFAULT_HIDDEN_WASTE_TYPES)
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
  if (type === WASTE_WWTP_ID) return WASTE_WWTP_COLOR
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
    case 'facility': return wasteFacilityRow(selection.facility)
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
      // The row this mark belongs to, so a feature says which toggle owns it —
      // the sewage works are 污水處理廠, everything else 處理設施.
      type: wasteFacilityRow(facility),
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

// Every extruded footprint the WASTE layer draws: the incineration plant's 11
// (a POWER record) and the sewage works' own. Deliberately the same contract as
// `buildPowerBuildingFeatures`, so the waste blocks share the
// schools/water/power +2 m margin and z14→15.5 height ramp. `facilityId`
// doubles as the promoted feature id used for the selection highlight, and each
// block is coloured by the kind it belongs to. Nothing to draw (layer off, row
// hidden, file missing) yields an empty collection rather than an
// empty-geometry warning per tile.
export const WASTE_BUILDING_HEIGHT_MARGIN_M = 2
export const WASTE_FEATURE_ID_PROPERTY = 'facilityId'

export function buildWasteBuildingFeatures(
  incinerator: PowerFacility | null,
  facilities?: WasteFacility[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const push = (
    id: string, color: string,
    buildings: readonly { name: string | null; height: number; minHeight: number;
      coordinates: [number, number][][] }[],
  ) => {
    for (const building of buildings) {
      const rings = building.coordinates
      if (!rings?.length || !rings[0]?.length) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: rings },
        properties: {
          facilityId: id,
          color,
          height: building.height + WASTE_BUILDING_HEIGHT_MARGIN_M,
          minHeight: building.minHeight,
          name: building.name,
        },
      })
    }
  }
  // The incineration plant, whose footprints are a POWER record.
  push(WASTE_INCINERATOR_ID, WASTE_INCINERATOR_COLOR, incinerator?.buildings ?? [])
  // Every treatment facility that carries footprints — today the five sewage
  // works. The landfills are areas instead and the station has no outline, so
  // both simply contribute nothing here.
  for (const facility of facilities ?? []) {
    push(facility.id, wasteFacilityColor(facility), facility.buildings ?? [])
  }
  return { type: 'FeatureCollection', features }
}
