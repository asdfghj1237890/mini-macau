import type { TransitData } from '../types'
import { useI18n } from '../i18n'

interface Props {
  transitData: TransitData
}

export function LineLegend({ transitData }: Props) {
  const { lang, t } = useI18n()

  if (transitData.loading) {
    return (
      <div className="absolute top-14 right-4 bg-black/70 backdrop-blur-sm rounded-xl z-10
                      px-4 py-3 border border-white/20 text-white/60 text-sm">
        {t.loading}
      </div>
    )
  }

  return (
    <div className="absolute top-14 right-4 bg-black/70 backdrop-blur-sm rounded-xl z-10
                    px-4 py-3 border border-white/20 max-h-[60vh] overflow-y-auto">
      <div className="text-white/80 text-xs font-semibold uppercase tracking-wider mb-2">
        {t.lrtLines}
      </div>
      {transitData.lrtLines.map(line => (
        <div key={line.id} className="flex items-center gap-2 py-0.5">
          <div
            className="w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: line.color }}
          />
          <span className="text-white text-sm">
            {lang === 'zh' ? line.nameCn : line.name}
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
  )
}
