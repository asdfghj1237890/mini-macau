import { useState, useMemo } from 'react'
import type { TransitData, BusRoute } from '../types'
import { useI18n } from '../i18n'

interface Props {
  transitData: TransitData
  visibleRoutes: Set<string>
  isAutoMode: boolean
  onToggleRoute: (routeId: string) => void
  onToggleAll: () => void
  onResetAuto: () => void
}

const NIGHT_ROUTES = new Set(['N1A', 'N1B', 'N2', 'N3', 'N5', 'N6'])
const TAIPA_COTAI_ROUTES = new Set([
  'MT1', 'MT2', 'MT3', 'MT4', 'MT5',
  '11', '15', '50', '50B', '51', '51A', '51X', '52', '55', '56', '59',
  '35', '36', '37', '39', '71', '71S', '72', '73',
])
const SPECIAL_ROUTES = new Set([
  'AP1', 'AP1X', 'H1', 'H2', 'H3', '701X', '701XS', '101', '102', '103',
])
const CROSS_HARBOUR_ROUTES = new Set([
  '21A', '22', '25', '25AX', '25B', '25BS', '26', '26A', '27',
  '28A', '28B', '28C', '29', '30', '30X', '32', '33', '34',
  '60', '61', '65',
])

type GroupKey = 'peninsula' | 'crossHarbour' | 'taipaCotai' | 'night' | 'special'

function getRouteGroup(route: BusRoute): GroupKey {
  const id = route.id
  if (NIGHT_ROUTES.has(id)) return 'night'
  if (SPECIAL_ROUTES.has(id)) return 'special'
  if (TAIPA_COTAI_ROUTES.has(id)) return 'taipaCotai'
  if (CROSS_HARBOUR_ROUTES.has(id)) return 'crossHarbour'
  return 'peninsula'
}

const GROUP_ORDER: GroupKey[] = ['peninsula', 'crossHarbour', 'taipaCotai', 'night', 'special']
const GROUP_LABEL_KEYS: Record<GroupKey, 'groupPeninsula' | 'groupCrossHarbour' | 'groupTaipaCotai' | 'groupNight' | 'groupSpecial'> = {
  peninsula: 'groupPeninsula',
  crossHarbour: 'groupCrossHarbour',
  taipaCotai: 'groupTaipaCotai',
  night: 'groupNight',
  special: 'groupSpecial',
}

export function RouteSelector({ transitData, visibleRoutes, isAutoMode, onToggleRoute, onToggleAll, onResetAuto }: Props) {
  const [expanded, setExpanded] = useState(false)
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
    <div className="absolute top-[20rem] right-4 bg-black/70 backdrop-blur-sm rounded-xl z-10
                    border border-white/20 overflow-hidden max-w-[220px]">
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
