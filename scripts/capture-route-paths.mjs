// Save the public GPX paths linked by MO Transport's route pages for every
// bus route (or the ids given), in batches, to data/bus_reference/route-paths.json.
// Same page/GPX parsing as capture-amaral-route-paths.mjs; the Amaral file stays
// the terminal pipeline's input.
import { readFileSync, writeFileSync } from 'node:fs'
const routes = JSON.parse(readFileSync('public/data/bus-routes.json', 'utf8'))
const selected = process.argv.slice(2).filter(a => !a.startsWith('--'))
const batchSize = Number((process.argv.find(a => a.startsWith('--batch=')) ?? '--batch=10').slice(8))
const pauseMs = Number((process.argv.find(a => a.startsWith('--pause=')) ?? '--pause=400').slice(8))
const ids = routes.map(r => r.id).filter(id => !selected.length || selected.includes(id))
const destination = 'data/bus_reference/route-paths.json'
let saved = {}
try { saved = JSON.parse(readFileSync(destination, 'utf8')) } catch { /* initial capture */ }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// A reader (the inspector) holding the file open makes the write fail on Windows; retry briefly.
const save = async () => {
  for (let attempt = 0; ; attempt++) {
    try { writeFileSync(destination, JSON.stringify(saved) + '\n'); return } catch (error) {
      if (attempt >= 10) throw error
      await sleep(500)
    }
  }
}
const get = async url => {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (mini-macau route check)' } })
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return response.text()
}
for (let batch = 0; batch * batchSize < ids.length; batch++) {
  const slice = ids.slice(batch * batchSize, (batch + 1) * batchSize)
  console.log(`batch ${batch + 1}: ${slice.join(' ')}`)
  for (const id of slice) {
    try {
      const pageUrl = `https://motransportinfo.com/zh/route/${id}/0`
      const html = await get(pageUrl)
      const direction = html.match(/var direction = '([^']+)'/)?.[1]
      if (!direction || !html.includes("new L.GPX('../../../gpx/'+routeno+'_'+direction+'.gpx")) throw new Error('Missing GPX link')
      const names = [direction]
      if (html.includes("new L.GPX('../../../gpx/'+routeno+'_'+direction_reverse+'.gpx")) names.push(html.match(/var direction_reverse = '([^']+)'/)[1])
      const paths = []
      for (const name of names) {
        if (!/^[A-Za-z]+$/.test(name)) throw new Error('Unexpected GPX filename')
        await sleep(pauseMs)
        const url = `https://motransportinfo.com/gpx/${id}_${name}.gpx`
        const xml = await get(url)
        const coordinates = [...xml.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g)].map(m => [Number(m[2]), Number(m[1])])
        if (coordinates.length < 10) throw new Error(`Incomplete GPX ${url}`)
        paths.push({ url, coordinates })
      }
      saved[id] = { pageUrl, checkedAt: new Date().toISOString().slice(0, 10), paths }
      console.log(`  ${id}: ${paths.map(p => `${p.url.split('/').pop()} ${p.coordinates.length} pts`).join(', ')}`)
    } catch (error) {
      saved[id] = { pageUrl: `https://motransportinfo.com/zh/route/${id}/0`, checkedAt: new Date().toISOString().slice(0, 10), error: String(error.message ?? error) }
      console.log(`  ${id}: ERROR ${saved[id].error}`)
    }
    await save()
    await sleep(pauseMs)
  }
}
console.log(`saved ${Object.keys(saved).length} routes to ${destination}`)
