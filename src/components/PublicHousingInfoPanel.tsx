import { useI18n } from '../i18n'
import type { PublicHousingEstate } from '../types'
// The zh/pt text picker lives with the road-works helpers because that feed
// introduced the "no English upstream" problem; IH's two housing lists have the
// same bilingual-only shape, so they reuse the same rule (en → pt).
import { pickText } from '../roadWorks'
import {
  PUBLIC_HOUSING_TYPE_COLOR,
  publicHousingCategoryLabel,
  publicHousingDistrictLabel,
  publicHousingName,
  publicHousingStatusLabel,
  publicHousingTypeLabel,
  publicHousingYearLabel,
} from '../publicHousing'

interface Props {
  estate: PublicHousingEstate
  // The clicked footprint's IH block name (or its OSM name when the footprint
  // was never matched to a block); null for the unnamed, unmatched ones.
  buildingName: string | null
  onClose: () => void
}

// Provenance links: the Housing Bureau pages the record was built from (each
// estate carries its own list), and the OSM copyright page for the footprints.
const IH_URL = 'https://www.ihm.gov.mo/'
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="mm-mono text-ui-9 max-sm:text-ui-7 tracking-[0.25em] text-(--mm-text-muted) shrink-0 pt-[2px]">
        {label}
      </span>
      <span className="text-ui-10 text-(--mm-fg)/80 text-right mm-han min-w-0">{value}</span>
    </div>
  )
}

export function PublicHousingInfoPanel({ estate, buildingName, onClose }: Props) {
  const { lang, t } = useI18n()

  // Type colour, straight from the table the map blocks and the legend swatches
  // read — arbitrary hex, so it goes in as an inline style.
  const color = PUBLIC_HOUSING_TYPE_COLOR[estate.type] ?? PUBLIC_HOUSING_TYPE_COLOR.economic

  // Name in the reading language, with the other script underneath. IH publishes
  // no English form at all, so `en` reads the Portuguese one (see
  // publicHousingName); an estate with no Portuguese name gets no subtitle.
  const title = publicHousingName(estate, lang)
  const other = lang === 'zh' ? estate.name.pt : estate.name.zh
  const subtitle = other && other !== title ? other : ''

  const address = pickText(estate.address, lang)
  // What the year means differs per record (入伙 / 落成 / 預計), so the LABEL
  // carries the distinction and the value stays a bare year.
  const yearLabel = publicHousingYearLabel(t, estate.yearKind)
  const yearValue = estate.year == null ? '—' : String(estate.year)
  // An occupied estate says so through its 入伙 year already; the row is only
  // worth a line when the estate is NOT simply occupied.
  const showStatus = estate.status !== 'occupied'
  // Only the `other` type carries a category: the badge above reads "Other
  // public housing", which names no programme, so the row says which one it is.
  // A social/economic estate has `category: null` and no row at all.
  const category = publicHousingCategoryLabel(t, estate.category)

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
              <div className="mm-mono text-ui-9 max-sm:text-ui-7 tracking-[0.25em] text-(--mm-text-secondary)">
                {'▤'} {t.publicHousingLabel}
              </div>
              <div className="text-ui-13 font-bold text-(--mm-fg) leading-tight mm-han whitespace-nowrap">
                {publicHousingTypeLabel(t, estate.type)}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="text-ui-14 font-bold text-(--mm-fg) truncate mm-han" title={title}>
              {title}
            </div>
            {subtitle && (
              <div className="text-ui-10 text-(--mm-text-muted) truncate mm-han" title={subtitle}>
                {subtitle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-3 text-(--mm-text-muted) hover:text-(--mm-fg) hover:bg-(--mm-fg)/5 border-l border-(--mm-fg)/10
                       mm-mono text-ui-13 transition-colors"
            aria-label={t.cancel}
          >
            ✕
          </button>
        </div>

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          {category && <Row label={t.publicHousingCategory} value={category} />}
          <Row label={t.publicHousingDistrict} value={publicHousingDistrictLabel(t, estate.district)} />
          {address && <Row label={t.publicHousingAddress} value={address} />}
          <Row label={yearLabel} value={yearValue} />
          {showStatus && (
            <Row label={t.publicHousingStatus} value={publicHousingStatusLabel(t, estate.status)} />
          )}
          {estate.units != null && (
            <Row label={t.publicHousingUnits} value={estate.units.toLocaleString()} />
          )}
          {estate.storeys != null && (
            <Row label={t.publicHousingStoreys} value={String(estate.storeys)} />
          )}
          {buildingName && <Row label={t.publicHousingBuilding} value={buildingName} />}
          {estate.blocks.length > 0 && (
            <div className="flex items-start justify-between gap-3">
              <span className="mm-mono text-ui-9 max-sm:text-ui-7 tracking-[0.25em] text-(--mm-text-muted) shrink-0 pt-[2px]">
                {t.publicHousingBlocks}
              </span>
              <div className="flex flex-wrap justify-end gap-1 min-w-0">
                {estate.blocks.map((block, i) => {
                  const name = pickText(block.name, lang)
                  // The clicked footprint's block, lit like the school panel's
                  // active teaching stage — the map highlights the whole estate,
                  // so this is the only place the exact block is named.
                  const here = !!buildingName && block.name.zh === buildingName
                  return (
                    <span
                      key={`${i}-${block.name.zh}-${block.year ?? ''}`}
                      className={`mm-han text-ui-9 leading-none px-1.5 py-[3px] border
                                  ${here
                                    ? 'border-(--mm-fg)/20 bg-(--mm-fg)/[0.06] text-(--mm-fg)/80'
                                    : 'border-(--mm-fg)/8 text-(--mm-fg)/40'}`}
                    >
                      {name}
                      {block.year != null && (
                        <span className="mm-mono text-(--mm-fg)/35 ml-1">{block.year}</span>
                      )}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          <Row
            label={t.publicHousingFootprints}
            value={t.publicHousingBuildingsCount(estate.buildings.length)}
          />
          {/* IH marks these entries with an asterisk: the address holds public
              housing, but not every flat in it is. */}
          {estate.partial && (
            <div className="pt-[2px] text-ui-9 leading-[1.35] text-(--mm-text-subtle) mm-han">
              {t.publicHousingPartialNote}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between gap-2">
          <span className="mm-mono text-ui-8 max-sm:text-ui-6 tracking-[0.25em] text-(--mm-text-muted) uppercase">
            {t.publicHousingSource}
          </span>
          <span className="mm-mono text-ui-8 max-sm:text-ui-6 tracking-wider text-(--mm-text-muted) truncate">
            {/* One link per page the record was built from; an estate with no
                list of its own still gets the bureau's front door. */}
            {(estate.sources.length ? estate.sources : [IH_URL]).map((url, i) => (
              <span key={url}>
                {i > 0 && ' · '}
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-(--mm-lime-1) transition-colors"
                >
                  {i === 0 ? 'IH' : `IH ${i + 1}`}
                </a>
              </span>
            ))}
            {' · '}
            <a
              href={OSM_COPYRIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-(--mm-lime-1) transition-colors"
            >
              OpenStreetMap
            </a>
          </span>
        </div>
      </div>
    </div>
  )
}
