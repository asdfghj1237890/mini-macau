// Outbound sailing paths from the Macau Outer Harbour Terminal.
// Stored as [lon, lat]. The path starts at the first waypoint just off the
// berth and continues out to open water toward the destination port.
// Ferries on a route with a defined path animate along it during the journey;
// routes without a path stay at the berth for the duration of their dwell window.

export interface FerryRoute {
  id: string
  waypoints: [number, number][]
}

export const FERRY_ROUTES: Record<string, FerryRoute> = {
  // 澳門 → 深圳機場 route exits the Outer Harbour heading SE, then
  // swings ENE out into the Pearl River estuary.
  shenzhenmacauroute: {
    id: 'shenzhenmacauroute',
    waypoints: [
      [113.56234596654556, 22.196359006624228],
      [113.56366452749393, 22.191692682150283],
      [113.56675565066354, 22.188716333573314],
      [113.56831916167833, 22.188339924527632],
      [113.57147745386455, 22.189440194312265],
      [113.57219666907937, 22.19029434517906],
      [113.57532369108254, 22.192195656705803],
      [113.61036422849715, 22.212274923472922],
    ],
  },
  // 澳門 → 蛇口 route exits the Outer Harbour heading S/SSE, hugs the
  // coast, then swings ENE out to the Shekou side of the Pearl River.
  maczykroute: {
    id: 'maczykroute',
    waypoints: [
      [113.5617478776807, 22.196013387421324],
      [113.56278910723695, 22.19103226470818],
      [113.56596857580567, 22.188444077084622],
      [113.56785890336604, 22.187502906087005],
      [113.57180689853662, 22.18862771942554],
      [113.58083402259292, 22.191580966155414],
      [113.62742699262688, 22.216148950552256],
    ],
  },
  // 澳門 → 香港(上環) route exits the Outer Harbour heading S/SSE, passes
  // south of Taipa, then bends ESE across the estuary toward Sheung Wan.
  hkgmacroute: {
    id: 'hkgmacroute',
    waypoints: [
      [113.56112987426809, 22.193483924808383],
      [113.56176095467299, 22.190310674753427],
      [113.56393467598132, 22.188857935324766],
      [113.57199848096207, 22.18173199028956],
      [113.57943120565082, 22.17934577301889],
      [113.5950938109249, 22.174167383993797],
      [113.61297140171106, 22.175328768249642],
    ],
  },
  // 澳門(氹仔) → 香港(上環) route exits Taipa Temporary Terminal heading
  // WSW into open water, then bends ENE across the estuary toward Sheung Wan.
  cotai_hkg_taipa: {
    id: 'cotai_hkg_taipa',
    waypoints: [
      [113.57917685453981, 22.1723704230209],
      [113.64477958629995, 22.175364389301873],
    ],
  },
  // 澳門 → 香港國際機場 route exits the Outer Harbour heading S, tracks
  // down past Taipa, then bends ESE across the estuary toward HKIA.
  clkmacroute: {
    id: 'clkmacroute',
    waypoints: [
      [113.56144458322214, 22.1956939284056],
      [113.56247341712957, 22.191389963523473],
      [113.56401047019335, 22.1900298831954],
      [113.56730149916748, 22.18720638325151],
      [113.57155318640568, 22.183028417406323],
      [113.57715386000538, 22.18055552045882],
      [113.58806066314605, 22.17590501062997],
      [113.6015998694459, 22.178255346000295],
      [113.61431136852329, 22.185910927016405],
    ],
  },
}

const M_PER_DEG = 111320

function distM(a: [number, number], b: [number, number]): number {
  const cosLat = Math.cos(((a[1] + b[1]) / 2 * Math.PI) / 180)
  const dx = (b[0] - a[0]) * M_PER_DEG * cosLat
  const dy = (b[1] - a[1]) * M_PER_DEG
  return Math.sqrt(dx * dx + dy * dy)
}

function bearingDeg(from: [number, number], to: [number, number]): number {
  const cosLat = Math.cos((from[1] * Math.PI) / 180)
  const dx = (to[0] - from[0]) * M_PER_DEG * cosLat
  const dy = (to[1] - from[1]) * M_PER_DEG
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI
  return (deg + 360) % 360
}

// Total polyline length in metres.
export function pathLengthMeters(path: [number, number][]): number {
  let total = 0
  for (let i = 0; i < path.length - 1; i++) total += distM(path[i], path[i + 1])
  return total
}

// Interpolate along a polyline by fraction 0..1 of total length.
// Returns the point and the bearing toward the next waypoint.
export function interpolatePath(
  path: [number, number][],
  fraction: number,
): { point: [number, number]; bearing: number } {
  if (path.length === 0) return { point: [0, 0], bearing: 0 }
  if (path.length === 1) return { point: path[0], bearing: 0 }
  const clamped = Math.max(0, Math.min(1, fraction))
  const segLens: number[] = []
  let total = 0
  for (let i = 0; i < path.length - 1; i++) {
    const d = distM(path[i], path[i + 1])
    segLens.push(d)
    total += d
  }
  if (total < 1e-6) return { point: path[0], bearing: bearingDeg(path[0], path[path.length - 1]) }
  const target = clamped * total
  let acc = 0
  for (let i = 0; i < segLens.length; i++) {
    const next = acc + segLens[i]
    if (target <= next || i === segLens.length - 1) {
      const segFrac = segLens[i] > 0 ? (target - acc) / segLens[i] : 0
      const a = path[i]
      const b = path[i + 1]
      return {
        point: [a[0] + (b[0] - a[0]) * segFrac, a[1] + (b[1] - a[1]) * segFrac],
        bearing: bearingDeg(a, b),
      }
    }
    acc = next
  }
  const last = path[path.length - 1]
  const prev = path[path.length - 2]
  return { point: last, bearing: bearingDeg(prev, last) }
}
