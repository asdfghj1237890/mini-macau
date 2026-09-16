import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  ALL_RELIGION_CATEGORIES,
  RELIGION_APPROXIMATE_OPACITY,
  RELIGION_CATEGORY_COLORS,
  RELIGION_CATEGORY_ORDER,
  RELIGION_ICON_VARIANTS,
  RELIGION_KIND_ORDER,
  buildReligionFeatures,
  countReligionByCategory,
  countReligionByKind,
  filterReligionByCategory,
  loadReligionCategoriesOn,
  pickHeritageText,
  pickReligionText,
  religionColor,
  religionIconName,
  saveReligionCategoriesOn,
} from './religion'
import type { ReligionSite } from './types'

function site(over: Partial<ReligionSite> = {}): ReligionSite {
  return {
    id: 'osm-way-740768095',
    category: 'tudigong',
    kind: 'temple',
    name: { zh: '雀仔園福德祠', en: 'Foc Tac Temple (Horta da Mitra neighbourhood)', pt: 'Templo de Foc Tac (Bairro da Horta da Mitra)' },
    coordinates: [113.54482, 22.194745],
    approximate: false,
    address: null,
    heritage: { code: 'MM037', description: { zh: '雀仔園福德祠建於清光緒十二年', en: 'Built in 1886', pt: 'Construído em 1886' } },
    sources: ['osm', 'ic', 'macaumemory'],
    osm: 'way/740768095',
    macaumemory: { names: ['雀仔園福德祠'], records: ['p0003848'], entries: ['https://www.macaumemory.mo/entries_739473b1785c4f32bc70135c68587adc'] },
    ...over,
  }
}

describe('religion categories and kinds', () => {
  it('has a colour for every category and a distinct icon name for every category × kind', () => {
    for (const category of RELIGION_CATEGORY_ORDER) {
      expect(RELIGION_CATEGORY_COLORS[category]).toMatch(/^#[0-9a-f]{6}$/)
    }
    const names = RELIGION_ICON_VARIANTS.map(v => religionIconName(v.category, v.kind))
    expect(names).toHaveLength(RELIGION_CATEGORY_ORDER.length * RELIGION_KIND_ORDER.length)
    expect(new Set(names).size).toBe(names.length)
    expect(RELIGION_APPROXIMATE_OPACITY).toBeGreaterThan(0)
    expect(RELIGION_APPROXIMATE_OPACITY).toBeLessThan(1)
  })

  it('colours a site by its category, not its kind', () => {
    expect(religionColor(site({ category: 'church', kind: 'church' }))).toBe(RELIGION_CATEGORY_COLORS.church)
    expect(religionColor(site({ category: 'temple', kind: 'shrine' }))).toBe(RELIGION_CATEGORY_COLORS.temple)
    expect(religionColor(site({ category: 'tudigong', kind: 'shrine' }))).toBe(RELIGION_CATEGORY_COLORS.tudigong)
  })
})

describe('pickReligionText', () => {
  it('gives English and Portuguese readers the official name when one exists', () => {
    const name = site().name
    expect(pickReligionText(name, 'en')).toBe('Foc Tac Temple (Horta da Mitra neighbourhood)')
    expect(pickReligionText(name, 'pt')).toBe('Templo de Foc Tac (Bairro da Horta da Mitra)')
    expect(pickReligionText(name, 'zh')).toBe('雀仔園福德祠')
  })

  it('falls back to the Chinese inscription for a shrine with no other name', () => {
    const name = { zh: '本坊土地福德正神', en: null, pt: null }
    expect(pickReligionText(name, 'en')).toBe('本坊土地福德正神')
    expect(pickReligionText(name, 'pt')).toBe('本坊土地福德正神')
  })

  it('returns an empty string for a missing field', () => {
    expect(pickReligionText(null, 'en')).toBe('')
    expect(pickReligionText(undefined, 'zh')).toBe('')
  })

  it('reads the heritage description in the current language', () => {
    const desc = site().heritage!.description
    expect(pickHeritageText(desc, 'en')).toBe('Built in 1886')
    expect(pickHeritageText(desc, 'pt')).toBe('Construído em 1886')
    expect(pickHeritageText(desc, 'zh')).toBe('雀仔園福德祠建於清光緒十二年')
    expect(pickHeritageText(null, 'en')).toBe('')
  })
})

describe('buildReligionFeatures', () => {
  it('emits one point per site, carrying id, category, kind, icon and the approximate flag', () => {
    const fc = buildReligionFeatures([
      site({ id: 'A' }),
      site({ id: 'B', kind: 'shrine', approximate: true, sources: ['macaumemory'], osm: null, heritage: null }),
      site({ id: 'C', category: 'church', kind: 'church' }),
    ])
    expect(fc.features).toHaveLength(3)
    expect(fc.features.map(f => f.properties?.kind)).toEqual(['temple', 'shrine', 'church'])
    expect(fc.features.map(f => f.properties?.icon)).toEqual([
      'religion-tudigong-temple', 'religion-tudigong-shrine', 'religion-church-church',
    ])
    expect(fc.features.map(f => f.properties?.approximate)).toEqual([false, true, false])
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [113.54482, 22.194745] })
    expect(fc.features.map(f => f.properties?.id)).toEqual(['A', 'B', 'C'])
  })

  it('ranks exact buildings above approximate street shrines for collision order', () => {
    const fc = buildReligionFeatures([
      site({ id: 'T', kind: 'temple', approximate: false }),
      site({ id: 'S', kind: 'shrine', approximate: true }),
    ])
    const rank = (id: string) => fc.features.find(f => f.properties?.id === id)?.properties?.rank as number
    expect(rank('T')).toBeGreaterThan(rank('S'))
  })

  it('skips a record with no usable coordinate pair', () => {
    const broken = site({ id: 'X', coordinates: [] as unknown as [number, number] })
    expect(buildReligionFeatures([broken]).features).toHaveLength(0)
  })

  it('is an empty FeatureCollection for an empty list', () => {
    expect(buildReligionFeatures([])).toEqual({ type: 'FeatureCollection', features: [] })
  })
})

describe('counts', () => {
  it('counts kinds and categories separately, with every key present', () => {
    const sites = [site(), site({ kind: 'shrine' }), site({ category: 'church', kind: 'church' })]
    expect(countReligionByKind(sites)).toEqual({ temple: 1, shrine: 1, church: 1, mosque: 0 })
    expect(countReligionByCategory(sites)).toEqual({ tudigong: 2, temple: 0, church: 1, mosque: 0, other: 0 })
    expect(countReligionByCategory([])).toEqual({ tudigong: 0, temple: 0, church: 0, mosque: 0, other: 0 })
  })
})

describe('filterReligionByCategory', () => {
  const sites = [site({ id: 'a' }), site({ id: 'b', category: 'church', kind: 'church' }), site({ id: 'c', category: 'mosque', kind: 'mosque' })]

  it('returns the same array when every category is on — MapView skips the setData', () => {
    expect(filterReligionByCategory(sites, ALL_RELIGION_CATEGORIES)).toBe(sites)
  })

  it('drops the sites whose category is off', () => {
    const on = new Set(['church', 'other'] as const)
    expect(filterReligionByCategory(sites, on).map(s => s.id)).toEqual(['b'])
    expect(filterReligionByCategory(sites, new Set()).length).toBe(0)
  })
})

describe('loadReligionCategoriesOn / saveReligionCategoriesOn', () => {
  function stubStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial))
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    })
    return store
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('defaults to every category when nothing is stored', () => {
    stubStorage()
    expect([...loadReligionCategoriesOn()]).toEqual([...RELIGION_CATEGORY_ORDER])
  })

  it('round-trips a partial selection in legend order', () => {
    const store = stubStorage()
    saveReligionCategoriesOn(new Set(['other', 'tudigong'] as const))
    expect(store.get('mini-macau-religion-categories-on')).toBe('["tudigong","other"]')
    expect([...loadReligionCategoriesOn()]).toEqual(['tudigong', 'other'])
  })

  it('degrades to all-on for corrupt or unknown storage', () => {
    stubStorage({ 'mini-macau-religion-categories-on': '{"nope":1}' })
    expect([...loadReligionCategoriesOn()]).toEqual([...RELIGION_CATEGORY_ORDER])
    stubStorage({ 'mini-macau-religion-categories-on': '["zeus"]' })
    expect(loadReligionCategoriesOn().size).toBe(0)
    stubStorage({ 'mini-macau-religion-categories-on': 'not json' })
    expect([...loadReligionCategoriesOn()]).toEqual([...RELIGION_CATEGORY_ORDER])
  })

  it('never lets a throwing storage break the toggle', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    expect(() => saveReligionCategoriesOn(ALL_RELIGION_CATEGORIES)).not.toThrow()
    expect([...loadReligionCategoriesOn()]).toEqual([...RELIGION_CATEGORY_ORDER])
  })
})
