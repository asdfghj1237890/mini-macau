// FOCUS MODES — the shared machinery behind HOUSING, WATER and POWER.
//
// A focus layer is not just another overlay: switching it on clears every other
// layer so its network is read against an empty city, and switching it off puts
// the map back exactly as it was. The snapshot is taken at the moment focus
// starts and wins on restore even if the user poked other switches meanwhile,
// so the two states can never drift apart.
//
// All five overlays (HOUSING, WATER, POWER, WASTE, GRAND PRIX) behave
// identically, so the capture / apply / persist half lives here exactly once
// and each overlay only supplies its own storage key. App owns the React
// setters and passes them in, which is what makes this testable without a DOM.
// (src/water.ts re-exports these under its historical names.)
//
// The five are MUTUALLY EXCLUSIVE: turning one on turns whichever other one is
// on off and hands its snapshot over — see `activeFocusPeer` and
// `focusHandoffSnapshot`.
//
// One layer takes an EXEMPTION: HOUSING leaves the schools alone, because the
// two overlays are read together (which estates sit in which catchment) and
// their colour families were chosen not to collide. That is the whole job of
// FOCUS_KEEPS below — every other focus layer keeps nothing.

// Which focus layer a snapshot belongs to. Each gets its own storage key, so
// no two can ever read each other's history.
export type FocusLayer = 'housing' | 'water' | 'power' | 'waste' | 'grandprix'

// All five, in the order they appear in the CITY legend (HOUSING sits between
// SCHOOLS and WC, above the four utility/circuit rows). Exported so a caller
// can ask "which OTHER focus layer is on?" without hard-coding the list.
export const FOCUS_LAYERS: readonly FocusLayer[] = ['housing', 'water', 'power', 'waste', 'grandprix'] as const

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
  publicHousing: boolean // ditto: the per-type set is left alone
  toilets: boolean
  carParks: boolean
  parishes: boolean // the parish tint is context, but it is still a layer: focus hides it
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
  setPublicHousing: (on: boolean) => void
  setToilets: (on: boolean) => void
  setCarParks: (on: boolean) => void
  setParishes: (on: boolean) => void
}

// Which layers a focus mode leaves ALONE — neither hidden on the way in nor
// restored on the way out, so the user keeps whatever they had. HOUSING is the
// only layer with entries:
//   • `schools`, because housing and schools are read together and their
//     colour families are deliberately disjoint (see src/schools.ts);
//   • `publicHousing`, because that flag IS the housing focus switch — hiding
//     it here would switch the focus off in the act of switching it on.
// Naming a key here means "never touch this setter for this layer". `lrt` and
// `busRoutes` stand for the two vehicle setters; no layer keeps them today.
export const FOCUS_KEEPS: Record<FocusLayer, ReadonlySet<keyof LayerVisibilityState>> = {
  housing: new Set(['schools', 'publicHousing']),
  water: new Set(),
  power: new Set(),
  waste: new Set(),
  grandprix: new Set(),
}

const NO_KEEPS: ReadonlySet<keyof LayerVisibilityState> = new Set()

// The exemptions for a layer. `undefined` — the historical one-argument call,
// and what src/water.ts's `applyWaterFocus` alias still uses — means "hide or
// restore everything", which is exactly right for the four layers that keep
// nothing.
function focusKeeps(layer: FocusLayer | undefined): ReadonlySet<keyof LayerVisibilityState> {
  return layer ? FOCUS_KEEPS[layer] : NO_KEEPS
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
    publicHousing: !!state.publicHousing,
    toilets: !!state.toilets,
    carParks: !!state.carParks,
    parishes: !!state.parishes,
  }
}

// Everything off, minus the incoming layer's exemptions. Buses go to "no
// routes AND not auto" deliberately: leaving auto on would let the next clock
// tick refill the map behind the focus mode.
export function applyFocusMode(apply: LayerVisibilityApply, layer?: FocusLayer): void {
  const keep = focusKeeps(layer)
  if (!keep.has('lrt')) apply.setLrt([])
  if (!keep.has('busRoutes')) apply.setBus([], false)
  if (!keep.has('flights')) apply.setFlights(false)
  if (!keep.has('ferries')) apply.setFerries(false)
  if (!keep.has('roadWorks')) apply.setRoadWorks(false)
  if (!keep.has('schools')) apply.setSchools(false)
  if (!keep.has('publicHousing')) apply.setPublicHousing(false)
  if (!keep.has('toilets')) apply.setToilets(false)
  if (!keep.has('carParks')) apply.setCarParks(false)
  if (!keep.has('parishes')) apply.setParishes(false)
}

// Put the snapshot back, exactly — except for the layers the focus mode never
// touched. An exempt layer was left as the user had it on the way in and is
// left as the user has it NOW on the way out; restoring it from the snapshot
// would undo edits the focus mode never made.
export function applyLayerSnapshot(
  snapshot: LayerVisibilityState,
  apply: LayerVisibilityApply,
  layer?: FocusLayer,
): void {
  const keep = focusKeeps(layer)
  if (!keep.has('lrt')) apply.setLrt(snapshot.lrt)
  if (!keep.has('busRoutes')) apply.setBus(snapshot.busAuto ? [] : snapshot.busRoutes, snapshot.busAuto)
  if (!keep.has('flights')) apply.setFlights(snapshot.flights)
  if (!keep.has('ferries')) apply.setFerries(snapshot.ferries)
  if (!keep.has('roadWorks')) apply.setRoadWorks(snapshot.roadWorks)
  if (!keep.has('schools')) apply.setSchools(snapshot.schools)
  if (!keep.has('publicHousing')) apply.setPublicHousing(snapshot.publicHousing)
  if (!keep.has('toilets')) apply.setToilets(snapshot.toilets)
  if (!keep.has('carParks')) apply.setCarParks(snapshot.carParks)
  if (!keep.has('parishes')) apply.setParishes(snapshot.parishes)
}

// The handoff case. When focus passes from one layer to another (WATER on →
// user switches HOUSING on) the incoming layer inherits the outgoing one's
// snapshot, and the layers the incoming mode does NOT hide were hidden by the
// outgoing one. They come back now, from that snapshot: the user asked for
// housing, not for the schools that water had switched off. Only the exempt
// keys are touched — everything else stays hidden — and the incoming layer's
// own switch (`publicHousing` for HOUSING) is the caller's to set.
export function applyKeptOnHandoff(
  snapshot: LayerVisibilityState,
  apply: LayerVisibilityApply,
  layer: FocusLayer,
): void {
  const keep = focusKeeps(layer)
  if (keep.has('lrt')) apply.setLrt(snapshot.lrt)
  if (keep.has('busRoutes')) apply.setBus(snapshot.busAuto ? [] : snapshot.busRoutes, snapshot.busAuto)
  if (keep.has('flights')) apply.setFlights(snapshot.flights)
  if (keep.has('ferries')) apply.setFerries(snapshot.ferries)
  if (keep.has('roadWorks')) apply.setRoadWorks(snapshot.roadWorks)
  if (keep.has('schools')) apply.setSchools(snapshot.schools)
  if (keep.has('toilets')) apply.setToilets(snapshot.toilets)
  if (keep.has('carParks')) apply.setCarParks(snapshot.carParks)
  if (keep.has('parishes')) apply.setParishes(snapshot.parishes)
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
      publicHousing: o.publicHousing === true,
      toilets: o.toilets === true,
      carParks: o.carParks === true,
      parishes: o.parishes === true,
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
