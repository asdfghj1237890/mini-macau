import { useId } from 'react'
import type { OldMap } from '../types'
import { useI18n } from '../i18n'
import { OLD_MAPS_MIN_OPACITY, groupOldMaps, groupOldMapsByCentury, oldMapGroupLabel, oldMapLegendLabel, oldMapNotes, oldMapTitle } from '../oldMaps'
import './oldMapControls.css'

// The HISTORICAL MAPS key, shared by the desktop card and the phone sheet:
// the opacity first, then one radio row per selector row filed by century.
// Only the chosen row opens to its second line and its notes and sources.
export function OldMapControls({ maps, selected, enabled, opacity, onSelect, onOpacity }: {
  maps: OldMap[]
  selected: string | null
  enabled: boolean
  opacity: number
  onSelect?: (id: string) => void
  onOpacity?: (value: number) => void
}) {
  const { lang, t } = useI18n()
  const name = useId()
  const centuries = groupOldMapsByCentury(groupOldMaps(maps))
  const percent = Math.round(opacity * 100)
  return (
    <div className="mm-old-map-controls">
      <label className="mm-old-map-opacity">
        <span>{t.oldMapsOpacity}</span>
        <input type="range" min={OLD_MAPS_MIN_OPACITY * 100} max={100} step={5}
          value={percent} disabled={!onOpacity} aria-label={t.oldMapsOpacity} aria-valuetext={`${percent}%`}
          onChange={event => onOpacity?.(Number(event.target.value) / 100)} />
        <span className="mm-mono mm-tabular">{percent}%</span>
      </label>
      <div className="mm-old-map-list" role="radiogroup" aria-label={t.oldMaps}>
        {centuries.map(({ century, groups }) => (
          <div key={century} className="mm-old-map-century">
            <div className="mm-old-map-century-heading">{t.oldMapsCentury(century)}</div>
            {groups.map(group => {
              const on = group.id === selected
              const label = oldMapGroupLabel(group, lang)
              return (
                <div key={group.id} className="mm-old-map-item" data-selected={on}>
                  <label className="mm-old-map-option" data-visible={enabled && on}
                    title={group.maps.map(map => oldMapTitle(map, lang)).join('\n')}>
                    <input type="radio" className="mm-old-map-radio" name={name} value={group.id}
                      checked={on} disabled={!onSelect} onChange={() => onSelect?.(group.id)} />
                    <span className="mm-old-map-year mm-mono mm-tabular">{label.year}</span>
                    <span className="mm-old-map-title">{label.title}</span>
                    <span className="mm-old-map-dot" aria-hidden="true" />
                  </label>
                  {on && (
                    <div className="mm-old-map-selected">
                      <p className="mm-old-map-subtitle">{label.detail}</p>
                      <details className="mm-old-map-info">
                        <summary>{t.oldMapsDetails}</summary>
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
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
