import { describe, it, expect } from 'vitest'
import {
  POWER_COLORS,
  POWER_DISTRIBUTION_COLOR,
  POWER_DISTRIBUTION_MAJOR_CLASSES,
  POWER_FEATURE_ID_PROPERTY,
  POWER_HEIGHT_MARGIN_M,
  POWER_INLET_COLOR,
  POWER_INLET_ICON,
  POWER_LINE_COLORS,
  POWER_LINE_FALLBACK_COLOR,
  POWER_LINE_WIDTHS,
  POWER_TYPE_ORDER,
  POWER_VOLTAGES,
  buildPowerBuildingFeatures,
  buildPowerDistributionFeatures,
  buildPowerLineFeatures,
  buildPowerMarkerFeatures,
  countPowerFootprints,
  isPowerVoltage,
  pickPowerText,
  powerAnchorFacility,
  powerIconName,
  powerLabelField,
  powerLegendRows,
  powerLineColor,
  powerLineCount,
  powerLineWidth,
  powerOperator,
  powerOperatorLabel,
  powerPlantUnits,
  powerTypeLabel,
} from './power'
import type { Translations } from './i18n'
import type {
  PowerBuilding,
  PowerFacility,
  PowerLine,
  PowerNetwork,
} from './types'

const RING: [number, number][][] = [[
  [113.5404, 22.2114], [113.5405, 22.2114], [113.5405, 22.2115], [113.5404, 22.2114],
]]

function building(over: Partial<PowerBuilding> = {}): PowerBuilding {
  return { osmId: 'w1', name: '控制室', height: 12, minHeight: 0, kind: 'building', coordinates: RING, ...over }
}

function facility(over: Partial<PowerFacility> = {}): PowerFacility {
  return {
    id: 'sub-lotus',
    type: 'sub220',
    operator: 'cem',
    name: { zh: '蓮花變電站', en: 'Lotus Substation', pt: 'Subestação Flor de Lótus' },
    voltageKv: 220,
    coordinates: [113.5652, 22.1421],
    approximate: false,
    anchor: null,
    osm: ['w692620497'],
    buildings: [building()],
    ...over,
  }
}

function line(over: Partial<PowerLine> = {}): PowerLine {
  return {
    id: 'ln-inlet-lotus',
    from: 'inlet-lotus',
    to: 'sub-lotus',
    voltageKv: 220,
    lengthM: 820,
    fallback: false,
    coordinates: [[113.56, 22.14], [113.565, 22.142]],
    ...over,
  }
}

function network(over: Partial<PowerNetwork> = {}): PowerNetwork {
  return {
    nodes: [{
      id: 'inlet-lotus',
      kind: 'inlet',
      name: { zh: '廣東電網輸入（蓮花）', en: 'Guangdong grid import (Lotus)', pt: '' },
      coordinates: [113.56, 22.14],
    }],
    lines: [line()],
    ...over,
  }
}

describe('the colour and width tables', () => {
  it('has a colour for every facility type in display order', () => {
    expect(POWER_TYPE_ORDER).toEqual(['plant', 'incinerator', 'sub220', 'sub110', 'sub66'])
    for (const type of POWER_TYPE_ORDER) {
      expect(POWER_COLORS[type]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('draws each line in the colour of the substations it joins', () => {
    expect(POWER_VOLTAGES).toEqual([220, 110, 66])
    expect(POWER_LINE_COLORS[220]).toBe(POWER_COLORS.sub220)
    expect(POWER_LINE_COLORS[110]).toBe(POWER_COLORS.sub110)
    expect(POWER_LINE_COLORS[66]).toBe(POWER_COLORS.sub66)
  })

  it('widens a corridor with its voltage, at both ends of the zoom ramp', () => {
    expect(POWER_LINE_WIDTHS[220][0]).toBeGreaterThan(POWER_LINE_WIDTHS[110][0])
    expect(POWER_LINE_WIDTHS[110][0]).toBeGreaterThan(POWER_LINE_WIDTHS[66][0])
    expect(POWER_LINE_WIDTHS[220][1]).toBeGreaterThan(POWER_LINE_WIDTHS[110][1])
    expect(POWER_LINE_WIDTHS[110][1]).toBeGreaterThan(POWER_LINE_WIDTHS[66][1])
    // Every tier is wider at z16 than at z12.
    for (const kv of POWER_VOLTAGES) {
      expect(POWER_LINE_WIDTHS[kv][1]).toBeGreaterThan(POWER_LINE_WIDTHS[kv][0])
    }
  })
})

describe('isPowerVoltage / powerLineColor / powerLineWidth', () => {
  it('recognises exactly the three tiers CEM runs', () => {
    expect(isPowerVoltage(220)).toBe(true)
    expect(isPowerVoltage(110)).toBe(true)
    expect(isPowerVoltage(66)).toBe(true)
    expect(isPowerVoltage(11)).toBe(false)
    expect(isPowerVoltage(null)).toBe(false)
    expect(isPowerVoltage(undefined)).toBe(false)
  })

  it('falls back to the lowest tier rather than dropping an unknown voltage', () => {
    expect(powerLineColor(220)).toBe(POWER_COLORS.sub220)
    expect(powerLineColor(11)).toBe(POWER_COLORS.sub66)
    expect(powerLineColor(null)).toBe(POWER_COLORS.sub66)
    expect(powerLineWidth(110, 0)).toBe(POWER_LINE_WIDTHS[110][0])
    expect(powerLineWidth(110, 1)).toBe(POWER_LINE_WIDTHS[110][1])
    expect(powerLineWidth(11, 1)).toBe(POWER_LINE_WIDTHS[66][1])
  })
})

describe('powerIconName / powerLabelField', () => {
  it('names one image per (type, approximate) pair', () => {
    expect(powerIconName('sub220', false)).toBe('power-sub220')
    expect(powerIconName('sub220', true)).toBe('power-sub220-approx')
    expect(powerIconName('plant', false)).toBe('power-plant')
    // No collision with the inlet's own image.
    const all = POWER_TYPE_ORDER.flatMap(t => [powerIconName(t, false), powerIconName(t, true)])
    expect(new Set(all).size).toBe(all.length)
    expect(all).not.toContain(POWER_INLET_ICON)
  })

  it('names the per-language label field the marker features carry', () => {
    expect(powerLabelField('zh')).toBe('label_zh')
    expect(powerLabelField('en')).toBe('label_en')
    expect(powerLabelField('pt')).toBe('label_pt')
  })
})

describe('pickPowerText', () => {
  const name = { zh: '蓮花變電站', en: 'Lotus Substation', pt: 'Subestação Flor de Lótus' }

  it('reads in the requested language', () => {
    expect(pickPowerText(name, 'zh')).toBe('蓮花變電站')
    expect(pickPowerText(name, 'en')).toBe('Lotus Substation')
    expect(pickPowerText(name, 'pt')).toBe('Subestação Flor de Lótus')
  })

  it('falls pt → en → zh rather than dropping straight to Chinese', () => {
    expect(pickPowerText({ ...name, pt: '' }, 'pt')).toBe('Lotus Substation')
    expect(pickPowerText({ zh: '北安變電站', pt: '', en: '' }, 'pt')).toBe('北安變電站')
    expect(pickPowerText({ zh: '北安變電站', pt: '', en: '' }, 'en')).toBe('北安變電站')
  })

  it('is empty for a missing field rather than throwing', () => {
    expect(pickPowerText(undefined, 'en')).toBe('')
  })
})

describe('powerTypeLabel', () => {
  const t = {
    powerTypePlant: '發電廠',
    powerTypeIncinerator: '垃圾焚化中心',
    powerTypeSub220: '220 千伏變電站',
    powerTypeSub110: '110 千伏變電站',
    powerTypeSub66: '66 千伏變電站',
  } as Translations

  it('labels every type from the translation table', () => {
    expect([...POWER_TYPE_ORDER].map(type => powerTypeLabel(t, type)))
      .toEqual(['發電廠', '垃圾焚化中心', '220 千伏變電站', '110 千伏變電站', '66 千伏變電站'])
  })
})

describe('powerOperator / powerOperatorLabel', () => {
  const t = {
    powerOperatorCem: '澳電設施',
    powerOperatorDspa: '政府垃圾焚化中心 · 售電予澳電',
  } as Translations

  it('defaults to CEM when the file predates the field', () => {
    // parseData hands the runtime the RAW object, so the zod default never
    // reaches it — this helper is where the default actually lives.
    expect(powerOperator(facility({ operator: undefined }))).toBe('cem')
    expect(powerOperator(facility({ operator: 'cem' }))).toBe('cem')
  })

  it('names the incinerator as the government’s, not CEM’s', () => {
    const inc = facility({ id: 'incinerator', type: 'incinerator', operator: 'dspa', voltageKv: null })
    expect(powerOperator(inc)).toBe('dspa')
    expect(powerOperatorLabel(t, inc)).toBe('政府垃圾焚化中心 · 售電予澳電')
    expect(powerOperatorLabel(t, facility())).toBe('澳電設施')
  })
})

describe('powerAnchorFacility', () => {
  const anchored = facility({ id: 'sub-sao-paulo', approximate: true, anchor: 'sub-lotus', buildings: [] })

  it('names the facility an approximate marker actually sits at', () => {
    expect(powerAnchorFacility(anchored.anchor, [facility(), anchored])?.id).toBe('sub-lotus')
  })

  it('is null for an exact facility, a district point, or an unknown id', () => {
    expect(powerAnchorFacility(null, [facility()])).toBeNull()
    expect(powerAnchorFacility(undefined, [facility()])).toBeNull()
    expect(powerAnchorFacility('district:cotai', [facility()])).toBeNull()
    expect(powerAnchorFacility('sub-nowhere', [facility()])).toBeNull()
  })
})

describe('countPowerFootprints', () => {
  it('counts exactly the buildings the map will draw', () => {
    expect(countPowerFootprints(facility())).toBe(1)
    expect(countPowerFootprints(facility({ buildings: [] }))).toBe(0)
    // An empty ring is skipped by the builder, so it must not be counted here.
    expect(countPowerFootprints(facility({
      buildings: [building(), building({ coordinates: [] }), building({ coordinates: [[]] })],
    }))).toBe(1)
  })
})

describe('powerLineCount', () => {
  const net = network({
    lines: [
      line({ id: 'a', from: 'inlet-lotus', to: 'sub-lotus' }),
      line({ id: 'b', from: 'sub-lotus', to: 'sub-pac-on' }),
      line({ id: 'c', from: 'sub-north', to: 'sub-pac-on' }),
    ],
  })

  it('counts both directions', () => {
    expect(powerLineCount(net, 'sub-lotus')).toBe(2)
    expect(powerLineCount(net, 'sub-pac-on')).toBe(2)
    expect(powerLineCount(net, 'inlet-lotus')).toBe(1)
  })

  it('is 0 for an unknown id, an empty id, or no network at all', () => {
    expect(powerLineCount(net, 'sub-nowhere')).toBe(0)
    expect(powerLineCount(net, '')).toBe(0)
    expect(powerLineCount(null, 'sub-lotus')).toBe(0)
    expect(powerLineCount(undefined, 'sub-lotus')).toBe(0)
  })
})

describe('powerPlantUnits', () => {
  const plant = facility({
    id: 'plant-coloane', type: 'plant', voltageKv: null,
    details: { unitsZh: 'A 廠柴油機組', unitsEn: 'Plant A diesel units', unitsPt: '', capacityMw: 407.8 },
  })

  it('reads the units in the reading language, falling back like a name', () => {
    expect(powerPlantUnits(plant, 'zh')).toBe('A 廠柴油機組')
    expect(powerPlantUnits(plant, 'en')).toBe('Plant A diesel units')
    expect(powerPlantUnits(plant, 'pt')).toBe('Plant A diesel units')
  })

  it('is empty for every facility without a details block', () => {
    expect(powerPlantUnits(facility(), 'zh')).toBe('')
    expect(powerPlantUnits(facility({ details: null }), 'en')).toBe('')
  })

  it('falls back to the language-neutral unit string when there is no prose', () => {
    // 澳北 carries only `units: "A + B"`; a station with only a commissioning
    // year has no units to show at all.
    const neutral = facility({ details: { units: 'A + B' } })
    expect(powerPlantUnits(neutral, 'zh')).toBe('A + B')
    expect(powerPlantUnits(neutral, 'pt')).toBe('A + B')
    expect(powerPlantUnits(facility({ details: { commissioned: 2012 } }), 'en')).toBe('')
  })
})

describe('powerLegendRows', () => {
  const t = {
    powerTypePlant: '發電廠',
    powerTypeIncinerator: '垃圾焚化中心',
    powerTypeSub220: '220 千伏變電站',
    powerTypeSub110: '110 千伏變電站',
    powerTypeSub66: '66 千伏變電站',
    powerTypeInlet: '廣東電網輸入',
    powerApproximate: '約略位置',
    powerLegendDistribution: '配電網（示意，沿全澳道路）',
    powerLineVoltage: (kv: number) => `${kv} 千伏線路`,
  } as Translations

  it('always names the five types, the hollow plate and the distribution mesh', () => {
    const ids = powerLegendRows(t, null).map(r => r.id)
    expect(ids).toEqual([
      'plant', 'incinerator', 'sub220', 'sub110', 'sub66', 'approximate', 'distribution',
    ])
  })

  it('draws the distribution row thin and in its own colour', () => {
    const row = powerLegendRows(t, null).find(r => r.id === 'distribution')!
    expect(row.glyph).toBe('line')
    expect(row.thin).toBe(true)
    expect(row.color).toBe(POWER_DISTRIBUTION_COLOR)
  })

  it('adds a row ONLY for voltages the network actually carries, high to low', () => {
    const net = network({
      lines: [line({ voltageKv: 66 }), line({ id: 'x', voltageKv: 220 })],
    })
    const ids = powerLegendRows(t, net).map(r => r.id)
    expect(ids).toContain('line-220')
    expect(ids).toContain('line-66')
    expect(ids).not.toContain('line-110')
    expect(ids.indexOf('line-220')).toBeLessThan(ids.indexOf('line-66'))
    expect(powerLegendRows(t, net).find(r => r.id === 'line-220')!.label).toBe('220 千伏線路')
  })

  it('adds the inlet row only when the network really has import nodes', () => {
    expect(powerLegendRows(t, network()).map(r => r.id)).toContain('inlet')
    expect(powerLegendRows(t, network({ nodes: [] })).map(r => r.id)).not.toContain('inlet')
    expect(powerLegendRows(t, null).map(r => r.id)).not.toContain('inlet')
    expect(powerLegendRows(t, network()).find(r => r.id === 'inlet')!.color).toBe(POWER_INLET_COLOR)
  })

  it('marks the approximate row with the hollow glyph', () => {
    expect(powerLegendRows(t, null).find(r => r.id === 'approximate')!.glyph).toBe('boltHollow')
  })
})

describe('buildPowerBuildingFeatures', () => {
  it('bakes the type colour, the height margin and the promoted id per footprint', () => {
    const fc = buildPowerBuildingFeatures([facility()])
    expect(fc.features).toHaveLength(1)
    const p = fc.features[0].properties!
    expect(p.color).toBe(POWER_COLORS.sub220)
    expect(p[POWER_FEATURE_ID_PROPERTY]).toBe('sub-lotus')
    expect(p.height).toBe(12 + POWER_HEIGHT_MARGIN_M)
    expect(p.minHeight).toBe(0)
    expect(fc.features[0].geometry).toEqual({ type: 'Polygon', coordinates: RING })
  })

  it('gives every footprint of a facility the SAME id, so one state lights the site', () => {
    const fc = buildPowerBuildingFeatures([facility({
      buildings: [building({ osmId: 'w1' }), building({ osmId: 'w2' })],
    })])
    expect(fc.features.map(f => f.properties![POWER_FEATURE_ID_PROPERTY]))
      .toEqual(['sub-lotus', 'sub-lotus'])
  })

  it('skips unusable rings instead of emitting empty geometry', () => {
    expect(buildPowerBuildingFeatures([facility({
      buildings: [building({ coordinates: [] }), building({ coordinates: [[]] })],
    })]).features).toHaveLength(0)
    expect(buildPowerBuildingFeatures([]).features).toHaveLength(0)
  })
})

describe('buildPowerMarkerFeatures', () => {
  it('emits one marker per facility, footprint or not', () => {
    const fc = buildPowerMarkerFeatures([facility(), facility({ id: 'x', buildings: [] })])
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].properties!.icon).toBe('power-sub220')
  })

  it('draws an approximate facility hollow', () => {
    const fc = buildPowerMarkerFeatures([facility({ approximate: true })])
    expect(fc.features[0].properties!.approximate).toBe(true)
    expect(fc.features[0].properties!.icon).toBe('power-sub220-approx')
  })

  it('adds the network nodes with all three labels baked in, never hollow', () => {
    const fc = buildPowerMarkerFeatures([facility()], network())
    expect(fc.features).toHaveLength(2)
    const inlet = fc.features[1].properties!
    expect(inlet[POWER_FEATURE_ID_PROPERTY]).toBe('inlet-lotus')
    expect(inlet.icon).toBe(POWER_INLET_ICON)
    expect(inlet.approximate).toBe(false)
    expect(inlet.label_zh).toBe('廣東電網輸入（蓮花）')
    expect(inlet.label_en).toBe('Guangdong grid import (Lotus)')
    // pt is empty upstream, so it falls back to the English form.
    expect(inlet.label_pt).toBe('Guangdong grid import (Lotus)')
  })

  it('skips a record with no usable coordinate pair', () => {
    const broken = facility({ coordinates: [113.5] as unknown as [number, number] })
    expect(buildPowerMarkerFeatures([broken]).features).toHaveLength(0)
    expect(buildPowerMarkerFeatures([facility()], network({
      nodes: [{ id: 'n', kind: 'inlet', name: { zh: '', pt: '', en: '' }, coordinates: [] as unknown as [number, number] }],
    })).features).toHaveLength(1)
  })
})

describe('buildPowerLineFeatures', () => {
  it('bakes colour, both widths and the sort key from the voltage', () => {
    const fc = buildPowerLineFeatures(network({ lines: [line({ voltageKv: 110 })] }))
    const p = fc.features[0].properties!
    expect(p.voltageKv).toBe(110)
    expect(p.color).toBe(POWER_COLORS.sub110)
    expect(p.width12).toBe(POWER_LINE_WIDTHS[110][0])
    expect(p.width16).toBe(POWER_LINE_WIDTHS[110][1])
    // Higher voltage draws over lower where two share a street.
    expect(p.sortKey).toBe(110)
  })

  it('greys a straight-line stand-in, but not a deliberate direct stub', () => {
    const fb = buildPowerLineFeatures(network({ lines: [line({ fallback: true })] }))
    expect(fb.features[0].properties!.color).toBe(POWER_LINE_FALLBACK_COLOR)
    expect(fb.features[0].properties!.fallback).toBe(true)
    const direct = buildPowerLineFeatures(network({ lines: [line({ direct: true })] }))
    expect(direct.features[0].properties!.color).toBe(POWER_COLORS.sub220)
    expect(direct.features[0].properties!.direct).toBe(true)
  })

  it('preserves vertex order — the flow dots read it as the direction of supply', () => {
    const coords: [number, number][] = [[113.50, 22.10], [113.51, 22.11], [113.52, 22.12]]
    const fc = buildPowerLineFeatures(network({ lines: [line({ coordinates: coords })] }))
    expect((fc.features[0].geometry as GeoJSON.LineString).coordinates).toEqual(coords)
  })

  it('falls back to the lowest tier for an unrecognised voltage', () => {
    const fc = buildPowerLineFeatures(network({ lines: [line({ voltageKv: 11 })] }))
    expect(fc.features[0].properties!.color).toBe(POWER_COLORS.sub66)
    expect(fc.features[0].properties!.width16).toBe(POWER_LINE_WIDTHS[66][1])
    expect(fc.features[0].properties!.sortKey).toBe(0)
  })

  it('skips a line with fewer than two points, and tolerates no network', () => {
    expect(buildPowerLineFeatures(network({
      lines: [line({ coordinates: [[113.5, 22.1]] })],
    })).features).toHaveLength(0)
    expect(buildPowerLineFeatures(null).features).toHaveLength(0)
    expect(buildPowerLineFeatures(undefined).features).toHaveLength(0)
  })
})

describe('buildPowerDistributionFeatures', () => {
  const road = { class: 'primary', coordinates: [[113.54, 22.19], [113.545, 22.192]] as [number, number][] }

  it('emits one LineString per road, carrying only its class', () => {
    const fc = buildPowerDistributionFeatures([road])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties).toEqual({ class: 'primary' })
    expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: road.coordinates })
  })

  it('skips a road with fewer than two points, and tolerates null', () => {
    expect(buildPowerDistributionFeatures([
      { class: 'service', coordinates: [[113.54, 22.19]] },
    ]).features).toHaveLength(0)
    expect(buildPowerDistributionFeatures(null).features).toHaveLength(0)
    expect(buildPowerDistributionFeatures(undefined).features).toHaveLength(0)
  })

  it('names the classes drawn as wide feeders', () => {
    expect([...POWER_DISTRIBUTION_MAJOR_CLASSES]).toEqual(['motorway', 'trunk', 'primary'])
  })
})
