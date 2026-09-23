import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OLD_MAP_SELECTION,
  LS_OLD_MAPS_HIDDEN,
  LS_OLD_MAPS_OPACITY,
  LS_OLD_MAPS_SELECTED,
  NO_HIDDEN_OLD_MAPS,
  OLD_MAPS_DEFAULT_OPACITY,
  OLD_MAPS_MIN_OPACITY,
  OLD_MAP_BUILDINGS_PAINT,
  basemapBuildingsPaint,
  clampOldMapsOpacity,
  groupOldMaps,
  groupOldMapsByCentury,
  isOldMapHidden,
  loadHiddenOldMaps,
  loadOldMapsOpacity,
  loadSelectedOldMap,
  oldMapIdFromLayer,
  oldMapLayerId,
  oldMapLegendLabel,
  oldMapGroupLabel,
  oldMapName,
  oldMapNotes,
  oldMapSourceId,
  oldMapSourceSpec,
  oldMapTitle,
  oldMapYears,
  resolveOldMapSelection,
  saveOldMapsOpacity,
  saveSelectedOldMap,
  selectOldMaps,
} from './oldMaps'
import type { LocalOldMap } from './types'

function map(over: Partial<LocalOldMap> = {}): LocalOldMap {
  return {
    id: 'guignes-1792',
    name: { zh: '小德金《澳門城平面圖》', en: 'de Guignes, Plan de la Ville de Macao', pt: 'de Guignes, Plan de la Ville de Macao' },
    title: { zh: '澳門城平面圖（1792）', en: 'Plan de la Ville de Macao (1792)', pt: 'Plan de la Ville de Macao (1792)' },
    author: 'Chrétien-Louis-Joseph de Guignes',
    year: 1792,
    published: 1808,
    work: null,
    image: '/data/old-maps/guignes-1792.webp',
    width: 2175,
    height: 2189,
    bounds: { west: 113.5155, east: 113.5683, north: 22.2212, south: 22.1721 },
    coordinates: [[113.5155, 22.2212], [113.5683, 22.2212], [113.5683, 22.1721], [113.5155, 22.1721]],
    georef: { method: 'thin-plate spline', lambda: 0.05, metresPerPixel: 2.5, controlPoints: 4, rmsM: 29.3, gcps: [] },
    scan: { holder: 'Getty Research Institute', via: 'Internet Archive', identifier: 'gri_33125008481232', url: 'https://archive.org/details/gri_33125008481232', leaves: ['n141', 'n142'], license: 'Public domain' },
    references: [],
    notes: { zh: '', en: '', pt: '' },
    attribution: 'de Guignes, 1792/1808. Scan: Getty Research Institute via Internet Archive, public domain.',
    ...over,
  }
}

describe('source / layer ids', () => {
  it('round-trips a map id through the raster layer id', () => {
    expect(oldMapIdFromLayer(oldMapLayerId('guignes-1792'))).toBe('guignes-1792')
    expect(oldMapLayerId('a')).not.toBe(oldMapSourceId('a'))
  })
  it('rejects every other layer, the bare source id included', () => {
    expect(oldMapIdFromLayer('religion-icon')).toBeNull()
    expect(oldMapIdFromLayer(oldMapSourceId('guignes-1792'))).toBeNull()
    expect(oldMapIdFromLayer('oldmap--raster')).toBeNull()
  })
})

describe('names and years', () => {
  it('picks the reading language and falls back en → zh', () => {
    const m = map()
    expect(oldMapName(m, 'zh')).toBe('小德金《澳門城平面圖》')
    expect(oldMapName(m, 'pt')).toBe('de Guignes, Plan de la Ville de Macao')
    expect(oldMapTitle(m, 'en')).toBe('Plan de la Ville de Macao (1792)')
    const partial = map({ name: { zh: '只有中文', en: '', pt: '' } })
    expect(oldMapName(partial, 'pt')).toBe('只有中文')
    expect(oldMapName(map({ name: { zh: '中', en: 'English', pt: '' } }), 'pt')).toBe('English')
    expect(oldMapNotes(map({ notes: { zh: '註', en: 'note', pt: 'nota' } }), 'pt')).toBe('nota')
    expect(oldMapNotes(map({ notes: { zh: '註', en: 'note', pt: '' } }), 'pt')).toBe('note')
  })
  it('shows the publication year only when it differs', () => {
    expect(oldMapYears(map())).toBe('1792 · 1808')
    expect(oldMapYears(map({ published: null }))).toBe('1792')
    expect(oldMapYears(map({ published: 1792 }))).toBe('1792')
    expect(oldMapYears(map({ year: 1953, published: null, yearApproximate: true }))).toBe('≈ 1953')
  })
  it('distinguishes the three 1912 sheets and identifies the corrected chart edition', () => {
    for (const lang of ['zh', 'en', 'pt'] as const) {
      const labels = ['cartografia-1912', 'taipa-1912', 'coloane-1912']
        .map(id => oldMapLegendLabel(map({ id, year: 1912, published: 1912 }), lang))
      expect(new Set(labels.map(label => label.title)).size).toBe(3)
      expect(labels.every(label => label.year === '1912')).toBe(true)
      const chart = oldMapLegendLabel(map({ id: 'admiralty-1858', year: 1858, published: null }), lang)
      expect(chart.year).toBe('1858')
      expect(chart.detail).toContain('1804')
      expect(chart.detail).toContain('1858')
    }
  })
  it('keeps a catalogued decade distinct from an exact year in the legend and source credit', () => {
    const chart = map({ id: 'hogg-1780s', year: 1780, yearPrecision: 'decade', published: null })
    expect(oldMapYears(chart)).toBe('1780s')
    for (const lang of ['zh', 'en', 'pt'] as const) {
      const label = oldMapLegendLabel(chart, lang)
      expect(label.year).toBe('1780s')
      expect(label.detail).toContain('1780')
      expect(label.title).not.toBe(oldMapLegendLabel(map({ id: 'bellin-1749' }), lang).title)
    }
  })
})

describe('basemapBuildingsPaint — the 3D buildings over a plate', () => {
  it('keeps the theme’s near-solid blocks while no plate is drawn', () => {
    expect(basemapBuildingsPaint(true, false)).toEqual({ color: '#2a2d33', opacity: 0.85 })
    expect(basemapBuildingsPaint(false, false)).toEqual({ color: '#d8d8dc', opacity: 0.85 })
  })
  it('turns them into the same paper-toned see-through model in both themes', () => {
    expect(basemapBuildingsPaint(true, true)).toEqual(OLD_MAP_BUILDINGS_PAINT)
    expect(basemapBuildingsPaint(false, true)).toEqual(OLD_MAP_BUILDINGS_PAINT)
    // See-through enough to read the plate, solid enough to read the volume.
    expect(OLD_MAP_BUILDINGS_PAINT.opacity).toBeGreaterThanOrEqual(0.3)
    expect(OLD_MAP_BUILDINGS_PAINT.opacity).toBeLessThanOrEqual(0.6)
  })
})

describe('oldMapSourceSpec — single image or tile pyramid', () => {
  it('draws a plate without tiles as its single image', () => {
    const m = map()
    expect(oldMapSourceSpec(m, 'https://example.test')).toEqual({ type: 'image', url: m.image, coordinates: m.coordinates })
  })
  it('draws a plate with tiles as a raster pyramid held to its bounds', () => {
    const m = map({ tiles: { url: '/data/old-maps/guignes-1792/{z}/{x}/{y}.webp', tileSize: 512, minzoom: 9, maxzoom: 17, count: 278 } })
    expect(oldMapSourceSpec(m, 'https://example.test')).toEqual({
      type: 'raster',
      tiles: ['https://example.test/data/old-maps/guignes-1792/{z}/{x}/{y}.webp'],
      tileSize: 512,
      minzoom: 9,
      maxzoom: 17,
      // west, south, east, north — MapLibre's order, not the JSON's
      bounds: [113.5155, 22.1721, 113.5683, 22.2212],
    })
  })
  it('keeps the {z}/{x}/{y} template intact and tolerates a trailing slash on the origin', () => {
    const m = map({ tiles: { url: '/data/old-maps/a/{z}/{x}/{y}.webp', tileSize: 512, minzoom: 9, maxzoom: 16, count: 1 } })
    const spec = oldMapSourceSpec(m, 'http://localhost:5173/')
    expect(spec.type === 'raster' && spec.tiles[0]).toBe('http://localhost:5173/data/old-maps/a/{z}/{x}/{y}.webp')
  })
})

describe('single selection', () => {
  const ids = ['bellin-1749', 'guignes-1792', 'heitor-1889', 'atlas-1912', 'dscc-1991']

  it('keeps a saved choice that the catalogue still has', () => {
    expect(resolveOldMapSelection(ids, 'guignes-1792', NO_HIDDEN_OLD_MAPS)).toBe('guignes-1792')
    // A sheet id saved by hand still means its whole atlas row.
    expect(resolveOldMapSelection(ids, 'taipa-1912', NO_HIDDEN_OLD_MAPS)).toBe('atlas-1912')
  })

  it('starts a first visit on the 1889 survey, or on the first row without it', () => {
    expect(DEFAULT_OLD_MAP_SELECTION).toBe('heitor-1889')
    expect(resolveOldMapSelection(ids, null, NO_HIDDEN_OLD_MAPS)).toBe('heitor-1889')
    expect(resolveOldMapSelection(ids, 'removed-map', NO_HIDDEN_OLD_MAPS)).toBe('heitor-1889')
    expect(resolveOldMapSelection(['bellin-1749', 'dscc-1991'], null, NO_HIDDEN_OLD_MAPS)).toBe('bellin-1749')
    expect(resolveOldMapSelection([], null, NO_HIDDEN_OLD_MAPS)).toBeNull()
  })

  it('carries over the first row the former multi-select left visible', () => {
    const hidden = new Set(['bellin-1749', 'guignes-1792', 'heitor-1889', 'dscc-1991'])
    expect(resolveOldMapSelection(ids, null, hidden)).toBe('atlas-1912')
    // A partially hidden legacy atlas still counts as visible; a fully hidden one does not.
    expect(resolveOldMapSelection(ids, null, new Set([...hidden, 'cartografia-1912', 'taipa-1912']))).toBe('atlas-1912')
    expect(resolveOldMapSelection(ids, null, new Set(['bellin-1749', 'cartografia-1912', 'taipa-1912', 'coloane-1912']))).toBe('guignes-1792')
    // Everything hidden falls back to the default; a saved choice beats the legacy set.
    expect(resolveOldMapSelection(ids, null, new Set([...hidden, 'atlas-1912']))).toBe('heitor-1889')
    expect(resolveOldMapSelection(ids, 'dscc-1991', hidden)).toBe('dscc-1991')
  })

  it('draws every sheet of the chosen row and nothing else', () => {
    const maps = [map({ id: 'bellin-1749', year: 1749 }), map(), map({ id: 'heitor-1889', year: 1889 })]
    expect(selectOldMaps(maps, 'guignes-1792')).toEqual([maps[1]])
    expect(selectOldMaps(maps, null)).toEqual([])
    expect(selectOldMaps(maps, 'unknown')).toEqual([])
  })
})

describe('1912 atlas selection', () => {
  const atlas = ['cartografia-1912', 'taipa-1912', 'coloane-1912']
    .map(id => map({ id, year: 1912, published: 1912 }))
  const maps = [map(), ...atlas, map({ id: 'unrelated-1912', year: 1912, published: 1912 })]

  it('combines only the three atlas sheets and retains each source record in catalogue order', () => {
    const groups = groupOldMaps(maps)
    expect(groups.map(group => group.id)).toEqual(['guignes-1792', 'atlas-1912', 'unrelated-1912'])
    expect(groups[1].maps).toEqual(atlas)
    expect(groups[1].maps[0]).toBe(atlas[0])
    for (const lang of ['zh', 'en', 'pt'] as const) {
      const label = oldMapGroupLabel(groups[1], lang)
      expect(label.year).toBe('1912')
      expect(label.title).not.toBe(oldMapLegendLabel(atlas[0], lang).title)
      expect(label.detail).toMatch(/半島|peninsula|península/)
    }
  })

  it('draws all three raster records together without the unrelated sheet', () => {
    expect(selectOldMaps(maps, 'atlas-1912')).toEqual(atlas)
    expect(atlas.every(sheet => isOldMapHidden(new Set(['atlas-1912']), sheet.id))).toBe(true)
  })

  it('files rows by century in catalogue order', () => {
    const groups = groupOldMaps([map({ id: 'bellin-1749', year: 1749 }), map({ id: 'hogg-1780s', year: 1780 }), map(), map({ id: 'heitor-1889', year: 1889 }), ...atlas, map({ id: 'dscc-1991', year: 1991 })])
    expect(groupOldMapsByCentury(groups).map(({ century, groups }) => [century, groups.map(group => group.id)])).toEqual([
      [18, ['bellin-1749', 'hogg-1780s', 'guignes-1792']],
      [19, ['heitor-1889']],
      [20, ['atlas-1912', 'dscc-1991']],
    ])
  })

  it('keeps one heading per century when a later entry is out of date order', () => {
    const groups = groupOldMaps([map({ id: 'heitor-1889', year: 1889 }), map({ id: 'dscc-1991', year: 1991 }), map({ id: 'sauvage-1893', year: 1893 }), map()])
    expect(groupOldMapsByCentury(groups).map(({ century, groups }) => [century, groups.map(group => group.id)])).toEqual([
      [18, ['guignes-1792']],
      [19, ['heitor-1889', 'sauvage-1893']],
      [20, ['dscc-1991']],
    ])
  })
})

describe('persistence', () => {
  function stubStorage(initial: Record<string, string> = {}, { throwOnSet = false } = {}) {
    const store = new Map(Object.entries(initial))
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { if (throwOnSet) throw new Error('quota'); store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    })
    return store
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('saves the chosen row and reads nothing when nothing was chosen', () => {
    const store = stubStorage()
    expect(loadSelectedOldMap()).toBeNull()
    saveSelectedOldMap('guignes-1792')
    expect(store.get(LS_OLD_MAPS_SELECTED)).toBe('guignes-1792')
    expect(loadSelectedOldMap()).toBe('guignes-1792')
    store.set(LS_OLD_MAPS_SELECTED, 'coloane-1912')
    expect(loadSelectedOldMap()).toBe('atlas-1912')
  })
  it('reads the former hidden set and tolerates bad stored data', () => {
    stubStorage({ [LS_OLD_MAPS_HIDDEN]: '["guignes-1792"]' })
    expect([...loadHiddenOldMaps()]).toEqual(['guignes-1792'])
    stubStorage({ [LS_OLD_MAPS_HIDDEN]: '{not json' })
    expect(loadHiddenOldMaps().size).toBe(0)
    stubStorage({ [LS_OLD_MAPS_HIDDEN]: '[1, "", "ok", null]' })
    expect([...loadHiddenOldMaps()]).toEqual(['ok'])
    stubStorage({ [LS_OLD_MAPS_HIDDEN]: '"x"' })
    expect(loadHiddenOldMaps().size).toBe(0)
  })
  it('migrates the three saved atlas switches into one atlas row', () => {
    stubStorage({ [LS_OLD_MAPS_HIDDEN]: '["cartografia-1912","taipa-1912","coloane-1912","guignes-1792"]' })
    expect(loadHiddenOldMaps()).toEqual(new Set(['atlas-1912', 'guignes-1792']))
    stubStorage({ [LS_OLD_MAPS_HIDDEN]: '["cartografia-1912","guignes-1792"]' })
    expect(loadHiddenOldMaps()).toEqual(new Set(['guignes-1792']))
  })
  it('clamps the opacity into its range and round-trips it', () => {
    const store = stubStorage()
    expect(loadOldMapsOpacity()).toBe(OLD_MAPS_DEFAULT_OPACITY)
    expect(clampOldMapsOpacity(0.05)).toBe(OLD_MAPS_MIN_OPACITY)
    expect(clampOldMapsOpacity(2)).toBe(1)
    expect(clampOldMapsOpacity(Number.NaN)).toBe(OLD_MAPS_DEFAULT_OPACITY)
    saveOldMapsOpacity(0.6)
    expect(store.get(LS_OLD_MAPS_OPACITY)).toBe('0.6')
    expect(loadOldMapsOpacity()).toBe(0.6)
    stubStorage({ [LS_OLD_MAPS_OPACITY]: 'abc' })
    expect(loadOldMapsOpacity()).toBe(OLD_MAPS_DEFAULT_OPACITY)
  })
  it('never throws when storage does', () => {
    stubStorage({}, { throwOnSet: true })
    expect(() => saveSelectedOldMap('a')).not.toThrow()
    expect(() => saveOldMapsOpacity(0.5)).not.toThrow()
  })
})
