import type { VehiclePosition, SimulationClock } from '../types'
import { useI18n } from '../i18n'

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

const FLIGHT_LABELS = {
  en: {
    flight: 'Flight',
    airline: 'Airline',
    departure: 'Departure',
    arrival: 'Arrival',
    scheduled: 'Scheduled',
    destination: 'To',
    origin: 'From',
    aircraft: 'Aircraft',
    altitude: 'Altitude',
    departing: 'Departing',
    arriving: 'Arriving',
    airport: 'Macau Int\'l (MFM)',
  },
  zh: {
    flight: '航班',
    airline: '航空公司',
    departure: '離澳',
    arrival: '抵澳',
    scheduled: '預定時間',
    destination: '目的地',
    origin: '出發地',
    aircraft: '機型',
    altitude: '高度',
    departing: '起飛中',
    arriving: '降落中',
    airport: '澳門國際機場 (MFM)',
  },
  pt: {
    flight: 'Voo',
    airline: 'Companhia aérea',
    departure: 'Partida',
    arrival: 'Chegada',
    scheduled: 'Hora prevista',
    destination: 'Destino',
    origin: 'Origem',
    aircraft: 'Aeronave',
    altitude: 'Altitude',
    departing: 'Descolando',
    arriving: 'Aterrando',
    airport: 'Aerop. Int. de Macau (MFM)',
  },
} as const

export function FlightInfoPanel({ vehicle, clock, onClose }: Props) {
  const { lang } = useI18n()
  const fl = FLIGHT_LABELS[lang]
  const flight = vehicle.flightData
  if (!flight) return null

  const isDeparture = flight.type === 'departure'
  const airport = isDeparture ? flight.destination : flight.origin

  return (
    <div className="absolute top-20 left-4 bg-black/80 backdrop-blur-sm rounded-xl z-10
                    px-4 py-3 border border-white/20 min-w-[240px] max-w-[320px]
                    max-sm:top-auto max-sm:bottom-20 max-sm:left-2 max-sm:right-2
                    max-sm:max-w-none max-sm:min-w-0
                    landscape:top-auto landscape:bottom-16 landscape:left-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full flex-shrink-0 bg-sky-400" />
          <span className="text-white font-semibold text-sm">{flight.flightNumber}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-medium">
            {isDeparture ? fl.departure : fl.arrival}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-sm transition-colors ml-2"
        >
          ✕
        </button>
      </div>

      <div className="space-y-2 text-xs">
        {flight.airline.name && (
          <div className="flex justify-between">
            <span className="text-white/50">{fl.airline}</span>
            <span className="text-white/90">{flight.airline.name} ({flight.airline.iata})</span>
          </div>
        )}

        <div className="flex justify-between">
          <span className="text-white/50">{isDeparture ? fl.destination : fl.origin}</span>
          <span className="text-white/90">
            {airport?.name ?? '—'} ({airport?.iata ?? '—'})
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/50">{fl.scheduled}</span>
          <span className="text-white/90 font-mono">{formatMinutes(flight.scheduledTime)}</span>
        </div>

        {flight.aircraftType && (
          <div className="flex justify-between">
            <span className="text-white/50">{fl.aircraft}</span>
            <span className="text-white/90">{flight.aircraftType}</span>
          </div>
        )}

        {vehicle.altitude === 0 && (
          <div className="w-full h-px bg-white/10 my-1" />
        )}
        {vehicle.altitude === 0 && (
          <div className="flex justify-between">
            <span className="text-sky-400 text-[10px] font-medium">
              {isDeparture ? fl.departing : fl.arriving}
            </span>
            <span className="text-white/40 text-[10px]">{fl.airport}</span>
          </div>
        )}
      </div>
    </div>
  )
}
