import type { CityLayerItem } from './CityLayerList'
import { useI18n } from '../i18n'

export function CityLayerLoadState({ row }: { row: CityLayerItem }) {
  const { t } = useI18n()
  if (row.loadStatus !== 'loading' && row.loadStatus !== 'error') return null
  return <div className="mm-city-load-state" role="status">
    <span>{row.loadStatus === 'loading' ? t.loading : t.layerLoadFailed}</span>
    {row.loadStatus === 'error' && <button type="button" onClick={row.retry}
      aria-label={`${t.layerLoadRetry}: ${row.label}`}>{t.layerLoadRetry}</button>}
  </div>
}
