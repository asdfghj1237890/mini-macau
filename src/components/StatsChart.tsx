import { useI18n } from '../i18n'
import type { DspaSeries } from '../types'
import {
  formatStatsAmount,
  statsChartModel,
  statsUnitLabel,
  type StatsPick,
} from '../dspaStats'

// The block every DSPA-statistics panel shows: a heading, the latest month's
// figures as chips, and twelve months of bars against a zero-based axis.
//
// Extracted from the incineration plant's panel, where it started, because the
// hazardous-waste station, the construction-waste landfill and the five sewage
// works all publish the same shape of series — and a tonnes chart and a cubic-
// metres chart must round, scale and label identically or the reader cannot
// compare them.
//
// Plain divs throughout: twelve bars and three gridlines do not justify a chart
// library, and this has to stay inside a 340 px card on a phone.

export interface StatsChip {
  label: string
  value: string
}

interface Props {
  // The heading — 處理量 / 污水處理量 / 每月堆埋體積, chosen by the caller because
  // the same shape of chart means a different thing at each facility.
  title: string
  series: DspaSeries | null | undefined
  // Which field the bars plot. The chips are passed in already formatted, so a
  // panel can show measures the bars do not (processed tonnes, the two halves
  // of the peninsula plant's flow).
  pick: StatsPick
  chips?: StatsChip[]
  // Accent for the newest bar and the chip figures, so the chart reads as part
  // of the facility whose panel it sits in.
  accentClass?: string
  barClass?: string
}

export function StatsChart({
  title, series, pick, chips = [], accentClass = 'text-(--mm-lime-1)', barClass = 'bg-(--mm-lime)',
}: Props) {
  const { t } = useI18n()
  const model = statsChartModel(series, pick)
  const latest = series?.latest ?? null
  if (!model && !latest && chips.length === 0) return null

  return (
    <div className="px-3 py-2.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-(--mm-text-muted)">
          {title}
        </span>
        {latest && (
          <span className="mm-mono text-[10px] tracking-wider text-(--mm-text-muted)">
            {t.statsLatest(latest.period)}
          </span>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] mm-han">
          {chips.map(chip => (
            <span key={chip.label} className="text-(--mm-text-secondary)">
              {chip.label}{' '}
              <span className={`mm-mono mm-tabular text-[13px] ${accentClass}`}>{chip.value}</span>
            </span>
          ))}
        </div>
      )}

      {model && (
        <div className="pt-1">
          {/* A zero-based axis, not a data-range one. These series are flat by
              nature — a plant that burns ~58–62 kt a month — so scaling twelve
              bars to the data range would magnify a 6 % spread into a full
              sawtooth and invite a trend that is not there. The ticks
              (max / half / 0) and the gridlines are what let "they are all
              about the same" be read straight off the chart. */}
          <div className="flex items-stretch gap-1.5">
            <div className="relative w-[34px] shrink-0 h-[64px]">
              {model.ticks.map(tick => (
                <span
                  key={tick.value}
                  className="absolute right-0 mm-mono mm-tabular text-[9px] text-(--mm-text-muted)
                             leading-none -translate-y-1/2"
                  style={{ top: `${tick.offset}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
            <div className="relative flex-1 min-w-0 h-[64px]">
              {model.ticks.map(tick => (
                <span
                  key={tick.value}
                  className="absolute left-0 right-0 border-t border-(--mm-fg)/10"
                  style={{ top: `${tick.offset}%` }}
                  aria-hidden="true"
                />
              ))}
              <div className="absolute inset-0 flex items-end gap-[3px]">
                {model.bars.map(bar => (
                  <div
                    key={bar.period}
                    className={`flex-1 rounded-[1px] ${barClass} ${
                      bar.latest ? 'opacity-90' : 'opacity-40'}`}
                    style={{ height: `${bar.percent}%` }}
                    title={`${bar.period} · ${formatStatsAmount(bar.value)} ${statsUnitLabel(t, model.unit)}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-[3px] pt-[3px] pl-[40px]">
            {model.bars.map(bar => (
              <span
                key={bar.period}
                className={`flex-1 mm-mono mm-tabular text-[9px] text-center
                            ${bar.latest ? accentClass : 'text-(--mm-text-muted)'}`}
              >
                {bar.label}
              </span>
            ))}
          </div>
          <div className="pt-1 mm-mono text-[9px] tracking-[0.18em] text-(--mm-text-muted) uppercase">
            {t.statsMonthsAxis(statsUnitLabel(t, model.unit))}
          </div>
        </div>
      )}

      {series?.url && (
        <a
          href={series.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mm-mono text-[10px] tracking-wider text-(--mm-text-muted)
                     hover:text-(--mm-fg)/75 transition-colors"
        >
          {series.url.includes('data.gov.mo') ? 'data.gov.mo' : 'dspa.gov.mo'}
        </a>
      )}
    </div>
  )
}

// The "nothing published" line, for a facility DSPA reports no figures for (the
// Ká-Hó ash landfill, the airport sewage station). Saying so is better than an
// empty space, which reads as a loading failure.
export function StatsUnavailable({ title }: { title: string }) {
  const { t } = useI18n()
  return (
    <div className="px-3 py-2 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02]">
      <div className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-(--mm-text-muted)">
        {title}
      </div>
      <div className="pt-1 text-[12px] leading-[1.4] text-(--mm-text-muted) mm-han">
        {t.statsNoData}
      </div>
    </div>
  )
}
