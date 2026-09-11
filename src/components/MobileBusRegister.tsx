import { useEffect, useId, useRef, useState } from 'react'
import { localName, useI18n } from '../i18n'
import { GROUP_LABEL_KEYS, GROUP_ORDER, type GroupKey } from '../routeGroups'
import type { BusRoute } from '../types'
import { MobileLayerIcon } from './MobileLayerIcon'
import './mobileBusRegister.css'

export function MobileBusRegister({ grouped, visibleRoutes, inactiveRoutes, selectedGroup, onSelectGroup,
  isAutoMode, onToggleRoute, onToggleGroup, onResetAuto, onShowAll, onHideAll }: {
  grouped: ReadonlyMap<GroupKey, BusRoute[]>
  visibleRoutes: ReadonlySet<string>
  inactiveRoutes?: ReadonlySet<string>
  selectedGroup: GroupKey
  onSelectGroup: (group: GroupKey) => void
  isAutoMode?: boolean
  onToggleRoute?: (routeId: string) => void
  onToggleGroup?: (group: GroupKey) => void
  onResetAuto?: () => void
  onShowAll?: () => void
  onHideAll?: () => void
}) {
  const { t, lang } = useI18n()
  const id = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const [canScrollMore, setCanScrollMore] = useState(true)
  const groups = GROUP_ORDER.filter(group => grouped.get(group)?.length)
  const group = groups.includes(selectedGroup) ? selectedGroup : groups[0]
  const routes = grouped.get(group) ?? []
  const total = groups.reduce((sum, key) => sum + (grouped.get(key)?.length ?? 0), 0)
  const active = routes.filter(route => visibleRoutes.has(route.id)).length
  const eligible = routes.some(route => !inactiveRoutes?.has(route.id))

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const observer = new ResizeObserver(() => {
      setCanScrollMore(list.scrollHeight - list.clientHeight - list.scrollTop > 2)
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [group])

  return <div className="mm-bus-register">
    <div className="mm-bus-heading">
      <h3>{t.mobileBusTitle}</h3>
      <span><strong className="mm-mono">{visibleRoutes.size}</strong><span className="mm-mono"> / {total}</span> {t.mobileBusSelectedRoutes}</span>
    </div>
    <div className="mm-bus-actions">
      <button type="button" className="mm-bus-auto" aria-pressed={isAutoMode}
        onClick={onResetAuto} disabled={!onResetAuto}>
        <MobileLayerIcon name="clock" size={17} /><span>{t.autoByTime}</span>
      </button>
      <button type="button" onClick={onShowAll} disabled={!onShowAll}>{t.mobileBusShowAll}</button>
      <button type="button" onClick={onHideAll} disabled={!onHideAll}>{t.mobileBusHideAll}</button>
    </div>
    <div className="mm-bus-regions" role="tablist" aria-label={t.mobileBusRegions}>
      {groups.map((key, index) => {
        const groupRoutes = grouped.get(key) ?? []
        const selected = groupRoutes.filter(route => visibleRoutes.has(route.id)).length
        return <button type="button" role="tab" key={key} id={`${id}-${key}`}
          aria-selected={group === key} aria-controls={`${id}-routes`}
          aria-label={`${t[GROUP_LABEL_KEYS[key]]} ${selected}/${groupRoutes.length}`}
          tabIndex={group === key ? 0 : -1} onClick={() => onSelectGroup(key)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + groups.length) % groups.length
            onSelectGroup(groups[next])
            document.getElementById(`${id}-${groups[next]}`)?.focus()
          }}>
          <strong>{t.mobileBusGroups[key]}</strong>
          <span className="mm-mono">{selected} / {groupRoutes.length}</span>
        </button>
      })}
    </div>
    {group && <section className="mm-bus-group" role="tabpanel" id={`${id}-routes`} aria-labelledby={`${id}-${group}`}>
      <div className="mm-bus-group-heading">
        <h4>{t[GROUP_LABEL_KEYS[group]]}</h4>
        <span><span className="mm-mono">{active} / {routes.length}</span> {t.mobileBusSelected}</span>
        <button type="button" className="mm-bus-group-switch" role="switch"
          aria-label={t[GROUP_LABEL_KEYS[group]]} aria-checked={active > 0}
          disabled={!onToggleGroup || !eligible} onClick={() => onToggleGroup?.(group)}>
          <span className="mm-mobile-switch" aria-hidden="true"><i /></span>
        </button>
      </div>
      <div className="mm-bus-route-list" ref={listRef} key={group}
        onScroll={event => {
          const list = event.currentTarget
          setCanScrollMore(list.scrollHeight - list.clientHeight - list.scrollTop > 2)
        }}>
        {routes.map(route => {
          const on = visibleRoutes.has(route.id)
          const inactive = inactiveRoutes?.has(route.id) ?? false
          const description = localName(lang, route)
          const status = inactive ? t.noServiceToday : on ? t.mobileBusShown : t.mobileBusHidden
          return <button type="button" className="mm-bus-route" key={route.id} role="switch"
            aria-label={description === route.name ? route.name : `${route.name} · ${description}`}
            aria-checked={on} aria-describedby={`${id}-status-${route.id}`}
            title={description} disabled={inactive || !onToggleRoute} onClick={() => onToggleRoute?.(route.id)}>
            <strong className="mm-bus-route-badge mm-mono" data-length={route.name.length > 3 ? 'long' : route.name.length}>{route.name}</strong>
            <span className="mm-bus-route-status" id={`${id}-status-${route.id}`}><i aria-hidden="true" />{status}</span>
            <span className="mm-bus-route-check" aria-hidden="true"><MobileLayerIcon name={on ? 'check' : 'plus'} size={20} /></span>
          </button>
        })}
      </div>
      <button type="button" className="mm-bus-scroll" disabled={!canScrollMore}
        onClick={() => listRef.current?.scrollBy({ top: listRef.current.clientHeight * .75,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}>
        <MobileLayerIcon name="chevronDown" size={18} /><span>{t.mobileBusScroll}</span>
      </button>
    </section>}
  </div>
}
