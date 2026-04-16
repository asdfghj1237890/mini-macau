"""
Generate LRT timetable data based on known service parameters.
Taipa Line: 6:30-23:15, ~5-10 min frequency, ~36 min journey
Seac Pai Van Line: same hours, ~6 min frequency, ~3 min journey
Hengqin Line: same hours, ~6 min frequency, ~4 min journey

Each entry has arrivalMinutes and departureMinutes to model station dwell time.
"""

import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "output"

LINES = {
    "taipa": {
        "stations": [
            "Barra", "Ocean", "Jockey_Club", "Stadium", "Pai_Kok",
            "Cotai_West", "Lotus", "East_Asian_Games", "Cotai_East",
            "MUST", "Airport", "Taipa_Ferry_Terminal",
        ],
        # Travel time in minutes between consecutive stations
        "segment_times": [5, 2, 2, 2, 2, 2, 3, 3, 2, 3, 3],
        "dwell": 0.75,  # 45 seconds at each intermediate station
        "terminal_dwell": 2.0,  # 2 minutes at terminal stations
        "frequency": 6,
        "service_start": 6 * 60 + 30,  # 06:30
        "service_end": 23 * 60 + 15,   # 23:15
    },
    "seac_pai_van": {
        "stations": ["Union_Hospital", "Seac_Pai_Van"],
        "segment_times": [3],
        "dwell": 0.75,
        "terminal_dwell": 2.0,
        "frequency": 6,
        "service_start": 6 * 60 + 30,
        "service_end": 23 * 60 + 15,
    },
    "hengqin": {
        "stations": ["Lotus", "Hengqin"],
        "segment_times": [4],
        "dwell": 0.75,
        "terminal_dwell": 3.0,
        "frequency": 6,
        "service_start": 6 * 60 + 30,
        "service_end": 23 * 60 + 15,
    },
}


def generate_trips_for_line(line_id: str, config: dict) -> list[dict]:
    """Generate forward and backward trips throughout the service day."""
    trips = []
    stations = config["stations"]
    seg_times = config["segment_times"]
    freq = config["frequency"]
    start = config["service_start"]
    end = config["service_end"]
    dwell = config["dwell"]
    terminal_dwell = config["terminal_dwell"]

    total_journey = sum(seg_times) + dwell * (len(stations) - 2) + terminal_dwell
    trip_counter = 0

    # Forward trips (first station -> last station)
    dep = start
    while dep + total_journey <= end + 10:
        entries = []
        t = dep
        for i, sid in enumerate(stations):
            is_terminal = (i == 0 or i == len(stations) - 1)
            dw = terminal_dwell if is_terminal else dwell
            arr = round(t, 2)
            dept = round(t + dw, 2)
            entries.append({
                "stationId": sid,
                "arrivalMinutes": arr,
                "departureMinutes": dept,
            })
            if i < len(seg_times):
                t = dept + seg_times[i]
            else:
                t = dept
        trips.append({
            "id": f"{line_id}_F{trip_counter:04d}",
            "lineId": line_id,
            "direction": "forward",
            "entries": entries,
        })
        trip_counter += 1
        dep += freq

    # Backward trips (last station -> first station)
    rev_stations = list(reversed(stations))
    rev_seg_times = list(reversed(seg_times))
    dep = start + freq // 2
    while dep + total_journey <= end + 10:
        entries = []
        t = dep
        for i, sid in enumerate(rev_stations):
            is_terminal = (i == 0 or i == len(rev_stations) - 1)
            dw = terminal_dwell if is_terminal else dwell
            arr = round(t, 2)
            dept = round(t + dw, 2)
            entries.append({
                "stationId": sid,
                "arrivalMinutes": arr,
                "departureMinutes": dept,
            })
            if i < len(rev_seg_times):
                t = dept + rev_seg_times[i]
            else:
                t = dept
        trips.append({
            "id": f"{line_id}_B{trip_counter:04d}",
            "lineId": line_id,
            "direction": "backward",
            "entries": entries,
        })
        trip_counter += 1
        dep += freq

    return trips


def run():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_trips = []
    for line_id, config in LINES.items():
        trips = generate_trips_for_line(line_id, config)
        all_trips.extend(trips)
        fwd = sum(1 for t in trips if t["direction"] == "forward")
        bwd = sum(1 for t in trips if t["direction"] == "backward")
        journey = sum(config["segment_times"]) + config["dwell"] * (len(config["stations"]) - 2) + config["terminal_dwell"]
        print(f"  {line_id}: {fwd}F + {bwd}B = {len(trips)} trips, {journey:.1f}min journey")

    out_path = OUTPUT_DIR / "trips.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(all_trips, f, ensure_ascii=False, indent=2)

    print(f"Total: {len(all_trips)} trips written to {out_path}")


if __name__ == "__main__":
    run()
