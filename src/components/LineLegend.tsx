import { useState, useMemo } from 'react'
import type { TransitData } from '../types'
import { useI18n, localName } from '../i18n'
import { getRouteGroup, GROUP_ORDER, GROUP_LABEL_KEYS } from './RouteSelector'

interface Props {
  transitData: TransitData
  allTransitData?: TransitData
  visibleRoutes?: Set<string>
  isAutoMode?: boolean
  onToggleRoute?: (routeId: string) => void
  onToggleAll?: () => void
  onResetAuto?: () => void
}

type MobilePanel = 'lrt' | 'bus' | null

export function LineLegend({ transitData, allTransitData, visibleRoutes, isAutoMode, onToggleRoute, onToggleAll, onResetAuto }: Props) {
  const { lang, t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null)

  const busRoutes = allTransitData?.busRoutes ?? []
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
      <div className="absolute top-28 right-4 bg-black/70 backdrop-blur-sm rounded-xl z-10
                      px-4 py-3 border border-white/20 text-white/60 text-sm
                      max-sm:hidden landscape:hidden">
        {t.loading}
      </div>
    )
  }

  const toggleMobile = (panel: 'lrt' | 'bus') =>
    setMobilePanel(prev => (prev === panel ? null : panel))

  return (
    <>
      {/* Desktop: original expandable panel */}
      <div className="absolute top-28 right-4 bg-black/70 backdrop-blur-sm rounded-xl z-10
                      border border-white/20 hidden sm:block landscape:hidden">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full px-4 py-2
                     text-white/80 text-xs font-semibold uppercase tracking-wider
                     flex items-center justify-between gap-2
                     hover:bg-white/10 transition-colors rounded-xl"
        >
          <span>{t.lrtLines}</span>
          <span className="text-white/40 text-[10px]">{collapsed ? '▼' : '▲'}</span>
        </button>

        {!collapsed && (
          <div className="px-4 pb-3 max-h-[60vh] overflow-y-auto">
            {transitData.lrtLines.map(line => (
              <div key={line.id} className="flex items-center gap-2 py-0.5">
                <div
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: line.color }}
                />
                <span className="text-white text-sm">
                  {localName(lang, line)}
                </span>
              </div>
            ))}
            {transitData.busRoutes.length > 0 && (
              <>
                <div className="text-white/80 text-xs font-semibold uppercase tracking-wider mt-3 mb-2">
                  {t.busRoutes}
                </div>
                <div className="text-white/50 text-xs">
                  {t.routesActive(transitData.busRoutes.length)}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Mobile: two square icon buttons stacked vertically, left of MapLibre +/- */}
      <div className="absolute top-2 right-[3.25rem] z-10 flex flex-col gap-1.5
                      sm:hidden landscape:top-2">
        {/* LRT button */}
        <button
          onClick={() => toggleMobile('lrt')}
          aria-label={t.lrtLines}
          className={`w-9 h-9 flex items-center justify-center rounded-lg
                     backdrop-blur-sm border transition
                     ${mobilePanel === 'lrt'
                       ? 'bg-white/20 border-white/40 text-white'
                       : 'bg-black/70 border-white/20 text-white/80 hover:bg-black/90 active:scale-95'}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="3" width="16" height="14" rx="2" />
            <path d="M4 11h16" />
            <path d="M12 3v8" />
            <path d="M8 21l2-4h4l2 4" />
          </svg>
        </button>

        {/* Bus button */}
        <button
          onClick={() => toggleMobile('bus')}
          aria-label={t.busRoutes}
          className={`w-9 h-9 flex items-center justify-center rounded-lg
                     backdrop-blur-sm border transition
                     ${mobilePanel === 'bus'
                       ? 'bg-white/20 border-white/40 text-white'
                       : 'bg-black/70 border-white/20 text-white/80 hover:bg-black/90 active:scale-95'}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 6v6" />
            <path d="M16 6v6" />
            <path d="M2 12h20" />
            <rect x="2" y="4" width="20" height="14" rx="3" />
            <circle cx="7" cy="20" r="1" />
            <circle cx="17" cy="20" r="1" />
          </svg>
        </button>

        {/* Dropdown panel for LRT */}
        {mobilePanel === 'lrt' && (
          <div className="absolute top-0 right-11 bg-black/80 backdrop-blur-sm rounded-xl
                          border border-white/20 p-3 max-h-[60vh] overflow-y-auto w-40">
            <div className="text-white/80 text-[10px] font-semibold uppercase tracking-wider mb-1.5">
              {t.lrtLines}
            </div>
            {transitData.lrtLines.map(line => (
              <div key={line.id} className="flex items-center gap-2 py-0.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: line.color }}
                />
                <span className="text-white text-xs">
                  {localName(lang, line)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Dropdown panel for Bus — full route selector */}
        {mobilePanel === 'bus' && visibleRoutes && (
          <div className="absolute top-10 right-0 bg-black/80 backdrop-blur-sm rounded-xl
                          border border-white/20 overflow-hidden w-52">
            <div className="flex border-b border-white/10">
              <button
                onClick={onResetAuto}
                className={`flex-1 px-2 py-1.5 text-xs transition-colors text-center
                           ${isAutoMode ? 'text-blue-400' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
              >
                {t.autoByTime}
              </button>
              <button
                onClick={onToggleAll}
                className="flex-1 px-2 py-1.5 text-xs text-white/50 hover:text-white
                           hover:bg-white/10 transition-colors text-center"
              >
                {visibleRoutes.size === busRoutes.length ? t.hideAll : t.showAll}
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {GROUP_ORDER.map(groupKey => {
                const routes = grouped.get(groupKey) || []
                if (routes.length === 0) return null
                return (
                  <div key={groupKey}>
                    <div className="px-3 py-1 text-[10px] text-white/40 uppercase tracking-wider
                                    bg-white/5 border-t border-white/10">
                      {t[GROUP_LABEL_KEYS[groupKey]]}
                    </div>
                    {routes.map(route => (
                      <button
                        key={route.id}
                        onClick={() => onToggleRoute?.(route.id)}
                        className={`w-full px-3 py-0.5 text-xs flex items-center gap-2 transition-colors
                                   hover:bg-white/10 ${visibleRoutes.has(route.id) ? 'text-white' : 'text-white/30'}`}
                      >
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: visibleRoutes.has(route.id) ? route.color : '#555',
                          }}
                        />
                        <span className="truncate">
                          {route.name}
                          {lang !== 'en' && route.nameCn ? ` ${route.nameCn}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
