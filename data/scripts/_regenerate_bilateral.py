"""One-shot helper: re-extract geometry for the 19 bilateral routes only.

Reads existing public/data/bus-routes.json, replaces the entries whose
DSAT record has a non-empty backward list with freshly-built geometry
that combines dir[0] + dir[1] waypoints. Other routes are untouched.

Run after modifying extract_bus_data.py's bilateral handling. Then run
patch_bus_bridges.py to re-apply bridge corrections.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from extract_bus_data import (
    REFERENCE_DIR, PUBLIC_DIR, ROUTE_COLORS, WAYPOINT_HINTS,
    align_direction, build_route_geometry,
)


def main():
    routes_ref = json.load(open(REFERENCE_DIR / "routes.json", "r", encoding="utf-8"))
    stops_ref = json.load(open(REFERENCE_DIR / "stops.json", "r", encoding="utf-8"))
    dsat_ref = json.load(open(REFERENCE_DIR / "dsat_stops.json", "r", encoding="utf-8"))
    out_path = PUBLIC_DIR / "bus-routes.json"
    bus_routes = json.load(open(out_path, "r", encoding="utf-8"))
    bus_stops = json.load(open(PUBLIC_DIR / "bus-stops.json", "r", encoding="utf-8"))

    centroid_lookup = {s["id"]: s for s in stops_ref}
    dsat_routes = dsat_ref.get("routes", {})
    by_id = {r["id"]: r for r in bus_routes}
    stop_by_id = {s["id"]: s for s in bus_stops}

    bilateral_ids = [
        rid for rid, rec in dsat_routes.items()
        if rec.get("backward") and rid in by_id
    ]
    print(f"Bilateral routes to regenerate: {len(bilateral_ids)}")
    print(", ".join(bilateral_ids))

    routes_ref_by_id = {r["id"]: r for r in routes_ref if "id" in r}

    for n, rid in enumerate(bilateral_ids, 1):
        print(f"\n[{n}/{len(bilateral_ids)}] Route {rid}: ", end="", flush=True)
        route = routes_ref_by_id.get(rid)
        if not route or "error" in route:
            print("SKIP (no ref)")
            continue
        dirs = route.get("directions", [])
        if not dirs:
            print("SKIP (no directions)")
            continue
        d_record = dsat_routes.get(rid, {})
        dsat_fwd = d_record.get("forward", [])
        dsat_bwd = d_record.get("backward", [])
        if not dsat_fwd or not dsat_bwd:
            print("SKIP (DSAT incomplete)")
            continue

        d0 = dirs[0]
        d1 = dirs[1] if len(dirs) > 1 else d0
        fwd_aligned = align_direction(
            dsat_fwd, d0.get("stops", []), d0.get("lats", []),
            d0.get("lngs", []), d0.get("stations", []), centroid_lookup,
        )
        bwd_aligned = align_direction(
            dsat_bwd, d1.get("stops", []), d1.get("lats", []),
            d1.get("lngs", []), d1.get("stations", []), centroid_lookup,
        )

        def _wps(aligned):
            wps: list[list[float]] = []
            for did, lng, lat, _ in aligned:
                if not (lng and lat):
                    continue
                wps.append([lng, lat])
                hint = WAYPOINT_HINTS.get((rid, did))
                if hint:
                    wps.append(list(hint))
            return wps

        fwd_wps = _wps(fwd_aligned)
        bwd_wps = _wps(bwd_aligned)
        if len(fwd_wps) < 2:
            print("SKIP (<2 waypoints)")
            continue

        fwd_geom = build_route_geometry(fwd_wps, rid)
        if bwd_wps and len(bwd_wps) >= 2:
            bwd_geom = build_route_geometry(bwd_wps, rid + " (bwd)")
            fwd_coords = fwd_geom.get("geometry", {}).get("coordinates", [])
            bwd_coords = bwd_geom.get("geometry", {}).get("coordinates", [])
            geometry = {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": list(fwd_coords) + list(bwd_coords),
                },
                "properties": {},
            }
        else:
            geometry = fwd_geom
        combined_aligned = list(fwd_aligned) + list(bwd_aligned)
        coord_count = len(geometry.get("geometry", {}).get("coordinates", []))

        stops_fwd = [did for did, _, _, _ in fwd_aligned]
        stops_bwd = [did for did, _, _, _ in bwd_aligned]
        stops_combined = stops_fwd + stops_bwd

        target = by_id[rid]
        target["stopsForward"] = stops_combined
        target["stopsBackward"] = []
        target["geometry"] = geometry
        target["routeType"] = "circular"

        # Refresh stop registry: every stop in combined needs to know it
        # serves this route, and any stop newly visible (e.g., dir-1-only
        # stops) gets added to bus-stops.json.
        for did, lng, lat, nm in combined_aligned:
            if not (lng and lat):
                continue
            entry = stop_by_id.get(did)
            if entry is None:
                entry = {
                    "id": did, "name": did, "nameCn": nm or did,
                    "coordinates": [lng, lat], "routeIds": [],
                }
                stop_by_id[did] = entry
                bus_stops.append(entry)
            if rid not in entry["routeIds"]:
                entry["routeIds"].append(rid)

        print(f"OK ({len(stops_combined)} stops, {coord_count} geo coords)")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(bus_routes, f, ensure_ascii=False, indent=2)
    with open(PUBLIC_DIR / "bus-stops.json", "w", encoding="utf-8") as f:
        json.dump(sorted(bus_stops, key=lambda s: s["id"]), f, ensure_ascii=False, indent=2)
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
