"""Re-extract pristine geometry for bridge routes that are CIRCULAR
(no backward stops). Needed because old already-patched geometry causes
the bridge patch to skip them.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from extract_bus_data import (
    REFERENCE_DIR, PUBLIC_DIR, WAYPOINT_HINTS,
    align_direction, build_route_geometry,
)


def main():
    routes_ref = json.load(open(REFERENCE_DIR / "routes.json", "r", encoding="utf-8"))
    stops_ref = json.load(open(REFERENCE_DIR / "stops.json", "r", encoding="utf-8"))
    dsat_ref = json.load(open(REFERENCE_DIR / "dsat_stops.json", "r", encoding="utf-8"))
    bridges = json.load(open(REFERENCE_DIR / "bridge_routes.json", "r", encoding="utf-8"))
    out_path = PUBLIC_DIR / "bus-routes.json"
    bus_routes = json.load(open(out_path, "r", encoding="utf-8"))

    centroid_lookup = {s["id"]: s for s in stops_ref}
    dsat_routes = dsat_ref.get("routes", {})
    by_id = {r["id"]: r for r in bus_routes}
    routes_ref_by_id = {r["id"]: r for r in routes_ref if "id" in r}
    bridge_ids = bridges["macau_taipa_bridge"]

    # Only the CIRCULAR bridge routes (bilaterals were handled already).
    targets = [
        rid for rid in bridge_ids
        if rid in by_id and not dsat_routes.get(rid, {}).get("backward")
    ]
    print(f"Circular bridge routes to regenerate: {len(targets)}")
    print(", ".join(targets))

    for n, rid in enumerate(targets, 1):
        print(f"\n[{n}/{len(targets)}] Route {rid}: ", end="", flush=True)
        route = routes_ref_by_id.get(rid)
        if not route or "error" in route:
            print("SKIP")
            continue
        dirs = route.get("directions", [])
        if not dirs:
            print("SKIP (no directions)")
            continue
        d_record = dsat_routes.get(rid, {})
        dsat_fwd = d_record.get("forward", [])
        if not dsat_fwd:
            print("SKIP (no DSAT fwd)")
            continue

        d0 = dirs[0]
        fwd_aligned = align_direction(
            dsat_fwd, d0.get("stops", []), d0.get("lats", []),
            d0.get("lngs", []), d0.get("stations", []), centroid_lookup,
        )

        waypoints: list[list[float]] = []
        for did, lng, lat, _ in fwd_aligned:
            if not (lng and lat):
                continue
            waypoints.append([lng, lat])
            hint = WAYPOINT_HINTS.get((rid, did))
            if hint:
                waypoints.append(list(hint))
        if len(waypoints) < 2:
            print("SKIP (<2 waypoints)")
            continue

        geometry = build_route_geometry(waypoints, rid)
        coord_count = len(geometry.get("geometry", {}).get("coordinates", []))

        stops_fwd = [did for did, _, _, _ in fwd_aligned]
        target = by_id[rid]
        target["stopsForward"] = stops_fwd
        target["stopsBackward"] = []
        target["geometry"] = geometry
        target["routeType"] = "circular"

        print(f"OK ({len(stops_fwd)} stops, {coord_count} geo coords)")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(bus_routes, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
