import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  FOCUS_KEEPS,
  FOCUS_LAYERS,
  activeFocusPeer,
  applyFocusMode,
  applyKeptOnHandoff,
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
    publicHousing: false,
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
    setPublicHousing: on => { calls.publicHousing = on },
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
    expect(focusSnapshotKey('housing')).toBe('mini-macau-housing-focus-snapshot')
    expect(focusSnapshotKey('water')).toBe('mini-macau-water-focus-snapshot')
    expect(focusSnapshotKey('power')).toBe('mini-macau-power-focus-snapshot')
    expect(focusSnapshotKey('waste')).toBe('mini-macau-waste-focus-snapshot')
    expect(focusSnapshotKey('grandprix')).toBe('mini-macau-grandprix-focus-snapshot')
    expect(new Set(FOCUS_LAYERS.map(focusSnapshotKey)).size).toBe(FOCUS_LAYERS.length)
  })

  it('knows all five focus layers, in legend order', () => {
    expect([...FOCUS_LAYERS]).toEqual(['housing', 'water', 'power', 'waste', 'grandprix'])
  })
})

// The one asymmetry in the focus machinery: HOUSING leaves the schools alone.
describe('FOCUS_KEEPS — the per-layer exemptions', () => {
  it('exempts only HOUSING, and only the schools and its own switch', () => {
    expect([...FOCUS_KEEPS.housing].sort()).toEqual(['publicHousing', 'schools'])
    for (const layer of FOCUS_LAYERS) {
      if (layer !== 'housing') expect(FOCUS_KEEPS[layer].size).toBe(0)
    }
  })

  it('names a key for every focus layer, so a new layer cannot be forgotten', () => {
    expect(Object.keys(FOCUS_KEEPS).sort()).toEqual([...FOCUS_LAYERS].sort())
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

describe('activeFocusPeer — the five focus layers are mutually exclusive', () => {
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
      publicHousing: false,
      toilets: false,
      carParks: false,
    })
  })
})

describe('applyFocusMode — HOUSING keeps the schools', () => {
  it('hides every peer but never touches schools or the housing switch', () => {
    const { apply, calls } = recorder()
    applyFocusMode(apply, 'housing')
    expect(calls).toEqual({
      lrt: [],
      bus: { routeIds: [], auto: false },
      flights: false,
      ferries: false,
      roadWorks: false,
      toilets: false,
      carParks: false,
    })
    // Neither setter was called at all — the user's schools stay exactly as
    // they are, and the layer does not switch itself off on the way in.
    expect('schools' in calls).toBe(false)
    expect('publicHousing' in calls).toBe(false)
  })

  it('still hides everything for the layers that keep nothing', () => {
    for (const layer of FOCUS_LAYERS.filter(l => l !== 'housing')) {
      const { apply, calls } = recorder()
      applyFocusMode(apply, layer)
      expect(calls.schools).toBe(false)
      expect(calls.publicHousing).toBe(false)
    }
  })

  // The handoff case: HOUSING is on, the user turns WATER on. Water keeps
  // nothing, so this is where the schools DO go off — housing's exemption is
  // housing's alone, and every other focus mode still empties the city.
  it('hides the schools when a peer takes the focus over from HOUSING', () => {
    const { apply, calls } = recorder()
    applyFocusMode(apply, 'water')
    expect(calls.schools).toBe(false)
    expect(calls.publicHousing).toBe(false)
  })
})

// The other direction of the handoff: WATER is on (schools hidden by it), the
// user turns HOUSING on. Housing inherits water's snapshot and, because it
// does not hide schools itself, gives them back from that snapshot at once —
// and only them: everything water hid stays hidden, and housing's own switch
// is App's to flip.
describe('applyKeptOnHandoff', () => {
  it('restores just the exempt layers from the inherited snapshot for HOUSING', () => {
    const { apply, calls } = recorder()
    applyKeptOnHandoff(state({ schools: true, roadWorks: true, publicHousing: false }), apply, 'housing')
    expect(calls).toEqual({ schools: true })
  })

  it('restores the exempt layer to OFF when that is what the snapshot holds', () => {
    const { apply, calls } = recorder()
    applyKeptOnHandoff(state({ schools: false }), apply, 'housing')
    expect(calls).toEqual({ schools: false })
  })

  it('touches nothing for the layers that keep nothing', () => {
    for (const layer of FOCUS_LAYERS.filter(l => l !== 'housing')) {
      const { apply, calls } = recorder()
      applyKeptOnHandoff(state({ schools: true }), apply, layer)
      expect(calls).toEqual({})
    }
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

  // Ending HOUSING focus restores everything it hid, and NOTHING it didn't:
  // the snapshot's `schools: true` is not replayed, because the user may have
  // switched the schools off (or on) while the focus mode was running.
  it('leaves an exempt layer as the user has it NOW, not as the snapshot has it', () => {
    const { apply, calls } = recorder()
    applyLayerSnapshot(state({ schools: true, publicHousing: true, roadWorks: true }), apply, 'housing')
    expect('schools' in calls).toBe(false)
    expect('publicHousing' in calls).toBe(false)
    expect(calls.roadWorks).toBe(true)
    expect(calls.lrt).toEqual(['lrt-taipa'])
  })

  it('replays the schools for the layers that keep nothing', () => {
    const { apply, calls } = recorder()
    applyLayerSnapshot(state({ schools: true }), apply, 'water')
    expect(calls.schools).toBe(true)
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
      roadWorks: false, schools: false, publicHousing: false, toilets: false, carParks: false,
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
