import { describe, expect, it } from 'vitest'
import type { CityLayer } from './cityData'
import { applyLrtVisibility, applyOverlayVisibility, showOnlyCityLayer } from './layerVisibility'

describe('independent map overlays', () => {
  const groups = { water: ['water-main', 'water-flow'], power: ['power-main'], buses: ['bus-routes'], lrt: ['stations'] }
  it('keeps both utilities and transport visible together, also after rebuilding a style', () => {
    for (let mask = 0; mask < 16; mask++) {
      const visible = { water: !!(mask & 1), power: !!(mask & 2), buses: !!(mask & 4), lrt: !!(mask & 8) }
      const actual = new Map<string, string>()
      const map = { getLayer: () => ({}), setLayoutProperty: (id: string, _: 'visibility', value: string) => actual.set(id, value) }
      applyOverlayVisibility(map, visible, groups)
      for (const key of Object.keys(groups) as (keyof typeof groups)[]) {
        for (const id of groups[key]) expect(actual.get(id)).toBe(visible[key] ? 'visible' : 'none')
      }
      expect(actual.size).toBe(5)
    }
  })
  it('does not touch unavailable mobile flow layers or unrelated city layers', () => {
    const actual: string[] = []
    applyOverlayVisibility({ getLayer: id => id !== 'water-flow', setLayoutProperty: id => actual.push(id) },
      { water: true, power: true, buses: false, lrt: false }, groups)
    expect(actual).toEqual(['water-main', 'power-main', 'bus-routes', 'stations'])
  })
  it('restores only selected LRT tracks after a style reload, respecting 2D viaducts', () => {
    const actual = new Map<string, string>()
    const map = { getLayer: () => ({}), setLayoutProperty: (id: string, _: 'visibility', value: string) => actual.set(id, value) }
    applyLrtVisibility(map, ['taipa', 'hengqin'], ['taipa'], true)
    expect(Object.fromEntries(actual)).toEqual({ 'lrt-line-taipa': 'visible', 'lrt-viaduct-taipa': 'visible', 'lrt-line-hengqin': 'none', 'lrt-viaduct-hengqin': 'none' })
    applyLrtVisibility(map, ['taipa', 'hengqin'], ['taipa'], false)
    expect(actual.get('lrt-line-taipa')).toBe('visible')
    expect(actual.get('lrt-viaduct-taipa')).toBe('none')
    applyLrtVisibility(map, ['taipa', 'hengqin'], [], true)
    expect([...actual.values()].every(value => value === 'none')).toBe(true)
  })
})

describe('explicit show only action', () => {
  it('isolates any city layer without saving or replaying an earlier selection', () => {
    const ids: CityLayer[] = ['works', 'schools', 'housing', 'parishes', 'toilets', 'religion', 'oldmaps', 'carparks', 'waste', 'water', 'power', 'grandprix']
    for (const selected of ids) {
      const state = new Set<CityLayer>(ids)
      let transit = true
      const city = Object.fromEntries(ids.map(id => [id, (on: boolean): void => {
        if (on) state.add(id)
        else state.delete(id)
      }])) as Record<CityLayer, (on: boolean) => void>
      showOnlyCityLayer(selected, { city, transit: () => { transit = false } })
      expect([...state]).toEqual([selected])
      expect(transit).toBe(false)
      // Follow-up choices are ordinary independent switches.
      city.water(true)
      city.power(true)
      city.oldmaps(true)
      city.power(false)
      expect(state.has('water')).toBe(true)
      expect(state.has('oldmaps')).toBe(true)
    }
  })
})
