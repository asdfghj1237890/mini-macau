import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'
import { AIRCRAFT_VERTEX_FLOATS, createAircraftMesh } from './aircraftMesh'

const ORIGIN = MercatorCoordinate.fromLngLat([113.57, 22.16])
const UNIT = ORIGIN.meterInMercatorCoordinateUnits()
const INSTANCE_FLOATS = 9
const MESH = createAircraftMesh()
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec4 a_material;
layout(location=3) in vec3 a_offset;
layout(location=4) in vec3 a_pose;
layout(location=5) in vec3 a_livery;
uniform mat4 u_matrix;
out vec3 v_normal;
out vec3 v_color;
void main() {
  mat3 rotation = mat3(a_pose.x, a_pose.y, 0.0, a_pose.y, -a_pose.x, 0.0, 0.0, 0.0, 1.0);
  gl_Position = u_matrix * vec4(a_offset + rotation * a_position * a_pose.z, 1.0);
  v_normal = rotation * a_normal;
  v_color = mix(a_material.rgb, a_livery, a_material.a);
}`
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_color;
out vec4 fragColor;
void main() {
  vec3 normal = normalize(v_normal);
  float key = abs(dot(normal, normalize(vec3(-0.35, -0.45, 0.82))));
  float sky = abs(normal.z);
  fragColor = vec4(v_color * (0.58 + 0.28 * key + 0.14 * sky), 1.0);
}`

export function aircraftInstances(flights: VehiclePosition[]): Float32Array {
  const values = new Float32Array(flights.length * INSTANCE_FLOATS)
  flights.forEach((flight, i) => {
    const position = MercatorCoordinate.fromLngLat(flight.coordinates, flight.altitude ?? 0)
    const angle = flight.bearing * Math.PI / 180
    const color = /^#[\da-f]{6}$/i.test(flight.color) ? Number.parseInt(flight.color.slice(1), 16) : 0x38bdf8
    values.set([
      (position.x - ORIGIN.x) / UNIT, (position.y - ORIGIN.y) / UNIT, position.z / UNIT,
      Math.cos(angle), Math.sin(angle), (flight.scale ?? 1) * position.meterInMercatorCoordinateUnits() / UNIT,
      (color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255,
    ], i * INSTANCE_FLOATS)
  })
  return values
}

type Batch = { data: Float32Array; dirty: boolean; vao: WebGLVertexArrayObject | null; buffer: WebGLBuffer | null }
const batch = (): Batch => ({ data: new Float32Array(), dirty: true, vao: null, buffer: null })

// One immutable mesh, two instanced draws (fleet + tracked aircraft). Uses the
// map's WebGL2 context and depth buffer; no texture, extra context or library.
export class AircraftModelLayer implements CustomLayerInterface {
  readonly id = 'flight-3d-model'
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

  constructor(minZoom: number) { this.minZoom = minZoom }

  setVehicles(flights: VehiclePosition[]): void {
    this.fleet.data = aircraftInstances(flights)
    this.fleet.dirty = true
    this.map?.triggerRepaint()
  }

  setTrackedVehicle(flight: VehiclePosition | null): void {
    if (!flight && this.tracked.data.length === 0) return
    this.tracked.data = aircraftInstances(flight ? [flight] : [])
    this.tracked.dirty = true
    this.map?.triggerRepaint()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map
    const shaders: WebGLShader[] = []
    try {
      this.program = gl.createProgram()
      if (!this.program) throw new Error('Could not create aircraft shader program')
      for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Could not create aircraft shader')
        shaders.push(shader)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Could not compile ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: aircraft: ${gl.getShaderInfoLog(shader)}`)
        gl.attachShader(this.program, shader)
      }
      gl.linkProgram(this.program)
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(`Program failed to link: aircraft: ${gl.getProgramInfoLog(this.program)}`)
      this.matrixLocation = gl.getUniformLocation(this.program, 'u_matrix')
      this.meshBuffer = gl.createBuffer()
      if (!this.meshBuffer) throw new Error('Could not allocate aircraft mesh')
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, MESH, gl.STATIC_DRAW)
      for (const item of [this.fleet, this.tracked]) {
        item.vao = gl.createVertexArray()
        item.buffer = gl.createBuffer()
        if (!item.vao || !item.buffer) throw new Error('Could not allocate aircraft instances')
        gl.bindVertexArray(item.vao)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer)
        for (const [index, size, offset] of [[0, 3, 0], [1, 3, 3], [2, 4, 6]]) {
          gl.enableVertexAttribArray(index)
          gl.vertexAttribPointer(index, size, gl.FLOAT, false, AIRCRAFT_VERTEX_FLOATS * 4, offset * 4)
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer)
        for (let i = 0; i < 3; i++) {
          gl.enableVertexAttribArray(i + 3)
          gl.vertexAttribPointer(i + 3, 3, gl.FLOAT, false, INSTANCE_FLOATS * 4, i * 12)
          gl.vertexAttribDivisor(i + 3, 1)
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
    // Sending absolute Mercator positions as floats makes parked planes jitter.
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
      gl.drawArraysInstanced(gl.TRIANGLES, 0, MESH.length / AIRCRAFT_VERTEX_FLOATS, item.data.length / INSTANCE_FLOATS)
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
