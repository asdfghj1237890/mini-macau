import { describe, expect, it, vi } from 'vitest'
import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'
import { AircraftModelLayer } from './AircraftModelLayer'
import { isShaderRenderError } from '../mapRecovery'
import { InstancedVehicleModelLayer } from './InstancedVehicleModelLayer'
import { createLrtMesh } from './lrtMesh'

const flight: VehiclePosition = { id: 'NX1', lineId: 'NX1', type: 'flight', coordinates: [113.57, 22.16], bearing: 90, color: '#38bdf8', progress: 0 }
const options = { defaultProjectionData: { mainMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } } as unknown as CustomRenderMethodInput

function fixture() {
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, DYNAMIC_DRAW: 7, FLOAT: 8, TRIANGLES: 9,
    DEPTH_TEST: 10, LEQUAL: 11, CULL_FACE: 12,
    createProgram: vi.fn(() => ({})), createShader: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})), createVertexArray: vi.fn(() => ({})),
    getUniformLocation: vi.fn(() => ({})), getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true), getShaderInfoLog: vi.fn(() => 'compile failure'),
    getProgramInfoLog: vi.fn(() => 'link failure'), shaderSource: vi.fn(), compileShader: vi.fn(),
    attachShader: vi.fn(), linkProgram: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(),
    bindVertexArray: vi.fn(), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    vertexAttribDivisor: vi.fn(), deleteShader: vi.fn(), deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(), deleteVertexArray: vi.fn(), useProgram: vi.fn(),
    uniformMatrix4fv: vi.fn(), enable: vi.fn(), depthFunc: vi.fn(), depthMask: vi.fn(),
    disable: vi.fn(), drawArraysInstanced: vi.fn(),
  }
  const map = { getZoom: vi.fn(() => 18), triggerRepaint: vi.fn() }
  return { gl, map, context: gl as unknown as WebGL2RenderingContext, mapInstance: map as unknown as MapLibreMap }
}

describe('instanced vehicle GPU lifecycle', () => {
  it('uploads articulated car poses with one draw and a per-vertex coupling weight', () => {
    const { gl, context, mapInstance } = fixture()
    const layer = new InstancedVehicleModelLayer({ id: 'lrt-3d-model', label: 'lrt', minZoom: 16, mesh: createLrtMesh(), groundAltitude: 7.2, articulated: true })
    layer.onAdd(mapInstance, context)
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(8, 1, gl.FLOAT, false, 44, 40)
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(6, 4, gl.FLOAT, false, 68, 36)
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(7, 4, gl.FLOAT, false, 68, 52)
    layer.setVehicles([{ ...flight, type: 'lrt' }], [{ front: [1, 0, .98, .2], rear: [1, 0, .98, -.2] }])
    layer.render(context, options)
    expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(1)
    expect(gl.drawArraysInstanced.mock.calls[0][3]).toBe(1)
    expect(gl.bufferData.mock.calls.at(-1)![1]).toHaveLength(17)
    layer.render(context, options)
    expect(gl.bufferData).toHaveBeenCalledTimes(2)
  })
  it('shares one static mesh and uploads only batches whose positions changed', () => {
    const { gl, context, mapInstance } = fixture()
    const layer = new AircraftModelLayer(15.6)
    layer.onAdd(mapInstance, context)
    expect(gl.bufferData).toHaveBeenCalledTimes(1)
    layer.setVehicles([flight, { ...flight, id: 'NX2' }])
    layer.setTrackedVehicle({ ...flight, id: 'NX3' })
    layer.render(context, options)
    expect(gl.drawArraysInstanced.mock.calls.map(call => call[3])).toEqual([2, 1])
    expect(gl.bufferData).toHaveBeenCalledTimes(3)
    layer.render(context, options)
    expect(gl.bufferData).toHaveBeenCalledTimes(3)
    layer.setTrackedVehicle({ ...flight, altitude: 800 })
    layer.render(context, options)
    expect(gl.bufferData).toHaveBeenCalledTimes(4)
  })

  it('does not draw cleared fleets or models below the zoom threshold', () => {
    const { gl, context, map, mapInstance } = fixture()
    const layer = new AircraftModelLayer(15.6)
    layer.onAdd(mapInstance, context)
    layer.setVehicles([flight])
    map.getZoom.mockReturnValue(14)
    layer.render(context, options)
    expect(gl.drawArraysInstanced).not.toHaveBeenCalled()
    map.getZoom.mockReturnValue(18)
    layer.setVehicles([])
    layer.setTrackedVehicle(null)
    layer.render(context, options)
    expect(gl.drawArraysInstanced).not.toHaveBeenCalled()
  })

  it('releases its resources on style removal and can rebuild with the same fleet', () => {
    const { gl, context, mapInstance } = fixture()
    const layer = new AircraftModelLayer(15.6)
    layer.onAdd(mapInstance, context)
    layer.setVehicles([flight])
    layer.onRemove(mapInstance, context)
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(2)
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(3)
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1)
    layer.onAdd(mapInstance, context)
    layer.render(context, options)
    expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(1)
  })

  it('cleans up failed shader creation and reports errors the map recovery recognises', () => {
    const { gl, context, mapInstance } = fixture()
    gl.getShaderParameter.mockReturnValue(false)
    const layer = new AircraftModelLayer(15.6)
    let reason = ''
    try { layer.onAdd(mapInstance, context) } catch (error) { reason = (error as Error).message }
    expect(isShaderRenderError(reason)).toBe(true)
    expect(gl.deleteShader).toHaveBeenCalledTimes(1)
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1)
    layer.render(context, options)
    expect(gl.drawArraysInstanced).not.toHaveBeenCalled()
  })
})
