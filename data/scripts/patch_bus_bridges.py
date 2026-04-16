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
import time
from pathlib import Path

from osrm_route import get_road_geometry

REFERENCE_DIR = Path(__file__).parent.parent / "bus_reference"
PUBLIC_DIR = Path(__file__).parent.parent.parent / "public" / "data"

CHANNEL_LAT_NORTH = 22.187
CHANNEL_LAT_SOUTH = 22.158
ANCHOR_BACKOFF = 3
OSRM_DELAY_S = 0.7


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
    bridge_coords: list[list[float]],
) -> list[list[float]]:
    """Replace coords[run[0]..run[1]] with bridge-correct path.

    Anchor points (just outside the channel) are kept; everything strictly
    inside the run is removed and replaced by [OSRM_to_bridge + bridge +
    OSRM_to_anchor].
    """
    start, end = run
    anchor_pre_idx = max(0, start - ANCHOR_BACKOFF)
    anchor_post_idx = min(len(coords) - 1, end + ANCHOR_BACKOFF)

    anchor_pre = coords[anchor_pre_idx]
    anchor_post = coords[anchor_post_idx]

    # Direction: which end of the bridge is closer to anchor_pre?
    macau_end = bridge_coords[0]
    taipa_end = bridge_coords[-1]

    def dist2(a: list[float], b: list[float]) -> float:
        dx, dy = a[0] - b[0], a[1] - b[1]
        return dx * dx + dy * dy

    if dist2(anchor_pre, macau_end) <= dist2(anchor_pre, taipa_end):
        bridge_directed = list(bridge_coords)
        from_end, to_end = macau_end, taipa_end
    else:
        bridge_directed = list(reversed(bridge_coords))
        from_end, to_end = taipa_end, macau_end

    print(f"    OSRM connector A: {anchor_pre} -> {from_end}")
    leg_in = osrm_or_straight(anchor_pre, from_end)
    print(f"    OSRM connector B: {to_end} -> {anchor_post}")
    leg_out = osrm_or_straight(to_end, anchor_post)

    new_segment = (
        list(leg_in)
        + list(bridge_directed[1:])
        + list(leg_out[1:])
    )

    return coords[:anchor_pre_idx] + new_segment + coords[anchor_post_idx + 1 :]


def patch_route(route: dict, bridge_coords: list[list[float]]) -> bool:
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
        coords = replace_run(coords, run, bridge_coords)

    route["geometry"]["geometry"]["coordinates"] = coords
    return True


def run():
    bridges, bridge_routes, routes = load_inputs()

    bridge = bridges["macau_taipa_bridge"]
    bridge_coords = bridge["coordinates"]
    target_route_ids = set(bridge_routes.get("macau_taipa_bridge", []))

    if not target_route_ids:
        print("No target routes configured in bridge_routes.json")
        return

    print(f"Patching {len(target_route_ids)} routes via Macau-Taipa Bridge")
    print(f"  Bridge has {len(bridge_coords)} coordinates")

    by_id = {r["id"]: r for r in routes}
    patched = 0
    missing = []
    for rid in sorted(target_route_ids):
        if rid not in by_id:
            missing.append(rid)
            continue
        print(f"  Route {rid}:")
        if patch_route(by_id[rid], bridge_coords):
            patched += 1

    out_path = PUBLIC_DIR / "bus-routes.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(routes, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nDone: patched {patched}/{len(target_route_ids)} routes -> {out_path}")
    if missing:
        print(f"Missing route IDs (not in bus-routes.json): {missing}")


if __name__ == "__main__":
    run()
