import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'

const ORIGIN = MercatorCoordinate.fromLngLat([113.57, 22.16])
const UNIT = ORIGIN.meterInMercatorCoordinateUnits()
const INSTANCE_FLOATS = 9
const VERTEX_FLOATS = 10
export type ModelArticulation = {
  front: [number, number, number, number]
  rear: [number, number, number, number]
}
const IDENTITY_CAR = [0, 0, 1, 0]
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec4 a_material;
layout(location=3) in vec3 a_offset;
layout(location=4) in vec3 a_pose;
layout(location=5) in vec3 a_livery;
#ifdef ARTICULATED
layout(location=6) in vec4 a_front;
layout(location=7) in vec4 a_rear;
layout(location=8) in float a_frontWeight;
#endif
uniform mat4 u_matrix;
out vec3 v_normal;
out vec3 v_color;
out float v_emissive;
void main() {
  mat3 rotation = mat3(a_pose.x, a_pose.y, 0.0, a_pose.y, -a_pose.x, 0.0, 0.0, 0.0, 1.0);
  vec3 position = a_position;
  vec3 normal = a_normal;
#ifdef ARTICULATED
  mat3 front = mat3(a_front.z, -a_front.w, 0.0, a_front.w, a_front.z, 0.0, 0.0, 0.0, 1.0);
  mat3 rear = mat3(a_rear.z, -a_rear.w, 0.0, a_rear.w, a_rear.z, 0.0, 0.0, 0.0, 1.0);
  position = mix(rear * position + vec3(a_rear.xy, 0.0), front * position + vec3(a_front.xy, 0.0), a_frontWeight);
  normal = mix(rear * normal, front * normal, a_frontWeight);
#endif
  gl_Position = u_matrix * vec4(a_offset + rotation * position * a_pose.z, 1.0);
  v_normal = rotation * normal;
  v_color = mix(a_material.rgb, a_livery, clamp(a_material.a, 0.0, 1.0));
  v_emissive = a_material.a < 0.0 ? 1.0 : 0.0;
}`
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_color;
in float v_emissive;
out vec4 fragColor;
void main() {
  vec3 normal = normalize(v_normal);
  float key = abs(dot(normal, normalize(vec3(-0.35, -0.45, 0.82))));
  float sky = abs(normal.z);
  fragColor = vec4(v_color * mix(0.58 + 0.28 * key + 0.14 * sky, 1.0, v_emissive), 1.0);
}`

export function vehicleInstances(vehicles: VehiclePosition[], groundAltitude = 0, articulations?: ModelArticulation[]): Float32Array {
  const stride = articulations ? INSTANCE_FLOATS + 8 : INSTANCE_FLOATS
  const values = new Float32Array(vehicles.length * stride)
  vehicles.forEach((vehicle, i) => {
    const position = MercatorCoordinate.fromLngLat(vehicle.coordinates, vehicle.altitude ?? groundAltitude)
    const angle = vehicle.bearing * Math.PI / 180
    const color = /^#[\da-f]{6}$/i.test(vehicle.color) ? Number.parseInt(vehicle.color.slice(1), 16) : 0x38bdf8
    values.set([
      (position.x - ORIGIN.x) / UNIT, (position.y - ORIGIN.y) / UNIT, position.z / UNIT,
      Math.cos(angle), Math.sin(angle), (vehicle.scale ?? 1) * position.meterInMercatorCoordinateUnits() / UNIT,
      (color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255,
    ], i * stride)
    if (articulations) {
      values.set(articulations[i]?.front ?? IDENTITY_CAR, i * stride + INSTANCE_FLOATS)
      values.set(articulations[i]?.rear ?? IDENTITY_CAR, i * stride + INSTANCE_FLOATS + 4)
    }
  })
  return values
}

type Batch = { data: Float32Array; dirty: boolean; vao: WebGLVertexArrayObject | null; buffer: WebGLBuffer | null }
const batch = (): Batch => ({ data: new Float32Array(), dirty: true, vao: null, buffer: null })

// One immutable mesh, at most two draws (fleet + optional tracked vehicle). Uses the
// map's WebGL2 context and depth buffer; no texture, extra context or library.
export class InstancedVehicleModelLayer implements CustomLayerInterface {
  readonly id: string
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const
  private map: MapLibreMap | null = null
  private program: WebGLProgram | null = null
  private meshBuffer: WebGLBuffer | null = null
  private matrixLocation: WebGLUniformLocation | null = null
  private matrix = new Float32Array(16)
  private fleet = batch()
  private tracked = batch()

  private minZoom: number

  private mesh: Float32Array
  private groundAltitude: number
  private label: string
  private articulated: boolean
  private vertexFloats: number
  private instanceFloats: number

  constructor(options: { id: string; minZoom: number; mesh: Float32Array; groundAltitude?: number; label: string; articulated?: boolean }) {
    this.id = options.id
    this.minZoom = options.minZoom
    this.mesh = options.mesh
    this.groundAltitude = options.groundAltitude ?? 0
    this.label = options.label
    this.articulated = options.articulated ?? false
    this.vertexFloats = VERTEX_FLOATS + (this.articulated ? 1 : 0)
    this.instanceFloats = INSTANCE_FLOATS + (this.articulated ? 8 : 0)
  }

  setVehicles(vehicles: VehiclePosition[], articulations?: ModelArticulation[]): void {
    if (!vehicles.length && !this.fleet.data.length) return
    this.fleet.data = vehicleInstances(vehicles, this.groundAltitude, this.articulated ? articulations ?? [] : undefined)
    this.fleet.dirty = true
    this.map?.triggerRepaint()
  }

  setTrackedVehicle(vehicle: VehiclePosition | null, articulation?: ModelArticulation): void {
    if (!vehicle && this.tracked.data.length === 0) return
    this.tracked.data = vehicleInstances(vehicle ? [vehicle] : [], this.groundAltitude, this.articulated ? articulation ? [articulation] : [] : undefined)
    this.tracked.dirty = true
    this.map?.triggerRepaint()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map
    const shaders: WebGLShader[] = []
    try {
      this.program = gl.createProgram()
      if (!this.program) throw new Error('Could not create vehicle shader program')
      const vertex = this.articulated ? VERTEX.replace('#version 300 es', '#version 300 es\n#define ARTICULATED') : VERTEX
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Could not create vehicle shader')
        shaders.push(shader)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Could not compile ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${this.label}: ${gl.getShaderInfoLog(shader)}`)
        gl.attachShader(this.program, shader)
      }
      gl.linkProgram(this.program)
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(`Program failed to link: ${this.label}: ${gl.getProgramInfoLog(this.program)}`)
      this.matrixLocation = gl.getUniformLocation(this.program, 'u_matrix')
      this.meshBuffer = gl.createBuffer()
      if (!this.meshBuffer) throw new Error('Could not allocate vehicle mesh')
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, this.mesh, gl.STATIC_DRAW)
      for (const item of [this.fleet, this.tracked]) {
        item.vao = gl.createVertexArray()
        item.buffer = gl.createBuffer()
        if (!item.vao || !item.buffer) throw new Error('Could not allocate vehicle instances')
        gl.bindVertexArray(item.vao)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer)
        for (const [index, size, offset] of [[0, 3, 0], [1, 3, 3], [2, 4, 6]]) {
          gl.enableVertexAttribArray(index)
          gl.vertexAttribPointer(index, size, gl.FLOAT, false, this.vertexFloats * 4, offset * 4)
        }
        if (this.articulated) {
          gl.enableVertexAttribArray(8)
          gl.vertexAttribPointer(8, 1, gl.FLOAT, false, this.vertexFloats * 4, VERTEX_FLOATS * 4)
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer)
        for (let i = 0; i < 3; i++) {
          gl.enableVertexAttribArray(i + 3)
          gl.vertexAttribPointer(i + 3, 3, gl.FLOAT, false, this.instanceFloats * 4, i * 12)
          gl.vertexAttribDivisor(i + 3, 1)
        }
        if (this.articulated) for (let i = 0; i < 2; i++) {
          gl.enableVertexAttribArray(i + 6)
          gl.vertexAttribPointer(i + 6, 4, gl.FLOAT, false, this.instanceFloats * 4, (INSTANCE_FLOATS + i * 4) * 4)
          gl.vertexAttribDivisor(i + 6, 1)
        }
        item.dirty = true
      }
    } catch (error) {
      this.onRemove(map, gl)
      throw error
    } finally {
      for (const shader of shaders) gl.deleteShader(shader)
      gl.bindVertexArray(null)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
    }
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program || !this.map || this.map.getZoom() < this.minZoom) return
    if (!this.fleet.data.length && !this.tracked.data.length) return
    const source = options.defaultProjectionData.mainMatrix
    // Fold a local origin into the matrix in double precision on the CPU.
    // Sending absolute Mercator positions as floats makes stationary vehicles jitter.
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) this.matrix[col * 4 + row] = source[col * 4 + row] * UNIT
      this.matrix[12 + row] = source[row] * ORIGIN.x + source[4 + row] * ORIGIN.y + source[12 + row]
    }
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.matrixLocation, false, this.matrix)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.disable(gl.CULL_FACE)
    for (const item of [this.fleet, this.tracked]) {
      if (!item.data.length) continue
      gl.bindVertexArray(item.vao)
      if (item.dirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer)
        gl.bufferData(gl.ARRAY_BUFFER, item.data, gl.DYNAMIC_DRAW)
        item.dirty = false
      }
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.mesh.length / this.vertexFloats, item.data.length / this.instanceFloats)
    }
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    for (const item of [this.fleet, this.tracked]) {
      gl.deleteVertexArray(item.vao)
      gl.deleteBuffer(item.buffer)
      item.vao = null
      item.buffer = null
      item.dirty = true
    }
    gl.deleteBuffer(this.meshBuffer)
    gl.deleteProgram(this.program)
    this.meshBuffer = null
    this.program = null
    this.matrixLocation = null
    this.map = null
  }
}
