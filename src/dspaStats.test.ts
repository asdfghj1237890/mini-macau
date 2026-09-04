import { describe, it, expect } from 'vitest'
import {
  formatStatsAmount,
  formatStatsTick,
  seriesForKey,
  statsAxisMax,
  statsAxisStep,
  statsAxisTicks,
  statsChartModel,
  statsMonthLabel,
  pickReceivedT,
  pickTotalM3,
  pickVolumeM3,
  wwtpKeyFromId,
  wwtpSeries,
} from './dspaStats'
import type { DspaSeries, DspaStats, DspaStatsMonth, DspaStatsUnit } from './types'

function months(values: number[], field: keyof DspaStatsMonth = 'receivedT'): DspaStatsMonth[] {
  return values.map((v, i) => ({
    period: `2026-${String(i + 1).padStart(2, '0')}`,
    [field]: v,
  })) as DspaStatsMonth[]
}

function series(over: Partial<DspaSeries> = {}): DspaSeries {
  return {
    datasetId: '8142c05e-818a-478a-9256-4ecd494d3f87',
    url: 'https://data.gov.mo/Detail?id=8142c05e',
    unit: 't',
    latest: { period: '2026-06', receivedT: 58681.05 },
    months: months([59000, 58681.05]),
    ...over,
  }
}

// ---------------------------------------------------------------------------
// The axis. These series are flat by nature, so everything here is about
// refusing to draw a 6 % spread as a full-height sawtooth.
// ---------------------------------------------------------------------------

describe('statsAxisStep', () => {
  it('picks the smallest 1/2/5 × 10ⁿ step that fits the peak in ten steps', () => {
    expect(statsAxisStep(58681)).toBe(10000) // 6 steps; 5,000 would need 12
    expect(statsAxisStep(517)).toBe(100) // 6 steps — a small series gets a small step
    expect(statsAxisStep(195728)).toBe(20000) // 10 steps
    expect(statsAxisStep(6073401)).toBe(1000000) // 7 steps
    expect(statsAxisStep(861725)).toBe(100000) // 9 steps
  })

  it('is 0 for a peak of zero, which the max helper turns into a fallback axis', () => {
    expect(statsAxisStep(0)).toBe(0)
    expect(statsAxisStep(-5)).toBe(0)
  })

  it('only ever returns a nice number', () => {
    for (const peak of [3, 47, 999, 1234, 58681, 195728, 6073401, 12345678]) {
      const step = statsAxisStep(peak)
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)))
      expect([1, 2, 5]).toContain(Math.round(mantissa))
      expect(Math.ceil(peak / step)).toBeLessThanOrEqual(10)
    }
  })
})

describe('statsAxisMax', () => {
  // The real figures DSPA published for 2026-06, so the axes below are the ones
  // a reader actually sees.
  const cases: [number, DspaStatsUnit, number][] = [
    [58681.05, 't', 60000], // incinerator
    [517.61, 't', 600], // hazardous station — must NOT be a 10,000 t axis
    [195728, 'm3', 200000], // construction-waste landfill
    [6073401, 'm3', 7000000], // Macau peninsula works
    [861725, 'm3', 900000], // Taipa
    [1929535, 'm3', 2000000], // Coloane
  ]

  it.each(cases)('rounds %d up to %s', (peak, unit, expected) => {
    expect(statsAxisMax([peak], unit)).toBe(expected)
  })

  it('leaves headroom — the tallest bar is never the full height', () => {
    for (const [peak, unit] of cases) {
      expect(statsAxisMax([peak], unit)).toBeGreaterThan(peak)
    }
  })

  it('falls back to a unit-appropriate axis when there is nothing to plot', () => {
    expect(statsAxisMax([], 't')).toBe(10000)
    expect(statsAxisMax([0, 0], 'm3')).toBe(100000)
  })
})

describe('formatStatsTick', () => {
  it('abbreviates thousands and millions, so three labels fit the gutter', () => {
    expect(formatStatsTick(7000000)).toBe('7M')
    expect(formatStatsTick(3500000)).toBe('3.5M')
    expect(formatStatsTick(60000)).toBe('60k')
    expect(formatStatsTick(600)).toBe('600')
    expect(formatStatsTick(0)).toBe('0')
    expect(formatStatsTick(Number.NaN)).toBe('0')
  })
})

describe('statsAxisTicks', () => {
  it('is max / half / zero, top-first, with the offsets a gridline shares', () => {
    expect(statsAxisTicks(60000)).toEqual([
      { value: 60000, label: '60k', offset: 0 },
      { value: 30000, label: '30k', offset: 50 },
      { value: 0, label: '0', offset: 100 },
    ])
  })

  it('never divides by zero', () => {
    expect(statsAxisTicks(0).map(t => t.offset)).toEqual([0, 50, 100])
  })
})

describe('formatStatsAmount / statsMonthLabel', () => {
  it('prints whole separated numbers and an em dash for nothing', () => {
    expect(formatStatsAmount(58681.05)).toBe('58,681')
    expect(formatStatsAmount(0)).toBe('0')
    expect(formatStatsAmount(undefined)).toBe('—')
    expect(formatStatsAmount(Number.NaN)).toBe('—')
  })

  it('labels a bar with its month number', () => {
    expect(statsMonthLabel('2026-06')).toBe('06')
    expect(statsMonthLabel('nonsense')).toBe('nonsense')
  })
})

// ---------------------------------------------------------------------------
// The chart model
// ---------------------------------------------------------------------------

describe('statsChartModel', () => {
  it('scales the bars against the AXIS, and flags the newest month', () => {
    const model = statsChartModel(series({ months: months([30000, 60000, 0]) }), pickReceivedT)!
    expect(model.max).toBe(60000)
    expect(model.bars.map(b => b.percent)).toEqual([50, 100, 0])
    expect(model.bars.map(b => b.latest)).toEqual([false, false, true])
    expect(model.bars.map(b => b.label)).toEqual(['01', '02', '03'])
  })

  it('keeps a 2 % stub for a real but tiny month, so it is not a gap', () => {
    const model = statsChartModel(series({ months: months([60000, 12]) }), pickReceivedT)!
    expect(model.bars[1].percent).toBe(2)
  })

  it('plots whichever field the caller names, and carries the series unit', () => {
    const s = series({ unit: 'm3', months: months([195728], 'volumeM3') })
    const model = statsChartModel(s, pickVolumeM3)!
    expect(model.unit).toBe('m3')
    expect(model.max).toBe(200000)
    expect(model.bars[0].value).toBe(195728)
    // The same series read through the wrong picker plots zeros rather than
    // throwing — a renamed field upstream must not break the panel.
    expect(statsChartModel(s, pickTotalM3)!.bars[0].value).toBe(0)
  })

  it('is null when there is nothing to draw', () => {
    expect(statsChartModel(null, pickReceivedT)).toBeNull()
    expect(statsChartModel(undefined, pickReceivedT)).toBeNull()
    expect(statsChartModel(series({ months: [] }), pickReceivedT)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Series lookup
// ---------------------------------------------------------------------------

describe('seriesForKey / wwtpSeries', () => {
  const macau = series({ unit: 'm3' })
  const stats: DspaStats = {
    incinerator: series(),
    hazardous: series({ latest: { period: '2026-06', receivedT: 517.61, processedT: 329.1 } }),
    landfill: series({ unit: 'm3' }),
    wwtp: { macau, taipa: null, coloane: null, crossborder: null, mia: null },
  }

  it('resolves the flat keys and the dotted wwtp ones', () => {
    expect(seriesForKey(stats, 'incinerator')).toBe(stats.incinerator)
    expect(seriesForKey(stats, 'hazardous')).toBe(stats.hazardous)
    expect(seriesForKey(stats, 'landfill')).toBe(stats.landfill)
    expect(seriesForKey(stats, 'wwtp.macau')).toBe(macau)
  })

  it('is null for a missing series, an unknown key, or no file at all', () => {
    expect(seriesForKey(stats, 'wwtp.mia')).toBeNull()
    expect(seriesForKey(stats, 'wwtp.nowhere')).toBeNull()
    expect(seriesForKey(stats, 'sewage')).toBeNull()
    expect(seriesForKey(stats, 'incinerator.extra')).toBeNull()
    expect(seriesForKey(stats, null)).toBeNull()
    expect(seriesForKey(null, 'incinerator')).toBeNull()
  })

  it('maps a facility id to its sewage series', () => {
    expect(wwtpKeyFromId('wwtp-macau')).toBe('macau')
    expect(wwtpKeyFromId('wwtp-crossborder')).toBe('crossborder')
    expect(wwtpKeyFromId('wwtp-nowhere')).toBeNull()
    expect(wwtpKeyFromId('landfill-construction')).toBeNull()
    expect(wwtpSeries(stats, 'wwtp-macau')).toBe(macau)
    expect(wwtpSeries(stats, 'wwtp-mia')).toBeNull()
  })
})
