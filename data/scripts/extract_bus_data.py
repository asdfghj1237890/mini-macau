"""
Generate bus-routes.json and bus-stops.json for the frontend.
Reads from data/bus_reference/ (fetched from motransportinfo.com)
and snaps route geometries to roads via OSRM.

NOTE: After running this script, run patch_bus_bridges.py to rewrite the
crossings of bus routes that should use 嘉樂庇總督大橋 (Macau-Taipa
Bridge). Public OSRM driving profile cannot use that bridge because OSM
tags it as bus/taxi-only, so by default cross-channel routes are
mis-routed onto Sai Van Bridge.
"""

import json
import time
from pathlib import Path

from osrm_route import get_road_geometry

REFERENCE_DIR = Path(__file__).parent.parent / "bus_reference"
PUBLIC_DIR = Path(__file__).parent.parent.parent / "public" / "data"

ROUTE_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#e67e22", "#9b59b6",
    "#1abc9c", "#f39c12", "#d35400", "#c0392b", "#2980b9",
    "#27ae60", "#8e44ad", "#16a085", "#f1c40f", "#e84393",
    "#00b894", "#6c5ce7", "#fd79a8", "#0984e3", "#00cec9",
    "#636e72", "#b2bec3", "#d63031", "#74b9ff", "#a29bfe",
]


def build_route_geometry(waypoints: list[list[float]], route_name: str = "") -> dict:
    """Build a GeoJSON Feature with LineString snapped to roads via OSRM."""
    if len(waypoints) < 2:
        return {"type": "Feature", "geometry": {"type": "LineString", "coordinates": []}, "properties": {}}

    # OSRM has a limit of ~100 waypoints per request; chunk if needed
    MAX_WP = 80
    all_coords = []

    for chunk_start in range(0, len(waypoints), MAX_WP - 1):
        chunk = waypoints[chunk_start:chunk_start + MAX_WP]
        if len(chunk) < 2:
            if all_coords and chunk:
                all_coords.append(chunk[0])
            break

        road_coords = get_road_geometry(chunk, profile="driving")
        time.sleep(0.6)

        if road_coords and len(road_coords) >= 2:
            if all_coords:
                all_coords.extend(road_coords[1:])
            else:
                all_coords = road_coords
        else:
            if all_coords:
                all_coords.extend(chunk[1:])
            else:
                all_coords = list(chunk)

    if len(all_coords) < 2:
        return {"type": "Feature", "geometry": {"type": "LineString", "coordinates": waypoints}, "properties": {}}

    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": all_coords},
        "properties": {},
    }


def run():
    routes_ref = json.load(open(REFERENCE_DIR / "routes.json", "r", encoding="utf-8"))
    stops_ref = json.load(open(REFERENCE_DIR / "stops.json", "r", encoding="utf-8"))

    stop_map = {s["id"]: s for s in stops_ref}
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    bus_routes = []
    failed = []

    for i, route in enumerate(routes_ref):
        rid = route["id"]
        print(f"[{i+1}/{len(routes_ref)}] Route {rid}: ", end="", flush=True)

        if "error" in route:
            print(f"SKIP (error)")
            continue

        dirs = route.get("directions", [])
        if not dirs:
            print("SKIP (no directions)")
            continue

        # Use direction 0 as primary geometry
        d0 = dirs[0]
        waypoints = []
        stop_ids = []
        for j, stop_id in enumerate(d0["stops"]):
            lat = float(d0["lats"][j]) if j < len(d0["lats"]) else 0
            lng = float(d0["lngs"][j]) if j < len(d0["lngs"]) else 0
            if lat and lng:
                waypoints.append([lng, lat])
                stop_ids.append(stop_id)

        if len(waypoints) < 2:
            print("SKIP (< 2 waypoints)")
            continue

        geometry = build_route_geometry(waypoints, rid)

        # For bilateral routes, build return geometry and merge stops
        if route.get("route_type") == "bilateral" and len(dirs) > 1:
            d1 = dirs[1]
            wp1 = []
            for j, stop_id in enumerate(d1["stops"]):
                lat = float(d1["lats"][j]) if j < len(d1["lats"]) else 0
                lng = float(d1["lngs"][j]) if j < len(d1["lngs"]) else 0
                if lat and lng:
                    wp1.append([lng, lat])
                    if stop_id not in stop_ids:
                        stop_ids.append(stop_id)
            # We don't merge return geometry into the forward one;
            # simulation engine handles back-and-forth via progress bouncing

        color = ROUTE_COLORS[i % len(ROUTE_COLORS)]

        # Compute English name from description
        desc = route.get("description", "")
        name_cn = desc

        bus_routes.append({
            "id": rid,
            "name": rid,
            "nameCn": name_cn,
            "color": color,
            "stops": stop_ids,
            "geometry": geometry,
            "frequency": route.get("avg_freq", 12),
            "serviceHoursStart": route.get("service_start", 6),
            "serviceHoursEnd": route.get("service_end", 23),
            "routeType": route.get("route_type", "circular"),
        })

        coord_count = len(geometry.get("geometry", {}).get("coordinates", []))
        print(f"OK ({len(stop_ids)} stops, {coord_count} geo points)", flush=True)

    # Build bus stops
    bus_stops = []
    used_stop_ids = set()
    for route in bus_routes:
        for sid in route["stops"]:
            if sid not in used_stop_ids:
                used_stop_ids.add(sid)

    for sid in used_stop_ids:
        s = stop_map.get(sid)
        if not s:
            continue
        route_ids = [r["id"] for r in bus_routes if sid in r["stops"]]
        bus_stops.append({
            "id": sid,
            "name": sid,
            "nameCn": s.get("nameCn", sid),
            "coordinates": [s["lng"], s["lat"]],
            "routeIds": route_ids,
        })

    routes_path = PUBLIC_DIR / "bus-routes.json"
    stops_path = PUBLIC_DIR / "bus-stops.json"

    with open(routes_path, "w", encoding="utf-8") as f:
        json.dump(bus_routes, f, ensure_ascii=False, indent=2)
    with open(stops_path, "w", encoding="utf-8") as f:
        json.dump(bus_stops, f, ensure_ascii=False, indent=2)

    ok = len(bus_routes)
    print(f"\nDone: {ok} routes -> {routes_path}")
    print(f"      {len(bus_stops)} stops -> {stops_path}")
    if failed:
        print(f"Failed: {failed}")


if __name__ == "__main__":
    run()
