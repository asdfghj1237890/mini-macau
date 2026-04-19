import type { VehiclePosition, SimulationClock } from '../types'
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
    port: 'OHT',
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
    port: '外港',
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
    port: 'OHT',
    route: 'ROTA',
    min: 'min',
    note: 'NOTA',
  },
} as const

export function FerryInfoPanel({ vehicle, clock, onClose }: Props) {
  const { lang } = useI18n()
  const fl = FERRY_LABELS[lang as Lang]
  const ferry = vehicle.ferryData
  if (!ferry) return null

  const isDeparture = ferry.type === 'departure'
  const statusLabel = isDeparture ? fl.departing : fl.arriving
  const routeName = lang === 'en' ? ferry.routeNameEn : ferry.routeNameZh
  const isLive = !clock.paused && clock.speed === 1 && Math.abs(clock.currentTime.getTime() - Date.now()) < 3000

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+112px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                      shadow-2xl shadow-black/60 overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className="flex items-stretch border-b border-red-400/20">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-white/10 bg-red-500/[0.08]">
            <div className="w-1 h-7 shrink-0 bg-red-400" />
            <div>
              <div className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-white/50">⚓ FERRY</div>
              <div className="mm-mono mm-tabular text-[16px] font-bold text-white leading-tight">
                TurboJET
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-red-300/80 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 mm-led-pulse" />
              {isDeparture ? fl.destination.toUpperCase() : fl.origin.toUpperCase()} · {statusLabel}
            </div>
            <div className="text-lg font-semibold text-red-100 truncate">
              {ferry.otherPortZh}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 text-white/40 hover:text-white hover:bg-white/5 border-l border-white/10
                       mm-mono text-[16px] transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 border-b border-white/8 bg-white/[0.02]">
          <div className="px-3 py-1.5 border-r border-white/8">
            <div className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-white/35">
              {isDeparture ? fl.departure : fl.arrival}
            </div>
            <div className="mm-mono mm-tabular text-[17px] font-bold text-red-200 leading-tight">
              {formatMinutes(ferry.scheduledTime)}
            </div>
          </div>
          <div className="px-3 py-1.5">
            <div className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-white/35">{fl.journey}</div>
            <div className="mm-mono text-[14px] font-bold text-white/90 leading-tight truncate">
              {ferry.journeyMinutes} {fl.min}
            </div>
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-white/35">{fl.route}</span>
            <span className="text-[13px] text-white/80 truncate text-right mm-han">
              {routeName}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-white/35">
              {isDeparture ? fl.origin : fl.destination}
            </span>
            <span className="text-[13px] text-white/80">{fl.port}</span>
          </div>
          {ferry.markers && (
            <div className="flex items-center justify-between gap-3">
              <span className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-white/35">{fl.note}</span>
              <span className="mm-mono text-[11px] text-red-200/90">{ferry.markers}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-white/8 bg-white/[0.02] flex items-center justify-between">
          <span className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-white/35 uppercase">
            {isDeparture ? 'DEPARTURE · 離港' : 'ARRIVAL · 抵港'}
          </span>
          <span className={`mm-mono text-[11px] max-sm:text-[9px] flex items-center gap-1.5 tracking-wider ${isLive ? 'text-red-300/80' : 'text-white/30'}`}>
            <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-red-400 mm-led-pulse' : 'bg-white/25'}`} />
            {isLive ? 'LIVE' : 'SIM'}
          </span>
        </div>
      </div>
    </div>
  )
}
