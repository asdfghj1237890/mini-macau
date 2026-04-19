import { useState, useMemo, useEffect } from 'react'
import type { TransitData, SimulationClock } from '../types'
import { useI18n, localName } from '../i18n'
import { getRouteGroup, GROUP_ORDER, GROUP_LABEL_KEYS } from '../routeGroups'

const LS_DESKTOP_OPEN = 'mm-layers-desktop-open'
const LS_DESKTOP_COLLAPSED_GROUPS = 'mm-layers-collapsed-groups'

interface Props {
  transitData: TransitData
  allTransitData?: TransitData
  visibleRoutes?: Set<string>
  isAutoMode?: boolean
  lrtOn?: Set<string>
  flightsOn?: boolean
  clock?: SimulationClock
  onToggleLrt?: (id: string) => void
  onToggleFlights?: () => void
  onToggleRoute?: (routeId: string) => void
  onToggleAll?: () => void
  onShowAll?: () => void
  onHideAll?: () => void
  onResetAuto?: () => void
}

type MobilePanel = 'lrt' | 'bus' | 'air' | null

export function LineLegend({
  transitData,
  allTransitData,
  visibleRoutes,
  isAutoMode,
  lrtOn,
  flightsOn = true,
  clock,
  onToggleLrt,
  onToggleFlights,
  onToggleRoute,
  onShowAll,
  onHideAll,
  onResetAuto,
}: Props) {
  const { lang, t } = useI18n()
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null)
  const [desktopOpen, setDesktopOpen] = useState(() => {
    try { return localStorage.getItem(LS_DESKTOP_OPEN) !== '0' } catch { return true }
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
    localStorage.setItem(LS_DESKTOP_COLLAPSED_GROUPS, JSON.stringify([...collapsedGroups]))
  }, [collapsedGroups])

  const toggleGroupCollapse = (g: string) => setCollapsedGroups(prev => {
    const next = new Set(prev)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    return next
  })

  const busRoutes = allTransitData?.busRoutes ?? []
  const allLrtLines = allTransitData?.lrtLines ?? transitData.lrtLines
  const grouped = useMemo(() => {
    const groups = new Map<typeof GROUP_ORDER[number], typeof busRoutes>()
    for (const g of GROUP_ORDER) groups.set(g, [])
    for (const route of busRoutes) {
      groups.get(getRouteGroup(route))!.push(route)
    }
    return groups
  }, [busRoutes])

  if (transitData.loading) {
    return (
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md rounded-sm
                      px-3 py-2 border border-white/10 text-amber-300/80
                      mm-mono text-[10px] tracking-[0.25em]
                      max-sm:hidden landscape:hidden">
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

  const isLrtOn = (id: string) => (lrtOn ? lrtOn.has(id) : true)
  const isLive = clock
    ? !clock.paused && clock.speed === 1 && Math.abs(clock.currentTime.getTime() - Date.now()) < 3000
    : true

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
                {isLive ? 'LIVE' : 'SIM'}
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
                <span className="mm-mono text-[8px] tracking-[0.25em]">░ LRT · 輕軌</span>
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
                  <span className="mm-mono text-[8px] tracking-[0.25em]">░ BUS · 巴士</span>
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
                  const collapsed = collapsedGroups.has(groupKey)
                  return (
                    <div key={groupKey} className="border-t border-white/5">
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapse(groupKey)}
                        className="w-full px-2 py-1 flex items-center gap-2 bg-white/[0.015]
                                   hover:bg-white/[0.04] transition"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0
                                          ${groupActive > 0 ? 'bg-amber-300' : 'bg-white/15'}`}
                              style={groupActive > 0 ? { boxShadow: '0 0 5px rgba(252,196,65,0.8)' } : undefined} />
                        <span className="mm-mono text-[9px] tracking-[0.2em] text-white/55 uppercase flex-1 text-left">
                          {t[GROUP_LABEL_KEYS[groupKey]]}
                        </span>
                        <span className="mm-mono mm-tabular text-[9px] text-white/35">
                          {groupActive}/{routes.length}
                        </span>
                        <span className="text-white/30 mm-mono text-[8px] w-3 text-center">
                          {collapsed ? '▸' : '▾'}
                        </span>
                      </button>
                      {!collapsed && (
                        <div className="bg-[#060607]">
                          {routes.map(route => {
                            const on = visibleRoutes.has(route.id)
                            return (
                              <button
                                key={route.id}
                                onClick={() => onToggleRoute?.(route.id)}
                                className={`w-full px-2 py-[3px] flex items-center gap-2 transition-colors
                                           ${on ? 'hover:bg-white/[0.04]' : 'opacity-35 hover:opacity-60'}`}
                              >
                                <span
                                  className="mm-mono mm-tabular text-[10px] font-bold text-center shrink-0"
                                  style={{
                                    width: 36,
                                    color: on ? route.color : '#555',
                                    textShadow: on ? `0 0 6px ${route.color}66` : 'none',
                                  }}
                                >
                                  {route.name}
                                </span>
                                <span className={`text-[10px] flex-1 text-left truncate mm-han
                                                  ${on ? 'text-white/75' : 'text-white/30'}`}>
                                  {lang !== 'en' && route.nameCn ? route.nameCn : ''}
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
              <span className={`text-[10px] leading-none ${flightsOn ? 'text-sky-300' : 'text-white/40'}`}>✈</span>
              <span className="mm-mono text-[8px] tracking-[0.25em] text-white/45 flex-1 text-left">
                ░ AIR · 航班
              </span>
              <span className={`mm-mono mm-tabular text-[9px] ${flightsOn ? 'text-sky-300/80' : 'text-white/25'}`}>
                {flightCount}
              </span>
              <span className={`mm-mono text-[8px] tracking-[0.2em] ${flightsOn ? 'text-emerald-300/80' : 'text-white/25'}`}>
                {flightsOn ? 'ON' : 'OFF'}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Mobile: 3-icon stack — LRT / BUS / AIR, below map +/- zoom controls */}
      <div className="mm-ui-scale absolute top-[9rem] right-[0.5rem] z-10 flex flex-col gap-1.5
                      sm:hidden landscape:top-[6rem]">
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
            <span className="text-[14px] leading-none">✈</span>
          </button>
        )}

        {/* LRT popover */}
        {mobilePanel === 'lrt' && (
          <div className="absolute top-full right-0 mt-2 bg-[#0b0b0c] backdrop-blur-md
                          border border-amber-300/25 rounded-sm overflow-hidden
                          shadow-[0_8px_24px_rgba(0,0,0,0.6)] w-48 max-w-[calc(100vw-5rem)]">
            <div className="px-3 py-1.5 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-amber-300/75">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <rect x="4" y="3" width="16" height="14" rx="2" />
                  <path d="M4 11h16" /><path d="M12 3v8" />
                  <path d="M8 21l2-4h4l2 4" />
                </svg>
                <span
                  className="inline-block w-[8px] h-[8px]"
                  style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(252,196,65,0.35) 0 1px, transparent 1px 3px)' }}
                />
                <span className="mm-mono text-[9px] tracking-[0.25em]">LRT · 輕軌</span>
              </span>
              <span className="mm-mono mm-tabular text-[8px] text-white/30">{lrtActive}/{lrtTotal}</span>
            </div>
            <div className="py-0.5">
              {allLrtLines.map(line => {
                const on = isLrtOn(line.id)
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => onToggleLrt?.(line.id)}
                    aria-pressed={on}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 border-l-2 transition
                               ${on
                                 ? 'border-amber-300/60 bg-amber-300/[0.04] active:bg-amber-300/[0.08]'
                                 : 'border-transparent active:bg-white/[0.04] opacity-40'}`}
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
        )}

        {/* BUS popover */}
        {mobilePanel === 'bus' && visibleRoutes && (
          <div className="absolute top-full right-0 mt-2 bg-[#0b0b0c] backdrop-blur-md
                          border border-emerald-300/25 rounded-sm overflow-hidden
                          shadow-[0_8px_24px_rgba(0,0,0,0.6)] w-[220px] max-w-[calc(100vw-5rem)]">
            <div className="px-3 py-1.5 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-emerald-300/75">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
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
                <span className="mm-mono text-[9px] tracking-[0.25em]">BUS · 巴士</span>
              </span>
              <span className="mm-mono mm-tabular text-[8px] text-emerald-300/80">
                {visibleRoutes.size}<span className="text-white/30">/{busRoutes.length}</span>
              </span>
            </div>
            <div className="grid grid-cols-3 border-b border-white/8">
              <button
                onClick={onResetAuto}
                className={`px-1 py-1 mm-mono text-[9px] tracking-[0.1em] transition-colors text-center
                           ${isAutoMode
                             ? 'bg-emerald-300/10 text-emerald-200'
                             : 'text-white/45 hover:text-white hover:bg-white/5'}`}
                style={isAutoMode ? { boxShadow: 'inset 0 -2px 0 rgba(110,231,183,0.7)' } : undefined}
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
            <div className="max-h-[55vh] overflow-y-auto">
              {GROUP_ORDER.map(groupKey => {
                const routes = grouped.get(groupKey) || []
                if (routes.length === 0) return null
                const groupActive = routes.filter(r => visibleRoutes.has(r.id)).length
                return (
                  <div key={groupKey} className="border-t border-white/5">
                    <div className="px-2 py-1 flex items-center gap-2 bg-white/[0.015]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0
                                        ${groupActive > 0 ? 'bg-emerald-300' : 'bg-white/15'}`} />
                      <span className="mm-mono text-[9px] tracking-[0.2em] text-white/55 uppercase flex-1 text-left">
                        {t[GROUP_LABEL_KEYS[groupKey]]}
                      </span>
                      <span className="mm-mono mm-tabular text-[9px] text-white/35">
                        {groupActive}/{routes.length}
                      </span>
                    </div>
                    <div className="bg-[#060607]">
                      {routes.map(route => {
                        const on = visibleRoutes.has(route.id)
                        return (
                          <button
                            key={route.id}
                            onClick={() => onToggleRoute?.(route.id)}
                            className={`w-full px-2 py-[3px] flex items-center gap-2 transition-colors
                                       ${on ? 'hover:bg-white/[0.04]' : 'opacity-35'}`}
                          >
                            <span
                              className="mm-mono mm-tabular text-[10px] font-bold text-center shrink-0"
                              style={{
                                width: 34,
                                color: on ? route.color : '#555',
                                textShadow: on ? `0 0 6px ${route.color}66` : 'none',
                              }}
                            >
                              {route.name}
                            </span>
                            <span className={`text-[10px] flex-1 text-left truncate mm-han
                                              ${on ? 'text-white/75' : 'text-white/30'}`}>
                              {lang !== 'en' && route.nameCn ? route.nameCn : ''}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* AIR popover */}
        {mobilePanel === 'air' && (
          <div className="absolute top-full right-0 mt-2 bg-[#0b0b0c] backdrop-blur-md
                          border border-sky-300/25 rounded-sm overflow-hidden
                          shadow-[0_8px_24px_rgba(0,0,0,0.6)] w-52 max-w-[calc(100vw-5rem)]">
            <div className="px-3 py-1.5 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sky-300/75">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                </svg>
                <span
                  className="inline-block w-[8px] h-[8px]"
                  style={{ backgroundImage: 'repeating-linear-gradient(-45deg, rgba(125,211,252,0.35) 0 1px, transparent 1px 3px)' }}
                />
                <span className="mm-mono text-[9px] tracking-[0.25em]">AIR · 航班</span>
              </span>
              <span className="mm-mono mm-tabular text-[8px] text-white/30">
                {flightsOn ? flightCount : 0}/{totalFlightCount}
              </span>
            </div>
            <button
              type="button"
              onClick={onToggleFlights}
              disabled={!onToggleFlights}
              aria-pressed={flightsOn}
              className={`w-full px-3 py-2.5 flex items-center justify-between transition
                         ${flightsOn ? 'active:bg-white/[0.04]' : 'active:bg-white/[0.04] opacity-60'}
                         ${onToggleFlights ? '' : 'cursor-default'}`}
            >
              <span className="flex items-center gap-2">
                <span className={flightsOn ? 'text-sky-300' : 'text-white/40'}>✈</span>
                <span className="mm-mono mm-tabular text-[11px] text-white/80">
                  {flightCount} {t.flights}
                </span>
              </span>
              <span className={`mm-mono text-[9px] tracking-[0.2em] ${flightsOn ? 'text-emerald-300' : 'text-white/25'}`}>
                {flightsOn ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        )}
      </div>
    </>
  )
}
