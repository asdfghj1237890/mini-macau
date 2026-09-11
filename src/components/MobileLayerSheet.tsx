import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { CloseIcon } from './TransitIcons'
import { MobileLayerIcon } from './MobileLayerIcon'
import type { CityLayerItem } from './CityLayerList'
import './mobileLayers.css'

export type MobileLayerCategory = 'lrt' | 'bus' | 'air-sea' | 'city'
export interface MobileLayerTab {
  id: MobileLayerCategory
  label: string
  count: string
  accent: string
  icon: ReactNode
}

export function MobileLayerSheet({ tabs, category, pageKey, title, onCategory, onBack, onClose, children }: {
  tabs: MobileLayerTab[]
  category: MobileLayerCategory
  pageKey: string
  title: string
  onCategory: (category: MobileLayerCategory) => void
  onBack?: () => void
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const [expanded, setExpanded] = useState(false)
  const dragStart = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const active = tabs.find(tab => tab.id === category)

  useEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px), (orientation: landscape) and (max-height: 500px)')
    const check = () => { if (!media.matches) onClose() }
    media.addEventListener('change', check)
    check()
    return () => media.removeEventListener('change', check)
  }, [onClose])

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = scrollPositions.current.get(pageKey) ?? 0
    if (!dialogRef.current?.contains(document.activeElement)) headingRef.current?.focus({ preventScroll: true })
  }, [pageKey])

  return (
    <dialog ref={dialogRef} className="mm-mobile-layer-modal" aria-labelledby={`${id}-title`}
      onKeyDown={event => { if (event.code === 'Space') event.stopPropagation() }}
      onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="mm-mobile-sheet" data-expanded={expanded}
        onClickCapture={() => {
          if (contentRef.current) scrollPositions.current.set(pageKey, contentRef.current.scrollTop)
        }}
        style={{ '--sheet-accent': `var(--mm-${active?.accent ?? 'amber'})` } as CSSProperties}>
        <button type="button" className="mm-mobile-sheet-grip" aria-expanded={expanded}
          aria-label={expanded ? t.collapse : t.expand}
          onPointerDown={event => {
            dragStart.current = event.clientY
            suppressClick.current = false
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerUp={event => {
            if (dragStart.current === null) return
            const delta = event.clientY - dragStart.current
            dragStart.current = null
            if (Math.abs(delta) < 32) return
            suppressClick.current = true
            if (delta > 90 && !expanded) onClose()
            else setExpanded(delta < 0)
          }}
          onPointerCancel={() => { dragStart.current = null }}
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return }
            setExpanded(value => !value)
          }}><span /></button>
        <header className="mm-mobile-sheet-header">
          {onBack && <button type="button" className="mm-mobile-sheet-back" onClick={onBack}
            aria-label={t.mobileLayersBack}><MobileLayerIcon name="arrowLeft" /></button>}
          <div>
            <span className="mm-mobile-sheet-eyebrow mm-mono">MINI MACAU / EXPLORE</span>
            <h2 ref={headingRef} tabIndex={-1} id={`${id}-title`}>{title}</h2>
          </div>
          <button type="button" className="mm-mobile-sheet-close" onClick={onClose}
            aria-label={t.layerClose}><CloseIcon size={24} /></button>
        </header>
        <div className="mm-mobile-sheet-tabs" role="tablist" aria-label={t.layerPanelTitle}>
          {tabs.map((tab, index) => (
            <button type="button" role="tab" key={tab.id} id={`${id}-${tab.id}`}
              aria-selected={category === tab.id} aria-controls={`${id}-content`}
              aria-label={`${tab.label} ${tab.count}`}
              tabIndex={category === tab.id ? 0 : -1} onClick={() => onCategory(tab.id)}
              style={{ '--tab-accent': `var(--mm-${tab.accent})` } as CSSProperties}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                onCategory(tabs[next].id)
                document.getElementById(`${id}-${tabs[next].id}`)?.focus()
              }}>
              <span className="mm-mobile-tab-icon" aria-hidden="true">{tab.icon}</span>
              <span className="mm-mobile-tab-label" aria-hidden="true">{tab.label}</span>
            </button>
          ))}
        </div>
        <div ref={contentRef} className="mm-mobile-sheet-content" role="tabpanel" id={`${id}-content`}
          aria-labelledby={`${id}-${category}`} key={pageKey}
          onScroll={event => scrollPositions.current.set(pageKey, event.currentTarget.scrollTop)}>
          {children}
        </div>
        <footer className="mm-mobile-sheet-footer">
          <span><i />{t.mobileLayersApplied}</span>
          <button type="button" onClick={onClose}>
            <span>{t.mobileLayersViewMap}</span>
            <MobileLayerIcon name="arrowUpRight" size={22} />
          </button>
        </footer>
      </section>
    </dialog>
  )
}

export function MobileLayerToggle({ on, label, count, icon, onToggle, disabled = false }: {
  on: boolean
  label: string
  count?: string
  icon?: ReactNode
  onToggle?: () => void
  disabled?: boolean
}) {
  return <button type="button" role="switch" aria-label={label} aria-checked={on}
    className="mm-mobile-layer-toggle" disabled={disabled || !onToggle} onClick={onToggle}>
    {icon && <span className="mm-mobile-toggle-icon" aria-hidden="true">{icon}</span>}
    <span className="mm-mobile-toggle-label">{label}{count && <small className="mm-mono">{count}</small>}</span>
    <span className="mm-mobile-switch" aria-hidden="true"><i /></span>
  </button>
}

export function MobileCityIndex({ rows, onInspect }: {
  rows: CityLayerItem[]
  onInspect: (id: string) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const codes: Record<string, string> = { works: 'WORKS', toilets: 'WC', schools: 'SCHOOLS' }
  return <div className="mm-mobile-city-index">
    {[false, true].map(focus => <section key={String(focus)} data-focus={focus}>
      <div className="mm-mobile-city-heading"><h3>{focus ? t.layerFocus : t.layerEveryday}</h3>
        <span>{focus ? t.cityFocusOneAtATime : t.layerMix}</span></div>
      <div className="mm-mobile-index-rows">
        {rows.filter(row => row.focus === focus).map(row => <article key={row.panel}
          className="mm-mobile-index-row" data-active={row.on} data-layer={row.panel}
          style={{ '--index-accent': `var(--mm-${row.accent})` } as CSSProperties}>
          <button type="button" className="mm-mobile-index-main" role="switch"
            aria-label={row.label} aria-describedby={`${id}-${row.panel}-count`}
            aria-checked={row.on} disabled={!row.toggle} onClick={row.toggle} title={row.description}>
            <span className="mm-mobile-index-number mm-mono" aria-hidden="true">
              {String(rows.findIndex(item => item.panel === row.panel) + 1).padStart(2, '0')}
            </span>
            <span className="mm-mobile-index-icon" aria-hidden="true">
              {row.panel === 'schools' ? <MobileLayerIcon name="school" size={28} /> : row.icon}
            </span>
            <span className="mm-mobile-index-name"><strong>{row.label}</strong>
              <small className="mm-mono">{codes[row.panel] ?? row.code}</small></span>
            <span className="mm-mobile-index-count mm-mono" id={`${id}-${row.panel}-count`}>
              {row.count.split('/')[0]}{row.count.includes('/') && <small>/{row.count.split('/')[1]}</small>}
            </span>
            <span className="mm-mobile-index-state" aria-hidden="true">
              <MobileLayerIcon name={row.on ? 'check' : 'plus'} size={18} />
            </span>
          </button>
          <button type="button" className="mm-mobile-index-details" onClick={() => onInspect(row.panel)}
            aria-label={`${t.layerDetails}: ${row.label}`}><span>{t.layerDetails}</span>
            <MobileLayerIcon name="arrowUpRight" size={15} /></button>
        </article>)}
      </div>
    </section>)}
  </div>
}

export function MobileCityDetail({ row, children }: { row: CityLayerItem; children?: ReactNode }) {
  const { t } = useI18n()
  return <div className="mm-mobile-city-detail"
    style={{ '--sheet-accent': `var(--mm-${row.accent})` } as CSSProperties}>
    <div className="mm-mobile-detail-hero">
      <span aria-hidden="true">{row.icon}</span>
      <div><small className="mm-mono">{row.code}</small><strong className="mm-mono">{row.count}</strong></div>
    </div>
    <p className="mm-mobile-detail-description">{row.description}</p>
    <MobileLayerToggle on={row.on} label={t.mobileLayersShow} onToggle={row.toggle} />
    {children && <div className="mm-mobile-detail-key">{children}</div>}
  </div>
}
