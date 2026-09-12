/** Strongly connected waiting groups. A bus may have more than one blocker
 * (its physical leader and a crossing reservation); following only one edge
 * can omit the very reservation owner that must participate in recovery. */
export function closedWaitGroups<T>(states: readonly T[], waitsFor: (state: T) => readonly T[]): T[][] {
  const eligible = new Set(states), indices = new Map<T, number>(), low = new Map<T, number>()
  const stack: T[] = [], stacked = new Set<T>(), groups: T[][] = []
  const visit = (state: T) => {
    const index = indices.size
    indices.set(state, index); low.set(state, index); stack.push(state); stacked.add(state)
    for (const other of waitsFor(state)) {
      if (!eligible.has(other)) continue
      if (!indices.has(other)) { visit(other); low.set(state, Math.min(low.get(state)!, low.get(other)!)) }
      else if (stacked.has(other)) low.set(state, Math.min(low.get(state)!, indices.get(other)!))
    }
    if (low.get(state) !== index) return
    const group: T[] = []
    let other: T
    do { other = stack.pop()!; stacked.delete(other); group.push(other) } while (other !== state)
    if (group.length > 1) groups.push(group)
  }
  for (const state of states) if (!indices.has(state)) visit(state)
  return groups
}

/** Include every dependency when extending a blocked group's queue. */
export function waitsForGroup<T>(state: T, group: ReadonlySet<T>, waitsFor: (state: T) => readonly T[]): boolean {
  const pending = [state], seen = new Set<T>()
  while (pending.length) {
    const next = pending.pop()!
    if (group.has(next)) return true
    if (seen.has(next)) continue
    seen.add(next)
    pending.push(...waitsFor(next))
  }
  return false
}

/** Cycles and queue outlets need progress; upstream queues inherit the wait. */
export function progressWaitGroups<T>(states: readonly T[], waitsFor: (state: T) => readonly T[]): T[][] {
  return [...closedWaitGroups(states, waitsFor), ...states.filter(state => !waitsFor(state).length).map(state => [state])]
}
