import { describe, expect, it } from 'vitest'
import {
  PARISH_COLORS,
  PARISH_FEATURE_ID_PROPERTY,
  PARISH_ORDER,
  buildParishFeatures,
  buildParishLabelFeatures,
  parishColor,
  parishDensity,
  parishName,
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
