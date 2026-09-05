import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  WATER_COLORS,
  WATER_FEATURE_ID_PROPERTY,
  WATER_DISTRIBUTION_COLOR,
  WATER_DISTRIBUTION_MAJOR_CLASSES,
  WATER_INLET_COLOR,
  WATER_INLET_ICON,
  WATER_PIPE_COLORS,
  WATER_TYPE_ORDER,
  WATER_STAGES,
  WATER_BADGE_ICON_PREFIX,
  WATER_PULSE_COLOR,
  WATER_PULSE_BUCKET_M,
  WATER_TRUNK_PULSE_BUCKETS,
  WATER_MESH_PULSE_BUCKETS,
  WATER_PULSE_TAIL,
  WATER_PULSE_STEP_TICKS,
  WATER_PULSE_REST_STEPS,
  advanceWaterPulse,
  applyLayerSnapshot,
  applyWaterFocus,
  buildDashFlowSteps,
  buildWaterBuildingFeatures,
  buildWaterDistributionFeatures,
  buildWaterMarkerFeatures,
  buildWaterPipeFeatures,
  buildWaterPulseFeatures,
  buildWaterSurfaceFeatures,
  captureLayerSnapshot,
  countWaterFootprints,
  haversineM,
  initialWaterPulseState,
  loadWaterFocusSnapshot,
  pickWaterText,
  saveWaterFocusSnapshot,
  waterAnchorFacility,
  waterArrivalDistances,
  waterBadgeIconName,
  waterDistanceBucket,
  waterDistributionBucketCount,
  waterIconName,
  waterLabelField,
  waterLegendRows,
  waterOperator,
  waterOperatorLabel,
  waterPipeCount,
  waterPipeLengthM,
  waterStage,
  waterTypeLabel,
  type LayerVisibilityApply,
  type LayerVisibilityState,
  type WaterPulseCounts,
  type WaterPulseWrite,
} from './water'
import type { Translations } from './i18n'
import type {
  WaterBuilding,
  WaterFacility,
  WaterFacilityType,
  WaterNetwork,
  WaterPipe,
} from './types'

const RING: [number, number][][] = [[
  [113.5404, 22.2114], [113.5405, 22.2114], [113.5405, 22.2115], [113.5404, 22.2114],
]]

function building(over: Partial<WaterBuilding> = {}): WaterBuilding {
  return { osmId: 'w1', name: '泵房', height: 12, minHeight: 0, kind: 'building', coordinates: RING, ...over }
}

function facility(over: Partial<WaterFacility> = {}): WaterFacility {
  return {
    id: 'wtp-ilha-verde',
    no: 1,
    type: 'plant',
    name: {
      zh: '青洲水廠',
      en: 'Ilha Verde Water Treatment Plant',
      pt: 'Estação de Tratamento de Água da Ilha Verde',
    },
    coordinates: [113.5404, 22.2114],
    approximate: false,
    anchor: null,
    osm: ['w241618704'],
    buildings: [building()],
    water: [],
    ...over,
  }
}

describe('WATER_COLORS', () => {
  it('carries one colour per facility type, all distinct', () => {
    expect(WATER_COLORS).toEqual({
      plant: '#22d3ee',
      reservoir: '#38bdf8',
      tank: '#818cf8',
      raw_pumping: '#0ea5e9',
      pumping: '#7dd3fc',
    })
    expect(new Set(Object.values(WATER_COLORS)).size).toBe(5)
  })

  it('lists every type once, in supply-chain flow order — not the colour table’s own order', () => {
    // WATER_TYPE_ORDER now reads the way water actually travels (reservoir →
    // raw pumping → plant → pumping → tank), which no longer coincides with
    // the order WATER_COLORS happens to declare its keys in.
    expect([...WATER_TYPE_ORDER]).toEqual(['reservoir', 'raw_pumping', 'plant', 'pumping', 'tank'])
    expect([...WATER_TYPE_ORDER].sort()).toEqual(Object.keys(WATER_COLORS).sort())
  })
})

describe('WATER_STAGES / waterStage', () => {
  it('numbers the chain 1..7 in flow order, ending with distribution', () => {
    expect([...WATER_STAGES]).toEqual([
      'inlet', 'reservoir', 'raw_pumping', 'plant', 'pumping', 'tank', 'distribution',
    ])
    expect(WATER_STAGES.map(k => waterStage(k))).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('is 0 for a kind the chain does not know', () => {
    expect(waterStage('bogus')).toBe(0)
  })
})

describe('waterBadgeIconName', () => {
  it('names the badge image after the stage number', () => {
    expect(waterBadgeIconName(1)).toBe('water-badge-1')
    expect(waterBadgeIconName(7)).toBe(`${WATER_BADGE_ICON_PREFIX}-7`)
  })
})

describe('waterTypeLabel', () => {
  const t = {
    waterTypePlant: '水廠',
    waterTypeReservoir: '水塘',
    waterTypeTank: '高位水池',
    waterTypeRawPumping: '原水泵站',
    waterTypePumping: '泵站',
  } as Translations

  it('labels every type from the translation table', () => {
    expect([...WATER_TYPE_ORDER].map(type => waterTypeLabel(t, type)))
      .toEqual(['水塘', '原水泵站', '水廠', '泵站', '高位水池'])
  })
})

describe('pickWaterText', () => {
  const name = { zh: '青洲水廠', pt: 'ETA da Ilha Verde', en: 'Ilha Verde WTP' }

  it('gives each language its own form', () => {
    expect(pickWaterText(name, 'zh')).toBe('青洲水廠')
    expect(pickWaterText(name, 'pt')).toBe('ETA da Ilha Verde')
    expect(pickWaterText(name, 'en')).toBe('Ilha Verde WTP')
  })

  it('falls back pt → en → zh, because most facilities have no Portuguese form', () => {
    expect(pickWaterText({ ...name, pt: '' }, 'pt')).toBe('Ilha Verde WTP')
    expect(pickWaterText({ zh: '松山70米高位水池', pt: '', en: '' }, 'pt')).toBe('松山70米高位水池')
  })

  it('shows the English name, never an invented one, for the 11 facilities with pt: ""', () => {
    // water-facilities.json ships pt: "" for nos 11–13, 15–22 rather than
    // machine-translating Macao Water's list. zh + en are always non-empty, so
    // a Portuguese reader gets the English form, and every marker still has a
    // name in every UI language.
    const noPt = { zh: '二龍喉泵站', pt: '', en: 'Floral Pumping Station' }
    expect(pickWaterText(noPt, 'pt')).toBe('Floral Pumping Station')
    expect(pickWaterText(noPt, 'en')).toBe('Floral Pumping Station')
    expect(pickWaterText(noPt, 'zh')).toBe('二龍喉泵站')
  })

  it('falls back for the other languages too, and tolerates a missing field', () => {
    expect(pickWaterText({ ...name, en: '' }, 'en')).toBe('ETA da Ilha Verde')
    expect(pickWaterText({ ...name, zh: '' }, 'zh')).toBe('Ilha Verde WTP')
    expect(pickWaterText(undefined, 'en')).toBe('')
  })
})

describe('waterIconName', () => {
  it('names a distinct image per type and per certainty', () => {
    expect(waterIconName('plant', false)).toBe('water-plant')
    expect(waterIconName('plant', true)).toBe('water-plant-approx')
    const names = WATER_TYPE_ORDER.flatMap(t => [waterIconName(t, false), waterIconName(t, true)])
    expect(new Set(names).size).toBe(10)
  })
})

describe('waterOperator / waterOperatorLabel', () => {
  const t = {
    waterOperatorMacaoWater: '澳門自來水設施',
    waterOperatorDsama: '政府原水水庫（海事及水務局）· 非自來水公司設施',
  } as Translations

  it('defaults to Macao Water when the file predates the field', () => {
    // parseData hands the runtime the RAW object, so the zod default never
    // reaches it — this helper is where the default actually lives.
    expect(waterOperator(facility({ operator: undefined }))).toBe('macao_water')
    expect(waterOperator(facility({ operator: 'macao_water' }))).toBe('macao_water')
  })

  it('names the government reservoirs as not being Macao Water’s', () => {
    const hacSa = facility({ id: 'res-hac-sa', no: null, type: 'reservoir', operator: 'dsama' })
    expect(waterOperator(hacSa)).toBe('dsama')
    expect(waterOperatorLabel(t, hacSa)).toBe('政府原水水庫（海事及水務局）· 非自來水公司設施')
    expect(waterOperatorLabel(t, facility())).toBe('澳門自來水設施')
  })

  it('tolerates a facility with no Macao Water number', () => {
    const hacSa = facility({ id: 'res-hac-sa', no: null, type: 'reservoir', operator: 'dsama' })
    expect(hacSa.no).toBeNull()
    expect(buildWaterMarkerFeatures([hacSa]).features).toHaveLength(1)
  })
})

describe('waterAnchorFacility', () => {
  const all = [facility(), facility({ id: 'tank-taipa-50', no: 10, type: 'tank' })]

  it('resolves a facility anchor to the facility it names', () => {
    expect(waterAnchorFacility('tank-taipa-50', all)?.id).toBe('tank-taipa-50')
  })

  it('has no facility for an exact record, a district anchor or an unknown id', () => {
    expect(waterAnchorFacility(null, all)).toBeNull()
    expect(waterAnchorFacility('district:jardim-da-flora', all)).toBeNull()
    expect(waterAnchorFacility('nope', all)).toBeNull()
  })
})

describe('buildWaterBuildingFeatures', () => {
  it('emits one Polygon per footprint, coloured by type and raised the 2 m margin', () => {
    const fc = buildWaterBuildingFeatures([
      facility({ id: 'a', type: 'plant', buildings: [building({ osmId: 'w1' }), building({ osmId: 'w2' })] }),
      facility({ id: 'b', type: 'tank', buildings: [building({ osmId: 'w3', height: 20, minHeight: 3 })] }),
    ])
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(3)
    expect(fc.features[0].geometry).toEqual({ type: 'Polygon', coordinates: RING })
    expect(fc.features[0].properties).toEqual({
      facilityId: 'a', type: 'plant', color: '#22d3ee', height: 14, minHeight: 0, name: '泵房',
    })
    expect(fc.features[2].properties).toMatchObject({
      facilityId: 'b', color: '#818cf8', height: 22, minHeight: 3,
    })
  })

  it('keeps an unnamed footprint but skips one with no usable ring', () => {
    const fc = buildWaterBuildingFeatures([facility({
      buildings: [
        building({ osmId: 'w1', name: null }),
        building({ osmId: 'w2', coordinates: [] }),
        building({ osmId: 'w3', coordinates: [[]] }),
      ],
    })])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties?.name).toBeNull()
  })

  it('tags every footprint of a facility with the promoted feature id', () => {
    // MapLibre promotes this property to the feature id, so all of a
    // facility's blocks must share it for one setFeatureState to whiten the
    // whole site.
    const fc = buildWaterBuildingFeatures([
      facility({ id: 'a', buildings: [building({ osmId: 'w1' }), building({ osmId: 'w2' })] }),
      facility({ id: 'b', buildings: [building({ osmId: 'w3' })] }),
    ])
    expect(fc.features.map(f => f.properties?.[WATER_FEATURE_ID_PROPERTY])).toEqual(['a', 'a', 'b'])
  })

  it('is empty for no facilities and for one with no footprint', () => {
    expect(buildWaterBuildingFeatures([]).features).toHaveLength(0)
    expect(buildWaterBuildingFeatures([facility({ buildings: [] })]).features).toHaveLength(0)
  })

  it('colours every type distinctly', () => {
    const types = [...WATER_TYPE_ORDER] as WaterFacilityType[]
    const fc = buildWaterBuildingFeatures(types.map((type, i) => facility({ id: `f${i}`, type })))
    expect(fc.features.map(f => f.properties?.color)).toEqual(types.map(type => WATER_COLORS[type]))
  })
})

describe('buildWaterSurfaceFeatures', () => {
  it('emits the reservoir rings with no height, and skips empty ones', () => {
    const fc = buildWaterSurfaceFeatures([
      facility({
        id: 'res-main', type: 'reservoir', buildings: [],
        water: [{ osmId: 'r10266785', coordinates: RING }, { osmId: 'w2', coordinates: [] }],
      }),
      facility({ id: 'wtp', water: [] }),
    ])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry).toEqual({ type: 'Polygon', coordinates: RING })
    expect(fc.features[0].properties).toEqual({
      facilityId: 'res-main', type: 'reservoir', color: '#38bdf8',
    })
    expect(fc.features[0].properties).not.toHaveProperty('height')
  })
})

describe('buildWaterMarkerFeatures', () => {
  it('emits a marker for EVERY facility, footprint or not', () => {
    const fc = buildWaterMarkerFeatures([
      facility({ id: 'a' }),
      facility({ id: 'b', buildings: [], water: [] }),
    ])
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [113.5404, 22.2114] })
  })

  it('flags an approximate facility and gives it the hollow icon', () => {
    const fc = buildWaterMarkerFeatures([
      facility({ id: 'ps-floral', no: 22, type: 'pumping', approximate: true, anchor: 'district:jardim-da-flora', buildings: [] }),
    ])
    expect(fc.features[0].properties).toEqual({
      facilityId: 'ps-floral', type: 'pumping', approximate: true, icon: 'water-pumping-approx',
      stage: 5, badge: 'water-badge-5',
    })
  })

  it('tags every facility marker with its flow stage and badge image', () => {
    const types = [...WATER_TYPE_ORDER] as WaterFacilityType[]
    const fc = buildWaterMarkerFeatures(types.map((type, i) => facility({ id: `f${i}`, type })))
    expect(fc.features.map(f => f.properties?.stage)).toEqual(types.map(type => waterStage(type)))
    expect(fc.features.map(f => f.properties?.badge))
      .toEqual(types.map(type => waterBadgeIconName(waterStage(type))))
    // Pinned against WATER_STAGES directly, not just self-consistency.
    expect(fc.features.map(f => f.properties?.stage)).toEqual([2, 3, 4, 5, 6])
  })

  it('skips a record with no usable coordinate pair', () => {
    const broken = facility({ coordinates: [113.54] as unknown as [number, number] })
    expect(buildWaterMarkerFeatures([broken]).features).toHaveLength(0)
  })
})

// ---- Pipe network ---------------------------------------------------------

const LINE: [number, number][] = [
  [113.5404, 22.2114], [113.5410, 22.2110], [113.5418, 22.2103],
]

// Pure-latitude fixtures for the pulse tests below: a straight ~1000 m run
// (P0→P1) followed by a short ~100 m continuation (P1→P2), so distances can
// be reasoned about (and cross-checked with haversineM) without worrying
// about longitude's cos(latitude) scaling.
const P0: [number, number] = [113.5000, 22.2000]
const P1: [number, number] = [113.5000, 22.2090]
const P2: [number, number] = [113.5000, 22.2099]

const ROAD: [number, number][] = [[113.54, 22.19], [113.545, 22.192]]

function pipe(over: Partial<WaterPipe> = {}): WaterPipe {
  return {
    id: 'raw-inlet-ilha-verde',
    from: 'inlet-zhuhai',
    to: 'wtp-ilha-verde',
    kind: 'raw',
    lengthM: 420,
    fallback: false,
    coordinates: LINE,
    ...over,
  }
}

function network(over: Partial<WaterNetwork> = {}): WaterNetwork {
  return {
    nodes: [{
      id: 'inlet-zhuhai',
      kind: 'inlet',
      name: { zh: '珠海原水輸入', en: 'Raw water from Zhuhai', pt: 'Água bruta de Zhuhai' },
      coordinates: [113.5390, 22.2160],
    }],
    pipes: [pipe()],
    ...over,
  }
}

describe('WATER_PIPE_COLORS', () => {
  it('separates raw water from treated', () => {
    expect(WATER_PIPE_COLORS).toEqual({ raw: '#2563eb', treated: '#7dd3fc' })
  })
})

describe('buildWaterPipeFeatures', () => {
  it('emits one LineString per pipe, carrying what the paint expressions read', () => {
    const fc = buildWaterPipeFeatures(network())
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: LINE })
    expect(fc.features[0].properties).toEqual({
      pipeId: 'raw-inlet-ilha-verde', kind: 'raw', fallback: false, direct: false,
      lengthM: 420, sortKey: 0,
    })
  })

  it('carries `direct` but does not let it change how the pipe is styled', () => {
    const fc = buildWaterPipeFeatures(network({
      pipes: [pipe({ direct: true, coordinates: [LINE[0], LINE[2]] })],
    }))
    // Same kind, same fallback flag → the paint expressions treat it exactly
    // like any other raw pipe; only the property records that it is a stub.
    expect(fc.features[0].properties).toMatchObject({ direct: true, kind: 'raw', fallback: false })
  })

  it('sorts treated water above raw where the two share a street', () => {
    const fc = buildWaterPipeFeatures(network({
      pipes: [pipe({ id: 'raw', kind: 'raw' }), pipe({ id: 'treated', kind: 'treated' })],
    }))
    expect(fc.features.map(f => f.properties?.sortKey)).toEqual([0, 1])
  })

  it('flags a straight-line fallback so it can be drawn grey', () => {
    const fc = buildWaterPipeFeatures(network({
      pipes: [pipe({ fallback: true, coordinates: [LINE[0], LINE[2]] })],
    }))
    expect(fc.features[0].properties?.fallback).toBe(true)
  })

  it('skips a pipe with fewer than two points, and tolerates no network at all', () => {
    expect(buildWaterPipeFeatures(network({
      pipes: [pipe({ coordinates: [LINE[0]] }), pipe({ id: 'b', coordinates: [] })],
    })).features).toHaveLength(0)
    expect(buildWaterPipeFeatures(null).features).toHaveLength(0)
    expect(buildWaterPipeFeatures(undefined).features).toHaveLength(0)
  })
})

describe('buildDashFlowSteps', () => {
  // Where the pattern's leading dash begins, as a distance from the line's
  // start. This is the whole point of the sequence: it must INCREASE step by
  // step, because that is what makes the dashes crawl from a pipe's `from` end
  // towards its `to` end rather than backwards.
  const dashStart = (arr: number[], cycle: number) => +((arr[0] + arr[1]) % cycle).toFixed(6)
  const dashTotal = (arr: number[]) =>
    +arr.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0).toFixed(6)
  const sum = (arr: number[]) => +arr.reduce((a, b) => a + b, 0).toFixed(6)

  it('walks the pattern FORWARD, one even slice of the cycle per step', () => {
    const steps = buildDashFlowSteps(2, 1.5, 7)
    expect(steps).toHaveLength(7)
    // 0, 0.5, 1 … 3 across a 3.5-long cycle: strictly increasing, never wrapping
    // back — reverse this and the water visibly runs uphill.
    expect(steps.map(s => dashStart(s, 3.5))).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3])
  })

  it('keeps every step the same cycle length and the same amount of ink', () => {
    for (const [dash, gap, n] of [[2, 1.5, 7], [1.2, 3.2, 8]] as const) {
      for (const step of buildDashFlowSteps(dash, gap, n)) {
        expect(sum(step)).toBe(dash + gap)
        expect(dashTotal(step)).toBe(dash)
        // MapLibre alternates dash/gap, so an odd-length array would swap the
        // roles on every repeat. Every entry must have an even length.
        expect(step.length % 2).toBe(0)
      }
    }
  })

  it('starts unshifted, and emits the short-dot pattern the flow layer uses', () => {
    expect(buildDashFlowSteps(2, 1.5, 7)[0]).toEqual([2, 1.5])
    const flow = buildDashFlowSteps(1.2, 3.2, 8)
    expect(flow).toHaveLength(8)
    expect(flow[0]).toEqual([1.2, 3.2])
    expect(flow.map(s => dashStart(s, 4.4)))
      .toEqual([0, 0.55, 1.1, 1.65, 2.2, 2.75, 3.3, 3.85])
  })

  it('builds one phase per pre-built layer, at MapView’s real phase counts', () => {
    // Every entry becomes a LAYER, so K is a memory budget: 8 for each trunk
    // group, 6 for the mesh. These are MapView's real arguments — if they drift
    // apart, the animation would index a layer that was never created.
    expect(buildDashFlowSteps(2, 1.5, 8)).toHaveLength(8)
    expect(buildDashFlowSteps(2.2, 5.5, 8)).toHaveLength(8)
    expect(buildDashFlowSteps(1.2, 7, 6)).toHaveLength(6)
  })

  it('keeps the mesh gentler than the mains, and the periods out of lockstep', () => {
    // The trunk groups advance one phase per 70 ms tick; the mesh advances one
    // phase every SECOND tick, so its per-tick travel is the smaller number.
    const trunkPerTick = (2.2 + 5.5) / 8
    const meshPerTick = (1.2 + 7) / 6 / 2
    expect(meshPerTick).toBeLessThan(trunkPerTick)
    // Trunk groups share a period by design (they are one visual system); the
    // mesh must not, or the whole map would pulse in lockstep.
    expect(8 * 70).toBe(560)
    expect(6 * 70 * 2).toBe(840)
    expect(6 * 70 * 2).not.toBe(8 * 70)
  })

  it('handles a step that lands exactly on the gap boundary', () => {
    // dash 2 / gap 2, 4 steps → offsets 0, 1, 2, 3; the third is exactly `gap`,
    // the branch where the dash starts wrapping round the cycle.
    const steps = buildDashFlowSteps(2, 2, 4)
    expect(steps.map(s => dashStart(s, 4))).toEqual([0, 1, 2, 3])
    expect(steps.every(s => sum(s) === 4)).toBe(true)
  })
})

describe('buildWaterDistributionFeatures', () => {
  it('emits one LineString per road, carrying its class and pulse bucket', () => {
    const fc = buildWaterDistributionFeatures([
      { class: 'motorway', coordinates: ROAD },
      { class: 'service', coordinates: ROAD },
    ])
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: ROAD })
    // Neither road carries a `dist`, so both are unreached: no bucket lights.
    expect(fc.features[0].properties).toEqual({ class: 'motorway', bucket: null })
    expect(fc.features[1].properties).toEqual({ class: 'service', bucket: null })
  })

  it('keeps one feature per road rather than merging a class into a MultiLineString', () => {
    // Per-road features are what let MapLibre cull and query each street; the
    // source is written on load and after a style swap, never per frame.
    const fc = buildWaterDistributionFeatures([
      { class: 'primary', coordinates: ROAD },
      { class: 'primary', coordinates: ROAD },
      { class: 'primary', coordinates: ROAD },
    ])
    expect(fc.features).toHaveLength(3)
    expect(fc.features.every(f => f.geometry.type === 'LineString')).toBe(true)
  })

  it('buckets each road by its distance from the treated-water source', () => {
    const fc = buildWaterDistributionFeatures([
      { class: 'primary', coordinates: ROAD, dist: 850 },
      { class: 'minor', coordinates: ROAD, dist: null },
      { class: 'minor', coordinates: ROAD, dist: 100_000 }, // far beyond the budget
    ], 400, 20)
    expect(fc.features.map(f => f.properties?.bucket)).toEqual([2, null, 19])
  })

  it('defaults to the mesh bucket length and budget when none are given', () => {
    const roads = [{ class: 'primary', coordinates: ROAD, dist: 850 }]
    expect(buildWaterDistributionFeatures(roads)).toEqual(
      buildWaterDistributionFeatures(roads, WATER_PULSE_BUCKET_M, WATER_MESH_PULSE_BUCKETS),
    )
  })

  it('skips a road that is not a line, and tolerates no file at all', () => {
    expect(buildWaterDistributionFeatures([
      { class: 'minor', coordinates: [ROAD[0]] },
      { class: 'minor', coordinates: [] },
    ]).features).toHaveLength(0)
    expect(buildWaterDistributionFeatures(null).features).toHaveLength(0)
    expect(buildWaterDistributionFeatures(undefined).features).toHaveLength(0)
  })

  it('names the classes drawn wide, for the width expression to match on', () => {
    expect([...WATER_DISTRIBUTION_MAJOR_CLASSES]).toEqual(['motorway', 'trunk', 'primary'])
  })
})

describe('waterDistributionBucketCount', () => {
  it('is the highest bucket actually filled, plus one', () => {
    const roads = [
      { class: 'primary', coordinates: ROAD, dist: 100 },   // bucket 0
      { class: 'secondary', coordinates: ROAD, dist: 850 }, // bucket 2
      { class: 'minor', coordinates: ROAD, dist: null },    // never reached, no bucket
    ]
    expect(waterDistributionBucketCount(roads, 400, 20)).toBe(3)
  })

  it('is 0 for no roads, and tolerates a missing file', () => {
    expect(waterDistributionBucketCount([])).toBe(0)
    expect(waterDistributionBucketCount(null)).toBe(0)
    expect(waterDistributionBucketCount(undefined)).toBe(0)
  })
})

// ---- The pulse -------------------------------------------------------------

describe('haversineM', () => {
  it('is ~111 km for one degree of latitude near the equator', () => {
    const d = haversineM([0, 0], [0, 1])
    expect(d).toBeGreaterThan(111_000 * 0.99)
    expect(d).toBeLessThan(111_000 * 1.01)
  })

  it('is 0 for identical points', () => {
    expect(haversineM([113.54, 22.2], [113.54, 22.2])).toBe(0)
  })
})

describe('waterPipeLengthM', () => {
  it('sums the haversine length of each segment of the pipe', () => {
    const p = pipe({ coordinates: LINE })
    const expected = haversineM(LINE[0], LINE[1]) + haversineM(LINE[1], LINE[2])
    expect(waterPipeLengthM(p)).toBeCloseTo(expected, 6)
  })
})

describe('waterArrivalDistances', () => {
  function chainNetwork(): WaterNetwork {
    return {
      nodes: [],
      pipes: [
        pipe({ id: 'ab', from: 'a', to: 'b', coordinates: [P0, P1] }),
        pipe({ id: 'bc', from: 'b', to: 'c', coordinates: [P1, P2] }),
      ],
    }
  }

  it('walks a chain, accumulating metres from the root as it goes', () => {
    const dist = waterArrivalDistances(chainNetwork())
    const ab = haversineM(P0, P1)
    const bc = haversineM(P1, P2)
    expect(dist.get('a')).toBe(0)
    expect(dist.get('b')).toBeCloseTo(ab, 6)
    expect(dist.get('c')).toBeCloseTo(ab + bc, 6)
  })

  it('gives a node fed two ways the shorter of its two arrivals', () => {
    // A direct a→c pipe competes with the longer a→b→c route; whichever is
    // shorter should win, exactly like Dijkstra promises.
    const net = chainNetwork()
    net.pipes.push(pipe({ id: 'ac', from: 'a', to: 'c', coordinates: [P0, P2] }))
    const direct = haversineM(P0, P2)
    const viaB = haversineM(P0, P1) + haversineM(P1, P2)
    expect(waterArrivalDistances(net).get('c')).toBeCloseTo(Math.min(direct, viaB), 6)
  })

  it('starts a root — a node with no inbound pipe — at 0', () => {
    const net: WaterNetwork = {
      nodes: [],
      pipes: [pipe({ id: 'out', from: 'res-main', to: 'plant-1', coordinates: [P0, P1] })],
    }
    expect(waterArrivalDistances(net).get('res-main')).toBe(0)
  })

  it('omits an id that names no node and touches no pipe', () => {
    expect(waterArrivalDistances(chainNetwork()).has('nowhere')).toBe(false)
  })

  it('leaves a node stuck in a cycle with no root feeding it off the map', () => {
    // x and y feed only each other, so neither is a root (both have an
    // inbound pipe) and Dijkstra never reaches them — per the comment on
    // waterArrivalDistances (src/water.ts:636-640), the pulse builder then
    // treats either as its own start rather than pretending they are 0.
    const net: WaterNetwork = {
      nodes: [],
      pipes: [
        pipe({ id: 'xy', from: 'x', to: 'y', coordinates: [P0, P1] }),
        pipe({ id: 'yx', from: 'y', to: 'x', coordinates: [P1, P0] }),
      ],
    }
    const dist = waterArrivalDistances(net)
    expect(dist.has('x')).toBe(false)
    expect(dist.has('y')).toBe(false)
  })

  it('tolerates a missing network', () => {
    expect(waterArrivalDistances(null).size).toBe(0)
    expect(waterArrivalDistances(undefined).size).toBe(0)
  })
})

describe('waterDistanceBucket', () => {
  it('floors a distance into its bucket', () => {
    expect(waterDistanceBucket(0, 400, 20)).toBe(0)
    expect(waterDistanceBucket(399, 400, 20)).toBe(0)
    expect(waterDistanceBucket(400, 400, 20)).toBe(1)
    expect(waterDistanceBucket(850, 400, 20)).toBe(2)
  })

  it('clamps into the last bucket rather than growing past the layer budget', () => {
    expect(waterDistanceBucket(100_000, 400, 20)).toBe(19)
  })

  it('is null for an unknown, negative or non-finite distance', () => {
    expect(waterDistanceBucket(null, 400, 20)).toBeNull()
    expect(waterDistanceBucket(undefined, 400, 20)).toBeNull()
    expect(waterDistanceBucket(-1, 400, 20)).toBeNull()
    expect(waterDistanceBucket(Infinity, 400, 20)).toBeNull()
    expect(waterDistanceBucket(NaN, 400, 20)).toBeNull()
  })
})

describe('buildWaterPulseFeatures', () => {
  it('cuts a long pipe into contiguous bucket-length chunks', () => {
    const net: WaterNetwork = {
      nodes: [],
      pipes: [pipe({ id: 'p1', from: 'root', to: 'plant', kind: 'raw', coordinates: [P0, P1] })],
    }
    const build = buildWaterPulseFeatures(net, 400, 40)
    const feats = build.features.features
    expect(feats).toHaveLength(3)
    expect(feats.map(f => f.properties?.bucket)).toEqual([0, 1, 2])
    expect(feats.every(f => f.properties?.kind === 'raw' && f.properties?.pipeId === 'p1')).toBe(true)
    expect(build.buckets).toBe(3)

    // Consecutive chunks share their boundary vertex, so the lit wave has no
    // gaps as it crosses from one bucket's layer to the next.
    const c0 = (feats[0].geometry as GeoJSON.LineString).coordinates
    const c1 = (feats[1].geometry as GeoJSON.LineString).coordinates
    const c2 = (feats[2].geometry as GeoJSON.LineString).coordinates
    expect(c0[c0.length - 1]).toEqual(c1[0])
    expect(c1[c1.length - 1]).toEqual(c2[0])

    // ~400 m, ~400 m, and whatever is left of the ~1000 m pipe.
    const total = haversineM(P0, P1)
    expect(Math.abs(haversineM(c0[0], c0[1]) - 400)).toBeLessThan(1)
    expect(Math.abs(haversineM(c1[0], c1[1]) - 400)).toBeLessThan(1)
    expect(Math.abs(haversineM(c2[0], c2[1]) - (total - 800))).toBeLessThan(1)
  })

  it('starts a downstream pipe at the bucket its arrival distance falls in', () => {
    const net: WaterNetwork = {
      nodes: [],
      pipes: [
        pipe({ id: 'p1', from: 'root', to: 'plant', kind: 'raw', coordinates: [P0, P1] }),
        pipe({ id: 'p2', from: 'plant', to: 'tank', kind: 'treated', coordinates: [P1, P2] }),
      ],
    }
    const build = buildWaterPulseFeatures(net, 400, 40)
    const p2 = build.features.features.filter(f => f.properties?.pipeId === 'p2')
    expect(p2).toHaveLength(1)
    expect(p2[0].properties?.bucket).toBe(2)
  })

  it('clamps a chunk past the layer budget into the last bucket', () => {
    const net: WaterNetwork = {
      nodes: [],
      pipes: [pipe({ id: 'p1', from: 'root', to: 'plant', coordinates: [P0, P1] })],
    }
    const build = buildWaterPulseFeatures(net, 400, 2)
    expect(build.features.features.map(f => f.properties?.bucket)).toEqual([0, 1, 1])
    expect(build.buckets).toBe(2)
  })

  it('skips a pipe with fewer than two coordinates', () => {
    const net: WaterNetwork = {
      nodes: [],
      pipes: [pipe({ id: 'p0', from: 'root', to: 'plant', coordinates: [P0] })],
    }
    const build = buildWaterPulseFeatures(net)
    expect(build.features.features).toHaveLength(0)
    expect(build.buckets).toBe(0)
  })

  it('is empty for an empty or missing network', () => {
    const empty = { features: { type: 'FeatureCollection', features: [] }, buckets: 0 }
    expect(buildWaterPulseFeatures({ nodes: [], pipes: [] })).toEqual(empty)
    expect(buildWaterPulseFeatures(null)).toEqual(empty)
    expect(buildWaterPulseFeatures(undefined)).toEqual(empty)
  })

  it('uses the trunk bucket length and budget when none are given', () => {
    const net: WaterNetwork = {
      nodes: [],
      pipes: [pipe({ id: 'p1', from: 'root', to: 'plant', coordinates: [P0, P1] })],
    }
    expect(buildWaterPulseFeatures(net)).toEqual(
      buildWaterPulseFeatures(net, WATER_PULSE_BUCKET_M, WATER_TRUNK_PULSE_BUCKETS),
    )
  })
})

describe('pulse tuning constants', () => {
  it('keeps the budget and timing MapView is built against', () => {
    expect(WATER_PULSE_BUCKET_M).toBe(400)
    expect(WATER_TRUNK_PULSE_BUCKETS).toBe(40)
    expect(WATER_MESH_PULSE_BUCKETS).toBe(20)
    expect(WATER_PULSE_TAIL).toEqual([1, 0.55, 0.25])
    expect(WATER_PULSE_STEP_TICKS).toBe(2)
    expect(WATER_PULSE_REST_STEPS).toBe(10)
  })
})

describe('initialWaterPulseState', () => {
  it('starts before bucket 0, so the first step lights it', () => {
    expect(initialWaterPulseState()).toEqual({ phase: 'trunk', head: -1, tick: 0 })
  })
})

describe('advanceWaterPulse', () => {
  const COUNTS: WaterPulseCounts = { trunk: 3, mesh: 2 }
  const TAIL = [1, 0.5]

  it('walks the head and a fading tail through trunk → mesh → rest → trunk, tick by tick', () => {
    // stepTicks 1 so every call steps once; restSteps 1 so rest is a single
    // silent tick. Hand-traced against advanceWaterPulse in src/water.ts.
    let state = initialWaterPulseState()
    const trace: { phase: string; head: number; writes: WaterPulseWrite[] }[] = []
    for (let i = 0; i < 11; i++) {
      const { next, writes } = advanceWaterPulse(state, COUNTS, 1, 1, TAIL)
      trace.push({ phase: next.phase, head: next.head, writes })
      state = next
    }
    expect(trace).toEqual([
      // Trunk: head walks 0 → count-1+tail.length (3-1+2=4). Each tick lights
      // the head, fades the previous two per the tail, and zeroes the bucket
      // just behind the tail so it does not stay lit forever.
      { phase: 'trunk', head: 0, writes: [{ group: 'trunk', index: 0, opacity: 1 }] },
      { phase: 'trunk', head: 1, writes: [
        { group: 'trunk', index: 1, opacity: 1 },
        { group: 'trunk', index: 0, opacity: 0.5 },
      ] },
      { phase: 'trunk', head: 2, writes: [
        { group: 'trunk', index: 2, opacity: 1 },
        { group: 'trunk', index: 1, opacity: 0.5 },
        { group: 'trunk', index: 0, opacity: 0 },
      ] },
      { phase: 'trunk', head: 3, writes: [
        { group: 'trunk', index: 2, opacity: 0.5 },
        { group: 'trunk', index: 1, opacity: 0 },
      ] },
      { phase: 'trunk', head: 4, writes: [{ group: 'trunk', index: 2, opacity: 0 }] },
      // Mesh follows immediately, same shape at its own (smaller) count.
      { phase: 'mesh', head: 0, writes: [{ group: 'mesh', index: 0, opacity: 1 }] },
      { phase: 'mesh', head: 1, writes: [
        { group: 'mesh', index: 1, opacity: 1 },
        { group: 'mesh', index: 0, opacity: 0.5 },
      ] },
      { phase: 'mesh', head: 2, writes: [
        { group: 'mesh', index: 1, opacity: 0.5 },
        { group: 'mesh', index: 0, opacity: 0 },
      ] },
      { phase: 'mesh', head: 3, writes: [{ group: 'mesh', index: 1, opacity: 0 }] },
      // One silent rest tick (restSteps: 1) …
      { phase: 'rest', head: 0, writes: [] },
      // … then the trunk restarts, identical to the very first entry above.
      { phase: 'trunk', head: 0, writes: [{ group: 'trunk', index: 0, opacity: 1 }] },
    ])
  })

  it('does nothing on the ticks between steps', () => {
    const s0 = initialWaterPulseState()
    const r1 = advanceWaterPulse(s0, COUNTS, 2, 1, TAIL) // tick 1: odd, no step
    expect(r1.writes).toEqual([])
    expect(r1.next).toEqual({ phase: 'trunk', head: -1, tick: 1 })
    const r2 = advanceWaterPulse(r1.next, COUNTS, 2, 1, TAIL) // tick 2: steps
    expect(r2.writes).toEqual([{ group: 'trunk', index: 0, opacity: 1 }])
    expect(r2.next).toEqual({ phase: 'trunk', head: 0, tick: 2 })
  })

  it('cycles through empty phases without writing or throwing when nothing has loaded', () => {
    let state = initialWaterPulseState()
    const zero: WaterPulseCounts = { trunk: 0, mesh: 0 }
    for (let i = 0; i < 20; i++) {
      const { next, writes } = advanceWaterPulse(state, zero, 1, 1, TAIL)
      expect(writes).toEqual([])
      state = next
    }
  })

  it('skips straight from trunk to rest when the mesh has not loaded', () => {
    const counts: WaterPulseCounts = { trunk: 1, mesh: 0 }
    let state = initialWaterPulseState()
    const phases: string[] = []
    for (let i = 0; i < 5; i++) {
      const { next } = advanceWaterPulse(state, counts, 1, 1, TAIL)
      phases.push(next.phase)
      state = next
    }
    // trunk's head walks 0..count-1+tail.length (0..2, three ticks); the mesh
    // is empty so the hop loop falls straight through it into rest.
    expect(phases).toEqual(['trunk', 'trunk', 'trunk', 'rest', 'trunk'])
  })
})

describe('waterPipeCount', () => {
  const net = network({
    pipes: [
      pipe({ id: 'a', from: 'inlet-zhuhai', to: 'wtp-ilha-verde' }),
      pipe({ id: 'b', from: 'wtp-ilha-verde', to: 'ps-ilha-verde', kind: 'treated' }),
      pipe({ id: 'c', from: 'res-main', to: 'rwps-main-reservoir' }),
    ],
  })

  it('counts a facility’s pipes in both directions', () => {
    expect(waterPipeCount(net, 'wtp-ilha-verde')).toBe(2)
    expect(waterPipeCount(net, 'inlet-zhuhai')).toBe(1)
    expect(waterPipeCount(net, 'res-main')).toBe(1)
  })

  it('is 0 for an unconnected id, an empty id and a missing network', () => {
    expect(waterPipeCount(net, 'tank-taipa-70')).toBe(0)
    expect(waterPipeCount(net, '')).toBe(0)
    expect(waterPipeCount(null, 'wtp-ilha-verde')).toBe(0)
    expect(waterPipeCount(undefined, 'wtp-ilha-verde')).toBe(0)
  })
})

describe('waterLabelField', () => {
  it('names one marker property per UI language', () => {
    expect([waterLabelField('zh'), waterLabelField('en'), waterLabelField('pt')])
      .toEqual(['label_zh', 'label_en', 'label_pt'])
  })
})

describe('buildWaterMarkerFeatures with a network', () => {
  it('appends the inlet node as its own marker, labelled in all three languages', () => {
    const fc = buildWaterMarkerFeatures([facility({ id: 'a' })], network())
    expect(fc.features).toHaveLength(2)
    const inlet = fc.features[1]
    expect(inlet.geometry).toEqual({ type: 'Point', coordinates: [113.5390, 22.2160] })
    expect(inlet.properties).toEqual({
      facilityId: 'inlet-zhuhai',
      type: 'inlet',
      // A deliberate point, not a stand-in for a facility we could not find —
      // so it never draws with the hollow "approximate" plate.
      approximate: false,
      icon: WATER_INLET_ICON,
      stage: 1,
      badge: 'water-badge-1',
      label_zh: '珠海原水輸入',
      label_en: 'Raw water from Zhuhai',
      label_pt: 'Água bruta de Zhuhai',
    })
  })

  it('flags a node whose position is not published, and leaves an ordinary one exact', () => {
    const approxNet = network({
      nodes: [{
        id: 'inlet-hengqin', kind: 'inlet',
        name: { zh: '橫琴原水輸入', en: 'Raw water from Hengqin', pt: 'Água bruta de Hengqin' },
        coordinates: [113.5601, 22.1587],
        approximate: true,
      }],
    })
    expect(buildWaterMarkerFeatures([], approxNet).features[0].properties).toMatchObject({ approximate: true })
    // The default fixture node carries no `approximate` field at all — still false.
    expect(buildWaterMarkerFeatures([], network()).features[0].properties).toMatchObject({ approximate: false })
  })

  it('gives an unrecognised node kind stage 0, so the badge layer filters it out', () => {
    const net = network({
      nodes: [{ id: 'mystery', kind: 'weir', name: { zh: '', en: '', pt: '' }, coordinates: [113.55, 22.21] }],
    })
    expect(buildWaterMarkerFeatures([], net).features[0].properties)
      .toMatchObject({ stage: 0, badge: 'water-badge-0' })
  })

  it('leaves the facility markers unlabelled and unchanged', () => {
    const withNet = buildWaterMarkerFeatures([facility({ id: 'a' })], network())
    const without = buildWaterMarkerFeatures([facility({ id: 'a' })])
    expect(withNet.features[0]).toEqual(without.features[0])
    expect(withNet.features[0].properties).not.toHaveProperty('label_zh')
  })

  it('emits facilities only when the network is absent or has no nodes', () => {
    expect(buildWaterMarkerFeatures([facility()], null).features).toHaveLength(1)
    expect(buildWaterMarkerFeatures([facility()], network({ nodes: [] })).features).toHaveLength(1)
  })
})

describe('waterLegendRows', () => {
  const t = {
    waterTypePlant: '水廠',
    waterTypeReservoir: '水塘',
    waterTypeTank: '高位水池',
    waterTypeRawPumping: '原水泵站',
    waterTypePumping: '泵站',
    waterTypeInlet: '原水輸入',
    waterApproximate: '約略位置',
    waterPipeRaw: '原水管',
    waterPipeTreated: '淨水管',
    waterPipeFallback: '示意直線',
    waterLegendDistribution: '配水管網（示意，沿全澳道路）',
    waterPulse: '脈衝：供水順序 ① → ⑦',
  } as Translations

  // The chain in flow order, stage-0 style rows excluded — reused by every
  // scenario below so the expected id list only has to spell out what differs.
  const CHAIN_IDS = ['reservoir', 'raw_pumping', 'plant', 'pumping', 'tank', 'distribution']

  it('lists the chain in flow order, then the style rows, with no network', () => {
    const rows = waterLegendRows(t, undefined)
    expect(rows.map(r => r.id)).toEqual([...CHAIN_IDS, 'pulse', 'approximate'])
    expect(rows.map(r => r.label)).toEqual([
      '水塘', '原水泵站', '水廠', '泵站', '高位水池',
      '配水管網（示意，沿全澳道路）', '脈衝：供水順序 ① → ⑦', '約略位置',
    ])
    // Chain rows carry ascending stage numbers 2..7 (no inlet); style rows are 0.
    expect(rows.map(r => r.stage)).toEqual([2, 3, 4, 5, 6, 7, 0, 0])
    // The five facility rows keep WATER_TYPE_ORDER's colours, in that order.
    expect(rows.slice(0, 5).map(r => r.color)).toEqual([...WATER_TYPE_ORDER].map(type => WATER_COLORS[type]))
    expect(rows.find(r => r.id === 'reservoir')?.glyph).toBe('squareFill')
    expect(rows.find(r => r.id === 'approximate')?.glyph).toBe('dropletHollow')
    const pulse = rows.find(r => r.id === 'pulse')
    expect(pulse).toMatchObject({ glyph: 'pulse', color: WATER_PULSE_COLOR, dashed: false, thin: false, stage: 0 })
  })

  it('adds the inlet row first and the two pipe rows once the file has a network', () => {
    const rows = waterLegendRows(t, network())
    expect(rows.map(r => r.id)).toEqual([
      'inlet', ...CHAIN_IDS, 'pulse', 'pipe-raw', 'pipe-treated', 'approximate',
    ])
    expect(rows[0]).toMatchObject({ glyph: 'inlet', color: WATER_INLET_COLOR, stage: 1 })
    const raw = rows.find(r => r.id === 'pipe-raw')
    expect(raw).toMatchObject({ glyph: 'line', color: WATER_PIPE_COLORS.raw, dashed: true, thin: false, stage: 0 })
    expect(rows.find(r => r.id === 'pipe-treated'))
      .toMatchObject({ glyph: 'line', color: WATER_PIPE_COLORS.treated, dashed: false, thin: false, stage: 0 })
  })

  it('draws the distribution row thin and desaturated, never as a trunk main', () => {
    const row = waterLegendRows(t, network()).find(r => r.id === 'distribution')
    expect(row).toMatchObject({
      glyph: 'line', color: WATER_DISTRIBUTION_COLOR, dashed: false, thin: true,
      label: '配水管網（示意，沿全澳道路）', stage: 7,
    })
    // The swatch has to differ from the treated trunk row above it, or the key
    // would claim two visibly different networks look the same.
    expect(WATER_DISTRIBUTION_COLOR).not.toBe(WATER_PIPE_COLORS.treated)
  })

  it('explains the straight-line stand-in ONLY when a pipe actually fell back', () => {
    expect(waterLegendRows(t, network()).some(r => r.id === 'pipe-fallback')).toBe(false)
    const withFallback = waterLegendRows(t, network({
      pipes: [pipe({ id: 'a' }), pipe({ id: 'b', fallback: true })],
    }))
    expect(withFallback.find(r => r.id === 'pipe-fallback'))
      .toMatchObject({ glyph: 'line', color: '#94a3b8', dashed: true, label: '示意直線', stage: 0 })
    // It slots in right after the two pipe-kind rows, before 'approximate'.
    expect(withFallback.map(r => r.id).slice(-3)).toEqual(['pipe-treated', 'pipe-fallback', 'approximate'])
  })

  it('leaves out the pipe rows with no pipes, and the inlet with no inlet node', () => {
    const noPipes = waterLegendRows(t, network({ pipes: [] }))
    expect(noPipes.some(r => r.id.startsWith('pipe-'))).toBe(false)
    expect(noPipes.some(r => r.id === 'inlet')).toBe(true)
    // …but the roads are still there, so the distribution row stays.
    expect(noPipes.some(r => r.id === 'distribution')).toBe(true)
    const noNodes = waterLegendRows(t, network({ nodes: [] }))
    expect(noNodes.some(r => r.id === 'inlet')).toBe(false)
    // reservoir..distribution (6) + pulse + approximate — no inlet, no pipes.
    expect(waterLegendRows(t, undefined).map(r => r.id)).toHaveLength(8)
  })
})

describe('countWaterFootprints', () => {
  it('counts only the footprints the map actually draws', () => {
    expect(countWaterFootprints(facility())).toBe(1)
    expect(countWaterFootprints(facility({ buildings: [] }))).toBe(0)
    expect(countWaterFootprints(facility({
      buildings: [building(), building({ osmId: 'w2', coordinates: [] })],
    }))).toBe(1)
  })
})

// ---- Focus mode -----------------------------------------------------------

const FULL: LayerVisibilityState = {
  lrt: ['lrt-taipa', 'lrt-hengqin'],
  busAuto: false,
  busRoutes: ['1', '3', 'AP1'],
  flights: true,
  ferries: true,
  roadWorks: true,
  schools: false,
  toilets: true,
  carParks: false,
}

function recorder() {
  const calls: [string, unknown][] = []
  const apply: LayerVisibilityApply = {
    setLrt: ids => calls.push(['lrt', [...ids]]),
    setBus: (routeIds, auto) => calls.push(['bus', [[...routeIds], auto]]),
    setFlights: on => calls.push(['flights', on]),
    setFerries: on => calls.push(['ferries', on]),
    setRoadWorks: on => calls.push(['roadWorks', on]),
    setSchools: on => calls.push(['schools', on]),
    setToilets: on => calls.push(['toilets', on]),
    setCarParks: on => calls.push(['carParks', on]),
  }
  return { calls, apply }
}

describe('captureLayerSnapshot', () => {
  it('copies the arrays so a later mutation cannot rewrite history', () => {
    const lrt = ['lrt-taipa']
    const snap = captureLayerSnapshot({ ...FULL, lrt })
    lrt.push('lrt-hengqin')
    expect(snap.lrt).toEqual(['lrt-taipa'])
  })

  it('drops the route list in auto mode, so auto restores as auto', () => {
    const snap = captureLayerSnapshot({ ...FULL, busAuto: true })
    expect(snap.busAuto).toBe(true)
    expect(snap.busRoutes).toEqual([])
  })
})

describe('applyWaterFocus', () => {
  it('turns every other layer off, and takes buses out of auto mode', () => {
    const { calls, apply } = recorder()
    applyWaterFocus(apply)
    expect(calls).toEqual([
      ['lrt', []],
      // Leaving auto on would let the next clock tick refill the map.
      ['bus', [[], false]],
      ['flights', false],
      ['ferries', false],
      ['roadWorks', false],
      ['schools', false],
      ['toilets', false],
      ['carParks', false],
    ])
  })
})

describe('applyLayerSnapshot', () => {
  it('puts an explicit selection back exactly', () => {
    const { calls, apply } = recorder()
    applyLayerSnapshot(captureLayerSnapshot(FULL), apply)
    expect(calls).toEqual([
      ['lrt', ['lrt-taipa', 'lrt-hengqin']],
      ['bus', [['1', '3', 'AP1'], false]],
      ['flights', true],
      ['ferries', true],
      ['roadWorks', true],
      ['schools', false],
      ['toilets', true],
      ['carParks', false],
    ])
  })

  it('restores auto-by-time as auto rather than as a frozen route set', () => {
    const { calls, apply } = recorder()
    applyLayerSnapshot(captureLayerSnapshot({ ...FULL, busAuto: true }), apply)
    expect(calls.find(c => c[0] === 'bus')?.[1]).toEqual([[], true])
  })

  it('round-trips: capture → focus → restore lands back on the original', () => {
    const { calls, apply } = recorder()
    const snap = captureLayerSnapshot(FULL)
    applyWaterFocus(apply)
    calls.length = 0
    applyLayerSnapshot(snap, apply)
    expect(Object.fromEntries(calls)).toEqual({
      lrt: FULL.lrt,
      bus: [FULL.busRoutes, false],
      flights: true,
      ferries: true,
      roadWorks: true,
      schools: false,
      toilets: true,
      carParks: false,
    })
  })
})

describe('loadWaterFocusSnapshot / saveWaterFocusSnapshot', () => {
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

  it('round-trips a snapshot through storage', () => {
    stubStorage()
    saveWaterFocusSnapshot(captureLayerSnapshot(FULL))
    expect(loadWaterFocusSnapshot()).toEqual(captureLayerSnapshot(FULL))
  })

  it('forgets the snapshot when saved as null', () => {
    const store = stubStorage()
    saveWaterFocusSnapshot(captureLayerSnapshot(FULL))
    saveWaterFocusSnapshot(null)
    expect(store.has('mini-macau-water-focus-snapshot')).toBe(false)
    expect(loadWaterFocusSnapshot()).toBeNull()
  })

  it('reads nothing from missing, corrupt or wrongly-shaped storage', () => {
    stubStorage()
    expect(loadWaterFocusSnapshot()).toBeNull()
    stubStorage({ 'mini-macau-water-focus-snapshot': 'not json' })
    expect(loadWaterFocusSnapshot()).toBeNull()
    stubStorage({ 'mini-macau-water-focus-snapshot': '["nope"]' })
    expect(loadWaterFocusSnapshot()).toBeNull()
  })

  it('coerces a partial payload instead of trusting it', () => {
    stubStorage({ 'mini-macau-water-focus-snapshot': '{"lrt":["a",7],"flights":"yes"}' })
    expect(loadWaterFocusSnapshot()).toEqual({
      lrt: ['a'],
      busAuto: false,
      busRoutes: [],
      flights: false,
      ferries: false,
      roadWorks: false,
      schools: false,
      toilets: false,
      carParks: false,
    })
  })

  it('survives storage that throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    expect(loadWaterFocusSnapshot()).toBeNull()
    expect(() => saveWaterFocusSnapshot(captureLayerSnapshot(FULL))).not.toThrow()
    expect(() => saveWaterFocusSnapshot(null)).not.toThrow()
  })
})
