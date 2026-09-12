// Macau three-door city bus inspired by TCM's Zhongtong 11.3 m silhouette.
// Authored at 2x; BUS_MAP_SCALE restores world dimensions for road clearance.
// Livery identifies a route, not an operator.
// Every instance shares this immutable mesh; no per-bus textures or objects.
type Point = [number, number, number]
type Material = [number, number, number, number]
export const BUS_VERTEX_FLOATS = 10
export const BUS_MAP_SCALE = .5
export const BUS_HALF_LENGTH_M = 11.4
export const BUS_HALF_WIDTH_M = 3.13 // includes mirrors
export const BUS_HEIGHT_M = 7.13
const WHITE: Material = [.87, .9, .91, 0]
const ROOF: Material = [.96, .97, .97, 0]
const ROUTE: Material = [1, 1, 1, 1]
const BELT: Material = [.08, .09, .1, .22]
const BLACK: Material = [.025, .036, .041, 0]
const GLASS: Material = [.14, .23, .26, 0]
const REFLECTION: Material = [.24, .34, .36, 0]
const METAL: Material = [.5, .57, .59, 0]
const TIRE: Material = [.035, .042, .046, 0]
const HEADLIGHT: Material = [.95, .96, .82, -.5]
const TAILLIGHT: Material = [.95, .11, .075, -.5]
const AMBER: Material = [1, .57, .1, -.5]

export function createBusMesh(): Float32Array {
  const vertices: number[] = []
  const tri = (a: Point, b: Point, c: Point, material: Material) => {
    const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i])
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const length = Math.hypot(...normal)
    for (const p of [a, b, c]) vertices.push(...p, ...normal.map(n => n / length), ...material)
  }
  const quad = (a: Point, b: Point, c: Point, d: Point, m: Material) => { tri(a, b, c, m); tri(a, c, d, m) }
  const face = (points: Point[], m: Material) => {
    for (let i = 1; i < points.length - 1; i++) tri(points[0], points[i], points[i + 1], m)
  }
  const box = (x1: number, x2: number, y1: number, y2: number, z1: number, z2: number, m: Material) => {
    const p: Point[] = [[x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1]]
    const q = p.map(([x, y]): Point => [x, y, z2])
    face(p, m); face(q, m)
    for (let i = 0; i < 4; i++) quad(p[i], p[(i + 1) % 4], q[(i + 1) % 4], q[i], m)
  }
  const side = (s: number, y1: number, y2: number, z1: number, z2: number, m: Material, x = 2.515) =>
    quad([s * x, y1, z1], [s * x, y2, z1], [s * x, y2, z2], [s * x, y1, z2], m)
  const pane = (s: number, y1: number, y2: number, z1: number, z2: number, x = 2.528) => {
    // Chamfered glass with a restrained reflection, without transparency sorting.
    face([[s * x, y1 + .09, z1], [s * x, y2 - .09, z1], [s * x, y2, z1 + .09],
      [s * x, y2, z2 - .09], [s * x, y2 - .09, z2], [s * x, y1 + .09, z2],
      [s * x, y1, z2 - .09], [s * x, y1, z1 + .09]], GLASS)
    side(s, y1 + .16, y1 + .28, z1 + .15, z2 - .14, REFLECTION, x + .004)
  }
  // Soft roof shoulders, chamfered ends and a gently raked front windshield.
  const profile = [[-2.5, 2.55], [2.5, 2.55], [2.5, 6.03], [2.43, 6.27],
    [2.22, 6.46], [1.95, 6.53], [-1.95, 6.53], [-2.22, 6.46], [-2.43, 6.27], [-2.5, 6.03]]
  const rings = [-11.25, -10.94, 10.88, 11.35].map((y, i) => profile.map(([x, z]): Point =>
    [x * (i === 0 || i === 3 ? .95 : 1), y - (i === 3 ? Math.max(0, z - 3) * .085 : 0), z]))
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < profile.length; i++) {
    const n = (i + 1) % profile.length
    quad(rings[j][i], rings[j][n], rings[j + 1][n], rings[j + 1][i], i >= 2 && i <= 8 ? ROOF : WHITE)
  }
  face(rings[0], WHITE); face(rings[3], WHITE)
  box(-2.2, 2.2, -10.95, 11.1, .65, 1.13, BLACK)
  box(-1.9, 1.9, -10.9, 10.9, 1.12, 2.56, ROUTE)
  for (const s of [-1, 1]) {
    // Genuine wheel cutouts, rather than wheels hidden inside a solid body box.
    let start = -11.05
    for (const axle of [-6.15, 5.7]) {
      const radius = 1.29
      side(s, start, axle - radius, .72, 2.82, ROUTE, 2.5)
      for (let i = 0; i < 10; i++) {
        const a = Math.PI - i * Math.PI / 10, b = Math.PI - (i + 1) * Math.PI / 10
        const y1 = axle + Math.cos(a) * radius, y2 = axle + Math.cos(b) * radius
        const z1 = 1.04 + Math.sin(a) * radius, z2 = 1.04 + Math.sin(b) * radius
        quad([s * 2.5, y1, z1], [s * 2.5, y2, z2], [s * 2.5, y2, 2.82], [s * 2.5, y1, 2.82], ROUTE)
        quad([s * 2.505, y1, z1], [s * 2.505, y2, z2], [s * 2.505, y2, z2 + .09], [s * 2.505, y1, z1 + .09], BELT)
      }
      start = axle + radius
    }
    side(s, start, 11.05, .72, 2.82, ROUTE, 2.5)
    side(s, -10.99, 10.89, 2.82, 6.03, BLACK)
    side(s, -11.0, 10.9, 2.52, 2.75, BELT, 2.52)
    side(s, -11.0, 10.9, 2.75, 2.81, WHITE, 2.525)
    side(s, -10.85, 10.75, 6.08, 6.22, ROUTE, 2.46)
    const windows = s === 1 ? [[-10.65, -7.1], [-6.91, -3.35], [-3.16, .39], [.58, 4.13], [4.32, 7.56], [7.75, 10.6]] :
      [[-7.95, -3.49], [-.02, 3.5], [3.69, 7.43]]
    for (const [y1, y2] of windows) pane(s, y1, y2, 3.37, 5.79)
    for (const y of [-10.5, -.2, 9.9]) side(s, y, y + .22, 1.08, 1.19, AMBER, 2.537)
    for (const axle of [-6.15, 5.7]) {
      const cylinder = (x1: number, x2: number, radius: number, m: Material) => {
        const ring = (x: number) => Array.from({ length: 12 }, (_, i): Point => {
          const a = i * Math.PI / 6
          return [s * x, axle + Math.cos(a) * radius, 1.04 + Math.sin(a) * radius]
        })
        const a = ring(x1), b = ring(x2)
        for (let i = 0; i < 12; i++) quad(a[i], a[(i + 1) % 12], b[(i + 1) % 12], b[i], m)
        face(b, m)
      }
      cylinder(2.07, 2.545, 1.04, TIRE)
      cylinder(2.548, 2.575, .64, METAL)
      cylinder(2.577, 2.603, .31, BELT)
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3, y = axle + Math.cos(a) * .46, z = 1.04 + Math.sin(a) * .46
        face([[s * 2.606, y - .055, z - .07], [s * 2.606, y + .055, z - .07],
          [s * 2.606, y + .055, z + .07], [s * 2.606, y - .055, z + .07]], BLACK)
      }
    }
  }
  // Left-side doors for Macau's left-hand traffic.
  for (const [y1, y2] of [[-10.65, -8.2], [-3.24, -.27], [7.68, 10.68]]) {
    side(-1, y1, y2, .75, 5.94, BLACK, 2.54)
    const middle = (y1 + y2) / 2
    pane(-1, y1 + .16, middle - .075, 1.49, 5.76, 2.548)
    pane(-1, middle + .075, y2 - .16, 1.49, 5.76, 2.548)
    side(-1, y1 + .1, y2 - .1, .88, .99, METAL, 2.55)
    side(-1, middle - .022, middle + .022, 1.03, 5.8, METAL, 2.556)
    side(-1, middle + .1, middle + .17, 2.49, 2.94, AMBER, 2.56)
  }
  const front = (points: [number, number][], m: Material, offset = 0) => face(points.map(([x, z]): Point =>
    [x, 11.365 - Math.max(0, z - 3) * .085 + offset, z]), m)
  front([[-2.28, .72], [2.28, .72], [2.35, 2.85], [-2.35, 2.85]], ROUTE)
  front([[-2.16, 2.88], [2.16, 2.88], [2.19, 5.83], [1.96, 6.03], [-1.96, 6.03], [-2.19, 5.83]], BLACK)
  front([[-1.99, 3.06], [1.99, 3.06], [2.02, 5.34], [-2.02, 5.34]], GLASS, .008)
  front([[-1.87, 3.26], [-1.61, 3.34], [-.95, 5.19], [-1.55, 5.19]], REFLECTION, .011)
  front([[-2.28, 2.66], [2.28, 2.66], [2.17, 2.9], [-2.17, 2.9]], WHITE, .013)
  front([[-1.5, .98], [1.5, .98], [1.82, 2.43], [-1.82, 2.43]], BLACK, .01)
  front([[-1.55, 2.08], [1.55, 2.08], [1.62, 2.2], [-1.62, 2.2]], METAL, .02)
  front([[-.32, 2.08], [.32, 2.08], [.32, 2.31], [-.32, 2.31]], WHITE, .03)
  front([[-.35, .83], [.35, .83], [.35, 1.04], [-.35, 1.04]], BLACK, .022)
  for (const s of [-1, 1]) {
    front([[s * 1.74, 1.31], [s * 2.18, 1.48], [s * 2.25, 2.37], [s * 1.98, 2.21]], BLACK, .015)
    front([[s * 1.87, 1.68], [s * 2.11, 1.83], [s * 2.15, 2.18], [s * 2.02, 2.1]], HEADLIGHT, .024)
    front([[s * 1.89, 1.42], [s * 2.13, 1.53], [s * 2.14, 1.64], [s * 1.92, 1.56]], AMBER, .025)
    front([[s * .17, 3.08], [s * .22, 3.06], [s * 1.52, 3.65], [s * 1.49, 3.72]], BLACK, .022)
    box(Math.min(s * 2.24, s * 2.99), Math.max(s * 2.24, s * 2.99), 10.37, 10.53, 5.58, 5.72, BLACK)
    box(Math.min(s * 2.88, s * 3.12), Math.max(s * 2.88, s * 3.12), 10.28, 10.77, 4.61, 5.7, BLACK)
    side(s, 10.36, 10.68, 4.78, 5.54, METAL, 3.122)
  }
  // Neutral destination display; the actual route number stays in the map label.
  for (let i = 0; i < 14; i++) front([[i * .16 - 1.09, 5.58], [i * .16 -.98, 5.58],
    [i * .16 -.98, 5.72], [i * .16 - 1.09, 5.72]], AMBER, .014)
  const rear = (x1: number, x2: number, z1: number, z2: number, m: Material, y = -11.28) =>
    quad([x1, y, z1], [x2, y, z1], [x2, y, z2], [x1, y, z2], m)
  rear(-2.3, 2.3, .72, 3.04, ROUTE)
  rear(-2.15, 2.15, 3.05, 5.98, BLACK)
  rear(-1.97, 1.97, 3.39, 5.64, GLASS, -11.29)
  rear(-1.5, 1.5, 1.37, 2.69, BELT, -11.29)
  for (let i = 0; i < 5; i++) rear(-1.37, 1.37, 1.52 + i * .19, 1.57 + i * .19, BLACK, -11.3)
  rear(-2.2, 2.2, .81, 1.0, BELT, -11.31)
  for (const s of [-1, 1]) {
    rear(s * 1.82, s * 2.12, 1.42, 2.75, BLACK, -11.31)
    rear(s * 1.88, s * 2.06, 2.03, 2.64, TAILLIGHT, -11.32)
    rear(s * 1.88, s * 2.06, 1.64, 1.87, AMBER, -11.32)
  }
  // Low roof HVAC pod with ramped ends and sparse grille lines.
  box(-1.47, 1.47, -5.8, 3.8, 6.52, 6.97, WHITE)
  box(-1.26, 1.26, -5.5, 3.5, 6.97, 7.12, ROOF)
  quad([-1.47, 3.8, 6.53], [1.47, 3.8, 6.53], [1.26, 3.5, 7.12], [-1.26, 3.5, 7.12], ROOF)
  quad([-1.47, -5.8, 6.53], [1.47, -5.8, 6.53], [1.26, -5.5, 7.12], [-1.26, -5.5, 7.12], ROOF)
  for (const y of [-4.7, -4.35, -4, -3.65, 1.5, 1.85, 2.2, 2.55])
    quad([-1.1, y, 7.124], [1.1, y, 7.124], [1.1, y + .09, 7.124], [-1.1, y + .09, 7.124], METAL)
  box(-.55, .55, 6.6, 7.9, 6.53, 6.6, WHITE)
  return new Float32Array(vertices)
}
