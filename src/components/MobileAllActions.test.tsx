import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../i18n'
import type { LRTLine } from '../types'
import { MobileLrtConsole } from './MobileLrtConsole'
import { MobileServiceTickets } from './MobileServiceTickets'

afterEach(() => vi.unstubAllGlobals())

function render(node: ReactNode) {
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: () => 'zh' })
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>)
}

const pair = (html: string) => html.match(/<div class="mm-mobile-all-actions">(.*?)<\/div>/)?.[1] ?? ''
const line = { id: 'taipa', name: 'Taipa Line', nameCn: '氹仔線', namePt: 'Linha da Taipa', color: '#8dc63f', stations: [], geometry: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } } as unknown as LRTLine

it('offers show-all and hide-all for the LRT lines', () => {
  const html = pair(render(<MobileLrtConsole lines={[line]} stations={[]} enabled={new Set()} onShowAll={() => {}} onHideAll={() => {}} />))
  expect(html).toContain('>全部顯示<')
  expect(html).toContain('>全部隱藏<')
  expect(html).not.toContain('disabled')
})

it('offers show-all and hide-all for flights and ferries together', () => {
  const html = pair(render(<MobileServiceTickets flightCount={0} ferryCount={0} showFlights showFerries
    flightsOn={false} ferriesOn={false} onShowAll={() => {}} onHideAll={() => {}} />))
  expect(html).toContain('>全部顯示<')
  expect(html).toContain('>全部隱藏<')
  expect(html).not.toContain('disabled')
})

it('disables the pair when no handler is wired', () => {
  const html = pair(render(<MobileServiceTickets flightCount={0} ferryCount={0} showFlights showFerries flightsOn={false} ferriesOn={false} />))
  expect(html.match(/disabled=""/g)).toHaveLength(2)
})
