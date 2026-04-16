import { useState } from 'react'
import type { TransitData } from '../types'
import { useI18n } from '../i18n'

interface Props {
  transitData: TransitData
  visibleRoutes: Set<string>
  onToggleRoute: (routeId: string) => void
  onToggleAll: () => void
}

export function RouteSelector({ transitData, visibleRoutes, onToggleRoute, onToggleAll }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { t } = useI18n()

  if (transitData.busRoutes.length === 0) return null

  const allVisible = visibleRoutes.size === transitData.busRoutes.length

  return (
    <div className="absolute bottom-20 right-4 bg-black/70 backdrop-blur-sm rounded-xl z-10
                    border border-white/20 overflow-hidden max-w-[200px]">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-2 text-white text-sm flex items-center justify-between
                   hover:bg-white/10 transition-colors"
      >
        <span>{t.busRoutes}</span>
        <span className="text-white/40 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-white/10">
          <button
            onClick={onToggleAll}
            className="w-full px-4 py-1.5 text-xs text-white/60 hover:text-white
                       hover:bg-white/10 transition-colors text-left"
          >
            {allVisible ? t.hideAll : t.showAll}
          </button>
          <div className="max-h-[40vh] overflow-y-auto">
            {transitData.busRoutes.map(route => (
              <button
                key={route.id}
                onClick={() => onToggleRoute(route.id)}
                className={`w-full px-4 py-1 text-sm flex items-center gap-2 transition-colors
                           hover:bg-white/10 ${visibleRoutes.has(route.id) ? 'text-white' : 'text-white/30'}`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: visibleRoutes.has(route.id) ? route.color : '#555',
                  }}
                />
                <span>{t.route} {route.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
