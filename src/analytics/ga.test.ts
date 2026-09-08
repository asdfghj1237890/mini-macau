import { afterEach, describe, expect, it, vi } from 'vitest'
import { startEngagementTracker, track } from './ga'

function stubBrowser(search: string, debugFlag: string | null, gtag?: (...args: unknown[]) => void) {
  vi.stubGlobal('window', { location: { search }, gtag })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'mini-macau-debug' ? debugFlag : null),
    setItem: () => {},
  })
}

describe('track', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the event and its parameters through gtag', () => {
    const gtag = vi.fn()
    stubBrowser('', null, gtag)
    track('layer_toggled', { layer: 'schools', enabled: true })
    expect(gtag).toHaveBeenCalledWith('event', 'layer_toggled', { layer: 'schools', enabled: true })
    track('drawer_opened')
    expect(gtag).toHaveBeenLastCalledWith('event', 'drawer_opened', {})
  })

  it('stamps debug_mode on every event while ?debug=1 or the stored switch is on', () => {
    const gtag = vi.fn()
    stubBrowser('?debug=1&install=ios-safari', null, gtag)
    track('pwa_install_prompt', { outcome: 'later', platform: 'ios-safari', source: 'card' })
    expect(gtag).toHaveBeenCalledWith('event', 'pwa_install_prompt', {
      outcome: 'later',
      platform: 'ios-safari',
      source: 'card',
      debug_mode: true,
    })
    track('drawer_opened')
    expect(gtag).toHaveBeenLastCalledWith('event', 'drawer_opened', { debug_mode: true })

    const stored = vi.fn()
    stubBrowser('', '1', stored)
    track('sim_pause_toggled', { paused: true })
    expect(stored).toHaveBeenCalledWith('event', 'sim_pause_toggled', { paused: true, debug_mode: true })
  })

  it('never throws when gtag is missing or broken', () => {
    stubBrowser('?debug=1', null, undefined)
    expect(() => track('layer_toggled', { layer: 'lrt_taipa', enabled: false })).not.toThrow()
    stubBrowser('', null, () => { throw new Error('boom') })
    expect(() => track('layer_toggled', { layer: 'lrt_taipa', enabled: false })).not.toThrow()
  })
})

/**
 * A page for the engagement tracker: window and document stubs whose timers
 * are vitest's fake ones, a settable visibility state, and the listeners the
 * tracker registered so a test can fire visibilitychange / pagehide itself.
 */
function fakePage() {
  const gtag = vi.fn()
  const docListeners = new Map<string, () => void>()
  const winListeners = new Map<string, () => void>()
  const doc = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: (type: string, fn: () => void) => { docListeners.set(type, fn) },
    removeEventListener: (type: string) => { docListeners.delete(type) },
  }
  const win = {
    location: { search: '' },
    gtag,
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: number) => clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    addEventListener: (type: string, fn: () => void) => { winListeners.set(type, fn) },
    removeEventListener: (type: string) => { winListeners.delete(type) },
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  const events = () => gtag.mock.calls.map(call => [call[1], call[2]])
  const setVisibility = (state: 'visible' | 'hidden') => {
    doc.visibilityState = state
    docListeners.get('visibilitychange')?.()
  }
  return { gtag, events, setVisibility, pagehide: () => winListeners.get('pagehide')?.() }
}

describe('startEngagementTracker visibility reporting', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not report a hide that reverts within the settle window', () => {
    vi.useFakeTimers()
    const page = fakePage()
    const stop = startEngagementTracker()
    page.setVisibility('hidden')
    vi.advanceTimersByTime(1_500)
    page.setVisibility('visible')
    vi.advanceTimersByTime(20_000)
    expect(page.events().filter(([name]) => name === 'tab_visibility_changed')).toEqual([])
    stop()
  })

  it('reports a state once it has held for the settle window, each state once', () => {
    vi.useFakeTimers()
    const page = fakePage()
    const stop = startEngagementTracker()
    page.setVisibility('hidden')
    vi.advanceTimersByTime(4_000)
    expect(page.events().filter(([name]) => name === 'tab_visibility_changed')).toEqual([])
    vi.advanceTimersByTime(1_500)
    expect(page.events().filter(([name]) => name === 'tab_visibility_changed')).toEqual([
      ['tab_visibility_changed', { hidden: true, dwell_sec: 0 }],
    ])
    // Hidden → visible → hidden inside the window: still hidden, nothing new.
    page.setVisibility('visible')
    vi.advanceTimersByTime(1_000)
    page.setVisibility('hidden')
    vi.advanceTimersByTime(6_000)
    expect(page.events().filter(([name]) => name === 'tab_visibility_changed')).toHaveLength(1)
    // A return that sticks is reported (with whatever dwell the brief
    // visible spell above accrued).
    page.setVisibility('visible')
    vi.advanceTimersByTime(6_000)
    const reports = page.events().filter(([name]) => name === 'tab_visibility_changed')
    expect(reports.map(([, params]) => (params as { hidden: boolean }).hidden)).toEqual([true, false])
    stop()
  })

  it('drops a pending visibility report on pagehide and sends session_end', () => {
    vi.useFakeTimers()
    const page = fakePage()
    const stop = startEngagementTracker()
    page.setVisibility('hidden')
    vi.advanceTimersByTime(1_000)
    page.pagehide()
    vi.advanceTimersByTime(10_000)
    expect(page.events()).toEqual([['session_end', { dwell_sec: 0, milestones_hit: 0 }]])
    stop()
  })
})
