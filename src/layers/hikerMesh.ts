// A hiker built like a toy-brick minifigure, about to set off: +Y the way
// they face, +X their right, +Z up; about 1.78 m tall at scale 1. Modelled in
// millimetres of the real toy and scaled at the end, keeping its joints:
//   * legs are blocks hinged at the hips (a rounded hinge on top, a toe out in
//     front); they only swing forward and back — left forward, right back;
//   * the torso tapers to the shoulders, with the neck post on top;
//   * arms have the fixed elbow bend and only rotate at the shoulder about the
//     side-to-side axis (a raised arm goes up in front, never out sideways);
//     the right holds a trekking pole ahead, the left is up in a wave;
//   * hands are the C-shaped clips, open away from the wrist, and turn only
//     about the wrist peg; the pole passes through the right one;
//   * the cylindrical head with bevelled rims, the classic smiley face and a
//     bush hat sitting on it; a backpack with a rolled mat on the back.
// The same figure in a second pose stands on the summits taking a photo the
// way a real minifigure does: the camera's handle in the right clip, that arm
// swung up until the camera is in front of the right eye, the left arm
// relaxed (createPhotographerMesh).
// Jacket (torso, neck post and arms) takes the per-instance colour — the
// trail's; everything else is fixed. Same position / normal / RGB /
// livery-weight vertex layout as the vehicle meshes, for the shared
// InstancedVehicleModelLayer.
type Point = [number, number, number]
type Material = [number, number, number, number]
type Transform = (p: Point) => Point

const JACKET: Material = [1, 1, 1, 1] // livery: the trail colour
const YELLOW: Material = [.96, .8, .2, 0] // the toy's classic skin yellow
const PRINT: Material = [.07, .07, .08, 0] // face printing
const TROUSERS: Material = [.07, .2, .4, 0]
const BOOTS: Material = [.36, .17, .08, 0]
const PACK: Material = [.96, .43, .1, 0]
const PACK_DARK: Material = [.62, .25, .07, 0]
const MAT_ROLL: Material = [.2, .52, .88, 0]
const HAT: Material = [.88, .79, .58, 0]
const HAT_BAND: Material = [.45, .31, .16, 0]
const POLE: Material = [.74, .76, .8, 0]
const CAMERA: Material = [.1, .1, .11, 0]
const LENS: Material = [.26, .27, .3, 0]
const GLASS: Material = [.2, .36, .58, 0]

export const HIKER_HEIGHT_M = 1.78

// A pose, in degrees: legs and arms swing forward (+) about the hip and the
// shoulders, wrists twist about the peg; [left, right].
interface MinifigPose {
  legs: [number, number]
  arms: [number, number]
  twist: [number, number]
  prop: 'pole' | 'camera'
}
const HIKING: MinifigPose = { legs: [25, -15], arms: [130, 35], twist: [0, 0], prop: 'pole' }
// As a real minifigure uses a camera: its hands are fixed ~16 mm apart and
// cannot meet, so the camera is held in ONE hand by its handle, the arm swung
// up until the camera is beside the face at eye level; the other arm relaxed.
const PHOTO: MinifigPose = { legs: [8, -6], arms: [15, 100], twist: [0, 0], prop: 'camera' }

export function createHikerMesh(): Float32Array {
  return createMinifigMesh(HIKING)
}

export function createPhotographerMesh(): Float32Array {
  return createMinifigMesh(PHOTO)
}

const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: Point, k: number): Point => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Point): Point => mul(a, 1 / (Math.hypot(...a) || 1))
const same: Transform = p => p

// Rotate about the X axis through `pivot`; positive swings what hangs below
// the pivot forward (+Y). The only joint axis a minifigure's legs and arms have.
const swing = (angle: number, pivot: Point): Transform => p => {
  const dy = p[1] - pivot[1], dz = p[2] - pivot[2]
  const c = Math.cos(angle), s = Math.sin(angle)
  return [p[0], pivot[1] + dy * c - dz * s, pivot[2] + dy * s + dz * c]
}

function createMinifigMesh(pose: MinifigPose): Float32Array {
  const vertices: number[] = []
  let T: Transform = same
  const tri = (a0: Point, b0: Point, c0: Point, m: Material) => {
    const a = T(a0), b = T(b0), c = T(c0)
    const n = unit(cross(sub(b, a), sub(c, a)))
    for (const p of [a, b, c]) vertices.push(...p, ...n, ...m)
  }
  const quad = (a: Point, b: Point, c: Point, d: Point, m: Material) => { tri(a, b, c, m); tri(a, c, d, m) }
  const face = (points: Point[], m: Material) => {
    for (let i = 1; i < points.length - 1; i++) tri(points[0], points[i], points[i + 1], m)
  }
  const connect = (a: Point[], b: Point[], m: Material) => {
    for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; quad(a[i], a[j], b[j], b[i], m) }
  }
  const prism = (a: Point[], b: Point[], m: Material) => { connect(a, b, m); face(a, m); face(b, m) }
  const box = (x1: number, x2: number, y1: number, y2: number, z1: number, z2: number, m: Material) => {
    const a: Point[] = [[x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1]]
    prism(a, a.map(([x, y]): Point => [x, y, z2]), m)
  }
  // A ring of `sides` points of radius r round `c`, in the plane normal to `axis`.
  const ring = (c: Point, axis: Point, r: number, sides: number): Point[] => {
    const a = unit(axis)
    const u = unit(cross(a, Math.abs(a[0]) < .9 ? [1, 0, 0] : [0, 1, 0]))
    const v = cross(a, u)
    return Array.from({ length: sides }, (_, i) => {
      const t = i * 2 * Math.PI / sides
      return add(c, add(mul(u, r * Math.cos(t)), mul(v, r * Math.sin(t))))
    })
  }
  // A round rod (radius r1 at `from`, r2 at `to`), capped.
  const tube = (from: Point, to: Point, r1: number, r2: number, m: Material, sides = 10) => {
    const axis = sub(to, from)
    prism(ring(from, axis, r1, sides), ring(to, axis, r2, sides), m)
  }
  const sphere = (c: Point, r: number, m: Material, rings = 6, sides = 10) => {
    const at = (i: number, j: number): Point => {
      const phi = Math.PI * i / rings, theta = 2 * Math.PI * j / sides
      return [c[0] + r * Math.sin(phi) * Math.cos(theta), c[1] + r * Math.sin(phi) * Math.sin(theta), c[2] + r * Math.cos(phi)]
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
      const a = at(i, j), b = at(i + 1, j), cc = at(i + 1, j + 1), d = at(i, j + 1)
      if (i === 0) tri(a, b, cc, m)
      else if (i === rings - 1) tri(a, b, d, m)
      else quad(a, b, cc, d, m)
    }
  }
  // The C-shaped hand: a thick ring round `axis`, open on the side `gap`
  // points to (away from the wrist), walls, caps and the two cut ends.
  const cHand = (c: Point, axis: Point, gap: Point, rOut: number, rIn: number, height: number, m: Material) => {
    const a = unit(axis)
    const g = unit(sub(gap, mul(a, dot(gap, a))))
    const h = cross(a, g)
    const half = 55 * Math.PI / 180, steps = 14
    const at = (t: number, r: number, z: number): Point =>
      add(add(c, mul(a, z)), add(mul(g, r * Math.cos(t)), mul(h, r * Math.sin(t))))
    for (let i = 0; i < steps; i++) {
      const t1 = half + (2 * Math.PI - 2 * half) * i / steps
      const t2 = half + (2 * Math.PI - 2 * half) * (i + 1) / steps
      const lo = -height / 2, hi = height / 2
      quad(at(t1, rOut, lo), at(t2, rOut, lo), at(t2, rOut, hi), at(t1, rOut, hi), m)
      quad(at(t1, rIn, lo), at(t2, rIn, lo), at(t2, rIn, hi), at(t1, rIn, hi), m)
      quad(at(t1, rIn, hi), at(t2, rIn, hi), at(t2, rOut, hi), at(t1, rOut, hi), m)
      quad(at(t1, rIn, lo), at(t2, rIn, lo), at(t2, rOut, lo), at(t1, rOut, lo), m)
    }
    for (const t of [half, 2 * Math.PI - half]) {
      quad(at(t, rIn, -height / 2), at(t, rOut, -height / 2), at(t, rOut, height / 2), at(t, rIn, height / 2), m)
    }
  }

  // ---- Hips and legs (millimetres of the toy). The legs hinge at HIP.
  const HIP: Point = [0, 0, 11.2]
  box(-7.8, 7.8, -3.8, 3.8, 10.8, 13.2, TROUSERS)
  box(-.9, .9, 1.6, 3.8, 9.2, 10.8, TROUSERS) // the centre piece between the legs
  for (const [x1, x2, angle] of [[-7.8, -.5, pose.legs[0]], [.5, 7.8, pose.legs[1]]] as const) {
    T = swing(angle * Math.PI / 180, HIP)
    tube([x1, 0, HIP[2]], [x2, 0, HIP[2]], 2.5, 2.5, TROUSERS, 12) // the rounded hinge
    box(x1, x2, -3.4, 3.4, 3, 11.2, TROUSERS)
    box(x1, x2, -3.4, 3.4, 0, 3, BOOTS)
    box(x1, x2, 3.4, 4.9, 0, 2.6, BOOTS) // the toe
    T = same
  }

  // ---- Torso, tapering from the hips to the shoulders, and the neck post.
  prism(
    [[-7.8, -3.9, 13.2], [7.8, -3.9, 13.2], [7.8, 3.9, 13.2], [-7.8, 3.9, 13.2]],
    [[-6, -3.6, 25.2], [6, -3.6, 25.2], [6, 3.6, 25.2], [-6, 3.6, 25.2]],
    JACKET,
  )
  tube([0, 0, 25.2], [0, 0, 26.4], 2.2, 2.2, JACKET, 16)
  // The pack's shoulder straps, printed down the front.
  for (const x of [-3.4, 2.2]) {
    prism(
      [[x, 3.9, 14.6], [x + 1.2, 3.9, 14.6], [x + 1.2, 4.05, 14.6], [x, 4.05, 14.6]],
      [[x - .2, 3.6, 24.9], [x + 1, 3.6, 24.9], [x + 1, 3.75, 24.9], [x - .2, 3.75, 24.9]],
      PACK_DARK,
    )
  }

  // ---- Arms. Built hanging, for the right side (s = 1) or the left (s = -1),
  // then swung about the shoulder axis; the hand turns about the wrist peg by
  // `twist`. Returns the hand's centre and the clip's axis.
  const arm = (s: 1 | -1, angle: number, twist: number): { hand: Point; axis: Point } => {
    const shoulder: Point = [s * 6.2, 0, 22.8]
    const elbow: Point = [s * 7.9, .4, 16.6]
    const wrist: Point = [s * 8.1, 5, 14.2]
    const dir = unit(sub(wrist, elbow))
    const hand = add(wrist, mul(dir, 3.3))
    const rest = cross([1, 0, 0], dir) // perpendicular to the wrist peg
    const tw = twist * Math.PI / 180
    const axis = add(mul(rest, Math.cos(tw)), mul(cross(dir, rest), Math.sin(tw)))
    T = swing(angle * Math.PI / 180, shoulder)
    sphere([s * 6.6, 0, 22.6], 2.3, JACKET) // the rounded shoulder
    tube([s * 6.6, 0, 22.6], elbow, 2.2, 2.1, JACKET)
    sphere(elbow, 2.1, JACKET)
    tube(elbow, wrist, 2.1, 1.9, JACKET)
    tube(wrist, add(wrist, mul(dir, 1.5)), 1.1, 1.1, YELLOW, 8) // the wrist peg
    cHand(hand, axis, dir, 1.95, 1.25, 2.4, YELLOW)
    const out = { hand: T(hand), axis: sub(T(add(hand, axis)), T(hand)) }
    T = same
    return out
  }
  arm(-1, pose.arms[0], pose.twist[0])
  const right = arm(1, pose.arms[1], pose.twist[1])
  if (pose.prop === 'pole') {
    // The trekking pole runs through the right hand's clip, planted on the ground.
    const a = unit(right.axis)
    const down = a[2] > 0 ? mul(a, -1) : a
    const top = add(right.hand, mul(down, -9))
    const toGround = right.hand[2] / -down[2]
    tube(top, add(right.hand, mul(down, toGround)), .55, .45, POLE, 8)
  } else {
    // The camera in the right hand: its handle runs through the clip along
    // the clip's axis, the body sits on the inner side, in front of the right
    // eye, with the lens and its glass facing forward and the shutter on top.
    const [hx, hy, hz] = right.hand
    const a = unit(right.axis)
    tube(add(right.hand, mul(a, -2.2)), add(right.hand, mul(a, 2.2)), .8, .8, LENS, 8)
    box(hx - 2.1, hx - .6, hy - .6, hy + .6, hz - .6, hz + .6, CAMERA) // handle to body
    const cx = hx - 3.95
    box(hx - 6, hx - 1.9, hy - 2.2, hy + 1.6, hz - 1.7, hz + 1.7, CAMERA)
    tube([cx, hy + 1.6, hz], [cx, hy + 3.6, hz], 1.3, 1.2, LENS, 16)
    tube([cx, hy + 3.6, hz], [cx, hy + 3.7, hz], .9, .9, GLASS, 16)
    tube([hx - 3, hy - 1, hz + 1.7], [hx - 3, hy - 1, hz + 2.1], .5, .5, LENS, 8)
  }

  // ---- Head: bevelled cylinder with the classic smiley and the top stud.
  tube([0, 0, 26.4], [0, 0, 27], 4.1, 4.8, YELLOW, 28)
  tube([0, 0, 27], [0, 0, 35], 4.8, 4.8, YELLOW, 28)
  tube([0, 0, 35], [0, 0, 35.6], 4.8, 4.1, YELLOW, 28)
  tube([0, 0, 35.6], [0, 0, 37.3], 2.4, 2.4, YELLOW, 16)
  const onHead = (x: number) => Math.sqrt(4.8 * 4.8 - x * x)
  for (const x of [-1.6, 1.6]) tube([x, onHead(x) - .2, 31.9], [x, onHead(x) + .1, 31.9], .55, .55, PRINT, 10)
  for (let i = 0; i <= 8; i++) {
    const t = Math.PI * (1.2 + .6 * i / 8)
    const x = 2.3 * Math.cos(t), z = 31.4 + 2.3 * Math.sin(t)
    const y = onHead(x)
    box(x - .28, x + .28, y - .2, y + .1, z - .26, z + .26, PRINT)
  }

  // ---- Bush hat on the head: sloping brim, band, crown.
  tube([0, 0, 34.3], [0, 0, 34.9], 7.6, 6.4, HAT, 28)
  tube([0, 0, 34.9], [0, 0, 35.8], 5.35, 5.35, HAT_BAND, 28)
  tube([0, 0, 35.8], [0, 0, 38.6], 5.2, 4.4, HAT, 28)

  // ---- Backpack on the back, with a pocket, a lid and a rolled mat on top.
  box(-5, 5, -8.6, -3.9, 14.6, 24.2, PACK)
  box(-5.2, 5.2, -8.9, -3.8, 24.2, 25.2, PACK_DARK)
  box(-3.4, 3.4, -9.8, -8.6, 15.6, 20.4, PACK_DARK)
  tube([-6.6, -6.2, 26.9], [6.6, -6.2, 26.9], 1.7, 1.7, MAT_ROLL, 12)

  // Stand the figure on the ground and scale it to HIKER_HEIGHT_M.
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 2; i < vertices.length; i += 10) {
    minZ = Math.min(minZ, vertices[i])
    maxZ = Math.max(maxZ, vertices[i])
  }
  const k = HIKER_HEIGHT_M / (maxZ - minZ)
  for (let i = 0; i < vertices.length; i += 10) {
    vertices[i] *= k
    vertices[i + 1] *= k
    vertices[i + 2] = (vertices[i + 2] - minZ) * k
  }
  return new Float32Array(vertices)
}
