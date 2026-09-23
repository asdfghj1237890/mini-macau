import type { OldMap } from '../types'
import { useI18n } from '../i18n'
import { groupOldMaps, oldMapGroupLabel } from '../oldMaps'
import './oldMapSwitcher.css'

// The phone's on-map HISTORICAL MAPS stepper: the arrows move to the previous /
// next plate in date order without opening the layer sheet, so two eras can be
// compared while the map stays in view; the middle opens the full list. It docks
// where the time bar would be, or under the top row while the time bar is up.
export function OldMapSwitcher({ maps, selected, dock, onSelect, onOpen }: {
  maps: OldMap[]
  selected: string | null
  dock: 'top' | 'bottom'
  onSelect: (id: string) => void
  onOpen: () => void
}) {
  const { lang, t } = useI18n()
  const groups = groupOldMaps(maps)
  const index = groups.findIndex(group => group.id === selected)
  if (index < 0) return null
  const current = oldMapGroupLabel(groups[index], lang)
  const previous = groups[index - 1]
  const next = groups[index + 1]
  const step = (group: typeof previous, label: string, glyph: string) => {
    const target = group ? oldMapGroupLabel(group, lang) : null
    return (
      <button type="button" className="mm-old-map-switcher-step" disabled={!group}
        aria-label={target ? `${label}: ${target.year} ${target.title}` : label}
        onClick={() => group && onSelect(group.id)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={glyph} /></svg>
      </button>
    )
  }
  return (
    <nav className="mm-old-map-switcher" data-dock={dock} aria-label={t.oldMaps}>
      {step(previous, t.oldMapsPrevious, 'M15 18l-6-6 6-6')}
      <button type="button" className="mm-old-map-switcher-current" onClick={onOpen}
        aria-label={`${t.oldMapsChoose}: ${current.year} ${current.title}`}>
        <b className="mm-mono mm-tabular">{current.year}</b>
        <span>{current.title}</span>
      </button>
      {step(next, t.oldMapsNext, 'M9 18l6-6-6-6')}
    </nav>
  )
}
