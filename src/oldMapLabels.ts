import type { LayerSpecification, Map, SymbolLayerSpecification } from 'maplibre-gl'

type LabelMap = Pick<Map, 'setPaintProperty' | 'setLayoutProperty'> & { getLayer(id: string): unknown }
type LabelLayout = Pick<NonNullable<SymbolLayerSpecification['layout']>, 'text-transform' | 'text-size'>

// Modern labels need their own contrast against the scan's ink and paper,
// regardless of the surrounding UI theme. These are map colours, not UI tokens.
const PAPER_LABEL_PAINT = {
  'text-color': '#302b24',
  'text-halo-color': '#fff8e8',
  'text-halo-width': 1.4,
  'text-halo-blur': 0.3,
} as const

const LABEL_SOURCE_LAYERS = new Set(['place', 'poi', 'transportation_name', 'water_name', 'waterway'])

function paperLabelLayout(layer: SymbolLayerSpecification): LabelLayout {
  const layout: LabelLayout = { 'text-transform': 'none' }
  if (layer['source-layer'] === 'poi') {
    layout['text-size'] = ['interpolate', ['linear'], ['zoom'], 14, 12, 18, 14]
  } else if (layer['source-layer'] === 'transportation_name' || layer['source-layer'] === 'waterway') {
    layout['text-size'] = ['interpolate', ['linear'], ['zoom'], 14, 11, 18, 13]
  }
  return layout
}

// Capture a fresh basemap before app overlays are inserted. Recreate on every
// style load so toggling the theme cannot restore a previous theme's labels.
export class OldMapLabels {
  private readonly labels: { original: SymbolLayerSpecification; layout: LabelLayout }[]
  private active = false

  constructor(layers: LayerSpecification[]) {
    this.labels = layers
      .filter((layer): layer is SymbolLayerSpecification => layer.type === 'symbol'
        && !!layer.layout?.['text-field'] && LABEL_SOURCE_LAYERS.has(layer['source-layer'] ?? ''))
      .map(layer => ({ original: structuredClone(layer), layout: paperLabelLayout(layer) }))
  }

  sync(map: LabelMap, active: boolean): void {
    // Plate selection and opacity changes do not require reshaping the labels.
    if (this.active === active) return
    for (const { original, layout } of this.labels) {
      if (!map.getLayer(original.id)) continue
      for (const key of Object.keys(PAPER_LABEL_PAINT) as (keyof typeof PAPER_LABEL_PAINT)[]) {
        map.setPaintProperty(original.id, key, active ? PAPER_LABEL_PAINT[key] : original.paint?.[key])
      }
      for (const key of Object.keys(layout) as (keyof LabelLayout)[]) {
        map.setLayoutProperty(original.id, key, active ? layout[key] : original.layout?.[key])
      }
    }
    this.active = active
  }
}
