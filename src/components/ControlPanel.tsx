import type { SimulationClock } from '../types'
import { useI18n } from '../i18n'

interface Props {
  clock: SimulationClock
}

const SPEEDS = [1, 2, 5, 10, 30, 60]

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.55.83l10.4-6.86a1 1 0 0 0 0-1.66L9.55 4.31A1 1 0 0 0 8 5.14z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

function NowIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function ControlPanel({ clock }: Props) {
  const { t } = useI18n()
  const isPaused = clock.paused

  return (
    <div
      role="toolbar"
      aria-label="simulation controls"
      className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10
                 flex items-center gap-0.5 p-1.5
                 bg-zinc-900/85 backdrop-blur-xl
                 rounded-2xl border border-white/10
                 shadow-2xl shadow-black/40
                 select-none
                 max-sm:bottom-6 max-sm:gap-0 max-sm:p-1
                 landscape:bottom-4 landscape:p-1
                 pb-[max(0.375rem,env(safe-area-inset-bottom))]"
    >
      <button
        type="button"
        onClick={clock.togglePause}
        aria-label={isPaused ? t.play : t.pause}
        aria-pressed={!isPaused}
        title={isPaused ? t.play : t.pause}
        className="w-9 h-9 max-sm:w-8 max-sm:h-8 landscape:w-8 landscape:h-8
                   flex items-center justify-center rounded-xl
                   text-white/90 hover:text-white hover:bg-white/10
                   active:scale-95 transition"
      >
        {isPaused ? <PlayIcon /> : <PauseIcon />}
      </button>

      <div className="w-px h-5 bg-white/10 mx-1 max-sm:mx-0.5" aria-hidden="true" />

      <div role="group" aria-label="speed" className="flex items-center gap-0.5 max-sm:gap-0">
        {SPEEDS.map(s => {
          const active = clock.speed === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => clock.setSpeed(s)}
              aria-pressed={active}
              className={`min-w-[2.4rem] h-9 px-2 rounded-lg
                          max-sm:min-w-[2rem] max-sm:h-8 max-sm:px-1.5
                          landscape:min-w-[2rem] landscape:h-8 landscape:px-1.5
                          text-xs font-medium tabular-nums
                          active:scale-95 transition
                          ${active
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-white/60 hover:text-white hover:bg-white/10'}`}
            >
              {s}x
            </button>
          )
        })}
      </div>

      <div className="w-px h-5 bg-white/10 mx-1 max-sm:mx-0.5" aria-hidden="true" />

      <button
        type="button"
        onClick={clock.reset}
        title={t.resetNorth}
        className="h-9 px-3 max-sm:h-8 max-sm:px-2 landscape:h-8 landscape:px-2
                   flex items-center gap-1.5 max-sm:gap-1 rounded-lg
                   text-xs font-medium text-white/65
                   hover:text-white hover:bg-white/10
                   active:scale-95 transition"
      >
        <NowIcon />
        <span>{t.now}</span>
      </button>
    </div>
  )
}
