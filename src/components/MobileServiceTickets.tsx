import { useId, type CSSProperties } from 'react'
import { useI18n } from '../i18n'
import { MobileLayerIcon } from './MobileLayerIcon'
import airArtwork from '../assets/mobile-layer-art/air-terminal.webp'
import seaArtwork from '../assets/mobile-layer-art/sea-harbour.webp'
import './mobileServiceTickets.css'

interface ServiceTicketProps {
  kind: 'air' | 'sea'
  count: number
  on: boolean
  onToggle?: () => void
}

function ServiceTicket({ kind, count, on, onToggle }: ServiceTicketProps) {
  const { t } = useI18n()
  const id = useId()
  const air = kind === 'air'
  const title = air ? t.flights : t.ferries

  return <article className="mm-service-ticket" data-kind={kind} data-active={on}
    aria-labelledby={`${id}-title`}
    style={{ '--ticket-accent': `var(--mm-${air ? 'sky' : 'red'})` } as CSSProperties}>
    <div className="mm-service-ticket-surface">
      <div className="mm-service-ticket-hero">
        <div className="mm-service-ticket-body">
          <img className="mm-service-ticket-art" src={air ? airArtwork : seaArtwork} alt="" />
          <MobileLayerIcon name={air ? 'plane' : 'ship'} size={40} />
          <div className="mm-service-ticket-title">
            <span className="mm-mono">{air ? 'AIR / MACAU' : 'SEA / MACAU'}</span>
            <h4 id={`${id}-title`}>{title}</h4>
            <p>{air ? t.mobileAirLocation : t.mobileSeaLocation}</p>
          </div>
        </div>
        <div className="mm-service-ticket-stub" id={`${id}-count`}>
          <strong className="mm-mono">{count}</strong>
          <span>{air ? t.mobileAirCount : t.mobileSeaCount}</span>
        </div>
      </div>
      <button type="button" role="switch" className="mm-service-ticket-toggle"
        aria-label={`${t.mobileLayersShow}: ${title}`} aria-checked={on}
        aria-describedby={`${id}-count`} disabled={!onToggle} onClick={onToggle}>
        <span className="mm-service-ticket-action-label">
          <MobileLayerIcon name="mapPin" size={18} />
          <span>{t.mobileLayersShow}</span>
        </span>
        <span className="mm-service-ticket-switch" aria-hidden="true"><i /></span>
      </button>
    </div>
    <span className="mm-service-ticket-perforation" aria-hidden="true" />
  </article>
}

export function MobileServiceTickets({ flightCount, ferryCount, showFlights, showFerries, flightsOn, ferriesOn, onToggleFlights, onToggleFerries }: {
  flightCount: number
  ferryCount: number
  showFlights: boolean
  showFerries: boolean
  flightsOn: boolean
  ferriesOn: boolean
  onToggleFlights?: () => void
  onToggleFerries?: () => void
}) {
  const { t } = useI18n()
  return <div className="mm-mobile-service-tickets">
    <div className="mm-service-tickets-heading">
      <h3>{t.mobileAirSeaTitle}</h3>
      <p>{t.mobileAirSeaHint}</p>
    </div>
    {showFlights && <ServiceTicket kind="air" count={flightCount} on={flightsOn} onToggle={onToggleFlights} />}
    {showFerries && <ServiceTicket kind="sea" count={ferryCount} on={ferriesOn} onToggle={onToggleFerries} />}
  </div>
}
