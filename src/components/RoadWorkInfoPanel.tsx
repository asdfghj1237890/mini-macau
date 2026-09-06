import { useMemo, useState } from 'react'
import type { RoadWorkNotice, RoadWorkRestriction, SimulationClock } from '../types'
import { useI18n } from '../i18n'
import { macauYmd } from '../macauTime'
import {
  daysBetween,
  pickText,
  restrictionLabel,
  roadWorksHorizon,
  roadWorkStatus,
} from '../roadWorks'

interface Props {
  notice: RoadWorkNotice
  clock: SimulationClock
  onClose: () => void
}

// DSAT dataset landing page — the panel's provenance link.
const DATASET_URL = 'https://data.gov.mo/Detail?id=81c17efc-3e92-484e-ab14-de7fa0f90f01'

// Same three-colour scheme as the map markers, expressed as literal Tailwind
// classes so the JIT picks them up (mirrors OPERATOR_THEME in FerryInfoPanel).
interface Tone {
  borderAccent: string
  pillBg: string
  accentBar: string
  eyebrow: string
  titleText: string
  statusText: string
  statusDot: string
}

const TONES: Record<'red' | 'amber' | 'slate', Tone> = {
  red: {
    borderAccent: 'border-(--mm-red-2)/20',
    pillBg: 'bg-(--mm-red-2)/[0.08]',
    accentBar: 'bg-(--mm-red-2)',
    eyebrow: 'text-(--mm-red)/80',
    titleText: 'text-(--mm-red-1)',
    statusText: 'text-(--mm-red)/80',
    statusDot: 'bg-(--mm-red-2)',
  },
  amber: {
    borderAccent: 'border-(--mm-amber)/20',
    pillBg: 'bg-(--mm-amber-2)/[0.08]',
    accentBar: 'bg-(--mm-amber)',
    eyebrow: 'text-(--mm-amber-1)/80',
    titleText: 'text-(--mm-amber-1)',
    statusText: 'text-(--mm-amber-1)/80',
    statusDot: 'bg-(--mm-amber)',
  },
  slate: {
    borderAccent: 'border-(--mm-slate)/20',
    pillBg: 'bg-(--mm-slate-2)/[0.08]',
    accentBar: 'bg-(--mm-slate)',
    eyebrow: 'text-(--mm-slate)/80',
    titleText: 'text-(--mm-slate-1)',
    statusText: 'text-(--mm-slate)/80',
    statusDot: 'bg-(--mm-slate)',
  },
}

const TONE_BY_RESTRICTION: Record<RoadWorkRestriction, keyof typeof TONES> = {
  closed: 'red',
  limited: 'amber',
  one_way: 'amber',
  other: 'amber',
  no_parking: 'slate',
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

export function RoadWorkInfoPanel({ notice, clock, onClose }: Props) {
  const { lang, t } = useI18n()
  const [detailsOpen, setDetailsOpen] = useState(false)

  const ymd = macauYmd(clock.currentTime)
  const status = roadWorkStatus(notice, ymd, roadWorksHorizon(clock.currentTime))
  const tone = TONES[TONE_BY_RESTRICTION[notice.restriction]]

  const location = pickText(notice.location, lang)
  const contractor = pickText(notice.contractor, lang)
  // Plain text only — the upstream `details` is untrusted HTML-stripped copy,
  // so it is rendered as text nodes, never via dangerouslySetInnerHTML.
  const paragraphs = useMemo(
    () => pickText(notice.details, lang).split('\n').map(s => s.trim()).filter(Boolean),
    [notice.details, lang]
  )

  // `status === null` means the notice isn't drawn on the map for this
  // simulated day — it has ended, or it starts beyond the 7-day preview
  // window. The panel stays open (the user opened it deliberately) but says
  // so honestly instead of claiming the notice is in force.
  const isFuture = ymd < notice.startDate
  const statusLine = isFuture
    ? t.roadWorkStartsIn(Math.max(1, daysBetween(ymd, notice.startDate)))
    : t.roadWorkUntil(notice.endDate)
  const statusBadge = status === 'active'
    ? t.roadWorkInForce
    : isFuture ? t.roadWorkUpcoming : t.roadWorkEnded

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-fg)/10 rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className={`flex items-stretch border-b ${tone.borderAccent}`}>
          <div className={`px-3 py-2 flex items-center gap-2 border-r border-(--mm-fg)/10 ${tone.pillBg}`}>
            <div className={`w-1 h-7 shrink-0 ${tone.accentBar}`} />
            <div>
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-secondary)">
                {'⚠︎'} {t.roadWorkLabel}
              </div>
              <div className="mm-mono mm-tabular text-[13px] font-bold text-(--mm-fg) leading-tight">
                {notice.id}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className={`mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] ${tone.eyebrow} flex items-center gap-1.5`}>
              <span className={`w-1.5 h-1.5 rounded-full ${tone.statusDot} ${status === 'active' ? 'mm-led-pulse' : ''}`} />
              {restrictionLabel(t, notice.restriction).toUpperCase()}
            </div>
            <div className={`text-[14px] font-bold ${tone.titleText} truncate mm-han`} title={location}>
              {location}
            </div>
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

        {/* Status + duration strip */}
        <div className="grid grid-cols-2 border-b border-(--mm-fg)/8 bg-(--mm-fg)/[0.02]">
          <div className="px-3 py-1.5 border-r border-(--mm-fg)/8 min-w-0">
            <div className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-(--mm-text-muted)">
              {statusBadge}
            </div>
            <div className={`mm-mono mm-tabular text-[11px] font-bold ${tone.statusText} leading-tight truncate`}>
              {statusLine}
            </div>
          </div>
          <div className="px-3 py-1.5 min-w-0">
            <div className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-(--mm-text-muted)">
              {t.roadWorkDuration}
            </div>
            <div className="mm-mono text-[11px] font-bold text-(--mm-fg)/90 leading-tight truncate">
              {t.roadWorkDurationValue(notice.duration.days, notice.duration.hours)}
            </div>
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          <Row label={t.roadWorkPeriod} value={`${notice.startDate} – ${notice.endDate}`} />
          <Row label={t.roadWorkReason} value={pickText(notice.reason, lang)} />
          <Row label={t.roadWorkApplicant} value={pickText(notice.principal, lang)} />
          {contractor && <Row label={t.roadWorkContractor} value={contractor} />}
          <Row label={t.roadWorkNoticeNo} value={notice.id} />
          {notice.previousNotice && (
            <Row label={t.roadWorkPrevNotice} value={notice.previousNotice} />
          )}
        </div>

        {/* Collapsible full notice text */}
        {paragraphs.length > 0 && (
          <div className="border-t border-(--mm-fg)/8">
            <button
              type="button"
              onClick={() => setDetailsOpen(o => !o)}
              aria-expanded={detailsOpen}
              className="w-full px-3 py-1.5 flex items-center justify-between
                         hover:bg-(--mm-fg)/[0.03] transition-colors"
            >
              <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-(--mm-text-muted)">
                {t.roadWorkDetails}
              </span>
              <span className="mm-mono text-[9px] text-(--mm-text-muted)">
                {detailsOpen ? `${t.collapse} ▾` : `${t.expand} ▸`}
              </span>
            </button>
            {detailsOpen && (
              <div className="px-3 pb-2 max-h-[30vh] overflow-y-auto space-y-1.5">
                {paragraphs.map((p, i) => (
                  <p key={i} className="text-[10px] leading-relaxed text-(--mm-fg)/70 mm-han">{p}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between gap-2">
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-(--mm-text-muted) uppercase">
            {t.roadWorkSource}
          </span>
          <a
            href={DATASET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mm-mono text-[8px] max-sm:text-[6px] tracking-wider text-(--mm-text-muted)
                       hover:text-(--mm-amber-1) transition-colors truncate"
          >
            交通事務局 (DSAT) · data.gov.mo
          </a>
        </div>
      </div>
    </div>
  )
}
