import type { SimulationClock } from '../types'
import { useI18n } from '../i18n'

interface Props {
  clock: SimulationClock
  vehicleCount?: number
}

export function TimeDisplay({ clock, vehicleCount }: Props) {
  const { t } = useI18n()
  const time = clock.currentTime
  const h = String(time.getHours()).padStart(2, '0')
  const m = String(time.getMinutes()).padStart(2, '0')
  const s = String(time.getSeconds()).padStart(2, '0')

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm z-10
                    rounded-xl px-5 py-2 border border-white/20 text-center">
      <div className="text-white text-2xl font-mono font-bold tracking-wider">
        {h}:{m}:{s}
      </div>
      <div className="flex items-center justify-center gap-3 text-xs mt-0.5">
        {clock.speed !== 1 && (
          <span className="text-white/60">{clock.speed}x</span>
        )}
        {vehicleCount !== undefined && vehicleCount > 0 && (
          <span className="text-white/40">{t.vehicles(vehicleCount)}</span>
        )}
      </div>
    </div>
  )
}
