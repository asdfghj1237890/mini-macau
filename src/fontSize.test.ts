import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const saved = new Map<string, string>()
const style = { setProperty: vi.fn() }
const storage = {
  getItem: vi.fn((key: string) => saved.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => saved.set(key, value)),
}

beforeEach(() => {
  vi.resetModules()
  saved.clear()
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('document', { documentElement: { style, dataset: {} } })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('text size preference', () => {
  it('applies the saved preference on initial load and after a reload', async () => {
    const first = await import('./fontSize')
    expect(first.getFontSize()).toBe(100)
    first.setFontSize(130)
    expect(style.setProperty).toHaveBeenLastCalledWith('--mm-font-scale', '1.3')
    vi.resetModules()
    const reloaded = await import('./fontSize')
    expect(reloaded.getFontSize()).toBe(130)
    reloaded.setFontSize(100)
    expect(saved.get('mini-macau-font-size')).toBe('100')
    expect(style.setProperty).toHaveBeenLastCalledWith('--mm-font-scale', '1')
  })

  it.each(['garbage', '', 'NaN', 'Infinity'])('recovers from an invalid saved value %j', async value => {
    saved.set('mini-macau-font-size', value)
    expect((await import('./fontSize')).getFontSize()).toBe(100)
  })

  it('keeps stored and programmatic values within the supported range', async () => {
    saved.set('mini-macau-font-size', '900')
    const store = await import('./fontSize')
    expect(store.getFontSize()).toBe(150)
    store.setFontSize(-10)
    expect(store.getFontSize()).toBe(90)
    store.setFontSize(124)
    expect(store.getFontSize()).toBe(120)
  })

  it('remains usable when browser storage is blocked', async () => {
    storage.getItem.mockImplementationOnce(() => { throw new Error('Blocked') })
    const store = await import('./fontSize')
    storage.setItem.mockImplementationOnce(() => { throw new Error('Blocked') })
    expect(() => store.setFontSize(140)).not.toThrow()
    expect(store.getFontSize()).toBe(140)
    expect(style.setProperty).toHaveBeenLastCalledWith('--mm-font-scale', '1.4')
  })
})
