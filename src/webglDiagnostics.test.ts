import { describe, expect, it, vi } from 'vitest'
import { describeShader, observeWebGL } from './webglDiagnostics'

function context(status: boolean | null, typeQuery: number | null = 35632) {
  const native = {
    FRAGMENT_SHADER: 35632, VERTEX_SHADER: 35633, COMPILE_STATUS: 35713, SHADER_TYPE: 35663,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(), compileShader: vi.fn(), linkProgram: vi.fn(),
    getShaderParameter: vi.fn((_shader: WebGLShader, pname: number) => pname === 35713 ? status : typeQuery),
    getShaderInfoLog: vi.fn(() => status === null ? null : 'syntax error'),
    isShader: vi.fn(() => status !== null), isContextLost: vi.fn(() => false),
  }
  return { gl: Object.create(native) as WebGL2RenderingContext, native }
}

describe('WebGL diagnostics', () => {
  it('keeps null status and the original fragment type when native type querying fails', () => {
    const { gl } = context(null, null)
    const write = vi.fn(), stat = vi.fn()
    const dispose = observeWebGL(gl, write, stat)
    const shader = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(shader, 'uniform sampler2D u_texture;in vec2 v_tex;flat in float v_total_opacity;')
    gl.compileShader(shader)
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBeNull()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toContain('SHADER FAIL fragment · compileStatus null · contextLost false')
    expect(write.mock.calls[0][0]).toContain('typeQuery null · log null')
    expect(write.mock.calls[0][0]).toContain('in[v_tex,v_total_opacity]')
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBeNull()
    expect(write).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('does not add synchronous GPU queries to a successful compilation', () => {
    const { gl, native } = context(true)
    const write = vi.fn()
    const dispose = observeWebGL(gl, write, vi.fn())
    const shader = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(shader, 'void main() {}')
    gl.compileShader(shader)
    expect(native.getShaderParameter).not.toHaveBeenCalled()
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(true)
    expect(native.getShaderParameter).toHaveBeenCalledTimes(1)
    expect(native.getShaderInfoLog).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    dispose()
  })

  it('preserves a real false compile result and compiler log', () => {
    const { gl } = context(false, 35633)
    const write = vi.fn()
    const dispose = observeWebGL(gl, write, vi.fn())
    const shader = gl.createShader(gl.VERTEX_SHADER)!
    gl.compileShader(shader)
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(false)
    expect(write.mock.calls[0][0]).toContain('SHADER FAIL vertex · compileStatus false')
    expect(write.mock.calls[0][0]).toContain('log "syntax error"')
    dispose()
  })

  it('does not invent a type for shaders created before observation', () => {
    const { gl } = context(null, null)
    const shader = gl.createShader(gl.FRAGMENT_SHADER)!
    const write = vi.fn()
    const dispose = observeWebGL(gl, write, vi.fn())
    gl.getShaderParameter(shader, gl.COMPILE_STATUS)
    expect(write.mock.calls[0][0]).toContain('SHADER FAIL unknown')
    dispose()
  })

  it('leaves null shader handles to the native API without a WeakMap exception', () => {
    const { gl, native } = context(null)
    native.createShader.mockReturnValue(null as unknown as object)
    const dispose = observeWebGL(gl, vi.fn(), vi.fn())
    const shader = gl.createShader(gl.FRAGMENT_SHADER)!
    expect(() => gl.shaderSource(shader, 'void main() {}')).not.toThrow()
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBeNull()
    dispose()
  })

  it('restores inherited and owned methods and never patches other contexts', () => {
    const { gl, native } = context(true)
    const originalCompile = vi.fn()
    gl.compileShader = originalCompile
    const other = Object.create(native) as WebGL2RenderingContext
    const dispose = observeWebGL(gl, vi.fn(), vi.fn())
    expect(gl.compileShader).not.toBe(originalCompile)
    expect(other.compileShader).toBe(native.compileShader)
    dispose()
    expect(gl.compileShader).toBe(originalCompile)
    expect(Object.hasOwn(gl, 'createShader')).toBe(false)
  })

  it('recognises compact GLSL and qualified input declarations', () => {
    expect(describeShader('uniform highp sampler2D u_tex;in vec2 v_tex;flat in lowp float v_opacity;'))
      .toContain('uniforms[u_tex] in[v_tex,v_opacity]')
  })

  it('undoes partial installation if the browser forbids overriding a method', () => {
    const { gl, native } = context(true)
    Object.defineProperty(gl, 'compileShader', { configurable: false, value: native.compileShader })
    expect(() => observeWebGL(gl, vi.fn(), vi.fn())).toThrow()
    expect(Object.hasOwn(gl, 'createShader')).toBe(false)
    expect(Object.hasOwn(gl, 'shaderSource')).toBe(false)
    expect(gl.compileShader).toBe(native.compileShader)
  })
})
