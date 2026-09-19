// Stylised high-speed catamaran in metres: +Y bow, +X starboard, +Z up.
// Retains the previous 50 m map silhouette; operator colour is per instance.
// Shared position / normal / RGB / livery-weight layout used by the aircraft.
type Point = [number, number, number]
type Material = [number, number, number, number]
type Section = [y: number, halfWidth: number, bottom: number, top: number]
export const FERRY_VERTEX_FLOATS = 10
const LIVERY: Material = [1, 1, 1, 1]
const WHITE: Material = [.94, .965, .96, 0]
const DECK: Material = [.68, .75, .77, 0]
const HULL: Material = [.055, .085, .11, 0]
const GLASS: Material = [.065, .17, .22, 0]
const REFLECTION: Material = [.27, .43, .49, 0]
const METAL: Material = [.46, .57, .61, 0]
const VENT: Material = [.12, .17, .19, 0]

export function createFerryMesh(): Float32Array {
  const vertices: number[] = []
  const tri = (a: Point, b: Point, c: Point, material: Material) => {
    const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i])
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const length = Math.hypot(...n)
    for (const p of [a, b, c]) vertices.push(...p, ...n.map(x => x / length), ...material)
  }
  const quad = (a: Point, b: Point, c: Point, d: Point, m: Material) => { tri(a, b, c, m); tri(a, c, d, m) }
  const face = (points: Point[], m: Material) => {
    for (let i = 1; i < points.length - 1; i++) tri(points[0], points[i], points[i + 1], m)
  }
  const connect = (a: Point[], b: Point[], m: Material) => {
    for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; quad(a[i], a[j], b[j], b[i], m) }
  }
  const box = (x1: number, x2: number, y1: number, y2: number, z1: number, z2: number, m: Material) => {
    const a: Point[] = [[x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1]]
    const b = a.map(([x, y]): Point => [x, y, z2])
    connect(a, b, m); face(a, m); face(b, m)
  }
  const cylinder = (x: number, y: number, z: number, radius: number, length: number, m: Material, axis: 'y' | 'z' = 'z') => {
    const ring = (offset: number): Point[] => Array.from({ length: 12 }, (_, i) => {
      const a = i * Math.PI / 6
      return axis === 'z' ? [x + radius * Math.cos(a), y + radius * Math.sin(a), z + offset] :
        [x + radius * Math.cos(a), y + offset, z + radius * Math.sin(a)]
    })
    const a = ring(0), b = ring(length)
    connect(a, b, m); face(a, m); face(b, m)
  }
  // Two slender, flared hulls with separate knife bows and a true centre tunnel.
  for (const side of [-1, 1]) {
    const sections: [number, number, number][] = [[-24, 1.6, 2.6], [-20, 1.9, 3.1], [9, 1.9, 3.1], [18, 1.2, 2.9], [25, .055, 2.4]]
    const rings = sections.map(([y, width, top]): Point[] => [
      [side * 5.1 - width * .65, y, .08], [side * 5.1 + width * .65, y, .08],
      [side * 5.1 + width, y, top], [side * 5.1 - width, y, top],
    ])
    for (let i = 0; i < rings.length - 1; i++) connect(rings[i], rings[i + 1], HULL)
    face(rings[0], HULL); face(rings.at(-1)!, HULL)
    for (let i = 0; i < sections.length - 1; i++) {
      const [y1, w1, z1] = sections[i], [y2, w2, z2] = sections[i + 1]
      quad([side * 5.1 - w1, y1, z1 + .015], [side * 5.1 + w1, y1, z1 + .015],
        [side * 5.1 + w2, y2, z2 + .015], [side * 5.1 - w2, y2, z2 + .015], LIVERY)
    }
    cylinder(side * 5.1, -24.75, 1.15, .64, 1.0, METAL, 'y')
    cylinder(side * 5.1, -24.77, 1.15, .46, .08, HULL, 'y')
  }
  // Continuous raked cabin surfaces, including chamfered roof shoulders.
  const cabin = (sections: Section[], roof: Material) => {
    const rings = sections.map(([y, w, bottom, top]): Point[] => [
      [-w, y, bottom], [w, y, bottom], [w, y, top - .5], [w - .4, y, top],
      [-w + .4, y, top], [-w, y, top - .5],
    ])
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6
      quad(rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i], i >= 2 && i <= 4 ? roof : LIVERY)
    }
    face(rings[0], LIVERY); face(rings.at(-1)!, LIVERY)
    // Panes interpolate along each tapered wall so none sink into the cabin.
    for (const side of [-1, 1]) for (let k = 0; k < sections.length - 1; k++) {
      const a = sections[k], b = sections[k + 1], count = Math.max(1, Math.round((b[0] - a[0]) / 2.8))
      const point = (t: number, h: number, offset = .026): Point => {
        const w = a[1] + (b[1] - a[1]) * t, bottom = a[2] + (b[2] - a[2]) * t
        const top = a[3] + (b[3] - a[3]) * t
        return [side * (w + offset), a[0] + (b[0] - a[0]) * t, bottom + (top - bottom - .5) * h]
      }
      for (let j = 0; j < count; j++) {
        const start = (j + .09) / count, end = (j + .91) / count
        quad(point(start, .4), point(end, .4), point(end, .91), point(start, .91), GLASS)
        quad(point(start + .02 / count, .8, .03), point(end - .02 / count, .8, .03),
          point(end - .02 / count, .87, .03), point(start + .02 / count, .87, .03), REFLECTION)
      }
      quad(point(0, .18), point(1, .18), point(1, .28), point(0, .28), WHITE)
    }
  }
  box(-6.6, 6.6, -23.6, -18, 2.55, 3.2, DECK)
  cabin([[-21, 6.0, 3.0, 6.7], [-18, 6.6, 3.0, 7.4], [8, 6.6, 3.0, 7.4], [15, 5.3, 3.1, 6.9], [20, 2.8, 3.3, 4.9]], WHITE)
  cabin([[-15, 4.2, 7.4, 9.65], [-12, 4.7, 7.4, 9.65], [5.5, 4.7, 7.4, 9.65]], LIVERY)
  // Raised bridge with a raked wraparound windscreen and overhanging visor.
  const bridgeLower: Point[] = [[-4.7, 5.5, 7.4], [4.7, 5.5, 7.4], [4.4, 10, 7.4], [2.7, 14, 7.4], [-2.7, 14, 7.4], [-4.4, 10, 7.4]]
  const bridgeUpper: Point[] = [[-4.7, 5.5, 10.15], [4.7, 5.5, 10.15], [4.0, 9.6, 10.15], [2.5, 12.1, 10.15], [-2.5, 12.1, 10.15], [-4.0, 9.6, 10.15]]
  connect(bridgeLower, bridgeUpper, LIVERY)
  const interpolate = (a: Point, b: Point, t: number): Point => a.map((n, i) => n + (b[i] - n) * t) as Point
  for (let i = 1; i < 6; i++) {
    const j = (i + 1) % 6, panes = i === 3 ? 3 : 2
    const point = (u: number, v: number): Point => {
      const p = interpolate(interpolate(bridgeLower[i], bridgeLower[j], u), interpolate(bridgeUpper[i], bridgeUpper[j], u), v)
      return [p[0] + Math.sign(p[0]) * .035, p[1] + .035, p[2]]
    }
    for (let pane = 0; pane < panes; pane++) {
      const a = (pane + .06) / panes, b = (pane + .94) / panes
      quad(point(a, .38), point(b, .38), point(b, .87), point(a, .87), GLASS)
    }
  }
  const roof = bridgeUpper.map(([x, y, z]): Point => [x * 1.035, y + (y > 9 ? .28 : 0), z + .15])
  const roofTop = roof.map(([x, y, z]): Point => [x, y, z + .22])
  connect(roof, roofTop, LIVERY); face(roofTop, LIVERY)
  // Forward main-deck windshield follows the sloping foredeck.
  for (const side of [-1, 1]) quad([side * .15, 17, 6.18], [side * 3.9, 17, 6.18],
    [side * 2.6, 19.4, 5.22], [side * .15, 19.4, 5.22], GLASS)
  for (const side of [-1, 1]) {
    // Rear boarding platform, railings and doors.
    box(side < 0 ? -6.35 : 6.23, side < 0 ? -6.23 : 6.35, -23.2, -21.2, 4.12, 4.24, WHITE)
    for (const y of [-23.1, -22.2, -21.3]) box(side * 6.29 - .05, side * 6.29 + .05, y - .05, y + .05, 3.2, 4.2, WHITE)
    box(side * 4.7 - .5, side * 4.7 + .5, -21.04, -21.02, 3.35, 5.85, GLASS)
    for (const y of [-10.5, -6.8]) {
      box(side * 5.55 - .55, side * 5.55 + .55, y - 1, y + 1, 7.41, 7.7, METAL)
      cylinder(side * 5.55, y - .9, 8.03, .48, 1.8, WHITE, 'y')
      cylinder(side * 5.55, y - .08, 8.03, .49, .16, DECK, 'y')
    }
    // Swept exhaust housings, with dark outlets and fine grille blades.
    const lower: Point[] = [[side * 2.8 - .7, -12.8, 9.65], [side * 2.8 + .7, -12.8, 9.65], [side * 2.8 + .7, -9.8, 9.65], [side * 2.8 - .7, -9.8, 9.65]]
    const upper = lower.map(([x, y]): Point => [x * .96, y - .8, 11.45])
    connect(lower, upper, LIVERY); face(upper, VENT)
    for (let j = 0; j < 5; j++) box(side * 2.8 - .53, side * 2.8 + .53, -13.4 + j * .47, -13.29 + j * .47, 11.46, 11.51, METAL)
  }
  box(-6.3, 6.3, -23.25, -23.13, 4.12, 4.24, WHITE)
  for (const x of [-6.25, -3, 0, 3, 6.25]) box(x - .05, x + .05, -23.23, -23.13, 3.2, 4.18, WHITE)
  // Roof equipment and a compact radar mast, legible in the map's top view.
  box(-1.55, 1.55, -7.8, -3.5, 9.65, 10.1, DECK)
  for (let j = 0; j < 8; j++) box(-1.3, 1.3, -7.6 + j * .5, -7.42 + j * .5, 10.11, 10.14, VENT)
  cylinder(0, 2, 9.65, .22, 4.1, WHITE)
  box(-2.3, 2.3, 1.85, 2.15, 12.85, 13.08, WHITE)
  cylinder(0, 2, 13.72, .48, .38, WHITE)
  cylinder(1.7, 4, 9.65, .55, .7, WHITE)
  cylinder(-1.7, 4, 9.65, .1, 2.8, METAL)
  // Tiny navigation lights use the renderer's unlit material channel.
  box(-4.78, -4.62, 6.7, 7.2, 9.67, 9.92, [.95, .08, .07, -1])
  box(4.62, 4.78, 6.7, 7.2, 9.67, 9.92, [.1, .85, .48, -1])
  return new Float32Array(vertices)
}
