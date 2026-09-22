import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../i18n'
import { OldMapsFileSchema } from '../dataSchemas'
import { OldMapControls } from './OldMapControls'

const maps = OldMapsFileSchema.parse(JSON.parse(readFileSync('public/data/old-maps.json', 'utf8'))).maps
afterEach(() => vi.unstubAllGlobals())

it.each(['zh', 'en', 'pt'])('renders one atlas switch with all three original source credits in %s', lang => {
  vi.stubGlobal('localStorage', { getItem: () => lang })
  const html = renderToStaticMarkup(<I18nProvider><OldMapControls maps={maps} enabled opacity={1} onToggle={() => {}} /></I18nProvider>)
  expect(html.match(/class="mm-old-map-option"/g)).toHaveLength(12)
  expect(html.match(/class="mm-old-map-year mm-mono mm-tabular">1912</g)).toHaveLength(1)
  expect(html.match(/<details /g)).toHaveLength(12)
  expect(html.match(/class="mm-old-map-year mm-mono mm-tabular">1780s</g)).toHaveLength(1)
  for (const id of ['cartografia-1912', 'taipa-1912', 'coloane-1912', 'bellin-1749', 'hogg-1780s']) {
    const sheet = maps.find(map => map.id === id)!
    expect(html).toContain(sheet.scan.url.replaceAll('&', '&amp;'))
  }
})
