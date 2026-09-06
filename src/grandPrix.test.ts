import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { haversineM } from './flowPulse'
import {
  GRAND_PRIX_BADGE_ICON_PREFIX,
  GRAND_PRIX_CAR_MAX_SCALE,
  GRAND_PRIX_FALLBACK_LAP_SECONDS,
  GRAND_PRIX_FEATURE_ID_PROPERTY,
  GRAND_PRIX_FLAG_ICON,
  GRAND_PRIX_WAKE_LENGTH_M,
  GRAND_PRIX_FOCUS_MIN_ZOOM,
  grandPrixBounds,
  buildGrandPrixCornerFeatures,
  buildGrandPrixTrackFeatures,
  grandPrixCarState,
  grandPrixWakeFeatures,
  sliceGrandPrixLoop,
  grandPrixBadgeIconName,
  grandPrixCarPose,
  grandPrixCarScale,
  grandPrixCornerKindLabel,
  grandPrixCornerMapLabel,
  grandPrixLabelField,
  grandPrixLapProgress,
  grandPrixLapSeconds,
  grandPrixLegendRows,
  grandPrixMotionColors,
  grandPrixTrackLine,
  pickGrandPrixText,
  sortGrandPrixSources,
  GRAND_PRIX_LATERAL_ACCEL,
  GRAND_PRIX_V_MIN_MS,
  GRAND_PRIX_V_MAX_MS,
  buildGrandPrixSpeedProfile,
  grandPrixLapDistanceAt,
  grandPrixLapSpeedAt,
  grandPrixPoseAtFraction,
  grandPrixSpeedProfile,
} from './grandPrix'
import { buildRaceCarFeatures } from './layers/RaceCar3DLayer'
import { GrandPrixFileSchema } from './dataSchemas'
import type { Translations } from './i18n'
import type { GrandPrixCircuit, GrandPrixCorner } from './types'

// A 1 km square lap near Macau: 250 m sides, closed, starting at the
// south-west corner and running clockwise (north first, then east).
const LAT_M = 1 / 111320
const LNG_M = 1 / (111320 * Math.cos((22.2 * Math.PI) / 180))
const SQUARE: [number, number][] = [
  [113.55, 22.2],
  [113.55, 22.2 + 250 * LAT_M],
  [113.55 + 250 * LNG_M, 22.2 + 250 * LAT_M],
  [113.55 + 250 * LNG_M, 22.2],
  [113.55, 22.2],
]

function corner(over: Partial<GrandPrixCorner> = {}): GrandPrixCorner {
  return {
    id: 'lisboa',
    order: 3,
    kind: 'bend',
    name: { zh: '葡京彎', pt: 'Curva Lisboa', en: 'Lisboa Bend' },
    lng: 113.55,
    lat: 22.2,
    distKm: 0.25,
    approximate: true,
    rule: 'nearest track point to the hotel',
    spanKm: null,
    ...over,
  }
}

function circuit(over: Partial<GrandPrixCircuit> = {}): GrandPrixCircuit {
  return {
    id: 'guia',
    name: { zh: '東望洋跑道', pt: 'Circuito da Guia', en: 'Guia Circuit' },
    lengthKm: 1,
    minWidthM: 7,
    direction: 'clockwise',
    lapRecord: { time: '0:40.000', seconds: 40, driver: 'A. Driver', year: 2023, car: null, source: 'wikipedia' },
    osm: { relationId: 8877949, mainWays: 67, pitLaneWays: 5 },
    measuredLengthKm: 1,
    track: { type: 'LineString', coordinates: SQUARE },
    pitLane: { type: 'LineString', coordinates: [SQUARE[0], SQUARE[1]] },
    corners: [
      corner({ id: 'start-finish', order: 1, kind: 'start_finish', distKm: 0,
        name: { zh: '起點/終點', pt: 'Partida / Chegada', en: 'Start/Finish' } }),
      corner({ id: 'north', order: 2, distKm: 0.25, lat: SQUARE[1][1] }),
      corner({ id: 'esses', order: 3, kind: 'section', distKm: 0.6, spanKm: [0.5, 0.7],
        name: { zh: '劏狗環', pt: 'Esses da Solidão', en: 'Solitude Esses' } }),
    ],
    ...over,
  }
}

// The handful of strings the legend reads.
const t = {
  grandPrixTrack: 'Racing line',
  grandPrixPitLane: 'Pit lane',
  grandPrixWake: 'Wake',
  grandPrixCar: 'The car',
  grandPrixCarAtRecord: (time: string) => `The car at ${time}`,
  // (the real strings are measured against the legend's width in the browser)
  grandPrixKindStartFinish: 'Start / finish line',
  grandPrixKindBend: 'Corner',
  grandPrixKindSection: 'Section of track',
} as unknown as Translations

describe('text helpers', () => {
  it('pickGrandPrixText takes the UI language and falls back to English', () => {
    const name = { zh: '葡京彎', pt: 'Curva Lisboa', en: 'Lisboa Bend' }
    expect(pickGrandPrixText(name, 'zh')).toBe('葡京彎')
    expect(pickGrandPrixText(name, 'pt')).toBe('Curva Lisboa')
    expect(pickGrandPrixText(name, 'en')).toBe('Lisboa Bend')
    expect(pickGrandPrixText({ zh: '', pt: '', en: 'Lisboa Bend' }, 'zh')).toBe('Lisboa Bend')
    expect(pickGrandPrixText(undefined, 'en')).toBe('')
  })

  it('grandPrixLabelField names the feature property per language', () => {
    expect(grandPrixLabelField('zh')).toBe('label_zh')
    expect(grandPrixLabelField('pt')).toBe('label_pt')
    expect(grandPrixLabelField('en')).toBe('label_en')
  })

  it('grandPrixCornerMapLabel makes fullwidth brackets ASCII (the glyph server has none)', () => {
    expect(grandPrixCornerMapLabel('水塘北角彎（R）')).toBe('水塘北角彎(R)')
    expect(grandPrixCornerMapLabel('Curva "R"')).toBe('Curva "R"')
  })

  it('grandPrixCornerKindLabel covers the three kinds', () => {
    expect(grandPrixCornerKindLabel(t, 'start_finish')).toBe('Start / finish line')
    expect(grandPrixCornerKindLabel(t, 'bend')).toBe('Corner')
    expect(grandPrixCornerKindLabel(t, 'section')).toBe('Section of track')
  })
})

describe('badge images', () => {
  it('numbers a corner by race order and flags start/finish', () => {
    expect(grandPrixBadgeIconName({ kind: 'bend', order: 3 })).toBe(`${GRAND_PRIX_BADGE_ICON_PREFIX}3`)
    expect(grandPrixBadgeIconName({ kind: 'section', order: 5 })).toBe(`${GRAND_PRIX_BADGE_ICON_PREFIX}5`)
    expect(grandPrixBadgeIconName({ kind: 'start_finish', order: 1 })).toBe(GRAND_PRIX_FLAG_ICON)
  })
})

describe('buildGrandPrixTrackFeatures', () => {
  it('draws nothing for null (layer off, file not loaded)', () => {
    expect(buildGrandPrixTrackFeatures(null).features).toEqual([])
  })

  it('emits the track and the pit lane, each tagged by kind', () => {
    const fc = buildGrandPrixTrackFeatures(circuit())
    expect(fc.features.map(f => f.properties?.kind)).toEqual(['track', 'pit'])
    expect((fc.features[0].geometry as GeoJSON.LineString).coordinates).toEqual(SQUARE)
  })

  it('leaves the pit lane out when the file has none', () => {
    const fc = buildGrandPrixTrackFeatures(circuit({ pitLane: null }))
    expect(fc.features.map(f => f.properties?.kind)).toEqual(['track'])
  })
})

describe('buildGrandPrixCornerFeatures', () => {
  it('one point per corner with its id, badge and all three labels', () => {
    const fc = buildGrandPrixCornerFeatures(circuit())
    expect(fc.features).toHaveLength(3)
    const start = fc.features[0].properties!
    expect(start[GRAND_PRIX_FEATURE_ID_PROPERTY]).toBe('start-finish')
    expect(start.icon).toBe(GRAND_PRIX_FLAG_ICON)
    expect(start.order).toBe(1)
    expect(start.label_zh).toBe('起點/終點')
    expect(start.label_en).toBe('Start/Finish')
    expect(start.label_pt).toBe('Partida / Chegada')
    const north = fc.features[1].properties!
    expect(north.icon).toBe(`${GRAND_PRIX_BADGE_ICON_PREFIX}2`)
    expect(north.approximate).toBe(true)
    expect((fc.features[1].geometry as GeoJSON.Point).coordinates).toEqual([113.55, SQUARE[1][1]])
  })

  it('is empty for null', () => {
    expect(buildGrandPrixCornerFeatures(null).features).toEqual([])
  })
})

// Metres along a coordinate list.
function pathLength(coords: readonly (readonly number[])[]): number {
  let m = 0
  for (let i = 1; i < coords.length; i++) m += haversineM(coords[i - 1], coords[i])
  return m
}

describe('the wake behind the car', () => {
  it('sliceGrandPrixLoop returns the stretch in travel order, vertices included', () => {
    const p = buildGrandPrixSpeedProfile(SQUARE_DENSE, 40)!
    // 100 m → 300 m: up the first side, round the first corner (vertex 10),
    // onto the second. Vertices are 25 m apart, so 100 m is vertex 4 and
    // 300 m is vertex 12.
    const a = sliceGrandPrixLoop(SQUARE_DENSE, p.cumM, p.totalM, 100, 300)
    expect(haversineM(a[0], SQUARE_DENSE[4])).toBeLessThan(2)
    expect(haversineM(a[a.length - 1], SQUARE_DENSE[12])).toBeLessThan(2)
    expect(a.some(c => haversineM(c, SQUARE_DENSE[10]) < 1)).toBe(true)
    expect(Math.abs(pathLength(a) - 200)).toBeLessThan(3)
    // Travel order: each point is further along than the last.
    for (let i = 1; i < a.length; i++) {
      expect(haversineM(a[i], SQUARE_DENSE[4])).toBeGreaterThan(haversineM(a[i - 1], SQUARE_DENSE[4]) - 1)
    }
  })

  it('crosses start/finish as one continuous list', () => {
    const p = buildGrandPrixSpeedProfile(SQUARE_DENSE, 40)!
    const b = sliceGrandPrixLoop(SQUARE_DENSE, p.cumM, p.totalM, p.totalM - 50, p.totalM + 50)
    // Ends 50 m into the lap (vertex 2), passes the start line on the way.
    expect(haversineM(b[b.length - 1], SQUARE_DENSE[2])).toBeLessThan(2)
    expect(b.some(c => haversineM(c, SQUARE_DENSE[0]) < 1)).toBe(true)
    expect(Math.abs(pathLength(b) - 100)).toBeLessThan(3)
    // The same stretch asked for with wrapped numbers is the same stretch.
    const b2 = sliceGrandPrixLoop(SQUARE_DENSE, p.cumM, p.totalM, -50, 50)
    expect(b2).toEqual(b)
  })

  it('is empty for a zero or negative stretch and a degenerate loop', () => {
    const p = buildGrandPrixSpeedProfile(SQUARE_DENSE, 40)!
    expect(sliceGrandPrixLoop(SQUARE_DENSE, p.cumM, p.totalM, 300, 300)).toEqual([])
    expect(sliceGrandPrixLoop(SQUARE_DENSE, p.cumM, p.totalM, 300, 200)).toEqual([])
    expect(sliceGrandPrixLoop([SQUARE[0]], new Float64Array([0]), 0, 0, 100)).toEqual([])
  })

  it('grandPrixWakeFeatures is one line, GRAND_PRIX_WAKE_LENGTH_M long, ending at the car', () => {
    const c = circuit({ track: { type: 'LineString', coordinates: SQUARE_DENSE } })
    const state = grandPrixCarState(c, 10_000, 16.5)!
    const fc = grandPrixWakeFeatures(c, state.distanceM)
    expect(fc.features).toHaveLength(1)
    const line = (fc.features[0].geometry as GeoJSON.LineString).coordinates
    // The bright end is the car (the smoothed pose can sit a metre or two off
    // the raw line at a corner).
    expect(haversineM(line[line.length - 1], [state.pose.lng, state.pose.lat])).toBeLessThan(5)
    expect(Math.abs(pathLength(line) - GRAND_PRIX_WAKE_LENGTH_M)).toBeLessThan(4)
    // Ten seconds in the car is well under 600 m round, so the tail wraps
    // through start/finish — and is still one feature.
    expect(state.distanceM).toBeLessThan(GRAND_PRIX_WAKE_LENGTH_M)
    expect(line.some(p => haversineM(p, SQUARE[0]) < 1)).toBe(true)
  })

  it('draws nothing without a circuit or a distance', () => {
    expect(grandPrixWakeFeatures(null, 100).features).toEqual([])
    expect(grandPrixWakeFeatures(circuit(), null).features).toEqual([])
    expect(grandPrixWakeFeatures(circuit(), Number.NaN).features).toEqual([])
  })
})

describe('focusing the map', () => {
  it('grandPrixBounds covers the track and the pit lane, and is null without a circuit', () => {
    const c = circuit({ pitLane: { type: 'LineString', coordinates: [[113.549, 22.199], [113.5495, 22.1995]] } })
    const b = grandPrixBounds(c)!
    expect(b[0][0]).toBeCloseTo(113.549, 9) // the pit lane sticks out west…
    expect(b[0][1]).toBeCloseTo(22.199, 9) // …and a little south of the square
    expect(b[1][0]).toBeCloseTo(SQUARE[2][0], 9)
    expect(b[1][1]).toBeCloseTo(SQUARE[1][1], 9)
    expect(grandPrixBounds(null)).toBeNull()
    expect(grandPrixBounds(circuit({ track: { type: 'LineString', coordinates: [] }, pitLane: null }))).toBeNull()
  })

  it('keeps the zoom floor where street names still read', () => {
    expect(GRAND_PRIX_FOCUS_MIN_ZOOM).toBe(14.4)
  })
})

describe('grandPrixCarState', () => {
  it('carries the pose with the distance, speed and time into the lap', () => {
    const c = circuit()
    const s0 = grandPrixCarState(c, 0, 16.5)!
    expect(s0.distanceM).toBe(0)
    expect(s0.lapTimeS).toBe(0)
    expect(s0.speedMs).toBeGreaterThan(0)
    expect(haversineM([s0.pose.lng, s0.pose.lat], SQUARE[0])).toBeLessThan(1)
    const s1 = grandPrixCarState(c, 10_000, 16.5)!
    expect(s1.lapTimeS).toBeCloseTo(10, 9)
    expect(s1.distanceM).toBeGreaterThan(0)
    expect(s1.distanceM).toBeLessThan(1000)
    // Grandprix pose shorthand agrees.
    expect(grandPrixCarPose(c, 10_000, 16.5)).toEqual(s1.pose)
  })
})

describe('the car', () => {
  it('runs at the lap record where there is one, else the stated stand-in', () => {
    expect(grandPrixLapSeconds(circuit())).toBe(40)
    expect(grandPrixLapSeconds(circuit({ lapRecord: null }))).toBe(GRAND_PRIX_FALLBACK_LAP_SECONDS)
  })

  it('anchors the lap to the epoch so the same instant is the same place', () => {
    expect(grandPrixLapProgress(0, 40)).toBe(0)
    expect(grandPrixLapProgress(10_000, 40)).toBeCloseTo(0.25)
    expect(grandPrixLapProgress(40_000, 40)).toBe(0)
    expect(grandPrixLapProgress(-10_000, 40)).toBeCloseTo(0.75)
    expect(grandPrixLapProgress(10_000, 0)).toBe(0)
  })

  it('scales up as the map zooms out, within the cap', () => {
    expect(grandPrixCarScale(16.5)).toBe(1)
    expect(grandPrixCarScale(18)).toBe(1)
    expect(grandPrixCarScale(15.5)).toBeCloseTo(2)
    expect(grandPrixCarScale(14.5)).toBeCloseTo(4)
    expect(grandPrixCarScale(10)).toBe(GRAND_PRIX_CAR_MAX_SCALE)
    expect(grandPrixCarScale(Number.NaN)).toBe(1)
  })

  it('puts the car on the lap by distance, heading the way the track runs', () => {
    const c = circuit()
    // A quarter of the LENGTH in: the end of the first (northbound) side, so
    // the position is that vertex.
    const pose = grandPrixPoseAtFraction(c, 0.25, 16.5)!
    expect(pose.scale).toBe(1)
    expect(pose.lng).toBeCloseTo(SQUARE[1][0], 5)
    expect(pose.lat).toBeCloseTo(SQUARE[1][1], 4)
    // At the very start the car heads north (bearing 0) along the first side.
    const start = grandPrixPoseAtFraction(c, 0, 16.5)!
    expect(Math.abs(start.bearing)).toBeLessThan(1)
    // Five eighths in it is halfway down the eastern side, heading south.
    const south = grandPrixPoseAtFraction(c, 0.625, 16.5)!
    expect(Math.abs(Math.abs(south.bearing) - 180)).toBeLessThan(1)
    expect(south.lng).toBeCloseTo(SQUARE[2][0], 5)
  })

  it('by time: on the start line at t = 0, back there a lap later, elsewhere in between', () => {
    const c = circuit()
    const t0 = grandPrixCarPose(c, 0, 16.5)!
    expect(haversineM([t0.lng, t0.lat], SQUARE[0])).toBeLessThan(1)
    const t1 = grandPrixCarPose(c, 40_000, 16.5)!
    expect(haversineM([t1.lng, t1.lat], SQUARE[0])).toBeLessThan(1)
    const mid = grandPrixCarPose(c, 20_000, 16.5)!
    expect(haversineM([mid.lng, mid.lat], SQUARE[0])).toBeGreaterThan(200)
    // Still heading north out of the start line.
    expect(Math.abs(t0.bearing)).toBeLessThan(1)
  })

  it('caches the engine line per circuit object', () => {
    const c = circuit()
    expect(grandPrixTrackLine(c)).toBe(grandPrixTrackLine(c))
    expect(grandPrixTrackLine(c)).not.toBe(grandPrixTrackLine(circuit()))
  })

  it('is null for a degenerate track', () => {
    expect(grandPrixCarPose(circuit({ track: { type: 'LineString', coordinates: [SQUARE[0]] } }), 0, 15)).toBeNull()
  })
})

// The square again, with each side cut into ten 25 m steps so the sides have
// vertices of their own (the profile is per vertex).
const SQUARE_DENSE: [number, number][] = (() => {
  const out: [number, number][] = []
  for (let side = 0; side < 4; side++) {
    const a = SQUARE[side]
    const b = SQUARE[side + 1]
    for (let k = 0; k < 10; k++) out.push([a[0] + (b[0] - a[0]) * k / 10, a[1] + (b[1] - a[1]) * k / 10])
  }
  out.push([SQUARE[0][0], SQUARE[0][1]])
  return out
})()

describe('buildGrandPrixSpeedProfile', () => {
  it('brakes for the four corners, runs faster down the sides, and laps in exactly the lap time', () => {
    const p = buildGrandPrixSpeedProfile(SQUARE_DENSE, 40)!
    expect(p).not.toBeNull()
    expect(p.totalM).toBeGreaterThan(990)
    expect(p.totalM).toBeLessThan(1010)
    expect(p.timeS[p.timeS.length - 1]).toBeCloseTo(40, 9)
    // Corner vertices are indices 0, 10, 20, 30 (and 40 = 0); mid-sides 5, 15, 25, 35.
    for (const corner of [0, 10, 20, 30]) {
      expect(p.speedMs[corner]).toBeLessThan(p.speedMs[corner + 5])
    }
    expect(p.speedMs[40]).toBe(p.speedMs[0])
    // A 90° turn read over ±15 m is a curvature of (π/2)/15 per metre, so the
    // corner speed is the cornering limit at that curvature (above the floor),
    // stretched with everything else; nothing exceeds the stretched top speed.
    const cornerLimit = Math.sqrt(GRAND_PRIX_LATERAL_ACCEL / ((Math.PI / 2) / 15))
    expect(Math.min(...p.speedMs)).toBeCloseTo(cornerLimit * p.stretch, 0)
    expect(Math.min(...p.speedMs)).toBeGreaterThan(GRAND_PRIX_V_MIN_MS * p.stretch)
    expect(Math.max(...p.speedMs)).toBeLessThanOrEqual(GRAND_PRIX_V_MAX_MS * p.stretch + 1e-9)
  })

  it('distance climbs monotonically with time and reaches the total at the lap time', () => {
    const p = buildGrandPrixSpeedProfile(SQUARE_DENSE, 40)!
    let prev = -1
    for (let t = 0; t < 40; t += 0.25) {
      const d = grandPrixLapDistanceAt(p, t)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
    expect(grandPrixLapDistanceAt(p, 0)).toBe(0)
    expect(grandPrixLapDistanceAt(p, 39.9999)).toBeCloseTo(p.totalM, 0)
    // Wraps: a lap and a bit is a bit.
    expect(grandPrixLapDistanceAt(p, 41)).toBeCloseTo(grandPrixLapDistanceAt(p, 1), 6)
    expect(grandPrixLapDistanceAt(p, -1)).toBeCloseTo(grandPrixLapDistanceAt(p, 39), 6)
  })

  it('reads the speed between vertices, slowest at a corner', () => {
    const p = buildGrandPrixSpeedProfile(SQUARE_DENSE, 40)!
    expect(grandPrixLapSpeedAt(p, 0)).toBeCloseTo(p.speedMs[0], 9)
    const atCorner = grandPrixLapSpeedAt(p, p.timeS[10])
    const midSide = grandPrixLapSpeedAt(p, p.timeS[15])
    expect(atCorner).toBeLessThan(midSide)
  })

  it('is null for a degenerate track, and the pose then falls back to one speed', () => {
    expect(buildGrandPrixSpeedProfile([SQUARE[0], SQUARE[0]], 40)).toBeNull()
    expect(buildGrandPrixSpeedProfile(SQUARE, 0)).toBeNull()
    const c = circuit({ track: { type: 'LineString', coordinates: [SQUARE[0], SQUARE[1], SQUARE[0]] } })
    expect(grandPrixSpeedProfile(c)).not.toBeNull() // three points is a (thin) loop
  })
})

describe('buildRaceCarFeatures', () => {
  const colors = { body: '#e11d48', accent: '#f8fafc', wheel: '#0a0a0a', cockpit: '#1a1e2a' }

  it('builds every box as a closed ring with its own colour, base and height', () => {
    const feats = buildRaceCarFeatures({ lng: 113.55, lat: 22.2, bearing: 0, scale: 1 }, colors)
    expect(feats.length).toBeGreaterThanOrEqual(12)
    for (const f of feats) {
      const ring = f.geometry.coordinates[0]
      expect(ring).toHaveLength(5)
      expect(ring[0]).toEqual(ring[4])
      expect(f.properties.height).toBeGreaterThan(f.properties.base)
    }
    const parts = feats.map(f => f.properties.part)
    expect(parts.filter(p => p === 'wheel')).toHaveLength(4)
    expect(parts).toContain('rearWing')
    expect(parts).toContain('frontWing')
    expect(parts).toContain('cockpit')
  })

  it('colours the parts by role and lifts the rear wing off the floor', () => {
    const feats = buildRaceCarFeatures({ lng: 113.55, lat: 22.2, bearing: 0, scale: 1 }, colors)
    const by = (part: string) => feats.find(f => f.properties.part === part)!.properties
    expect(by('wheel').color).toBe(colors.wheel)
    expect(by('body').color).toBe(colors.body)
    expect(by('rearWing').color).toBe(colors.accent)
    expect(by('cockpit').color).toBe(colors.cockpit)
    expect(by('rearWing').base).toBeGreaterThan(0)
    expect(by('wheel').base).toBe(0)
  })

  it('scales the footprint and the heights together', () => {
    const one = buildRaceCarFeatures({ lng: 113.55, lat: 22.2, bearing: 90, scale: 1 }, colors)
    const three = buildRaceCarFeatures({ lng: 113.55, lat: 22.2, bearing: 90, scale: 3 }, colors)
    const span = (f: typeof one[number]) => {
      const lngs = f.geometry.coordinates[0].map(c => c[0])
      return Math.max(...lngs) - Math.min(...lngs)
    }
    expect(span(three[0]) / span(one[0])).toBeCloseTo(3, 6)
    expect(three[0].properties.height / one[0].properties.height).toBeCloseTo(3, 6)
  })
})

describe('grandPrixLegendRows', () => {
  it('lists the corners as the numbered chain, then the style rows', () => {
    const rows = grandPrixLegendRows(t, 'en', circuit(), true)
    expect(rows.slice(0, 3).map(r => [r.stage, r.glyph, r.label])).toEqual([
      [1, 'flag', 'Start/Finish'],
      [2, 'corner', 'Lisboa Bend'],
      [3, 'corner', 'Solitude Esses'],
    ])
    expect(rows.slice(3).map(r => [r.id, r.stage])).toEqual([
      ['track', 0], ['pit', 0], ['wake', 0], ['car', 0],
    ])
    expect(rows.find(r => r.id === 'car')?.label).toBe('The car at 0:40.000')
  })

  it('names the corners in the UI language and sorts by race order', () => {
    const c = circuit()
    c.corners = [...c.corners].reverse()
    const rows = grandPrixLegendRows(t, 'zh', c, true)
    expect(rows.slice(0, 3).map(r => r.label)).toEqual(['起點/終點', '葡京彎', '劏狗環'])
  })

  it('still explains the marks before the file lands, and without a record', () => {
    const rows = grandPrixLegendRows(t, 'en', null, false)
    expect(rows.map(r => r.id)).toEqual(['track', 'pit', 'wake', 'car'])
    expect(rows.find(r => r.id === 'car')?.label).toBe('The car')
    expect(rows.find(r => r.id === 'track')?.color).toBe(grandPrixMotionColors(false).track)
  })
})

describe('grandPrixMotionColors', () => {
  it('turns the moving things to ink on the light basemap', () => {
    const dark = grandPrixMotionColors(true)
    const light = grandPrixMotionColors(false)
    for (const key of Object.keys(dark) as Array<keyof typeof dark>) {
      expect(dark[key]).not.toBe(light[key])
    }
    expect(light.halo).toBe('#ffffff')
    expect(dark.halo).toBe('#0b0b0c')
  })
})

describe('sortGrandPrixSources', () => {
  it('orders line → names → facts → record → landmarks, keeping file order within a role', () => {
    const sorted = sortGrandPrixSources([
      { role: 'landmarks', name: 'L' },
      { role: 'names', name: 'N1' },
      { role: 'lapRecord', name: 'R' },
      { role: 'facts', name: 'F' },
      { role: 'geometry', name: 'G' },
      { role: 'names', name: 'N2' },
      { role: 'other', name: 'O' },
    ])
    expect(sorted.map(s => s.name)).toEqual(['G', 'N1', 'N2', 'F', 'R', 'L', 'O'])
  })
})

// The committed file, when it is there (the public CI has it; a checkout that
// has not run the pipeline skips): the car must run the WHOLE drawn lap in
// exactly the record time, not a fraction of it or more than one lap.
const REAL_FILE = resolve(__dirname, '..', 'public', 'data', 'grand-prix.json')

describe.skipIf(!existsSync(REAL_FILE))('the committed Guia Circuit', () => {
  const real = (JSON.parse(readFileSync(REAL_FILE, 'utf8')) as { circuit: GrandPrixCircuit }).circuit
  const lapMs = grandPrixLapSeconds(real) * 1000
  const start = real.track.coordinates[0]

  it('runs at the file’s lap record, not the stand-in', () => {
    expect(real.lapRecord).not.toBeNull()
    expect(lapMs).toBe(real.lapRecord!.seconds * 1000)
    expect(lapMs).not.toBe(GRAND_PRIX_FALLBACK_LAP_SECONDS * 1000)
  })

  it('is at start/finish at t = 0 and back there one record lap later', () => {
    const t0 = grandPrixCarPose(real, 0, 16.5)!
    expect(haversineM([t0.lng, t0.lat], start)).toBeLessThan(2)
    const tEnd = grandPrixCarPose(real, lapMs - 1, 16.5)!
    expect(haversineM([tEnd.lng, tEnd.lat], start)).toBeLessThan(2)
    const tLap = grandPrixCarPose(real, lapMs, 16.5)!
    expect(haversineM([tLap.lng, tLap.lat], start)).toBeLessThan(2)
  })

  it('covers the whole drawn lap, with the time → distance map monotonic', () => {
    const p = grandPrixSpeedProfile(real)!
    expect(p.totalM / 1000).toBeCloseTo(real.measuredLengthKm, 1)
    let prev = -1
    for (let t = 0; t < p.lapSeconds; t += 0.5) {
      const d = grandPrixLapDistanceAt(p, t)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
    expect(grandPrixLapDistanceAt(p, p.lapSeconds - 0.001)).toBeGreaterThan(p.totalM - 5)
    // The far side really is far: half a lap in, the car is most of a
    // kilometre from the start line as the crow flies.
    const half = grandPrixCarPose(real, lapMs / 2, 16.5)!
    expect(haversineM([half.lng, half.lat], start)).toBeGreaterThan(600)
  })

  it('brakes for the Melco hairpin and runs out along the straight, in the record time', () => {
    const p = grandPrixSpeedProfile(real)!
    expect(p.timeS[p.timeS.length - 1]).toBeCloseTo(real.lapRecord!.seconds, 6)
    const kmh = Array.from(p.speedMs, v => v * 3.6)
    const melco = real.corners.find(c => c.id === 'melco-hairpin')!
    let nearest = 0
    let nearestM = Infinity
    real.track.coordinates.forEach((c, i) => {
      const d = haversineM(c, [melco.lng, melco.lat])
      if (d < nearestM) { nearestM = d; nearest = i }
    })
    expect(nearestM).toBeLessThan(30)
    expect(kmh[nearest]).toBeLessThan(70)
    expect(Math.min(...kmh)).toBeLessThan(60)
    expect(Math.max(...kmh)).toBeGreaterThan(250)
    expect(Math.max(...kmh)).toBeLessThan(300)
    // The limits alone lap the drawn line in about the record (126.2 s against
    // 126.257 s when this was tuned), so the stretch onto it is a nudge, not a
    // rewrite of the shape — a drift past ±15 % means the limits or the line
    // changed and the numbers above want a second look.
    expect(p.stretch).toBeGreaterThan(0.85)
    expect(p.stretch).toBeLessThan(1.15)
  })

  it('leaves the line heading the way the track runs', () => {
    const t0 = grandPrixCarPose(real, 0, 16.5)!
    const next = real.track.coordinates[1]
    const dx = (next[0] - start[0]) * Math.cos((start[1] * Math.PI) / 180)
    const dy = next[1] - start[1]
    const expected = (Math.atan2(dx, dy) * 180) / Math.PI
    const diff = Math.abs(((t0.bearing - expected + 540) % 360) - 180)
    expect(diff).toBeLessThan(25)
  })

  it('averages the record pace over the drawn length (constant speed, no braking)', () => {
    const kmh = (real.measuredLengthKm * 1000 / (lapMs / 1000)) * 3.6
    // 6.114 km in 2:06.257 ≈ 174 km/h; the real average over the official
    // 6.2 km is ≈ 177 km/h — the 1.4 % the drawn line is short.
    expect(kmh).toBeGreaterThan(165)
    expect(kmh).toBeLessThan(185)
  })
})

describe('GrandPrixFileSchema', () => {
  const file = () => ({
    fetchedAtUtc: '2026-09-06T00:00:00Z',
    sources: [{ name: 'OSM', url: 'https://www.openstreetmap.org/relation/8877949', role: 'geometry' }],
    circuit: circuit(),
  })

  it('accepts a closed track with ordered corners', () => {
    expect(GrandPrixFileSchema.safeParse(file()).success).toBe(true)
  })

  it('rejects a track that does not come back to its start', () => {
    const f = file()
    f.circuit = circuit({ track: { type: 'LineString', coordinates: SQUARE.slice(0, 4) } })
    const res = GrandPrixFileSchema.safeParse(f)
    expect(res.success).toBe(false)
  })

  it('rejects a corner with no placement rule', () => {
    const f = file()
    f.circuit = circuit({ corners: [corner({ rule: '' })] })
    expect(GrandPrixFileSchema.safeParse(f).success).toBe(false)
  })
})
