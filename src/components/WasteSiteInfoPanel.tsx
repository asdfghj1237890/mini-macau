import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import type {
  DspaStats,
  PowerFacility,
  WasteEcoStation,
  WasteFacility,
  WasteSite,
  WasteSource,
  WasteText,
} from '../types'
import { StatsChart, StatsUnavailable } from './StatsChart'
import {
  formatStatsAmount,
  formatStatsValue,
  pickReceivedT,
  pickTotalM3,
  pickVolumeM3,
  seriesForKey,
} from '../dspaStats'
import {
  WASTE_COLORS,
  WASTE_ECO_STATION_COLOR,
  WASTE_INCINERATOR_COLOR,
  WASTE_IAM_MAP_URL,
  pickWasteText,
  wasteAgency,
  wasteFacilityColor,
  wasteFromIamMap,
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
  // The glass and clothing banks come from IAM's own facility map, not
  // data.gov.mo — so their second link names that map instead of the portal.
  const fromIamMap = wasteFromIamMap(site.type)

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
            href={source?.url || (fromIamMap ? WASTE_IAM_MAP_URL : DATA_PORTAL_URL)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-200 transition-colors"
          >
            {fromIamMap ? '環境資訊網' : 'data.gov.mo'}
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
  { facility, stats, onClose }: {
    facility: PowerFacility
    // DSPA's whole statistics file. Null when dspa-stats.json has not landed or
    // failed to load, in which case the panel shows no chart and no facts
    // rather than an empty one.
    stats?: DspaStats | null
    onClose: () => void
  },
) {
  const { lang, t } = useI18n()
  const title = pickWasteText(facility.name, lang)
  const subtitle = otherScript(facility.name, lang, title)
  // Both halves used to live in waste.json; they now come from the shared DSPA
  // statistics file, and the panel simply shows less when it has not landed.
  const series = stats?.incinerator ?? null
  const latest = series?.latest ?? null
  const unit = series?.unit ?? 't'
  // The plant's scale rides on its own series rather than the file root.
  const facts = series?.facts ?? null

  return (
    <Shell
      color={WASTE_INCINERATOR_COLOR}
      kindLabel={t.wasteTypeIncinerator}
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

      {/* Throughput. The plant is the one place in this overlay where a NUMBER
          is the story — how much refuse a city of 700,000 actually produces.
          The chart itself is shared with every other DSPA series (see
          StatsChart), so tonnes and cubic metres round and scale alike. */}
      <StatsChart
        title={t.statsThroughput}
        series={series}
        pick={pickReceivedT}
        chips={latest ? [
          { label: t.statsReceived, value: formatStatsValue(t, latest.receivedT, unit) },
          { label: t.wasteStatsElectricity, value: t.wasteStatsMwh(formatStatsAmount(latest.electricityMwh)) },
          { label: t.wasteStatsMetal, value: formatStatsValue(t, latest.metalRecycledT, unit) },
        ] : []}
      />
      {facts && (
        <div className="px-3 pb-2 text-[9px] leading-[1.4] text-white/40 mm-han">
          {t.wasteStatsFacts(
            t.wasteStatsPhases(facts.phases.join(' / ')),
            facts.lines,
            formatStatsAmount(facts.capacityTPerDay),
            facts.generationMw,
          )}
        </div>
      )}
    </Shell>
  )
}

// 環保加Fun站 — a staffed DSPA drop-off centre. There is no open dataset for
// these, so the list is hand-maintained in the pipeline; `approximate` marks a
// station placed on its block rather than its unit, and the badge admits it.
export function WasteEcoStationInfoPanel(
  { station, onClose }: { station: WasteEcoStation; onClose: () => void },
) {
  const { lang, t } = useI18n()
  const title = pickWasteText(station.name, lang)
  const subtitle = otherScript(station.name, lang, title)
  const address = pickWasteText(station.address, lang)
  const hours = pickWasteText(station.hours, lang)
  const accepts = pickWasteText(station.accepts, lang)

  return (
    <Shell
      color={WASTE_ECO_STATION_COLOR}
      kindLabel={t.wasteTypeEcoStation}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <a
          href={station.source?.url || DSPA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-emerald-200 transition-colors"
        >
          {station.source?.name || '環境保護局 (DSPA)'}
        </a>
      }
    >
      <div className="px-3 py-2 space-y-1">
        {address && <Row label={t.wasteAddress} value={address} />}
        {hours && <Row label={t.wasteHours} value={hours} />}
        {accepts && <Row label={t.wasteAccepts} value={accepts} />}
        {station.since ? <Row label={t.wasteSince} value={String(station.since)} /> : null}
      </div>
      {station.approximate && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          <span className="mm-han text-[9px] leading-none px-1.5 py-[3px] border
                           border-white/20 bg-white/[0.06] text-white/70">
            {t.wasteApproximate}
          </span>
        </div>
      )}
    </Shell>
  )
}

// The hazardous-waste station and the two landfills — where refuse that cannot
// be burned ends up. Their notes are written from DSPA's own pages and the
// landfill outlines come from OSM, so each record is credited on its own rather
// than from the shared `sources` list.
export function WasteFacilityInfoPanel(
  { facility, stats, onClose }: {
    facility: WasteFacility
    // DSPA's whole statistics file; the facility names its own series through
    // `statsKey`, so the panel never has to know the file's shape.
    stats?: DspaStats | null
    onClose: () => void
  },
) {
  const { lang, t } = useI18n()
  const title = pickWasteText(facility.name, lang)
  const subtitle = otherScript(facility.name, lang, title)
  const note = pickWasteText(facility.note, lang)
  const isLandfill = facility.kind === 'landfill'
  const isWwtp = facility.kind === 'wwtp'
  const osmId = facility.osm?.[0]

  // The chart. Each kind plots a different measure of the same shape of series,
  // and a facility DSPA publishes nothing for (the Ká-Hó ash landfill, the
  // airport station) says so rather than showing an empty frame.
  const series = seriesForKey(stats, facility.statsKey)
  const latest = series?.latest ?? null
  const unit = series?.unit ?? (isWwtp || isLandfill ? 'm3' : 't')
  const chartTitle = isWwtp ? t.statsTreatedVolume
    : isLandfill ? t.statsLandfilled
      : t.statsThroughput
  // The peninsula plant is the one with two published halves — a preliminary
  // stream and a biological one — which is why its chips differ from the rest.
  const chips: { label: string; value: string }[] = []
  if (latest) {
    if (isWwtp) {
      if (typeof latest.basicM3 === 'number') {
        chips.push({ label: t.statsBasic, value: formatStatsValue(t, latest.basicM3, unit) })
      }
      if (typeof latest.biologicalM3 === 'number') {
        chips.push({ label: t.statsBiological, value: formatStatsValue(t, latest.biologicalM3, unit) })
      }
      chips.push({ label: t.statsTotal, value: formatStatsValue(t, latest.totalM3, unit) })
    } else if (isLandfill) {
      chips.push({ label: t.statsTotal, value: formatStatsValue(t, latest.volumeM3, unit) })
    } else {
      chips.push({ label: t.statsReceived, value: formatStatsValue(t, latest.receivedT, unit) })
      if (typeof latest.processedT === 'number') {
        chips.push({ label: t.statsProcessed, value: formatStatsValue(t, latest.processedT, unit) })
      }
    }
  }

  return (
    <Shell
      color={wasteFacilityColor(facility)}
      kindLabel={isWwtp ? t.wasteTypeWwtp : isLandfill ? t.wasteKindLandfill : t.wasteKindHazardous}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <a
            href={facility.source?.url || DSPA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-200 transition-colors"
          >
            {facility.source?.name || '環境保護局 (DSPA)'}
          </a>
          {osmId && (
            <>
              {' · '}
              <a
                href={`https://www.openstreetmap.org/way/${osmId.replace(/^w/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-emerald-200 transition-colors"
              >
                OSM
              </a>
            </>
          )}
        </>
      }
    >
      {/* Who runs it. The sewage works are DSPA's by definition, so the row is
          keyed on the kind rather than on an `operator` field the file need not
          carry — naming the bureau is the whole point of it: these are
          government works, not the concessionaire's. */}
      {(isWwtp || facility.operator) && (
        <div className="px-3 py-2 space-y-1">
          <Row label={t.wasteOperator} value={t.wasteOperatorDspa} />
        </div>
      )}
      {note && (
        <div className="px-3 py-2 text-[10px] leading-[1.45] text-white/60 mm-han">
          {note}
        </div>
      )}
      {facility.approximate && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          <span className="mm-han text-[9px] leading-none px-1.5 py-[3px] border
                           border-white/20 bg-white/[0.06] text-white/70">
            {t.wasteApproximate}
          </span>
        </div>
      )}
      {series ? (
        <StatsChart
          title={chartTitle}
          series={series}
          pick={isWwtp ? pickTotalM3 : isLandfill ? pickVolumeM3 : pickReceivedT}
          chips={chips}
          accentClass={isWwtp ? 'text-violet-200' : 'text-white/80'}
          barClass={isWwtp ? 'bg-violet-300' : 'bg-white/70'}
        />
      ) : (
        // Say so, rather than leaving a gap that reads as a loading failure.
        <StatsUnavailable title={chartTitle} />
      )}
    </Shell>
  )
}
