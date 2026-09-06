import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import type { WaterFacility, WaterNetwork, WaterNetworkNode } from '../types'
import {
  WATER_COLORS,
  WATER_INLET_COLOR,
  countWaterFootprints,
  pickWaterText,
  waterAnchorFacility,
  waterOperator,
  waterOperatorLabel,
  waterPipeCount,
  waterStage,
  waterTypeLabel,
} from '../water'

interface Props {
  facility: WaterFacility
  // The full facility list, so an approximate marker can name the facility it
  // is co-located with (`anchor`). Never filtered — the anchor may belong to a
  // record the user has not selected.
  facilities: WaterFacility[]
  // The schematic pipe network, for the "n pipes connected · schematic" line.
  // Null when the data file predates it, in which case no such line is shown.
  network: WaterNetwork | null
  onClose: () => void
}

// Provenance links: Macao Water's own 供水設施 page (the source of the facility
// list) and the OSM copyright page (the source of every footprint).
const MACAO_WATER_URL = 'https://www.macaowater.com/about-macao-water/water-supply-facilities'
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

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

// The card both variants of this panel live in: the same position, the same
// signboard header (colour bar + WATER kicker + kind + name + close) and the
// same provenance footer. Only the middle differs, so the facility panel and
// the inlet panel can never drift apart visually.
function Shell({ color, kindLabel, stage, title, subtitle, onClose, children }: {
  color: string
  kindLabel: string
  // Step number in the supply chain (WATER_STAGES) — the same badge the map
  // draws on this marker's plate and the legend draws on its row, so the
  // panel names the step the reader just clicked. 0 = no badge.
  stage: number
  title: string
  subtitle: string
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
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
                {'💧'} {t.waterLabel}
              </div>
              <div className="text-[13px] font-bold text-(--mm-fg) leading-tight mm-han whitespace-nowrap
                              flex items-center gap-1.5">
                {stage > 0 && (
                  <span
                    className="inline-flex items-center justify-center w-[15px] h-[15px] shrink-0
                               rounded-full bg-(--mm-panel) border border-(--mm-fg)/70 mm-mono text-[9px]
                               leading-none text-(--mm-fg)"
                    title={t.waterStage(stage)}
                    aria-label={t.waterStage(stage)}
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
            ✕
          </button>
        </div>

        {children}

        {/* Footer: provenance */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between gap-2">
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-(--mm-text-muted) uppercase">
            {t.waterSource}
          </span>
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-wider text-(--mm-text-muted) truncate">
            <a
              href={MACAO_WATER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-(--mm-sky-1) transition-colors"
            >
              澳門自來水 (Macao Water)
            </a>
            {' · '}
            <a
              href={OSM_COPYRIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-(--mm-sky-1) transition-colors"
            >
              OpenStreetMap
            </a>
          </span>
        </div>
      </div>
    </div>
  )
}

// The other-script line under the name: Chinese readers get the English (or
// Portuguese) form, everyone else gets the Chinese one.
function otherScript(name: { zh: string; en: string; pt: string }, lang: string, title: string) {
  const other = lang === 'zh' ? (name.en || name.pt) : name.zh
  return other && other !== title ? other : ''
}

export function WaterFacilityInfoPanel({ facility, facilities, network, onClose }: Props) {
  const { lang, t } = useI18n()

  // Header accent = the colour this facility's blocks/markers are drawn in, so
  // the panel and the thing the user clicked read as one object. Arbitrary hex,
  // hence an inline style rather than a Tailwind class.
  const color = WATER_COLORS[facility.type] ?? WATER_COLORS.pumping

  // Name in the reading language, with the other script underneath. Macao Water
  // publishes zh + en for all 22; the Portuguese form only exists where OSM
  // tags one, so `pickWaterText` falls back pt → en → zh.
  const title = pickWaterText(facility.name, lang)
  const subtitle = otherScript(facility.name, lang, title)

  // Where an approximate marker actually sits. A `district:<slug>` anchor names
  // no facility, so only the badge shows in that case — never a fake address.
  const anchor = waterAnchorFacility(facility.anchor, facilities)
  const anchorName = anchor ? pickWaterText(anchor.name, lang) : ''
  const footprints = countWaterFootprints(facility)
  const pipes = waterPipeCount(network, facility.id)
  const isDsama = waterOperator(facility) === 'dsama'

  return (
    <Shell
      color={color}
      kindLabel={waterTypeLabel(t, facility.type)}
      stage={waterStage(facility.type)}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
    >
      {/* Detail rows. The facility number is Macao Water's own numbering, so a
          facility that is not on its list (a government reservoir) has none —
          and shows no row rather than an invented one. */}
      <div className="px-3 py-2 space-y-1">
        {facility.no !== null && facility.no !== undefined && (
          <Row label={t.waterNo} value={String(facility.no)} />
        )}
        <Row label={t.waterFootprints} value={t.waterBuildings(footprints)} />
      </div>

      {/* Ownership. Stated for every facility, because the panel's Macao Water
          header would otherwise imply the concessionaire owns the government's
          raw-water reservoirs too. */}
      <div className={`px-3 pb-2 text-[10px] mm-han leading-[1.4]
                       ${isDsama ? 'text-(--mm-amber-1)/80' : 'text-(--mm-text-muted)'}`}>
        {waterOperatorLabel(t, facility)}
      </div>

      {/* Approximate-position notice. Shown ONLY when the pipeline could not
          find a footprint: the marker is then placed at a co-located facility
          (or a district point), so saying so is the honest reading. */}
      {facility.approximate && (
        <div className="px-3 pb-2 space-y-1">
          <span className="inline-block mm-han text-[9px] leading-none px-1.5 py-[3px] border"
                style={{ borderColor: `${color}66`, color }}>
            {t.waterApproximate}
          </span>
          {anchorName && (
            <div className="text-[10px] text-(--mm-text-secondary) mm-han leading-[1.4]">
              {t.waterCoLocatedWith(anchorName)}
            </div>
          )}
        </div>
      )}

      {/* Pipes. Shown only where the network actually connects this facility,
          and always next to the reminder that the network is our own schematic
          drawing rather than Macao Water's mains. */}
      {pipes > 0 && (
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 text-[10px] text-(--mm-text-secondary) mm-han leading-[1.4]">
          {t.waterPipes(pipes)}
          <span className="text-(--mm-text-muted)">{' · '}{t.waterNetworkNote}</span>
        </div>
      )}
    </Shell>
  )
}

interface InletProps {
  node: WaterNetworkNode
  network: WaterNetwork | null
  onClose: () => void
}

// A raw-water inlet. Not one of Macao Water's 22 facilities but a point the
// raw-water pipes start from, so it gets a panel of its own: the name, what it
// is, the single fact that makes it worth a marker — and, for an inlet whose
// real crossing is not published, the pipeline's own note saying the position
// is schematic, shown before anything else a reader might take literally.
export function WaterInletInfoPanel({ node, network, onClose }: InletProps) {
  const { lang, t } = useI18n()
  const title = pickWaterText(node.name, lang)
  const subtitle = otherScript(node.name, lang, title)
  const pipes = waterPipeCount(network, node.id)
  const note = node.note ? pickWaterText(node.note, lang) : ''

  return (
    <Shell
      color={WATER_INLET_COLOR}
      kindLabel={t.waterTypeInlet}
      stage={waterStage(node.kind)}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
    >
      {(node.approximate || note) && (
        <div className="px-3 pt-2 pb-1 space-y-1">
          {node.approximate && (
            <span className="inline-block mm-han text-[9px] leading-none px-1.5 py-[3px] border"
                  style={{ borderColor: `${WATER_INLET_COLOR}66`, color: WATER_INLET_COLOR }}>
              {t.waterSchematicPosition}
            </span>
          )}
          {note && (
            <div className="text-[10px] text-(--mm-amber-1)/80 mm-han leading-[1.4]">
              {note}
            </div>
          )}
        </div>
      )}
      <div className="px-3 py-2 text-[11px] text-(--mm-fg)/75 mm-han leading-[1.5]">
        {t.waterInletNote}
      </div>
      {pipes > 0 && (
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 text-[10px] text-(--mm-text-secondary) mm-han leading-[1.4]">
          {t.waterPipes(pipes)}
          <span className="text-(--mm-text-muted)">{' · '}{t.waterNetworkNote}</span>
        </div>
      )}
    </Shell>
  )
}
