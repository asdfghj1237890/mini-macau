import type { BusRoute } from './types'

const NIGHT_ROUTES = new Set(['N1A', 'N1B', 'N2', 'N3', 'N5', 'N6'])
const TAIPA_COTAI_ROUTES = new Set([
  'MT1', 'MT2', 'MT3', 'MT4', 'MT5',
  '11', '15', '50', '50B', '51', '51A', '51X', '52', '55', '56', '59',
  '35', '36', '37', '39', '71', '71S', '72', '73',
])
const SPECIAL_ROUTES = new Set([
  'AP1', 'AP1X', 'H1', 'H2', 'H3', '701X', '701XS', '101', '102', '103',
])
const CROSS_HARBOUR_ROUTES = new Set([
  '21A', '22', '25', '25AX', '25B', '25BS', '26', '26A', '27',
  '28A', '28B', '28C', '29', '30', '30X', '32', '33', '34',
  '60', '61', '65',
])

export type GroupKey = 'peninsula' | 'crossHarbour' | 'taipaCotai' | 'night' | 'special'

export function getRouteGroup(route: BusRoute): GroupKey {
  const id = route.id
  if (NIGHT_ROUTES.has(id)) return 'night'
  if (SPECIAL_ROUTES.has(id)) return 'special'
  if (TAIPA_COTAI_ROUTES.has(id)) return 'taipaCotai'
  if (CROSS_HARBOUR_ROUTES.has(id)) return 'crossHarbour'
  return 'peninsula'
}

export const GROUP_ORDER: GroupKey[] = ['peninsula', 'crossHarbour', 'taipaCotai', 'night', 'special']
export const GROUP_LABEL_KEYS: Record<GroupKey, 'groupPeninsula' | 'groupCrossHarbour' | 'groupTaipaCotai' | 'groupNight' | 'groupSpecial'> = {
  peninsula: 'groupPeninsula',
  crossHarbour: 'groupCrossHarbour',
  taipaCotai: 'groupTaipaCotai',
  night: 'groupNight',
  special: 'groupSpecial',
}
