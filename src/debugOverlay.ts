// A debug overlay for phones. A phone has no console, and a map that fails
// on one device but not another (an iPhone X on iOS 16 against an iPhone 15)
// is only ever diagnosed from what that device says — so `?debug=1` (or
// localStorage `mini-macau-debug` = '1') pins a panel to the bottom of the
// page that lists what the browser can do and every error as it happens.
// Off by default; without the switch this installs nothing and the exported
// `debugLog` / `debugStat` are no-ops.

const LS_KEY = 'mini-macau-debug'
const LOG_KEY = 'mini-macau-debug-log'
const MAX_LINES = 80
const HEARTBEAT_MS = 3000

let sink: ((line: string) => void) | null = null
const stats: Record<string, string | number> = {}

// True once the overlay is installed — callers can skip work whose only
// purpose is feeding it.
export function debugEnabled(): boolean {
  return sink !== null
}

// A milestone line ("[map] first frame"); dropped when the overlay is off.
export function debugLog(line: string): void {
  sink?.(line)
}

// A live figure the heartbeat line repeats every few seconds (tile count,
// pixel ratio), so a page that dies without an error still says how far it
// got and when.
export function debugStat(key: string, value: string | number): void {
  stats[key] = value
}

function enabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('debug') === '1') return true
    return localStorage.getItem(LS_KEY) === '1'
  } catch {
    return false
  }
}

// `?debug=1&nowebgl2=1` pretends the device has no WebGL 2, so the map's
// failure path can be seen on a machine that does have it.
function simulateNoWebgl2(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('nowebgl2') === '1'
  } catch {
    return false
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value).slice(0, 300)
  } catch {
    return String(value)
  }
}

function webglReport(): string {
  // Two canvases: a canvas that already holds a WebGL 2 context answers null
  // to a WebGL 1 request, which would misreport WebGL 1 as missing.
  let gl2: WebGL2RenderingContext | null = null
  let gl1: WebGLRenderingContext | null = null
  try { gl2 = document.createElement('canvas').getContext('webgl2') } catch { gl2 = null }
  try { gl1 = document.createElement('canvas').getContext('webgl') } catch { gl1 = null }
  let renderer = 'none'
  const gl = gl2 ?? gl1
  if (gl) {
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    } catch {
      renderer = '?'
    }
  }
  let limits = ''
  if (gl2) {
    try {
      limits = ` · maxTex ${gl2.getParameter(gl2.MAX_TEXTURE_SIZE)} · varyings ${gl2.getParameter(gl2.MAX_VARYING_VECTORS)}` +
        ` · fragUniforms ${gl2.getParameter(gl2.MAX_FRAGMENT_UNIFORM_VECTORS)} · vertUniforms ${gl2.getParameter(gl2.MAX_VERTEX_UNIFORM_VECTORS)}`
    } catch { limits = '' }
  }
  return `webgl2 ${gl2 ? 'yes' : 'NO'} · webgl1 ${gl1 ? 'yes' : 'no'} · renderer ${renderer}${limits}`
}

// What a shader is, from its source: MapLibre's shaders carry no name, but
// their #defines (the pragma permutation), uniforms and inputs identify them.
function describeShader(src: string): string {
  const names = (re: RegExp) => {
    const out: string[] = []
    for (const m of src.matchAll(re)) if (!out.includes(m[1])) out.push(m[1])
    return out
  }
  const defines = names(/#define\s+(\w+)/g).filter(d => !/^(highp|mediump|lowp)$/.test(d)).slice(0, 12)
  const uniforms = names(/uniform\s+(?:\w+\s+)?\w+\s+(\w+)/g).slice(0, 10)
  const inputs = names(/^\s*in\s+(?:\w+\s+)?\w+\s+(\w+)\s*;/gm).slice(0, 8)
  return `defines[${defines.join(',')}] uniforms[${uniforms.join(',')}] in[${inputs.join(',')}] len ${src.length}`
}

// Every shader MapLibre compiles goes through here; a failure is reported with
// what it was and whether the context was already lost (a null info log is
// what WebKit answers on a lost context). Only the first few failures are
// written out; the rest count in the heartbeat.
function hookShaderCompiles(write: (line: string) => void): void {
  const proto = WebGL2RenderingContext.prototype
  const sources = new WeakMap<WebGLShader, string>()
  const origSource = proto.shaderSource
  proto.shaderSource = function (this: WebGL2RenderingContext, shader: WebGLShader, source: string) {
    sources.set(shader, source)
    return origSource.call(this, shader, source)
  }
  const origCompile = proto.compileShader
  let compiled = 0
  let failed = 0
  proto.compileShader = function (this: WebGL2RenderingContext, shader: WebGLShader) {
    origCompile.call(this, shader)
    compiled++
    stats.shaders = compiled
    let ok = true
    try { ok = this.getShaderParameter(shader, this.COMPILE_STATUS) === true } catch { ok = false }
    if (ok) return
    failed++
    stats.shaderFail = failed
    if (failed > 3) return
    let type = '?'
    let log: string | null = null
    let lost = false
    try {
      type = this.getShaderParameter(shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER ? 'fragment' : 'vertex'
      log = this.getShaderInfoLog(shader)
      lost = this.isContextLost()
    } catch { /* keep what we have */ }
    write(`SHADER FAIL ${type} · contextLost ${lost} · log ${JSON.stringify(log)} · ${describeShader(sources.get(shader) ?? '')}`)
  }
  const origLink = proto.linkProgram
  let programs = 0
  proto.linkProgram = function (this: WebGL2RenderingContext, program: WebGLProgram) {
    origLink.call(this, program)
    programs++
    stats.programs = programs
  }
}

export function installDebugOverlay(): void {
  if (!enabled()) return

  if (simulateNoWebgl2()) {
    const proto = HTMLCanvasElement.prototype
    const getContext = proto.getContext
    proto.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      if (id === 'webgl2') return null
      return (getContext as (this: HTMLCanvasElement, id: string, ...args: unknown[]) => RenderingContext | null).call(this, id, ...rest)
    } as typeof proto.getContext
  }

  const box = document.createElement('pre')
  box.id = 'mm-debug'
  box.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'max-height:45vh', 'overflow:auto',
    'margin:0', 'padding:8px 10px', 'background:rgba(0,0,0,.88)', 'color:#fecaca',
    'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace', 'z-index:2147483647',
    'white-space:pre-wrap', 'word-break:break-word',
  ].join(';')

  // A page the OS kills (memory) leaves no error behind, but the log it wrote
  // before dying is still in localStorage: show the previous load's tail
  // above this one. Only this load's lines are persisted, so it never nests.
  const previous: string[] = []
  try {
    const raw = localStorage.getItem(LOG_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(arr)) {
      const tail = arr.filter((l): l is string => typeof l === 'string').slice(-30)
      if (tail.length) previous.push('--- previous page load ---', ...tail, '--- this page load ---')
    }
  } catch { /* unreadable or absent: nothing to show */ }
  const lines: string[] = []
  const stamp = () => new Date().toISOString().slice(11, 23)
  const flush = () => {
    box.textContent = [...previous, ...lines].join('\n')
    try { localStorage.setItem(LOG_KEY, JSON.stringify(lines)) } catch { /* private mode or quota */ }
  }
  // A line repeated back to back (an exception thrown every frame) collapses
  // into one line with a count, so a flood cannot evict the history above it.
  let lastText = ''
  let repeats = 0
  const write = (line: string) => {
    if (line === lastText && lines.length) {
      repeats++
      lines[lines.length - 1] = `${stamp()} ${line} ×${repeats + 1}`
    } else {
      lastText = line
      repeats = 0
      lines.push(`${stamp()} ${line}`)
      if (lines.length > MAX_LINES) lines.shift()
    }
    flush()
  }
  // The heartbeat overwrites the previous heartbeat instead of appending, so
  // it never pushes the real events out of the buffer.
  const heartbeat = (line: string) => {
    const last = lines.length - 1
    if (last >= 0 && lines[last].includes(' alive ')) lines[last] = `${stamp()} ${line}`
    else lines.push(`${stamp()} ${line}`)
    // A heartbeat is never collapsed into, and ends any run of repeats.
    lastText = ''
    repeats = 0
    flush()
  }
  const mount = () => {
    if (box.isConnected) return
    if (document.body) document.body.appendChild(box)
    else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(box), { once: true })
  }
  sink = write
  try { hookShaderCompiles(write) } catch (e) { write(`shader hook failed ${describe(e)}`) }

  const nav = navigator as Navigator & { deviceMemory?: number }
  write(`UA ${navigator.userAgent}`)
  write(`viewport ${window.innerWidth}×${window.innerHeight} dpr ${window.devicePixelRatio} mem ${nav.deviceMemory ?? '?'} GB`)
  write(webglReport())
  write(`OffscreenCanvas ${typeof OffscreenCanvas !== 'undefined' ? 'yes' : 'no'} · createImageBitmap ${typeof createImageBitmap === 'function' ? 'yes' : 'no'} · VideoFrame ${typeof VideoFrame !== 'undefined' ? 'yes' : 'no'}`)
  // MapLibre 6 runs its worker as an ES module; prove the browser can start one.
  try {
    const url = URL.createObjectURL(new Blob(['self.postMessage("ok")'], { type: 'text/javascript' }))
    const worker = new Worker(url, { type: 'module' })
    worker.onmessage = () => { write('module worker yes'); worker.terminate() }
    worker.onerror = e => { write(`module worker ERROR ${e.message}`); worker.terminate() }
  } catch (e) {
    write(`module worker THREW ${describe(e)}`)
  }

  window.addEventListener('error', e => {
    write(`error ${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`)
  })
  window.addEventListener('unhandledrejection', e => {
    write(`unhandled ${describe(e.reason)}`)
  })
  const origError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    write(`console.error ${args.map(describe).join(' ')}`)
    origError(...args)
  }
  const origWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    write(`warn ${args.map(describe).join(' ')}`)
    origWarn(...args)
  }
  // A load that ends in a crash has no pagehide; one the user navigated away
  // from does — the difference tells a kill from a plain exit.
  document.addEventListener('visibilitychange', () => write(`visibility ${document.visibilityState}`))
  window.addEventListener('pagehide', () => write('pagehide'))
  const started = performance.now()
  window.setInterval(() => {
    const extra = Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(' · ')
    heartbeat(`alive ${Math.round((performance.now() - started) / 1000)}s${extra ? ` · ${extra}` : ''}`)
  }, HEARTBEAT_MS)
  mount()
}
