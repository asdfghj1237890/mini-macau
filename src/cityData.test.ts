import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { CITY_LAYER_DATASETS, cityLayerStatus, createCityDataStore, type CityLayer } from './cityData'
import { loadCityDataset } from './cityDataFetch'
import type { TransitData } from './types'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('on-demand city data', () => {
  it('does no work when created or subscribed, and keeps a stable snapshot', () => {
    const load = vi.fn()
    const store = createCityDataStore(load)
    const initial = store.getSnapshot()
    const unsubscribe = store.subscribe(vi.fn())
    expect(store.getSnapshot()).toBe(initial)
    expect(load).not.toHaveBeenCalled()
    expect(initial.data).toEqual({})
    unsubscribe()
  })

  it.each(Object.keys(CITY_LAYER_DATASETS) as CityLayer[])('loads only %s and its dependencies', async layer => {
    const load = vi.fn<(id: string) => Promise<Partial<TransitData>>>(async () => ({}))
    const store = createCityDataStore(load)
    await store.ensureLayer(layer)
    expect(load.mock.calls.map(call => call[0])).toEqual(CITY_LAYER_DATASETS[layer])
    expect(cityLayerStatus(store.getSnapshot().status, layer)).toBe('ready')
  })

  it('deduplicates rapid toggles and shared power/statistics, even before completion', async () => {
    let finish!: (data: Partial<TransitData>) => void
    const load = vi.fn(() => new Promise<Partial<TransitData>>(resolve => { finish = resolve }))
    const store = createCityDataStore(load)
    const first = store.ensureLayer('schools')
    const second = store.ensureLayer('schools')
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    expect(cityLayerStatus(store.getSnapshot().status, 'schools')).toBe('loading')
    finish({ schools: [] })
    await Promise.all([first, second])
    const ready = store.getSnapshot()
    await store.ensureLayer('schools')
    expect(store.getSnapshot()).toBe(ready)
    expect(load).toHaveBeenCalledTimes(1)

    const shared = vi.fn<(id: string) => Promise<Partial<TransitData>>>(async () => ({}))
    const other = createCityDataStore(shared)
    await Promise.all([other.ensureLayer('power'), other.ensureLayer('waste'), other.ensureLayer('power')])
    expect(shared.mock.calls.map(call => call[0]).sort()).toEqual(['power', 'stats', 'waste'])
  })

  it('retains completed data with no subscribers; loading cannot re-enable a layer', async () => {
    const schools: TransitData['schools'] = []
    const store = createCityDataStore(async () => ({ schools }))
    const notify = vi.fn()
    const unsubscribe = store.subscribe(notify)
    const pending = store.ensureLayer('schools')
    unsubscribe()
    await pending
    expect(notify).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().data.schools).toBe(schools)
    expect(Object.keys(store.getSnapshot().data)).toEqual(['schools'])
  })

  it('isolates failures, allows retry, and does not fetch successful dependencies again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail = true
    const load = vi.fn(async (id: string) => {
      if (id === 'stats' && fail) throw new Error('offline')
      return id === 'waste' ? { waste: [], wasteSources: [], wasteFacilities: [], wasteEcoStations: [] } : {}
    })
    const store = createCityDataStore(load)
    await store.ensureLayer('waste')
    expect(cityLayerStatus(store.getSnapshot().status, 'waste')).toBe('error')
    expect(store.getSnapshot().data.waste).toEqual([])
    expect(store.getSnapshot().status.power).toBe('ready')
    fail = false
    await store.ensureLayer('waste')
    expect(load.mock.calls.map(call => call[0])).toEqual(['waste', 'power', 'stats', 'stats'])
    expect(cityLayerStatus(store.getSnapshot().status, 'waste')).toBe('ready')
  })

  it('rejects HTTP errors and malformed files so they can be retried', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schools: 'invalid' })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadCityDataset('schools')).rejects.toThrow('HTTP 503')
    await expect(loadCityDataset('schools')).rejects.toThrow()
  })

  it('parses every city file and preserves complete grouped data for the map and panels', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(await readFile(`public${path}`, 'utf8'))))
    const store = createCityDataStore(loadCityDataset)
    await Promise.all((Object.keys(CITY_LAYER_DATASETS) as CityLayer[]).map(store.ensureLayer))
    expect(Object.values(store.getSnapshot().status).every(status => status === 'ready')).toBe(true)
    const data = store.getSnapshot().data
    expect(data.schools?.length).toBeGreaterThan(0)
    expect(data.wasteSources?.length).toBeGreaterThan(0)
    expect(data.wasteFacilities?.length).toBeGreaterThan(0)
    expect(data.waterNetwork?.nodes.length).toBeGreaterThan(0)
    expect(data.powerNetwork?.nodes.length).toBeGreaterThan(0)
    expect(data.dspaStats).toBeTruthy()
    expect(data.grandPrix?.corners.length).toBeGreaterThan(0)
  })
})
