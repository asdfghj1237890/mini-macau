import { useMemo } from 'react'
import type { TransitData, BusRoute } from '../types'
import { useI18n } from '../i18n'
import { type GroupKey, getRouteGroup, GROUP_ORDER, GROUP_LABEL_KEYS } from '../routeGroups'

interface Props {
  transitData: TransitData
  visibleRoutes: Set<string>
  isAutoMode: boolean
  onToggleRoute: (routeId: string) => void
  onShowAll: () => void
  onHideAll: () => void
  onResetAuto: () => void
}

export function RouteSelector({
  transitData,
  visibleRoutes,
  isAutoMode,
  onToggleRoute,
  onShowAll,
  onHideAll,
  onResetAuto,
}: Props) {
  const { t, lang } = useI18n()

  const grouped = useMemo(() => {
    const groups = new Map<GroupKey, BusRoute[]>()
    for (const g of GROUP_ORDER) groups.set(g, [])
    for (const route of transitData.busRoutes) {
      const g = getRouteGroup(route)
      groups.get(g)!.push(route)
    }
    return groups
  }, [transitData.busRoutes])

  if (transitData.busRoutes.length === 0) return null

  const activeCount = visibleRoutes.size
  const totalCount = transitData.busRoutes.length

  return (
    <div className="absolute top-[16rem] right-[10px] z-10
                    bg-[#0b0b0c]/95 backdrop-blur-md rounded-sm
                    border border-white/10 overflow-hidden w-[240px]
                    max-sm:hidden landscape:hidden shadow-2xl">
      {/* Header */}
      <div className="px-3 py-1 flex items-center justify-between bg-white/[0.015] border-b border-white/5">
        <span className="mm-mono text-[9px] tracking-[0.28em] text-amber-300/75">
          ░ {t.busRoutes.toUpperCase()} · 巴士
        </span>
        <span className="mm-mono mm-tabular text-[9px] text-emerald-300/80">
          {activeCount}<span className="text-white/30">/{totalCount}</span>
        </span>
      </div>

      {/* Mode tabs — AUTO / ALL / NONE */}
      <div className="grid grid-cols-3 border-y border-white/8">
        <button
          onClick={onResetAuto}
          className={`px-1 py-1.5 mm-mono text-[9px] tracking-[0.12em] transition-colors text-center
                     ${isAutoMode
                        ? 'bg-amber-300/10 text-amber-200'
                        : 'text-white/45 hover:text-white hover:bg-white/5'}`}
          style={isAutoMode ? { boxShadow: 'inset 0 -2px 0 rgba(252,196,65,0.7)' } : undefined}
        >
          {t.autoByTime}
        </button>
        <button
          onClick={onShowAll}
          className="px-1 py-1.5 mm-mono text-[9px] tracking-[0.15em] text-white/45 hover:text-white
                     hover:bg-white/5 transition-colors text-center border-l border-white/8"
        >
          {t.showAll}
        </button>
        <button
          onClick={onHideAll}
          className="px-1 py-1.5 mm-mono text-[9px] tracking-[0.15em] text-white/45 hover:text-white
                     hover:bg-white/5 transition-colors text-center border-l border-white/8"
        >
          {t.hideAll}
        </button>
      </div>

      {/* Route list */}
      <div className="max-h-[45vh] overflow-y-auto">
        {GROUP_ORDER.map(groupKey => {
          const routes = grouped.get(groupKey) || []
          if (routes.length === 0) return null
          const groupActive = routes.filter(r => visibleRoutes.has(r.id)).length
          return (
            <div key={groupKey} className="border-t border-white/5">
              <div className="px-2 py-1 flex items-center gap-2 bg-white/[0.015]">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0
                                  ${groupActive > 0 ? 'bg-amber-300' : 'bg-white/15'}`}
                      style={groupActive > 0 ? { boxShadow: '0 0 5px rgba(252,196,65,0.8)' } : undefined} />
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
                      onClick={() => onToggleRoute(route.id)}
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
