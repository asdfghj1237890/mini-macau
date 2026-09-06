// A debug overlay for phones. A phone has no console, and a map that fails
// on one device but not another (an iPhone X on iOS 16 against an iPhone 15)
// is only ever diagnosed from what that device says — so `?debug=1` (or
// localStorage `mini-macau-debug` = '1') pins a panel to the bottom of the
// page that lists what the browser can do and every error as it happens.
// Off by default; without the switch this installs nothing.

const LS_KEY = 'mini-macau-debug'
const LOG_KEY = 'mini-macau-debug-log'
const MAX_LINES = 80

function enabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('debug') === '1') return true
    return localStorage.getItem(LS_KEY) === '1'
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
  return `webgl2 ${gl2 ? 'yes' : 'NO'} · webgl1 ${gl1 ? 'yes' : 'no'} · renderer ${renderer}`
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
  const write = (line: string) => {
    lines.push(`${new Date().toISOString().slice(11, 23)} ${line}`)
    if (lines.length > MAX_LINES) lines.shift()
    box.textContent = [...previous, ...lines].join('\n')
    try { localStorage.setItem(LOG_KEY, JSON.stringify(lines)) } catch { /* private mode or quota */ }
  }
  const mount = () => {
    if (box.isConnected) return
    if (document.body) document.body.appendChild(box)
    else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(box), { once: true })
  }

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
  mount()
}
