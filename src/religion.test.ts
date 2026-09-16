import { describe, it, expect } from 'vitest'
import {
  RELIGION_APPROXIMATE_OPACITY,
  RELIGION_COLORS,
  RELIGION_KIND_ORDER,
  buildReligionFeatures,
  countReligionByKind,
  pickHeritageText,
  pickReligionText,
  religionIconName,
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

describe('religion kinds', () => {
  it('has a colour and a distinct icon name for every kind', () => {
    const names = RELIGION_KIND_ORDER.map(religionIconName)
    expect(new Set(names).size).toBe(RELIGION_KIND_ORDER.length)
    for (const kind of RELIGION_KIND_ORDER) {
      expect(RELIGION_COLORS[kind]).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(RELIGION_APPROXIMATE_OPACITY).toBeGreaterThan(0)
    expect(RELIGION_APPROXIMATE_OPACITY).toBeLessThan(1)
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
  it('emits one point per site, carrying id, kind, icon and the approximate flag', () => {
    const fc = buildReligionFeatures([
      site({ id: 'A' }),
      site({ id: 'B', kind: 'shrine', approximate: true, sources: ['macaumemory'], osm: null, heritage: null }),
    ])
    expect(fc.features).toHaveLength(2)
    expect(fc.features.map(f => f.properties?.kind)).toEqual(['temple', 'shrine'])
    expect(fc.features.map(f => f.properties?.icon)).toEqual(['religion-temple', 'religion-shrine'])
    expect(fc.features.map(f => f.properties?.approximate)).toEqual([false, true])
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [113.54482, 22.194745] })
    expect(fc.features.map(f => f.properties?.id)).toEqual(['A', 'B'])
  })

  it('ranks exact temples above approximate shrines for collision order', () => {
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

describe('countReligionByKind', () => {
  it('counts temples and shrines separately', () => {
    expect(countReligionByKind([site(), site({ kind: 'shrine' }), site({ kind: 'shrine' })]))
      .toEqual({ temple: 1, shrine: 2 })
    expect(countReligionByKind([])).toEqual({ temple: 0, shrine: 0 })
  })
})
