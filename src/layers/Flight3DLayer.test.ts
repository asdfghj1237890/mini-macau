import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VehiclePosition } from '../types'
import type { AircraftModelLayer } from './AircraftModelLayer'

const plane: VehiclePosition = { id: 'demo', lineId: 'demo', type: 'flight', color: '#fff', coordinates: [113.57, 22.16], bearing: 0, progress: 0 }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

describe('tracked aircraft uploads', () => {
  it('updates the tracked mesh every frame while retaining the picking upload cadence', async () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const { Flight3DLayer } = await import('./Flight3DLayer')
    const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
    const map = {
      addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
      addLayer: vi.fn(), getZoom: vi.fn(() => 18),
      getSource: (id: string) => sources.get(id), getLayer: () => ({}), moveLayer: vi.fn(),
    }
    const layer = new Flight3DLayer()
    layer.attach(map as unknown as MapLibreMap)
    const model = map.addLayer.mock.calls.at(-1)![0] as AircraftModelLayer
    const trackedModel = vi.spyOn(model, 'setTrackedVehicle')
    const fleetModel = vi.spyOn(model, 'setVehicles')
    layer.setTrackedVehicle(plane, { refreshFleet: false, updatePicking: true })
    layer.setVehicles([plane, { ...plane, id: 'other' }])
    expect(fleetModel.mock.calls.at(-1)![0].map(v => v.id)).toEqual(['other'])
    const main = sources.get('flight-3d-source')!.setData, tracked = sources.get('flight-3d-tracked-source')!.setData
    for (let i = 1; i <= 9; i++) layer.setTrackedVehicle({ ...plane, progress: i / 100 }, { updatePicking: false })
    expect(trackedModel).toHaveBeenCalledTimes(10)
    expect(tracked).toHaveBeenCalledTimes(1)
    expect(main).toHaveBeenCalledTimes(1)
    layer.setTrackedVehicle({ ...plane, progress: .1 }, { updatePicking: true })
    expect(tracked).toHaveBeenCalledTimes(2)
    layer.setTrackedVehicle(null)
    expect(tracked.mock.calls.at(-1)![0].features).toEqual([])
    expect(fleetModel.mock.calls.at(-1)![0].map(v => v.id)).toEqual(['demo', 'other'])
    map.getZoom.mockReturnValue(13)
    layer.setTrackedVehicle(plane, { updatePicking: false })
    expect(trackedModel).toHaveBeenLastCalledWith(null)
    map.getZoom.mockReturnValue(18)
    layer.setTrackedVehicle(plane, { updatePicking: true })
    expect(trackedModel).toHaveBeenLastCalledWith(plane)
    expect(tracked.mock.calls.at(-1)![0].features.length).toBeGreaterThan(0)
  })
})
