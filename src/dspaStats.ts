// DSPA monthly statistics — the chart model shared by every panel that shows a
// published series: the incineration plant, the hazardous-waste station, the
// construction-waste landfill and the five sewage works.
//
// Everything about "how do twelve numbers become a chart" lives here exactly
// once, so a tonnes chart and a cubic-metres chart can never disagree about
// rounding, scaling or labelling — the panels only choose which field to read.
import type { Translations } from './i18n'
import type { DspaSeries, DspaStats, DspaStatsMonth, DspaStatsUnit } from './types'

// ---------------------------------------------------------------------------
// The y-axis.
//
// These series are flat by nature — a plant that burns ~58–62 kt every month,
// a works that treats ~6 M m³ — so the axis MUST be zero-based and rounded to a
// round number above the peak. Scaling twelve near-identical bars to the data
// range would turn a 6 % spread into a full-height sawtooth: a chart that
// invents a trend. Everything below exists to stop that.
// ---------------------------------------------------------------------------

// The candidate step sizes: 1, 2 and 5 times a power of ten. Any axis top is a
// whole number of these, which is what makes the tick labels readable at a
// glance (60k, 200k, 7M) instead of 58.7k.
const NICE_MULTIPLIERS = [1, 2, 5] as const

// A fallback axis for a series that is all zeros (or empty), so the chart still
// draws a real scale instead of dividing by zero.
const UNIT_FALLBACK_MAX: Record<DspaStatsUnit, number> = {
  t: 10000,
  m3: 100000,
}

// The step this series is measured in: the SMALLEST nice number that puts the
// peak within ten steps of zero. Ten is the ceiling because more than that
// makes the gridlines meaningless and fewer makes the bars hug the top — and
// because it is what turns 58,681 t into a 10,000 t step (six steps) and
// 6,073,401 m³ into a 1,000,000 m³ one (seven), which is how DSPA's own pages
// report them.
export function statsAxisStep(peak: number): number {
  if (!(peak > 0)) return 0
  for (let exp = -3; exp <= 12; exp++) {
    for (const mult of NICE_MULTIPLIERS) {
      const step = mult * Math.pow(10, exp)
      if (Math.ceil(peak / step) <= 10) return step
    }
  }
  return Math.pow(10, 12)
}

// The axis top: the peak rounded UP to a whole number of steps. Never the data
// max itself, so the tallest bar is a bar rather than the full height of the
// plot — the reader can see there is headroom, which is what says "this is a
// level, not a maximum".
export function statsAxisMax(values: readonly number[], unit: DspaStatsUnit): number {
  const peak = values.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, v) : m), 0)
  if (!(peak > 0)) return UNIT_FALLBACK_MAX[unit] ?? 1
  const step = statsAxisStep(peak)
  return Math.ceil(peak / step) * step
}

// A tick label: 7000000 → "7M", 60000 → "60k", 600 → "600", 0 → "0". Three
// labels have to fit a ~26 px gutter, so anything above a thousand is abbreviated.
export function formatStatsTick(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1e6) return `${trimZero(value / 1e6)}M`
  if (value >= 1e3) return `${trimZero(value / 1e3)}k`
  return trimZero(value)
}

function trimZero(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)))
}

// The three ticks, top-first: the axis max, its half, and zero. `offset` is the
// distance from the TOP of the plot as a percentage, so a gridline and its
// label can share one `top` value.
export function statsAxisTicks(max: number): { value: number; label: string; offset: number }[] {
  const top = max > 0 ? max : 1
  return [top, top / 2, 0].map(value => ({
    value,
    label: formatStatsTick(value),
    offset: ((top - value) / top) * 100,
  }))
}

// A published amount as the chips and tooltips print it: thousands separated,
// no decimals. These are monthly totals in the thousands or millions — the two
// decimal places upstream publishes are noise at that scale.
export function formatStatsAmount(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('en-US')
}

// "2026-06" → "06", the label under a bar. Numeric so it reads the same in all
// three UI languages.
export function statsMonthLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  return m ? m[2] : period
}

// ---------------------------------------------------------------------------
// The chart model
// ---------------------------------------------------------------------------

export interface StatsBar {
  period: string
  label: string
  value: number
  percent: number // height against the AXIS max, never against the data max
  latest: boolean
}

export interface StatsChartModel {
  bars: StatsBar[]
  ticks: { value: number; label: string; offset: number }[]
  max: number
  unit: DspaStatsUnit
}

// Which number a chart plots. Every series carries the period plus its own
// measures, so the caller names the one the bars are made of.
export type StatsPick = (month: DspaStatsMonth) => number | undefined

// The whole chart, from a series and the field to plot. A month with a real but
// tiny figure keeps a 2 % stub so it reads as a bar rather than a gap; a true
// zero draws nothing, which is the honest height. `latest` marks the newest
// month, which the chart emphasises.
export function statsChartModel(
  series: DspaSeries | null | undefined,
  pick: StatsPick,
): StatsChartModel | null {
  const months = series?.months ?? []
  if (!months.length) return null
  const values = months.map(m => pick(m) ?? 0)
  const unit = series?.unit ?? 't'
  const max = statsAxisMax(values, unit)
  return {
    max,
    unit,
    ticks: statsAxisTicks(max),
    bars: months.map((m, i) => {
      const value = pick(m) ?? 0
      return {
        period: m.period,
        label: statsMonthLabel(m.period),
        value,
        percent: value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0,
        latest: i === months.length - 1,
      }
    }),
  }
}

// The unit suffix, for the chips, the tooltips and the axis caption.
export function statsUnitLabel(t: Translations, unit: DspaStatsUnit): string {
  return unit === 'm3' ? t.statsUnitCubicMetres : t.statsUnitTonnes
}

// A number with its unit, the way every chip and tooltip prints it.
export function formatStatsValue(
  t: Translations, value: number | undefined | null, unit: DspaStatsUnit,
): string {
  return `${formatStatsAmount(value)} ${statsUnitLabel(t, unit)}`
}

// ---------------------------------------------------------------------------
// Series lookup
// ---------------------------------------------------------------------------

// Which sewage works a WATER facility id refers to. The five plants carry the
// stats keys in their own ids, so the panel needs no second table — and a
// facility with no series (the airport station, which DSPA publishes nothing
// for) simply resolves to null.
export type WwtpKey = 'macau' | 'taipa' | 'coloane' | 'crossborder' | 'mia'

const WWTP_KEYS: readonly WwtpKey[] = ['macau', 'taipa', 'coloane', 'crossborder', 'mia'] as const

export function wwtpKeyFromId(id: string): WwtpKey | null {
  const m = /^wwtp-(.+)$/.exec(id)
  const key = m?.[1] as WwtpKey | undefined
  return key && WWTP_KEYS.includes(key) ? key : null
}

export function wwtpSeries(stats: DspaStats | null | undefined, id: string): DspaSeries | null {
  const key = wwtpKeyFromId(id)
  if (!key) return null
  return stats?.wwtp?.[key] ?? null
}

// A facility's own series, named by the `statsKey` the pipeline writes:
// "hazardous", "landfill", "wwtp.macau" … — one dotted path, resolved here so
// no panel has to know the file's shape. Null for a facility DSPA publishes
// nothing for, and for a key that does not resolve (a renamed series upstream
// must leave the panel chartless, never crash it).
export function seriesForKey(
  stats: DspaStats | null | undefined,
  key: string | null | undefined,
): DspaSeries | null {
  if (!stats || !key) return null
  const [head, tail] = key.split('.')
  if (head === 'wwtp') {
    const sub = tail as WwtpKey | undefined
    return sub && WWTP_KEYS.includes(sub) ? (stats.wwtp?.[sub] ?? null) : null
  }
  if (tail) return null
  if (head === 'incinerator') return stats.incinerator ?? null
  if (head === 'hazardous') return stats.hazardous ?? null
  if (head === 'landfill') return stats.landfill ?? null
  return null
}

// The pickers the panels use, named once so a chart and its chips can never
// plot different fields.
export const pickReceivedT: StatsPick = m => m.receivedT
export const pickVolumeM3: StatsPick = m => m.volumeM3
export const pickTotalM3: StatsPick = m => m.totalM3
