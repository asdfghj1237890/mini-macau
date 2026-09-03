import { useI18n } from '../i18n'
import type { School } from '../types'
// The zh/pt text picker lives with the road-works helpers because that feed
// introduced the "no English upstream" problem; schools.json has the same
// bilingual-only shape, so it reuses the same rule (en → pt).
import { pickText } from '../roadWorks'
import {
  SCHOOL_COLORS,
  schoolDsedjCode,
  schoolLevelLabel,
  schoolSystemLabel,
} from '../schools'

interface Props {
  school: School
  // The clicked footprint's OSM name; null for the many unnamed buildings.
  buildingName: string | null
  onClose: () => void
}

// Provenance links: the DSEDJ register the school list comes from, and the
// OSM copyright page for the footprints.
const DSEDJ_URL = 'https://www.dsedj.gov.mo/'
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

export function SchoolInfoPanel({ school, buildingName, onClose }: Props) {
  const { lang, t } = useI18n()

  // Level colour, straight from the table the map blocks and the legend
  // swatches read — arbitrary hex, so it goes in as an inline style.
  const color = SCHOOL_COLORS[school.level] ?? SCHOOL_COLORS.all_through

  // Name in the reading language, with the other script underneath. A school
  // with no Portuguese form upstream (pt: "") just gets no subtitle.
  const title = pickText(school.name, lang)
  const other = lang === 'zh' ? school.name.pt : school.name.zh
  const subtitle = other && other !== title ? other : ''

  // The three DSEDJ teaching stages. Tertiary institutions come from OSM and
  // have no stage flags at all, so the row is hidden for them.
  const stages: [string, boolean][] = [
    [t.schoolLevelKindergarten, !!school.levels.kindergarten],
    [t.schoolLevelPrimary, !!school.levels.primary],
    [t.schoolLevelSecondary, !!school.levels.secondary],
  ]
  const showStages = school.system !== 'tertiary'
  const code = schoolDsedjCode(school.id)

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
                {'⌂'} {t.schoolLabel}
              </div>
              <div className="text-[13px] font-bold text-white leading-tight mm-han whitespace-nowrap">
                {schoolLevelLabel(t, school.level)}
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

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          <Row label={t.schoolSystem} value={schoolSystemLabel(t, school.system)} />
          {showStages && (
            <div className="flex items-start justify-between gap-3">
              <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/35 shrink-0 pt-[2px]">
                {t.schoolStages}
              </span>
              <div className="flex flex-wrap justify-end gap-1 min-w-0">
                {stages.map(([label, on]) => (
                  <span
                    key={label}
                    className={`mm-han text-[9px] leading-none px-1.5 py-[3px] border
                                ${on
                                  ? 'border-white/20 bg-white/[0.06] text-white/80'
                                  : 'border-white/8 text-white/25'}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {buildingName && <Row label={t.schoolBuilding} value={buildingName} />}
          <Row label={t.schoolCampus} value={t.schoolBuildings(school.buildings.length)} />
          {code && <Row label={t.schoolCode} value={code} />}
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-white/8 bg-white/[0.02] flex items-center justify-between gap-2">
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-white/35 uppercase">
            {t.schoolSource}
          </span>
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-wider text-white/45 truncate">
            <a
              href={DSEDJ_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-violet-200 transition-colors"
            >
              DSEDJ
            </a>
            {' · '}
            <a
              href={OSM_COPYRIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-violet-200 transition-colors"
            >
              OpenStreetMap
            </a>
          </span>
        </div>
      </div>
    </div>
  )
}
