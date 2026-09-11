// Metre-space aircraft: +Y is the nose, +X starboard, +Z up.
// Vertex layout: position, normal, RGB, use-flight-colour (10 floats).
type Vec3 = [number, number, number]
type Color = [number, number, number, number]
type Section = [y: number, radius: number, centerZ: number]
const WHITE: Color = [.94, .965, .98, 0]
const WING: Color = [.79, .85, .9, 0]
const METAL: Color = [.51, .62, .71, 0]
const GLASS: Color = [.055, .15, .22, 0]
const LIVERY: Color = [1, 1, 1, 1]
const SEGMENTS = 24
const BODY: Section[] = [
  [138, .4, 18], [135, 4, 18], [128, 10, 18], [116, 14.5, 18],
  [100, 17, 18], [-60, 17, 18], [-81, 14.5, 19],
  [-101, 10, 20], [-120, 4.5, 21], [-132, .4, 22],
]

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1
  return v.map(n => n / length) as Vec3
}

export function createAircraftMesh(): Float32Array {
  const data: number[] = []
  const vertex = (p: Vec3, n: Vec3, color: Color) => data.push(...p, ...n, ...color)
  function tri(a: Vec3, b: Vec3, c: Vec3, color: Color, normals?: Vec3[]) {
    const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i])
    const normal = unit([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]])
    vertex(a, normals?.[0] ?? normal, color)
    vertex(b, normals?.[1] ?? normal, color)
    vertex(c, normals?.[2] ?? normal, color)
  }
  function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Color) {
    tri(a, b, c, color); tri(a, c, d, color)
  }
  function loft(sections: Section[], x: number, color: Color, caps = true) {
    const point = (s: Section, angle: number): Vec3 => [x + s[1] * Math.cos(angle), s[0], s[2] + s[1] * Math.sin(angle)]
    const normal = (i: number, angle: number): Vec3 => {
      const before = sections[Math.max(0, i - 1)], after = sections[Math.min(sections.length - 1, i + 1)]
      const slope = (after[1] - before[1]) / (after[0] - before[0])
      return unit([Math.cos(angle), -slope, Math.sin(angle)])
    }
    for (let i = 0; i < sections.length - 1; i++) {
      for (let j = 0; j < SEGMENTS; j++) {
        const a = j * Math.PI * 2 / SEGMENTS, b = (j + 1) * Math.PI * 2 / SEGMENTS
        const p = point(sections[i], a), q = point(sections[i + 1], a)
        const r = point(sections[i + 1], b), s = point(sections[i], b)
        tri(p, q, r, color, [normal(i, a), normal(i + 1, a), normal(i + 1, b)])
        tri(p, r, s, color, [normal(i, a), normal(i + 1, b), normal(i, b)])
      }
    }
    if (caps) for (const section of [sections[0], sections[sections.length - 1]]) {
      for (let j = 0; j < SEGMENTS; j++) {
        tri([x, section[0], section[2]], point(section, j * Math.PI * 2 / SEGMENTS), point(section, (j + 1) * Math.PI * 2 / SEGMENTS), color)
      }
    }
  }
  function surface(points: Vec3[], thickness: number, color: Color) {
    const center = points.reduce<Vec3>((sum, p) => sum.map((n, i) => n + p[i] / points.length) as Vec3, [0, 0, 0])
    const lower = (p: Vec3): Vec3 => [p[0], p[1], p[2] - thickness]
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length]
      tri(center, a, b, color)
      tri(lower(center), lower(b), lower(a), color)
      quad(a, lower(a), lower(b), b, color)
    }
  }
  loft(BODY, 0, WHITE)
  for (const side of [-1, 1]) {
    const mirror = (points: Vec3[]): Vec3[] => points.map(([x, y, z]) => [side * x, y, z])
    surface(mirror([[12, 35, 15], [45, 15, 16], [105, -39, 21], [110, -50, 22], [99, -49, 21], [46, -26, 16], [24, -43, 15], [12, -44, 15]]), 2.2, WING)
    surface(mirror([[29, -18, 16.2], [48, -15, 17.2], [96, -43, 21.2], [100, -47, 21.5], [47, -24, 17.2], [29, -36, 16.2]]), .15, METAL)
    surface(mirror([[104, -40, 21], [110, -50, 22], [116, -53, 37], [113, -45, 36]]), 1.1, LIVERY)
    surface(mirror([[4, -84, 28], [41, -106, 32], [45, -119, 32], [32, -116, 31], [4, -106, 28]]), 1.8, WING)

    // Hollow nacelle lip, recessed intake and central spinner, all geometry.
    const x = side * 44
    loft([[40, 8.2, 10], [37, 9, 10], [17, 8.5, 10], [4, 5.8, 10]], x, WHITE, false)
    for (let j = 0; j < SEGMENTS; j++) {
      const a = j * Math.PI * 2 / SEGMENTS, b = (j + 1) * Math.PI * 2 / SEGMENTS
      const p = (r: number, angle: number, y: number): Vec3 => [x + r * Math.cos(angle), y, 10 + r * Math.sin(angle)]
      quad(p(8.25, a, 40.15), p(6.4, a, 40.2), p(6.4, b, 40.2), p(8.25, b, 40.15), METAL)
      quad(p(6.4, a, 40.2), p(5.8, a, 37.5), p(5.8, b, 37.5), p(6.4, b, 40.2), GLASS)
      tri([x, 37.4, 10], p(5.85, a, 37.4), p(5.85, b, 37.4), GLASS)
      tri([x, 39, 10], p(1.8, a, 37.6), p(1.8, b, 37.6), METAL)
      if (j % 2 === 0) tri(p(2, a, 37.8), p(5.5, a + .18, 37.8), p(5.5, b + .18, 37.8), METAL)
      tri([x, 3.9, 10], p(5.8, a, 3.9), p(5.8, b, 3.9), GLASS)
    }
    // Windows sit directly on the barrel, not on a floating roof strip.
    for (let i = 0; i < 18; i++) {
      const y = 95 - i * 9
      const p = (angle: number, offset: number): Vec3 => [side * 17.12 * Math.cos(angle), y + offset, 18 + 17.12 * Math.sin(angle)]
      quad(p(.52, 2), p(.72, 2), p(.72, -2), p(.52, -2), GLASS)
    }
    // Cockpit panes conform to the taper and retain a white centre mullion.
    const nose = (y: number, angle: number): Vec3 => {
      const r = y >= 128 ? 10 + (128 - y) * 6 / 7 : y >= 116 ? 14.5 + (116 - y) * 4.5 / 12 : 17 + (100 - y) * 2.5 / 16
      return [side * (r + .2) * Math.cos(angle), y, 18 + (r + .2) * Math.sin(angle)]
    }
    const pane = (low: number, high: number, frontLow: number, frontHigh: number, backLow: number, backHigh: number) => {
      const point = (u: number, v: number): Vec3 => {
        const front = frontLow + (frontHigh - frontLow) * u
        const back = backLow + (backHigh - backLow) * u
        return nose(front + (back - front) * v, low + (high - low) * u)
      }
      // Subdivide the glazing so it follows the convex nose instead of
      // cutting through it as a large flat quad would.
      for (let u = 0; u < 6; u++) for (let v = 0; v < 4; v++) {
        quad(point(u / 6, v / 4), point((u + 1) / 6, v / 4), point((u + 1) / 6, (v + 1) / 4), point(u / 6, (v + 1) / 4), GLASS)
      }
    }
    pane(.87, 1.47, 125, 127, 114, 119)
    pane(.45, .79, 120, 124, 109, 113)
  }
  // Continuous swept fin, tapering in both chord and thickness.
  const a: Vec3 = [-2.6, -66, 31], b: Vec3 = [-2.6, -123, 31]
  const c: Vec3 = [-.9, -124, 76], d: Vec3 = [-.9, -106, 76]
  const opposite = (p: Vec3): Vec3 => [-p[0], p[1], p[2]]
  quad(a, b, c, d, LIVERY)
  quad(opposite(d), opposite(c), opposite(b), opposite(a), LIVERY)
  quad(a, d, opposite(d), opposite(a), LIVERY)
  quad(b, opposite(b), opposite(c), c, LIVERY)
  quad(d, c, opposite(c), opposite(d), WING)
  for (const side of [-1, 1]) {
    const mark = (y: number, z: number): Vec3 => [side * (2.72 - (z - 31) * 1.7 / 45), y, z]
    quad(mark(-102, 59), mark(-116, 63), mark(-117, 67), mark(-105, 64), WHITE)
  }
  return new Float32Array(data)
}

export const AIRCRAFT_VERTEX_FLOATS = 10
