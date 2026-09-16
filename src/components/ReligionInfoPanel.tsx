import { useI18n } from '../i18n'
import type { ReligionCategory, ReligionKind, ReligionSite } from '../types'
import { pickHeritageText, pickReligionText, religionCategoryName, religionColor, religionKindLabel } from '../religion'

interface Props {
  site: ReligionSite
  categories: ReligionCategory[]
  onClose: () => void
}

// Provenance links. The IC dataset page (data.gov.mo) and the Macau Memory
// exhibition are static; the per-site OSM and Macau Memory links come from
// the record itself.
const IC_DATASET_URL = 'https://data.gov.mo/Detail?id=7e1eca8e-6ffe-4f74-8c81-25c25beb45b2'
const MACAU_MEMORY_URL = 'https://www.macaumemory.mo/exhibitions/showexhibition!toSep?id=8c35d71325374eeda344f11a351a27d7'
const OSM_URL = 'https://www.openstreetmap.org/'

// The one-character signboard glyph for a building kind — language-neutral,
// like the toilets' "WC".
const KIND_GLYPH: Record<ReligionKind, string> = { temple: '廟', shrine: '壇', church: '堂', mosque: '寺' }

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

export function ReligionInfoPanel({ site, categories, onClose }: Props) {
  const { lang, t } = useI18n()

  // Header accent = the marker colour this site is drawn with (its category),
  // so the panel and the pin the user just clicked read as the same object.
  const color = religionColor(site)

  // The Chinese name is the inscription; English/Portuguese readers get the
  // official or bilingual-OSM name only where one exists (see pickReligionText).
  const title = pickReligionText(site.name, lang)
  const zhName = site.name.zh
  const categoryLabel = religionCategoryName(categories, site.category, lang, t)
  const kindLabel = religionKindLabel(t, site.kind)
  const heritageText = pickHeritageText(site.heritage?.description, lang)

  // Source chips — only the ones this record actually came from.
  const sourceLabels: Record<ReligionSite['sources'][number], string> = {
    osm: t.religionSourceOsm,
    ic: t.religionSourceIc,
    macaumemory: t.religionSourceMacauMemory,
  }

  const osmHref = site.osm ? `${OSM_URL}${site.osm}` : null

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
                {t.religionLabel}
              </div>
              <div className="mm-han text-ui-13 font-bold text-(--mm-fg) leading-tight">
                {KIND_GLYPH[site.kind]}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="text-ui-14 font-bold text-(--mm-fg) truncate mm-han" title={title}>
              {title}
            </div>
            {/* The inscription itself, when the headline is a translation. */}
            {title !== zhName && (
              <div className="text-ui-10 text-(--mm-text-muted) truncate mm-han" title={zhName}>
                {zhName}
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
          <Row label={t.religionKind} value={`${categoryLabel} · ${kindLabel}`} />
          {site.address?.zh && <Row label={t.religionAddress} value={site.address.zh} />}
          {site.heritage && <Row label={t.religionHeritage} value={t.religionHeritageValue(site.heritage.code)} />}
        </div>

        {/* The IC's own description for a classified site — plain text, never HTML. */}
        {heritageText && (
          <div className="px-3 pb-2 text-ui-10 text-(--mm-fg)/75 mm-han leading-snug max-h-40 overflow-y-auto">
            {heritageText}
          </div>
        )}

        {/* Street-level positions say so, in words, not just by a dimmer pin. */}
        {site.approximate && (
          <div className="px-3 pb-2 text-ui-9 text-(--mm-amber) mm-han leading-snug">
            {t.religionApproximate}
          </div>
        )}

        {/* Source chips — one per dataset this record came from */}
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {site.sources.map(source => (
            <span
              key={source}
              className="mm-han text-ui-9 leading-none px-1.5 py-[3px] border
                         border-(--mm-fg)/20 bg-(--mm-fg)/[0.06] text-(--mm-fg)/80"
            >
              {sourceLabels[source]}
            </span>
          ))}
        </div>

        {/* Coverage note: the official totals the Tou Tei register is measured
            against. Only that category has a published count. */}
        {site.category === 'tudigong' && (
          <div className="px-3 pb-2 text-ui-9 text-(--mm-text-muted) mm-han leading-snug">
            {t.religionCoverageNote}
          </div>
        )}

        {/* Footer: provenance links for THIS site */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between gap-2">
          <span className="mm-mono text-ui-8 max-sm:text-ui-6 tracking-[0.25em] text-(--mm-text-muted) uppercase">
            {t.religionSources}
          </span>
          <span className="mm-mono text-ui-8 max-sm:text-ui-6 tracking-wider text-(--mm-text-muted) truncate">
            {osmHref && (
              <>
                <a href={osmHref} target="_blank" rel="noopener noreferrer" className="hover:text-(--mm-teal-1) transition-colors">
                  OSM
                </a>
                <span className="text-(--mm-fg)/25 mx-[3px]">·</span>
              </>
            )}
            {site.heritage && (
              <>
                <a href={IC_DATASET_URL} target="_blank" rel="noopener noreferrer" className="hover:text-(--mm-teal-1) transition-colors">
                  IC
                </a>
                <span className="text-(--mm-fg)/25 mx-[3px]">·</span>
              </>
            )}
            {site.macaumemory && (
              <a
                href={site.macaumemory.entries[0] ?? MACAU_MEMORY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-(--mm-teal-1) transition-colors"
              >
                {t.religionMacauMemoryEntry}
              </a>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
