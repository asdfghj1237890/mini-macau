import { observeWebGL, reportWebGL } from './webglDiagnostics'

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
const MAX_PINNED = 5
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

// The switch itself (URL or localStorage), for code that follows it without
// the overlay being installed — the thank-you page has no overlay, and the
// analytics module stamps GA4 events with `debug_mode` from it.
export function debugSwitchOn(): boolean {
  return enabled()
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

// Called with the context already owned by MapLibre; no probe GPU contexts.
export function attachMapDebug(gl: WebGL2RenderingContext): () => void {
  if (!sink) return () => {}
  debugStat('shaders', 0)
  debugStat('programs', 0)
  debugStat('shaderFail', 0)
  debugStat('lost', 'unknown')
  sink(reportWebGL(gl))
  try { return observeWebGL(gl, debugLog, debugStat) }
  catch (error) {
    debugLog(`shader observation unavailable: ${describe(error)}`)
    return () => {}
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

  // The panel: a scrolling log on top and, pinned under it, the few lines
  // that decide a diagnosis (a failed shader, a lost context) — so a photo of
  // the panel's bottom edge always carries them, however long the log gets.
  const box = document.createElement('div')
  box.id = 'mm-debug'
  box.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'max-height:45vh',
    'display:flex', 'flex-direction:column', 'background:rgba(0,0,0,.88)', 'color:#fecaca',
    'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace', 'z-index:2147483647',
  ].join(';')
  const logEl = document.createElement('pre')
  logEl.style.cssText = 'margin:0;padding:8px 10px;overflow:auto;flex:1 1 auto;min-height:0;white-space:pre-wrap;word-break:break-word'
  const pinEl = document.createElement('pre')
  pinEl.style.cssText = 'margin:0;padding:6px 10px;flex:0 0 auto;white-space:pre-wrap;word-break:break-word;background:rgba(127,29,29,.6);color:#fee2e2;border-top:1px solid rgba(254,202,202,.4)'
  pinEl.hidden = true
  box.append(logEl, pinEl)

  // A page the OS kills (memory) leaves no error behind, but the log it wrote
  // before dying is still in localStorage: show the previous load's tail
  // above this one. Only this load's lines are persisted, so it never nests.
  const previous: string[] = []
  try {
    const raw = localStorage.getItem(LOG_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const saved = Array.isArray(parsed) ? { lines: parsed, pinned: [] } : (parsed as { lines?: unknown; pinned?: unknown } | null)
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((l): l is string => typeof l === 'string') : [])
    const tail = strings(saved?.lines).slice(-30)
    const pins = strings(saved?.pinned)
    if (tail.length || pins.length) {
      previous.push('--- previous page load ---', ...pins.map(p => `PINNED ${p}`), ...tail, '--- this page load ---')
    }
  } catch { /* unreadable or absent: nothing to show */ }
  const lines: string[] = []
  const pinned: string[] = []
  const stamp = () => new Date().toISOString().slice(11, 23)
  const flush = () => {
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40
    logEl.textContent = [...previous, ...lines].join('\n')
    if (nearBottom) logEl.scrollTop = logEl.scrollHeight
    pinEl.hidden = pinned.length === 0
    pinEl.textContent = pinned.join('\n')
    try { localStorage.setItem(LOG_KEY, JSON.stringify({ lines, pinned })) } catch { /* private mode or quota */ }
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
      if (pinned.length < MAX_PINNED && /SHADER FAIL|webglcontextlost|GPUInitializationError|Program failed to link/.test(line)) {
        pinned.push(`${stamp()} ${line}`)
      }
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


  const nav = navigator as Navigator & { deviceMemory?: number }
  write(`UA ${navigator.userAgent}`)
  write(`viewport ${window.innerWidth}×${window.innerHeight} dpr ${window.devicePixelRatio} mem ${nav.deviceMemory ?? '?'} GB`)
  write('webgl2 waiting for map context')
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
