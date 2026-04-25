"""
Trip-matching v7: v6 + COE-END short-turn rule.

Adds:
  - BWD: TFT → COE accepted as legitimate short-turn (symmetric to COE-START).
  - EAG-START removed (we determined those were actually COE-START with
    COE.md transcription errors; fix the source instead).
"""

import io
import re
import sys
import statistics
from pathlib import Path
from collections import Counter

import numpy as np
from scipy.optimize import linear_sum_assignment

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).parent.parent / "timetable_verified"

TAIPA_FWD = [
    "BAR", "OCE", "JOC", "STA", "PAK", "COW", "LOT",
    "HU",  "EAG", "COE", "MUST", "AIR", "TFT",
]
TAIPA_BWD = list(reversed(TAIPA_FWD))
DEPOT_NEIGHBORS = {"PAK", "COW", "LOT"}

# Hypothetical short-turn start stations (per direction)
SHORT_TURN_STARTS = {
    "BWD": {"COE"},
    "FWD": set(),
}
# Hypothetical short-turn end stations (per direction): trips that START at the
# terminus but END mid-line at one of these stations are accepted.
SHORT_TURN_ENDS = {
    "BWD": {"COE"},
    "FWD": set(),
}

MIN_SPAN = 3
FIRST_HOUR_END = 7 * 60
LAST_HOUR_START = 23 * 60

SCHEDULES = [
    ("Mon-Thu",  "星期一 至 星期四"),
    ("Friday",   "星期五"),
    ("Sat/Sun",  "星期六 / 星期日"),
]

SKIP_PENALTY = 1000.0
INF = 10**9


def parse_md(path):
    text = path.read_text(encoding="utf-8")
    out = {}
    for chunk in re.split(r"\n## ", text)[1:]:
        h = chunk.splitlines()[0]
        sk = next((k for k, m in SCHEDULES if m in h), None)
        if sk is None: continue
        out[sk] = {}
        for d in re.split(r"\n### ", chunk)[1:]:
            dh = d.splitlines()[0]
            dk = "FWD" if "往氹仔" in dh else ("BWD" if "往媽閣" in dh else None)
            if not dk: continue
            m = re.search(r"```\s*\n(.*?)\n```", d, re.DOTALL)
            if not m: continue
            hours = {}
            for line in m.group(1).splitlines():
                hm = re.match(r"^(\d{1,2}):\s*(.*)$", line.strip())
                if hm:
                    hours[int(hm.group(1))] = [int(x) for x in hm.group(2).split()]
            out[sk][dk] = hours
    return out


def to_abs_list(hours):
    return sorted(h * 60 + m for h, mins in hours.items() for m in mins)


def fmt(t):
    return f"{t // 60:02d}:{t % 60:02d}"


def estimate_pair_median(a, b):
    deltas = []
    for at in a:
        for bt in b:
            if bt < at: continue
            if bt > at + 8: break
            deltas.append(bt - at); break
    return int(statistics.median(deltas)) if deltas else 2


def match_pair_hungarian(a_list, b_list, median, lo_off=-2, hi_off=3):
    n, m = len(a_list), len(b_list)
    if n == 0 or m == 0:
        return [None] * n, [None] * m
    lo, hi = max(1, median + lo_off), median + hi_off
    size = n + m
    cost = np.full((size, size), INF, dtype=float)
    for i, at in enumerate(a_list):
        for j, bt in enumerate(b_list):
            d = bt - at
            if lo <= d <= hi:
                cost[i, j] = abs(d - median)
    for i in range(n):
        for k in range(n):
            cost[i, m + k] = SKIP_PENALTY if k == i else INF
    for j in range(m):
        for k in range(m):
            cost[n + k, j] = SKIP_PENALTY if k == j else INF
    cost[n:, m:] = 0.0
    row_ind, col_ind = linear_sum_assignment(cost)
    a_to_b = [None] * n
    b_to_a = [None] * m
    for r, c in zip(row_ind, col_ind):
        if r < n and c < m and cost[r, c] < SKIP_PENALTY:
            a_to_b[r] = c
            b_to_a[c] = r
    return a_to_b, b_to_a


def build_chains(order, lists, all_matches):
    successors, has_pred = {}, set()
    for i in range(len(order) - 1):
        a_to_b, _ = all_matches[(order[i], order[i + 1])]
        for ai, bj in enumerate(a_to_b):
            if bj is not None:
                successors[(i, ai)] = (i + 1, bj)
                has_pred.add((i + 1, bj))
    chains, visited = [], set()
    for i, st in enumerate(order):
        for j in range(len(lists[st])):
            if (i, j) in visited or (i, j) in has_pred: continue
            chain, cur = [], (i, j)
            while cur is not None:
                visited.add(cur)
                ci, cj = cur
                chain.append((ci, cj, lists[order[ci]][cj]))
                cur = successors.get(cur)
            chains.append(chain)
    return chains


def reconstruct(data, order, schedule, direction):
    valid = [s for s in order if data.get(s, {}).get(schedule, {}).get(direction)]
    if not valid: return [], []
    lists = {s: to_abs_list(data[s][schedule][direction]) for s in valid}
    matches = {}
    for i in range(len(valid) - 1):
        a, b = valid[i], valid[i + 1]
        med = estimate_pair_median(lists[a], lists[b])
        matches[(a, b)] = match_pair_hungarian(lists[a], lists[b], med)
    return build_chains(valid, lists, matches), valid


def classify(chain, valid_order, direction):
    n = len(valid_order)
    s_idx = chain[0][0]
    e_idx = chain[-1][0]
    span = e_idx - s_idx
    start_st = valid_order[s_idx]
    end_st = valid_order[e_idx]
    start_t = chain[0][2]
    end_t = chain[-1][2]

    if span < MIN_SPAN:
        return "TOO-SHORT", start_st, start_t, end_st, end_t, span

    starts_origin = s_idx == 0
    ends_dest = e_idx == n - 1

    if starts_origin and ends_dest:
        return "FULL", start_st, start_t, end_st, end_t, span

    accepted_starts = SHORT_TURN_STARTS.get(direction, set())
    accepted_ends = SHORT_TURN_ENDS.get(direction, set())

    if not starts_origin and ends_dest and start_st in accepted_starts:
        return f"{start_st}-START", start_st, start_t, end_st, end_t, span
    if starts_origin and not ends_dest and end_st in accepted_ends:
        return f"{end_st}-END", start_st, start_t, end_st, end_t, span

    if not starts_origin and ends_dest:
        if start_t < FIRST_HOUR_END:
            return "FIRST-HOUR-DEPOT-START", start_st, start_t, end_st, end_t, span
        return "MID-DAY-DEPOT-START", start_st, start_t, end_st, end_t, span
    if starts_origin and not ends_dest:
        if start_t < FIRST_HOUR_END:
            return "FIRST-HOUR-SHORT-TURN", start_st, start_t, end_st, end_t, span
        if end_t >= LAST_HOUR_START and end_st in DEPOT_NEIGHBORS:
            return "LAST-HOUR-DEPOT-RETURN", start_st, start_t, end_st, end_t, span
        return "MID-DAY-SHORT-TURN", start_st, start_t, end_st, end_t, span
    return "PARTIAL", start_st, start_t, end_st, end_t, span


def main():
    data = {c: parse_md(ROOT / f"{c}.md") for c in TAIPA_FWD if (ROOT / f"{c}.md").exists()}
    grand = Counter()
    suspect_log = []
    short_log = []

    SUSPECT_CATS = ("MID-DAY-DEPOT-START", "MID-DAY-SHORT-TURN", "PARTIAL", "TOO-SHORT")

    for sched, _ in SCHEDULES:
        for label, order in [("FWD 往氹仔碼頭", TAIPA_FWD), ("BWD 往媽閣", TAIPA_BWD)]:
            direction = "FWD" if "FWD" in label else "BWD"
            chains, valid = reconstruct(data, order, sched, direction)
            print()
            print("=" * 92)
            print(f"  {sched}  |  {label}  (v7: + COE-END)")
            print("=" * 92)

            cats = Counter()
            buckets = {}
            for c in chains:
                cat, ss, st, es, et, sp = classify(c, valid, direction)
                cats[cat] += 1
                grand[cat] += 1
                buckets.setdefault(cat, []).append((ss, st, es, et, sp, len(c)))

            print(f"  Total chains: {len(chains)}")
            for k in sorted(cats.keys(), key=lambda x: (-cats[x], x)):
                print(f"    {k:26s}: {cats[k]}")

            for k in SUSPECT_CATS:
                if buckets.get(k):
                    print()
                    print(f"  ❗ {k} ({len(buckets[k])}):")
                    for ss, st, es, et, sp, n_st in buckets[k]:
                        print(f"     {ss:5s} {fmt(st)} -> {es:5s} {fmt(et)}  (span {sp}, {n_st} stations)")
                        if k == "TOO-SHORT":
                            short_log.append((sched, direction, ss, st, es, et, sp, n_st))
                        else:
                            suspect_log.append((sched, direction, ss, st, es, et, sp, n_st))

    print()
    print("=" * 92)
    print(f"  GRAND TOTAL (v7)")
    print("=" * 92)
    for k in sorted(grand.keys(), key=lambda x: (-grand[x], x)):
        print(f"    {k:26s}: {grand[k]}")

    suspect_total = sum(grand[k] for k in SUSPECT_CATS if k != "TOO-SHORT")
    print()
    print(f"  Suspect (≥ {MIN_SPAN}-span, mid-day partials): {suspect_total}")
    print(f"  TOO-SHORT chains: {grand['TOO-SHORT']}")

    if suspect_log:
        print()
        print("  -- Remaining suspect trips --")
        for sched, direction, ss, st, es, et, sp, n in suspect_log:
            print(f"    {sched:8s} {direction:3s}  {ss:5s} {fmt(st)} -> {es:5s} {fmt(et)}  span={sp}, {n} st.")

    if short_log:
        print()
        print("  -- TOO-SHORT chains --")
        for sched, direction, ss, st, es, et, sp, n in short_log:
            print(f"    {sched:8s} {direction:3s}  {ss:5s} {fmt(st)} -> {es:5s} {fmt(et)}  span={sp}, {n} st.")


if __name__ == "__main__":
    main()
