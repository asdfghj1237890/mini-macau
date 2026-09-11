import type { TransitData } from './types'

export const CITY_LAYER_DATASETS = {
  parishes: ['parishes'],
  works: ['works'],
  carparks: ['carparks'],
  toilets: ['toilets'],
  schools: ['schools'],
  housing: ['housing'],
  water: ['water'],
  power: ['power', 'stats'],
  // The incinerator is shared with POWER; its statistics belong to DSPA.
  waste: ['waste', 'power', 'stats'],
  grandprix: ['grandprix'],
} as const

export type CityLayer = keyof typeof CITY_LAYER_DATASETS
export type CityDataset = typeof CITY_LAYER_DATASETS[CityLayer][number]
export type CityLoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type CityDataStatus = Partial<Record<CityDataset, CityLoadStatus>>

export function cityLayerStatus(status: CityDataStatus, layer: CityLayer): CityLoadStatus {
  const states = CITY_LAYER_DATASETS[layer].map(id => status[id] ?? 'idle')
  if (states.includes('loading')) return 'loading'
  if (states.includes('error')) return 'error'
  return states.every(state => state === 'ready') ? 'ready' : 'idle'
}

// A session cache with stable external-store snapshots. Successful empty files
// are cached too. Failed requests are evicted so explicit retry / re-enabling
// works; concurrent requests (including shared dependencies) join one promise.
export function createCityDataStore(load: (id: CityDataset) => Promise<Partial<TransitData>>) {
  let snapshot: { data: Partial<TransitData>; status: CityDataStatus } = { data: {}, status: {} }
  const pending = new Map<CityDataset, Promise<void>>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach(listener => listener())

  function ensure(id: CityDataset): Promise<void> {
    if (snapshot.status[id] === 'ready') return Promise.resolve()
    const existing = pending.get(id)
    if (existing) return existing
    snapshot = { ...snapshot, status: { ...snapshot.status, [id]: 'loading' } }
    const request = Promise.resolve().then(() => load(id)).then(data => {
      snapshot = {
        data: { ...snapshot.data, ...data },
        status: { ...snapshot.status, [id]: 'ready' },
      }
    }).catch(error => {
      console.error(`Failed to load city dataset ${id}:`, error)
      snapshot = { ...snapshot, status: { ...snapshot.status, [id]: 'error' } }
    }).finally(() => {
      pending.delete(id)
      emit()
    })
    pending.set(id, request)
    emit()
    return request
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    ensureLayer: (layer: CityLayer) => Promise.all(CITY_LAYER_DATASETS[layer].map(ensure)).then(() => {}),
  }
}
