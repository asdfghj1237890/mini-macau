// Save the public GPX paths linked by MO Transport's route pages.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const source = JSON.parse(readFileSync('data/bus_reference/amaral-terminal.json', 'utf8'))
const routes = JSON.parse(readFileSync('public/data/bus-routes.json', 'utf8'))
const selected = process.argv.slice(2)
const ids = [...new Set([...source.platforms.flatMap(p => p.routes.map(r => r.id)), '102', 'H3'])].filter(id =>
  routes.some(r => r.id === id) && (!selected.length || selected.includes(id)))
const destination = 'data/bus_reference/amaral-route-paths.json'
let saved = {}
try { saved = JSON.parse(readFileSync(destination, 'utf8')) } catch { /* initial capture */ }
mkdirSync('data/raw/amaral-routes', { recursive: true })
for (const id of ids) {
  const pageUrl = `https://motransportinfo.com/zh/route/${id}/0`
  const response = await fetch(pageUrl)
  if (!response.ok) throw new Error(`${pageUrl}: ${response.status}`)
  const html = await response.text()
  writeFileSync(`data/raw/amaral-routes/${id}.html`, html)
  const direction = html.match(/var direction = '([^']+)'/)?.[1]
  if (!direction || !html.includes("new L.GPX('../../../gpx/'+routeno+'_'+direction+'.gpx")) throw new Error(`Missing GPX link for ${id}`)
  const names = [direction]
  if (html.includes("new L.GPX('../../../gpx/'+routeno+'_'+direction_reverse+'.gpx")) names.push(html.match(/var direction_reverse = '([^']+)'/)[1])
  const paths = []
  for (const name of names) {
    if (!/^[A-Za-z]+$/.test(name)) throw new Error('Unexpected GPX filename')
    const url = `https://motransportinfo.com/gpx/${id}_${name}.gpx`
    const result = await fetch(url)
    if (!result.ok) throw new Error(`${url}: ${result.status}`)
    const xml = await result.text()
    const coordinates = [...xml.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g)].map(m => [Number(m[2]), Number(m[1])])
    if (coordinates.length < 10) throw new Error(`Incomplete GPX for ${id}`)
    paths.push({ url, coordinates })
  }
  saved[id] = { pageUrl, checkedAt: new Date().toISOString().slice(0, 10), paths }
  writeFileSync(destination, JSON.stringify(saved) + '\n')
  console.log(`${id}: ${paths.length} GPX paths`)
}
