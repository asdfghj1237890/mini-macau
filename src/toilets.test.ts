import { describe, it, expect } from 'vitest'
import {
  TOILET_COLORS,
  TOILET_VARIANT_ORDER,
  buildToiletFeatures,
  pickToiletText,
  toiletIconName,
  toiletVariant,
} from './toilets'
import type { Toilet } from './types'

function toilet(over: Partial<Toilet> = {}): Toilet {
  return {
    id: 'AM01',
    code: 'AM01',
    name: {
      zh: '食品資訊站',
      pt: 'Posto de Informações sobre Produtos Alimentares',
      en: 'Food Information Station',
    },
    address: {
      zh: '澳門祐漢小販大樓一樓',
      pt: '1.º andar do Edifício de Vendilhões do Iao Hon',
      en: '1st floor, Iao Hon Hawkers’ Building',
    },
    phone: { zh: '8296 1239', pt: '8296 1239', en: '8296 1239' },
    openHours: { zh: '全日', pt: 'Dia inteiro', en: 'Whole day' },
    accessible: false,
    family: false,
    closed: false,
    photo: 'https://www.iam.gov.mo/showFile.ashx?p=x.jpg',
    coordinates: [113.551493, 22.211268],
    ...over,
  }
}

describe('toiletVariant', () => {
  it('is normal for a plain toilet and accessible when it has a barrier-free cubicle', () => {
    expect(toiletVariant(toilet())).toBe('normal')
    expect(toiletVariant(toilet({ accessible: true }))).toBe('accessible')
  })

  it('lets closed outrank accessible', () => {
    expect(toiletVariant(toilet({ closed: true }))).toBe('closed')
    expect(toiletVariant(toilet({ closed: true, accessible: true }))).toBe('closed')
  })

  it('has a colour and a distinct icon name for every variant', () => {
    const names = TOILET_VARIANT_ORDER.map(toiletIconName)
    expect(new Set(names).size).toBe(TOILET_VARIANT_ORDER.length)
    for (const variant of TOILET_VARIANT_ORDER) {
      expect(TOILET_COLORS[variant]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('pickToiletText', () => {
  const field = { zh: '全日', pt: 'Dia inteiro', en: 'Whole day' }

  it('uses the English field for en — this dataset is trilingual', () => {
    expect(pickToiletText(field, 'en')).toBe('Whole day')
    expect(pickToiletText(field, 'zh')).toBe('全日')
    expect(pickToiletText(field, 'pt')).toBe('Dia inteiro')
  })

  it('falls back across the other two languages when one side is blank', () => {
    expect(pickToiletText({ zh: '全日', pt: '', en: '' }, 'en')).toBe('全日')
    expect(pickToiletText({ zh: '', pt: 'Dia inteiro', en: '' }, 'zh')).toBe('Dia inteiro')
    expect(pickToiletText({ zh: '', pt: '', en: '' }, 'pt')).toBe('')
  })

  it('returns an empty string for a missing field', () => {
    expect(pickToiletText(undefined, 'en')).toBe('')
  })
})

describe('buildToiletFeatures', () => {
  it('emits one point per toilet, carrying id, variant and icon name', () => {
    const fc = buildToiletFeatures([
      toilet({ id: 'A' }),
      toilet({ id: 'B', accessible: true }),
      toilet({ id: 'C', closed: true }),
    ])
    expect(fc.features).toHaveLength(3)
    expect(fc.features.map(f => f.properties?.variant)).toEqual([
      'normal', 'accessible', 'closed',
    ])
    expect(fc.features.map(f => f.properties?.icon)).toEqual([
      'toilet-normal', 'toilet-accessible', 'toilet-closed',
    ])
    expect(fc.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [113.551493, 22.211268],
    })
    expect(fc.features.map(f => f.properties?.id)).toEqual(['A', 'B', 'C'])
  })

  it('keeps two toilets that share a coordinate — the map draws both markers', () => {
    const shared: [number, number] = [113.54, 22.19]
    const fc = buildToiletFeatures([
      toilet({ id: 'A', coordinates: shared }),
      toilet({ id: 'B', coordinates: shared }),
    ])
    expect(fc.features).toHaveLength(2)
  })

  it('skips a record with no usable coordinate pair', () => {
    const broken = toilet({ id: 'X', coordinates: [] as unknown as [number, number] })
    expect(buildToiletFeatures([broken]).features).toHaveLength(0)
  })

  it('is an empty FeatureCollection for an empty list', () => {
    expect(buildToiletFeatures([])).toEqual({ type: 'FeatureCollection', features: [] })
  })
})
