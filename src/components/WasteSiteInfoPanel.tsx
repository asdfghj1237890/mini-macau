import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import type { PowerFacility, WasteSite, WasteSource, WasteText } from '../types'
import {
  WASTE_COLORS,
  WASTE_INCINERATOR_COLOR,
  WASTE_INCINERATOR_ID,
  pickWasteText,
  wasteAgency,
  wasteSourceForType,
  wasteTypeLabel,
} from '../waste'

interface Props {
  site: WasteSite
  // The seven upstream datasets, so the footer can link the one this site came
  // from and show its published timestamp. Never filtered — provenance is not
  // something the per-type toggles narrow.
  sources?: WasteSource[]
  onClose: () => void
}

// Provenance links: the two publishing bureaux, plus data.gov.mo (the dataset's
// own landing page when the file carries one, the portal root otherwise). The
// incineration plant's footprints come from OSM instead, so it links there.
const IAM_URL = 'https://www.iam.gov.mo/'
const DSPA_URL = 'https://www.dspa.gov.mo/'
const DATA_PORTAL_URL = 'https://data.gov.mo/'
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/35 shrink-0 pt-[2px]">
        {label}
      </span>
      <span className="text-[10px] text-white/80 text-right mm-han min-w-0">{value}</span>
    </div>
  )
}

// The other-script line under the name: Chinese readers get the Portuguese (or
// English) form, everyone else gets the Chinese one. Same rule as the water
// panel — these feeds are zh/pt, so it is the only way a non-Chinese reader
// sees the name IAM and DSPA actually print on the bin.
function otherScript(name: WasteText, lang: string, title: string): string {
  const other = lang === 'zh' ? (name.pt || name.en || '') : name.zh
  return other && other !== title ? other : ''
}

// The card both variants live in: the same position, the same signboard header
// (colour bar + WASTE kicker + kind + name + close) and the same provenance
// footer. Only the middle and the footer's links differ, so a collection point
// and the incineration plant can never drift apart visually.
function Shell({ color, kindLabel, title, subtitle, footer, onClose, children }: {
  color: string
  kindLabel: string
  title: string
  subtitle: string
  footer: ReactNode
  onClose: () => void
  children?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                      shadow-2xl shadow-black/60 overflow-hidden mm-fade">
        {/* Header signboard — the kicker is the layer, the bold line the kind. */}
        <div className="flex items-stretch border-b border-white/10">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-white/10"
               style={{ backgroundColor: `${color}14` }}>
            <div className="w-1 h-7 shrink-0" style={{ backgroundColor: color }} />
            <div>
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/50">
                {t.wasteLabel}
              </div>
              <div className="text-[13px] font-bold text-white leading-tight mm-han whitespace-nowrap">
                {kindLabel}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="text-[14px] font-bold text-white truncate mm-han" title={title}>
              {title}
            </div>
            {subtitle && (
              <div className="text-[10px] text-white/45 truncate mm-han" title={subtitle}>
                {subtitle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-3 text-white/40 hover:text-white hover:bg-white/5 border-l border-white/10
                       mm-mono text-[13px] transition-colors"
            aria-label={t.cancel}
          >
            ✕
          </button>
        </div>

        {children}

        {/* Footer: provenance */}
        <div className="px-3 py-1.5 border-t border-white/8 bg-white/[0.02] flex items-center justify-between gap-2">
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-white/35 uppercase">
            {t.wasteSource}
          </span>
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-wider text-white/45 truncate">
            {footer}
          </span>
        </div>
      </div>
    </div>
  )
}

export function WasteSiteInfoPanel({ site, sources, onClose }: Props) {
  const { lang, t } = useI18n()

  // Header accent = the marker colour this site is drawn with, so the panel and
  // the pin the user just clicked read as the same object. Arbitrary hex, hence
  // inline styles rather than Tailwind classes.
  const color = WASTE_COLORS[site.type] ?? WASTE_COLORS.refuse_room

  // The DSPA feeds publish no English and the address block is zh/pt only, so
  // `pickWasteText` falls back en → pt → zh. The panel never renders raw HTML.
  const title = pickWasteText(site.name, lang)
  const subtitle = otherScript(site.name, lang, title)
  const address = pickWasteText(site.address, lang)

  const agency = wasteAgency(site.type)
  const source = wasteSourceForType(sources, site.type)

  return (
    <Shell
      color={color}
      kindLabel={wasteTypeLabel(t, site.type)}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          {site.photo && (
            <>
              <a
                href={site.photo}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-emerald-200 transition-colors"
              >
                {t.wastePhoto}
              </a>
              <span className="text-white/25 mx-[3px]">·</span>
            </>
          )}
          <a
            href={agency === 'iam' ? IAM_URL : DSPA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-200 transition-colors"
          >
            {agency === 'iam' ? '市政署 (IAM)' : '環境保護局 (DSPA)'}
          </a>
          {' · '}
          <a
            href={source?.url || DATA_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-200 transition-colors"
          >
            data.gov.mo
          </a>
        </>
      }
    >
      {/* Detail rows. The refuse-room feed publishes no address and most sites
          no phone number, so both rows disappear rather than showing blank. */}
      {(address || site.tel || source?.upstreamUpdatedAt) && (
        <div className="px-3 py-2 space-y-1">
          {address && <Row label={t.wasteAddress} value={address} />}
          {site.tel && <Row label={t.wasteTel} value={site.tel} />}
          {source?.upstreamUpdatedAt && (
            <Row label={t.wasteUpdated} value={source.upstreamUpdatedAt} />
          )}
        </div>
      )}

      {/* Out-of-use badge — only IAM publishes the flag, and only when true. */}
      {site.closed && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          <span className="mm-han text-[9px] leading-none px-1.5 py-[3px] border
                           border-amber-300/30 bg-amber-300/[0.08] text-amber-200/80">
            {t.wasteClosed}
          </span>
        </div>
      )}
    </Shell>
  )
}

// 澳門垃圾焚化中心. Not one of the six collection kinds: it is where they all end
// up, and its record is the `incinerator` entry of power-facilities.json (the
// POWER layer draws the same building complex as a generating station). Hence
// its own variant — same card, different middle and a different provenance
// line, because these footprints come from OSM rather than data.gov.mo.
export function WasteIncineratorInfoPanel(
  { facility, onClose }: { facility: PowerFacility; onClose: () => void },
) {
  const { lang, t } = useI18n()
  const title = pickWasteText(facility.name, lang)
  const subtitle = otherScript(facility.name, lang, title)

  return (
    <Shell
      color={WASTE_INCINERATOR_COLOR}
      kindLabel={wasteTypeLabel(t, WASTE_INCINERATOR_ID)}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <a
            href={DSPA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lime-200 transition-colors"
          >
            環境保護局 (DSPA)
          </a>
          {' · '}
          <a
            href={OSM_COPYRIGHT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lime-200 transition-colors"
          >
            OpenStreetMap
          </a>
        </>
      }
    >
      <div className="px-3 py-2 space-y-1">
        <Row label={t.wasteOperator} value={t.wasteOperatorDspa} />
      </div>
      {/* What this plant actually is, in one line: the government's incinerator
          at Pac On, whose electricity reaches CEM through 焚化爐變電站. */}
      <div className="px-3 pb-2 text-[10px] leading-[1.45] text-white/55 mm-han">
        {t.wasteIncineratorNote}
      </div>
    </Shell>
  )
}
