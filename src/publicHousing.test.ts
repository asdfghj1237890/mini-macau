import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALL_PUBLIC_HOUSING_TYPES,
  PUBLIC_HOUSING_COLORS,
  PUBLIC_HOUSING_DECADES,
  PUBLIC_HOUSING_FEATURE_ID_PROPERTY,
  PUBLIC_HOUSING_HEIGHT_MARGIN_M,
  PUBLIC_HOUSING_TYPE_COLOR,
  PUBLIC_HOUSING_TYPE_ORDER,
  buildPublicHousingFeatures,
  countPublicHousingByType,
  filterPublicHousingByType,
  loadPublicHousingTypesOn,
  publicHousingColor,
  publicHousingDecade,
  publicHousingRamp,
  savePublicHousingTypesOn,
} from './publicHousing'
import type { PublicHousingBuilding, PublicHousingEstate } from './types'

const ring: [number, number][] = [
  [113.55, 22.20], [113.551, 22.20], [113.551, 22.201], [113.55, 22.201], [113.55, 22.20],
]

function building(over: Partial<PublicHousingBuilding> = {}): PublicHousingBuilding {
  return {
    osmId: 'w1', name: 'A座', block: 'A座', year: null, height: 30, minHeight: 0,
    coordinates: [ring],
    ...over,
  }
}

function estate(over: Partial<PublicHousingEstate> = {}): PublicHousingEstate {
  return {
    id: 'ihm:sh:test',
    name: { zh: '測試社屋', pt: 'Edifício Teste' },
    type: 'social',
    category: null,
    district: 'macau',
    address: { zh: '測試街', pt: 'Rua de Teste' },
    year: 1985,
    yearKind: 'occupation',
    status: 'occupied',
    partial: false,
    units: 100,
    storeys: 20,
    blocks: [{ name: { zh: 'A座', pt: 'Torre A' }, year: 1985, date: '1985-01-01' }],
    coordinates: [113.5505, 22.2005],
    approximate: false,
    osm: ['w1'],
    buildings: [building()],
    sources: ['https://www.ihm.gov.mo/zh/sh-location-distribution'],
    ...over,
  }
}

describe('publicHousingDecade', () => {
  it('buckets a year into its decade stop', () => {
    expect(publicHousingDecade(1985)).toBe(1980)
    expect(publicHousingDecade(1990)).toBe(1990)
    expect(publicHousingDecade(1999)).toBe(1990)
    expect(publicHousingDecade(2013)).toBe(2010)
    expect(publicHousingDecade(2025)).toBe(2020)
  })

  it('clamps years outside the ramp to its ends', () => {
    expect(publicHousingDecade(1962)).toBe(1980)
    expect(publicHousingDecade(2041)).toBe(2020)
  })

  it('treats a missing year as the newest decade', () => {
    expect(publicHousingDecade(null)).toBe(2020)
    expect(publicHousingDecade(undefined)).toBe(2020)
    expect(publicHousingDecade(Number.NaN)).toBe(2020)
  })
})

describe('colour tables', () => {
  it('has one colour per type per decade, all distinct within a family', () => {
    for (const type of PUBLIC_HOUSING_TYPE_ORDER) {
      const family = PUBLIC_HOUSING_COLORS[type]
      const stops = PUBLIC_HOUSING_DECADES.map(decade => family[decade])
      expect(stops).toHaveLength(PUBLIC_HOUSING_DECADES.length)
      expect(new Set(stops).size).toBe(stops.length)
      for (const stop of stops) expect(stop).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('gets darker for older decades (perceived luminance rises with the decade)', () => {
    const luminance = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (const type of PUBLIC_HOUSING_TYPE_ORDER) {
      const ramp = publicHousingRamp(type)
      for (let i = 1; i < ramp.length; i++) {
        expect(luminance(ramp[i])).toBeGreaterThan(luminance(ramp[i - 1]))
      }
    }
  })

  it('publicHousingColor picks the family by type and the stop by year', () => {
    expect(publicHousingColor('social', 1985)).toBe(PUBLIC_HOUSING_COLORS.social[1980])
    expect(publicHousingColor('economic', 2013)).toBe(PUBLIC_HOUSING_COLORS.economic[2010])
    expect(publicHousingColor('economic', null)).toBe(PUBLIC_HOUSING_COLORS.economic[2020])
    expect(publicHousingColor('other', 2024)).toBe(PUBLIC_HOUSING_COLORS.other[2020])
  })

  it('uses the middle stop as each type\'s identity colour', () => {
    expect(PUBLIC_HOUSING_TYPE_COLOR.social).toBe(PUBLIC_HOUSING_COLORS.social[2000])
    expect(PUBLIC_HOUSING_TYPE_COLOR.economic).toBe(PUBLIC_HOUSING_COLORS.economic[2000])
    expect(PUBLIC_HOUSING_TYPE_COLOR.other).toBe(PUBLIC_HOUSING_COLORS.other[2000])
  })
})

describe('filterPublicHousingByType / countPublicHousingByType', () => {
  const estates = [
    estate({ id: 'a', type: 'social' }),
    estate({ id: 'b', type: 'economic' }),
    estate({ id: 'c', type: 'economic' }),
  ]

  it('returns the same array when every type is on', () => {
    expect(filterPublicHousingByType(estates, ALL_PUBLIC_HOUSING_TYPES)).toBe(estates)
  })

  it('filters to the enabled types', () => {
    const only = filterPublicHousingByType(estates, new Set(['economic'] as const))
    expect(only.map(e => e.id)).toEqual(['b', 'c'])
    expect(filterPublicHousingByType(estates, new Set())).toEqual([])
  })

  it('counts both types, reading 0 for an absent one', () => {
    expect(countPublicHousingByType(estates)).toEqual({ social: 1, economic: 2, other: 0 })
    expect(countPublicHousingByType([])).toEqual({ social: 0, economic: 0, other: 0 })
  })
})

// vitest runs these in node, which has no Web Storage: stub the four methods
// the module uses over a Map (the same approach as schools.test.ts).
function fakeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

describe('type toggles in localStorage', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('defaults to all on when nothing is stored', () => {
    expect(loadPublicHousingTypesOn()).toBe(ALL_PUBLIC_HOUSING_TYPES)
  })

  it('round-trips a partial set, storing the OFF list in type order', () => {
    savePublicHousingTypesOn(new Set(['economic'] as const))
    expect(localStorage.getItem('mini-macau-public-housing-types-off')).toBe('["social","other"]')
    expect([...loadPublicHousingTypesOn()]).toEqual(['economic'])
  })

  it('keeps a type added after the preference was stored switched on', () => {
    // A stored OFF list never mentions a type that did not exist yet, so the
    // newcomer is on; the first version's ON list is ignored entirely.
    localStorage.setItem('mini-macau-public-housing-types-off', '["social"]')
    expect([...loadPublicHousingTypesOn()]).toEqual(['economic', 'other'])
    localStorage.setItem('mini-macau-public-housing-types-on', '["social","economic"]')
    localStorage.removeItem('mini-macau-public-housing-types-off')
    expect(loadPublicHousingTypesOn()).toBe(ALL_PUBLIC_HOUSING_TYPES)
    savePublicHousingTypesOn(ALL_PUBLIC_HOUSING_TYPES)
    expect(localStorage.getItem('mini-macau-public-housing-types-on')).toBeNull()
    expect(localStorage.getItem('mini-macau-public-housing-types-off')).toBe('[]')
  })

  it('ignores unknown names and corrupt storage', () => {
    localStorage.setItem('mini-macau-public-housing-types-off', '["sandwich"]')
    expect(loadPublicHousingTypesOn()).toBe(ALL_PUBLIC_HOUSING_TYPES)
    localStorage.setItem('mini-macau-public-housing-types-off', '["economic","sandwich"]')
    expect([...loadPublicHousingTypesOn()]).toEqual(['social', 'other'])
    localStorage.setItem('mini-macau-public-housing-types-off', '{not json')
    expect(loadPublicHousingTypesOn()).toBe(ALL_PUBLIC_HOUSING_TYPES)
    localStorage.setItem('mini-macau-public-housing-types-off', '"social"')
    expect(loadPublicHousingTypesOn()).toBe(ALL_PUBLIC_HOUSING_TYPES)
  })
})

describe('buildPublicHousingFeatures', () => {
  it('emits one polygon per building with the estate id promoted and colour baked in', () => {
    const fc = buildPublicHousingFeatures([estate()])
    expect(fc.features).toHaveLength(1)
    const f = fc.features[0]
    expect(f.geometry).toEqual({ type: 'Polygon', coordinates: [ring] })
    expect(f.properties).toMatchObject({
      [PUBLIC_HOUSING_FEATURE_ID_PROPERTY]: 'ihm:sh:test',
      type: 'social',
      year: 1985,
      decade: 1980,
      color: PUBLIC_HOUSING_COLORS.social[1980],
      height: 30 + PUBLIC_HOUSING_HEIGHT_MARGIN_M,
      minHeight: 0,
      name: 'A座',
      block: 'A座',
    })
  })

  it('lets a building\'s own block year override the estate year', () => {
    const e = estate({
      year: 2012,
      type: 'economic',
      buildings: [
        building({ osmId: 'w1', year: 2012 }),
        building({ osmId: 'w2', year: 2021, block: 'B座', name: 'B座' }),
        building({ osmId: 'w3', year: null, block: null, name: null }),
      ],
    })
    const colors = buildPublicHousingFeatures([e]).features.map(f => f.properties?.color)
    expect(colors).toEqual([
      PUBLIC_HOUSING_COLORS.economic[2010],
      PUBLIC_HOUSING_COLORS.economic[2020],
      PUBLIC_HOUSING_COLORS.economic[2010],
    ])
  })

  it('skips buildings without a usable ring', () => {
    const e = estate({
      buildings: [
        building({ osmId: 'w1', coordinates: [] }),
        building({ osmId: 'w2', coordinates: [[]] }),
        building({ osmId: 'w3' }),
      ],
    })
    const fc = buildPublicHousingFeatures([e])
    expect(fc.features).toHaveLength(1)
  })

  it('returns an empty collection for no estates', () => {
    expect(buildPublicHousingFeatures([])).toEqual({ type: 'FeatureCollection', features: [] })
  })
})
