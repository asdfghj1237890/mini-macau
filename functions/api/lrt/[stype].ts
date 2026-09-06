import type { PagesFunction } from '@cloudflare/workers-types'
import { serveLrt } from '../../../server/lrt-api'
import monThu from '../../_lrt/trips-mon_thu.json'
import friday from '../../_lrt/trips-friday.json'
import satSun from '../../_lrt/trips-sat_sun.json'

// These private files are staged by deploy.yml and bundled into the Worker,
// never the static assets. Serialise once per isolate, not per request.
const bodies = {
  mon_thu: JSON.stringify(monThu),
  friday: JSON.stringify(friday),
  sat_sun: JSON.stringify(satSun),
}

export const onRequest: PagesFunction = ({ request, params }) =>
  serveLrt(request, params.stype, bodies)
