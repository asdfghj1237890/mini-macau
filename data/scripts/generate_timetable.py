"""
Generate LRT timetable data from EXACT official MLM departure timetable images.

Sources (Mon-Thu schedule):
  - TT_BAR_2026.jpg      → Barra → TFT (forward, Taipa Line)
  - TT_OCE_2026.jpg      → Ocean both dirs (verification)
  - TT_JOC_2026.jpg      → Jockey Club both dirs (verification)
  - TT_HU_2025.jpg       → Union Hospital → Seac Pai Van (forward, SPV Line)
  - TT_SPV_2025.jpg      → Seac Pai Van → Union Hospital (backward, SPV Line)
  - TT_HQL_LOT_2026_03.jpg → Lotus → Hengqin (forward, Hengqin Line)
  - TT_HQL_HQ_2026_03.jpg  → Hengqin → Lotus (backward, Hengqin Line)
"""

import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# ── Taipa Line ──────────────────────────────────────────────────────
# 13 stations, ~28 min journey
TAIPA_STATIONS = [
    "Barra", "Ocean", "Jockey_Club", "Stadium", "Pai_Kok",
    "Cotai_West", "Lotus", "Union_Hospital", "East_Asian_Games",
    "Cotai_East", "MUST", "Airport", "Taipa_Ferry_Terminal",
]
# Segment travel times (minutes). Barra→Ocean = 4 min (Sai Van Bridge).
# Remaining 11 segments = 2 min each. Total travel = 4 + 22 = 26 min.
# Verified against intermediate station timetables (Stadium, Pai Kok, etc.):
# Barra 06:30 → Ocean 06:34 → JC 06:36 → Stadium 06:39 → PK 06:41 →
# CW 06:43 → Lotus 06:45 → UH 06:47 → EAG 06:49 → CE 06:51 →
# MUST 06:53 → Airport 06:55 → TFT ~06:57
# Dwell 0.1 min (6 sec) × 11 intermediate = 1.1 min → total ~27.1 min
TAIPA_SEGMENT_TIMES = [4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
TAIPA_DWELL = 0.1
TAIPA_TERMINAL_DWELL = 0.0

# EXACT departures from Barra → TFT, Mon-Thu (from TT_BAR_2026.jpg, updated 2026.02)
BARRA_FWD_DEPARTURES: dict[int, list[int]] = {
    6:  [30, 40, 50],
    7:  [1, 7, 13, 19, 25, 31, 37, 43, 50, 56, 59],
    8:  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 38, 45, 51, 57],
    9:  [3, 11, 18, 26, 34, 41, 49, 56],
    10: [4, 12, 19, 27, 35, 42, 50, 58],
    11: [5, 13, 21, 28, 34, 40, 47, 53, 59],
    12: [5, 11, 17, 23, 29, 35, 42, 48, 54],
    13: [0, 6, 12, 18, 24, 31, 37, 43, 49, 55],
    14: [1, 7, 13, 19, 26, 31, 36, 41, 46, 51, 56],
    15: [1, 6, 11, 17, 22, 27, 32, 37, 42, 47, 52, 58],
    16: [3, 8, 13, 18, 23, 28, 33, 38, 43, 49, 54, 59],
    17: [5, 10, 15, 20, 25, 30, 35, 41, 46, 51, 56],
    18: [1, 6, 11, 17, 22, 27, 32, 37, 42, 47, 53, 58],
    19: [3, 8, 13, 18, 23, 28, 33, 38, 43, 49, 54, 59],
    20: [4, 9, 14, 19, 24, 29, 35, 41, 47, 53, 59],
    21: [5, 11, 18, 24, 31, 37, 43, 49, 55],
    22: [1, 7, 13, 19, 25, 32, 38, 44, 50, 56],
    23: [2, 8, 15],
}

# EXACT departures from TFT → Barra, Mon-Thu (from TT_TFT_2026.jpg, updated 2026.02)
TFT_BWD_DEPARTURES: dict[int, list[int]] = {
    6:  [30, 40, 51],
    7:  [1, 11, 21, 31, 37, 43, 49, 52, 55],
    8:  [2, 8, 14, 20, 26, 32, 38, 41, 44, 51, 57],
    9:  [6, 15, 24, 33, 41, 49, 56],
    10: [4, 12, 19, 27, 35, 42, 50, 57],
    11: [5, 13, 20, 28, 36, 43, 51, 59],
    12: [5, 11, 17, 23, 29, 35, 41, 48, 54],
    13: [0, 6, 12, 18, 24, 30, 37, 43, 49, 55],
    14: [1, 7, 13, 19, 25, 32, 38, 44, 50, 56],
    15: [1, 7, 13, 19, 25, 32, 38, 44, 50, 56],
    16: [3, 8, 13, 18, 23, 28, 34, 39, 44, 49, 54, 59],
    17: [4, 10, 15, 20, 25, 30, 35, 40, 46, 51, 56],
    18: [1, 6, 11, 16, 22, 27, 32, 37, 42, 47, 52, 57],
    19: [3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 54, 59],
    20: [4, 9, 14, 19, 24, 29, 37, 44, 52],
    21: [0, 6, 12, 18, 24, 30, 37, 43, 49, 55],
    22: [1, 7, 13, 19, 25, 32, 38, 44, 50, 56],
    23: [2, 9, 15],
}

# ── Seac Pai Van Line ───────────────────────────────────────────────
# 2 stations, ~2 min journey, 6 min frequency
SPV_STATIONS = ["Union_Hospital", "Seac_Pai_Van"]
SPV_SEGMENT_TIMES = [2]
SPV_DWELL = 0.0
SPV_TERMINAL_DWELL = 0.0

# Union Hospital → Seac Pai Van, Mon-Thu (TT_HU_2025.jpg, updated 2025.11)
UH_TO_SPV: dict[int, list[int]] = {
    6:  [33, 39, 45, 51, 57],
    7:  [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    8:  [4, 10, 16, 22, 28, 34, 40, 45, 51, 57],
    9:  [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    10: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    11: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    12: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    13: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    14: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    15: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    16: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    17: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    18: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    19: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    20: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57],
    21: [3, 9, 15, 21, 27, 34, 40, 46, 52, 58],
    22: [4, 10, 16, 22, 28, 35, 41, 47, 53, 59],
    23: [5, 12, 20, 29, 38],
}

# Seac Pai Van → Union Hospital, Mon-Thu (TT_SPV_2025.jpg, updated 2025.11)
SPV_TO_UH: dict[int, list[int]] = {
    6:  [30, 36, 42, 48, 54],
    7:  [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    8:  [0, 7, 13, 19, 25, 31, 37, 43, 48, 54],
    9:  [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    10: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    11: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    12: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    13: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    14: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    15: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    16: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    17: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    18: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    19: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    20: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54],
    21: [0, 6, 12, 18, 24, 31, 37, 43, 49, 55],
    22: [1, 7, 13, 19, 25, 31, 38, 44, 50, 56],
    23: [2, 8, 15],
}

# ── Hengqin Line ────────────────────────────────────────────────────
# 2 stations, ~2 min journey (2.2km tunnel crossing)
HQ_STATIONS = ["Lotus", "Hengqin"]
HQ_SEGMENT_TIMES = [3]
HQ_DWELL = 0.0
HQ_TERMINAL_DWELL = 0.0

# Lotus → Hengqin, Mon-Thu (TT_HQL_LOT_2026_03.jpg, updated 2026.03)
LOT_TO_HQ: dict[int, list[int]] = {
    6:  [33, 39, 46, 52, 58],
    7:  [5, 11, 18, 24, 30, 37, 43, 50, 56],
    8:  [2, 9, 15, 22, 28, 34, 41, 47, 54],
    9:  [0, 10, 16, 22, 29, 35, 41, 47, 54],
    10: [0, 6, 12, 19, 25, 31, 37, 44, 50, 56],
    11: [2, 8, 15, 21, 27, 33, 40, 46, 52, 58],
    12: [5, 11, 17, 23, 29, 36, 42, 48, 54],
    13: [1, 7, 13, 19, 26, 32, 38, 44, 51, 57],
    14: [3, 9, 15, 22, 28, 34, 40, 47, 53, 59],
    15: [5, 12, 18, 24, 30, 36, 43, 49, 55],
    16: [1, 8, 14, 20, 26, 33, 39, 45, 51, 58],
    17: [4, 10, 16, 22, 33, 39, 45, 52, 58],
    18: [5, 11, 17, 24, 30, 37, 43, 49, 56],
    19: [2, 9, 15, 21, 28, 34, 41, 47, 53],
    20: [0, 6, 13, 19, 25, 32, 42, 48, 54],
    21: [1, 7, 13, 19, 25, 32, 38, 44, 50, 57],
    22: [3, 9, 15, 22, 28, 34, 40, 47, 53, 59],
    23: [5, 11, 20, 28, 37],
}

# Hengqin → Lotus, Mon-Thu (TT_HQL_HQ_2026_03.jpg, updated 2026.03)
HQ_TO_LOT: dict[int, list[int]] = {
    6:  [30, 36, 42, 49, 55],
    7:  [2, 8, 14, 21, 27, 34, 40, 46, 53, 59],
    8:  [6, 12, 18, 25, 31, 38, 44, 50, 57],
    9:  [7, 13, 19, 26, 32, 38, 44, 50, 57],
    10: [3, 9, 15, 22, 28, 34, 40, 47, 53, 59],
    11: [5, 12, 18, 24, 30, 36, 43, 49, 55],
    12: [1, 8, 14, 20, 26, 33, 39, 45, 51, 57],
    13: [1, 7, 13, 19, 26, 32, 38, 44, 51, 57],
    14: [3, 9, 15, 21, 27, 33, 40, 46, 52, 58],
    15: [2, 8, 15, 21, 27, 33, 40, 46, 52, 58],
    16: [4, 11, 17, 23, 29, 36, 42, 48, 54],
    17: [1, 7, 13, 19, 29, 36, 42, 49, 55],
    18: [1, 8, 14, 21, 27, 33, 40, 46, 53, 59],
    19: [2, 9, 15, 21, 28, 34, 41, 47, 53],
    20: [3, 9, 16, 22, 29, 39, 45, 51, 57],
    21: [1, 7, 13, 19, 25, 32, 38, 44, 50, 56],
    22: [3, 9, 15, 22, 28, 34, 40, 47, 53, 59],
    23: [2, 8, 15],
}


def build_trip_entries(
    stations: list[str],
    seg_times: list[float],
    dep_minute: float,
    dwell: float,
    terminal_dwell: float,
) -> list[dict]:
    entries = []
    t = dep_minute
    for i, sid in enumerate(stations):
        is_first = (i == 0)
        is_last = (i == len(stations) - 1)
        if is_first:
            dw = terminal_dwell
        elif is_last:
            dw = terminal_dwell
        else:
            dw = dwell
        entries.append({
            "stationId": sid,
            "arrivalMinutes": round(t, 2),
            "departureMinutes": round(t + dw, 2),
        })
        if i < len(seg_times):
            t = round(t + dw + seg_times[i], 2)
    return entries


def generate_trips_from_departures(
    line_id: str,
    stations: list[str],
    seg_times: list[float],
    dwell: float,
    terminal_dwell: float,
    fwd_departures: dict[int, list[int]],
    bwd_departures: dict[int, list[int]],
) -> list[dict]:
    trips = []
    rev_stations = list(reversed(stations))
    rev_seg_times = list(reversed(seg_times))
    fwd_count = 0
    bwd_count = 0

    for hour in sorted(fwd_departures.keys()):
        for minute in fwd_departures[hour]:
            dep = hour * 60 + minute
            entries = build_trip_entries(
                stations, seg_times, dep, dwell, terminal_dwell
            )
            trips.append({
                "id": f"{line_id}_F{fwd_count:04d}",
                "lineId": line_id,
                "direction": "forward",
                "entries": entries,
            })
            fwd_count += 1

    for hour in sorted(bwd_departures.keys()):
        for minute in bwd_departures[hour]:
            dep = hour * 60 + minute
            entries = build_trip_entries(
                rev_stations, rev_seg_times, dep, dwell, terminal_dwell
            )
            trips.append({
                "id": f"{line_id}_B{bwd_count:04d}",
                "lineId": line_id,
                "direction": "backward",
                "entries": entries,
            })
            bwd_count += 1

    return trips, fwd_count, bwd_count


def run():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_trips = []

    taipa, fwd, bwd = generate_trips_from_departures(
        "taipa", TAIPA_STATIONS, TAIPA_SEGMENT_TIMES,
        TAIPA_DWELL, TAIPA_TERMINAL_DWELL,
        BARRA_FWD_DEPARTURES, TFT_BWD_DEPARTURES,
    )
    all_trips.extend(taipa)
    print(f"  taipa: {fwd}F + {bwd}B = {len(taipa)} trips")

    spv, fwd, bwd = generate_trips_from_departures(
        "seac_pai_van", SPV_STATIONS, SPV_SEGMENT_TIMES,
        SPV_DWELL, SPV_TERMINAL_DWELL,
        UH_TO_SPV, SPV_TO_UH,
    )
    all_trips.extend(spv)
    print(f"  seac_pai_van: {fwd}F + {bwd}B = {len(spv)} trips")

    hq, fwd, bwd = generate_trips_from_departures(
        "hengqin", HQ_STATIONS, HQ_SEGMENT_TIMES,
        HQ_DWELL, HQ_TERMINAL_DWELL,
        LOT_TO_HQ, HQ_TO_LOT,
    )
    all_trips.extend(hq)
    print(f"  hengqin: {fwd}F + {bwd}B = {len(hq)} trips")

    out_path = OUTPUT_DIR / "trips.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(all_trips, f, ensure_ascii=False, indent=2)
    print(f"Total: {len(all_trips)} trips written to {out_path}")

    sample = all_trips[0]
    first = sample["entries"][0]
    last = sample["entries"][-1]
    h1, m1 = divmod(first["arrivalMinutes"], 60)
    h2, m2 = divmod(last["arrivalMinutes"], 60)
    print(f"  Sample: {sample['id']} departs {int(h1):02d}:{m1:04.1f}, arrives {int(h2):02d}:{m2:04.1f}")


if __name__ == "__main__":
    run()
