// Request metadata and response summaries only: never log timetable contents.
import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'

const allowEdgeChallenge = process.argv.includes('--allow-edge-challenge')
const bases = process.argv.slice(2).filter(arg => arg !== '--allow-edge-challenge')
if (!bases.length) throw new Error('Usage: node scripts/verify-lrt-api.mjs <base-url> [base-url...]')
const production = 'https://mini-map-macau.app'
const preview = 'https://review.mini-map-macau.pages.dev'
class EdgeChallengeError extends Error {}
async function verify(base) {
  const host = new URL(base).hostname
  const redirected = /^(?:[a-z0-9-]+\.)?mini-map-macau\.pages\.dev$/.test(host)
  async function check(stype, headers, status, method = 'GET') {
    const res = await fetch(new URL(`/api/lrt/${stype}`, base), {
      method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000),
    })
    const context = JSON.stringify({ base, method, stype, status: res.status,
      cacheControl: res.headers.get('Cache-Control'),
      mitigation: res.headers.get('cf-mitigated'), ray: res.headers.get('cf-ray'),
    })
    if (res.status === 403 && res.headers.get('cf-mitigated') === 'challenge') {
      await res.body?.cancel()
      throw new EdgeChallengeError(context)
    }
    assert.equal(res.status, status, context)
    if (status !== 200) assert.equal(res.headers.get('Cache-Control'), 'no-store', context)
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
      // Cloudflare may append Accept-Encoding when compressing the response.
      const vary = (res.headers.get('Vary') ?? '').toLowerCase().split(',').map(value => value.trim())
      assert.ok(vary.includes('origin') && vary.includes('referer'), 'Missing source cache variants')
      assert.match(res.headers.get('Content-Type') ?? '', /application\/json/)
      const trips = await res.json()
      assert.ok(Array.isArray(trips) && trips.length > 0, 'Expected a nonempty trip array')
    }
  }
  console.log(`${base}: LRT API checks passed${redirected ? ' (redirect only)' : ''}.`)
}

let verified = 0
for (const base of bases) {
  // Deployment aliases can take a moment to reach every edge. Retry briefly,
  // but still fail the deployment if the actual protection checks do not pass.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await verify(base)
      verified++
      break
    } catch (error) {
      if (allowEdgeChallenge && error instanceof EdgeChallengeError) {
        // Explicit opt-in for hosted runners: do not weaken the site's bot
        // policy just to run a probe. Local Worker checks still run in CI;
        // report the missing live coverage, and require another live endpoint.
        console.warn(`::warning title=Cloudflare challenge blocked live verification::${error.message}`)
        break
      }
      if (attempt === 4) throw error
      console.warn(`${base}: verification attempt ${attempt} failed: ${error.message}`)
      await setTimeout(10000)
    }
  }
}
assert.ok(verified > 0, 'No live endpoint could be verified; all were challenged')
