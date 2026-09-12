import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'

beforeAll(() => vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) }))
afterAll(() => vi.unstubAllGlobals())

describe('bus viewport lifecycle', () => {
  it('reveals paused buses after panning, clears hidden fleets, and removes camera listeners', async () => {
    const { Bus3DLayer } = await import('./Bus3DLayer')
    const setData = vi.fn()
    const events = new Map<string, () => void>()
    const layers = new Map<string, { id: string }>()
    let centre = 113.57, zoom = 18
    const map = {
      addSource: vi.fn(), removeSource: vi.fn(), getSource: () => ({ setData }),
      addLayer: (l: { id: string }) => layers.set(l.id, l), getLayer: (id: string) => layers.get(id),
      removeLayer: (id: string) => layers.delete(id), getZoom: () => zoom,
      getBounds: () => ({ getWest: () => centre - .001, getEast: () => centre + .001, getSouth: () => 22.159, getNorth: () => 22.161 }),
      on: (event: string, callback: () => void) => events.set(event, callback),
      off: (event: string, callback: () => void) => { if (events.get(event) === callback) events.delete(event) },
    }
    const bus: VehiclePosition = { id: 'near', lineId: '1', type: 'bus', coordinates: [113.57, 22.16], bearing: 0, progress: 0, color: '#ff0000' }
    const fleet = [bus, { ...bus, id: 'far', coordinates: [113.6, 22.16] as [number, number] }]
    const layer = new Bus3DLayer()
    const ids = () => setData.mock.lastCall![0].features.map((f: GeoJSON.Feature) => f.properties!.vehicleId)
    layer.attach(map as unknown as MapLibreMap)
    layer.setVehicles(fleet)
    expect(ids()).toEqual(['near'])
    centre = 113.6
    events.get('moveend')!()
    expect(ids()).toEqual(['far'])
    zoom = 15
    events.get('moveend')!()
    expect(ids()).toEqual([])
    const calls = setData.mock.calls.length
    events.get('moveend')!()
    expect(setData).toHaveBeenCalledTimes(calls)
    zoom = 18
    events.get('moveend')!()
    expect(ids()).toEqual(['far'])
    layer.setVehicles([])
    expect(ids()).toEqual([])
    layer.detach()
    expect(layers.size).toBe(0)
    expect(events.size).toBe(0)
    layer.attach(map as unknown as MapLibreMap)
    layer.setVehicles(fleet)
    expect(ids()).toEqual(['far'])
    layer.detach()
  })
})
