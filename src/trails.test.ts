import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  ALL_TRAIL_KINDS,
  TRAIL_CLOSED_COLOR,
  TRAIL_COLORS,
  TRAIL_KIND_ORDER,
  TRAIL_PAVILION_ICON,
  SUMMIT_PHOTOGRAPHER_COLOR,
  TRAIL_SUMMIT_ICON,
  buildTrailLineFeatures,
  buildTrailPointFeatures,
  countTrailPosts,
  countTrailsByKind,
  entranceBearing,
  filterTrailsByKind,
  isTrailClosed,
  loadTrailKindsOn,
  nearestTrail,
  pickTrailText,
  saveTrailKindsOn,
  summitHeightText,
  summitPhotographerPoses,
  summitReachedFrom,
  summitTrail,
  trailEntranceIconName,
  trailLabelField,
  trailHikerPoses,
  trailSummitsFor,
  trailSuspensionAt,
  upcomingTrailSuspension,
} from './trails'
import type { Trail, TrailPost, TrailSpur, TrailSummit } from './types'

const text = (zh: string, pt = '', en = '') => ({ zh, pt, en })

function trail(over: Partial<Trail> = {}): Trail {
  return {
    id: 'a',
    code: '1-01',
    kind: 'walk',
    area: 'coloane',
    name: text('路環步行徑', 'Trilho de Coloane', 'Coloane Trail'),
    entrance: text('路環高頂馬路'),
    exit: text('路環高頂馬路'),
    openHours: text('全日', 'aberto 24 horas', 'Whole day'),
    phone: null,
    lengthM: 8100,
    drawnLengthM: 7579,
    closed: false,
    suspensions: [],
    entrances: [[113.5588, 22.1221]],
    webLink: 'https://www.iam.gov.mo/',
    geometry: { source: 'gis', retrievedAt: '2026-09-27', osmIds: null, lines: [[[113.55, 22.12], [113.56, 22.12]]] },
    osmCheck: { medianM: 1.6, p90M: 3.3, within15Pct: 100 },
    ...over,
  }
}

describe('pickTrailText / trailLabelField', () => {
  it('gives each language its own form and falls back when one is blank', () => {
    const t = text('路環步行徑', 'Trilho de Coloane', 'Coloane Trail')
    expect(pickTrailText(t, 'zh')).toBe('路環步行徑')
    expect(pickTrailText(t, 'pt')).toBe('Trilho de Coloane')
    expect(pickTrailText(t, 'en')).toBe('Coloane Trail')
    expect(pickTrailText(text('名', '', ''), 'en')).toBe('名')
    expect(pickTrailText(undefined, 'zh')).toBe('')
  })

  it('names the label property per language', () => {
    expect(trailLabelField('zh')).toBe('name_zh')
    expect(trailLabelField('pt')).toBe('name_pt')
    expect(trailLabelField('en')).toBe('name_en')
  })
})

describe('suspensions', () => {
  const t = trail({ suspensions: [{ from: '2025-10-06', to: '2026-04-29' }, { from: '2026-10-05', to: '2026-10-09' }] })

  it('treats both ends of a window as closed days', () => {
    expect(trailSuspensionAt(t, '2025-10-05')).toBeNull()
    expect(trailSuspensionAt(t, '2025-10-06')).toEqual({ from: '2025-10-06', to: '2026-04-29' })
    expect(trailSuspensionAt(t, '2026-04-29')).not.toBeNull()
    expect(trailSuspensionAt(t, '2026-04-30')).toBeNull()
  })

  it('announces a suspension that starts within the horizon', () => {
    expect(upcomingTrailSuspension(t, '2026-09-27')).toEqual({ from: '2026-10-05', to: '2026-10-09' })
    expect(upcomingTrailSuspension(t, '2026-09-01')).toBeNull()
    expect(upcomingTrailSuspension(t, '2026-10-05')).toBeNull()
  })

  it('counts the undated tempClose flag as closed on every date', () => {
    expect(isTrailClosed(t, '2026-01-01')).toBe(true)
    expect(isTrailClosed(t, '2026-09-27')).toBe(false)
    expect(isTrailClosed(trail({ closed: true }), '1999-01-01')).toBe(true)
  })
})

describe('buildTrailLineFeatures', () => {
  it('colours open trails by kind and suspended ones grey', () => {
    const fc = buildTrailLineFeatures([
      trail(),
      trail({ id: 'c', kind: 'cycle', code: null }),
      trail({ id: 's', suspensions: [{ from: '2026-09-01', to: '2026-09-30' }] }),
    ], '2026-09-27')
    expect(fc.features.map(f => f.properties?.color)).toEqual([TRAIL_COLORS.walk, TRAIL_COLORS.cycle, TRAIL_CLOSED_COLOR])
    expect(fc.features.map(f => f.properties?.closed)).toEqual([false, false, true])
    expect(fc.features[0].geometry.type).toBe('MultiLineString')
    expect(fc.features[0].properties?.name_en).toBe('Coloane Trail')
  })

  it('skips degenerate lines and trails with nothing drawable', () => {
    const fc = buildTrailLineFeatures([
      trail({ geometry: { source: 'gis', retrievedAt: '2026-09-27', osmIds: null, lines: [[[113.5, 22.1]]] } }),
    ], '2026-09-27')
    expect(fc.features).toHaveLength(0)
  })

  it('falls back to another language for a missing label', () => {
    const fc = buildTrailLineFeatures([trail({ name: text('無名徑') })], '2026-09-27')
    expect(fc.features[0].properties?.name_pt).toBe('無名徑')
    expect(fc.features[0].properties?.name_en).toBe('無名徑')
  })
})

describe('buildTrailPointFeatures', () => {
  const posts: TrailPost[] = [
    { code: '1-01-01', trail: '1-01', coordinates: [113.551, 22.12] },
    { code: '2-01-06', trail: '2-01', coordinates: [113.57, 22.16] },
  ]

  it('emits entrances, posts on a visible trail, and pavilions', () => {
    const fc = buildTrailPointFeatures(
      [trail({ entrances: [[113.55, 22.12], [113.56, 22.12]] })],
      posts,
      [{ name: '峰景亭', coordinates: [113.555, 22.121] }, { name: null, coordinates: [113.556, 22.122] }],
      '2026-09-27',
    )
    const byKind = (kind: string) => fc.features.filter(f => f.properties?.kind === kind)
    expect(byKind('entrance').map(f => f.properties?.index)).toEqual([0, 1])
    expect(byKind('entrance')[0].properties?.icon).toBe(trailEntranceIconName('walk'))
    // 2-01's trail is not in the list, so its post is dropped.
    expect(byKind('post').map(f => f.properties?.code)).toEqual(['1-01-01'])
    expect(byKind('post')[0].properties?.trailId).toBe('a')
    expect(byKind('pavilion').map(f => [f.properties?.index, f.properties?.name, f.properties?.icon]))
      .toEqual([[0, '峰景亭', TRAIL_PAVILION_ICON], [1, '', TRAIL_PAVILION_ICON]])
  })

  it('marks the entrances of a suspended trail', () => {
    const fc = buildTrailPointFeatures([trail({ closed: true })], [], [], '2026-09-27')
    expect(fc.features[0].properties?.closed).toBe(true)
  })
})

describe('summits and climbs', () => {
  const summit = (over: Partial<TrailSummit> = {}): TrailSummit => ({
    id: 'coloane-alto',
    name: text('疊石塘山', 'Coloane Alto', 'Coloane Alto'),
    heightM: 170.6,
    coordinates: [113.561267, 22.120709],
    trig: 'A31',
    access: [{ trail: 'b', via: 'spur', distanceM: 8 }, { trail: 'a', via: 'spur', distanceM: 8 }],
    ...over,
  })
  const spur: TrailSpur = {
    id: 'hou-hon-po',
    name: text('好漢坡', 'O Declive do Verdadeiro Homem', 'True Man Slope'),
    summit: 'coloane-alto',
    trails: ['b', 'a'],
    osmIds: ['w264076934'],
    lines: [[[113.561658, 22.119018], [113.561317, 22.120651]]],
  }

  it('formats the official height with one decimal', () => {
    expect(summitHeightText(summit({ heightM: 90 }))).toBe('90.0 m')
  })

  it('labels a summit with its name over its height, and drops one with no trail on the map', () => {
    const fc = buildTrailPointFeatures([trail()], [], [], '2026-09-27', [summit(), summit({ id: 'far', access: [{ trail: 'zzz', via: 'near', distanceM: 90 }] })])
    const summits = fc.features.filter(f => f.properties?.kind === 'summit')
    expect(summits.map(f => f.properties?.summitId)).toEqual(['coloane-alto'])
    expect(summits[0].properties?.name_zh).toBe('疊石塘山\n170.6 m')
    expect(summits[0].properties?.icon).toBe(TRAIL_SUMMIT_ICON)
  })

  it('draws a climb dotted, opened through the first of its trails that is on the map', () => {
    const fc = buildTrailLineFeatures([trail()], '2026-09-27', [spur])
    const f = fc.features.find(x => x.properties?.spur)
    expect(f?.properties?.trailId).toBe('a')
    expect(f?.properties?.name_en).toBe('True Man Slope')
    expect(buildTrailLineFeatures([trail({ id: 'z' })], '2026-09-27', [spur]).features.some(x => x.properties?.spur)).toBe(false)
  })

  it('lists a trail’s summits by how it reaches them, then by height', () => {
    const on = summit({ id: 'top', heightM: 60.7, access: [{ trail: 'a', via: 'trail', distanceM: 16 }] })
    const near = summit({ id: 'near', heightM: 110.4, access: [{ trail: 'a', via: 'near', distanceM: 91 }] })
    const other = summit({ id: 'other', access: [{ trail: 'x', via: 'trail', distanceM: 2 }] })
    expect(trailSummitsFor([near, summit(), on, other], trail()).map(s => s.summit.id)).toEqual(['top', 'coloane-alto', 'near'])
  })

  it('opens the closest way up whose trail is on the map', () => {
    expect(summitTrail(summit(), [trail(), trail({ id: 'b' })])?.id).toBe('b')
    expect(summitTrail(summit(), [trail()])?.id).toBe('a')
    expect(summitTrail(summit(), [])).toBeNull()
  })
})

describe('hikers', () => {
  // A straight trail heading east from its entrance.
  const east = trail({
    entrances: [[113.55, 22.12]],
    geometry: { source: 'gis', retrievedAt: '2026-09-27', osmIds: null, lines: [[[113.55, 22.12], [113.5502, 22.12], [113.5504, 22.12], [113.551, 22.12]]] },
  })

  it('faces up the trail from an entrance at its end', () => {
    expect(entranceBearing(east, [113.55, 22.12])).toBeCloseTo(90, 0)
    // The same line entered from its other end faces west.
    expect(entranceBearing(east, [113.551, 22.12])).toBeCloseTo(270, 0)
  })

  it('faces the line when the entrance is off it', () => {
    // 100 m south of the start.
    expect(entranceBearing(east, [113.55, 22.1191])).toBeCloseTo(0, 0)
  })

  it('stands one hiker at each entrance of an open walking trail, none on cycle tracks or closed trails', () => {
    const poses = trailHikerPoses([
      trail({ entrances: [[113.55, 22.12], [113.56, 22.12]] }),
      trail({ id: 'c', kind: 'cycle' }),
      trail({ id: 's', suspensions: [{ from: '2026-09-01', to: '2026-09-30' }] }),
    ], '2026-09-27')
    expect(poses).toHaveLength(2)
    expect(poses.every(p => p.color === TRAIL_COLORS.walk && Number.isFinite(p.bearing))).toBe(true)
  })

  it('tags each entrance with its trail kind for the flag fade', () => {
    const fc = buildTrailPointFeatures([trail({ id: 'c', kind: 'cycle' })], [], [], '2026-09-27')
    expect(fc.features[0].properties?.trailKind).toBe('cycle')
  })
})

describe('summit photographers', () => {
  const peak = (access: TrailSummit['access'], id = 'p'): TrailSummit => ({
    id, name: text('大潭山', 'Taipa Grande', 'Taipa Grande'), heightM: 158.2,
    coordinates: [113.551, 22.12], trig: 'A21', access,
  })
  // The trail runs east along 22.12 and ends at the summit.
  const ridge = trail({ geometry: { source: 'gis', retrievedAt: '2026-09-27', osmIds: null, lines: [[[113.549, 22.12], [113.5505, 22.12], [113.551, 22.12]]] } })

  it('counts a summit as reached only by an open walking trail within 30 m', () => {
    expect(summitReachedFrom(peak([{ trail: 'a', via: 'trail', distanceM: 2 }]), [ridge], '2026-09-27')?.via).toBe('trail')
    expect(summitReachedFrom(peak([{ trail: 'a', via: 'near', distanceM: 91 }]), [ridge], '2026-09-27')).toBeNull()
    // A climb that stops 38 m short does not reach the top.
    expect(summitReachedFrom(peak([{ trail: 'a', via: 'spur', distanceM: 38 }]), [ridge], '2026-09-27')).toBeNull()
    expect(summitReachedFrom(peak([{ trail: 'a', via: 'trail', distanceM: 2 }]), [trail({ closed: true })], '2026-09-27')).toBeNull()
    expect(summitReachedFrom(peak([{ trail: 'a', via: 'trail', distanceM: 2 }]), [], '2026-09-27')).toBeNull()
  })

  it('faces onward past the top, away from the way up', () => {
    const [pose] = summitPhotographerPoses([peak([{ trail: 'a', via: 'trail', distanceM: 2 }])], [ridge], [], '2026-09-27')
    // Came up from the west, so looks east.
    expect(pose.bearing).toBeCloseTo(90, 0)
    expect(pose.color).toBe(SUMMIT_PHOTOGRAPHER_COLOR)
  })

  it('uses the climb for the way up when the summit is reached by one', () => {
    const climb: TrailSpur = {
      id: 'c', name: text('登頂路'), summit: 'p', trails: ['a'], osmIds: ['w1'],
      // Up from the south.
      lines: [[[113.551, 22.1195], [113.551, 22.1198], [113.551, 22.12]]],
    }
    const [pose] = summitPhotographerPoses([peak([{ trail: 'a', via: 'spur', distanceM: 4 }])], [ridge], [climb], '2026-09-27')
    expect(pose.bearing).toBeCloseTo(0, 0)
  })
})

describe('kind filter and counts', () => {
  const trails = [trail(), trail({ id: 'c', kind: 'cycle', code: null })]

  it('keeps the array identity when both kinds are on', () => {
    expect(filterTrailsByKind(trails, ALL_TRAIL_KINDS)).toBe(trails)
    expect(filterTrailsByKind(trails, new Set(['cycle'] as const)).map(t => t.id)).toEqual(['c'])
    expect(filterTrailsByKind(trails, new Set())).toHaveLength(0)
  })

  it('counts both kinds, zero included', () => {
    expect(countTrailsByKind(trails)).toEqual({ walk: 1, cycle: 1 })
    expect(countTrailsByKind([])).toEqual({ walk: 0, cycle: 0 })
  })

  it('counts a trail’s distance posts by code', () => {
    const posts: TrailPost[] = [
      { code: '1-01-01', trail: '1-01', coordinates: [0, 0] },
      { code: '1-01-02', trail: '1-01', coordinates: [0, 0] },
      { code: '1-02-B1', trail: '1-02', coordinates: [0, 0] },
    ]
    expect(countTrailPosts(posts, trail())).toBe(2)
    expect(countTrailPosts(posts, trail({ code: null }))).toBe(0)
  })
})

describe('nearestTrail', () => {
  it('picks the trail whose line passes closest, in metres', () => {
    const north = trail({ id: 'n', geometry: { source: 'gis', retrievedAt: '2026-09-27', osmIds: null, lines: [[[113.55, 22.13], [113.56, 22.13]]] } })
    const south = trail({ id: 's', geometry: { source: 'gis', retrievedAt: '2026-09-27', osmIds: null, lines: [[[113.55, 22.12], [113.56, 22.12]]] } })
    const hit = nearestTrail([north, south], [113.555, 22.1201])
    expect(hit?.trail.id).toBe('s')
    expect(hit?.distanceM).toBeGreaterThan(9)
    expect(hit?.distanceM).toBeLessThan(13)
    expect(nearestTrail([], [113.5, 22.1])).toBeNull()
  })
})

describe('loadTrailKindsOn / saveTrailKindsOn', () => {
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

  it('defaults to both kinds and round-trips a partial selection', () => {
    const store = stubStorage()
    expect([...loadTrailKindsOn()]).toEqual([...TRAIL_KIND_ORDER])
    saveTrailKindsOn(new Set(['cycle'] as const))
    expect(store.get('mini-macau-trails-kinds-on')).toBe('["cycle"]')
    expect([...loadTrailKindsOn()]).toEqual(['cycle'])
  })

  it('degrades to all-on for corrupt storage and survives a throwing one', () => {
    stubStorage({ 'mini-macau-trails-kinds-on': 'not json' })
    expect([...loadTrailKindsOn()]).toEqual([...TRAIL_KIND_ORDER])
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    expect(() => saveTrailKindsOn(ALL_TRAIL_KINDS)).not.toThrow()
    expect([...loadTrailKindsOn()]).toEqual([...TRAIL_KIND_ORDER])
  })
})
