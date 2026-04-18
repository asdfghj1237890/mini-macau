import type { VehiclePosition, FlightAirport, SimulationClock } from '../types'
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

function airportDisplayName(airport: FlightAirport | undefined, lang: Lang): string {
  if (!airport) return '—'
  if (lang === 'zh' && airport.nameCn) return airport.nameCn
  return airport.name || '—'
}

const FLIGHT_LABELS = {
  en: {
    departure: 'DEP',
    arrival: 'ARR',
    scheduled: 'SCHED',
    destination: 'TO',
    origin: 'FROM',
    aircraft: 'ACFT',
    airline: 'OPER',
    departing: 'DEPARTING',
    arriving: 'ARRIVING',
    airport: 'MFM',
  },
  zh: {
    departure: '離澳',
    arrival: '抵澳',
    scheduled: '預定',
    destination: '目的地',
    origin: '出發地',
    aircraft: '機型',
    airline: '航司',
    departing: '起飛中',
    arriving: '降落中',
    airport: 'MFM',
  },
  pt: {
    departure: 'PART',
    arrival: 'CHEG',
    scheduled: 'HORA',
    destination: 'DEST',
    origin: 'ORIG',
    aircraft: 'AERN',
    airline: 'OPER',
    departing: 'DESC',
    arriving: 'ATER',
    airport: 'MFM',
  },
} as const

export function FlightInfoPanel({ vehicle, clock, onClose }: Props) {
  const { lang } = useI18n()
  const fl = FLIGHT_LABELS[lang]
  const flight = vehicle.flightData
  if (!flight) return null

  const isDeparture = flight.type === 'departure'
  const airport = isDeparture ? flight.destination : flight.origin
  const statusLabel = isDeparture ? fl.departing : fl.arriving
  const isLive = !clock.paused && clock.speed === 1 && Math.abs(clock.currentTime.getTime() - Date.now()) < 3000

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[72px] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-[#0b0b0c]/95 backdrop-blur-md border border-white/10 rounded-sm
                      shadow-2xl shadow-black/60 overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className="flex items-stretch border-b border-sky-300/20">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-white/10 bg-sky-400/[0.08]">
            <div className="w-1 h-7 shrink-0 bg-sky-300" />
            <div>
              <div className="mm-mono text-[9px] tracking-[0.25em] text-white/50">✈ FLIGHT</div>
              <div className="mm-mono mm-tabular text-sm font-bold text-white leading-tight">
                {flight.flightNumber}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="mm-mono text-[9px] tracking-[0.25em] text-sky-300/80 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-300 mm-led-pulse" />
              {isDeparture ? fl.destination.toUpperCase() : fl.origin.toUpperCase()} · {statusLabel}
            </div>
            <div className="text-base font-semibold text-sky-100 truncate">
              {airportDisplayName(airport, lang)}
              {airport?.iata && (
                <span className="text-sky-200/60 font-normal text-xs ml-1.5">{airport.iata}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 text-white/40 hover:text-white hover:bg-white/5 border-l border-white/10
                       mm-mono text-sm transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 border-b border-white/8 bg-white/[0.02]">
          <div className="px-3 py-1.5 border-r border-white/8">
            <div className="mm-mono text-[8px] tracking-[0.25em] text-white/35">
              {isDeparture ? fl.departure : fl.arrival}
            </div>
            <div className="mm-mono mm-tabular text-[15px] font-bold text-sky-200 leading-tight">
              {formatMinutes(flight.scheduledTime)}
            </div>
          </div>
          <div className="px-3 py-1.5">
            <div className="mm-mono text-[8px] tracking-[0.25em] text-white/35">{fl.aircraft}</div>
            <div className="mm-mono text-[12px] font-bold text-white/90 leading-tight truncate">
              {flight.aircraftType ?? '—'}
            </div>
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          {flight.airline.name && (
            <div className="flex items-center justify-between gap-3">
              <span className="mm-mono text-[9px] tracking-[0.25em] text-white/35">{fl.airline}</span>
              <span className="text-[11px] text-white/80 truncate text-right">
                {flight.airline.name}
                {flight.airline.iata && (
                  <span className="mm-mono text-white/40 ml-1.5">{flight.airline.iata}</span>
                )}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="mm-mono text-[9px] tracking-[0.25em] text-white/35">
              {isDeparture ? fl.origin : fl.destination}
            </span>
            <span className="text-[11px] text-white/80">{fl.airport}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-white/8 bg-white/[0.02] flex items-center justify-between">
          <span className="mm-mono text-[8px] tracking-[0.25em] text-white/35 uppercase">
            {isDeparture ? 'DEPARTURE · 離境' : 'ARRIVAL · 抵境'}
          </span>
          <span className={`mm-mono text-[9px] flex items-center gap-1.5 tracking-wider ${isLive ? 'text-sky-300/80' : 'text-white/30'}`}>
            <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-sky-300 mm-led-pulse' : 'bg-white/25'}`} />
            {isLive ? 'LIVE' : 'SIM'}
          </span>
        </div>
      </div>
    </div>
  )
}
