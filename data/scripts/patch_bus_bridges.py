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
BRIDGE_DENSIFY_M = 50.0
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


def chaikin_smooth(coords: list[list[float]], iterations: int = 2) -> list[list[float]]:
    """Chaikin's corner-cutting subdivision: each iteration replaces every
    interior corner with two new points at 1/4 and 3/4 along its adjacent
    segments, smoothing sharp Z-zigzags into gentle curves. First and
    last points are preserved exactly.

    With 2 iterations on a polyline that has a Z (e.g. user-given
    waypoints A -> B -> C where B is a 9m back-jog from A), the path
    becomes a smooth S-curve that no longer has visible angular kinks.
    User waypoints get displaced by at most ~2-5m, all still on-road.
    """
    pts = [list(c) for c in coords]
    for _ in range(iterations):
        if len(pts) < 3:
            return pts
        new: list[list[float]] = [pts[0]]
        for i in range(len(pts) - 1):
            a = pts[i]
            b = pts[i + 1]
            if i > 0:
                new.append([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]])
            if i < len(pts) - 2:
                new.append([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
        new.append(pts[-1])
        pts = new
    return pts


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


MAX_OSRM_DETOUR_RATIO = 4.0
MAX_OSRM_BACKTRACK_M = 150.0
MAX_OSRM_PERP_RATIO = 0.3
SAFE_TRIM_GAP_M = 200.0


def osrm_or_straight(a: list[float], b: list[float]) -> list[list[float]]:
    """OSRM-route a -> b; fall back to straight segment if OSRM fails,
    detours grossly (>4x), OR backtracks too far (>150m opposite direction
    of the straight line in the first half of the path).

    Two filters because each catches a different pathology:
      - Detour ratio rejects gross loops (Macau's 20-25x one-way knots,
        Taipa short-approach loops)
      - Backtrack rejects "looks visually wrong" paths where OSRM goes
        the wrong way before turning around (e.g. Taipa SB leg_out from
        approach goes 300m WEST through small roundabout before turning
        SE to the anchor — total ratio 2.6x looks acceptable but the
        westward leg looks like a loop on screen).

    Straight-line fallback isn't perfect (can cross buildings) but is
    better than visible backtrack loops in the bridge approach area.
    """
    try:
        coords = get_road_geometry([a, b], profile="driving")
        time.sleep(OSRM_DELAY_S)
        if coords and len(coords) >= 2:
            road_len = 0.0
            for i in range(len(coords) - 1):
                road_len += math.sqrt(dist_m2(coords[i], coords[i + 1]))
            straight = math.sqrt(dist_m2(a, b))
            if straight > 5 and road_len / straight > MAX_OSRM_DETOUR_RATIO:
                print(
                    f"      OSRM detour rejected "
                    f"({road_len:.0f}m vs {straight:.0f}m straight, "
                    f"ratio={road_len/straight:.1f}x)"
                )
                return [a, b]

            if straight > 50:
                # Use proper meter-based projection (lng degrees vary by lat).
                mid_lat = (a[1] + b[1]) / 2
                cos_lat = max(0.1, math.cos(math.radians(mid_lat)))
                m_lng = METERS_PER_DEG_LAT * cos_lat
                ab_x = (b[0] - a[0]) * m_lng
                ab_y = (b[1] - a[1]) * METERS_PER_DEG_LAT
                ab_dist = math.sqrt(ab_x * ab_x + ab_y * ab_y)
                if ab_dist > 0:
                    max_back_m = 0.0
                    max_perp_m = 0.0
                    worst_idx = -1
                    for i, p in enumerate(coords):
                        ap_x = (p[0] - a[0]) * m_lng
                        ap_y = (p[1] - a[1]) * METERS_PER_DEG_LAT
                        # Parallel projection along ab (signed metres along ab).
                        parallel = (ap_x * ab_x + ap_y * ab_y) / ab_dist
                        if parallel < 0:
                            back_m = -parallel
                            if back_m > max_back_m:
                                max_back_m = back_m
                                worst_idx = i
                        # Perpendicular distance from line ab in metres.
                        cross = ap_x * ab_y - ap_y * ab_x
                        perp_m = abs(cross) / ab_dist
                        if perp_m > max_perp_m:
                            max_perp_m = perp_m
                            if i > worst_idx:
                                worst_idx = i
                    # Trim loops detected by backward motion OR large
                    # perpendicular deviation, BUT only if the resulting
                    # gap from `a` to the post-loop point is small enough
                    # to NOT cut through buildings. Otherwise keep the
                    # OSRM loop -- a visible loop on real roads is a
                    # smaller evil than a long straight through buildings.
                    bad_back = max_back_m > MAX_OSRM_BACKTRACK_M
                    bad_perp = max_perp_m > MAX_OSRM_PERP_RATIO * ab_dist
                    if (bad_back or bad_perp) and 0 <= worst_idx < len(coords) - 1:
                        post_trim = coords[worst_idx + 1]
                        gap_after_trim = math.sqrt(dist_m2(a, post_trim))
                        if gap_after_trim < SAFE_TRIM_GAP_M:
                            print(
                                f"      OSRM loop trimmed "
                                f"(back={max_back_m:.0f}m, perp={max_perp_m:.0f}m, "
                                f"straight={ab_dist:.0f}m, gap-after-trim={gap_after_trim:.0f}m, "
                                f"removed {worst_idx + 1}/{len(coords)} pts)"
                            )
                            coords = [list(a)] + coords[worst_idx + 1 :]
                        else:
                            print(
                                f"      OSRM loop KEPT "
                                f"(back={max_back_m:.0f}m, perp={max_perp_m:.0f}m, "
                                f"trim would leave {gap_after_trim:.0f}m straight = building cut)"
                            )
            return coords
    except Exception as e:
        print(f"      OSRM fallback ({e})")
    return [a, b]


def replace_run(
    coords: list[list[float]],
    run: tuple[int, int],
    polyline_south: list[list[float]],
    polyline_north: list[list[float]],
    macau_approach: list[float],
    taipa_approach: list[float],
) -> list[list[float]]:
    """Replace coords[run[0]..run[1]] with bridge-correct path.

    Direction-aware: south-bound (Macau->Taipa) uses the east Y-arm;
    north-bound (Taipa->Macau) uses the west Y-arm. OSRM targets are the
    approach points (on ordinary roads), not bridge endpoints.
    """
    start, end = run

    prev_lat = coords[start - 1][1]

    if prev_lat > CHANNEL_LAT_NORTH:
        pre_target = macau_approach
        post_target = taipa_approach
        bridge_directed = list(polyline_south)
    else:
        pre_target = taipa_approach
        post_target = macau_approach
        bridge_directed = list(polyline_north)

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

    # If either leg fell back to a long straight (OSRM rejected and the
    # gap is significant), skip patching this run. Otherwise the straight
    # line cuts through buildings on the map. The original (Sai Van)
    # geometry stays for this crossing.
    in_dist = math.sqrt(dist_m2(anchor_pre, pre_target))
    out_dist = math.sqrt(dist_m2(post_target, anchor_post))
    LONG_STRAIGHT_M = 500
    if (len(leg_in) <= 2 and in_dist > LONG_STRAIGHT_M) or (
        len(leg_out) <= 2 and out_dist > LONG_STRAIGHT_M
    ):
        print(
            f"    SKIP run {run}: leg fallback to long straight "
            f"(in={in_dist:.0f}m, out={out_dist:.0f}m); keeping original geometry"
        )
        return coords

    new_segment = (
        list(leg_in)
        + list(bridge_directed[1:])
        + list(leg_out[1:])
    )

    return coords[:anchor_pre_idx] + new_segment + coords[anchor_post_idx + 1 :]


def patch_route(
    route: dict,
    polyline_south: list[list[float]],
    polyline_north: list[list[float]],
    macau_approach: list[float],
    taipa_approach: list[float],
) -> bool:
    """Mutate route['geometry']['geometry']['coordinates'] in place.

    Returns True if the route was modified.
    """
    coords = route.get("geometry", {}).get("geometry", {}).get("coordinates", [])
    if len(coords) < 2:
        return False

    # Idempotency guard: user-provided Y-junction has unique precision
    # that never appears in OSRM-native coords.
    sig_lng, sig_lat = 113.54378841447661, 22.187214667083378
    for c in coords:
        if abs(c[0] - sig_lng) < 1e-9 and abs(c[1] - sig_lat) < 1e-9:
            print(f"    skip: already patched (Y-junction signature found)")
            return False

    runs = find_channel_runs(coords)
    if not runs:
        print(f"    skip: no channel crossing in geometry")
        return False

    print(f"    {len(runs)} channel run(s)")

    is_bilateral = route.get("routeType") == "bilateral"
    pristine_coords = list(coords) if is_bilateral else None

    for run in reversed(runs):
        coords = replace_run(
            coords, run, polyline_south, polyline_north,
            macau_approach, taipa_approach,
        )

    # For bilateral routes (direction-0 is one-way), build the return leg
    # by reversing the pristine direction-0 geometry and patching its
    # (now NB-direction) channel runs with the west Y-arm. This mirrors
    # how a real bilateral bus drives: forward through stops to terminus,
    # then back through the SAME stops in reverse, using the opposite
    # bridge arm. No OSRM cross-Taipa transition needed.
    if is_bilateral and pristine_coords is not None:
        print(f"    bilateral: building return leg from reversed pristine")
        reversed_pristine = list(reversed(pristine_coords))
        rev_runs = find_channel_runs(reversed_pristine)
        for rev_run in reversed(rev_runs):
            reversed_pristine = replace_run(
                reversed_pristine, rev_run, polyline_south, polyline_north,
                macau_approach, taipa_approach,
            )
        # Append return leg, skip first to avoid duplicating the last
        # forward coord (they're geographically identical = the terminus).
        coords = coords + reversed_pristine[1:]
        # Mark as circular so simulation engine does forward-only loop.
        route["routeType"] = "circular"

    route["geometry"]["geometry"]["coordinates"] = coords
    return True


def run():
    bridges, bridge_routes, routes = load_inputs()

    bridge = bridges["macau_taipa_bridge"]
    macau_approach = bridge["macau_approach"]
    taipa_approach = bridge["taipa_approach"]
    bridge_span = bridge["coordinates"]
    sb_roundabout = bridge["macau_sb_roundabout"]
    nb_roundabout = bridge["macau_nb_roundabout"]
    y_up = bridge["macau_y_up"]
    y_down = bridge["macau_y_down"]
    y_junction = bridge["macau_y_junction"]
    taipa_sb_ramp_body = bridge["taipa_sb_ramp_body"]
    taipa_nb_ramp_body = bridge["taipa_nb_ramp_body"]

    # Pre-compute the Taipa approach legs via OSRM so that the rendered
    # ramps follow real streets (one-way restrictions in Taipa make
    # these paths meander, but at least they trace actual roads rather
    # than cutting through empty land as hand-drawn intermediates did).
    print("  Pre-computing Taipa approach legs via OSRM ...")
    sb_ramp_to_approach = osrm_or_straight(taipa_sb_ramp_body[-1], taipa_approach)
    time.sleep(OSRM_DELAY_S)
    nb_approach_to_ramp = osrm_or_straight(taipa_approach, taipa_nb_ramp_body[0])
    time.sleep(OSRM_DELAY_S)

    taipa_sb_ramp = list(taipa_sb_ramp_body) + list(sb_ramp_to_approach[1:])
    taipa_nb_ramp = list(nb_approach_to_ramp) + list(taipa_nb_ramp_body[1:])

    # South-bound (Macau -> Taipa): Macau terminal -> Macau roundabout CW
    # -> 上橋位(east) -> 橋端點 -> bridge span -> Taipa east ramp (下橋點)
    # -> Taipa approach
    polyline_south_raw = (
        list(sb_roundabout)
        + [y_up, y_junction]
        + list(bridge_span)
        + list(taipa_sb_ramp[1:])
    )
    # North-bound (Taipa -> Macau): Taipa approach -> Taipa west ramp
    # (上橋點) -> bridge span reversed -> 橋端點 -> 下橋位 (west) ->
    # Macau roundabout CW -> Macau terminal
    polyline_north_raw = (
        list(taipa_nb_ramp)
        + list(reversed(bridge_span))[1:]
        + [y_junction, y_down]
        + list(nb_roundabout)
    )

    # Chaikin-smooth the hand-built bridge polylines to remove visual
    # Z-zigzags caused by user's closely-spaced ramp waypoints (e.g.
    # 9m back-jog at the Taipa Y-junction). Then densify to fill any
    # remaining long gaps with linear interpolation.
    polyline_south = densify(chaikin_smooth(polyline_south_raw, 2), BRIDGE_DENSIFY_M)
    polyline_north = densify(chaikin_smooth(polyline_north_raw, 2), BRIDGE_DENSIFY_M)
    target_route_ids = set(bridge_routes.get("macau_taipa_bridge", []))

    if not target_route_ids:
        print("No target routes configured in bridge_routes.json")
        return

    print(f"Patching {len(target_route_ids)} routes via Macau-Taipa Bridge")
    print(f"  South polyline: {len(polyline_south)} pts, North polyline: {len(polyline_north)} pts")

    by_id = {r["id"]: r for r in routes}
    patched = 0
    missing = []
    for rid in sorted(target_route_ids):
        if rid not in by_id:
            missing.append(rid)
            continue
        print(f"  Route {rid}:")
        if patch_route(
            by_id[rid], polyline_south, polyline_north,
            macau_approach, taipa_approach,
        ):
            patched += 1

    out_path = PUBLIC_DIR / "bus-routes.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(routes, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nDone: patched {patched}/{len(target_route_ids)} routes -> {out_path}")
    if missing:
        print(f"Missing route IDs (not in bus-routes.json): {missing}")


if __name__ == "__main__":
    run()
