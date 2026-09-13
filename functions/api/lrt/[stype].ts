import type { PagesFunction } from '@cloudflare/workers-types'
import { serveLrt } from '../../../server/lrt-api'
import { createLrtWindowProvider } from '../../../server/lrt-window'
import type { LRTLine, Station, Trip } from '../../../src/types'
import lines from '../../../public/data/lrt-lines.json'
import stations from '../../../public/data/stations.json'
import monThu from '../../_lrt/trips-mon_thu.json'
import friday from '../../_lrt/trips-friday.json'
import satSun from '../../_lrt/trips-sat_sun.json'

// Indexing is shared by requests in this isolate.
const provide = createLrtWindowProvider({
  lrtLines: lines as LRTLine[],
  stations: stations as Station[],
  trips: [...monThu, ...friday, ...satSun] as Trip[],
})
export const onRequest: PagesFunction = ({ request, params }) =>
  serveLrt(request, params.stype, provide)
