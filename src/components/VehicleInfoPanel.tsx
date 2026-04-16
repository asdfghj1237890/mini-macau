import type { VehiclePosition, TransitData } from '../types'
import { useI18n } from '../i18n'

interface Props {
  vehicle: VehiclePosition | null
  transitData: TransitData
  onClose: () => void
}

export function VehicleInfoPanel({ vehicle, transitData, onClose }: Props) {
  const { lang, t } = useI18n()

  if (!vehicle) return null

  const line = vehicle.type === 'lrt'
    ? transitData.lrtLines.find(l => l.id === vehicle.lineId)
    : null
  const route = vehicle.type === 'bus'
    ? transitData.busRoutes.find(r => r.id === vehicle.lineId)
    : null

  const name = lang === 'zh'
    ? (line?.nameCn ?? (route ? `${t.route} ${route.name}` : vehicle.lineId))
    : (line?.name ?? (route ? `Route ${route.name}` : vehicle.lineId))

  return (
    <div className="absolute top-20 left-4 bg-black/80 backdrop-blur-sm rounded-xl z-10
                    px-4 py-3 border border-white/20 min-w-[200px] max-w-[280px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: vehicle.color }}
          />
          <span className="text-white font-semibold text-sm">{name}</span>
        </div>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-sm transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="space-y-1 text-xs text-white/70">
        <div className="flex justify-between">
          <span>{t.type}</span>
          <span className="text-white">{vehicle.type === 'lrt' ? t.lrt : t.bus}</span>
        </div>
        <div className="flex justify-between">
          <span>ID</span>
          <span className="text-white font-mono">{vehicle.id}</span>
        </div>
        <div className="flex justify-between">
          <span>{t.position}</span>
          <span className="text-white font-mono">
            {vehicle.coordinates[1].toFixed(4)}, {vehicle.coordinates[0].toFixed(4)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>{t.bearing}</span>
          <span className="text-white">{vehicle.bearing.toFixed(0)}°</span>
        </div>
        {line && (
          <div className="mt-2 pt-2 border-t border-white/10">
            <div className="text-white/50 text-xs mb-1">{t.stations}</div>
            <div className="flex flex-wrap gap-1">
              {line.stations.map(sid => {
                const station = transitData.stations.find(s => s.id === sid)
                const label = lang === 'zh' ? (station?.nameCn ?? sid) : (station?.name ?? sid)
                return (
                  <span
                    key={sid}
                    className="bg-white/10 rounded px-1.5 py-0.5 text-[10px] text-white/80"
                  >
                    {label}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
