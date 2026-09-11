import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'
import { InstancedVehicleModelLayer } from './InstancedVehicleModelLayer'

const train: VehiclePosition = { id: 'test-lrt', lineId: 'taipa', type: 'lrt', coordinates: [113.57, 22.16], bearing: 90, color: '#8cc63f', progress: 0 }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

describe('LRT map integration', () => {
  it.each([false, true])('keeps model and picking visibility together (mobile=%s)', async mobile => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: mobile }) })
    const { LRT3DLayer, ALL_LRT_3D_LAYERS } = await import('./LRT3DLayer')
    const source = { setData: vi.fn() }
    const map = {
      addSource: vi.fn(), addLayer: vi.fn(), getZoom: vi.fn(() => 18),
      getSource: vi.fn(() => source), getLayer: vi.fn(() => ({})),
      removeSource: vi.fn(), removeLayer: vi.fn(),
    }
    const layer = new LRT3DLayer()
    layer.attach(map as unknown as MapLibreMap)
    const model = map.addLayer.mock.calls.at(-1)![0] as InstancedVehicleModelLayer
    const upload = vi.spyOn(model, 'setVehicles')
    expect(map.addLayer.mock.calls.slice(0, -1).map(([spec]) => spec.id)).toEqual(ALL_LRT_3D_LAYERS)
    expect(map.addLayer.mock.calls[0][0].minzoom).toBe(mobile ? 16 : 16.9)
    expect(map.addSource.mock.calls[0][1].maxzoom).toBe(15)
    layer.setVehicles([train])
    expect(upload).toHaveBeenLastCalledWith([train], expect.any(Array))
    expect(source.setData.mock.calls.at(-1)![0].features).toHaveLength(2)
    // A zoomed-out model cannot leave stale invisible click targets behind.
    map.getZoom.mockReturnValue(14)
    layer.setVehicles([train])
    expect(upload).toHaveBeenLastCalledWith([], [])
    expect(source.setData.mock.calls.at(-1)![0].features).toEqual([])
    const writes = source.setData.mock.calls.length
    layer.setVehicles([])
    expect(source.setData).toHaveBeenCalledTimes(writes)
    map.getZoom.mockReturnValue(18)
    layer.setVehicles([train])
    expect(upload).toHaveBeenLastCalledWith([train], expect.any(Array))
    layer.setVehicles([])
    expect(upload).toHaveBeenLastCalledWith([], [])
    expect(source.setData.mock.calls.at(-1)![0].features).toEqual([])
    layer.detach()
    expect(map.removeLayer.mock.calls.map(([id]) => id)).toEqual([model.id, ...ALL_LRT_3D_LAYERS])
    expect(map.removeSource).toHaveBeenCalledWith('lrt-3d-source')
  })
})
