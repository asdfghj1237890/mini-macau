import { useI18n } from '../i18n'

// Splash shown while the MapView chunk (including maplibre-gl ~1 MB) is
// downloading and parsing. Kept deliberately cheap — no external assets,
// no layout work — so it renders on first paint even though MapLibre has
// not yet touched the main thread.
export function MapSplash() {
  const { t } = useI18n()
  return (
    <div
      className="absolute inset-0 z-0 flex items-center justify-center
                 bg-(--mm-panel-2) text-(--mm-fg)/80 select-none pointer-events-none"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="text-[11px] sm:text-[13px] tracking-[0.5em]
                     text-(--mm-amber)/90 mm-led-pulse"
          style={{ fontFamily: 'Orbitron, sans-serif' }}
        >
          {t.splashTitle}
        </div>
        <div className="flex items-center gap-2 text-[10px] sm:text-[11px]
                        mm-mono tracking-[0.3em] text-(--mm-text-secondary)">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full
                       bg-(--mm-emerald-2) mm-led-pulse"
          />
          <span>{t.splashLoading}</span>
        </div>
      </div>
    </div>
  )
}
