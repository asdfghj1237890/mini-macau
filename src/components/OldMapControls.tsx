import type { OldMap } from '../types'
import { useI18n } from '../i18n'
import { NO_HIDDEN_OLD_MAPS, OLD_MAPS_MIN_OPACITY, groupOldMaps, isOldMapHidden, oldMapGroupLabel, oldMapLegendLabel, oldMapNotes, oldMapTitle, type OldMapSet } from '../oldMaps'
import './oldMapControls.css'

export function OldMapControls({ maps, hidden = NO_HIDDEN_OLD_MAPS, enabled, opacity, onToggle, onOpacity }: {
  maps: OldMap[]
  hidden?: OldMapSet
  enabled: boolean
  opacity: number
  onToggle?: (id: string) => void
  onOpacity?: (value: number) => void
}) {
  const { lang, t } = useI18n()
  const groups = groupOldMaps(maps)
  const selected = groups.filter(group => !isOldMapHidden(hidden, group.id))
  const percent = Math.round(opacity * 100)
  return (
    <div className="mm-old-map-controls">
      <div className="mm-old-map-list">
        {groups.map(group => {
          const on = !isOldMapHidden(hidden, group.id)
          const label = oldMapGroupLabel(group, lang)
          return (
            <button key={group.id} type="button" className="mm-old-map-option"
              aria-pressed={on} data-visible={enabled && on}
              disabled={!onToggle} onClick={() => onToggle?.(group.id)}
              title={group.maps.map(map => oldMapTitle(map, lang)).join('\n')}>
              <span className="mm-old-map-year mm-mono mm-tabular">{label.year}</span>
              <span className="mm-old-map-copy">
                <span className="mm-old-map-title">{label.title}</span>
                <span className="mm-old-map-subtitle">{label.detail}</span>
              </span>
              <span className="mm-old-map-check" aria-hidden="true">{on ? '✓' : ''}</span>
            </button>
          )
        })}
      </div>
      <label className="mm-old-map-opacity">
        <span>{t.oldMapsOpacity}</span>
        <input type="range" min={OLD_MAPS_MIN_OPACITY * 100} max={100} step={5}
          value={percent} disabled={!onOpacity} aria-label={t.oldMapsOpacity} aria-valuetext={`${percent}%`}
          onChange={event => onOpacity?.(Number(event.target.value) / 100)} />
        <span className="mm-mono mm-tabular">{percent}%</span>
      </label>
      {selected.map(group => (
        <details key={group.id} className="mm-old-map-info">
          <summary>{oldMapGroupLabel(group, lang).year} · {oldMapGroupLabel(group, lang).title} · {t.oldMapsDetails}</summary>
          {group.maps.map(map => (
            <section key={map.id} className="mm-old-map-sheet">
              {group.maps.length > 1 && <h4>{oldMapLegendLabel(map, lang).title}</h4>}
              <p className="mm-old-map-info-title">{oldMapTitle(map, lang)}</p>
              <p>{oldMapNotes(map, lang)}</p>
              <p>{t.oldMapsScan}: <a href={map.scan.url} target="_blank" rel="noopener noreferrer">{map.scan.holder}</a></p>
              <p>{map.attribution}</p>
            </section>
          ))}
        </details>
      ))}
    </div>
  )
}
