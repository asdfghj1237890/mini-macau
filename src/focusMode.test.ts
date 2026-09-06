import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  FOCUS_LAYERS,
  activeFocusPeer,
  applyFocusMode,
  applyLayerSnapshot,
  captureLayerSnapshot,
  focusHandoffSnapshot,
  focusSnapshotKey,
  loadFocusSnapshot,
  saveFocusSnapshot,
  type FocusLayer,
  type FocusPeer,
  type LayerVisibilityApply,
  type LayerVisibilityState,
} from './focusMode'

function state(over: Partial<LayerVisibilityState> = {}): LayerVisibilityState {
  return {
    lrt: ['lrt-taipa'],
    busAuto: false,
    busRoutes: ['26A', '25'],
    flights: true,
    ferries: true,
    roadWorks: true,
    schools: false,
    toilets: false,
    carParks: false,
    ...over,
  }
}

// A recorder standing in for App's React setters, so every assertion below is
// about what the focus mode ASKS FOR rather than about React.
function recorder() {
  const calls: Record<string, unknown> = {}
  const apply: LayerVisibilityApply = {
    setLrt: ids => { calls.lrt = ids },
    setBus: (routeIds, auto) => { calls.bus = { routeIds, auto } },
    setFlights: on => { calls.flights = on },
    setFerries: on => { calls.ferries = on },
    setRoadWorks: on => { calls.roadWorks = on },
    setSchools: on => { calls.schools = on },
    setToilets: on => { calls.toilets = on },
    setCarParks: on => { calls.carParks = on },
  }
  return { apply, calls }
}

// The tests run in the plain node environment, so localStorage is stubbed the
// same way water.test.ts stubs it rather than pulled in with jsdom.
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
  return store
}

afterEach(() => { vi.unstubAllGlobals() })

describe('focusSnapshotKey', () => {
  it('gives each focus layer its own key, so no two ever read each other', () => {
    expect(focusSnapshotKey('water')).toBe('mini-macau-water-focus-snapshot')
    expect(focusSnapshotKey('power')).toBe('mini-macau-power-focus-snapshot')
    expect(focusSnapshotKey('waste')).toBe('mini-macau-waste-focus-snapshot')
    expect(focusSnapshotKey('grandprix')).toBe('mini-macau-grandprix-focus-snapshot')
    expect(new Set(FOCUS_LAYERS.map(focusSnapshotKey)).size).toBe(FOCUS_LAYERS.length)
  })

  it('knows all four focus layers, in legend order', () => {
    expect([...FOCUS_LAYERS]).toEqual(['water', 'power', 'waste', 'grandprix'])
  })
})

// WASTE is a focus layer, NOT one of the layers a focus mode hides — the
// snapshot must not carry it, or turning WATER on would try to restore a
// "waste: false" that WATER itself set.
describe('the snapshot covers only the non-focus layers', () => {
  it('has no `waste` key, and applyFocusMode never sets one', () => {
    const snap = captureLayerSnapshot(state()) as unknown as Record<string, unknown>
    expect('waste' in snap).toBe(false)
    const { apply, calls } = recorder()
    applyFocusMode(apply)
    expect('waste' in calls).toBe(false)
  })
})

describe('activeFocusPeer — the three focus layers are mutually exclusive', () => {
  const peer = (layer: FocusLayer, on: boolean): FocusPeer =>
    ({ layer, on, snapshot: on ? state({ flights: true }) : null })

  it('is null when no other focus layer is on', () => {
    expect(activeFocusPeer([peer('water', false), peer('power', false)])).toBeNull()
    expect(activeFocusPeer([])).toBeNull()
  })

  it('names the one that is on, whichever of the four it is', () => {
    expect(activeFocusPeer([peer('water', false), peer('power', true)])?.layer).toBe('power')
    expect(activeFocusPeer([peer('power', false), peer('waste', true)])?.layer).toBe('waste')
    expect(activeFocusPeer([peer('waste', false), peer('water', true)])?.layer).toBe('water')
    expect(activeFocusPeer([peer('water', false), peer('grandprix', true)])?.layer).toBe('grandprix')
  })

  it('resolves a corrupted "two are on" state in FOCUS_LAYERS order rather than guessing', () => {
    expect(activeFocusPeer([peer('waste', true), peer('water', true)])?.layer).toBe('water')
    expect(activeFocusPeer([peer('waste', true), peer('power', true)])?.layer).toBe('power')
    expect(activeFocusPeer([peer('grandprix', true), peer('waste', true)])?.layer).toBe('waste')
  })

  it('carries the snapshot the incoming layer must inherit', () => {
    const found = activeFocusPeer([peer('water', false), peer('waste', true)])
    expect(focusHandoffSnapshot(state({ flights: false }), found?.snapshot ?? null, !!found))
      .toEqual(captureLayerSnapshot(state({ flights: true })))
  })
})

describe('captureLayerSnapshot', () => {
  it('copies the arrays so a later mutation cannot rewrite history', () => {
    const live = state()
    const snap = captureLayerSnapshot(live)
    live.lrt.push('lrt-seac-pai-van')
    live.busRoutes.length = 0
    expect(snap.lrt).toEqual(['lrt-taipa'])
    expect(snap.busRoutes).toEqual(['26A', '25'])
  })

  it('drops the route list in auto mode — it is derived from the clock', () => {
    expect(captureLayerSnapshot(state({ busAuto: true })).busRoutes).toEqual([])
  })

  it('normalises every flag to a real boolean', () => {
    const loose = { ...state(), flights: 1, schools: undefined } as unknown as LayerVisibilityState
    const snap = captureLayerSnapshot(loose)
    expect(snap.flights).toBe(true)
    expect(snap.schools).toBe(false)
  })
})

describe('applyFocusMode', () => {
  it('turns every layer off, and takes the buses OUT of auto', () => {
    const { apply, calls } = recorder()
    applyFocusMode(apply)
    expect(calls).toEqual({
      lrt: [],
      // Leaving auto on would let the next clock tick refill the map behind
      // the focus mode — that is the whole reason both facts move together.
      bus: { routeIds: [], auto: false },
      flights: false,
      ferries: false,
      roadWorks: false,
      schools: false,
      toilets: false,
      carParks: false,
    })
  })
})

describe('applyLayerSnapshot', () => {
  it('puts an explicit route selection back exactly', () => {
    const { apply, calls } = recorder()
    applyLayerSnapshot(state({ flights: false, toilets: true }), apply)
    expect(calls.lrt).toEqual(['lrt-taipa'])
    expect(calls.bus).toEqual({ routeIds: ['26A', '25'], auto: false })
    expect(calls.flights).toBe(false)
    expect(calls.toilets).toBe(true)
  })

  it('re-enters auto mode with no routes, so the clock repopulates them', () => {
    const { apply, calls } = recorder()
    applyLayerSnapshot(captureLayerSnapshot(state({ busAuto: true })), apply)
    expect(calls.bus).toEqual({ routeIds: [], auto: true })
  })
})

describe('load / saveFocusSnapshot', () => {
  it('round-trips a snapshot per layer, isolated from the other layer', () => {
    const store = stubStorage()
    const water = state({ lrt: ['lrt-taipa'], flights: true })
    const power = state({ lrt: [], flights: false, carParks: true })
    saveFocusSnapshot('water', water)
    saveFocusSnapshot('power', power)
    expect(store.has(focusSnapshotKey('water'))).toBe(true)
    expect(store.has(focusSnapshotKey('power'))).toBe(true)
    expect(loadFocusSnapshot('water')).toEqual(captureLayerSnapshot(water))
    expect(loadFocusSnapshot('power')).toEqual(captureLayerSnapshot(power))
  })

  it('forgets only the layer it is told to forget', () => {
    const store = stubStorage()
    saveFocusSnapshot('water', state())
    saveFocusSnapshot('power', state())
    saveFocusSnapshot('power', null)
    expect(store.has(focusSnapshotKey('power'))).toBe(false)
    expect(loadFocusSnapshot('power')).toBeNull()
    expect(loadFocusSnapshot('water')).not.toBeNull()
  })

  it('returns null for nothing stored, bad JSON, or a non-object', () => {
    stubStorage()
    expect(loadFocusSnapshot('power')).toBeNull()
    stubStorage({ [focusSnapshotKey('power')]: '{not json' })
    expect(loadFocusSnapshot('power')).toBeNull()
    stubStorage({ [focusSnapshotKey('power')]: '"a string"' })
    expect(loadFocusSnapshot('power')).toBeNull()
    stubStorage({ [focusSnapshotKey('power')]: '[1,2,3]' })
    expect(loadFocusSnapshot('power')).toBeNull()
    stubStorage({ [focusSnapshotKey('power')]: 'null' })
    expect(loadFocusSnapshot('power')).toBeNull()
  })

  it('coerces a half-written object rather than throwing', () => {
    stubStorage({
      [focusSnapshotKey('power')]:
        JSON.stringify({ lrt: ['a', 7, null], busRoutes: 'nope', flights: 'yes' }),
    })
    expect(loadFocusSnapshot('power')).toEqual({
      lrt: ['a'], busAuto: false, busRoutes: [], flights: false, ferries: false,
      roadWorks: false, schools: false, toilets: false, carParks: false,
    })
  })

  it('never lets a throwing storage break the toggle', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    expect(() => saveFocusSnapshot('power', state())).not.toThrow()
    expect(() => saveFocusSnapshot('power', null)).not.toThrow()
    expect(loadFocusSnapshot('power')).toBeNull()
  })
})

describe('focusHandoffSnapshot — WATER and POWER are mutually exclusive', () => {
  it('remembers the live state when no other focus was on', () => {
    const live = state()
    expect(focusHandoffSnapshot(live, null, false)).toEqual(captureLayerSnapshot(live))
  })

  it('ignores the other layer’s snapshot when that layer was not focused', () => {
    const live = state({ flights: true })
    const stale = state({ flights: false, schools: true })
    expect(focusHandoffSnapshot(live, stale, false).flights).toBe(true)
  })

  it('carries the other layer’s snapshot over when it WAS focused', () => {
    // While the other layer is focused the live switches all read "off", so
    // the pre-focus map only exists in that layer's snapshot — taking the live
    // state here would silently lose it.
    const live = state({ lrt: [], busAuto: false, busRoutes: [], flights: false, ferries: false, roadWorks: false })
    const other = state({ lrt: ['lrt-taipa'], flights: true, roadWorks: true })
    expect(focusHandoffSnapshot(live, other, true)).toEqual(captureLayerSnapshot(other))
  })

  it('falls back to the live state when the other snapshot is missing', () => {
    // A reload with the other layer on and its storage cleared: "restore" would
    // have left the map exactly as it is, so that is what gets remembered.
    const live = state({ lrt: [], flights: false })
    expect(focusHandoffSnapshot(live, null, true)).toEqual(captureLayerSnapshot(live))
  })

  it('copies rather than aliases the snapshot it hands over', () => {
    const other = state()
    const handed = focusHandoffSnapshot(state(), other, true)
    other.lrt.push('mutated')
    expect(handed.lrt).toEqual(['lrt-taipa'])
  })
})
