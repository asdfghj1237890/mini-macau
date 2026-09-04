// WASTE · 垃圾回收 — helpers shared by MapView (the marker layer), the legend
// (the type key) and the info panel. The type order, the colour table and the
// per-type visibility rule live here exactly once so the icons on the map, the
// swatches in the key and the panel header can never disagree.
//
// The overlay is time-independent: like the toilets and unlike the road works
// there is no "in force today" notion, so nothing here takes a clock.
import type { Lang, Translations } from './i18n'
import type { PowerFacility, WasteSite, WasteSiteType, WasteSource, WasteText } from './types'

// Registration order for the marker images, the legend's reading order, and
// the order the per-type toggles appear in: the two IAM collection kinds first,
// then DSPA's four recycling kinds.
export const WASTE_TYPES: readonly WasteSiteType[] = [
  'refuse_room', 'compactor', 'smart_machine', 'three_colour', 'e_waste', 'lamp_battery',
] as const

// Marker colours, chosen against the dark basemap and away from the other city
// overlays (WORKS amber, WC teal, PARKING blue, WATER cyan, POWER amber):
// the two IAM disposal kinds are neutral greys, the four recycling kinds each
// get their own hue.
export const WASTE_COLORS: Record<WasteSiteType, string> = {
  refuse_room: '#a1a1aa',
  compactor: '#e4e4e7',
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
  compactor: 4,
  lamp_battery: 5,
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
// So it is a seventh entry in the legend key and the hidden-type set, but NOT a
// WasteSiteType — hence the wider `WasteLayerType` below.
// ---------------------------------------------------------------------------

export const WASTE_INCINERATOR_ID = 'incinerator'

// The lime POWER already draws this plant in, repeated here so the waste
// marker, the waste blocks and the key swatch can never drift from it.
export const WASTE_INCINERATOR_COLOR = '#a3e635'

// Every togglable row of the WASTE key: the six site types plus the plant.
export type WasteLayerType = WasteSiteType | typeof WASTE_INCINERATOR_ID

export const WASTE_LAYER_TYPES: readonly WasteLayerType[] = [
  ...WASTE_TYPES, WASTE_INCINERATOR_ID,
] as const

// Registered MapLibre image for the plant's marker, alongside the six site
// images. Same naming rule, so the addImage loop and the symbol layer's
// `['get','icon']` still read one string.
export const WASTE_INCINERATOR_ICON = `waste-${WASTE_INCINERATOR_ID}`

// Drawn last of all the waste markers: it is one point among ~1,100, and the
// blocks under it already carry the plant, so it never needs to win a
// collision against a bin.
export const WASTE_INCINERATOR_SORT_KEY = WASTE_TYPES.length

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
  return type === 'refuse_room' || type === 'compactor' ? 'iam' : 'dspa'
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
    case WASTE_INCINERATOR_ID: return t.wasteTypeIncinerator
    case 'refuse_room': return t.wasteTypeRefuseRoom
    case 'compactor': return t.wasteTypeCompactor
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

// localStorage key for the hidden types (a JSON array of type ids).
export const LS_WASTE_TYPES_KEY = 'mini-macau-waste-types'

// Sites whose type is not hidden. With nothing hidden the input array is
// returned as-is, so the caller's memo keeps its identity and MapView skips a
// needless setData.
export function visibleWasteSites(sites: WasteSite[], hidden: WasteTypeSet): WasteSite[] {
  if (hidden.size === 0) return sites
  return sites.filter(site => !hidden.has(site.type))
}

// How many sites carry each type, for the legend's per-type counts. Always has
// all SEVEN keys, so a type with no sites reads 0 rather than undefined. The
// plant is counted from the POWER record rather than from `sites` — it is 1
// when power-facilities.json carries it and 0 when it does not, so the key
// never promises a block the map cannot draw.
export function countWasteByType(
  sites: WasteSite[],
  incinerator?: PowerFacility | null,
): Record<WasteLayerType, number> {
  const counts = Object.fromEntries(
    WASTE_LAYER_TYPES.map(type => [type, 0])
  ) as Record<WasteLayerType, number>
  for (const site of sites) {
    if (site.type in counts) counts[site.type] += 1
  }
  counts[WASTE_INCINERATOR_ID] = incinerator ? 1 : 0
  return counts
}

// How many marks are actually drawn, given the hidden set — the number the
// legend row shows next to WASTE (1,095 with everything on: 1,094 points plus
// the plant).
export function visibleWasteCount(
  counts: Record<WasteLayerType, number>,
  hidden: WasteTypeSet,
): number {
  return WASTE_LAYER_TYPES.reduce(
    (sum, type) => (hidden.has(type) ? sum : sum + (counts[type] ?? 0)), 0
  )
}

// The plant, unless its key row is switched off. Null also when the POWER file
// has not landed — the one place every waste reader asks "do we draw it?".
export function visibleWasteIncinerator(
  incinerator: PowerFacility | null,
  hidden: WasteTypeSet,
): PowerFacility | null {
  return incinerator && !hidden.has(WASTE_INCINERATOR_ID) ? incinerator : null
}

// Restore the hidden types. Anything unreadable, non-array or naming unknown
// types degrades to "nothing hidden" rather than emptying the layer.
export function loadHiddenWasteTypes(): WasteTypeSet {
  try {
    const raw = localStorage.getItem(LS_WASTE_TYPES_KEY)
    if (!raw) return NO_HIDDEN_WASTE_TYPES
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return NO_HIDDEN_WASTE_TYPES
    return new Set(WASTE_LAYER_TYPES.filter(type => arr.includes(type)))
  } catch {
    return NO_HIDDEN_WASTE_TYPES
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

// One row per type, always all SEVEN — a type with zero sites still reads 0 so
// the key describes the whole dataset rather than today's subset. The plant is
// last: it is the destination the six collection kinds feed, not one of them.
export function wasteLegendRows(
  t: Translations,
  counts: Record<WasteLayerType, number>,
  hidden: WasteTypeSet,
): WasteLegendRow[] {
  return WASTE_LAYER_TYPES.map(type => ({
    id: type,
    label: wasteTypeLabel(t, type),
    color: type === WASTE_INCINERATOR_ID ? WASTE_INCINERATOR_COLOR : WASTE_COLORS[type],
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

// The feature id the marker ring filters on, for either kind.
export function wasteSelectionId(selection: WasteSelection | null | undefined): string | null {
  if (!selection) return null
  return selection.kind === 'site' ? selection.site.id : selection.facility.id
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
  incinerator?: PowerFacility | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const site of sites) {
    const coords = site.coordinates
    if (!coords || coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coords[0], coords[1]] },
      properties: {
        id: site.id,
        type: site.type,
        icon: wasteIconName(site.type),
        closed: !!site.closed,
        sortKey: WASTE_SORT_KEY[site.type] ?? WASTE_TYPES.length,
      },
    })
  }
  // The plant rides in the SAME symbol source as the bins, so it collides with
  // them, dims with them and is picked up by the one click handler — the only
  // difference is where its record came from.
  const plant = incinerator?.coordinates
  if (plant && plant.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [plant[0], plant[1]] },
      properties: {
        id: WASTE_INCINERATOR_ID,
        type: WASTE_INCINERATOR_ID,
        icon: WASTE_INCINERATOR_ICON,
        closed: false,
        sortKey: WASTE_INCINERATOR_SORT_KEY,
      },
    })
  }
  return { type: 'FeatureCollection', features }
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
