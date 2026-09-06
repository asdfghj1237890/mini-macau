import type { Feature, LineString } from 'geojson'
import type React from 'react'

export interface Station {
  id: string
  name: string
  nameCn: string
  namePt: string
  coordinates: [number, number]
  lineIds: string[]
}

export interface LRTLine {
  id: string
  name: string
  nameCn: string
  // Portuguese name (optional — upstream DSAT/MLM data isn't always trilingual
  // for every line; falls back to `name` via localName()).
  namePt?: string
  color: string
  // Station ids in track order, running in the direction of the line's
  // *forward* trips. validate_output.py cross-checks this against the trips;
  // downstream readers label direction 0 as stations[0] → stations[-1].
  stations: string[]
  geometry: Feature<LineString>
}

export interface BusRoute {
  id: string
  name: string
  nameCn: string
  namePt?: string
  color: string
  stopsForward: string[]
  stopsBackward: string[]
  // Vertex index in `geometry` for each `stopsForward` entry. Values are
  // strictly increasing, so repeated roads/stops still map to the correct
  // pass through a self-crossing loop.
  stopOffsets: number[]
  // Index in stopsForward/stopOffsets where DSAT direction 1 begins.
  // Equals stopsForward.length when DSAT publishes only one direction.
  directionSplitIndex: number
  geometry: Feature<LineString>
  frequency: number // minutes between departures
  // Fractional hour (5.75 = 05:45). End may exceed 24 when service crosses
  // midnight — simulation & service checks treat end<=start as +1440min.
  serviceHoursStart: number | null      // Weekday/default window
  serviceHoursEnd: number | null        // Weekday/default window
  // Saturday override; falls back to weekday when absent. Explicit null means
  // this bucket exists but has no service.
  serviceHoursStartSat?: number | null
  serviceHoursEndSat?: number | null
  // Sunday override; falls back to weekday when absent. Explicit null means
  // this bucket exists but has no service.
  serviceHoursStartSun?: number | null
  serviceHoursEndSun?: number | null
  routeType: 'bilateral' | 'circular'
}

export interface BusStop {
  id: string
  name: string
  nameCn: string
  namePt?: string
  coordinates: [number, number]
  routeIds: string[]
}

export interface TimetableEntry {
  stationId: string
  arrivalMinutes: number
  departureMinutes?: number
}

export type ScheduleType = 'mon_thu' | 'friday' | 'sat_sun'

export interface Trip {
  id: string
  lineId: string
  direction: 'forward' | 'backward'
  scheduleType?: ScheduleType
  entries: TimetableEntry[]
}

export interface FlightAirport {
  iata: string
  name: string
  nameCn?: string
  namePt?: string
  bearing: number
}

export interface Flight {
  id: string
  flightNumber: string
  airline: { name: string; iata: string }
  type: 'departure' | 'arrival'
  scheduledTime: number // minutes since midnight
  destination?: FlightAirport
  origin?: FlightAirport
  aircraftType?: string
  // Present only on records produced by the multi-day timetable workflow
  // (`fetch_flights.py --days N>1`). Format: YYYY-MM-DD in Macau-local
  // time. Absent on the per-day realtime file. Used by the `useTransitData`
  // hook to bucket records into a `byDate` lookup.
  date?: string
}

export interface Ferry {
  id: string
  routeId: string // e.g. "hkgmacroute"
  // Route display names. `routeName` = English (from upstream `nameEn`),
  // `routeNameCn` = 繁中 (from upstream `nameZh`). Portuguese is optional
  // — upstream TurboJET / Cotai schedules don't publish pt names today, so
  // we fall back to English via localName() when pt is undefined.
  routeName: string
  routeNameCn: string
  routeNamePt?: string
  operator: 'turbojet' | 'cotai'
  terminal: 'outer_harbour' | 'taipa'
  type: 'departure' | 'arrival' // relative to the Macau terminal
  scheduledTime: number // minutes since midnight; berth time at Macau
  // The non-Macau endpoint of this leg. Only the Chinese form is reliably
  // in the source JSON (direction.from/to are Chinese); English/Portuguese
  // are optional and fall back via localName().
  otherPortCn: string // e.g. "香港(上環)"
  otherPort?: string
  otherPortPt?: string
  journeyMinutes: number
  markers?: string // e.g. "*", "#", "@"
  berthIndex: number // index within FERRY_BERTHS_BY_TERMINAL[terminal]
}

// Bilingual free text as published by DSAT. The upstream feed is zh/pt only —
// there is no English form, so `pickText` in roadWorks.ts maps en → pt (Macau
// street names are officially Portuguese).
export interface RoadWorkText {
  zh: string
  pt: string
}

export type RoadWorkRestriction = 'closed' | 'limited' | 'one_way' | 'no_parking' | 'other'

// One DSAT 工程改道 (traffic-diversion) notice, from
// public/data/road-works.json. Dates are Macau-local YYYY-MM-DD calendar
// days, so they compare correctly as plain strings.
export interface RoadWorkNotice {
  id: string // aviso_no, e.g. "2509/2026"
  restriction: RoadWorkRestriction
  restrictionText: RoadWorkText
  location: RoadWorkText
  reason: RoadWorkText
  principal: RoadWorkText
  contractor: RoadWorkText // "" when the notice has no contractor
  details: RoadWorkText // plain text; paragraphs separated by \n
  duration: { days: number; hours: number }
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  onlineDate: string // YYYY-MM-DD
  coordinates: [number, number] // [lng, lat]
  previousNotice: string | null
}

// Teaching level a school is coloured by. `all_through` is a school that runs
// kindergarten + primary + secondary under one roof (一條龍); the other four
// are the highest stage the school is approved for. The pipeline decides this
// from the DSEDJ stage flags, so the runtime never re-derives it.
export type SchoolLevel = 'kindergarten' | 'primary' | 'secondary' | 'university' | 'all_through'

// One building footprint of a school campus, from public/data/schools.json.
// `coordinates` is a GeoJSON Polygon coordinate array (outer ring only),
// already buffered ~0.5 m outwards by the pipeline, and `height` is the
// basemap building's height + 0.5 m — together they make our coloured block
// sit proud of the OpenFreeMap extrusion underneath instead of z-fighting it.
export interface SchoolBuilding {
  osmId: string // e.g. "w411047590"
  name: string | null // OSM building name, null when the footprint is unnamed
  height: number // metres
  minHeight: number // metres; 0 for a ground-level building
  coordinates: [number, number][][]
}

// One school from public/data/schools.json: the DSEDJ register (id
// "dsedj:[002]") matched to OSM campus features, plus tertiary institutions
// taken straight from OSM (id "osm:w123" / "osm:n456").
export interface School {
  id: string
  name: { zh: string; pt: string } // no English form upstream; pt may be ""
  level: SchoolLevel
  levels: { kindergarten?: boolean; primary?: boolean; secondary?: boolean }
  system: string // 'private' | 'public' | 'tertiary' — not read by the runtime
  coordinates: [number, number] // representative point [lng, lat]
  osm: string[] // the OSM campus features this school was matched to
  buildings: SchoolBuilding[] // may be empty when no footprint was matched
}

// Trilingual free text as published by IAM. Unlike the DSAT road-works feed
// (zh/pt only) this dataset carries a real English form for every field, so
// `pickToiletText` in toilets.ts hands `en` the English string instead of
// falling back to Portuguese.
export interface ToiletText {
  zh: string
  pt: string
  en: string
}

// One IAM public toilet, from public/data/toilets.json. `coordinates` is
// [lng, lat]; 33 toilets share a point with another (several cubicles at one
// address), which the marker layer does not try to separate.
export interface Toilet {
  id: string // IAM code, "-2"-suffixed on collisions, or a name slug
  code: string | null // the published 編號; null when the source has none
  name: ToiletText // number prefix already stripped by the pipeline
  address: ToiletText
  phone: ToiletText // may be empty strings
  openHours: ToiletText
  accessible: boolean // has a barrier-free cubicle (hasDwc / 無障礙 dataset)
  family: boolean // has a family cubicle (hasFwc)
  closed: boolean // temporarily out of service (tempClose)
  photo: string | null // IAM photo URL
  coordinates: [number, number] // [lng, lat]
}

// Trilingual free text from the DSAT car-park feed. Same shape as ToiletText
// but a separate name on purpose: DSAT publishes no real English names, so the
// `en` side is usually a copy of the Portuguese one (see `pickCarParkText`).
export interface CarParkText {
  zh: string
  pt: string
  en: string
}

// The four price blocks DSAT publishes per car park. `heavy` and `moto` are
// empty strings for the many parks that take neither; `remark` holds the
// day/night definitions and the footnotes the price columns refer to.
export interface CarParkFees {
  light: CarParkText
  heavy: CarParkText
  moto: CarParkText
  remark: CarParkText
}

// One public car park, from public/data/car-parks.json (DSAT car_park_detail).
// `coordinates` is [lng, lat] — the upstream XML calls latitude `X_coords`,
// which the pipeline already swaps.
export interface CarPark {
  id: string // CP_ID, also the key of the live-vacancy feed
  name: CarParkText
  location: CarParkText
  entrance: CarParkText // where the entrance/exit is
  phone: string // may be empty
  heightLimitM: number | null // null when the source publishes "--" / "---"
  fees: CarParkFees
  zone: CarParkText // 澳門 / 氹仔 / 路環
  parish: CarParkText // subdistrict
  coordinates: [number, number] // [lng, lat]
}

// One live row of the DSAT car_park_maintance feed, parsed in carParks.ts.
// Counts are VACANT spaces and are null when the source publishes an empty
// attribute (that park does not report that category). `maintenance` means
// DSAT has suspended publication for this park — the counts are then stale
// and must not be shown. This never reaches TransitData: it is polled by the
// browser (useCarParkVacancy), not committed to public/data.
export interface CarParkVacancy {
  id: string // matches CarPark.id
  car: number | null
  moto: number | null
  eMoto: number | null // OT_A_CNT — electric motorcycles
  eCar: number | null // ELC_CNT — electric cars
  disabled: number | null // DC_CNT
  maintenance: boolean // maintenance="1" → 暫停發佈
  time: string // raw upstream `Time`, e.g. "9/3/2026 4:21:04 PM" (or "-")
  timeParsed: Date | null // that stamp as an instant, null when unparseable
}

// ---- WASTE · 垃圾回收 -----------------------------------------------------
// Nine kinds of collection point from two agencies. IAM publishes the refuse
// rooms, the refuse collection stations, the compacting collection points and —
// from its own 環境資訊網 facility map rather than data.gov.mo — the glass-bottle
// and clothing banks; DSPA publishes the four kinds of recycling point.
// `lamp_battery` folds two identical DSPA datasets (光管 and 電池 — same ids,
// names and coordinates) into one type.
export type WasteSiteType =
  | 'refuse_room' | 'compactor' | 'refuse_station'
  | 'smart_machine' | 'three_colour' | 'e_waste' | 'lamp_battery'
  | 'glass' | 'clothing'

// Trilingual free text for a waste site. `en` is OPTIONAL and often "": the
// DSPA feeds publish Chinese and Portuguese only, and the address block carries
// no English at all — so readers go through `pickWasteText`, which falls back
// en → pt → zh the way the water overlay does.
export interface WasteText {
  zh: string
  pt: string
  en?: string
}

// One collection point, from public/data/waste.json. `coordinates` is
// [lng, lat]. `closed` is IAM's `tempClose` (DSPA sites are never closed);
// `upstreamStatus` is DSPA's undocumented `status` kept raw — it is NOT mapped
// to closure, because nothing upstream says what it means.
export interface WasteSite {
  id: string // "<type>-<slug>" — stable across refetches
  type: WasteSiteType
  name: WasteText
  address: WasteText | null // refuse rooms publish none
  coordinates: [number, number] // [lng, lat]
  closed: boolean
  tel: string | null
  photo: string | null // IAM photo URL
  upstreamStatus: number | null
}

// Where a record's own page says it came from. The three blocks below each
// carry their own, because they are hand-maintained lists and OSM rings rather
// than data.gov.mo datasets with a `sources` entry.
export interface WasteAttribution {
  name: string // already the display string, e.g. "環境保護局 (DSPA)"
  url: string
}

// Where refuse ends up once it has been collected: the special/hazardous waste
// station beside the incinerator, the two landfills, and the five DSPA sewage
// works. `polygon` is an OSM outer ring for the landfills (an area on the map)
// and null for the rest; `buildings` are extruded footprints in exactly the
// power-facility shape, which is what the sewage works carry instead.
// `statsKey` names this facility's series in dspa-stats.json — "hazardous",
// "landfill", "wwtp.macau" … — and is null for a facility DSPA publishes no
// figures for (the Ká-Hó ash landfill, the airport station).
export interface WasteFacility {
  id: string
  kind: 'hazardous' | 'landfill' | 'wwtp'
  name: WasteText
  coordinates: [number, number] // [lng, lat]
  approximate: boolean
  polygon: [number, number][] | null
  buildings?: WasteBuilding[]
  osm?: string[]
  operator?: string // 'dspa' — free-form, only ever rendered through i18n
  statsKey?: string | null
  note: WasteText
  source: WasteAttribution
}

// One extruded footprint of a waste facility. Deliberately the same contract as
// `PowerBuilding` (the incinerator's own footprints ARE power records), so both
// share the +2 m margin and the z14→15.5 height ramp.
export interface WasteBuilding {
  osmId: string
  name: string | null
  height: number
  minHeight: number
  kind?: string
  coordinates: [number, number][][]
}

// A DSPA 環保加Fun站 recycling centre. There is no open dataset for these, so
// the list is hand-maintained in the pipeline and the positions come from OSM
// buildings — `approximate` marks the ones placed on the block rather than the
// unit.
export interface WasteEcoStation {
  id: string
  name: WasteText
  address: WasteText
  coordinates: [number, number] // [lng, lat]
  approximate: boolean
  hours: WasteText
  accepts: WasteText
  since: number // year the station opened
  source: WasteAttribution
}

// ---- DSPA monthly statistics (public/data/dspa-stats.json) ----------------
// One published figure per month, per plant. Every series shares the period and
// differs only in which measures it carries, so the readers below take a picker
// rather than a fixed field name.
export interface DspaStatsMonth {
  period: string // "YYYY-MM"
  receivedT?: number
  processedT?: number
  electricityMwh?: number
  metalRecycledT?: number
  volumeM3?: number
  basicM3?: number
  biologicalM3?: number
  totalM3?: number
}

// What a chart's numbers are counted in, spelled the way the file spells it.
// Drives the axis step and the unit suffix on every tooltip and chip.
export type DspaStatsUnit = 't' | 'm3'

export interface DspaSeries {
  // Null for a series DSPA publishes only on its own GIS pages.
  datasetId: string | null
  url: string
  unit: DspaStatsUnit
  latest: DspaStatsMonth | null
  months: DspaStatsMonth[] // last 12, ascending
  // Only the incinerator series carries this: the plant's hand-typed scale,
  // which is a fact about the plant rather than a monthly measure.
  facts?: DspaIncineratorFacts | null
}

// The incineration plant's hand-typed scale, moved here out of waste.json.
export interface DspaIncineratorFacts {
  phases: number[]
  lines: number
  capacityTPerDay: number
  generationMw: number
  areaM2: number
}

// Every series is best-effort upstream: a failed endpoint leaves its key null
// and the panel simply shows no chart.
export interface DspaStats {
  fetchedAtUtc?: string
  incinerator: DspaSeries | null
  hazardous: DspaSeries | null
  landfill: DspaSeries | null
  wwtp: {
    macau: DspaSeries | null
    taipa: DspaSeries | null
    coloane: DspaSeries | null
    crossborder: DspaSeries | null
    mia: DspaSeries | null
  } | null
}

// One upstream dataset behind the overlay, for the panel's provenance line and
// its "as of" stamp. Eight of them: the three IAM sets, the four DSPA ones, and
// the 電池 twin of the 光管 list, which shares the `lamp_battery` type.
export interface WasteSource {
  id: string
  type: WasteSiteType
  datasetId: string
  name: { zh: string; pt?: string; en?: string }
  url: string
  upstreamUpdatedAt: string | null
  count: number
}

// Trilingual free text for a Macao Water facility. The zh + en forms come from
// Macao Water's own 供水設施 list; `pt` is only filled where OSM tags the
// feature with `name:pt`, so it is often "" (see `pickWaterText`).
export interface WaterText {
  zh: string
  pt: string
  en: string
}

// What kind of supply facility this is, and therefore the colour it is drawn
// in. `raw_pumping` moves untreated water (reservoir → plant), `pumping` moves
// treated water into the network; `tank` is an elevated storage tank.
export type WaterFacilityType = 'plant' | 'reservoir' | 'tank' | 'raw_pumping' | 'pumping'

// One building footprint of a water facility, from
// public/data/water-facilities.json. Deliberately the same contract as
// `SchoolBuilding` (`height` is the basemap's render_height, `minHeight` the
// render_min_height) so both overlays can share the +2 m margin and the z14→15.5
// height ramp. `kind` records where the footprint came from — an OSM
// `building` polygon, a recut basemap tile part, or the facility `outline`
// itself when the basemap has no part there.
export interface WaterBuilding {
  osmId: string
  name: string | null
  height: number
  minHeight: number
  kind?: string // 'building' | 'tile' | 'outline' — not read by the runtime
  coordinates: [number, number][][]
}

// One reservoir surface ring. No height: MapView draws these flat and
// translucent, because a reservoir is a water body rather than a structure.
export interface WaterSurface {
  osmId: string
  coordinates: [number, number][][]
}

// One Macao Water supply facility (22 in total, numbered 1–22 by the operator).
// `coordinates` is the marker position [lng, lat]. When `approximate` is true
// Macao Water lists the facility but OSM has no footprint for it, so the marker
// sits at the facility named by `anchor` (or a `district:<slug>` point) instead
// of a surveyed position — the info panel says so.
// Who owns and runs a facility. Almost everything on the map is Macao Water's;
// `dsama` is 海事及水務局 (the government Marine and Water Bureau), which holds
// raw-water reservoirs the concessionaire does not. The distinction is a fact
// the panel must state, not a styling hint. Absent in files written before the
// field existed — read it through `waterOperator`, never directly.
export type WaterOperator = 'macao_water' | 'dsama'

export interface WaterFacility {
  id: string
  // Macao Water's own facility number, 1–22 — null for a facility that is not
  // on its list (a government reservoir), whose panel then shows no number.
  no: number | null
  type: WaterFacilityType
  operator?: WaterOperator
  name: WaterText
  coordinates: [number, number] // [lng, lat]
  approximate: boolean
  anchor: string | null // facility id, "district:<slug>", or null when exact
  osm: string[] // the OSM features this facility was matched to
  buildings: WaterBuilding[] // may be empty (reservoirs, approximate records)
  water: WaterSurface[] // non-empty only for the three reservoirs
}

// What a pipe carries. `raw` is untreated water on its way from a reservoir or
// the Zhuhai inlet to a treatment plant; `treated` is drinking water leaving a
// plant for the tanks and pumping stations.
export type WaterPipeKind = 'raw' | 'treated'

// An extra node of the schematic network that is NOT one of the 22 facilities:
// the points where raw water from Zhuhai enters Macau (the Ilha Verde border
// canal, and the Lotus Bridge end for the 4th pipeline from Hengqin). `kind` is
// free text ('inlet') rather than an enum so the pipeline can add a node type
// without breaking the runtime.
export interface WaterNetworkNode {
  id: string
  kind: string
  name: WaterText
  coordinates: [number, number] // [lng, lat]
  // The marker stands for a crossing whose real position is not published —
  // a schematic point, not a survey — and the panel says so. Absent = exact.
  approximate?: boolean
  // What the pipeline knows about that position, for the panel to show.
  note?: WaterText
}

// One edge of the network. `from`/`to` are facility ids or a node id;
// `coordinates` is the OSRM driving route between the two markers, so the pipe
// follows real streets. `fallback` marks the ones OSRM could not route — those
// are a straight line between the endpoints and are drawn grey to say so.
export interface WaterPipe {
  id: string
  from: string
  to: string
  kind: WaterPipeKind
  lengthM: number
  fallback: boolean
  // A deliberate short straight connector between co-located facilities (two
  // points, no road to follow) rather than a routing failure — so it is drawn
  // exactly like any other pipe of its `kind`, unlike a `fallback`.
  direct?: boolean
  coordinates: [number, number][]
}

// OUR schematic supply network, not Macao Water's real mains: an explicit edge
// list we drew between the published facilities, with road geometry from OSRM.
// Every surface that shows it says so (see `waterNetworkNote` in i18n).
export interface WaterNetwork {
  nodes: WaterNetworkNode[]
  pipes: WaterPipe[]
}

// One road of the schematic DISTRIBUTION network: Macau's own streets, from
// water-distribution.json, drawn as thin pipes under the trunk mains. Our own
// OSM extract rather than the basemap's `transportation` layer, because the
// basemap's roads cannot be clipped to Macau — and a pipe network that runs
// into Zhuhai would be saying something false.
export interface WaterDistributionRoad {
  class: string // OSM highway class: motorway … service
  // Metres along the network from the nearest treated-water source, at the
  // first and last vertex. Null where the outward walk never reached the road.
  dist?: number | null
  distEnd?: number | null
  // ORIENTED: the pipeline emits each road running AWAY from the treated-water
  // source that feeds it, so vertex order carries the direction of supply — the
  // same contract as WaterPipe, and what lets the flow layer animate outward.
  coordinates: [number, number][]
}

// water-distribution.json. Loaded lazily, the first time the WATER layer goes
// on, rather than at startup: it is ~0.5 MB and most visits never ask for it.
export interface WaterDistributionFile {
  fetchedAtUtc?: string
  sources?: Record<string, string> | unknown[]
  classes?: string[]
  // Bookkeeping from the outward orientation pass — provenance, never read by
  // the map: the facilities the walk started from, the roads it never reached,
  // and the count of roads split at a junction.
  flowSources?: string[]
  unreached?: number
  splits?: number
  roads: WaterDistributionRoad[]
}

// Trilingual free text for an electricity facility. `zh` comes from CEM's own
// station list; `en`/`pt` are only filled where OSM tags `name:en` / `name:pt`,
// so either can be "" (see `pickPowerText`).
export interface PowerText {
  zh: string
  pt: string
  en: string
}

// What kind of electricity facility this is, and therefore the colour it is
// drawn in. `plant` is 路環發電廠 (CEM's own generation), `incinerator` the
// government waste-to-energy plant that sells into the grid, and the three
// `subNNN` values are CEM's HV substation tiers, named for the HIGHEST voltage
// the station carries.
export type PowerFacilityType = 'plant' | 'incinerator' | 'sub220' | 'sub110' | 'sub66'

// The three transmission voltages CEM operates. A separate type from a bare
// number so the colour and width tables are exhaustive by construction.
export type PowerVoltage = 220 | 110 | 66

// Who owns and runs a facility. Almost everything on the map is CEM's; `dspa`
// is 澳門垃圾焚化中心, the government incineration centre, which sells its output
// to CEM but is not a CEM asset. The distinction is a fact the panel must
// state, not a styling hint — read it through `powerOperator`, never directly.
export type PowerOperator = 'cem' | 'dspa'

// One building footprint of an electricity facility. Deliberately the same
// contract as `WaterBuilding` / `SchoolBuilding` (`height` is the basemap's
// render_height, `minHeight` the render_min_height) so all three overlays share
// the +2 m margin and the z14→15.5 height ramp.
export interface PowerBuilding {
  osmId: string
  name: string | null
  height: number
  minHeight: number
  kind?: string // 'building' | 'tile' | 'outline' — not read by the runtime
  coordinates: [number, number][][]
}

// The extra facts the info panel shows where the pipeline has them. The Coloane
// plant carries the full trilingual unit prose (it is prose, not a table) plus
// its installed capacity; a 220 kV import station carries only the year it was
// commissioned. Every field is optional for that reason, and the panel renders
// each row only when its field is present.
export interface PowerPlantDetails {
  unitsZh?: string
  unitsEn?: string
  unitsPt?: string
  // A language-neutral unit string (澳北's "A + B"), used when the trilingual
  // prose above is absent.
  units?: string
  capacityMw?: number
  commissioned?: number
}

// One electricity facility. `coordinates` is the marker position [lng, lat].
// When `approximate` is true CEM lists the station but OSM has no feature for
// it, so the marker sits at the facility named by `anchor` (or a
// `district:<slug>` point) instead of a surveyed position — the panel says so.
export interface PowerFacility {
  id: string
  type: PowerFacilityType
  operator?: PowerOperator
  name: PowerText
  // Highest voltage the station carries; null for the plant and the
  // incinerator, which are generation rather than transmission.
  voltageKv: number | null
  coordinates: [number, number] // [lng, lat]
  approximate: boolean
  anchor: string | null // facility id, "district:<slug>", or null when exact
  osm: string[] // the OSM features this facility was matched to
  buildings: PowerBuilding[] // may be empty (marker-only stations)
  // Generation facts. Present only for the Coloane plant.
  details?: PowerPlantDetails | null
  // Free-text provenance for a station that is in OSM but not on CEM's list.
  note?: string | null
}

// An extra node of the schematic network that is NOT a facility: the points on
// the Macau side of the border where the Guangdong grid lands. `kind` is free
// text ('inlet') rather than an enum so the pipeline can add a node type
// without breaking the runtime.
export interface PowerNetworkNode {
  id: string
  kind: string
  name: PowerText
  coordinates: [number, number] // [lng, lat]
  // The landing point is the pipeline's estimate from the published route,
  // not a published location — the panel says so.
  approximate?: boolean
}

// One edge of the network. `from`/`to` are facility ids or a node id;
// `coordinates` is the OSRM driving route between the two markers, so the line
// follows real streets. `fallback` marks the ones OSRM could not route — those
// are a straight line between the endpoints and are drawn grey to say so.
export interface PowerLine {
  id: string
  from: string
  to: string
  voltageKv: number
  lengthM: number
  fallback: boolean
  // A deliberate short straight connector between co-located stations rather
  // than a routing failure — so it is drawn exactly like any other line of its
  // voltage, unlike a `fallback`.
  direct?: boolean
  coordinates: [number, number][]
}

// OUR schematic HV network, not CEM's real cable routes: an explicit edge list
// between the published stations, with road geometry from OSRM. CEM's 1,088 km
// of HV cable is almost all underground and in no public dataset, so this can
// only ever be a diagram — every surface that shows it says so (see
// `powerNetworkNote` in i18n).
export interface PowerNetwork {
  nodes: PowerNetworkNode[]
  lines: PowerLine[]
}

// One road of the schematic DISTRIBUTION network: Macau's own streets, from
// power-distribution.json, drawn as thin feeders under the HV corridors. Same
// contract and same reasoning as WaterDistributionRoad, oriented outward from
// the substations rather than from the water plants.
export interface PowerDistributionRoad {
  class: string // OSM highway class: motorway … service
  // Metres along the network from the nearest substation, at the first and last
  // vertex. Null where the outward walk never reached the road.
  dist?: number | null
  distEnd?: number | null
  // ORIENTED: the pipeline emits each road running AWAY from the substation
  // that feeds it, so vertex order carries the direction of supply — the same
  // contract as PowerLine, and what lets the flow layer animate outward.
  coordinates: [number, number][]
}

// power-distribution.json. Loaded lazily, the first time the POWER layer goes
// on, rather than at startup: it is ~0.5 MB and most visits never ask for it.
export interface PowerDistributionFile {
  fetchedAtUtc?: string
  sources?: Record<string, string> | unknown[]
  classes?: string[]
  // Bookkeeping from the outward orientation pass — provenance, never read by
  // the map: the substations the walk started from, the roads it never reached,
  // and the count of roads split at a junction.
  flowSources?: string[]
  unreached?: number
  splits?: number
  roads: PowerDistributionRoad[]
}

// ---- Macau Grand Prix circuit (grand-prix.json) ----------------------------

export interface GrandPrixText {
  zh: string
  pt: string
  en: string
}

// What a corner entry is: the start/finish line, a point corner, or a named
// SECTION of track (Solitude Esses, Reservoir) that spans a stretch rather
// than a single apex.
export type GrandPrixCornerKind = 'start_finish' | 'bend' | 'section'

// One officially named point of the circuit, in race order. The NAMES are the
// Grand Prix Committee's own, in all three languages; the POSITION is ours —
// the committee publishes no coordinates, so `rule` records how the point was
// derived from the track geometry and `approximate` is always true.
export interface GrandPrixCorner {
  id: string
  order: number // 1 = start/finish, then race order
  kind: GrandPrixCornerKind
  name: GrandPrixText
  lng: number
  lat: number
  distKm: number // along the lap from start/finish
  approximate: boolean
  rule: string
  // For a section: its extent along the lap [fromKm, toKm]; null for a point.
  spanKm: [number, number] | null
}

// The lap record the car on the map runs at. A SECONDARY source (Wikipedia),
// which the panel and the legend say.
export interface GrandPrixLapRecord {
  time: string // as printed, e.g. "2:06.257"
  seconds: number
  driver: string
  year: number
  car: string | null
  source: string
}

export interface GrandPrixSource {
  name: string
  url: string
  role: string // geometry | names | facts | lapRecord | landmarks
  secondary?: boolean
  upstreamUpdatedAt?: string | null
}

export interface GrandPrixCircuit {
  id: string
  name: GrandPrixText
  lengthKm: number // the official figure
  minWidthM: number
  direction: string // 'clockwise'
  lapRecord: GrandPrixLapRecord | null
  osm: { relationId: number; mainWays: number; pitLaneWays: number }
  measuredLengthKm: number // the stitched OSM loop, for the cross-check
  // Closed (first point == last point), starting at start/finish, in race
  // direction — the order the arrows, the pulse and the car all follow.
  track: { type: 'LineString'; coordinates: [number, number][] }
  pitLane: { type: 'LineString'; coordinates: [number, number][] } | null
  corners: GrandPrixCorner[]
}

export interface GrandPrixFile {
  fetchedAtUtc: string
  sources: GrandPrixSource[]
  circuit: GrandPrixCircuit
}

export interface TransitData {
  lrtLines: LRTLine[]
  stations: Station[]
  trips: Trip[]
  busRoutes: BusRoute[]
  busStops: BusStop[]
  flights: Flight[]
  ferries: Ferry[]
  roadWorks: RoadWorkNotice[]
  schools: School[]
  toilets: Toilet[]
  carParks: CarPark[]
  // Refuse rooms, compacting bins and the four recycling-point kinds. The
  // per-type toggles narrow this array in App, exactly like the schools.
  waste: WasteSite[]
  // Provenance for the waste overlay — never filtered, because the info panel
  // has to name the dataset a site came from even when its type is hidden.
  wasteSources: WasteSource[]
  // The three blocks that are not collection points: the treatment facilities
  // (hazardous station + two landfills), the ten 環保加Fun站, and the
  // incineration plant's monthly throughput. All optional upstream, so they are
  // empty/null until (and unless) waste.json carries them.
  wasteFacilities: WasteFacility[]
  wasteEcoStations: WasteEcoStation[]
  // DSPA's monthly throughput for the incinerator, the hazardous-waste station,
  // the construction-waste landfill and the sewage works. Null until
  // dspa-stats.json lands (or if it ever fails to load).
  dspaStats: DspaStats | null
  waterFacilities: WaterFacility[]
  // The schematic pipe network, or null when water-facilities.json predates it
  // (the `network` block is optional) or the WATER layer is off.
  waterNetwork: WaterNetwork | null
  powerFacilities: PowerFacility[]
  // The schematic HV network, or null when power-facilities.json has no
  // `network` block or the POWER layer is off.
  powerNetwork: PowerNetwork | null
  // The Guia Circuit, or null until grand-prix.json lands or while the GRAND
  // PRIX layer is off (App nulls it the way it nulls powerNetwork).
  grandPrix: GrandPrixCircuit | null
  // Provenance for the circuit panel: OSM for the line, the Grand Prix
  // Committee for the names, Wikipedia for the lap record. Never filtered.
  grandPrixSources: GrandPrixSource[]
  loading: boolean
}

export interface VehiclePosition {
  id: string
  lineId: string
  type: 'lrt' | 'bus' | 'flight' | 'ferry'
  coordinates: [number, number]
  bearing: number
  progress: number
  color: string
  altitude?: number
  scale?: number
  flightPhase?: 'apron' | 'taxi' | 'climb'
  flightData?: Flight
  ferryData?: Ferry
}

export interface SimulationClock {
  // The sim time for per-frame consumers (the engine, the animations): fresh
  // every RAF, never a render trigger.
  timeRef: React.RefObject<Date>
  // The sim time for RENDERING, as an external store: the tick notifies at
  // ~10 Hz and only subscribers re-render. Read it through `useClockTime`
  // (every tick — the clock face, the scrubber) or `useClockMinute` (once per
  // simulated minute — everything that decides by the time). There is
  // deliberately no `currentTime` state: that made the App that owns the
  // clock, and its whole tree, re-render ten times a second.
  subscribeTime: (listener: () => void) => () => void
  getTimeMs: () => number
  speed: number
  paused: boolean
  // True when the sim is locked to real wall time (not paused, 1× speed, and
  // within 3 s of now). Computed in the clock tick so consumers don't each
  // call Date.now() during render. Drives the "LIVE" badges.
  isLive: boolean
  setSpeed: (s: number) => void
  togglePause: () => void
  // Re-lock the sim to wall time: sim = Date.now(), speed = 1, not paused.
  // This is what "live" means — use it whenever the user asks to return to
  // the current moment, not for clearing state.
  syncToNow: () => void
  setTime: (date: Date) => void
}

export interface StationProgress {
  stationId: string
  progress: number // 0-1 along the line geometry
}
