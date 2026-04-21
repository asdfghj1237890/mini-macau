import type { VehiclePosition, SimulationClock, Ferry } from '../types'
import { useI18n, localName } from '../i18n'

interface Props {
  vehicle: VehiclePosition
  clock: SimulationClock
  onClose: () => void
}

function formatMinutes(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = Math.floor(wrapped % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

// Each operator ships its own brand palette; classes are spelled out as
// literals so Tailwind's JIT picks them up.
interface OperatorTheme {
  name: string
  borderAccent: string   // header bottom border
  pillBg: string         // left pill bg
  accentBar: string      // left vertical bar
  statusText: string     // small status text
  statusDot: string      // tiny led dot
  titleText: string      // destination/origin port big text
  timeText: string       // scheduled time
  noteText: string       // markers
  footerLiveText: string
  footerLiveDot: string
}

const OPERATOR_THEME: Record<Ferry['operator'], OperatorTheme> = {
  turbojet: {
    name: 'TurboJET',
    borderAccent: 'border-red-400/20',
    pillBg: 'bg-red-500/[0.08]',
    accentBar: 'bg-red-400',
    statusText: 'text-red-300/80',
    statusDot: 'bg-red-400',
    titleText: 'text-red-100',
    timeText: 'text-red-200',
    noteText: 'text-red-200/90',
    footerLiveText: 'text-red-300/80',
    footerLiveDot: 'bg-red-400',
  },
  cotai: {
    name: '金光飛航 Cotai',
    borderAccent: 'border-blue-400/20',
    pillBg: 'bg-blue-500/[0.08]',
    accentBar: 'bg-blue-400',
    statusText: 'text-blue-300/80',
    statusDot: 'bg-blue-400',
    titleText: 'text-blue-100',
    timeText: 'text-blue-200',
    noteText: 'text-blue-200/90',
    footerLiveText: 'text-blue-300/80',
    footerLiveDot: 'bg-blue-400',
  },
}

export function FerryInfoPanel({ vehicle, clock, onClose }: Props) {
  const { lang, t } = useI18n()
  const ferry = vehicle.ferryData
  if (!ferry) return null

  const isDeparture = ferry.type === 'departure'
  const statusLabel = isDeparture ? t.ferryDeparting : t.ferryArriving
  // Ferry route/port names. `localName` handles nameCn/namePt fallback chain
  // automatically, so callers with only Chinese data (current upstream) still
  // render cleanly in pt/en by falling back to `name` / the cn form.
  const routeName = localName(lang, {
    name: ferry.routeName,
    nameCn: ferry.routeNameCn,
    namePt: ferry.routeNamePt,
  })
  const otherPortName = localName(lang, {
    name: ferry.otherPort,
    nameCn: ferry.otherPortCn,
    namePt: ferry.otherPortPt,
  })
  const isLive = !clock.paused && clock.speed === 1 && Math.abs(clock.currentTime.getTime() - Date.now()) < 3000
  const theme = OPERATOR_THEME[ferry.operator]
  const portLabel = ferry.terminal === 'outer_harbour' ? t.portOuterHarbour : t.portTaipa

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                      shadow-2xl shadow-black/60 overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className={`flex items-stretch border-b ${theme.borderAccent}`}>
          <div className={`px-3 py-2 flex items-center gap-2 border-r border-white/10 ${theme.pillBg}`}>
            <div className={`w-1 h-7 shrink-0 ${theme.accentBar}`} />
            <div>
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/50">⚓ {t.ferryLabel}</div>
              <div className="mm-mono mm-tabular text-[13px] font-bold text-white leading-tight">
                {theme.name}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className={`mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] ${theme.statusText} flex items-center gap-1.5`}>
              <span className={`w-1.5 h-1.5 rounded-full ${theme.statusDot} mm-led-pulse`} />
              {isDeparture ? t.ferryDestination.toUpperCase() : t.ferryOrigin.toUpperCase()} · {statusLabel}
            </div>
            <div className={`text-[14px] font-bold ${theme.titleText} truncate`}>
              {otherPortName}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 text-white/40 hover:text-white hover:bg-white/5 border-l border-white/10
                       mm-mono text-[13px] transition-colors"
            aria-label={t.cancel}
          >
            ✕
          </button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 border-b border-white/8 bg-white/[0.02]">
          <div className="px-3 py-1.5 border-r border-white/8">
            <div className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-white/35">
              {isDeparture ? t.ferryDeparture : t.ferryArrival}
            </div>
            <div className={`mm-mono mm-tabular text-[14px] font-bold ${theme.timeText} leading-tight`}>
              {formatMinutes(ferry.scheduledTime)}
            </div>
          </div>
          <div className="px-3 py-1.5">
            <div className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-white/35">{t.ferryJourney}</div>
            <div className="mm-mono text-[11px] font-bold text-white/90 leading-tight truncate">
              {ferry.journeyMinutes} {t.ferryMin}
            </div>
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/35">{t.ferryRoute}</span>
            <span className="text-[10px] text-white/80 truncate text-right mm-han">
              {routeName}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/35">
              {isDeparture ? t.ferryOrigin : t.ferryDestination}
            </span>
            <span className="text-[10px] text-white/80">{portLabel}</span>
          </div>
          {ferry.markers && (
            <div className="flex items-center justify-between gap-3">
              <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/35">{t.ferryNote}</span>
              <span className={`mm-mono text-[9px] ${theme.noteText}`}>{ferry.markers}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-white/8 bg-white/[0.02] flex items-center justify-between">
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-white/35 uppercase">
            {isDeparture ? t.ferryFooterDep : t.ferryFooterArr}
          </span>
          <span className={`mm-mono text-[9px] max-sm:text-[7px] flex items-center gap-1.5 tracking-wider ${isLive ? theme.footerLiveText : 'text-white/30'}`}>
            <span className={`w-1 h-1 rounded-full ${isLive ? theme.footerLiveDot : 'bg-white/25'}`} />
            {isLive ? t.live : t.simShort}
          </span>
        </div>
      </div>
    </div>
  )
}
