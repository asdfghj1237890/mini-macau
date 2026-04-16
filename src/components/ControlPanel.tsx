import type { SimulationClock } from '../types'
import { useI18n } from '../i18n'

interface Props {
  clock: SimulationClock
}

const SPEEDS = [1, 2, 5, 10, 30, 60]

export function ControlPanel({ clock }: Props) {
  const { t } = useI18n()

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 sm:gap-2 z-10
                    bg-black/70 backdrop-blur-sm rounded-xl px-2 sm:px-4 py-2 border border-white/20">
      <button
        onClick={clock.togglePause}
        className="text-white hover:text-blue-400 transition-colors text-lg w-8 h-8
                   flex items-center justify-center"
        title={clock.paused ? t.play : t.pause}
      >
        {clock.paused ? '▶' : '⏸'}
      </button>

      <div className="w-px h-6 bg-white/20 mx-1" />

      {SPEEDS.map(s => (
        <button
          key={s}
          onClick={() => clock.setSpeed(s)}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            clock.speed === s
              ? 'bg-blue-500 text-white'
              : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
        >
          {s}x
        </button>
      ))}

      <div className="w-px h-6 bg-white/20 mx-1" />

      <button
        onClick={clock.reset}
        className="text-white/60 hover:text-white transition-colors text-xs px-2 py-1"
        title={t.resetNorth}
      >
        {t.now}
      </button>
    </div>
  )
}
