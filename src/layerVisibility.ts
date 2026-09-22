import type { CityLayer } from './cityData'

export interface LayerSwitches {
  city: Record<CityLayer, (on: boolean) => void>
  transit: () => void
}

// An explicit one-shot action. Normal switches never call this, and there is
// no restore snapshot that could overwrite layers the user adds afterwards.
export function showOnlyCityLayer(layer: CityLayer, switches: LayerSwitches): void {
  switches.transit()
  for (const id of Object.keys(switches.city) as CityLayer[]) switches.city[id](id === layer)
}

type Overlay = 'water' | 'power' | 'buses' | 'lrt'
interface LayoutTarget {
  getLayer(id: string): unknown
  setLayoutProperty(id: string, name: 'visibility', value: 'visible' | 'none'): unknown
}

// Sources shared with the full dataset need explicit visibility. Each group
// depends only on its own switch, including after a basemap style reload.
export function applyOverlayVisibility(
  map: LayoutTarget,
  visible: Record<Overlay, boolean>,
  groups: Record<Overlay, readonly string[]>,
): void {
  for (const key of Object.keys(groups) as Overlay[]) {
    for (const id of groups[key]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible[key] ? 'visible' : 'none')
    }
  }
}

export function applyLrtVisibility(map: LayoutTarget, allLineIds: string[], selectedLineIds: string[], is3D: boolean): void {
  const selected = new Set(selectedLineIds)
  for (const id of allLineIds) {
    for (const [layer, on] of [
      [`lrt-line-${id}`, selected.has(id)],
      [`lrt-viaduct-${id}`, selected.has(id) && is3D],
    ] as const) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none')
    }
  }
}
