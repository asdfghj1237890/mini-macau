// Macau Outer Harbour Ferry Terminal (澳門外港客運碼頭) berth data.
// Each berth has a moor point (where the ship sits) and a bow-target point
// indicating where the bow should face — provided by the user, 2026-04.
// Coords are stored in [lon, lat] order; bearings are computed from each
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

// Raw [moor(lon,lat), bowTarget(lon,lat)] pairs.
const RAW: Array<[[number, number], [number, number]]> = [
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

export interface FerryBerth {
  coord: [number, number]   // [lon, lat]
  bearing: number           // degrees, 0=N, clockwise
}

export const FERRY_BERTHS: FerryBerth[] = RAW.map(([coord, tgt]) => ({
  coord,
  bearing: bearingFromTo(coord, tgt),
}))

export const FERRY_BERTH_COUNT = FERRY_BERTHS.length

// All TurboJet hi-speed ferries render as red dots.
export const FERRY_COLOR = '#ef4444' // tailwind red-500
