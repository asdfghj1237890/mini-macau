import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import type { GrandPrixCircuit, GrandPrixCorner, GrandPrixSource } from '../types'
import {
  GRAND_PRIX_ROW_COLOR,
  grandPrixCornerKindLabel,
  pickGrandPrixText,
  sortGrandPrixSources,
} from '../grandPrix'

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-muted) shrink-0 pt-[2px]">
        {label}
      </span>
      <span className="text-right min-w-0">
        <span className="block text-[10px] text-(--mm-fg)/80 mm-han">{value}</span>
        {note && <span className="block text-[9px] text-(--mm-text-subtle) mm-han">{note}</span>}
      </span>
    </div>
  )
}

// The card both variants live in: the same position, the same signboard
// header (colour bar + GRAND PRIX kicker + kind + name + close) and the same
// provenance footer as the utilities' panels, so the four focus modes read as
// one family.
function Shell({ kindLabel, stage, stageLabel, title, subtitle, sources, onClose, children }: {
  kindLabel: string
  // The corner's number in race order — the badge the map draws on it and the
  // legend draws on its row. 0 = no badge (the circuit panel).
  stage: number
  stageLabel: string
  title: string
  subtitle: string
  sources: GrandPrixSource[]
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const color = GRAND_PRIX_ROW_COLOR
  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-fg)/10 rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className="flex items-stretch border-b border-(--mm-fg)/10">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-(--mm-fg)/10"
               style={{ backgroundColor: `${color}14` }}>
            <div className="w-1 h-7 shrink-0" style={{ backgroundColor: color }} />
            <div>
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-secondary)">
                {'🏁'} {t.grandPrixLabel}
              </div>
              <div className="text-[13px] font-bold text-(--mm-fg) leading-tight mm-han whitespace-nowrap
                              flex items-center gap-1.5">
                {stage > 0 && (
                  <span
                    className="inline-flex items-center justify-center w-[15px] h-[15px] shrink-0
                               rounded-full bg-(--mm-panel) border border-(--mm-fg)/70 mm-mono text-[9px]
                               leading-none text-(--mm-fg)"
                    title={stageLabel}
                    aria-label={stageLabel}
                  >
                    {stage}
                  </span>
                )}
                {kindLabel}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="text-[14px] font-bold text-(--mm-fg) truncate mm-han" title={title}>
              {title}
            </div>
            {subtitle && (
              <div className="text-[10px] text-(--mm-text-muted) truncate mm-han" title={subtitle}>
                {subtitle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-3 text-(--mm-text-muted) hover:text-(--mm-fg) hover:bg-(--mm-fg)/5 border-l border-(--mm-fg)/10
                       mm-mono text-[13px] transition-colors"
            aria-label={t.cancel}
          >
            ×
          </button>
        </div>

        <div className="px-3 py-2 space-y-1.5">
          {children}
        </div>

        {/* Provenance footer: every source the file names (the OSM copyright
            entry among them), sorted line → names → facts → record →
            landmarks and lettered so the panel and a reader can point at one.
            Secondary sources say so on their own line. */}
        <div className="px-3 py-2 border-t border-(--mm-fg)/10 bg-(--mm-fg)/[0.02]">
          <div className="mm-mono text-[8px] tracking-[0.25em] text-(--mm-text-muted) pb-0.5">
            {t.grandPrixSource}
          </div>
          <ol className="list-[lower-alpha] pl-4 space-y-0.5 marker:text-(--mm-text-subtle) marker:text-[9px]">
            {sortGrandPrixSources(sources).map(source => (
              <li key={`${source.role}:${source.url}`} className="text-[9px] leading-snug min-w-0 pl-0.5">
                <a href={source.url} target="_blank" rel="noopener noreferrer"
                   className="text-(--mm-text-secondary) hover:text-(--mm-fg) underline decoration-(--mm-fg)/20 mm-han break-words">
                  {source.name}
                </a>
                {source.secondary && (
                  <span className="ml-1 text-(--mm-text-subtle) mm-han">· {t.grandPrixSecondarySource}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

// The two other languages' forms of a name, for the subtitle under the title.
function otherNames(name: GrandPrixCircuit['name'], lang: 'en' | 'zh' | 'pt'): string {
  const order: Array<'zh' | 'en' | 'pt'> = ['zh', 'en', 'pt']
  return order
    .filter(l => l !== lang)
    .map(l => pickGrandPrixText(name, l))
    .filter((s, i, arr) => s && arr.indexOf(s) === i)
    .join(' · ')
}

// The circuit itself: the official facts, the record the car runs at, and the
// corner list in race order.
export function GrandPrixCircuitInfoPanel({ circuit, sources, onClose }: {
  circuit: GrandPrixCircuit
  sources: GrandPrixSource[]
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  const corners = [...circuit.corners].sort((a, b) => a.order - b.order)
  return (
    <Shell
      kindLabel={t.grandPrixCircuit}
      stage={0}
      stageLabel=""
      title={pickGrandPrixText(circuit.name, lang)}
      subtitle={otherNames(circuit.name, lang)}
      sources={sources}
      onClose={onClose}
    >
      <Row label={t.grandPrixLength} value={t.grandPrixLengthValue(circuit.lengthKm, circuit.measuredLengthKm)} />
      <Row label={t.grandPrixMinWidth} value={`${circuit.minWidthM} m`} />
      <Row
        label={t.grandPrixDirection}
        value={circuit.direction === 'clockwise' ? t.grandPrixClockwise : circuit.direction}
      />
      {circuit.lapRecord && (
        <Row
          label={t.grandPrixLapRecord}
          value={t.grandPrixLapRecordValue(circuit.lapRecord.time, circuit.lapRecord.driver, circuit.lapRecord.year)}
          note={t.grandPrixSecondarySource}
        />
      )}
      <div className="pt-1">
        <div className="mm-mono text-[8px] tracking-[0.25em] text-(--mm-text-muted) pb-0.5">
          {t.grandPrixCorners}
        </div>
        <ol className="space-y-[1px]">
          {corners.map(corner => (
            <li key={corner.id} className="flex items-center gap-2 text-[10px] text-(--mm-fg)/80 mm-han">
              <span
                className="inline-flex items-center justify-center w-[14px] h-[14px] shrink-0
                           rounded-full bg-(--mm-panel) border border-(--mm-fg)/60 mm-mono text-[8px]
                           leading-none text-(--mm-fg)"
                aria-label={t.grandPrixCornerOrder(corner.order)}
              >
                {corner.kind === 'start_finish' ? '🏁' : corner.order}
              </span>
              <span className="truncate flex-1 min-w-0" title={pickGrandPrixText(corner.name, lang)}>
                {pickGrandPrixText(corner.name, lang)}
              </span>
              <span className="mm-mono mm-tabular text-[8px] text-(--mm-text-subtle) shrink-0">
                {corner.distKm.toFixed(2)} km
              </span>
            </li>
          ))}
        </ol>
        <div className="pt-1 text-[9px] text-(--mm-text-subtle) mm-han">{t.grandPrixNote}</div>
      </div>
    </Shell>
  )
}

// One corner: its official name in the three languages, where it sits on the
// lap, and — because the position is ours — the rule that placed it.
export function GrandPrixCornerInfoPanel({ corner, circuit, sources, onClose }: {
  corner: GrandPrixCorner
  circuit: GrandPrixCircuit
  sources: GrandPrixSource[]
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  const stageLabel = t.grandPrixCornerOrder(corner.order)
  return (
    <Shell
      kindLabel={grandPrixCornerKindLabel(t, corner.kind)}
      stage={corner.order}
      stageLabel={stageLabel}
      title={pickGrandPrixText(corner.name, lang)}
      subtitle={otherNames(corner.name, lang)}
      sources={sources}
      onClose={onClose}
    >
      <Row label={t.grandPrixCircuit} value={pickGrandPrixText(circuit.name, lang)} />
      <Row
        label={t.grandPrixCorners}
        value={corner.spanKm
          ? t.grandPrixSpanKm(corner.spanKm[0], corner.spanKm[1])
          : t.grandPrixAtKm(corner.distKm)}
        note={stageLabel}
      />
      {corner.approximate && (
        <div className="pt-1 border-t border-(--mm-fg)/10">
          <div className="text-[10px] font-bold text-(--mm-fg)/85 mm-han">{t.grandPrixApproximate}</div>
          <div className="text-[9px] text-(--mm-text-secondary) mm-han leading-snug">
            {t.grandPrixApproximateNote}
          </div>
          <div className="pt-1 mm-mono text-[8px] tracking-[0.25em] text-(--mm-text-muted)">
            {t.grandPrixRule}
          </div>
          <div className="text-[9px] text-(--mm-text-subtle) leading-snug break-words">{corner.rule}</div>
        </div>
      )}
    </Shell>
  )
}
