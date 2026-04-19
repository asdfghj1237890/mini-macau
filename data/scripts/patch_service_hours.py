"""
Recompute serviceHoursStart / serviceHoursEnd / frequency in
public/data/bus-routes.json from the detailed schedule in
data/bus_reference/routes.json, using the fixed midnight-crossing logic
from fetch_bus_data.compute_service_summary.

Previous logic treated e.g. "20:00-01:15" as ending at 01:15 same-day,
so max(all_ends) picked an earlier period's end (20:00). Routes that
actually run past midnight were being cut off at ~20:00.
"""

import json
from pathlib import Path

from fetch_bus_data import compute_service_summary

REFERENCE = Path(__file__).parent.parent / "bus_reference" / "routes.json"
TARGET = Path(__file__).parent.parent.parent / "public" / "data" / "bus-routes.json"


def run():
    ref = json.load(open(REFERENCE, "r", encoding="utf-8"))
    target = json.load(open(TARGET, "r", encoding="utf-8"))

    ref_by_id = {r["id"]: r for r in ref}

    patched = 0
    for route in target:
        rid = route["id"]
        r = ref_by_id.get(rid)
        if not r:
            continue
        sched = r.get("schedule")
        if not sched:
            continue
        summary = compute_service_summary(sched)
        old_start = route.get("serviceHoursStart")
        old_end = route.get("serviceHoursEnd")
        new_start = summary["start_hour"]
        new_end = summary["end_hour"]
        if old_end != new_end or old_start != new_start:
            print(f"  {rid}: {old_start}-{old_end} -> {new_start}-{new_end}")
            route["serviceHoursStart"] = new_start
            route["serviceHoursEnd"] = new_end
            patched += 1

    with open(TARGET, "w", encoding="utf-8") as f:
        json.dump(target, f, ensure_ascii=False, indent=2)

    print(f"\nPatched {patched}/{len(target)} routes in {TARGET}")


if __name__ == "__main__":
    run()
