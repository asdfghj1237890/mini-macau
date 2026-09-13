import { describe, expect, it } from 'vitest'
import { serveLrt } from './lrt-api'

// Synthetic fixtures only: these tests must run without the private timetable.
const at = Date.parse('2026-05-04T10:00:00+08:00')
const provide = (start: number) => ({ version: 1 as const, start, end: start + 120_000, vehicles: [], service: [] })
const site = 'https://mini-map-macau.app'
const preview = 'https://review-123.mini-map-macau.pages.dev'
function respond(headers: Record<string, string> = {}, stype: string | string[] | undefined = 'state', origin = site, method = 'GET', query = `?at=${at}`) {
  return serveLrt(new Request(`${origin}/api/lrt/${stype}${query}`, { headers, method }), stype, provide)
}

describe('LRT API access and routing', () => {
  it.each<Record<string, string>>([
    {},
    { 'Sec-Fetch-Site': 'same-origin' },
    { Origin: 'https://example.org', 'Sec-Fetch-Site': 'same-origin', Referer: site },
    { Origin: 'null', Referer: site },
    { Origin: '', Referer: site },
    { Origin: 'invalid', Referer: site },
    { Origin: `${site}/path`, Referer: site },
    { Referer: 'https://mini-map-macau.app.example.org/' },
    { Referer: 'http://mini-map-macau.app/' },
    { Referer: 'https://mini-map-macau.app:444/' },
    { Referer: 'https://user@mini-map-macau.app/' },
    { Origin: 'http://localhost:5173' },
    { Origin: 'https://a.b.mini-map-macau.pages.dev' },
  ])('rejects missing or untrusted sources: %j', headers => {
    const response = respond(headers)
    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })

  it('serves only a bounded state window without persistent caching', async () => {
    const response = respond({ Referer: site })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(provide(at))
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Vary')).toBe('Origin, Referer')
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
  })

  it.each(['mon_thu', 'friday', 'sat_sun'])('retires the %s bulk endpoint', async path => {
    const response = respond({ Referer: site }, path)
    expect(response.status).toBe(410)
    expect(await response.text()).toBe('Gone')
  })

  it.each(['', '?at=NaN', '?at=-1', '?at=0', `?at=${at + 1}`, `?at=${at}&at=${at}`,
    `?at=${at}&duration=86400`, `?at=${at}&to=${at + 86400000}`, '?at=9999999999999',
  ])('rejects invalid or expanded windows %s', query => {
    expect(respond({ Referer: site }, 'state', site, 'GET', query).status).toBe(400)
  })

  it.each(['', 'invalid', 'toString', '__proto__', 'constructor', ['friday', 'mon_thu']])('rejects invalid schedule %j', stype => {
    expect(respond({ Referer: site }, stype).status).toBe(404)
  })

  it.each(['POST', 'HEAD', 'OPTIONS'])('rejects %s instead of falling through to the SPA', method => {
    const response = respond({ Referer: site }, 'state', site, method)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
  })

  it('allows preview browsers to read the production API with scoped CORS', () => {
    const response = respond({ Origin: preview })
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(preview)
  })

  it.each(['https://mini-map-macau.pages.dev', preview])('redirects %s without a timetable body', async origin => {
    const response = respond({ Origin: preview }, 'state', origin)
    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe(`${site}/api/lrt/state?at=${at}`)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('')
  })

  it('rejects an unconfigured destination even with an allowed Referer', () => {
    expect(respond({ Referer: site }, 'state', 'https://example.org').status).toBe(403)
  })

  it('allows loopback sources only when testing on that same local origin', () => {
    const local = 'http://127.0.0.1:8788'
    expect(respond({ Referer: `${local}/` }, 'state', local).status).toBe(200)
    expect(respond({ Referer: `${local}/` }).status).toBe(403)
  })
})
