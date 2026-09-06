// Request metadata and response summaries only: never log timetable contents.
import assert from 'node:assert/strict'

const bases = process.argv.slice(2)
if (!bases.length) throw new Error('Usage: node scripts/verify-lrt-api.mjs <base-url> [base-url...]')
const production = 'https://mini-map-macau.app'
const preview = 'https://review.mini-map-macau.pages.dev'
for (const base of bases) {
  const host = new URL(base).hostname
  const redirected = /^(?:[a-z0-9-]+\.)?mini-map-macau\.pages\.dev$/.test(host)
  async function check(stype, headers, status, method = 'GET') {
    const res = await fetch(new URL(`/api/lrt/${stype}`, base), {
      method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000),
    })
    assert.equal(res.status, status, `${base}: ${method} ${stype}`)
    if (status !== 200) assert.equal(res.headers.get('Cache-Control'), 'no-store')
    return res
  }
  await check('friday', {}, 403)
  await check('friday', { 'Sec-Fetch-Site': 'same-origin' }, 403)
  await check('friday', { Origin: 'https://example.org', Referer: production, 'Sec-Fetch-Site': 'same-origin' }, 403)
  await check('friday', { Origin: 'null', Referer: production }, 403)
  for (const stype of ['invalid', 'toString', '__proto__', 'constructor']) {
    await check(stype, { Referer: production }, 404)
  }
  await check('friday', { Referer: production }, 405, 'POST')
  for (const stype of ['mon_thu', 'friday', 'sat_sun']) {
    const res = await check(stype, { Origin: preview }, redirected ? 307 : 200)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), preview)
    assert.match(res.headers.get('X-Robots-Tag') ?? '', /noindex/)
    if (redirected) {
      assert.equal(res.headers.get('Location'), `${production}/api/lrt/${stype}`)
      assert.equal(await res.text(), '')
    } else {
      assert.equal(res.headers.get('Cache-Control'), 'private, max-age=3600')
      assert.equal(res.headers.get('Vary'), 'Origin, Referer')
      assert.match(res.headers.get('Content-Type') ?? '', /application\/json/)
      const trips = await res.json()
      assert.ok(Array.isArray(trips) && trips.length > 0, 'Expected a nonempty trip array')
    }
  }
  console.log(`${base}: LRT API checks passed${redirected ? ' (redirect only)' : ''}.`)
}
