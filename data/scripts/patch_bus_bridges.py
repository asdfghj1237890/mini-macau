"""
Post-process public/data/bus-routes.json to make selected bus routes traverse
the Macau-Taipa Bridge (嘉樂庇總督大橋) instead of the OSRM-default
Sai Van / Friendship Bridge.

Why: public OSRM driving profile treats the Macau-Taipa Bridge as
restricted (motor_vehicle=no, bus=designated in OSM). All bus routes that
should use it get rerouted onto Sai Van Bridge by OSRM. We rewrite their
geometries here.

Strategy per route:
  1. Find every contiguous run of coordinates whose latitude lies inside
     the channel between Macau peninsula and Taipa.
  2. For each such run, pick land-side anchor coordinates a few points
     before/after the run.
  3. Replace [anchor_macau ... anchor_taipa] with:
        OSRM(anchor_macau, bridge_macau_end)
        + bridge polyline (oriented to travel direction)
        + OSRM(bridge_taipa_end, anchor_taipa)
  4. Write back to public/data/bus-routes.json.

Run after extract_bus_data.py.
"""

import json
import math
import time
from pathlib import Path

from osrm_route import get_road_geometry

REFERENCE_DIR = Path(__file__).parent.parent / "bus_reference"
PUBLIC_DIR = Path(__file__).parent.parent.parent / "public" / "data"

CHANNEL_LAT_NORTH = 22.187
CHANNEL_LAT_SOUTH = 22.158
ANCHOR_SEARCH_WINDOW = 15
BRIDGE_DENSIFY_M = 100.0
OSRM_DELAY_S = 0.7
METERS_PER_DEG_LAT = 111320.0


def dist_m2(a: list[float], b: list[float]) -> float:
    """Squared distance between two lon/lat points in metres^2 (approx)."""
    mid_lat = (a[1] + b[1]) / 2
    cos_lat = max(0.1, math.cos(math.radians(mid_lat)))
    d_lat_m = (a[1] - b[1]) * METERS_PER_DEG_LAT
    d_lng_m = (a[0] - b[0]) * METERS_PER_DEG_LAT * cos_lat
    return d_lat_m * d_lat_m + d_lng_m * d_lng_m


def densify(coords: list[list[float]], max_gap_m: float) -> list[list[float]]:
    """Linearly interpolate so no consecutive pair is more than max_gap_m apart."""
    if len(coords) < 2:
        return list(coords)
    out: list[list[float]] = [list(coords[0])]
    for i in range(1, len(coords)):
        a = coords[i - 1]
        b = coords[i]
        d = math.sqrt(dist_m2(a, b))
        if d > max_gap_m:
            n = int(d / max_gap_m) + 1
            for k in range(1, n):
                t = k / n
                out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
        out.append(list(b))
    return out


def load_inputs() -> tuple[dict, dict, list[dict]]:
    bridges = json.load(open(REFERENCE_DIR / "bridges.json", "r", encoding="utf-8"))
    bridge_routes = json.load(open(REFERENCE_DIR / "bridge_routes.json", "r", encoding="utf-8"))
    routes = json.load(open(PUBLIC_DIR / "bus-routes.json", "r", encoding="utf-8"))
    return bridges, bridge_routes, routes


def find_channel_runs(coords: list[list[float]]) -> list[tuple[int, int]]:
    """Return list of (start_idx, end_idx) inclusive runs where lat is in
    the channel zone AND the surrounding bracket points are on opposite
    sides of the channel (i.e. an actual Macau<->Taipa crossing rather
    than a coastal blip).
    """
    raw_runs: list[tuple[int, int]] = []
    in_run = False
    start = 0
    for i, c in enumerate(coords):
        in_zone = CHANNEL_LAT_SOUTH <= c[1] <= CHANNEL_LAT_NORTH
        if in_zone and not in_run:
            in_run = True
            start = i
        elif not in_zone and in_run:
            in_run = False
            raw_runs.append((start, i - 1))
    if in_run:
        raw_runs.append((start, len(coords) - 1))

    real_runs: list[tuple[int, int]] = []
    for s, e in raw_runs:
        if s == 0 or e == len(coords) - 1:
            continue  # need brackets on both sides
        prev_lat = coords[s - 1][1]
        next_lat = coords[e + 1][1]
        crosses = (prev_lat > CHANNEL_LAT_NORTH and next_lat < CHANNEL_LAT_SOUTH) or (
            next_lat > CHANNEL_LAT_NORTH and prev_lat < CHANNEL_LAT_SOUTH
        )
        if not crosses:
            continue
        lats = [coords[k][1] for k in range(s, e + 1)]
        if max(lats) - min(lats) < 0.015:
            continue  # short blip - safety net
        real_runs.append((s, e))

    return real_runs


def osrm_or_straight(a: list[float], b: list[float]) -> list[list[float]]:
    """OSRM-route a -> b; fall back to straight segment if OSRM fails."""
    try:
        coords = get_road_geometry([a, b], profile="driving")
        time.sleep(OSRM_DELAY_S)
        if coords and len(coords) >= 2:
            return coords
    except Exception as e:
        print(f"      OSRM fallback ({e})")
    return [a, b]


def replace_run(
    coords: list[list[float]],
    run: tuple[int, int],
    bridge_polyline: list[list[float]],
    macau_approach: list[float],
    taipa_approach: list[float],
) -> list[list[float]]:
    """Replace coords[run[0]..run[1]] with bridge-correct path.

    OSRM targets are the approach points (on ordinary roads just outside
    the bridge's restricted zone), NOT the bridge endpoints themselves.
    OSRM cannot snap to the bridge (tagged motor_vehicle=no) so it would
    otherwise snap to an arbitrary nearby street and produce a visible
    offset. The bridge polyline already starts/ends at approach points
    (extended at load time), so leg_in->bridge->leg_out is continuous.
    """
    start, end = run

    prev_lat = coords[start - 1][1]

    if prev_lat > CHANNEL_LAT_NORTH:
        pre_target = macau_approach
        post_target = taipa_approach
        bridge_directed = list(bridge_polyline)
    else:
        pre_target = taipa_approach
        post_target = macau_approach
        bridge_directed = list(reversed(bridge_polyline))

    anchor_pre_idx = start - 1
    best_d = dist_m2(coords[anchor_pre_idx], pre_target)
    for i in range(max(0, start - ANCHOR_SEARCH_WINDOW), start):
        d = dist_m2(coords[i], pre_target)
        if d < best_d:
            best_d = d
            anchor_pre_idx = i

    anchor_post_idx = end + 1
    best_d = dist_m2(coords[anchor_post_idx], post_target)
    for i in range(end + 1, min(len(coords), end + 1 + ANCHOR_SEARCH_WINDOW)):
        d = dist_m2(coords[i], post_target)
        if d < best_d:
            best_d = d
            anchor_post_idx = i

    anchor_pre = coords[anchor_pre_idx]
    anchor_post = coords[anchor_post_idx]

    print(f"    OSRM connector A: {anchor_pre} -> {pre_target}")
    leg_in = osrm_or_straight(anchor_pre, pre_target)
    print(f"    OSRM connector B: {post_target} -> {anchor_post}")
    leg_out = osrm_or_straight(post_target, anchor_post)

    new_segment = (
        list(leg_in)
        + list(bridge_directed[1:])
        + list(leg_out[1:])
    )

    return coords[:anchor_pre_idx] + new_segment + coords[anchor_post_idx + 1 :]


def patch_route(
    route: dict,
    bridge_polyline: list[list[float]],
    macau_approach: list[float],
    taipa_approach: list[float],
) -> bool:
    """Mutate route['geometry']['geometry']['coordinates'] in place.

    Returns True if the route was modified.
    """
    coords = route.get("geometry", {}).get("geometry", {}).get("coordinates", [])
    if len(coords) < 2:
        return False

    runs = find_channel_runs(coords)
    if not runs:
        print(f"    skip: no channel crossing in geometry")
        return False

    print(f"    {len(runs)} channel run(s)")
    for run in reversed(runs):
        coords = replace_run(coords, run, bridge_polyline, macau_approach, taipa_approach)

    route["geometry"]["geometry"]["coordinates"] = coords
    return True


def run():
    bridges, bridge_routes, routes = load_inputs()

    bridge = bridges["macau_taipa_bridge"]
    macau_approach = bridge["macau_approach"]
    taipa_approach = bridge["taipa_approach"]
    bridge_polyline_raw = [macau_approach] + bridge["coordinates"] + [taipa_approach]
    bridge_polyline = densify(bridge_polyline_raw, BRIDGE_DENSIFY_M)
    target_route_ids = set(bridge_routes.get("macau_taipa_bridge", []))

    if not target_route_ids:
        print("No target routes configured in bridge_routes.json")
        return

    print(f"Patching {len(target_route_ids)} routes via Macau-Taipa Bridge")
    print(f"  Bridge polyline (with approaches) has {len(bridge_polyline)} coordinates")

    by_id = {r["id"]: r for r in routes}
    patched = 0
    missing = []
    for rid in sorted(target_route_ids):
        if rid not in by_id:
            missing.append(rid)
            continue
        print(f"  Route {rid}:")
        if patch_route(by_id[rid], bridge_polyline, macau_approach, taipa_approach):
            patched += 1

    out_path = PUBLIC_DIR / "bus-routes.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(routes, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nDone: patched {patched}/{len(target_route_ids)} routes -> {out_path}")
    if missing:
        print(f"Missing route IDs (not in bus-routes.json): {missing}")


if __name__ == "__main__":
    run()
