import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PARISH_COLORS,
  PARISH_FEATURE_ID_PROPERTY,
  PARISH_ORDER,
  buildParishFeatures,
  buildParishLabelFeatures,
  captureTransitForParishes,
  loadParishTransitSnapshot,
  parishColor,
  parishDensity,
  parishName,
  saveParishTransitSnapshot,
} from './parishes'
import type { Parish } from './types'

const ring: [number, number][] = [
  [113.54, 22.19], [113.56, 22.19], [113.56, 22.21], [113.54, 22.21], [113.54, 22.19],
]

function parish(over: Partial<Parish> = {}): Parish {
  return {
    id: 'osm:r12107627',
    slug: 'se',
    name: { zh: '大堂區', pt: 'Sé', en: 'Cathedral Parish' },
    kind: 'parish',
    island: 'macau',
    areaKm2: 3.4,
    population: 56000,
    populationYear: 2021,
    coordinates: [113.55, 22.2],
    geometry: [[ring]],
    osm: ['r12107627'],
    sources: ['https://www.openstreetmap.org/relation/12107627'],
    ...over,
  }
}

describe('PARISH_COLORS', () => {
  it('has one distinct tint per area, in legend order', () => {
    expect([...PARISH_ORDER].sort()).toEqual(Object.keys(PARISH_COLORS).sort())
    const all = PARISH_ORDER.map(slug => PARISH_COLORS[slug])
    expect(new Set(all).size).toBe(all.length)
    for (const hex of all) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('falls back to the neutral tint for an unknown slug', () => {
    expect(parishColor('se')).toBe(PARISH_COLORS.se)
    expect(parishColor('ninth-area')).toBe(PARISH_COLORS.cotai)
  })
})

describe('parishName / parishDensity', () => {
  it('picks the reading language with sensible fallbacks', () => {
    const p = parish()
    expect(parishName(p, 'zh')).toBe('大堂區')
    expect(parishName(p, 'pt')).toBe('Sé')
    expect(parishName(p, 'en')).toBe('Cathedral Parish')
    expect(parishName(parish({ name: { zh: '大堂區', pt: 'Sé', en: '' } }), 'en')).toBe('Sé')
  })

  it('computes residents per km², rounded, or null when a figure is missing', () => {
    expect(parishDensity(parish())).toBe(16471)
    expect(parishDensity(parish({ densityPerKm2: 2656.4 }))).toBe(2656)
    expect(parishDensity(parish({ population: null, populationYear: null }))).toBeNull()
    expect(parishDensity(parish({ areaKm2: null }))).toBeNull()
  })
})

describe('buildParishFeatures', () => {
  it('emits one MultiPolygon per area with the id promoted, the tint and all three names baked in', () => {
    const fc = buildParishFeatures([parish()])
    expect(fc.features).toHaveLength(1)
    const f = fc.features[0]
    expect(f.geometry).toEqual({ type: 'MultiPolygon', coordinates: [[ring]] })
    expect(f.properties).toEqual({
      [PARISH_FEATURE_ID_PROPERTY]: 'osm:r12107627',
      slug: 'se',
      kind: 'parish',
      color: PARISH_COLORS.se,
      name_zh: '大堂區',
      name_pt: 'Sé',
      name_en: 'Cathedral Parish',
    })
  })

  it('drops polygons without a usable outer ring and skips an area left with none', () => {
    const fc = buildParishFeatures([
      parish({ id: 'a', geometry: [[ring], [[]], [[[113.5, 22.2]]]] }),
      parish({ id: 'b', geometry: [[[]]] }),
    ])
    expect(fc.features).toHaveLength(1)
    expect((fc.features[0].geometry as GeoJSON.MultiPolygon).coordinates).toEqual([[ring]])
  })

  it('places one label point per area at its anchor', () => {
    const fc = buildParishLabelFeatures([parish(), parish({ id: 'c', slug: 'cotai', kind: 'reclamation', coordinates: [113.57, 22.15] })])
    expect(fc.features.map(f => (f.geometry as GeoJSON.Point).coordinates)).toEqual([[113.55, 22.2], [113.57, 22.15]])
    expect(fc.features[1].properties?.color).toBe(PARISH_COLORS.cotai)
  })
})

// vitest runs in node, which has no Web Storage: stub the methods the module
// uses over a Map (the same approach as publicHousing.test.ts).
function fakeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

describe('the PARISHES transit stash', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('captures the LRT lines and bus routes, dropping the routes in auto mode', () => {
    expect(captureTransitForParishes(new Set(['lrt-taipa']), false, new Set(['26A', '25'])))
      .toEqual({ lrt: ['lrt-taipa'], busAuto: false, busRoutes: ['26A', '25'] })
    expect(captureTransitForParishes(['lrt-taipa'], true, ['26A']))
      .toEqual({ lrt: ['lrt-taipa'], busAuto: true, busRoutes: [] })
  })

  it('round-trips through storage and clears with null', () => {
    const snapshot = captureTransitForParishes(['lrt-taipa'], false, ['26A'])
    saveParishTransitSnapshot(snapshot)
    expect(loadParishTransitSnapshot()).toEqual(snapshot)
    saveParishTransitSnapshot(null)
    expect(loadParishTransitSnapshot()).toBeNull()
    expect(localStorage.getItem('mini-macau-parishes-transit-snapshot')).toBeNull()
  })

  it('reads nothing from a missing, corrupt or mis-shaped entry', () => {
    expect(loadParishTransitSnapshot()).toBeNull()
    localStorage.setItem('mini-macau-parishes-transit-snapshot', '{not json')
    expect(loadParishTransitSnapshot()).toBeNull()
    localStorage.setItem('mini-macau-parishes-transit-snapshot', '{"lrt":"lrt-taipa","busAuto":false,"busRoutes":[]}')
    expect(loadParishTransitSnapshot()).toBeNull()
    localStorage.setItem('mini-macau-parishes-transit-snapshot', '{"lrt":[],"busAuto":"yes","busRoutes":[]}')
    expect(loadParishTransitSnapshot()).toBeNull()
  })
})
