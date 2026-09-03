/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CAR_PARK_ICON_NAME,
  buildCarParkFeatures,
  parseCarParkTime,
  parseCarParkVacancyXml,
  pickCarParkText,
} from './carParks'
import type { CarPark, CarParkVacancy } from './types'

// A real car_park_maintance response, captured 2026-09-03 16:21 Macau. Kept
// verbatim so the parser is tested against the upstream's actual quirks:
// blank counts, a suspended park, "-" for its timestamp.
const fixture = readFileSync(
  resolve(__dirname, '__fixtures__', 'car-park-maintance.xml'),
  'utf8',
)

function carPark(over: Partial<CarPark> = {}): CarPark {
  return {
    id: '7070',
    name: {
      zh: '澳門文化中心停車場',
      pt: 'Auto-Silo do Centro Cultural de Macau',
      en: 'Auto-Silo do Centro Cultural de Macau',
    },
    location: { zh: '澳門冼星海大馬路', pt: 'Avenida Xian Xing Hai', en: 'Avenida Xian Xing Hai' },
    entrance: { zh: '出入口設於冼星海大馬路', pt: 'Entrada pela Avenida Xian Xing Hai', en: '' },
    phone: '2895 5117',
    heightLimitM: 2,
    fees: {
      light: { zh: 'MOP$6(日間)\nMOP$3(夜間)', pt: 'MOP$6 (Diurno)', en: '' },
      heavy: { zh: '', pt: '', en: '' },
      moto: { zh: 'MOP$2(日間)', pt: 'MOP$2 (Diurno)', en: '' },
      remark: { zh: '日間：上午八時至下午八時前', pt: '', en: '' },
    },
    zone: { zh: '澳門', pt: 'Macau', en: 'Macau' },
    parish: { zh: '新口岸區', pt: 'ZAPE', en: 'ZAPE' },
    coordinates: [113.554413, 22.188705],
    ...over,
  }
}

describe('parseCarParkVacancyXml', () => {
  const rows = parseCarParkVacancyXml(fixture)

  it('reads every Car_park_info row, keyed by ID', () => {
    expect(rows.size).toBe(87)
    // A park that reports every category.
    expect(rows.get('6026')).toMatchObject({
      id: '6026', car: 4, moto: 89, eMoto: 4, eCar: 7, disabled: 2, maintenance: false,
    })
  })

  it('turns empty counts into null but keeps a real zero', () => {
    // 蓮花路 (重型) publishes no counts at all.
    const empty = rows.get('7085')
    expect(empty).toMatchObject({ car: null, moto: null, eMoto: null, eCar: null, disabled: null })
    // 塔石廣場地下上落客區 is genuinely full: 0 is a count, not "unknown".
    expect(rows.get('6045')?.car).toBe(0)
    expect(rows.get('6045')?.moto).toBeNull()
  })

  it('flags the suspended park and keeps its unparseable timestamp raw', () => {
    const paused = rows.get('7057') // 快盈大廈
    expect(paused?.maintenance).toBe(true)
    expect(paused?.time).toBe('-')
    expect(paused?.timeParsed).toBeNull()
    // Exactly one park is suspended in this capture.
    expect([...rows.values()].filter(r => r.maintenance)).toHaveLength(1)
  })

  it('parses the M/D/YYYY h:mm:ss AM/PM stamp as Macau wall time', () => {
    const row = rows.get('6026')
    // 2026-09-03 16:21:04 Macau = 08:21:04 UTC.
    expect(row?.time).toBe('9/3/2026 4:21:04 PM')
    expect(row?.timeParsed?.toISOString()).toBe('2026-09-03T08:21:04.000Z')
  })

  it('is an empty map for junk input instead of throwing', () => {
    expect(parseCarParkVacancyXml('').size).toBe(0)
    expect(parseCarParkVacancyXml('{"msg":"內部錯誤"}').size).toBe(0)
  })
})

describe('parseCarParkTime', () => {
  it('handles noon and midnight the 12-hour way round', () => {
    expect(parseCarParkTime('9/3/2026 12:00:00 AM')?.toISOString())
      .toBe('2026-09-02T16:00:00.000Z') // 00:00 Macau
    expect(parseCarParkTime('9/3/2026 12:00:00 PM')?.toISOString())
      .toBe('2026-09-03T04:00:00.000Z') // 12:00 Macau
  })

  it('returns null for anything it does not recognise', () => {
    expect(parseCarParkTime('-')).toBeNull()
    expect(parseCarParkTime('2026-09-03 16:21')).toBeNull()
    expect(parseCarParkTime('9/3/2026 25:00:00')).toBeNull()
  })
})

describe('pickCarParkText', () => {
  it('uses the requested language when it has content', () => {
    const field = { zh: '澳門', pt: 'Macau', en: 'Macao' }
    expect(pickCarParkText(field, 'zh')).toBe('澳門')
    expect(pickCarParkText(field, 'pt')).toBe('Macau')
    expect(pickCarParkText(field, 'en')).toBe('Macao')
  })

  it('falls back en → pt → zh, since DSAT often leaves English blank', () => {
    expect(pickCarParkText({ zh: '澳門', pt: 'Macau', en: '' }, 'en')).toBe('Macau')
    expect(pickCarParkText({ zh: '澳門', pt: '', en: '' }, 'en')).toBe('澳門')
    expect(pickCarParkText({ zh: '', pt: '', en: '' }, 'pt')).toBe('')
    expect(pickCarParkText(undefined, 'en')).toBe('')
  })
})

describe('buildCarParkFeatures', () => {
  const vacancyRow = (over: Partial<CarParkVacancy> = {}): CarParkVacancy => ({
    id: 'A', car: 42, moto: 10, eMoto: 1, eCar: 2, disabled: 3,
    maintenance: false, time: '9/3/2026 4:21:04 PM', timeParsed: null,
    ...over,
  })

  it('emits one point per car park carrying id and icon name', () => {
    const fc = buildCarParkFeatures([carPark({ id: 'A' }), carPark({ id: 'B' })])
    expect(fc.features).toHaveLength(2)
    expect(fc.features.map(f => f.properties?.id)).toEqual(['A', 'B'])
    expect(fc.features[0].properties?.icon).toBe(CAR_PARK_ICON_NAME)
    expect(fc.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [113.554413, 22.188705],
    })
  })

  it('carries the numeric id as the label-placement sort key', () => {
    const fc = buildCarParkFeatures([carPark({ id: '7070' }), carPark({ id: '6001' })])
    expect(fc.features.map(f => f.properties?.sortKey)).toEqual([7070, 6001])
    // A non-numeric id must not become NaN — it sorts last instead.
    const odd = buildCarParkFeatures([carPark({ id: 'X1' })])
    expect(odd.features[0].properties?.sortKey).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('attaches the vacant car count as a label only when it is known', () => {
    const parks = [carPark({ id: 'A' }), carPark({ id: 'B' }), carPark({ id: 'C' })]
    const vacancy = new Map<string, CarParkVacancy>([
      ['A', vacancyRow({ id: 'A', car: 42 })],
      ['B', vacancyRow({ id: 'B', car: null })],
    ])
    const props = buildCarParkFeatures(parks, vacancy).features.map(f => f.properties?.vacancy)
    // A has a count, B reports none, C has no live row at all.
    expect(props).toEqual(['42', undefined, undefined])
  })

  it('shows no count for a park whose publication is suspended', () => {
    const vacancy = new Map<string, CarParkVacancy>([
      ['A', vacancyRow({ id: 'A', car: 34, maintenance: true })],
    ])
    const fc = buildCarParkFeatures([carPark({ id: 'A' })], vacancy)
    expect(fc.features[0].properties?.vacancy).toBeUndefined()
  })

  it('labels a genuinely full park with 0 rather than dropping the label', () => {
    const vacancy = new Map<string, CarParkVacancy>([['A', vacancyRow({ id: 'A', car: 0 })]])
    const fc = buildCarParkFeatures([carPark({ id: 'A' })], vacancy)
    expect(fc.features[0].properties?.vacancy).toBe('0')
  })

  it('skips a record with no usable coordinate pair, and handles no vacancy at all', () => {
    const broken = carPark({ id: 'X', coordinates: [] as unknown as [number, number] })
    expect(buildCarParkFeatures([broken]).features).toHaveLength(0)
    expect(buildCarParkFeatures([], null)).toEqual({ type: 'FeatureCollection', features: [] })
  })
})
