"""Re-extract geometry for specific route IDs using current extract logic
(with Hengqin filter). Pass IDs as space-separated args:

    uv run python data/scripts/_regenerate_specific.py 701X N6 25BS
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


def main(ids: list[str]):
    routes_ref = json.load(open(REFERENCE_DIR / "routes.json", "r", encoding="utf-8"))
    stops_ref = json.load(open(REFERENCE_DIR / "stops.json", "r", encoding="utf-8"))
    dsat_ref = json.load(open(REFERENCE_DIR / "dsat_stops.json", "r", encoding="utf-8"))
    out_path = PUBLIC_DIR / "bus-routes.json"
    bus_routes = json.load(open(out_path, "r", encoding="utf-8"))

    centroid = {s["id"]: s for s in stops_ref}
    dsat_routes = dsat_ref.get("routes", {})
    by_id = {r["id"]: r for r in bus_routes}
    routes_by = {r["id"]: r for r in routes_ref if "id" in r}

    print(f"Regenerating {len(ids)} routes: {', '.join(ids)}")

    for n, rid in enumerate(ids, 1):
        print(f"\n[{n}/{len(ids)}] Route {rid}: ", end="", flush=True)
        if rid not in by_id:
            print("SKIP (not in bus-routes.json)")
            continue
        route = routes_by.get(rid)
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
        if not dsat_fwd:
            print("SKIP (no DSAT fwd)")
            continue

        d0 = dirs[0]
        fwd_aligned = align_direction(
            dsat_fwd, d0.get("stops", []), d0.get("lats", []),
            d0.get("lngs", []), d0.get("stations", []), centroid,
        )
        bwd_aligned = []
        if dsat_bwd:
            d1 = dirs[1] if len(dirs) > 1 else d0
            bwd_aligned = align_direction(
                dsat_bwd, d1.get("stops", []), d1.get("lats", []),
                d1.get("lngs", []), d1.get("stations", []), centroid,
            )

        def _wps(aligned):
            wps: list[list[float]] = []
            for did, lng, lat, _ in aligned:
                if not (lng and lat):
                    continue
                wps.append([lng, lat])
                hints = WAYPOINT_HINTS.get((rid, did))
                if hints:
                    for h in hints:
                        wps.append(list(h))
            return wps

        fwd_wps = _wps(fwd_aligned)
        bwd_wps = _wps(bwd_aligned)
        if len(fwd_wps) < 2:
            print("SKIP (<2 waypoints)")
            continue

        fwd_geom = build_route_geometry(fwd_wps, rid)
        if bwd_wps and len(bwd_wps) >= 2:
            bwd_geom = build_route_geometry(bwd_wps, rid + " (bwd)")
            fc = fwd_geom["geometry"]["coordinates"]
            bc = bwd_geom["geometry"]["coordinates"]
            geometry = {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": list(fc) + list(bc)},
                "properties": {},
            }
        else:
            geometry = fwd_geom

        coord_count = len(geometry["geometry"]["coordinates"])
        stops_fwd = [did for did, _, _, _ in fwd_aligned]
        stops_bwd = [did for did, _, _, _ in bwd_aligned]
        target = by_id[rid]
        target["stopsForward"] = stops_fwd + stops_bwd
        target["stopsBackward"] = []
        target["geometry"] = geometry
        target["routeType"] = "circular"
        print(f"OK ({len(stops_fwd) + len(stops_bwd)} stops, {coord_count} coords)")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(bus_routes, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: _regenerate_specific.py <route_id> [<route_id> ...]")
        sys.exit(1)
    main(sys.argv[1:])
