import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../i18n'
import { OldMapsFileSchema } from '../dataSchemas'
import { OldMapSwitcher } from './OldMapSwitcher'

const maps = OldMapsFileSchema.parse(JSON.parse(readFileSync('public/data/old-maps.json', 'utf8'))).maps
afterEach(() => vi.unstubAllGlobals())

function render(selected: string | null, dock: 'top' | 'bottom' = 'bottom', lang = 'zh') {
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: () => lang })
  return renderToStaticMarkup(<I18nProvider>
    <OldMapSwitcher maps={maps} selected={selected} dock={dock} onSelect={() => {}} onOpen={() => {}} />
  </I18nProvider>)
}

it('renders nothing until a map is chosen', () => {
  expect(render(null)).toBe('')
  expect(render('not-a-map')).toBe('')
})

it('cannot step before the first map', () => {
  const html = render('bellin-1749')
  const [previous, next] = html.match(/<button type="button" class="mm-old-map-switcher-step"[^>]*>/g)!
  expect(previous).toContain('disabled=""')
  expect(previous).toContain('aria-label="上一張地圖"')
  expect(next).not.toContain('disabled')
  expect(next).toContain('aria-label="下一張地圖: 1780s 霍格版・澳門與離島航道"')
  expect(html).toContain('aria-label="選擇歷史地圖: 1749 貝林・澳門城廓與內港"')
})

it('steps to the neighbouring maps in date order, the 1912 atlas as one stop', () => {
  const html = render('atlas-1912', 'top', 'en')
  expect(html).toContain('data-dock="top"')
  expect(html).toContain('aria-label="Previous map: 1893 Sauvage · manuscript survey"')
  expect(html).toContain('aria-label="Next map: 1927 Macau new harbour &amp; reclamation plans"')
  expect(html).not.toContain('disabled')
})

it('cannot step past the last map', () => {
  const last = maps[maps.length - 1].id
  const html = render(last)
  const [, next] = html.match(/<button type="button" class="mm-old-map-switcher-step"[^>]*>/g)!
  expect(next).toContain('disabled=""')
})
