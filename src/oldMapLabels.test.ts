import { describe, expect, it, vi } from 'vitest'
import type { SymbolLayerSpecification } from 'maplibre-gl'
import { OldMapLabels } from './oldMapLabels'

function label(overrides: Partial<SymbolLayerSpecification> = {}): SymbolLayerSpecification {
  return {
    id: 'poi_park', type: 'symbol', source: 'basemap', 'source-layer': 'poi',
    layout: { 'text-field': '{name}', 'text-transform': 'uppercase', 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 8, 18, 10] },
    paint: { 'text-color': '#515151', 'text-halo-color': '#151515', 'text-halo-width': 1 },
    ...overrides,
  }
}

function map() {
  return {
    getLayer: vi.fn<(id: string) => unknown>().mockImplementation(id => ({ id })),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
  }
}

describe('historical map label lifecycle', () => {
  it('restores the exact size ramp and optional paint defaults after repeated plate updates', () => {
    const original = label()
    const labels = new OldMapLabels([original])
    const m = map()
    labels.sync(m, false)
    expect(m.setPaintProperty).not.toHaveBeenCalled()
    labels.sync(m, true)
    expect(m.setPaintProperty).toHaveBeenCalledWith(original.id, 'text-halo-color', expect.not.stringMatching(/^#151515$/))
    const writes = m.setPaintProperty.mock.calls.length
    labels.sync(m, true)
    expect(m.setPaintProperty).toHaveBeenCalledTimes(writes)
    labels.sync(m, false)
    expect(m.setLayoutProperty).toHaveBeenLastCalledWith(original.id, 'text-size', original.layout!['text-size'])
    expect(m.setPaintProperty).toHaveBeenCalledWith(original.id, 'text-color', '#515151')
    expect(m.setPaintProperty).toHaveBeenLastCalledWith(original.id, 'text-halo-blur', undefined)
    expect(original.layout!['text-transform']).toBe('uppercase')
  })

  it('does not reveal hidden house numbers or recolour app markers and icons', () => {
    const labels = new OldMapLabels([
      label({ id: 'housenumber', 'source-layer': 'housenumber', paint: { 'text-color': 'transparent' } }),
      label({ id: 'religion-icon', source: 'religion', 'source-layer': undefined }),
      label({ id: 'poi-icon', layout: { 'icon-image': 'park' } }),
    ])
    const m = map()
    labels.sync(m, true)
    expect(m.setPaintProperty).not.toHaveBeenCalled()
    expect(m.setLayoutProperty).not.toHaveBeenCalled()
  })

  it('restores the newly loaded theme and tolerates layers removed during a restyle', () => {
    const m = map()
    new OldMapLabels([label()]).sync(m, true)
    const light = new OldMapLabels([label({ paint: { 'text-color': '#666', 'text-halo-color': '#fff' } })])
    light.sync(m, true)
    light.sync(m, false)
    expect(m.setPaintProperty).toHaveBeenCalledWith('poi_park', 'text-halo-color', '#fff')
    m.setPaintProperty.mockClear()
    m.getLayer.mockReturnValue(undefined)
    light.sync(m, true)
    expect(m.setPaintProperty).not.toHaveBeenCalled()
  })
})
