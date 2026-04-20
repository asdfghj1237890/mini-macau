"""
Generate bus-routes.json and bus-stops.json for the frontend.

DSAT (bus_reference/dsat_stops.json) is the authoritative source of per-
direction stop IDs — including the "/N" platform suffix. motransport
(bus_reference/routes.json) provides per-platform coordinates and Chinese
station names, which we align positionally with DSAT.

Output schemas:

  bus-routes.json: [{
    id, name, nameCn, color,
    stopsForward:  string[],   // DSAT IDs in chronological visit order
                               // (dir[0] stops + dir[1] stops if backward exists)
    stopsBackward: string[],   // always [] now — see below
    geometry,                  // road-snapped LineString of full trip cycle
                               // (dir[0] + dir[1] for routes with backward)
    frequency, serviceHoursStart, serviceHoursEnd,
    routeType: "circular"      // always — geometry is one full loop
  }]

NOTE on bilateral routes: in Macau, "bilateral" routes (those with separate
DSAT forward+backward stop lists) generally use *different* roads in each
direction, not just the reverse of one. We model them as a single circular
loop covering both legs back-to-back. This matches reality (the bus does
one full out-and-back per cycle) and avoids the broken assumption that
dir[1] is reversed(dir[0]).

  bus-stops.json: [{
    id: "M172/14",             // full DSAT platform code
    name, nameCn,
    coordinates: [lng, lat],
    routeIds: string[]
  }]

NOTE: After running this script, run patch_bus_bridges.py to rewrite
cross-channel routes that should use 嘉樂庇總督大橋 (Macau-Taipa Bridge).
"""

import json
import time
from pathlib import Path

from osrm_route import (
    LOTUS_BRIDGE_ANCHOR,
    get_road_geometry,
    is_in_hengqin,
    lotus_bridge_segment,
    path_enters_hengqin,
)

REFERENCE_DIR = Path(__file__).parent.parent / "bus_reference"
PUBLIC_DIR = Path(__file__).parent.parent.parent / "public" / "data"

ROUTE_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#e67e22", "#9b59b6",
    "#1abc9c", "#f39c12", "#d35400", "#c0392b", "#2980b9",
    "#27ae60", "#8e44ad", "#16a085", "#f1c40f", "#e84393",
    "#00b894", "#6c5ce7", "#fd79a8", "#0984e3", "#00cec9",
    "#636e72", "#b2bec3", "#d63031", "#74b9ff", "#a29bfe",
]

# Per-route OSRM waypoint hints. After the listed stop, insert the given
# [lng, lat] as an extra OSRM waypoint to force routing through a specific
# road segment. Used to fix cases where OSRM's driving profile snaps a stop
# to the wrong side of a one-way / multi-level junction and routes a long
# detour (e.g. 亞馬喇前地: driving profile takes a 1km westward loop through
# 議事亭/新馬路 because the direct east-bound exit is bus-only in OSM).
#
# Each hint coord must be a valid road-snappable point near the desired
# exit. Only the (route_id, stop_id) pairs listed here are affected.
AMARAL_EAST_EXIT = [113.54390, 22.18893]
WAYPOINT_HINTS: dict[tuple[str, str], list[float]] = {
    ("MT1", "M172/13"): AMARAL_EAST_EXIT,
    ("MT2", "M172/12"): AMARAL_EAST_EXIT,
    ("MT5", "M172/10"): AMARAL_EAST_EXIT,
    ("39",  "M172/10"): AMARAL_EAST_EXIT,
}


def build_route_geometry(waypoints: list[list[float]], route_name: str = "") -> dict:
    """Build a GeoJSON Feature with LineString snapped to roads via OSRM."""
    if len(waypoints) < 2:
        return {"type": "Feature", "geometry": {"type": "LineString", "coordinates": []}, "properties": {}}

    MAX_WP = 80
    all_coords: list[list[float]] = []

    def _route_pair(a: list[float], b: list[float]) -> list[list[float]]:
        """Per-pair OSRM with Hengqin veto. If the direct path crosses Hengqin,
        retry once via the Lotus Bridge anchor; if OSRM still detours through
        Hengqin (the public demo refuses to drive the bridge), splice the
        manual bridge polyline so the visual crosses on the bridge instead
        of cutting straight across the Shizimen waterway.
        """
        rc = get_road_geometry([a, b], profile="driving")
        time.sleep(0.4)
        if rc and len(rc) >= 2 and not path_enters_hengqin(rc):
            return rc
        if rc and path_enters_hengqin(rc):
            rc2 = get_road_geometry([a, LOTUS_BRIDGE_ANCHOR, b], profile="driving")
            time.sleep(0.4)
            if rc2 and len(rc2) >= 2 and not path_enters_hengqin(rc2):
                return rc2
            # Both endpoints near the bridge → use the manual bridge polyline.
            # Heuristic: both within the Cotai/Hengqin-Port latitude band
            # (22.135–22.150) AND straddling the waterway (one side of
            # lng 113.553, other side of it).
            in_band = lambda p: 22.135 <= p[1] <= 22.150 and not is_in_hengqin(p)
            if in_band(a) and in_band(b) and (a[0] - 113.553) * (b[0] - 113.553) <= 0:
                print(f"    NOTE: pair {a}->{b} stitched via Lotus Bridge polyline")
                return lotus_bridge_segment(a, b)
            print(f"    WARN: pair {a}->{b} routes through Hengqin and not on Lotus Bridge corridor; using straight line")
        return [a, b]

    for chunk_start in range(0, len(waypoints), MAX_WP - 1):
        chunk = waypoints[chunk_start:chunk_start + MAX_WP]
        if len(chunk) < 2:
            if all_coords and chunk:
                all_coords.append(chunk[0])
            break

        road_coords = get_road_geometry(chunk, profile="driving")
        time.sleep(0.6)

        # Public OSRM sometimes optimises multi-waypoint paths through
        # Hengqin (mainland China) when it finds a shorter road. Macau
        # buses cannot cross that border, so fall back to per-pair routing
        # whenever the bulk response contains Hengqin coords.
        if road_coords and len(road_coords) >= 2 and path_enters_hengqin(road_coords):
            print(f"    bulk OSRM routed through Hengqin; retrying per-pair ({len(chunk)} waypoints)")
            rebuilt: list[list[float]] = []
            for i in range(len(chunk) - 1):
                pair = _route_pair(chunk[i], chunk[i + 1])
                if i == 0:
                    rebuilt = list(pair)
                else:
                    rebuilt.extend(pair[1:])
            road_coords = rebuilt

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


def align_direction(
    dsat_ids: list[str],
    mt_stops: list[str],
    mt_lats: list[str],
    mt_lngs: list[str],
    mt_stations: list[str],
    centroid_lookup: dict,
) -> list[tuple[str, float, float, str]]:
    """Return [(dsat_id, lng, lat, nameCn), ...] aligned to DSAT order.

    Strategy:
    1. If DSAT length matches motransport AND base codes match positionally,
       zip directly (best case, 89/92 routes).
    2. Otherwise, for each DSAT ID, consume the next unused motransport entry
       whose bare staCode matches the DSAT base code.
    3. If no match is found, fall back to the motransport-wide centroid.
    """
    def mt_coord(i: int) -> tuple[float, float, str]:
        try:
            lat = float(mt_lats[i])
            lng = float(mt_lngs[i])
        except (ValueError, TypeError, IndexError):
            lat, lng = 0.0, 0.0
        nm = mt_stations[i] if i < len(mt_stations) else ""
        return lat, lng, nm

    # Fast path: positional zip
    if len(dsat_ids) == len(mt_stops) and all(
        dsat_ids[i].split("/")[0] == mt_stops[i] for i in range(len(dsat_ids))
    ):
        out: list[tuple[str, float, float, str]] = []
        for i, did in enumerate(dsat_ids):
            lat, lng, nm = mt_coord(i)
            if not (lat and lng):
                c = centroid_lookup.get(did.split("/")[0])
                if c:
                    lat, lng = c["lat"], c["lng"]
                    if not nm:
                        nm = c.get("nameCn", did)
            out.append((did, lng, lat, nm or did))
        return out

    # Fallback: per-ID pooled lookup
    mt_by_base: dict[str, list[tuple[float, float, str]]] = {}
    for i, sid in enumerate(mt_stops):
        lat, lng, nm = mt_coord(i)
        if lat and lng:
            mt_by_base.setdefault(sid, []).append((lat, lng, nm))

    consumed: dict[str, int] = {}
    out = []
    for did in dsat_ids:
        base = did.split("/")[0]
        pool = mt_by_base.get(base, [])
        idx = consumed.get(base, 0)
        if idx < len(pool):
            lat, lng, nm = pool[idx]
            consumed[base] = idx + 1
        else:
            c = centroid_lookup.get(base)
            if c:
                lat, lng, nm = c["lat"], c["lng"], c.get("nameCn", did)
            else:
                lat, lng, nm = 0.0, 0.0, did
        out.append((did, lng, lat, nm or did))
    return out


def run():
    routes_ref = json.load(open(REFERENCE_DIR / "routes.json", "r", encoding="utf-8"))
    stops_ref = json.load(open(REFERENCE_DIR / "stops.json", "r", encoding="utf-8"))
    dsat_ref = json.load(open(REFERENCE_DIR / "dsat_stops.json", "r", encoding="utf-8"))

    centroid_lookup = {s["id"]: s for s in stops_ref}
    dsat_routes = dsat_ref.get("routes", {})
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    bus_routes: list[dict] = []
    stop_registry: dict[str, dict] = {}

    for i, route in enumerate(routes_ref):
        rid = route["id"]
        print(f"[{i+1}/{len(routes_ref)}] Route {rid}: ", end="", flush=True)

        if "error" in route:
            print("SKIP (error)")
            continue

        dirs = route.get("directions", [])
        if not dirs:
            print("SKIP (no directions)")
            continue

        d_record = dsat_routes.get(rid)
        if not d_record:
            print("SKIP (no DSAT record)")
            continue

        dsat_fwd = d_record.get("forward", [])
        dsat_bwd = d_record.get("backward", [])
        if not dsat_fwd:
            print("SKIP (DSAT forward empty)")
            continue

        d0 = dirs[0]
        fwd_aligned = align_direction(
            dsat_fwd,
            d0.get("stops", []),
            d0.get("lats", []),
            d0.get("lngs", []),
            d0.get("stations", []),
            centroid_lookup,
        )

        bwd_aligned: list[tuple[str, float, float, str]] = []
        if dsat_bwd:
            d1 = dirs[1] if len(dirs) > 1 else d0
            bwd_aligned = align_direction(
                dsat_bwd,
                d1.get("stops", []),
                d1.get("lats", []),
                d1.get("lngs", []),
                d1.get("stations", []),
                centroid_lookup,
            )

        # Build geometry for each direction SEPARATELY, then concatenate.
        # Routing dir[0]+dir[1] as a single OSRM call lets the solver
        # "optimize" the transition, sometimes producing huge cross-channel
        # detours (e.g. 102: deep-Taipa->brief-Macau->deep-Taipa loops).
        # Per-direction routing keeps each leg on the roads it actually uses.
        def _waypoints_of(aligned: list[tuple[str, float, float, str]]) -> list[list[float]]:
            wps: list[list[float]] = []
            for did, lng, lat, _ in aligned:
                if not (lng and lat):
                    continue
                wps.append([lng, lat])
                hint = WAYPOINT_HINTS.get((rid, did))
                if hint:
                    wps.append(list(hint))
            return wps

        fwd_wps = _waypoints_of(fwd_aligned)
        bwd_wps = _waypoints_of(bwd_aligned)
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

        color = ROUTE_COLORS[i % len(ROUTE_COLORS)]
        stops_fwd = [did for did, _, _, _ in fwd_aligned]
        stops_bwd = [did for did, _, _, _ in bwd_aligned]
        # Geometry is the full out+back loop; treat as circular and put all
        # stops into stopsForward in visit order.
        stops_combined = stops_fwd + stops_bwd
        route_type = "circular"

        bus_routes.append({
            "id": rid,
            "name": rid,
            "nameCn": route.get("description", ""),
            "color": color,
            "stopsForward": stops_combined,
            "stopsBackward": [],
            "geometry": geometry,
            "frequency": route.get("avg_freq", 12),
            "serviceHoursStart": route.get("service_start", 6),
            "serviceHoursEnd": route.get("service_end", 23),
            "routeType": route_type,
        })

        for did, lng, lat, nm in fwd_aligned + bwd_aligned:
            entry = stop_registry.get(did)
            if entry is None:
                entry = {"nameCn": nm, "lng": lng, "lat": lat, "route_ids": []}
                stop_registry[did] = entry
            else:
                if (not entry["lng"] or not entry["lat"]) and lng and lat:
                    entry["lng"], entry["lat"] = lng, lat
                if (not entry["nameCn"] or entry["nameCn"] == did) and nm and nm != did:
                    entry["nameCn"] = nm
            if rid not in entry["route_ids"]:
                entry["route_ids"].append(rid)

        coord_count = len(geometry.get("geometry", {}).get("coordinates", []))
        print(f"OK (fwd={len(stops_fwd)} bwd={len(stops_bwd)}, {coord_count} geo)", flush=True)

    bus_stops = []
    for did in sorted(stop_registry.keys()):
        e = stop_registry[did]
        bus_stops.append({
            "id": did,
            "name": did,
            "nameCn": e["nameCn"],
            "coordinates": [e["lng"], e["lat"]],
            "routeIds": e["route_ids"],
        })

    routes_path = PUBLIC_DIR / "bus-routes.json"
    stops_path = PUBLIC_DIR / "bus-stops.json"
    with open(routes_path, "w", encoding="utf-8") as f:
        json.dump(bus_routes, f, ensure_ascii=False, indent=2)
    with open(stops_path, "w", encoding="utf-8") as f:
        json.dump(bus_stops, f, ensure_ascii=False, indent=2)

    print(f"\nDone: {len(bus_routes)} routes -> {routes_path}")
    print(f"      {len(bus_stops)} stops -> {stops_path}")


if __name__ == "__main__":
    run()
