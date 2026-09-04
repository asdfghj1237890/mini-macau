import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import type { PowerFacility, PowerNetwork, PowerNetworkNode } from '../types'
import {
  POWER_COLORS,
  POWER_INLET_COLOR,
  countPowerFootprints,
  pickPowerText,
  powerAnchorFacility,
  powerLineCount,
  powerOperator,
  powerOperatorLabel,
  powerPlantUnits,
  powerTypeLabel,
} from '../power'

// Provenance links: CEM's own operations page (the source of the station list
// and the generation facts) and the OSM copyright page (the source of every
// footprint and coordinate).
const CEM_URL = 'https://www.cem-macau.com/zh/about-cem/company-profile/operation/'
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

// The card both variants of this panel live in: the same position, the same
// signboard header (colour bar + POWER kicker + kind + name + close) and the
// same provenance footer. Only the middle differs, so the facility panel and
// the inlet panel can never drift apart visually.
function Shell({ color, kindLabel, title, subtitle, onClose, children }: {
  color: string
  kindLabel: string
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
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                      shadow-2xl shadow-black/60 overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className="flex items-stretch border-b border-white/10">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-white/10"
               style={{ backgroundColor: `${color}14` }}>
            <div className="w-1 h-7 shrink-0" style={{ backgroundColor: color }} />
            <div>
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/50">
                {'⚡'} {t.powerLabel}
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
            {t.powerSource}
          </span>
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-wider text-white/45 truncate">
            <a
              href={CEM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-amber-200 transition-colors"
            >
              澳電 (CEM)
            </a>
            {' · '}
            <a
              href={OSM_COPYRIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-amber-200 transition-colors"
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

interface Props {
  facility: PowerFacility
  // The full facility list, so an approximate marker can name the facility it
  // is co-located with (`anchor`). Never filtered — the anchor may belong to a
  // record the user has not selected.
  facilities: PowerFacility[]
  // The schematic HV network, for the "n lines connected · schematic" line.
  // Null when the data file has no `network` block, in which case no such line
  // is shown.
  network: PowerNetwork | null
  onClose: () => void
}

export function PowerFacilityInfoPanel({ facility, facilities, network, onClose }: Props) {
  const { lang, t } = useI18n()

  // Header accent = the colour this facility's blocks/markers are drawn in, so
  // the panel and the thing the user clicked read as one object. Arbitrary hex,
  // hence an inline style rather than a Tailwind class.
  const color = POWER_COLORS[facility.type] ?? POWER_COLORS.sub66

  const title = pickPowerText(facility.name, lang)
  const subtitle = otherScript(facility.name, lang, title)

  // Where an approximate marker actually sits. A `district:<slug>` anchor names
  // no facility, so only the badge shows in that case — never a fake address.
  const anchor = powerAnchorFacility(facility.anchor, facilities)
  const anchorName = anchor ? pickPowerText(anchor.name, lang) : ''
  const footprints = countPowerFootprints(facility)
  const lines = powerLineCount(network, facility.id)
  const isDspa = powerOperator(facility) === 'dspa'
  const units = powerPlantUnits(facility, lang)
  // Only render the details block when it actually has something to render:
  // most substations carry no `details` at all, and a few carry only one field.
  const hasDetails = !!units
    || typeof facility.details?.capacityMw === 'number'
    || typeof facility.details?.commissioned === 'number'

  return (
    <Shell
      color={color}
      kindLabel={powerTypeLabel(t, facility.type)}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
    >
      {/* Detail rows. A generation facility carries no transmission voltage of
          its own, so it shows no VOLTAGE row rather than an invented one. */}
      <div className="px-3 py-2 space-y-1">
        {facility.voltageKv !== null && facility.voltageKv !== undefined && (
          <Row label={t.powerVoltage} value={t.powerVoltageValue(facility.voltageKv)} />
        )}
        <Row label={t.powerFootprints} value={t.powerBuildings(footprints)} />
      </div>

      {/* What the pipeline knows beyond the geometry: the Coloane plant's
          capacity and unit prose, or the year a 220 kV import station was
          commissioned. Every row is conditional and the whole section is
          skipped when there is nothing to say, so no panel ever shows an
          empty box or an invented number. */}
      {hasDetails && (
        <div className="px-3 pb-2 space-y-1 border-t border-white/8 pt-2">
          {typeof facility.details?.capacityMw === 'number' && (
            <Row label={t.powerCapacity} value={t.powerCapacityMw(facility.details.capacityMw)} />
          )}
          {typeof facility.details?.commissioned === 'number' && (
            <Row label={t.powerCommissioned} value={String(facility.details.commissioned)} />
          )}
          {units && (
            <div className="text-[10px] text-white/65 mm-han leading-[1.45]">
              <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/35 mr-2">
                {t.powerUnits}
              </span>
              {units}
            </div>
          )}
        </div>
      )}

      {/* Ownership. Stated for every facility, because the panel's POWER header
          would otherwise imply CEM owns the government's incineration centre. */}
      <div className={`px-3 pb-2 pt-2 text-[10px] mm-han leading-[1.4]
                       ${isDspa ? 'text-lime-200/80' : 'text-white/45'}`}>
        {powerOperatorLabel(t, facility)}
      </div>

      {/* Approximate-position notice. Shown ONLY when the pipeline could not
          match the station to an OSM feature: the marker is then placed at a
          co-located facility (or a district point), so saying so is honest. */}
      {facility.approximate && (
        <div className="px-3 pb-2 space-y-1">
          <span className="inline-block mm-han text-[9px] leading-none px-1.5 py-[3px] border"
                style={{ borderColor: `${color}66`, color }}>
            {t.powerApproximate}
          </span>
          {anchorName && (
            <div className="text-[10px] text-white/55 mm-han leading-[1.4]">
              {t.powerCoLocatedWith(anchorName)}
            </div>
          )}
        </div>
      )}

      {/* Lines. Shown only where the network actually connects this facility,
          and always next to the reminder that the grid is our own schematic
          drawing rather than CEM's cable routes. */}
      {lines > 0 && (
        <div className="px-3 py-1.5 border-t border-white/8 text-[10px] text-white/55 mm-han leading-[1.4]">
          {t.powerLines(lines)}
          <span className="text-white/35">{' · '}{t.powerNetworkNote}</span>
        </div>
      )}
    </Shell>
  )
}

interface InletProps {
  node: PowerNetworkNode
  network: PowerNetwork | null
  onClose: () => void
}

// A Guangdong import point. Not a CEM facility but the point three of the
// 220 kV corridors start from, so it gets a panel of its own: the name, what it
// is, and the single fact that makes it worth a marker — 91 % of the
// electricity Macau used in 2025 came in through points like this one.
export function PowerInletInfoPanel({ node, network, onClose }: InletProps) {
  const { lang, t } = useI18n()
  const title = pickPowerText(node.name, lang)
  const subtitle = otherScript(node.name, lang, title)
  const lines = powerLineCount(network, node.id)

  return (
    <Shell
      color={POWER_INLET_COLOR}
      kindLabel={t.powerTypeInlet}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
    >
      <div className="px-3 py-2 text-[11px] text-white/75 mm-han leading-[1.5]">
        {t.powerInletNote}
      </div>
      {lines > 0 && (
        <div className="px-3 py-1.5 border-t border-white/8 text-[10px] text-white/55 mm-han leading-[1.4]">
          {t.powerLines(lines)}
          <span className="text-white/35">{' · '}{t.powerNetworkNote}</span>
        </div>
      )}
    </Shell>
  )
}
