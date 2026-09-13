import type { BusRoadProfile } from '../types'

export interface BusPassage {
  keys: string[]; entryM: number; exitM: number; approaches?: Record<string, number>
  zones?: { key?: string; entryM: number; exitM: number }[]
}

/** Claims are acquired together before entry. Overlapping intersections cannot
 * leave a bus holding one lock while waiting inside it for another lock. */
// A reservation starts before the junction so a bus commits with room to
// stop, and ends past it so the tail is clear; consecutive zones closer than
// the link gap are claimed together (see above). Shorter pads than the
// original 14/8 m keep the roundabout arcs at Amaral from fusing into single
// 90-145 m chains that admitted one bus at a time: in the 18:00 replay the
// queue on the bridge landing fell from 19 to 13 buses and the longest hold
// from 510 s to 348 s, with no overlaps. Splitting chains at stops instead
// was tried and rejected: it left buses holding one zone while waiting for
// the next, and long stalls tripled.
export const PASSAGE_ENTRY_PAD_M = 8, PASSAGE_EXIT_PAD_M = 4, PASSAGE_LINK_GAP_M = 2

export function buildBusPassages(profile: BusRoadProfile | undefined, lengthM: number, circular = true): BusPassage[] {
  if (!profile?.junctions || !lengthM) return []
  const intervals = profile.junctions.map(j => ({ keys: [j.id], approaches: { [j.id]: j.bearing ?? 0 }, entryM: Math.max(0, j.start * lengthM - PASSAGE_ENTRY_PAD_M), exitM: Math.min(lengthM, j.end * lengthM + PASSAGE_EXIT_PAD_M) }))
    .sort((a, b) => a.entryM - b.entryM)
  const passages: BusPassage[] = []
  for (const interval of intervals) {
    const last = passages.at(-1)
    if (last && interval.entryM <= last.exitM + PASSAGE_LINK_GAP_M) {
      last.exitM = Math.max(last.exitM, interval.exitM)
      last.keys = [...new Set([...last.keys, ...interval.keys])]
      last.approaches = { ...interval.approaches, ...last.approaches }
      last.zones!.push({ key: interval.keys[0], entryM: interval.entryM, exitM: interval.exitM })
    } else passages.push({ ...interval, zones: [{ key: interval.keys[0], entryM: interval.entryM, exitM: interval.exitM }] })
  }
  const first = passages[0], last = passages.at(-1)
  if (circular && passages.length > 1 && first.entryM <= .01 && last!.exitM >= lengthM - .01) {
    first.entryM = last!.entryM - lengthM
    first.keys = [...new Set([...last!.keys, ...first.keys])]
    first.approaches = { ...last!.approaches, ...first.approaches }
    first.zones = [...last!.zones!.map(z => ({ ...z, entryM: z.entryM - lengthM, exitM: z.exitM - lengthM })), ...first.zones!]
    passages.pop()
  }
  return passages
}

export function passageAtDistance(passages: BusPassage[], lengthM: number, distanceM: number, circular = true): BusPassage | undefined {
  if (!passages.length || lengthM <= 0) return undefined
  const leg = Math.floor(Math.max(0, distanceM) / lengthM), returning = !circular && leg % 2 === 1
  const local = distanceM - leg * lengthM
  const reverse = (p: BusPassage) => ({ keys: p.keys, entryM: lengthM - p.exitM, exitM: lengthM - p.entryM,
    zones: p.zones?.map(z => ({ ...z, entryM: lengthM - z.exitM, exitM: lengthM - z.entryM })).reverse(),
    approaches: Object.fromEntries(Object.entries(p.approaches ?? {}).map(([key, bearing]) => [key, (bearing + 180) % 360])) })
  const list = returning ? [...passages].reverse().map(reverse) : passages
  let lo = 0, hi = list.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid].exitM <= local + .01) lo = mid + 1; else hi = mid }
  const next = list[lo]
  const offset = (p: BusPassage, base: number) => ({ ...p, entryM: p.entryM + base, exitM: p.exitM + base,
    zones: p.zones?.map(z => ({ ...z, entryM: z.entryM + base, exitM: z.exitM + base })) })
  if (next) return offset(next, leg * lengthM)
  const first = circular || returning ? passages[0] : reverse(passages.at(-1)!)
  return offset(first, (leg + 1) * lengthM)
}
