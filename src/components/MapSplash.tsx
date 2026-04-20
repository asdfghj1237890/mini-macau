// Splash shown while the MapView chunk (including maplibre-gl ~1 MB) is
// downloading and parsing. Kept deliberately cheap — no external assets,
// no layout work — so it renders on first paint even though MapLibre has
// not yet touched the main thread.
export function MapSplash() {
  return (
    <div
      className="absolute inset-0 z-0 flex items-center justify-center
                 bg-[#0a0a0a] text-white/80 select-none pointer-events-none"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="text-[11px] sm:text-[13px] tracking-[0.5em]
                     text-amber-300/90 mm-led-pulse"
          style={{ fontFamily: 'Orbitron, sans-serif' }}
        >
          MINI MAP MACAU
        </div>
        <div className="flex items-center gap-2 text-[10px] sm:text-[11px]
                        mm-mono tracking-[0.3em] text-white/50">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full
                       bg-emerald-400 mm-led-pulse"
          />
          <span>LOADING MAP</span>
        </div>
      </div>
    </div>
  )
}
