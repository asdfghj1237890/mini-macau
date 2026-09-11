// A two-car miniature metro. +Y is the leading cab, +Z above the viaduct.
// The exaggerated map dimensions intentionally match the previous train.
export const LRT_VIADUCT_TOP_M = 7.2
export const LRT_HALF_LENGTH_M = 30.5
export const LRT_HALF_WIDTH_M = 4.32
export const LRT_HEIGHT_M = 12.3
export const LRT_VERTEX_FLOATS = 11
export const LRT_JOINT_HALF_M = 1.36
type V = [number, number, number]
type C = [number, number, number, number]
const PEARL: C = [.94, .96, .975, 0]
const SILVER: C = [.66, .73, .79, 0]
const NAVY: C = [.075, .095, .16, 0]
const GLASS: C = [.24, .32, .33, 0]
const GLASS_EDGE: C = [.38, .46, .46, 0]
const CAB_MASK: C = [.027, .035, .048, 0]
const RUBBER: C = [.065, .08, .095, 0]
const FRAME: C = [.28, .34, .38, 0]
const COPPER: C = [.69, .34, .25, 0]
const HEADLIGHT: C = [.85, .98, 1, -1]
const TAILLIGHT: C = [1, .14, .19, -1]

export function createLrtMesh(): Float32Array {
  const data: number[] = []
  // Rigid car weights, then a continuous blend through the accordion.
  let carWeight: number | null = 0
  function tri(a: V, b: V, c: V, color: C) {
    const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i])
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const length = Math.hypot(...normal) || 1
    for (const p of [a, b, c]) {
      const weight = carWeight ?? Math.max(0, Math.min(1, (p[1] + LRT_JOINT_HALF_M) / (2 * LRT_JOINT_HALF_M)))
      data.push(...p, ...normal.map(n => n / length), ...color, weight)
    }
  }
  const quad = (a: V, b: V, c: V, d: V, color: C) => { tri(a, b, c, color); tri(a, c, d, color) }
  function face(points: V[], color: C) {
    for (let i = 1; i < points.length - 1; i++) tri(points[0], points[i], points[i + 1], color)
  }
  function box(x: number, y: number, z: number, w: number, l: number, h: number, color: C) {
    const p: V[] = [[x-w/2,y-l/2,z], [x+w/2,y-l/2,z], [x+w/2,y+l/2,z], [x-w/2,y+l/2,z]]
    const top = p.map(([a,b,c]): V => [a,b,c+h])
    face([...p].reverse(), color); face(top, color)
    for(let i=0;i<4;i++) quad(p[i],p[(i+1)%4],top[(i+1)%4],top[i],color)
  }
  function roundedProfile(w: number, bottom: number, top: number, radius: number): [number, number][] {
    const points: [number, number][] = []
    const corners = [[w/2-radius,bottom+radius,-Math.PI/2], [w/2-radius,top-radius,0], [-w/2+radius,top-radius,Math.PI/2], [-w/2+radius,bottom+radius,Math.PI]]
    for (const [x,z,angle] of corners) for(let j=0;j<=4;j++) {
      const a=angle+j*Math.PI/8
      points.push([x+Math.cos(a)*radius,z+Math.sin(a)*radius])
    }
    return points
  }
  const profile = roundedProfile(8.44, 2.15, 11.3, 1.35)
  const frontY = (z: number) => 29.2 - Math.max(0,z-4.1)*.04

  for(const direction of [-1,1]) {
    carWeight = direction === 1 ? 1 : 0
    const p = (x:number,y:number,z:number):V => [x,direction*y,z]
    const rings = [
      profile.map(([x,z])=>p(x*.98,1.3,z)),
      profile.map(([x,z])=>p(x,23.6,z)),
      profile.map(([x,z])=>p(x*.91,frontY(z),z)),
    ]
    face([...rings[0]].reverse(),PEARL)
    face(rings[2],PEARL)
    for(let r=0;r<2;r++) for(let i=0;i<profile.length;i++) {
      const j=(i+1)%profile.length
      quad(rings[r][i],rings[r][j],rings[r+1][j],rings[r+1][i],PEARL)
    }
    // Almost vertical, full-height octagonal cab glazing inside a white rim.
    const cab = (x:number,z:number,offset=.045):V => p(x,frontY(z)+offset,z)
    face([cab(-3.08,2.97),cab(3.08,2.97),cab(3.72,3.7),cab(3.72,9.05),cab(3.08,10.4),cab(-3.08,10.4),cab(-3.72,9.05),cab(-3.72,3.7)],CAB_MASK)
    face([cab(-2.86,4.77,.07),cab(2.86,4.77,.07),cab(3.23,5.22,.07),cab(3.23,8.9,.07),cab(2.72,9.58,.07),cab(-2.72,9.58,.07),cab(-3.23,8.9,.07),cab(-3.23,5.22,.07)],GLASS)
    // Restrained reflections and window pillars are geometry, not a texture.
    quad(cab(-2.95,5.25,.08),cab(-2.54,5.25,.08),cab(-1.85,9.35,.08),cab(-2.28,9.35,.08),GLASS_EDGE)
    quad(cab(.75,4.81,.085),cab(.86,4.81,.085),cab(.86,9.55,.085),cab(.75,9.55,.085),FRAME)
    function cabStroke(x1:number,z1:number,x2:number,z2:number,width:number,color:C) {
      const length=Math.hypot(x2-x1,z2-z1), dx=-(z2-z1)/length*width/2, dz=(x2-x1)/length*width/2
      quad(cab(x1-dx,z1-dz,.11),cab(x2-dx,z2-dz,.11),cab(x2+dx,z2+dz,.11),cab(x1+dx,z1+dz,.11),color)
    }
    for(const side of [-1,1]) {
      const lamp=direction===1?HEADLIGHT:TAILLIGHT
      cabStroke(side*3.36,9.08,side*2.8,9.92,.24,lamp)
      cabStroke(side*3.29,4.16,side*2.74,3.47,.24,lamp)
    }
    cabStroke(-2.35,5.3,-.4,4.82,.1,CAB_MASK)
    cabStroke(-.4,4.82,1.8,6.4,.08,CAB_MASK)
    cabStroke(-1.5,4.32,1.5,4.32,.1,SILVER)
    box(0,direction*29.55,2.02,6.7,.75,.69,PEARL)
    box(0,direction*29.92,.6,1.35,1.16,1.2,FRAME)
    box(0,direction*30.32,.88,.7,.3,.65,RUBBER)

    for(const side of [-1,1]) {
      const wall=(y:number,z:number,offset=.035):V=>p(side*(4.22+offset),y,z)
      quad(wall(1.6,3.3),wall(23.62,3.3),wall(23.62,9.75),wall(1.6,9.75),NAVY)
      // The dark side panel stops before the white cab perimeter.
      const shoulder=(y:number,z:number,offset=.025):V=>p(side*(4.22-(y-23.6)*.065+offset),y,z)
      quad(wall(23.6,3.3),shoulder(27.55,3.3),shoulder(27.55,9.65),wall(23.6,9.75),NAVY)
      quad(shoulder(24.15,5.2,.045),shoulder(26.8,5.2,.045),shoulder(26.8,9.04,.045),shoulder(24.15,9.04,.045),GLASS)
      for(const [lo,hi] of [[2.15,4.6],[10.15,16.05],[22.05,23.3]]) {
        quad(wall(lo-.12,5.62,.055),wall(hi+.12,5.62,.055),wall(hi+.12,9.33,.055),wall(lo-.12,9.33,.055),CAB_MASK)
        quad(wall(lo,5.77,.075),wall(hi,5.77,.075),wall(hi,9.18,.075),wall(lo,9.18,.075),GLASS)
        quad(wall(lo+.07,8.94,.085),wall(hi-.07,8.94,.085),wall(hi-.07,9.08,.085),wall(lo+.07,9.08,.085),GLASS_EDGE)
      }
      // The real livery's fine white rule and copper wave, identical on all routes.
      quad(wall(1.8,4.04,.09),wall(23.6,4.04,.09),wall(23.6,4.14,.09),wall(1.8,4.14,.09),SILVER)
      const wave=[[1.8,3.57],[6,3.62],[12,3.91],[17,3.89],[23.6,3.48]]
      for(let j=0;j<wave.length-1;j++) {
        const [a,za]=wave[j], [b,zb]=wave[j+1]
        quad(wall(a,za,.1),wall(b,zb,.1),wall(b,zb+.105,.1),wall(a,za+.105,.1),COPPER)
      }
      // Two pairs of sliding doors per car, with separate window panes and a
      // visible centre seam. Door panels sit a few centimetres outside the skin.
      for(const y of [7.4,18.8]) {
        quad(wall(y-1.87,3.08,.055),wall(y+1.87,3.08,.055),wall(y+1.87,9.65,.055),wall(y-1.87,9.65,.055),FRAME)
        for(const half of [-1,1]) {
          const lo=y+half*.91-.83, hi=lo+1.66
          quad(wall(lo,3.3,.075),wall(hi,3.3,.075),wall(hi,9.5,.075),wall(lo,9.5,.075),NAVY)
          quad(wall(lo+.23,4.42,.09),wall(hi-.23,4.42,.09),wall(hi-.23,9.12,.09),wall(lo+.23,9.12,.09),GLASS)
        }
        quad(wall(y-1.75,2.99,.08),wall(y+1.75,2.99,.08),wall(y+1.75,3.1,.08),wall(y-1.75,3.1,.08),SILVER)
      }
      quad(wall(10.45,5.83,.095),wall(10.91,5.83,.095),wall(12.1,8.92,.095),wall(11.65,8.92,.095),GLASS_EDGE)
    }

    // One long, shallow, bevelled HVAC housing on each white roof.
    box(0,direction*14,11.29,4.9,14,.2,SILVER)
    const housing=[p(-2.45,7,11.49),p(2.45,7,11.49),p(2.45,21,11.49),p(-2.45,21,11.49)]
    const housingTop=[p(-2.07,7.75,12.19),p(2.07,7.75,12.19),p(2.07,20.25,12.19),p(-2.07,20.25,12.19)]
    face(housingTop,PEARL)
    for(let j=0;j<4;j++) quad(housing[j],housing[(j+1)%4],housingTop[(j+1)%4],housingTop[j],PEARL)
    for(const side of [-1,1]) for(let j=0;j<14;j++) {
      box(side*1.29,direction*(8.7+j*.81),12.19,.83,.22,.055,SILVER)
    }
    box(0,direction*24,11.06,1.15,1.6,.4,PEARL)
    // Recessed bogie pods and visible rubber tyres.
    for(const y of [6.5,22]) {
      box(0,direction*y,.8,5.75,4.7,1.6,RUBBER)
      for(const side of [-1,1]) {
        const x=side*3.03
        for(let j=0;j<12;j++) {
          const a=j*Math.PI/6,b=(j+1)*Math.PI/6
          const wheel=(xx:number,angle:number,r=1.13):V=>[xx,direction*y+Math.cos(angle)*r,1.14+Math.sin(angle)*r]
          quad(wheel(x-.44,a),wheel(x+.44,a),wheel(x+.44,b),wheel(x-.44,b),RUBBER)
          const outer=x+side*.45
          tri([outer,direction*y,1.14],wheel(outer,a),wheel(outer,b),FRAME)
          tri([outer+side*.01,direction*y,1.14],wheel(outer+side*.01,a,.49),wheel(outer+side*.01,b,.49),SILVER)
        }
      }
    }
  }
  // Flexible dark bellows, with alternating ribs rather than a solid block.
  carWeight = null
  box(0,0,3.1,6.55,2.72,6.9,RUBBER)
  for(let i=0;i<6;i++) {
    const y=-1.05+i*.42
    box(0,y,3.0,6.85,.14,7.15,FRAME)
  }
  return new Float32Array(data)
}
