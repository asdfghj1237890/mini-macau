import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import './layerPanel.css'

export interface CityLayerItem {
  panel: string
  focus: boolean
  label: string
  code: string
  description: string
  icon: ReactNode
  on: boolean
  count: string
  accent: string
  toggle?: () => void
}

export interface LayerDetail {
  content: ReactNode
  expanded?: boolean
  onExpand?: () => void
}

function CityLayerCard({ row, detail, onInspect }: {
  row: CityLayerItem
  detail?: LayerDetail
  onInspect?: (id: string) => void
}) {
  const { t } = useI18n()
  const detailId = useId()
  const [open, setOpen] = useState(true)
  const expanded = row.on && (detail?.expanded ?? open)
  return (
    <article className="mm-layer-card" data-active={row.on}
      style={{ '--layer-accent': `var(--mm-${row.accent})` } as CSSProperties}>
      <div className="mm-layer-card-row">
        <button type="button" className="mm-layer-card-main"
          title={row.description}
          onClick={onInspect ? () => onInspect(row.panel) : row.toggle}
          disabled={!onInspect && !row.toggle}
          aria-pressed={onInspect ? undefined : row.on}>
          <span className="mm-layer-icon" aria-hidden="true">{row.icon}</span>
          <span className="mm-layer-name">
            <span className="mm-layer-code mm-mono">{row.code}</span>
            <span className="mm-layer-label">{row.label}</span>
          </span>
          <span className="mm-layer-count mm-mono mm-tabular">{row.count}</span>
          {onInspect && <span className="mm-layer-chevron" aria-hidden="true" />}
        </button>
        <button type="button" className="mm-layer-toggle" role="switch"
          aria-label={row.label} title={row.description} aria-checked={row.on} disabled={!row.toggle} onClick={row.toggle}>
          <span className="mm-layer-toggle-track" aria-hidden="true"><span /></span>
        </button>
      </div>
      {row.on && (
        <div className="mm-layer-card-caption">
          <span>{row.description}</span>
          {(detail || onInspect) && (
            <button type="button" className="mm-layer-disclosure"
              aria-label={`${t.layerDetails}: ${row.label}`}
              aria-expanded={onInspect ? undefined : expanded}
              aria-controls={onInspect ? undefined : detailId}
              onClick={onInspect ? () => onInspect(row.panel) : detail?.onExpand ?? (() => setOpen(v => !v))}>
              {t.layerDetails}<span className="mm-layer-chevron" data-open={!onInspect && expanded} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {detail && <div id={detailId} className="mm-layer-detail" hidden={!expanded}>{detail.content}</div>}
    </article>
  )
}

export function CityLayerList({ rows, details, onInspect }: {
  rows: CityLayerItem[]
  details?: Record<string, LayerDetail>
  onInspect?: (id: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className="mm-city-layers">
      {[false, true].map(focus => (
        <section className="mm-layer-section" key={String(focus)}>
          <div className="mm-layer-section-heading">
            <span className="mm-layer-section-index mm-mono" aria-hidden="true">{focus ? '02' : '01'}</span>
            <h3>{focus ? t.layerFocus : t.layerEveryday}</h3>
            <span className="mm-layer-section-note">{focus ? t.cityFocusOneAtATime : t.layerMix}</span>
          </div>
          {rows.filter(row => row.focus === focus).map(row => (
            <CityLayerCard key={row.panel} row={row} detail={details?.[row.panel]} onInspect={onInspect} />
          ))}
        </section>
      ))}
    </div>
  )
}
