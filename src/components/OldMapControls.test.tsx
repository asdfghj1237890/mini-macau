import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../i18n'
import { OldMapsFileSchema } from '../dataSchemas'
import { OldMapControls } from './OldMapControls'

const maps = OldMapsFileSchema.parse(JSON.parse(readFileSync('public/data/old-maps.json', 'utf8'))).maps
afterEach(() => vi.unstubAllGlobals())

function render(lang: string, selected: string | null) {
  // The provider reads the saved language only in a browser.
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: () => lang })
  return renderToStaticMarkup(<I18nProvider><OldMapControls maps={maps} selected={selected} enabled opacity={1} onSelect={() => {}} /></I18nProvider>)
}

it.each(['zh', 'en', 'pt'])('renders one atlas row with all three original source credits in %s', lang => {
  const html = render(lang, 'atlas-1912')
  expect(html.match(/class="mm-old-map-option"/g)).toHaveLength(13)
  expect(html.match(/type="radio"/g)).toHaveLength(13)
  expect(html.match(/checked=""/g)).toHaveLength(1)
  expect(html.match(/class="mm-old-map-year mm-mono mm-tabular">1912</g)).toHaveLength(1)
  expect(html.match(/class="mm-old-map-year mm-mono mm-tabular">1780s</g)).toHaveLength(1)
  // Notes and sources open under the chosen row only.
  expect(html.match(/<details /g)).toHaveLength(1)
  for (const id of ['cartografia-1912', 'taipa-1912', 'coloane-1912']) {
    const sheet = maps.find(map => map.id === id)!
    expect(html).toContain(sheet.scan.url.replaceAll('&', '&amp;'))
  }
})

it.each(['bellin-1749', 'hogg-1780s'])('credits the scan of %s when it is chosen', id => {
  const html = render('en', id)
  const sheet = maps.find(map => map.id === id)!
  expect(html).toContain(sheet.scan.url.replaceAll('&', '&amp;'))
})

it.each([
  ['zh', ['18 世紀', '19 世紀', '20 世紀']],
  ['en', ['18th century', '19th century', '20th century']],
  ['pt', ['Século XVIII', 'Século XIX', 'Século XX']],
])('files the rows under their centuries in %s', (lang, headings) => {
  const html = render(lang as string, null)
  expect(html.match(/class="mm-old-map-century-heading">[^<]+</g))
    .toEqual((headings as string[]).map(text => `class="mm-old-map-century-heading">${text}<`))
  expect(html).not.toContain('<details ')
})
