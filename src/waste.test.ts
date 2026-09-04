/// <reference types="node" />
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LS_WASTE_TYPES_KEY,
  WASTE_COLORS,
  WASTE_INCINERATOR_COLOR,
  WASTE_INCINERATOR_ICON,
  WASTE_INCINERATOR_ID,
  WASTE_LAYER_TYPES,
  WASTE_SORT_KEY,
  WASTE_TYPES,
  buildWasteBuildingFeatures,
  buildWasteFeatures,
  countWasteByType,
  loadHiddenWasteTypes,
  pickWasteText,
  saveHiddenWasteTypes,
  visibleWasteCount,
  visibleWasteSites,
  wasteAgency,
  wasteIconName,
  wasteLegendRows,
  wasteSourceForType,
  wasteIncinerator,
  wasteSelectionId,
  wasteTypeLabel,
  visibleWasteIncinerator,
} from './waste'
import type { Translations } from './i18n'
import type { PowerFacility, WasteSite, WasteSiteType, WasteSource } from './types'

// Only the seven type labels this module reads, the way schools.test.ts does it
// — the full table is module-private in i18n.tsx.
const T = {
  wasteTypeRefuseRoom: '垃圾房',
  wasteTypeCompactor: '壓縮式垃圾收集點',
  wasteTypeSmartMachine: '智能回收機',
  wasteTypeThreeColour: '三色資源回收點',
  wasteTypeEWaste: '電腦及通訊設備回收點',
  wasteTypeLampBattery: '光管及電池回收點',
  wasteTypeIncinerator: '垃圾焚化中心',
} as Translations

function site(over: Partial<WasteSite> = {}): WasteSite {
  return {
    id: 'refuse_room-c1-1a2b3c4d',
    type: 'refuse_room',
    name: { zh: 'C1 路環船人街', pt: 'C1 Rua dos Navegantes', en: '' },
    address: null,
    coordinates: [113.551038, 22.118586],
    closed: false,
    tel: null,
    photo: null,
    upstreamStatus: null,
    ...over,
  }
}

function source(over: Partial<WasteSource> = {}): WasteSource {
  return {
    id: 'iam-garbage',
    type: 'refuse_room',
    datasetId: '57964cb5-5868-47e5-bd8d-334385467a21',
    name: { zh: '垃圾房', pt: 'Depósitos de lixo fechados' },
    url: 'https://data.gov.mo/Detail?id=57964cb5-5868-47e5-bd8d-334385467a21',
    upstreamUpdatedAt: '2026-07-02 10:00:13',
    count: 114,
    ...over,
  }
}

// The tests run in the plain node environment, so localStorage is stubbed the
// same way focusMode.test.ts stubs it rather than pulled in with jsdom.
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

describe('the six site types', () => {
  it('has exactly six, each with a colour, a distinct icon name and a sort key', () => {
    expect(WASTE_TYPES).toHaveLength(6)
    expect(new Set(WASTE_TYPES).size).toBe(6)
    const names = WASTE_TYPES.map(wasteIconName)
    expect(new Set(names).size).toBe(6)
    expect(names).toContain('waste-refuse_room')
    for (const type of WASTE_TYPES) {
      expect(WASTE_COLORS[type]).toMatch(/^#[0-9a-f]{6}$/)
      expect(Number.isInteger(WASTE_SORT_KEY[type])).toBe(true)
    }
    // Rarer types must win the collision, so their sort key must be lower.
    expect(WASTE_SORT_KEY.smart_machine).toBeLessThan(WASTE_SORT_KEY.lamp_battery)
    expect(WASTE_SORT_KEY.e_waste).toBeLessThan(WASTE_SORT_KEY.compactor)
  })

  it('attributes the two disposal kinds to IAM and the recycling kinds to DSPA', () => {
    expect(wasteAgency('refuse_room')).toBe('iam')
    expect(wasteAgency('compactor')).toBe('iam')
    for (const type of ['smart_machine', 'three_colour', 'e_waste', 'lamp_battery'] as const) {
      expect(wasteAgency(type)).toBe('dspa')
    }
  })

  it('labels every type from the translation table, with no two alike', () => {
    const labels = WASTE_TYPES.map(type => wasteTypeLabel(T, type))
    expect(labels).toEqual([
      '垃圾房', '壓縮式垃圾收集點', '智能回收機',
      '三色資源回收點', '電腦及通訊設備回收點', '光管及電池回收點',
    ])
    expect(new Set(labels).size).toBe(6)
  })
})

describe('pickWasteText', () => {
  const field = { zh: '三色回收桶', pt: 'Reciclagem tricolor', en: 'Three-colour bins' }

  it('uses the reader’s own language when the feed has it', () => {
    expect(pickWasteText(field, 'en')).toBe('Three-colour bins')
    expect(pickWasteText(field, 'zh')).toBe('三色回收桶')
    expect(pickWasteText(field, 'pt')).toBe('Reciclagem tricolor')
  })

  it('falls back en → pt → zh — the DSPA feeds publish no English', () => {
    expect(pickWasteText({ zh: '三色回收桶', pt: 'Reciclagem tricolor', en: '' }, 'en'))
      .toBe('Reciclagem tricolor')
    expect(pickWasteText({ zh: '三色回收桶', pt: '' }, 'en')).toBe('三色回收桶')
    expect(pickWasteText({ zh: '', pt: '', en: '' }, 'en')).toBe('')
  })

  it('returns an empty string for a missing or null field (refuse rooms have no address)', () => {
    expect(pickWasteText(undefined, 'en')).toBe('')
    expect(pickWasteText(null, 'zh')).toBe('')
  })
})

describe('visibleWasteSites', () => {
  const sites = [
    site({ id: 'a', type: 'refuse_room' }),
    site({ id: 'b', type: 'three_colour' }),
    site({ id: 'c', type: 'lamp_battery' }),
  ]

  it('returns the SAME array when nothing is hidden, so MapView skips a setData', () => {
    expect(visibleWasteSites(sites, new Set())).toBe(sites)
  })

  it('drops exactly the hidden types', () => {
    const out = visibleWasteSites(sites, new Set<WasteSiteType>(['three_colour']))
    expect(out.map(s => s.id)).toEqual(['a', 'c'])
  })

  it('empties the list when every type is hidden', () => {
    expect(visibleWasteSites(sites, new Set(WASTE_TYPES))).toEqual([])
  })
})

describe('countWasteByType / visibleWasteCount', () => {
  const sites = [
    site({ id: 'a', type: 'refuse_room' }),
    site({ id: 'b', type: 'refuse_room' }),
    site({ id: 'c', type: 'e_waste' }),
  ]

  it('always reports all seven keys, zero included', () => {
    const counts = countWasteByType(sites)
    expect(Object.keys(counts).sort()).toEqual([...WASTE_LAYER_TYPES].sort())
    expect(counts.refuse_room).toBe(2)
    expect(counts.e_waste).toBe(1)
    expect(counts.compactor).toBe(0)
    // No POWER record handed in → the plant row honestly reads 0.
    expect(counts.incinerator).toBe(0)
  })

  it('sums only the types that are shown', () => {
    const counts = countWasteByType(sites)
    expect(visibleWasteCount(counts, new Set())).toBe(3)
    expect(visibleWasteCount(counts, new Set<WasteSiteType>(['refuse_room']))).toBe(1)
    expect(visibleWasteCount(counts, new Set(WASTE_TYPES))).toBe(0)
  })
})

describe('wasteLegendRows', () => {
  it('is one row per type, in WASTE_LAYER_TYPES order, with label, colour, count and state', () => {
    const counts = countWasteByType([site({ type: 'compactor' })])
    const rows = wasteLegendRows(T, counts, new Set<WasteSiteType>(['e_waste']))
    expect(rows.map(r => r.id)).toEqual([...WASTE_LAYER_TYPES])
    expect(rows.find(r => r.id === 'compactor')).toMatchObject({
      count: 1, on: true, color: WASTE_COLORS.compactor,
    })
    expect(rows.find(r => r.id === 'e_waste')?.on).toBe(false)
    expect(rows.every(r => r.label.length > 0)).toBe(true)
  })
})

describe('loadHiddenWasteTypes / saveHiddenWasteTypes', () => {
  it('round-trips through storage in WASTE_TYPES order', () => {
    const store = stubStorage()
    saveHiddenWasteTypes(new Set<WasteSiteType>(['lamp_battery', 'compactor']))
    expect(store.get(LS_WASTE_TYPES_KEY)).toBe('["compactor","lamp_battery"]')
    expect([...loadHiddenWasteTypes()]).toEqual(['compactor', 'lamp_battery'])
  })

  it('hides nothing for missing, corrupt or wrongly-shaped storage', () => {
    stubStorage()
    expect(loadHiddenWasteTypes().size).toBe(0)
    stubStorage({ [LS_WASTE_TYPES_KEY]: '{not json' })
    expect(loadHiddenWasteTypes().size).toBe(0)
    stubStorage({ [LS_WASTE_TYPES_KEY]: '"a string"' })
    expect(loadHiddenWasteTypes().size).toBe(0)
  })

  it('ignores type names it does not know — a stale key cannot empty the map', () => {
    stubStorage({ [LS_WASTE_TYPES_KEY]: '["glass_bank","e_waste"]' })
    expect([...loadHiddenWasteTypes()]).toEqual(['e_waste'])
  })

  it('never lets a throwing storage break the toggle', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    expect(loadHiddenWasteTypes().size).toBe(0)
    expect(() => saveHiddenWasteTypes(new Set<WasteSiteType>(['e_waste']))).not.toThrow()
  })
})

describe('wasteSourceForType', () => {
  const sources = [
    source(),
    source({ id: 'dspa-lightbulb', type: 'lamp_battery', upstreamUpdatedAt: '2026-08-01' }),
    source({ id: 'dspa-battery', type: 'lamp_battery', upstreamUpdatedAt: '2026-08-02' }),
  ]

  it('finds the dataset a type came from, first entry winning for the twinned list', () => {
    expect(wasteSourceForType(sources, 'refuse_room')?.id).toBe('iam-garbage')
    expect(wasteSourceForType(sources, 'lamp_battery')?.id).toBe('dspa-lightbulb')
  })

  it('is null for a type with no source and for a missing list', () => {
    expect(wasteSourceForType(sources, 'compactor')).toBeNull()
    expect(wasteSourceForType(undefined, 'refuse_room')).toBeNull()
  })
})

// ---- The incineration plant -----------------------------------------------
// Not a waste.json record: the `incinerator` entry of power-facilities.json,
// read a second time by the WASTE overlay.
function plant(over: Partial<PowerFacility> = {}): PowerFacility {
  return {
    id: 'incinerator',
    type: 'incinerator',
    operator: 'dspa',
    voltageKv: null,
    name: {
      zh: '澳門垃圾焚化中心',
      en: 'Macau Refuse Incineration Plant',
      pt: 'Central de Incineração de Resíduos Sólidos de Macau',
    },
    coordinates: [113.572298, 22.160604],
    approximate: false,
    anchor: null,
    source: 'dspa',
    osm: ['w530851414'],
    buildings: [{
      osmId: 'w530851414', name: null, kind: 'building', height: 24, minHeight: 0,
      coordinates: [[[113.5722, 22.1605], [113.5724, 22.1605], [113.5724, 22.1607], [113.5722, 22.1605]]],
    }],
    details: null,
    ...over,
  } as PowerFacility
}

describe('the incineration plant', () => {
  it('is found by id AND type, so no other station can be promoted into WASTE', () => {
    expect(wasteIncinerator([plant()])?.id).toBe(WASTE_INCINERATOR_ID)
    expect(wasteIncinerator([plant({ type: 'plant' })])).toBeNull()
    expect(wasteIncinerator([plant({ id: 'coloane' })])).toBeNull()
    expect(wasteIncinerator([])).toBeNull()
    expect(wasteIncinerator(undefined)).toBeNull()
  })

  it('is the seventh key row — last, lime, count 1, and hideable like the rest', () => {
    const counts = countWasteByType([site()], plant())
    const rows = wasteLegendRows(T, counts, new Set())
    expect(rows).toHaveLength(7)
    expect(rows[6]).toMatchObject({
      id: WASTE_INCINERATOR_ID, count: 1, on: true, color: WASTE_INCINERATOR_COLOR,
    })
    expect(rows[6].label).toBe('垃圾焚化中心')
    const hidden = wasteLegendRows(T, counts, new Set([WASTE_INCINERATOR_ID]))
    expect(hidden[6].on).toBe(false)
  })

  it('adds exactly 1 to the row total, and hiding it takes that 1 away', () => {
    const counts = countWasteByType([site(), site({ id: 'b' })], plant())
    expect(visibleWasteCount(counts, new Set())).toBe(3)
    expect(visibleWasteCount(counts, new Set([WASTE_INCINERATOR_ID]))).toBe(2)
  })

  it('is drawn only when its row is on', () => {
    const p = plant()
    expect(visibleWasteIncinerator(p, new Set())).toBe(p)
    expect(visibleWasteIncinerator(p, new Set([WASTE_INCINERATOR_ID]))).toBeNull()
    expect(visibleWasteIncinerator(null, new Set())).toBeNull()
  })

  it('persists in the same hidden-type storage as the six site types', () => {
    const store = stubStorage()
    saveHiddenWasteTypes(new Set([WASTE_INCINERATOR_ID, 'compactor' as WasteSiteType]))
    expect(store.get(LS_WASTE_TYPES_KEY)).toBe('["compactor","incinerator"]')
    expect([...loadHiddenWasteTypes()]).toEqual(['compactor', 'incinerator'])
  })

  it('rides in the same symbol source as the bins, drawn last and never dimmed', () => {
    const fc = buildWasteFeatures([site({ id: 'A' })], plant())
    expect(fc.features).toHaveLength(2)
    const mark = fc.features[1]
    expect(mark.properties).toMatchObject({
      id: WASTE_INCINERATOR_ID, icon: WASTE_INCINERATOR_ICON, closed: false,
    })
    expect(mark.properties?.sortKey).toBeGreaterThan(Math.max(...Object.values(WASTE_SORT_KEY)))
    expect(mark.geometry).toEqual({ type: 'Point', coordinates: [113.572298, 22.160604] })
    // No plant → the bins alone, exactly as before.
    expect(buildWasteFeatures([site({ id: 'A' })], null).features).toHaveLength(1)
  })

  it('extrudes its footprints in lime, with the +2 m margin and the promoted id', () => {
    const fc = buildWasteBuildingFeatures(plant())
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties).toMatchObject({
      facilityId: WASTE_INCINERATOR_ID, color: WASTE_INCINERATOR_COLOR, height: 26, minHeight: 0,
    })
    expect(buildWasteBuildingFeatures(null).features).toHaveLength(0)
    // A footprint with no usable ring is skipped, not emitted as empty geometry.
    const broken = plant({ buildings: [{ ...plant().buildings[0], coordinates: [] }] })
    expect(buildWasteBuildingFeatures(broken).features).toHaveLength(0)
  })

  it('shares the marker highlight: one selection slot, one feature id', () => {
    expect(wasteSelectionId({ kind: 'site', site: site({ id: 'A' }) })).toBe('A')
    expect(wasteSelectionId({ kind: 'incinerator', facility: plant() })).toBe('incinerator')
    expect(wasteSelectionId(null)).toBeNull()
  })

  it('is a DSPA facility, like the four recycling kinds', () => {
    expect(wasteAgency(WASTE_INCINERATOR_ID)).toBe('dspa')
  })
})

// The committed file, run through the same helpers the UI uses. dataSchemas
// .test.ts already proves waste.json satisfies the zod contract; this proves the
// overlay's own arithmetic agrees with it — all six types present, and the
// pipeline's `counts` block matching what the legend would actually show.
describe('public/data/waste.json through the overlay helpers', () => {
  const file = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'public', 'data', 'waste.json'), 'utf8')
  ) as { counts?: Record<string, number>; sites: WasteSite[] }

  it('carries all six types, and countWasteByType reproduces the published counts', () => {
    const counts = countWasteByType(file.sites)
    for (const type of WASTE_TYPES) expect(counts[type]).toBeGreaterThan(0)
    expect(visibleWasteCount(counts, new Set())).toBe(file.sites.length)
    if (file.counts) {
      for (const type of WASTE_TYPES) expect(counts[type]).toBe(file.counts[type])
    }
  })

  it('builds one drawable feature per site, and hiding a type removes exactly its own', () => {
    expect(buildWasteFeatures(file.sites).features).toHaveLength(file.sites.length)
    const counts = countWasteByType(file.sites)
    const kept = visibleWasteSites(file.sites, new Set<WasteSiteType>(['lamp_battery']))
    expect(kept).toHaveLength(file.sites.length - counts.lamp_battery)
    expect(kept.some(s => s.type === 'lamp_battery')).toBe(false)
  })
})

describe('buildWasteFeatures', () => {
  it('emits one point per site with id, type, icon, closed flag and sort key', () => {
    const fc = buildWasteFeatures([
      site({ id: 'A' }),
      site({ id: 'B', type: 'e_waste', closed: true }),
    ])
    expect(fc.features).toHaveLength(2)
    expect(fc.features.map(f => f.properties?.icon))
      .toEqual(['waste-refuse_room', 'waste-e_waste'])
    expect(fc.features.map(f => f.properties?.closed)).toEqual([false, true])
    expect(fc.features[1].properties?.sortKey).toBe(WASTE_SORT_KEY.e_waste)
    expect(fc.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [113.551038, 22.118586],
    })
  })

  it('keeps two sites that share a coordinate — the map collides them, not us', () => {
    const shared: [number, number] = [113.54, 22.19]
    const fc = buildWasteFeatures([
      site({ id: 'A', coordinates: shared }),
      site({ id: 'B', type: 'compactor', coordinates: shared }),
    ])
    expect(fc.features).toHaveLength(2)
  })

  it('skips a record with no usable coordinate pair', () => {
    const broken = site({ id: 'X', coordinates: [] as unknown as [number, number] })
    expect(buildWasteFeatures([broken]).features).toHaveLength(0)
  })

  it('is an empty FeatureCollection for an empty list', () => {
    expect(buildWasteFeatures([])).toEqual({ type: 'FeatureCollection', features: [] })
  })
})
