// Berth data for the two Macau ferry terminals served by our ferries:
//
//   outer_harbour — 澳門外港客運碼頭 (TurboJET's Macau base)
//   taipa         — 澳門氹仔客運碼頭 (Cotai Water Jet's Macau base)
//
// Each berth has a moor point (where the ship sits) and a bow-target point
// indicating where the bow should face — both provided by the user. Coords
// are stored in [lon, lat] order; bearings are computed from each
// moor → bow-target pair (0°=north, clockwise).

const M_PER_DEG = 111320

function bearingFromTo(
  from: [number, number], // [lon, lat]
  to: [number, number],
): number {
  const [lon1, lat1] = from
  const [lon2, lat2] = to
  const cosLat = Math.cos((lat1 * Math.PI) / 180)
  const dx = (lon2 - lon1) * M_PER_DEG * cosLat
  const dy = (lat2 - lat1) * M_PER_DEG
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI
  return (deg + 360) % 360
}

// Raw [moor(lon,lat), bowTarget(lon,lat)] pairs for Outer Harbour.
const OUTER_HARBOUR_RAW: Array<[[number, number], [number, number]]> = [
  [[113.56102756378452, 22.197860358670177], [113.56043792686009, 22.19816744723325]],
  [[113.56095385917249, 22.197679517317095], [113.56039738932348, 22.197955897410704]],
  [[113.56083224656264, 22.197437257781004], [113.56029788809724, 22.197679517323607]],
  [[113.56064798503255, 22.19728712490097],  [113.56020944256281, 22.197522560488736]],
  [[113.56055953949812, 22.19711310704372],  [113.56010625610595, 22.197331482366014]],
  [[113.56020207212974, 22.196522809568485], [113.5597745853518,  22.19672753730413]],
  [[113.56008782998109, 22.196331730085337], [113.55967876935615, 22.196546694492117]],
  [[113.55996990260184, 22.19613041392004],  [113.5595497862851,  22.19633173009185]],
  [[113.55988145706738, 22.19592568532035],  [113.55946134075064, 22.19612017750366]],
]

// Raw [moor(lon,lat), bowTarget(lon,lat)] pairs for Taipa Temporary Terminal.
const TAIPA_RAW: Array<[[number, number], [number, number]]> = [
  [[113.57594408743236, 22.165759711825764], [113.57638568971933, 22.16536498558299]],
  [[113.57613877926902, 22.165948588203353], [113.57644096817837, 22.16564484211251]],
  [[113.57612035311601, 22.166388848226656], [113.57662891493905, 22.165880330711992]],
  [[113.57628618849309, 22.16656631699359],  [113.57663997063085, 22.16623868217204]],
  [[113.5762972441849,  22.16700316223498],  [113.57665471155326, 22.166665289862472]],
  [[113.57648519094558, 22.167224997189614], [113.57686476969755, 22.16683251972406]],
  [[113.57465363133653, 22.16563119058741],  [113.57450990734306, 22.165040760858588]],
  [[113.57416349566651, 22.165713099718154], [113.57403082736485, 22.16525236023714]],
]

export type MacauFerryTerminal = 'outer_harbour' | 'taipa'

export interface FerryBerth {
  coord: [number, number]   // [lon, lat]
  bearing: number           // degrees, 0=N, clockwise
}

function buildBerths(raw: Array<[[number, number], [number, number]]>): FerryBerth[] {
  return raw.map(([coord, tgt]) => ({ coord, bearing: bearingFromTo(coord, tgt) }))
}

export const OUTER_HARBOUR_BERTHS: FerryBerth[] = buildBerths(OUTER_HARBOUR_RAW)
export const TAIPA_BERTHS: FerryBerth[] = buildBerths(TAIPA_RAW)

export const FERRY_BERTHS_BY_TERMINAL: Record<MacauFerryTerminal, FerryBerth[]> = {
  outer_harbour: OUTER_HARBOUR_BERTHS,
  taipa: TAIPA_BERTHS,
}

export const FERRY_BERTH_COUNT_BY_TERMINAL: Record<MacauFerryTerminal, number> = {
  outer_harbour: OUTER_HARBOUR_BERTHS.length,
  taipa: TAIPA_BERTHS.length,
}

// Per-operator dot/hull color.
export type FerryOperator = 'turbojet' | 'cotai'
export const FERRY_COLOR_BY_OPERATOR: Record<FerryOperator, string> = {
  turbojet: '#ef4444', // tailwind red-500
  cotai:    '#3b82f6', // tailwind blue-500
}
