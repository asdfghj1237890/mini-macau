import { describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'
import { Ferry3DLayer, ALL_FERRY_3D_LAYERS } from './Ferry3DLayer'
import type { InstancedVehicleModelLayer } from './InstancedVehicleModelLayer'

describe('ferry model lifecycle', () => {
  it('keeps mesh and picking in sync across paused zooms, hiding and reattachment', () => {
    const setData = vi.fn(), events = new Map<string, () => void>()
    const layers = new Map<string, { id: string }>()
    let zoom = 15
    const map = {
      addSource: vi.fn(), removeSource: vi.fn(), getSource: () => ({ setData }), getZoom: () => zoom,
      addLayer: (l: { id: string }) => layers.set(l.id, l), getLayer: (id: string) => layers.get(id),
      removeLayer: (id: string) => layers.delete(id),
      on: (event: string, callback: () => void) => events.set(event, callback),
      off: (event: string, callback: () => void) => { if (events.get(event) === callback) events.delete(event) },
    }
    const ferry: VehiclePosition = { id: 'test', lineId: 'route', type: 'ferry', coordinates: [113.57, 22.16], bearing: 45, progress: 0, color: '#ff0000' }
    const layer = new Ferry3DLayer()
    layer.attach(map as unknown as MapLibreMap)
    const model = layers.get('ferry-3d-model') as InstancedVehicleModelLayer
    const upload = vi.spyOn(model, 'setVehicles')
    expect(layers.has(ALL_FERRY_3D_LAYERS[0])).toBe(true)
    layer.setVehicles([ferry])
    expect(setData).not.toHaveBeenCalled()
    zoom = 18
    events.get('zoomend')!()
    expect(upload).toHaveBeenLastCalledWith([ferry])
    expect(setData.mock.lastCall![0].features.every((f: GeoJSON.Feature) => f.properties!.vehicleId === ferry.id)).toBe(true)
    events.get('zoomend')!()
    expect(setData).toHaveBeenCalledTimes(1)
    zoom = 15
    events.get('zoomend')!()
    expect(upload).toHaveBeenLastCalledWith([])
    expect(setData.mock.lastCall![0].features).toEqual([])
    zoom = 18
    events.get('zoomend')!()
    expect(upload).toHaveBeenLastCalledWith([ferry])
    layer.setVehicles([])
    expect(upload).toHaveBeenLastCalledWith([])
    layer.detach()
    expect(layers.size).toBe(0)
    expect(events.size).toBe(0)
    layer.attach(map as unknown as MapLibreMap)
    layer.setVehicles([ferry])
    expect(upload).toHaveBeenLastCalledWith([ferry])
    expect(setData.mock.lastCall![0].features).toHaveLength(4)
    layer.detach()
  })
})
