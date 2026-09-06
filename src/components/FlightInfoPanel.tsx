import type { VehiclePosition, FlightAirport, SimulationClock } from '../types'
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

export function FlightInfoPanel({ vehicle, clock, onClose }: Props) {
  const { lang, t } = useI18n()
  const flight = vehicle.flightData
  if (!flight) return null

  const isDeparture = flight.type === 'departure'
  const airport: FlightAirport | undefined = isDeparture ? flight.destination : flight.origin
  const airportName = airport
    ? localName(lang, {
        name: airport.name,
        nameCn: airport.nameCn,
        namePt: airport.namePt,
      }) || '—'
    : '—'
  const statusLabel = isDeparture
    ? (vehicle.flightPhase === 'apron' ? t.flightAwaitingTakeoff : t.flightDeparting)
    : t.flightArriving
  const isLive = clock.isLive

  return (
    <div className="absolute top-16 left-4 z-20 w-[340px]
                    max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+168px)] max-sm:left-2 max-sm:right-2 max-sm:w-auto
                    landscape:top-auto landscape:bottom-16 landscape:left-2 landscape:w-[320px]"
         style={{ zoom: 1.2 }}>
      <div className="bg-(--mm-panel)/95 backdrop-blur-md border border-(--mm-fg)/10 rounded-sm
                      shadow-2xl shadow-(color:--mm-shadow) overflow-hidden mm-fade">
        {/* Header signboard */}
        <div className="flex items-stretch border-b border-(--mm-sky)/20">
          <div className="px-3 py-2 flex items-center gap-2 border-r border-(--mm-fg)/10 bg-(--mm-sky-2)/[0.08]">
            <div className="w-1 h-7 shrink-0 bg-(--mm-sky)" />
            <div>
              <div className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-(--mm-text-secondary)">✈ {t.flightLabel}</div>
              <div className="mm-mono mm-tabular text-[16px] font-bold text-(--mm-fg) leading-tight">
                {flight.flightNumber}
              </div>
            </div>
          </div>
          <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
            <div className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-(--mm-sky)/80 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-(--mm-sky) mm-led-pulse" />
              {isDeparture ? t.flightDestination.toUpperCase() : t.flightOrigin.toUpperCase()} · {statusLabel}
            </div>
            <div className="text-lg font-bold text-(--mm-sky-1) truncate">
              {airportName}
              {airport?.iata && (
                <span className="text-(--mm-sky-1)/60 font-normal text-[14px] ml-1.5">{airport.iata}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 text-(--mm-text-muted) hover:text-(--mm-fg) hover:bg-(--mm-fg)/5 border-l border-(--mm-fg)/10
                       mm-mono text-[16px] transition-colors"
            aria-label={t.cancel}
          >
            ✕
          </button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 border-b border-(--mm-fg)/8 bg-(--mm-fg)/[0.02]">
          <div className="px-3 py-1.5 border-r border-(--mm-fg)/8">
            <div className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-(--mm-text-muted)">
              {isDeparture ? t.flightDeparture : t.flightArrival}
            </div>
            <div className="mm-mono mm-tabular text-[17px] font-bold text-(--mm-sky-1) leading-tight">
              {formatMinutes(flight.scheduledTime)}
            </div>
          </div>
          <div className="px-3 py-1.5">
            <div className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-(--mm-text-muted)">{t.flightAircraft}</div>
            <div className="mm-mono text-[14px] font-bold text-(--mm-fg)/90 leading-tight truncate">
              {flight.aircraftType ?? '—'}
            </div>
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-3 py-2 space-y-1">
          {flight.airline.name && (
            <div className="flex items-center justify-between gap-3">
              <span className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-(--mm-text-muted)">{t.flightAirline}</span>
              <span className="text-[13px] text-(--mm-fg)/80 truncate text-right">
                {flight.airline.name}
                {flight.airline.iata && (
                  <span className="mm-mono text-(--mm-text-muted) ml-1.5">{flight.airline.iata}</span>
                )}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="mm-mono text-[11px] max-sm:text-[9px] tracking-[0.25em] text-(--mm-text-muted)">
              {isDeparture ? t.flightOrigin : t.flightDestination}
            </span>
            <span className="text-[13px] text-(--mm-fg)/80">{t.flightAirportCode}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-(--mm-fg)/8 bg-(--mm-fg)/[0.02] flex items-center justify-between">
          <span className="mm-mono text-[10px] max-sm:text-[8px] tracking-[0.25em] text-(--mm-text-muted) uppercase">
            {isDeparture ? t.flightFooterDep : t.flightFooterArr}
          </span>
          <span className={`mm-mono text-[11px] max-sm:text-[9px] flex items-center gap-1.5 tracking-wider ${isLive ? 'text-(--mm-sky)/80' : 'text-(--mm-text-subtle)'}`}>
            <span className={`w-1 h-1 rounded-full ${isLive ? 'bg-(--mm-sky) mm-led-pulse' : 'bg-(--mm-fg)/25'}`} />
            {isLive ? t.live : t.simShort}
          </span>
        </div>
      </div>
    </div>
  )
}
