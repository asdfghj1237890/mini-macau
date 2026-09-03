import { useState, useMemo, useEffect } from 'react'
import type { TransitData, SimulationClock, SchoolLevel } from '../types'
import { useI18n, localName } from '../i18n'
import { getRouteGroup, GROUP_ORDER, GROUP_LABEL_KEYS, type GroupKey } from '../routeGroups'
import {
  SCHOOL_COLORS,
  SCHOOL_LEVEL_ORDER,
  countSchoolsByLevel,
  schoolLevelLabel,
  type SchoolLevelSet,
} from '../schools'

// The five level colours as one 8×8 swatch. Only the mobile modal header uses
// it now — the desktop row shows the same violet hatch as the other layers,
// because the per-level rows underneath carry the colour key themselves.
const SCHOOL_SWATCH_GRADIENT = `linear-gradient(90deg, ${
  SCHOOL_LEVEL_ORDER.map((level, i) =>
    `${SCHOOL_COLORS[level]} ${i * 20}% ${(i + 1) * 20}%`).join(', ')
})`

// Violet hatch for the SCHOOLS row, matching the AIR/SEA/WORKS swatches.
const SCHOOL_HATCH = 'repeating-linear-gradient(-45deg, rgba(167,139,250,0.45) 0 1px, transparent 1px 3px)'

// Static English caption beside each level's localised label, so a row reads
// the same in all three UI languages (the mono column is decoration, not a
// translated string).
const SCHOOL_LEVEL_CAPTIONS: Record<SchoolLevel, string> = {
  kindergarten: 'KINDER',
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  university: 'TERTIARY',
  all_through: 'ALL-THROUGH',
}

// Teal hatch for the WC row, matching the AIR/SEA/WORKS/SCHOOLS swatches.
const TOILET_HATCH = 'repeating-linear-gradient(-45deg, rgba(20,184,166,0.45) 0 1px, transparent 1px 3px)'

// 12px signboard glyph for the WC row — a plate with a hanging "WC" bar, in
// the same stroked style as the other row icons (an emoji would not recolour).
function ToiletIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.25" y="3" width="11.5" height="8.5" rx="1.5" />
      <path d="M5 6.25v2.5" /><path d="M5 8.75l1.25-1.5 1.25 1.5v-2.5" />
      <path d="M11 6.25h-1.25v2.5H11" />
      <path d="M8 11.5v2" />
    </svg>
  )
}

// 12px mortarboard for the SCHOOLS row's glyph slot.
function MortarboardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 6.5L8 3.5l6 3-6 3-6-3z" />
      <path d="M4.5 8.2v3c0 .9 1.6 1.8 3.5 1.8s3.5-.9 3.5-1.8v-3" />
      <path d="M14 6.5v3.5" />
    </svg>
  )
}

const LS_DESKTOP_OPEN = 'mm-layers-desktop-open'
const LS_DESKTOP_COLLAPSED_GROUPS = 'mm-layers-collapsed-groups'
const LS_SCHOOLS_LEGEND_OPEN = 'mm-schools-legend-open'

interface Props {
  transitData: TransitData
  allTransitData?: TransitData
  visibleRoutes?: Set<string>
  inactiveRoutes?: Set<string>
  isAutoMode?: boolean
  lrtOn?: Set<string>
  flightsOn?: boolean
  ferriesOn?: boolean
  roadWorksOn?: boolean
  // Notices in force on the SIMULATED calendar day (computed in App so the
  // legend and the map markers always agree). Not derivable from
  // transitData.roadWorks alone, which is the whole dataset.
  activeRoadWorksCount?: number
  schoolsOn?: boolean
  // Which teaching stages are drawn, and how many schools each stage has
  // (counted from the UNFILTERED data, so a row keeps its total while off).
  schoolLevelsOn?: SchoolLevelSet
  schoolLevelCounts?: Record<SchoolLevel, number>
  // Public toilets. Like schools this layer is opt-in, so it defaults to off
  // here too — the count shown is the whole register, which never changes.
  toiletsOn?: boolean
  clock?: SimulationClock
  onToggleLrt?: (id: string) => void
  onToggleFlights?: () => void
  onToggleFerries?: () => void
  onToggleRoadWorks?: () => void
  onToggleSchools?: () => void
  onToggleSchoolLevel?: (level: SchoolLevel) => void
  onToggleToilets?: () => void
  onToggleRoute?: (routeId: string) => void
  onToggleAll?: () => void
  onShowAll?: () => void
  onHideAll?: () => void
  onToggleGroup?: (groupKey: GroupKey) => void
  onResetAuto?: () => void
}

type MobilePanel = 'lrt' | 'bus' | 'air' | 'sea' | 'works' | 'schools' | 'toilets' | null

export function LineLegend({
  transitData,
  allTransitData,
  visibleRoutes,
  inactiveRoutes,
  isAutoMode,
  lrtOn,
  flightsOn = true,
  ferriesOn = true,
  roadWorksOn = true,
  activeRoadWorksCount = 0,
  schoolsOn = true,
  schoolLevelsOn,
  schoolLevelCounts,
  toiletsOn = false,
  clock,
  onToggleLrt,
  onToggleFlights,
  onToggleFerries,
  onToggleRoadWorks,
  onToggleSchools,
  onToggleSchoolLevel,
  onToggleToilets,
  onToggleRoute,
  onShowAll,
  onHideAll,
  onToggleGroup,
  onResetAuto,
}: Props) {
  const { lang, t } = useI18n()
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null)
  const [desktopOpen, setDesktopOpen] = useState(() => {
    try { return localStorage.getItem(LS_DESKTOP_OPEN) !== '0' } catch { return true }
  })
  const [schoolsLegendOpen, setSchoolsLegendOpen] = useState(() => {
    try { return localStorage.getItem(LS_SCHOOLS_LEGEND_OPEN) !== '0' } catch { return true }
  })
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LS_DESKTOP_COLLAPSED_GROUPS)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) return new Set(arr)
      }
    } catch { /* ignore */ }
    return new Set(GROUP_ORDER)
  })

  useEffect(() => { localStorage.setItem(LS_DESKTOP_OPEN, desktopOpen ? '1' : '0') }, [desktopOpen])
  useEffect(() => {
    localStorage.setItem(LS_SCHOOLS_LEGEND_OPEN, schoolsLegendOpen ? '1' : '0')
  }, [schoolsLegendOpen])
  useEffect(() => {
    localStorage.setItem(LS_DESKTOP_COLLAPSED_GROUPS, JSON.stringify([...collapsedGroups]))
  }, [collapsedGroups])

  const toggleGroupCollapse = (g: string) => setCollapsedGroups(prev => {
    const next = new Set(prev)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    return next
  })

  // Memoize so the `?? []` fallback doesn't hand `grouped` a fresh array
  // every render (which would make its useMemo recompute each time).
  const busRoutes = useMemo(() => allTransitData?.busRoutes ?? [], [allTransitData])
  const allLrtLines = allTransitData?.lrtLines ?? transitData.lrtLines
  // Per-level totals. App passes them pre-counted; the fallback keeps the
  // legend correct if it's ever rendered without them.
  const allSchools = useMemo(
    () => allTransitData?.schools ?? transitData.schools,
    [allTransitData, transitData.schools]
  )
  const levelCounts = useMemo(
    () => schoolLevelCounts ?? countSchoolsByLevel(allSchools),
    [schoolLevelCounts, allSchools]
  )
  const grouped = useMemo(() => {
    const groups = new Map<typeof GROUP_ORDER[number], typeof busRoutes>()
    for (const g of GROUP_ORDER) groups.set(g, [])
    for (const route of busRoutes) {
      groups.get(getRouteGroup(route))!.push(route)
    }
    return groups
  }, [busRoutes])

  if (transitData.loading) {
    // The loading chip must occupy the *exact* same bounding box the real
    // LAYERS panel will take once data arrives — same position, same width.
    // Previously it was content-sized (~90px) while the full panel is 240px
    // with the same right-3 anchor, so the left edge jumped ~150px inward
    // on load, which Lighthouse attributed as the 0.140 layout shift
    // (amplified further by the mm-ui-scale zoom: 1.2-1.3). Height doesn't
    // need to match — top-anchored absolute elements don't register as CLS
    // when only the bottom edge moves.
    return (
      <div className="mm-ui-scale absolute top-3 right-3 z-20 hidden sm:block landscape:hidden
                      bg-[#0b0b0c]/95 backdrop-blur-md rounded-sm
                      px-3 py-2 border border-white/10 text-amber-300/80
                      mm-mono text-[10px] tracking-[0.25em] w-[240px] text-center">
        {t.loading}
      </div>
    )
  }

  const togglePanel = (panel: MobilePanel) =>
    setMobilePanel(prev => (prev === panel ? null : panel))

  const activeRoutes = transitData.busRoutes.length
  const totalRoutes = allTransitData?.busRoutes.length ?? activeRoutes
  const lrtActive = lrtOn?.size ?? allLrtLines.length
  const lrtTotal = allLrtLines.length
  const flightCount = transitData.flights.length
  const totalFlightCount = allTransitData?.flights.length ?? flightCount
  const ferryCount = transitData.ferries.length
  const totalFerryCount = allTransitData?.ferries.length ?? ferryCount
  const totalRoadWorkCount = allTransitData?.roadWorks.length ?? transitData.roadWorks.length
  // Schools are static, so `schoolCount` is the full register — the master
  // switch empties `transitData.schools`, it doesn't change how many exist.
  // The per-level toggles narrow it, hence the enabled/total pair.
  const schoolCount = allTransitData?.schools.length ?? transitData.schools.length
  const isSchoolLevelOn = (level: SchoolLevel) =>
    (schoolLevelsOn ? schoolLevelsOn.has(level) : true)
  const schoolLevelsAllOn = SCHOOL_LEVEL_ORDER.every(isSchoolLevelOn)
  const schoolEnabledCount = SCHOOL_LEVEL_ORDER.reduce(
    (sum, level) => (isSchoolLevelOn(level) ? sum + (levelCounts[level] ?? 0) : sum), 0
  )
  // Toilets are static and unfiltered: the row always shows the full register,
  // and the master switch is the only thing that empties transitData.toilets.
  const toiletCount = allTransitData?.toilets.length ?? transitData.toilets.length

  const isLrtOn = (id: string) => (lrtOn ? lrtOn.has(id) : true)
  const isLive = clock ? clock.isLive : true

  return (
    <>
      {/* Desktop LAYERS panel — collapsible; includes LRT + BUS groups + AIR */}
      {!desktopOpen ? (
        <button
          type="button"
          onClick={() => setDesktopOpen(true)}
          className="mm-ui-scale absolute top-3 right-3 z-20 hidden sm:flex landscape:hidden
                     bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10
                     hover:border-amber-300/40 shadow-xl px-3 py-2 items-center gap-3 transition"
        >
          <span className="mm-mono text-[8px] tracking-[0.28em] text-amber-300/70">▤ LAYERS</span>
          <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-white/60">
            {allLrtLines.slice(0, 3).map(line => (
              <span
                key={line.id}
                className="w-1.5 h-[3px]"
                style={{ backgroundColor: isLrtOn(line.id) ? line.color : '#444' }}
              />
            ))}
            <span className="text-white/40 ml-0.5">{lrtActive}/{lrtTotal}</span>
          </span>
          <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-white/60">
            <span className={`w-1.5 h-1.5 rounded-full ${activeRoutes > 0 ? 'bg-emerald-400' : 'bg-white/20'}`} />
            <span>{activeRoutes}/{totalRoutes}</span>
          </span>
          {totalFlightCount > 0 && flightsOn && (
            <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-sky-300/80">
              <span>✈</span><span>{flightCount}</span>
            </span>
          )}
          {totalFerryCount > 0 && ferriesOn && (
            <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-red-300/80">
              <span>{'\u2693\uFE0E'}</span><span>{ferryCount}</span>
            </span>
          )}
          {totalRoadWorkCount > 0 && roadWorksOn && (
            <span className="flex items-center gap-1 mm-mono mm-tabular text-[10px] text-amber-300/80">
              <span>{'\u26A0\uFE0E'}</span><span>{activeRoadWorksCount}</span>
            </span>
          )}
        </button>
      ) : (
        <div className="mm-ui-scale absolute top-3 right-3 z-20 hidden sm:block landscape:hidden
                        bg-[#0b0b0c]/95 backdrop-blur-md rounded-sm
                        border border-white/10 overflow-hidden w-[240px] shadow-2xl">
          {/* Header */}
          <div className="px-3 py-1 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
            <span className="mm-mono text-[9px] tracking-[0.28em] text-amber-300/75">▤ LAYERS</span>
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 mm-mono text-[9px] tracking-[0.2em] ${isLive ? 'text-emerald-300/80' : 'text-white/30'}`}>
                <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-emerald-400 mm-led-pulse' : 'bg-white/25'}`} />
                {isLive ? t.live : t.simShort}
              </span>
              <button
                type="button"
                onClick={() => setDesktopOpen(false)}
                aria-label="collapse layers panel"
                className="text-white/55 hover:text-amber-200 hover:bg-white/5 text-[18px] mm-mono
                           w-6 h-6 flex items-center justify-center leading-none transition
                           border border-white/10 hover:border-amber-300/40 rounded-sm"
              >
                ×
              </button>
            </div>
          </div>

          {/* LRT — clickable rows */}
          <div>
            <div className="px-3 py-1 flex items-center justify-between bg-white/[0.015] border-b border-white/5">
              <span className="flex items-center gap-1.5 text-white/45">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                  <rect x="4" y="3" width="16" height="14" rx="2" />
                  <path d="M4 11h16" /><path d="M12 3v8" />
                  <path d="M8 21l2-4h4l2 4" />
                </svg>
                <span
                  className="inline-block w-[8px] h-[8px]"
                  style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(252,196,65,0.35) 0 1px, transparent 1px 3px)' }}
                />
                <span className="mm-mono text-[8px] tracking-[0.25em]">LRT · 輕軌</span>
              </span>
              <span className="mm-mono mm-tabular text-[8px] text-white/30">
                {lrtActive}<span className="text-white/20">/{lrtTotal}</span>
              </span>
            </div>
            <div className="py-0.5">
              {allLrtLines.map(line => {
                const on = isLrtOn(line.id)
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => onToggleLrt?.(line.id)}
                    disabled={!onToggleLrt}
                    aria-pressed={on}
                    className={`w-full flex items-center gap-2 px-2.5 py-1 border-l-2 transition
                               ${on
                                 ? 'border-amber-300/60 bg-amber-300/[0.04] hover:bg-amber-300/[0.08]'
                                 : 'border-transparent hover:bg-white/[0.03] opacity-40'}
                               ${onToggleLrt ? '' : 'cursor-default'}`}
                  >
                    <div className="w-3 h-[3px] shrink-0" style={{ backgroundColor: on ? line.color : '#555' }} />
                    <span className={`mm-han text-[11px] flex-1 text-left truncate
                                      ${on ? 'text-white/90' : 'text-white/40'}`}>
                      {localName(lang, line)}
                    </span>
                    <span className={`mm-mono text-[8px] tracking-[0.2em] shrink-0
                                      ${on ? 'text-emerald-300/80' : 'text-white/25'}`}>
                      {on ? 'ON' : 'OFF'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* BUS section with mode tabs + collapsible groups */}
          {totalRoutes > 0 && visibleRoutes && (
            <div className="border-t border-white/10">
              <div className="px-3 py-1 flex items-center justify-between bg-white/[0.015]">
                <span className="flex items-center gap-1.5 text-white/45">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                    <path d="M8 6v6" /><path d="M16 6v6" />
                    <path d="M2 12h20" />
                    <rect x="2" y="4" width="20" height="14" rx="3" />
                    <circle cx="7" cy="20" r="1" /><circle cx="17" cy="20" r="1" />
                  </svg>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(110,231,183,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[8px] tracking-[0.25em]">BUS · 巴士</span>
                </span>
                <span className="mm-mono mm-tabular text-[9px] text-emerald-300/80">
                  {activeRoutes}<span className="text-white/30">/{totalRoutes}</span>
                </span>
              </div>
              <div className="grid grid-cols-3 border-y border-white/8">
                <button
                  onClick={onResetAuto}
                  className={`px-1 py-1 mm-mono text-[9px] tracking-[0.1em] transition-colors text-center
                             ${isAutoMode
                               ? 'bg-amber-300/10 text-amber-200'
                               : 'text-white/45 hover:text-white hover:bg-white/5'}`}
                  style={isAutoMode ? { boxShadow: 'inset 0 -2px 0 rgba(252,196,65,0.7)' } : undefined}
                >
                  {t.autoByTime}
                </button>
                <button
                  onClick={onShowAll}
                  className="px-1 py-1 mm-mono text-[9px] tracking-[0.15em] text-white/45 hover:text-white
                             hover:bg-white/5 transition-colors text-center border-l border-white/8"
                >
                  {t.showAll}
                </button>
                <button
                  onClick={onHideAll}
                  className="px-1 py-1 mm-mono text-[9px] tracking-[0.15em] text-white/45 hover:text-white
                             hover:bg-white/5 transition-colors text-center border-l border-white/8"
                >
                  {t.hideAll}
                </button>
              </div>
              <div className="max-h-[45vh] overflow-y-auto">
                {GROUP_ORDER.map(groupKey => {
                  const routes = grouped.get(groupKey) || []
                  if (routes.length === 0) return null
                  const groupActive = routes.filter(r => visibleRoutes.has(r.id)).length
                  const eligibleInGroup = routes.filter(r => !(inactiveRoutes?.has(r.id) ?? false))
                  const groupOn = groupActive > 0
                  const collapsed = collapsedGroups.has(groupKey)
                  return (
                    <div key={groupKey} className="border-t border-white/5">
                      <div className="w-full flex items-stretch bg-white/[0.015]">
                        <button
                          type="button"
                          onClick={() => toggleGroupCollapse(groupKey)}
                          className="flex-1 min-w-0 px-2 py-1 flex items-center gap-2
                                     hover:bg-white/[0.04] transition"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0
                                            ${groupActive > 0 ? 'bg-amber-300' : 'bg-white/15'}`}
                                style={groupActive > 0 ? { boxShadow: '0 0 5px rgba(252,196,65,0.8)' } : undefined} />
                          <span className="mm-mono text-[9px] tracking-[0.2em] text-white/55 uppercase flex-1 text-left">
                            {t[GROUP_LABEL_KEYS[groupKey]]}
                          </span>
                          <span className="mm-mono mm-tabular text-[9px] text-white/35 w-10 text-right">
                            {groupActive}/{routes.length}
                          </span>
                          <span className="text-white/30 mm-mono text-[8px] w-3 text-center">
                            {collapsed ? '▸' : '▾'}
                          </span>
                        </button>
                        {onToggleGroup && eligibleInGroup.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onToggleGroup(groupKey)}
                            aria-pressed={groupOn}
                            className={`shrink-0 w-10 mm-mono text-[8px] tracking-[0.2em]
                                        border-l border-white/8 transition text-center
                                        ${groupOn
                                          ? 'text-emerald-300/80 hover:bg-emerald-300/10'
                                          : 'text-white/30 hover:text-white/80 hover:bg-white/[0.05]'}`}
                          >
                            {groupOn ? 'ON' : 'OFF'}
                          </button>
                        )}
                      </div>
                      {!collapsed && (
                        <div className="bg-[#060607]">
                          {routes.map(route => {
                            const inactive = inactiveRoutes?.has(route.id) ?? false
                            const on = visibleRoutes.has(route.id)
                            return (
                              <button
                                key={route.id}
                                onClick={() => !inactive && onToggleRoute?.(route.id)}
                                disabled={inactive}
                                title={inactive ? t.noServiceToday : undefined}
                                className={`w-full px-2 py-[3px] flex items-center gap-2 transition-colors
                                           ${inactive
                                             ? 'opacity-30 cursor-not-allowed'
                                             : on ? 'hover:bg-white/[0.04]' : 'opacity-35 hover:opacity-60'}`}
                              >
                                <span
                                  className="mm-mono mm-tabular text-[10px] font-bold text-center shrink-0"
                                  style={{
                                    width: 36,
                                    color: inactive ? '#444' : on ? route.color : '#555',
                                    textShadow: !inactive && on ? `0 0 6px ${route.color}66` : 'none',
                                    textDecoration: inactive ? 'line-through' : 'none',
                                  }}
                                >
                                  {route.name}
                                </span>
                                <span className={`text-[10px] flex-1 text-left truncate mm-han
                                                  ${inactive ? 'text-white/25' : on ? 'text-white/75' : 'text-white/30'}`}>
                                  {inactive
                                    ? t.noServiceToday
                                    : (lang !== 'en' && route.nameCn ? route.nameCn : '')}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* AIR — toggleable */}
          {totalFlightCount > 0 && (
            <button
              type="button"
              onClick={onToggleFlights}
              disabled={!onToggleFlights}
              aria-pressed={flightsOn}
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${flightsOn
                           ? 'bg-sky-400/[0.04] hover:bg-sky-400/[0.08]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleFlights ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${flightsOn ? 'text-white/45' : 'text-white/40'}`}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 2L11 13" />
                  <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(125,211,252,0.35) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                AIR · 航班
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${flightsOn ? 'text-sky-300/80' : 'text-white/25'}`}>
                {flightCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${flightsOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {flightsOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* SEA — toggleable */}
          {totalFerryCount > 0 && (
            <button
              type="button"
              onClick={onToggleFerries}
              disabled={!onToggleFerries}
              aria-pressed={ferriesOn}
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${ferriesOn
                           ? 'bg-red-400/[0.05] hover:bg-red-400/[0.1]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleFerries ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${ferriesOn ? 'text-white/45' : 'text-white/40'}`}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="5" r="3" />
                  <path d="M12 22V8" />
                  <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
                </svg>
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(248,113,113,0.35) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                SEA · 船運
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${ferriesOn ? 'text-red-300/80' : 'text-white/25'}`}>
                {ferryCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${ferriesOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {ferriesOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* ROAD WORKS — toggleable */}
          {totalRoadWorkCount > 0 && (
            <button
              type="button"
              onClick={onToggleRoadWorks}
              disabled={!onToggleRoadWorks}
              aria-pressed={roadWorksOn}
              title={t.roadWorksActive(activeRoadWorksCount)}
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${roadWorksOn
                           ? 'bg-amber-400/[0.05] hover:bg-amber-400/[0.1]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleRoadWorks ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex justify-center text-[10px] leading-none w-[12px] shrink-0 ${roadWorksOn ? 'text-white/45' : 'text-white/40'}`}>{'⚠︎'}</span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(245,158,11,0.45) 0 1px, transparent 1px 3px)' }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                WORKS · 工程
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${roadWorksOn ? 'text-amber-300/80' : 'text-white/25'}`}>
                {activeRoadWorksCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${roadWorksOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {roadWorksOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* SCHOOLS — the row keeps the five columns of AIR/SEA/WORKS above
              it (glyph · swatch · label · count · state) and adds the bus
              groups' split interaction: the body expands the per-level rows,
              the ON/OFF button at the right is the whole-layer switch. No
              chevron — the rows below are the affordance. */}
          {schoolCount > 0 && (
            <>
              <div className={`flex items-stretch border-t border-white/10 transition
                              ${schoolsOn ? 'bg-violet-400/[0.05]' : 'opacity-50'}`}>
                <button
                  type="button"
                  onClick={() => setSchoolsLegendOpen(v => !v)}
                  aria-expanded={schoolsLegendOpen}
                  title={t.schoolsExpandTitle}
                  className="flex-1 min-w-0 flex items-center gap-2 py-1.5 pl-3 pr-1.5
                             hover:bg-violet-400/[0.1] transition"
                >
                  <span className={`inline-flex items-center justify-center w-[12px] shrink-0
                                    ${schoolsOn ? 'text-white/45' : 'text-white/40'}`}>
                    <MortarboardIcon />
                  </span>
                  <span
                    className="inline-block w-[8px] h-[8px] shrink-0"
                    style={{ backgroundImage: SCHOOL_HATCH }}
                  />
                  <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45
                                   flex-1 min-w-0 text-left truncate">
                    SCHOOLS · 學校
                  </span>
                  <span className={`mm-mono mm-tabular text-[9px] shrink-0
                                    ${schoolsOn ? 'text-violet-300/80' : 'text-white/25'}`}>
                    {schoolLevelsAllOn ? schoolCount : `${schoolEnabledCount}/${schoolCount}`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onToggleSchools}
                  disabled={!onToggleSchools}
                  aria-pressed={schoolsOn}
                  title={t.schoolsToggleAllTitle}
                  className={`shrink-0 inline-flex items-center justify-end pl-1.5 pr-3
                              hover:bg-emerald-300/[0.1] transition
                              ${onToggleSchools ? '' : 'cursor-default'}`}
                >
                  <span className={`mm-mono text-[8px] tracking-[0.2em] ${schoolsOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                    {schoolsOn ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
              {schoolsLegendOpen && (
                <div className={`pb-1 bg-violet-400/[0.05] ${schoolsOn ? '' : 'opacity-40'}`}>
                  {SCHOOL_LEVEL_ORDER.map(level => {
                    const on = isSchoolLevelOn(level)
                    // "Lit" = actually drawn on the map: the level is on AND
                    // the master switch is on.
                    const lit = schoolsOn && on
                    const color = SCHOOL_COLORS[level]
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => onToggleSchoolLevel?.(level)}
                        disabled={!onToggleSchoolLevel}
                        aria-pressed={on}
                        // The label truncates for the longest EN/PT wording
                        // ("K–12 (all-through)"), so keep it readable on hover.
                        title={schoolLevelLabel(t, level)}
                        className={`w-full flex items-center gap-2 py-1 pl-8 pr-3
                                    hover:bg-white/[0.04] transition
                                    ${onToggleSchoolLevel ? '' : 'cursor-default'}`}
                      >
                        <span
                          className="inline-block w-[7px] h-[7px] shrink-0"
                          style={on
                            ? { backgroundColor: color }
                            : { boxShadow: `inset 0 0 0 1px ${color}99` }}
                        />
                        <span className={`text-[10px] leading-[1.2] flex-1 min-w-0 text-left truncate
                                          ${on ? 'text-white/75' : 'text-white/30'}`}>
                          {schoolLevelLabel(t, level)}
                        </span>
                        <span className="mm-mono text-[7px] tracking-[0.18em] text-white/25 shrink-0">
                          {SCHOOL_LEVEL_CAPTIONS[level]}
                        </span>
                        <span
                          className={`mm-mono mm-tabular text-[9px] w-[18px] text-right shrink-0
                                      ${lit ? '' : 'text-white/25'}`}
                          style={lit ? { color } : undefined}
                        >
                          {levelCounts[level] ?? 0}
                        </span>
                        <span className={`mm-mono text-[8px] tracking-[0.2em] w-[20px] text-right shrink-0
                                          ${lit ? 'text-emerald-300/80' : 'text-white/25'}`}>
                          {on ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* PUBLIC TOILETS — toggleable, same five columns as AIR/SEA/WORKS.
              No collapsible body: the layer has no sub-filters, and the three
              marker variants are explained by the info panel, not a key. */}
          {toiletCount > 0 && (
            <button
              type="button"
              onClick={onToggleToilets}
              disabled={!onToggleToilets}
              aria-pressed={toiletsOn}
              title={t.toiletsCount(toiletCount)}
              className={`w-full px-3 py-1.5 flex items-center gap-2 transition border-t border-white/10
                         ${toiletsOn
                           ? 'bg-teal-400/[0.05] hover:bg-teal-400/[0.1]'
                           : 'hover:bg-white/[0.03] opacity-50'}
                         ${onToggleToilets ? '' : 'cursor-default'}`}
            >
              <span className={`inline-flex items-center justify-center w-[12px] shrink-0 ${toiletsOn ? 'text-white/45' : 'text-white/40'}`}>
                <ToiletIcon />
              </span>
              <span
                className="inline-block w-[8px] h-[8px] shrink-0"
                style={{ backgroundImage: TOILET_HATCH }}
              />
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                WC · 公廁
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${toiletsOn ? 'text-teal-300/80' : 'text-white/25'}`}>
                {toiletCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ml-1 ${toiletsOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {toiletsOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Mobile: 4-icon stack — LRT / BUS / AIR / SEA, below MapLibre +/- zoom
          controls. Uses top-[8rem] (visual ~154px) so it sits just under the
          MapLibre nav control (bottom ~141px visual) without overlap, and
          still leaves enough room above the bottom timeline for popovers on
          short viewports. */}
      <div className="mm-mode-stack mm-ui-scale absolute top-[8rem] right-[0.5rem] z-10 flex flex-col gap-1.5
                      sm:hidden">
        {/* LRT chip */}
        <button
          onClick={() => togglePanel('lrt')}
          aria-label={t.lrtLines}
          className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                     border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                     ${mobilePanel === 'lrt'
                       ? 'border-amber-300/60 text-amber-200'
                       : lrtActive > 0
                         ? 'border-amber-300/25 text-amber-200/80 hover:border-amber-300/50 active:scale-95'
                         : 'border-white/10 text-white/40 hover:border-white/25'}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="3" width="16" height="14" rx="2" />
            <path d="M4 11h16" />
            <path d="M12 3v8" />
            <path d="M8 21l2-4h4l2 4" />
          </svg>
        </button>

        {/* BUS chip */}
        <button
          onClick={() => togglePanel('bus')}
          aria-label={t.busRoutes}
          className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                     border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                     ${mobilePanel === 'bus'
                       ? 'border-emerald-300/60 text-emerald-200'
                       : 'border-emerald-300/25 text-emerald-200/80 hover:border-emerald-300/50 active:scale-95'}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 6v6" />
            <path d="M16 6v6" />
            <path d="M2 12h20" />
            <rect x="2" y="4" width="20" height="14" rx="3" />
            <circle cx="7" cy="20" r="1" />
            <circle cx="17" cy="20" r="1" />
          </svg>
        </button>

        {/* AIR chip */}
        {totalFlightCount > 0 && (
          <button
            onClick={() => togglePanel('air')}
            aria-label={t.flights}
            className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                       border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                       ${mobilePanel === 'air'
                         ? 'border-sky-300/60 text-sky-300'
                         : flightsOn
                           ? 'border-sky-300/25 text-sky-300/80 hover:border-sky-300/50 active:scale-95'
                           : 'border-white/10 text-white/40 hover:border-white/25'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
            </svg>
          </button>
        )}

        {/* SEA chip */}
        {totalFerryCount > 0 && (
          <button
            onClick={() => togglePanel('sea')}
            aria-label={t.ferries}
            className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                       border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                       ${mobilePanel === 'sea'
                         ? 'border-red-400/60 text-red-300'
                         : ferriesOn
                           ? 'border-red-400/25 text-red-300/80 hover:border-red-400/50 active:scale-95'
                           : 'border-white/10 text-white/40 hover:border-white/25'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="5" r="3" />
              <line x1="12" y1="22" x2="12" y2="8" />
              <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
            </svg>
          </button>
        )}

        {/* ROAD WORKS chip */}
        {totalRoadWorkCount > 0 && (
          <button
            onClick={() => togglePanel('works')}
            aria-label={t.roadWorks}
            className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                       border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                       ${mobilePanel === 'works'
                         ? 'border-amber-400/60 text-amber-300'
                         : roadWorksOn
                           ? 'border-amber-400/25 text-amber-300/80 hover:border-amber-400/50 active:scale-95'
                           : 'border-white/10 text-white/40 hover:border-white/25'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>
        )}

        {/* SCHOOLS chip */}
        {schoolCount > 0 && (
          <button
            onClick={() => togglePanel('schools')}
            aria-label={t.schools}
            className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                       border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                       ${mobilePanel === 'schools'
                         ? 'border-violet-400/60 text-violet-300'
                         : schoolsOn
                           ? 'border-violet-400/25 text-violet-300/80 hover:border-violet-400/50 active:scale-95'
                           : 'border-white/10 text-white/40 hover:border-white/25'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 10 12 5 2 10l10 5 10-5z" />
              <path d="M6 12.5V17c3.3 2.7 8.7 2.7 12 0v-4.5" />
              <line x1="22" y1="10" x2="22" y2="15" />
            </svg>
          </button>
        )}

        {/* TOILETS chip */}
        {toiletCount > 0 && (
          <button
            onClick={() => togglePanel('toilets')}
            aria-label={t.toilets}
            className={`w-9 h-9 flex items-center justify-center bg-[#0a0a0b]
                       border transition shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                       ${mobilePanel === 'toilets'
                         ? 'border-teal-400/60 text-teal-300'
                         : toiletsOn
                           ? 'border-teal-400/25 text-teal-300/80 hover:border-teal-400/50 active:scale-95'
                           : 'border-white/10 text-white/40 hover:border-white/25'}`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                 strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2.25" y="3" width="11.5" height="8.5" rx="1.5" />
              <path d="M5 6.25v2.5" /><path d="M5 8.75l1.25-1.5 1.25 1.5v-2.5" />
              <path d="M11 6.25h-1.25v2.5H11" />
              <path d="M8 11.5v2" />
            </svg>
          </button>
        )}
      </div>

      {/* Mobile centered modal for LRT/BUS/AIR/SEA. Rendered OUTSIDE the
          mm-ui-scale chip stack so CSS `zoom` on that ancestor doesn't
          trap `fixed` descendants — the modal must anchor to the viewport
          to dodge the MapLibre nav control (top-right) and the bottom
          timeline/speed bar simultaneously. The backdrop button closes
          on outside tap; stopPropagation on the panel keeps taps inside
          from bubbling up. */}
      {mobilePanel !== null && (
        <div className="sm:hidden fixed inset-0 z-40 flex items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setMobilePanel(null)}
            aria-label="close"
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />

          {/* LRT */}
          {mobilePanel === 'lrt' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[320px] max-h-[80dvh] bg-[#0b0b0c]
                         border border-amber-300/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)] flex flex-col"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber-300/80">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <rect x="4" y="3" width="16" height="14" rx="2" />
                    <path d="M4 11h16" /><path d="M12 3v8" />
                    <path d="M8 21l2-4h4l2 4" />
                  </svg>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(252,196,65,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">LRT · 輕軌</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">{lrtActive}/{lrtTotal}</span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0">
                {allLrtLines.map(line => {
                  const on = isLrtOn(line.id)
                  return (
                    <button
                      key={line.id}
                      type="button"
                      onClick={() => onToggleLrt?.(line.id)}
                      aria-pressed={on}
                      className={`w-full flex items-center gap-2 px-3 py-2 border-l-2 transition
                                 ${on
                                   ? 'border-amber-300/60 bg-amber-300/[0.04] active:bg-amber-300/[0.08]'
                                   : 'border-transparent active:bg-white/[0.04] opacity-40'}`}
                    >
                      <div className="w-3 h-[3px] shrink-0" style={{ backgroundColor: on ? line.color : '#555' }} />
                      <span className={`mm-han text-[12px] flex-1 text-left truncate
                                        ${on ? 'text-white/90' : 'text-white/40'}`}>
                        {localName(lang, line)}
                      </span>
                      <span className={`mm-mono text-[9px] tracking-[0.2em] shrink-0
                                        ${on ? 'text-emerald-300/80' : 'text-white/25'}`}>
                        {on ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* BUS */}
          {mobilePanel === 'bus' && visibleRoutes && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[340px] max-h-[80dvh] bg-[#0b0b0c]
                         border border-emerald-300/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)] flex flex-col"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-emerald-300/80">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M8 6v6" /><path d="M16 6v6" />
                    <path d="M2 12h20" />
                    <rect x="2" y="4" width="20" height="14" rx="3" />
                    <circle cx="7" cy="20" r="1" /><circle cx="17" cy="20" r="1" />
                  </svg>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(110,231,183,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">BUS · 巴士</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-emerald-300/80">
                    {visibleRoutes.size}<span className="text-white/30">/{busRoutes.length}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <div className="grid grid-cols-3 border-b border-white/8 shrink-0">
                <button
                  onClick={onResetAuto}
                  className={`px-1 py-1.5 mm-mono text-[10px] tracking-[0.1em] transition-colors text-center
                             ${isAutoMode
                               ? 'bg-emerald-300/10 text-emerald-200'
                               : 'text-white/45 active:text-white active:bg-white/5'}`}
                  style={isAutoMode ? { boxShadow: 'inset 0 -2px 0 rgba(110,231,183,0.7)' } : undefined}
                >
                  {t.autoByTime}
                </button>
                <button
                  onClick={onShowAll}
                  className="px-1 py-1.5 mm-mono text-[10px] tracking-[0.15em] text-white/45 active:text-white
                             active:bg-white/5 transition-colors text-center border-l border-white/8"
                >
                  {t.showAll}
                </button>
                <button
                  onClick={onHideAll}
                  className="px-1 py-1.5 mm-mono text-[10px] tracking-[0.15em] text-white/45 active:text-white
                             active:bg-white/5 transition-colors text-center border-l border-white/8"
                >
                  {t.hideAll}
                </button>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0">
                {GROUP_ORDER.map(groupKey => {
                  const routes = grouped.get(groupKey) || []
                  if (routes.length === 0) return null
                  const groupActive = routes.filter(r => visibleRoutes.has(r.id)).length
                  const eligibleInGroup = routes.filter(r => !(inactiveRoutes?.has(r.id) ?? false))
                  const groupOn = groupActive > 0
                  const collapsed = collapsedGroups.has(groupKey)
                  return (
                    <div key={groupKey} className="border-t border-white/5">
                      <div className="w-full flex items-stretch bg-white/[0.015]">
                        <button
                          type="button"
                          onClick={() => toggleGroupCollapse(groupKey)}
                          className="flex-1 min-w-0 px-2 py-1.5 flex items-center gap-2
                                     active:bg-white/[0.04] transition"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0
                                            ${groupActive > 0 ? 'bg-emerald-300' : 'bg-white/15'}`} />
                          <span className="mm-mono text-[10px] tracking-[0.2em] text-white/55 uppercase flex-1 text-left">
                            {t[GROUP_LABEL_KEYS[groupKey]]}
                          </span>
                          <span className="mm-mono mm-tabular text-[10px] text-white/35 w-10 text-right">
                            {groupActive}/{routes.length}
                          </span>
                          <span className="text-white/30 mm-mono text-[9px] w-3 text-center">
                            {collapsed ? '▸' : '▾'}
                          </span>
                        </button>
                        {onToggleGroup && eligibleInGroup.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onToggleGroup(groupKey)}
                            aria-pressed={groupOn}
                            className={`shrink-0 w-11 mm-mono text-[9px] tracking-[0.2em]
                                        border-l border-white/8 transition text-center
                                        ${groupOn
                                          ? 'text-emerald-300/80 active:bg-emerald-300/10'
                                          : 'text-white/30 active:bg-white/[0.05]'}`}
                          >
                            {groupOn ? 'ON' : 'OFF'}
                          </button>
                        )}
                      </div>
                      {!collapsed && (
                      <div className="bg-[#060607]">
                        {routes.map(route => {
                          const inactive = inactiveRoutes?.has(route.id) ?? false
                          const on = visibleRoutes.has(route.id)
                          return (
                            <button
                              key={route.id}
                              onClick={() => !inactive && onToggleRoute?.(route.id)}
                              disabled={inactive}
                              className={`w-full px-2 py-1 flex items-center gap-2 transition-colors
                                         ${inactive
                                           ? 'opacity-30 cursor-not-allowed'
                                           : on ? 'active:bg-white/[0.04]' : 'opacity-35'}`}
                            >
                              <span
                                className="mm-mono mm-tabular text-[11px] font-bold text-center shrink-0"
                                style={{
                                  width: 36,
                                  color: inactive ? '#444' : on ? route.color : '#555',
                                  textShadow: !inactive && on ? `0 0 6px ${route.color}66` : 'none',
                                  textDecoration: inactive ? 'line-through' : 'none',
                                }}
                              >
                                {route.name}
                              </span>
                              <span className={`text-[11px] flex-1 text-left truncate mm-han
                                                ${inactive ? 'text-white/25' : on ? 'text-white/75' : 'text-white/30'}`}>
                                {inactive
                                  ? t.noServiceToday
                                  : (lang !== 'en' && route.nameCn ? route.nameCn : '')}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* AIR */}
          {mobilePanel === 'air' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-sky-300/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sky-300/80">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                  </svg>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(125,211,252,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">AIR · 航班</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {flightsOn ? flightCount : 0}/{totalFlightCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleFlights}
                disabled={!onToggleFlights}
                aria-pressed={flightsOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${flightsOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleFlights ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={flightsOn ? 'text-sky-300' : 'text-white/40'}>✈</span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {flightCount} {t.flights}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${flightsOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {flightsOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}

          {/* SEA */}
          {mobilePanel === 'sea' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-red-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-red-300/85">
                  <span className="text-[12px] leading-none">{'\u2693\uFE0E'}</span>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(248,113,113,0.35) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">SEA · 船運</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {ferriesOn ? ferryCount : 0}/{totalFerryCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleFerries}
                disabled={!onToggleFerries}
                aria-pressed={ferriesOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${ferriesOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleFerries ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={ferriesOn ? 'text-red-400' : 'text-white/40'}>{'\u2693\uFE0E'}</span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {ferryCount} {t.ferries}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${ferriesOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {ferriesOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}

          {/* ROAD WORKS */}
          {mobilePanel === 'works' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-amber-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber-300/85">
                  <span className="text-[12px] leading-none">{'⚠︎'}</span>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(245,158,11,0.45) 0 1px, transparent 1px 3px)' }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">WORKS · 工程</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {roadWorksOn ? activeRoadWorksCount : 0}/{totalRoadWorkCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleRoadWorks}
                disabled={!onToggleRoadWorks}
                aria-pressed={roadWorksOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${roadWorksOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleRoadWorks ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={roadWorksOn ? 'text-amber-400' : 'text-white/40'}>{'⚠︎'}</span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.roadWorksActive(activeRoadWorksCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${roadWorksOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {roadWorksOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}

          {/* SCHOOLS */}
          {mobilePanel === 'schools' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-violet-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-violet-300/85">
                  <span className="text-[12px] leading-none">{'⌂'}</span>
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: SCHOOL_SWATCH_GRADIENT }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">SCHOOLS · 學校</span>
                </span>
                <button
                  type="button"
                  onClick={() => setMobilePanel(null)}
                  aria-label="close"
                  className="w-6 h-6 flex items-center justify-center leading-none
                             border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                >×</button>
              </div>
              <button
                type="button"
                onClick={onToggleSchools}
                disabled={!onToggleSchools}
                aria-pressed={schoolsOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${schoolsOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleSchools ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={schoolsOn ? 'text-violet-400' : 'text-white/40'}>{'⌂'}</span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.schoolsCount(schoolEnabledCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${schoolsOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {schoolsOn ? 'ON' : 'OFF'}
                </span>
              </button>
              {/* Per-level rows — same handlers as the desktop panel, at a
                  44px tap target. No chevron: the modal is always expanded. */}
              <div className={`pb-1 border-t border-white/10 ${schoolsOn ? '' : 'opacity-40'}`}>
                {SCHOOL_LEVEL_ORDER.map(level => {
                  const on = isSchoolLevelOn(level)
                  const lit = schoolsOn && on
                  const color = SCHOOL_COLORS[level]
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => onToggleSchoolLevel?.(level)}
                      disabled={!onToggleSchoolLevel}
                      aria-pressed={on}
                      title={schoolLevelLabel(t, level)}
                      className={`w-full h-11 flex items-center gap-2 px-3 active:bg-white/[0.04] transition
                                  ${onToggleSchoolLevel ? '' : 'cursor-default'}`}
                    >
                      <span
                        className="inline-block w-[9px] h-[9px] shrink-0"
                        style={on
                          ? { backgroundColor: color }
                          : { boxShadow: `inset 0 0 0 1px ${color}99` }}
                      />
                      <span className={`text-[12px] leading-[1.2] flex-1 min-w-0 text-left truncate
                                        ${on ? 'text-white/75' : 'text-white/30'}`}>
                        {schoolLevelLabel(t, level)}
                      </span>
                      <span
                        className={`mm-mono mm-tabular text-[11px] w-6 text-right shrink-0
                                    ${lit ? '' : 'text-white/25'}`}
                        style={lit ? { color } : undefined}
                      >
                        {levelCounts[level] ?? 0}
                      </span>
                      <span className={`mm-mono text-[10px] tracking-[0.2em] w-8 text-right shrink-0
                                        ${lit ? 'text-emerald-300' : 'text-white/25'}`}>
                        {on ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* TOILETS */}
          {mobilePanel === 'toilets' && (
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-[300px] bg-[#0b0b0c]
                         border border-teal-400/30 rounded-sm overflow-hidden
                         shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-teal-300/85">
                  <ToiletIcon />
                  <span
                    className="inline-block w-[8px] h-[8px]"
                    style={{ backgroundImage: TOILET_HATCH }}
                  />
                  <span className="mm-mono text-[10px] tracking-[0.25em]">WC · 公廁</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="mm-mono mm-tabular text-[9px] text-white/30">
                    {toiletsOn ? toiletCount : 0}/{toiletCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobilePanel(null)}
                    aria-label="close"
                    className="w-6 h-6 flex items-center justify-center leading-none
                               border border-white/15 text-white/60 active:bg-white/10 mm-mono text-[16px]"
                  >×</button>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleToilets}
                disabled={!onToggleToilets}
                aria-pressed={toiletsOn}
                className={`w-full px-3 py-3 flex items-center justify-between transition
                           ${toiletsOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                           ${onToggleToilets ? '' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={toiletsOn ? 'text-teal-400' : 'text-white/40'}>
                    <ToiletIcon />
                  </span>
                  <span className="mm-mono mm-tabular text-[12px] text-white/80">
                    {t.toiletsCount(toiletCount)}
                  </span>
                </span>
                <span className={`mm-mono text-[10px] tracking-[0.2em] ${toiletsOn ? 'text-emerald-300' : 'text-white/25'}`}>
                  {toiletsOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
