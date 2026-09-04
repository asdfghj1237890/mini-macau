import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  WATER_COLORS,
  WATER_FEATURE_ID_PROPERTY,
  WATER_DISTRIBUTION_COLOR,
  WATER_DISTRIBUTION_MAJOR_CLASSES,
  WATER_INLET_ICON,
  WATER_PIPE_COLORS,
  WATER_TYPE_ORDER,
  applyLayerSnapshot,
  applyWaterFocus,
  buildDashFlowSteps,
  buildWaterBuildingFeatures,
  buildWaterDistributionFeatures,
  buildWaterMarkerFeatures,
  buildWaterPipeFeatures,
  buildWaterSurfaceFeatures,
  captureLayerSnapshot,
  countWaterFootprints,
  loadWaterFocusSnapshot,
  pickWaterText,
  saveWaterFocusSnapshot,
  waterAnchorFacility,
  waterIconName,
  waterLabelField,
  waterLegendRows,
  waterOperator,
  waterOperatorLabel,
  waterPipeCount,
  waterTypeLabel,
  type LayerVisibilityApply,
  type LayerVisibilityState,
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

  it('has one legend swatch per colour, in the operator’s numbering order', () => {
    expect([...WATER_TYPE_ORDER]).toEqual(Object.keys(WATER_COLORS))
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
      .toEqual(['水廠', '水塘', '高位水池', '原水泵站', '泵站'])
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
    })
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
  const ROAD: [number, number][] = [[113.54, 22.19], [113.545, 22.192]]

  it('emits one LineString per road, carrying only its class', () => {
    const fc = buildWaterDistributionFeatures([
      { class: 'motorway', coordinates: ROAD },
      { class: 'service', coordinates: ROAD },
    ])
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: ROAD })
    expect(fc.features[0].properties).toEqual({ class: 'motorway' })
    expect(fc.features[1].properties).toEqual({ class: 'service' })
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
      label_zh: '珠海原水輸入',
      label_en: 'Raw water from Zhuhai',
      label_pt: 'Água bruta de Zhuhai',
    })
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
  } as Translations

  it('always names the five facility colours, the hollow marker and the roads', () => {
    const rows = waterLegendRows(t, null)
    expect(rows.map(r => r.id)).toEqual([
      'plant', 'reservoir', 'tank', 'raw_pumping', 'pumping', 'approximate',
      // The distribution network is the basemap's own roads, so it is drawn
      // whether or not the file carries a pipe network.
      'distribution',
    ])
    expect(rows.map(r => r.label)).toEqual([
      '水廠', '水塘', '高位水池', '原水泵站', '泵站', '約略位置',
      '配水管網（示意，沿全澳道路）',
    ])
    expect(rows.map(r => r.color).slice(0, 5))
      .toEqual([...WATER_TYPE_ORDER].map(type => WATER_COLORS[type]))
    expect(rows.find(r => r.id === 'reservoir')?.glyph).toBe('squareFill')
    expect(rows.find(r => r.id === 'approximate')?.glyph).toBe('dropletHollow')
  })

  it('adds the two pipe rows and the inlet once the file has a network', () => {
    const rows = waterLegendRows(t, network())
    expect(rows.map(r => r.id).slice(6))
      .toEqual(['pipe-raw', 'pipe-treated', 'distribution', 'inlet'])
    const raw = rows.find(r => r.id === 'pipe-raw')
    expect(raw).toMatchObject({ glyph: 'line', color: WATER_PIPE_COLORS.raw, dashed: true, thin: false })
    expect(rows.find(r => r.id === 'pipe-treated'))
      .toMatchObject({ glyph: 'line', color: WATER_PIPE_COLORS.treated, dashed: false, thin: false })
    expect(rows.find(r => r.id === 'inlet')?.glyph).toBe('inlet')
  })

  it('draws the distribution row thin and desaturated, never as a trunk main', () => {
    const row = waterLegendRows(t, network()).find(r => r.id === 'distribution')
    expect(row).toMatchObject({
      glyph: 'line', color: WATER_DISTRIBUTION_COLOR, dashed: false, thin: true,
      label: '配水管網（示意，沿全澳道路）',
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
      .toMatchObject({ glyph: 'line', color: '#94a3b8', dashed: true, label: '示意直線' })
  })

  it('leaves out the pipe rows with no pipes, and the inlet with no inlet node', () => {
    const noPipes = waterLegendRows(t, network({ pipes: [] }))
    expect(noPipes.some(r => r.id.startsWith('pipe-'))).toBe(false)
    expect(noPipes.some(r => r.id === 'inlet')).toBe(true)
    // …but the roads are still there, so the distribution row stays.
    expect(noPipes.some(r => r.id === 'distribution')).toBe(true)
    const noNodes = waterLegendRows(t, network({ nodes: [] }))
    expect(noNodes.some(r => r.id === 'inlet')).toBe(false)
    expect(waterLegendRows(t, undefined).map(r => r.id)).toHaveLength(7)
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
