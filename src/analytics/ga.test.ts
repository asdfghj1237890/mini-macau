import { afterEach, describe, expect, it, vi } from 'vitest'
import { track } from './ga'

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
