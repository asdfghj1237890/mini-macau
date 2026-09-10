import { useI18n, type Translations } from '../i18n'
import type { Parish, ParishIsland, ParishKind } from '../types'
import { parishColor, parishDensity, parishName } from '../parishes'

interface Props {
  parish: Parish
  onClose: () => void
}

// Provenance links. Every area carries its own `sources` list (the OSM relation
// it was cut from, plus the census table the population came from), so the
// footer labels each link by who published it rather than by position.
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'
const DSEC_URL = 'https://www.dsec.gov.mo/'

// The two enum → label pickers. They live here rather than in src/parishes.ts
// because the panel is their only caller: the map bakes colours into the
// features and the legend shows no kind or island.
function parishKindLabel(t: Translations, kind: ParishKind): string {
  return kind === 'reclamation' ? t.parishKindReclamation : t.parishKindParish
}

function parishIslandLabel(t: Translations, island: ParishIsland): string {
  if (island === 'taipa') return t.parishIslandTaipa
  if (island === 'coloane') return t.parishIslandColoane
  if (island === 'cotai') return t.parishIslandCotai
  return t.parishIslandMacau
}

// Who published a source URL. Keeps the footer honest whatever mix of pages the
// pipeline lists, instead of assuming a fixed order.
function sourceLabel(url: string): string {
  if (url.includes('openstreetmap.org')) return 'OSM'
  if (url.includes('dsec.gov.mo')) return 'DSEC'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'SOURCE'
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-muted) shrink-0 pt-[2px]">
        {label}
      </span>
      <span className="text-[10px] text-(--mm-fg)/80 text-right mm-han min-w-0">{value}</span>
    </div>
  )
}

export function ParishInfoPanel({ parish, onClose }: Props) {
  const { lang, t } = useI18n()

  // The area's tint, straight from the table the map layers and the legend
  // strip read — an arbitrary hex, so it goes in as an inline style.
  const color = parishColor(parish.slug)

  // Name in the reading language, with the other two scripts underneath: all
  // three exist upstream, so a parish always has something to show below the
  // headline (deduplicated, because Taipa and Cotai read the same in pt/en).
  const title = parishName(parish, lang)
  const others = (['zh', 'pt', 'en'] as const)
    .filter(l => l !== lang)
    .map(l => parishName(parish, l))
    .filter((name, i, all) => name && name !== title && all.indexOf(name) === i)

  const area = parish.areaKm2 == null ? '—' : `${parish.areaKm2.toFixed(1)} km²`
  // The census count with its year, because the figure is only meaningful with
  // one — DSEC does not publish a parish breakdown for every census.
  const population = parish.population == null
    ? '—'
    : parish.populationYear == null
      ? parish.population.toLocaleString()
      : `${parish.population.toLocaleString()} · ${t.parishCensusYear(parish.populationYear)}`
  const density = parishDensity(parish)
  const densityValue = density == null ? '—' : `${density.toLocaleString()} /km²`

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-fg)/10 rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) overflow-hidden mm-fade">
        {/* Header signboard. The bold line is the KIND, the way the housing
            panel's is the housing type — it is what separates the seven civil
            parishes from the Cotai reclamation zone. */}
        <div className="flex items-stretch border-b border-(--mm-fg)/10">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-(--mm-fg)/10"
               style={{ backgroundColor: `${color}14` }}>
            <div className="w-1 h-7 shrink-0" style={{ backgroundColor: color }} />
            <div>
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-secondary)">
                {'▣'} {t.parishLabel}
              </div>
              <div className="text-[13px] font-bold text-(--mm-fg) leading-tight mm-han whitespace-nowrap">
                {parishKindLabel(t, parish.kind)}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="text-[14px] font-bold text-(--mm-fg) truncate mm-han" title={title}>
              {title}
            </div>
            {others.length > 0 && (
              <div className="text-[10px] text-(--mm-text-muted) truncate mm-han" title={others.join(' · ')}>
                {others.join(' · ')}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-3 text-(--mm-text-muted) hover:text-(--mm-fg) hover:bg-(--mm-fg)/5 border-l border-(--mm-fg)/10
                       mm-mono text-[13px] transition-colors"
            aria-label={t.cancel}
          >
            ✕
          </button>
        </div>

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          <Row label={t.parishIsland} value={parishIslandLabel(t, parish.island)} />
          <Row label={t.parishArea} value={area} />
          <Row label={t.parishPopulation} value={population} />
          <Row label={t.parishDensity} value={densityValue} />
          {/* The caveat behind the figures (Coloane's count includes Cotai,
              Cotai's is folded into Coloane) — data in all three languages,
              picked directly. */}
          {parish.note && (
            <p className="-mt-1 text-[9px] leading-snug text-right text-(--mm-text-muted) mm-han">
              {lang === 'zh' ? parish.note.zh : lang === 'pt' ? parish.note.pt : parish.note.en}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between gap-2">
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-(--mm-text-muted) uppercase">
            {t.parishSource}
          </span>
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-wider text-(--mm-text-muted) truncate">
            {/* One link per page the area was built from; an area with no list
                of its own still gets the two publishers' front doors. */}
            {(parish.sources.length ? parish.sources : [OSM_COPYRIGHT_URL, DSEC_URL]).map((url, i) => (
              <span key={url}>
                {i > 0 && ' · '}
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-(--mm-slate-1) transition-colors"
                >
                  {sourceLabel(url)}
                </a>
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}
