import { useId, useMemo, type CSSProperties } from 'react'
import { localName, useI18n } from '../i18n'
import type { LRTLine, Station } from '../types'
import { MobileLayerIcon } from './MobileLayerIcon'
import './mobileLrtConsole.css'

export function MobileLrtConsole({ lines, stations, enabled, onToggle }: {
  lines: LRTLine[]
  stations: Station[]
  enabled?: ReadonlySet<string>
  onToggle?: (id: string) => void
}) {
  const { lang, t } = useI18n()
  const id = useId()
  const stationById = useMemo(() => new Map(stations.map(station => [station.id, station])), [stations])
  const active = lines.filter(line => !enabled || enabled.has(line.id)).length

  return <div className="mm-lrt-console">
    <div className="mm-lrt-console-heading">
      <h3>{t.mobileLrtTitle}</h3>
      <span><span className="mm-mono">{active} / {lines.length}</span> {t.mobileLrtShown}</span>
    </div>
    <div className="mm-lrt-channels">
      {lines.map(line => {
        const on = !enabled || enabled.has(line.id)
        return <section key={line.id} className="mm-lrt-channel" data-line={line.id} data-enabled={on}
          aria-labelledby={`${id}-${line.id}-title`} style={{ '--lrt-color': line.color } as CSSProperties}>
          <header className="mm-lrt-channel-heading">
            <MobileLayerIcon name="tram" size={36} />
            <h4 id={`${id}-${line.id}-title`}>{localName(lang, line)}</h4>
            <span className="mm-mono">{line.name.replace(/ Line$/, '')}</span>
          </header>
          <div className="mm-lrt-track">
            <ol className="mm-lrt-stations" aria-label={`${localName(lang, line)} · ${t.stations}`}>
              {line.stations.map((stationId, index) => {
                const station = stationById.get(stationId)
                const name = station ? localName(lang, station) : stationId
                const endpoint = index === 0 || index === line.stations.length - 1
                return <li key={stationId} data-endpoint={endpoint} title={name}>
                  <span className="mm-lrt-station-marker" aria-hidden="true" />
                  {endpoint ? <span className="mm-lrt-endpoint">
                    <strong>{name}</strong>
                    {lang === 'zh' && station && <small className="mm-mono">{station.name}</small>}
                  </span> : <span className="sr-only">{name}</span>}
                </li>
              })}
            </ol>
          </div>
          <div className="mm-lrt-channel-control">
            <button type="button" className="mm-lrt-line-switch" role="switch"
              aria-label={localName(lang, line)} aria-checked={on}
              aria-describedby={`${id}-${line.id}-status ${id}-${line.id}-count`}
              disabled={!onToggle} onClick={() => onToggle?.(line.id)}>
              <span className="mm-lrt-control-face" aria-hidden="true"><MobileLayerIcon name={on ? 'check' : 'plus'} size={27} /></span>
            </button>
            <span className="mm-lrt-line-status" id={`${id}-${line.id}-status`}>{on ? t.mobileLrtShown : t.mobileLrtHidden}</span>
            <span className="mm-lrt-station-count" id={`${id}-${line.id}-count`}>
              <span className="mm-mono">{line.stations.length}</span> {t.mobileLrtStations}
            </span>
          </div>
        </section>
      })}
    </div>
  </div>
}
