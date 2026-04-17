import { useState, useMemo } from 'react'
import type { TransitData, BusRoute } from '../types'
import { useI18n } from '../i18n'
import { type GroupKey, getRouteGroup, GROUP_ORDER, GROUP_LABEL_KEYS } from '../routeGroups'

interface Props {
  transitData: TransitData
  visibleRoutes: Set<string>
  isAutoMode: boolean
  onToggleRoute: (routeId: string) => void
  onToggleAll: () => void
  onResetAuto: () => void
}

export function RouteSelector({ transitData, visibleRoutes, isAutoMode, onToggleRoute, onToggleAll, onResetAuto }: Props) {
  const [expanded, setExpanded] = useState(true)
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

  const allVisible = visibleRoutes.size === transitData.busRoutes.length

  return (
    <div className="absolute top-[16rem] right-[10px] bg-black/70 backdrop-blur-sm rounded-xl z-10
                    border border-white/20 overflow-hidden max-w-[220px]
                    max-sm:hidden landscape:hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-2 text-white text-sm flex items-center justify-center gap-1.5
                   hover:bg-white/10 transition-colors"
      >
        <span>{t.busRoutes}</span>
        <span className="text-white/40 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-white/10">
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
              {allVisible ? t.hideAll : t.showAll}
            </button>
          </div>
          <div className="max-h-[45vh] overflow-y-auto">
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
                      onClick={() => onToggleRoute(route.id)}
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
  )
}
