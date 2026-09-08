// Observe the map's own context. Diagnostics must not allocate probe contexts,
// change shader source, or add a synchronous compile-status query to every compile.
type Log = (line: string) => void
type Stat = (key: string, value: string | number) => void

export function describeShader(source: string): string {
  const names = (re: RegExp) => [...new Set([...source.matchAll(re)].map(m => m[1]))]
  const defines = names(/#define\s+(\w+)/g).filter(d => !/^(highp|mediump|lowp)$/.test(d)).slice(0, 12)
  const uniforms = names(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)/g).slice(0, 10)
  const inputs = names(/\bin\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)\s*;/g).slice(0, 8)
  return `defines[${defines.join(',')}] uniforms[${uniforms.join(',')}] in[${inputs.join(',')}] len ${source.length}`
}

export function reportWebGL(gl: WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
    return `webgl2 yes (map context) · renderer ${renderer} · maxTex ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}` +
      ` · varyings ${gl.getParameter(gl.MAX_VARYING_VECTORS)} · fragUniforms ${gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)}` +
      ` · vertUniforms ${gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS)}`
  } catch { return 'webgl2 map context · capability query unavailable' }
}

export function observeWebGL(gl: WebGL2RenderingContext, write: Log, stat: Stat): () => void {
  const sources = new WeakMap<WebGLShader, string>()
  const types = new WeakMap<WebGLShader, number>()
  const reported = new WeakSet<WebGLShader>()
  const descriptors = new Map<keyof WebGL2RenderingContext, PropertyDescriptor | undefined>()
  const restore = () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(gl, key, descriptor)
      else Reflect.deleteProperty(gl, key)
    }
  }
  function replace<K extends keyof WebGL2RenderingContext>(key: K, value: WebGL2RenderingContext[K]) {
    const descriptor = Object.getOwnPropertyDescriptor(gl, key)
    try {
      Object.defineProperty(gl, key, { configurable: true, writable: true, value })
      descriptors.set(key, descriptor)
    } catch (error) {
      restore()
      throw error
    }
  }
  const createShader = gl.createShader
  const shaderSource = gl.shaderSource
  const compileShader = gl.compileShader
  const getShaderParameter = gl.getShaderParameter
  const linkProgram = gl.linkProgram
  let compiled = 0
  let failed = 0
  let programs = 0
  replace('createShader', function (this: WebGL2RenderingContext, type) {
    const shader = createShader.call(this, type)
    if (shader) types.set(shader, type)
    else write(`SHADER CREATE FAIL type ${type} · contextLost ${this.isContextLost()}`)
    return shader
  })
  replace('shaderSource', function (this: WebGL2RenderingContext, shader, source) {
    if (shader) sources.set(shader, source)
    return shaderSource.call(this, shader, source)
  })
  replace('compileShader', function (this: WebGL2RenderingContext, shader) {
    compileShader.call(this, shader)
    stat('shaders', ++compiled)
  })
  replace('getShaderParameter', function (this: WebGL2RenderingContext, shader, pname) {
    // Observe the query MapLibre already makes, returning exactly its result.
    const result: unknown = getShaderParameter.call(this, shader, pname)
    if (pname === this.COMPILE_STATUS && result !== true && shader && !reported.has(shader)) {
      reported.add(shader)
      stat('shaderFail', ++failed)
      if (failed <= 3) {
        const type = types.get(shader)
        const name = type === this.FRAGMENT_SHADER ? 'fragment' : type === this.VERTEX_SHADER ? 'vertex' : 'unknown'
        // A failed native query is not evidence of a lost context or a GLSL error.
        // Keep null / false distinct, and do not guess when a query throws.
        const query = (read: () => unknown) => {
          try { return JSON.stringify(read()) } catch { return 'unavailable' }
        }
        const lost = query(() => this.isContextLost())
        stat('lost', lost)
        write(`SHADER FAIL ${name} · compileStatus ${JSON.stringify(result)} · contextLost ${lost}` +
          ` · valid ${query(() => this.isShader(shader))} · typeQuery ${query(() => getShaderParameter.call(this, shader, this.SHADER_TYPE))}` +
          ` · log ${query(() => this.getShaderInfoLog(shader))} · ${describeShader(sources.get(shader) ?? '')}`)
      }
    }
    return result
  })
  replace('linkProgram', function (this: WebGL2RenderingContext, program) {
    linkProgram.call(this, program)
    stat('programs', ++programs)
  })
  return restore
}
