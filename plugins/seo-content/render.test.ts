import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderTransitLists, type SeoTransitData } from './render'

function loadJson(rel: string): unknown {
  const p = fileURLToPath(new URL(`../../public/data/${rel}`, import.meta.url))
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

type RawRoute = { id: string; name: string; nameCn: string }
type RawStation = { id: string; name: string; nameCn: string; namePt?: string }
type RawLine = { id: string; name: string; nameCn: string; namePt?: string; stations: string[] }
type RawFerryFile = { routes: Array<{ nameZh: string; nameEn: string; journeyMinutes: number | null }> }

function realData(): SeoTransitData {
  const ferry = loadJson('ferry-schedules.json') as RawFerryFile
  return {
    busRoutes: loadJson('bus-routes.json') as RawRoute[],
    stations: loadJson('stations.json') as RawStation[],
    lrtLines: loadJson('lrt-lines.json') as RawLine[],
    ferryRoutes: ferry.routes,
  }
}

describe('renderTransitLists', () => {
  it('lists every bus route number and Chinese endpoints', () => {
    const data = realData()
    const html = renderTransitLists(data)
    for (const r of data.busRoutes) {
      expect(html).toContain(`>${r.name}</`)
      expect(html).toContain(r.nameCn)
    }
  })

  it('renders bus groups in GROUP_ORDER order', () => {
    const html = renderTransitLists(realData())
    const labels = ['澳門半島', '跨海路線', '氹仔/路氹', '夜間巴士', '特班/特定服務']
    const positions = labels.map(l => html.indexOf(l))
    for (const pos of positions) expect(pos).toBeGreaterThan(-1)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
  })

  it('lists every LRT station with Chinese and English names', () => {
    const data = realData()
    const html = renderTransitLists(data)
    for (const s of data.stations) {
      expect(html).toContain(s.nameCn)
      expect(html).toContain(s.name)
    }
    for (const line of data.lrtLines) {
      expect(html).toContain(line.nameCn)
      expect(html).toContain(line.name)
    }
  })

  it('lists every ferry route in both languages', () => {
    const data = realData()
    const html = renderTransitLists(data)
    for (const f of data.ferryRoutes) {
      expect(html).toContain(f.nameZh)
      expect(html).toContain(f.nameEn)
    }
  })

  it('escapes HTML in all interpolated fields', () => {
    const data: SeoTransitData = {
      busRoutes: [{ id: 'X1', name: '<script>', nameCn: 'a & "b"' }],
      stations: [{ id: 'S', name: '<i>', nameCn: '站', namePt: "p'" }],
      lrtLines: [{ id: 'L', name: '<line>', nameCn: '線', stations: ['S'] }],
      ferryRoutes: [{ nameZh: '航<線>', nameEn: 'Route & Co', journeyMinutes: 60 }],
    }
    const html = renderTransitLists(data)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<i>')
    expect(html).not.toContain('<line>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; &quot;b&quot;')
    expect(html).toContain('航&lt;線&gt;')
  })

  it('shows Portuguese station name only when it differs from English', () => {
    const data: SeoTransitData = {
      busRoutes: [],
      stations: [
        { id: 'A', name: 'Barra', nameCn: '媽閣', namePt: 'Barra' },
        { id: 'B', name: 'Ocean', nameCn: '海洋', namePt: 'Oceano' },
      ],
      lrtLines: [{ id: 'L', name: 'Test Line', nameCn: '測試線', stations: ['A', 'B'] }],
      ferryRoutes: [],
    }
    const html = renderTransitLists(data)
    expect(html).toContain('海洋 Ocean / Oceano')
    expect(html).toContain('媽閣 Barra')
    expect(html).not.toContain('Barra / Barra')
  })
})
