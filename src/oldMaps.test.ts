import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LS_OLD_MAPS_HIDDEN,
  LS_OLD_MAPS_OPACITY,
  NO_HIDDEN_OLD_MAPS,
  OLD_MAPS_DEFAULT_OPACITY,
  OLD_MAPS_MIN_OPACITY,
  OLD_MAP_BUILDINGS_PAINT,
  basemapBuildingsPaint,
  clampOldMapsOpacity,
  filterOldMaps,
  loadHiddenOldMaps,
  loadOldMapsOpacity,
  oldMapIdFromLayer,
  oldMapLayerId,
  oldMapName,
  oldMapNotes,
  oldMapSourceId,
  oldMapSourceSpec,
  oldMapTitle,
  oldMapYears,
  saveHiddenOldMaps,
  saveOldMapsOpacity,
} from './oldMaps'
import type { OldMap } from './types'

function map(over: Partial<OldMap> = {}): OldMap {
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

describe('filterOldMaps', () => {
  const maps = [map(), map({ id: 'later-1889', year: 1889, published: null })]
  it('keeps the array identity when nothing listed is hidden', () => {
    expect(filterOldMaps(maps, NO_HIDDEN_OLD_MAPS)).toBe(maps)
    expect(filterOldMaps(maps, new Set(['unknown']))).toBe(maps)
  })
  it('drops the hidden maps otherwise', () => {
    expect(filterOldMaps(maps, new Set(['guignes-1792'])).map(m => m.id)).toEqual(['later-1889'])
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

  it('hides nothing by default and round-trips the hidden set', () => {
    const store = stubStorage()
    expect(loadHiddenOldMaps().size).toBe(0)
    saveHiddenOldMaps(new Set(['guignes-1792']))
    expect(store.get(LS_OLD_MAPS_HIDDEN)).toBe('["guignes-1792"]')
    expect([...loadHiddenOldMaps()]).toEqual(['guignes-1792'])
  })
  it('tolerates bad stored data', () => {
    stubStorage({ [LS_OLD_MAPS_HIDDEN]: '{not json' })
    expect(loadHiddenOldMaps().size).toBe(0)
    stubStorage({ [LS_OLD_MAPS_HIDDEN]: '[1, "", "ok", null]' })
    expect([...loadHiddenOldMaps()]).toEqual(['ok'])
    stubStorage({ [LS_OLD_MAPS_HIDDEN]: '"x"' })
    expect(loadHiddenOldMaps().size).toBe(0)
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
    expect(() => saveHiddenOldMaps(new Set(['a']))).not.toThrow()
    expect(() => saveOldMapsOpacity(0.5)).not.toThrow()
  })
})
