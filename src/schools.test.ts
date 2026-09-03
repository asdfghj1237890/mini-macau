import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ALL_SCHOOL_LEVELS,
  SCHOOL_COLORS,
  SCHOOL_FEATURE_ID_PROPERTY,
  SCHOOL_LEVEL_ORDER,
  buildSchoolFeatures,
  countSchoolsByLevel,
  filterSchoolsByLevel,
  loadSchoolLevelsOn,
  saveSchoolLevelsOn,
  schoolDsedjCode,
  schoolLevelLabel,
  schoolSystemLabel,
} from './schools'
import type { Translations } from './i18n'
import type { School, SchoolBuilding, SchoolLevel } from './types'

const RING: [number, number][][] = [[
  [113.5483, 22.2012], [113.5484, 22.2012], [113.5484, 22.2013], [113.5483, 22.2012],
]]

function building(over: Partial<SchoolBuilding> = {}): SchoolBuilding {
  return { osmId: 'w1', name: 'A座', height: 15.8, minHeight: 0, coordinates: RING, ...over }
}

function school(over: Partial<School> = {}): School {
  return {
    id: 'dsedj:[002]',
    name: { zh: '培正中學', pt: 'Escola Secundária Pui Ching' },
    level: 'all_through',
    levels: { kindergarten: true, primary: true, secondary: true },
    system: 'private',
    coordinates: [113.551476, 22.164204],
    osm: ['w265433532'],
    buildings: [building()],
    ...over,
  }
}

describe('SCHOOL_COLORS', () => {
  it('carries the five user-specified level colours', () => {
    expect(SCHOOL_COLORS).toEqual({
      kindergarten: '#ef4444',
      primary: '#f472b6',
      secondary: '#3b82f6',
      university: '#22c55e',
      all_through: '#a855f7',
    })
  })

  it('has one legend swatch per colour, in stage order', () => {
    expect([...SCHOOL_LEVEL_ORDER]).toEqual(Object.keys(SCHOOL_COLORS))
    expect(new Set(Object.values(SCHOOL_COLORS)).size).toBe(5)
  })
})

describe('schoolLevelLabel', () => {
  const t = {
    schoolLevelKindergarten: '幼稚園',
    schoolLevelPrimary: '小學',
    schoolLevelSecondary: '中學',
    schoolLevelUniversity: '大學',
    schoolLevelAllThrough: '一條龍',
  } as Translations

  it('labels every level from the translation table', () => {
    expect([...SCHOOL_LEVEL_ORDER].map(l => schoolLevelLabel(t, l)))
      .toEqual(['幼稚園', '小學', '中學', '大學', '一條龍'])
  })
})

describe('schoolSystemLabel', () => {
  const t = {
    schoolSystemPrivate: '私立學校',
    schoolSystemPublic: '公立學校',
    schoolSystemTertiary: '高等院校',
  } as Translations

  it('labels the three systems schools.json uses', () => {
    expect(schoolSystemLabel(t, 'private')).toBe('私立學校')
    expect(schoolSystemLabel(t, 'public')).toBe('公立學校')
    expect(schoolSystemLabel(t, 'tertiary')).toBe('高等院校')
  })

  it('falls back to the private wording for an unknown system', () => {
    expect(schoolSystemLabel(t, '')).toBe('私立學校')
    expect(schoolSystemLabel(t, 'something-else')).toBe('私立學校')
  })
})

describe('schoolDsedjCode', () => {
  it('strips the brackets off a DSEDJ id', () => {
    expect(schoolDsedjCode('dsedj:[002]')).toBe('002')
    expect(schoolDsedjCode('dsedj:[H01]')).toBe('H01')
  })

  it('has no code for an OSM-sourced institution', () => {
    expect(schoolDsedjCode('osm:w265433532')).toBeNull()
    expect(schoolDsedjCode('dsedj:002')).toBeNull()
  })
})

describe('buildSchoolFeatures', () => {
  it('emits one Polygon feature per building, coloured by the school level', () => {
    const fc = buildSchoolFeatures([
      school({ id: 'a', level: 'primary', buildings: [building({ osmId: 'w1' }), building({ osmId: 'w2' })] }),
      school({ id: 'b', level: 'university', buildings: [building({ osmId: 'w3', height: 40, minHeight: 3 })] }),
    ])
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(3)
    expect(fc.features[0].geometry).toEqual({ type: 'Polygon', coordinates: RING })
    expect(fc.features[0].properties).toEqual({
      schoolId: 'a', level: 'primary', color: '#f472b6', height: 17.8, minHeight: 0, name: 'A座',
    })
    expect(fc.features[2].properties).toMatchObject({
      schoolId: 'b', color: '#22c55e', height: 42, minHeight: 3,
    })
  })

  it('keeps an unnamed footprint but skips one with no usable ring', () => {
    const fc = buildSchoolFeatures([school({
      buildings: [
        building({ osmId: 'w1', name: null }),
        building({ osmId: 'w2', coordinates: [] }),
        building({ osmId: 'w3', coordinates: [[]] }),
      ],
    })])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.name).toBeNull()
  })

  it('is empty for no schools and for a school with no matched footprint', () => {
    expect(buildSchoolFeatures([]).features).toHaveLength(0)
    expect(buildSchoolFeatures([school({ buildings: [] })]).features).toHaveLength(0)
  })

  it('tags every building of a school with the promoted feature id', () => {
    // MapLibre promotes this property to the feature id (promoteId), so all
    // of one school's blocks must share it for the highlight to cover the
    // whole campus in a single setFeatureState call.
    const fc = buildSchoolFeatures([
      school({ id: 'a', buildings: [building({ osmId: 'w1' }), building({ osmId: 'w2' })] }),
      school({ id: 'b', buildings: [building({ osmId: 'w3' })] }),
    ])
    expect(fc.features.map(f => f.properties?.[SCHOOL_FEATURE_ID_PROPERTY]))
      .toEqual(['a', 'a', 'b'])
  })

  it('colours every level distinctly', () => {
    const levels = [...SCHOOL_LEVEL_ORDER] as SchoolLevel[]
    const fc = buildSchoolFeatures(levels.map((level, i) => school({ id: `s${i}`, level })))
    expect(fc.features.map(f => f.properties?.color)).toEqual(levels.map(l => SCHOOL_COLORS[l]))
  })
})

// One school of every level, in SCHOOL_LEVEL_ORDER, plus a second university.
const MIXED: School[] = [
  ...SCHOOL_LEVEL_ORDER.map((level, i) => school({ id: `s${i}`, level })),
  school({ id: 'u2', level: 'university' }),
]

describe('ALL_SCHOOL_LEVELS', () => {
  it('holds exactly the five levels the legend lists', () => {
    expect([...ALL_SCHOOL_LEVELS].sort()).toEqual([...SCHOOL_LEVEL_ORDER].sort())
  })
})

describe('filterSchoolsByLevel', () => {
  it('keeps only schools whose level is enabled', () => {
    const on = new Set<SchoolLevel>(['primary', 'university'])
    expect(filterSchoolsByLevel(MIXED, on).map(s => s.id)).toEqual(['s1', 's3', 'u2'])
  })

  it('returns the SAME array when every level is on, so the map skips setData', () => {
    expect(filterSchoolsByLevel(MIXED, ALL_SCHOOL_LEVELS)).toBe(MIXED)
    expect(filterSchoolsByLevel(MIXED, new Set(SCHOOL_LEVEL_ORDER))).toBe(MIXED)
  })

  it('is empty when no level is on', () => {
    expect(filterSchoolsByLevel(MIXED, new Set())).toEqual([])
  })
})

describe('countSchoolsByLevel', () => {
  it('counts each level and keeps a zero for levels with no schools', () => {
    expect(countSchoolsByLevel(MIXED)).toEqual({
      kindergarten: 1, primary: 1, secondary: 1, university: 2, all_through: 1,
    })
    expect(countSchoolsByLevel([])).toEqual({
      kindergarten: 0, primary: 0, secondary: 0, university: 0, all_through: 0,
    })
  })

  it('sums to the total, so the header can show enabled/total', () => {
    const counts = countSchoolsByLevel(MIXED)
    const total = SCHOOL_LEVEL_ORDER.reduce((sum, level) => sum + counts[level], 0)
    expect(total).toBe(MIXED.length)
  })
})

describe('loadSchoolLevelsOn / saveSchoolLevelsOn', () => {
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

  it('round-trips a subset of levels', () => {
    stubStorage()
    saveSchoolLevelsOn(new Set<SchoolLevel>(['secondary', 'kindergarten']))
    expect([...loadSchoolLevelsOn()]).toEqual(['kindergarten', 'secondary'])
  })

  it('round-trips "nothing on" rather than resetting to all on', () => {
    stubStorage()
    saveSchoolLevelsOn(new Set())
    expect([...loadSchoolLevelsOn()]).toEqual([])
  })

  it('falls back to all levels when storage is missing, corrupt, or not an array', () => {
    stubStorage()
    expect(loadSchoolLevelsOn()).toBe(ALL_SCHOOL_LEVELS)
    stubStorage({ 'mini-macau-school-levels-on': 'not json' })
    expect(loadSchoolLevelsOn()).toBe(ALL_SCHOOL_LEVELS)
    stubStorage({ 'mini-macau-school-levels-on': '{"primary":true}' })
    expect(loadSchoolLevelsOn()).toBe(ALL_SCHOOL_LEVELS)
  })

  it('drops level names it does not recognise', () => {
    stubStorage({ 'mini-macau-school-levels-on': '["primary","vocational",7]' })
    expect([...loadSchoolLevelsOn()]).toEqual(['primary'])
  })

  it('survives storage that throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    expect(loadSchoolLevelsOn()).toBe(ALL_SCHOOL_LEVELS)
    expect(() => saveSchoolLevelsOn(ALL_SCHOOL_LEVELS)).not.toThrow()
  })
})
