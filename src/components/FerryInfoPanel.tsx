import type { VehiclePosition, SimulationClock, Ferry } from '../types'
import { useI18n, type Lang } from '../i18n'

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

const FERRY_LABELS = {
  en: {
    departure: 'DEP',
    arrival: 'ARR',
    destination: 'TO',
    origin: 'FROM',
    operator: 'OPER',
    journey: 'JRNY',
    departing: 'DEPARTING',
    arriving: 'ARRIVED',
    route: 'ROUTE',
    min: 'min',
    note: 'NOTE',
  },
  zh: {
    departure: '離澳',
    arrival: '抵澳',
    destination: '目的地',
    origin: '出發地',
    operator: '承運',
    journey: '航程',
    departing: '準備離港',
    arriving: '剛抵港',
    route: '航線',
    min: '分鐘',
    note: '備註',
  },
  pt: {
    departure: 'PART',
    arrival: 'CHEG',
    destination: 'DEST',
    origin: 'ORIG',
    operator: 'OPER',
    journey: 'VIAG',
    departing: 'SAINDO',
    arriving: 'CHEG.',
    route: 'ROTA',
    min: 'min',
    note: 'NOTA',
  },
} as const

// Port labels per Macau terminal, per language.
const PORT_LABEL: Record<Ferry['terminal'], Record<Lang, string>> = {
  outer_harbour: { en: 'OHT', zh: '外港', pt: 'OHT' },
  taipa:         { en: 'TMT', zh: '氹仔', pt: 'TMT' },
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
  const { lang } = useI18n()
  const fl = FERRY_LABELS[lang as Lang]
  const ferry = vehicle.ferryData
  if (!ferry) return null

  const isDeparture = ferry.type === 'departure'
  const statusLabel = isDeparture ? fl.departing : fl.arriving
  const routeName = lang === 'en' ? ferry.routeNameEn : ferry.routeNameZh
  const isLive = !clock.paused && clock.speed === 1 && Math.abs(clock.currentTime.getTime() - Date.now()) < 3000
  const theme = OPERATOR_THEME[ferry.operator]
  const portLabel = PORT_LABEL[ferry.terminal][lang as Lang]

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+112px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                      shadow-2xl shadow-black/60 overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className={`flex items-stretch border-b ${theme.borderAccent}`}>
          <div className={`px-3 py-2 flex items-center gap-2 border-r border-white/10 ${theme.pillBg}`}>
            <div className={`w-1 h-7 shrink-0 ${theme.accentBar}`} />
            <div>
              <div className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/50">⚓ FERRY</div>
              <div className="mm-mono mm-tabular text-[13px] font-bold text-white leading-tight">
                {theme.name}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className={`mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] ${theme.statusText} flex items-center gap-1.5`}>
              <span className={`w-1.5 h-1.5 rounded-full ${theme.statusDot} mm-led-pulse`} />
              {isDeparture ? fl.destination.toUpperCase() : fl.origin.toUpperCase()} · {statusLabel}
            </div>
            <div className={`text-[14px] font-bold ${theme.titleText} truncate`}>
              {ferry.otherPortZh}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 text-white/40 hover:text-white hover:bg-white/5 border-l border-white/10
                       mm-mono text-[13px] transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 border-b border-white/8 bg-white/[0.02]">
          <div className="px-3 py-1.5 border-r border-white/8">
            <div className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-white/35">
              {isDeparture ? fl.departure : fl.arrival}
            </div>
            <div className={`mm-mono mm-tabular text-[14px] font-bold ${theme.timeText} leading-tight`}>
              {formatMinutes(ferry.scheduledTime)}
            </div>
          </div>
          <div className="px-3 py-1.5">
            <div className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-white/35">{fl.journey}</div>
            <div className="mm-mono text-[11px] font-bold text-white/90 leading-tight truncate">
              {ferry.journeyMinutes} {fl.min}
            </div>
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/35">{fl.route}</span>
            <span className="text-[10px] text-white/80 truncate text-right mm-han">
              {routeName}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/35">
              {isDeparture ? fl.origin : fl.destination}
            </span>
            <span className="text-[10px] text-white/80">{portLabel}</span>
          </div>
          {ferry.markers && (
            <div className="flex items-center justify-between gap-3">
              <span className="mm-mono text-[9px] max-sm:text-[7px] tracking-[0.25em] text-white/35">{fl.note}</span>
              <span className={`mm-mono text-[9px] ${theme.noteText}`}>{ferry.markers}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-white/8 bg-white/[0.02] flex items-center justify-between">
          <span className="mm-mono text-[8px] max-sm:text-[6px] tracking-[0.25em] text-white/35 uppercase">
            {isDeparture ? 'DEPARTURE · 離港' : 'ARRIVAL · 抵港'}
          </span>
          <span className={`mm-mono text-[9px] max-sm:text-[7px] flex items-center gap-1.5 tracking-wider ${isLive ? theme.footerLiveText : 'text-white/30'}`}>
            <span className={`w-1 h-1 rounded-full ${isLive ? theme.footerLiveDot : 'bg-white/25'}`} />
            {isLive ? 'LIVE' : 'SIM'}
          </span>
        </div>
      </div>
    </div>
  )
}
