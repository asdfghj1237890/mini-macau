// FOCUS MODES — the shared machinery behind WATER and POWER.
//
// A focus layer is not just another overlay: switching it on clears every other
// layer so its network is read against an empty city, and switching it off puts
// the map back exactly as it was. The snapshot is taken at the moment focus
// starts and wins on restore even if the user poked other switches meanwhile,
// so the two states can never drift apart.
//
// All four overlays (WATER, POWER, WASTE, GRAND PRIX) behave identically, so
// the capture / apply / persist half lives here exactly once and each overlay
// only supplies its own storage key. App owns the React setters and passes
// them in, which is what makes this testable without a DOM. (src/water.ts
// re-exports these under its historical names.)
//
// The four are MUTUALLY EXCLUSIVE: turning one on turns whichever other one is
// on off and hands its snapshot over — see `activeFocusPeer` and
// `focusHandoffSnapshot`.

// Which focus layer a snapshot belongs to. Each gets its own storage key, so
// no two can ever read each other's history.
export type FocusLayer = 'water' | 'power' | 'waste' | 'grandprix'

// All four, in the order they appear in the CITY legend. Exported so a caller
// can ask "which OTHER focus layer is on?" without hard-coding the list.
export const FOCUS_LAYERS: readonly FocusLayer[] = ['water', 'power', 'waste', 'grandprix'] as const

// Everything the focus mode has to put back. Bus visibility is TWO facts, not
// one: `busAuto` records that the user was in auto-by-time mode, so restoring
// re-enters auto (and lets the clock repopulate the routes) instead of pinning
// whatever happened to be in service at snapshot time.
export interface LayerVisibilityState {
  lrt: string[] // LRT line ids that were switched on
  busAuto: boolean // auto-by-time mode was active
  busRoutes: string[] // explicitly visible route ids; empty when busAuto
  flights: boolean
  ferries: boolean
  roadWorks: boolean
  schools: boolean // the master switch only — per-level set is left alone
  toilets: boolean
  carParks: boolean
}

// The setters the focus mode drives. `setBus` takes both facts at once because
// the two must move together (an empty route set with auto still on would just
// be refilled by the next clock tick).
export interface LayerVisibilityApply {
  setLrt: (ids: string[]) => void
  setBus: (routeIds: string[], auto: boolean) => void
  setFlights: (on: boolean) => void
  setFerries: (on: boolean) => void
  setRoadWorks: (on: boolean) => void
  setSchools: (on: boolean) => void
  setToilets: (on: boolean) => void
  setCarParks: (on: boolean) => void
}

// Persisted so a reload while a focus layer is on can still restore later. The
// per-layer keys read "off" during focus mode — that is fine and expected: this
// snapshot is what restore reads, not those.
export function focusSnapshotKey(layer: FocusLayer): string {
  return `mini-macau-${layer}-focus-snapshot`
}

// Normalising copy of the current layer state. Arrays are copied (the caller
// passes live Sets spread into arrays) so a later mutation can't rewrite
// history, and the route list is dropped in auto mode because it is derived
// from the clock rather than chosen by the user.
export function captureLayerSnapshot(state: LayerVisibilityState): LayerVisibilityState {
  return {
    lrt: [...state.lrt],
    busAuto: !!state.busAuto,
    busRoutes: state.busAuto ? [] : [...state.busRoutes],
    flights: !!state.flights,
    ferries: !!state.ferries,
    roadWorks: !!state.roadWorks,
    schools: !!state.schools,
    toilets: !!state.toilets,
    carParks: !!state.carParks,
  }
}

// Everything off. Buses go to "no routes AND not auto" deliberately: leaving
// auto on would let the next clock tick refill the map behind the focus mode.
export function applyFocusMode(apply: LayerVisibilityApply): void {
  apply.setLrt([])
  apply.setBus([], false)
  apply.setFlights(false)
  apply.setFerries(false)
  apply.setRoadWorks(false)
  apply.setSchools(false)
  apply.setToilets(false)
  apply.setCarParks(false)
}

// Put the snapshot back, exactly.
export function applyLayerSnapshot(
  snapshot: LayerVisibilityState,
  apply: LayerVisibilityApply,
): void {
  apply.setLrt(snapshot.lrt)
  apply.setBus(snapshot.busAuto ? [] : snapshot.busRoutes, snapshot.busAuto)
  apply.setFlights(snapshot.flights)
  apply.setFerries(snapshot.ferries)
  apply.setRoadWorks(snapshot.roadWorks)
  apply.setSchools(snapshot.schools)
  apply.setToilets(snapshot.toilets)
  apply.setCarParks(snapshot.carParks)
}

// One focus layer's state as seen from another: is it on, and what would it
// restore to? App fills these in from its own refs.
export interface FocusPeer {
  layer: FocusLayer
  on: boolean
  snapshot: LayerVisibilityState | null
}

// Which OTHER focus layer is currently on. The focus layers are mutually
// exclusive, so there is at most one — and if storage was ever corrupted into
// claiming two, the FIRST in FOCUS_LAYERS order wins rather than the caller
// having to guess.
// Null means the ordinary case: no focus mode was running.
export function activeFocusPeer(peers: readonly FocusPeer[]): FocusPeer | null {
  for (const layer of FOCUS_LAYERS) {
    const peer = peers.find(p => p.layer === layer && p.on)
    if (peer) return peer
  }
  return null
}

// The focus layers are mutually exclusive, so turning one on while another
// is already focused means: end that focus (restoring its snapshot), then
// snapshot the restored map and hide it again. Composing those two literally
// would push the restore through React state and read it back on the next
// render — so this collapses them into the one fact the composition produces:
// the state the OTHER layer would have restored to is exactly what the new layer
// must remember. `live` is used when no other focus was on (the ordinary case),
// and as the honest fallback when the other layer's snapshot is missing (a
// reload with cleared storage), where "restore" would have left the map as is.
export function focusHandoffSnapshot(
  live: LayerVisibilityState,
  otherSnapshot: LayerVisibilityState | null,
  otherWasOn: boolean,
): LayerVisibilityState {
  return captureLayerSnapshot(otherWasOn ? (otherSnapshot ?? live) : live)
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// Restore the persisted snapshot. Anything unreadable, non-object or of the
// wrong shape yields null — a missing snapshot just means "restore nothing",
// which leaves the map as the user last left it rather than throwing.
export function loadFocusSnapshot(layer: FocusLayer): LayerVisibilityState | null {
  try {
    const raw = localStorage.getItem(focusSnapshotKey(layer))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const o = parsed as Record<string, unknown>
    return captureLayerSnapshot({
      lrt: stringArray(o.lrt),
      busAuto: o.busAuto === true,
      busRoutes: stringArray(o.busRoutes),
      flights: o.flights === true,
      ferries: o.ferries === true,
      roadWorks: o.roadWorks === true,
      schools: o.schools === true,
      toilets: o.toilets === true,
      carParks: o.carParks === true,
    })
  } catch {
    return null
  }
}

// Persist (or, with null, forget) the snapshot. Storage can throw in private
// mode — losing the snapshot is never worth breaking the toggle.
export function saveFocusSnapshot(
  layer: FocusLayer,
  snapshot: LayerVisibilityState | null,
): void {
  try {
    if (snapshot === null) localStorage.removeItem(focusSnapshotKey(layer))
    else localStorage.setItem(focusSnapshotKey(layer), JSON.stringify(snapshot))
  } catch { /* ignore */ }
}
