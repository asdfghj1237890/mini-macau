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
# NB post-anchor needs a much larger window: when extract used Sai Van Bridge
# (the OSRM default), the original geometry after the channel run wanders
# through 議事亭/西灣 for 100+ coords before reaching the actual destination
# stop (e.g., 葡京). The default 15-coord window finds only Sai Van approach
# coords that are 500+m from MACAU_NB_EXIT, triggering OSRM detour rejection
# and skipping the whole patch. 200 reaches past the longest peninsula loop.
ANCHOR_POST_NB_WINDOW = 200
# SB pre-anchor mirror: routes whose last Macau stop is OUTSIDE the Amaral
# ring (e.g. 102 ends at M263 仙德麗街 east of the ring) cause OSRM to detour
# CCW around the ring + west to 西灣 + south to Sai Van before entering the
# channel. The 15-coord window then anchors on the Sai Van approach (lng
# ~113.532) far from Amaral, and leg_in routes a 1km loop NE back to
# macau_approach via AMARAL_EAST_EXIT — visible as a zigzag across 亞馬喇.
# 200 reaches back to an Amaral-area coord and trims the entire detour.
ANCHOR_PRE_SB_WINDOW = 200
BRIDGE_DENSIFY_M = 50.0
OSRM_DELAY_S = 0.7
METERS_PER_DEG_LAT = 111320.0

# East exit of 亞馬喇前地. Used as an OSRM via-hint when routing legs that
# start or end at macau_approach: the approach point is on the bridge ramp
# and OSRM driving profile cannot reliably route from it onto the peninsula
# road network (the natural east exit is bus-only in OSM). Forcing OSRM
# through this point makes leg_in/leg_out follow real roads instead of
# falling back to a long straight line through buildings.
AMARAL_EAST_EXIT: list[float] = [113.54390, 22.18893]

# NB ramp lands at macau_approach (north edge of 亞馬喇 ring), but OSRM
# treats that exact node as one-way SB-only — any leg_out from there detours
# 7–14× through 議事亭/南灣 before circling back. MACAU_NB_EXIT is 60m east,
# on a road OSRM can drive eastbound from cleanly (1.0× to 葡京). For NB
# crossings we extend the bridge polyline to here and OSRM the leg_out from
# this point instead of macau_approach.
MACAU_NB_EXIT: list[float] = [113.543897, 22.188927]


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
MIN_PERP_FOR_TRIM_M = 200.0
SAFE_TRIM_GAP_M = 200.0


def osrm_or_straight(
    a: list[float],
    b: list[float],
    via_hints: list[list[float]] | None = None,
    accept_detour: bool = False,
) -> list[list[float]]:
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

    via_hints: optional list of intermediate [lng, lat] coords to insert
    between a and b in the OSRM call. When provided, the detour/loop
    filters are skipped — the hint is the caller asserting they know
    the right corridor (e.g. forcing macau_approach legs through 亞馬喇
    east exit instead of OSRM picking a one-way knot).

    accept_detour: when True, disables the detour-ratio rejection. Use
    this for legs where a large detour is LEGITIMATE road behaviour (e.g.
    MACAU_NB_EXIT → anchor_post on the opposite side of the Amaral ring
    naturally requires circling the ring — 4-6x straight, but any
    fallback to straight would cut through Amaral's buildings).
    """
    waypoints = [a] + list(via_hints or []) + [b]
    try:
        coords = get_road_geometry(waypoints, profile="driving")
        time.sleep(OSRM_DELAY_S)
        if via_hints and coords and len(coords) >= 2:
            return coords
        if coords and len(coords) >= 2:
            if accept_detour:
                return coords
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
                    # Perp must BOTH exceed ratio and an absolute floor.
                    # Short legs (e.g. 300-500m Amaral roundabout traversal)
                    # naturally have perp ~100-150m = roundabout radius, which
                    # is legitimate road geometry, NOT a pathological loop.
                    bad_perp = (
                        max_perp_m > MAX_OSRM_PERP_RATIO * ab_dist
                        and max_perp_m > MIN_PERP_FOR_TRIM_M
                    )
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
    min_pre_idx: int = 0,
    max_post_idx: int | None = None,
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
        # NB: end of bridge polyline is MACAU_NB_EXIT (drivable),
        # not macau_approach (one-way SB-only ramp tip). anchor_post and
        # leg_out OSRM target this point so the post-bridge segment
        # follows a real road eastbound instead of looping the ring.
        post_target = MACAU_NB_EXIT
        bridge_directed = list(polyline_north)

    # SB direction needs the wider window (mirror of NB post-window): when
    # extract used Sai Van Bridge (OSRM default), the pre-channel coords
    # wander west through 西灣 for 100+ pts before entering the channel. The
    # default 15-coord window anchors on the Sai Van approach far from
    # Amaral, producing a 1km leg_in loop back NE through 亞馬喇.
    #
    # Within that wider window we want the EARLIEST coord near Amaral
    # (the entry point), not the closest to macau_approach. Pristine OSRM
    # from M263 sweeps Amaral CCW (E→S→W→NW) and the closest-to-N coord is
    # the NW exit — anchoring there leaves the CCW sweep in coords[:anchor]
    # while the bridge polyline adds a CW sweep on top, producing the same
    # zigzag we're trying to fix. Anchoring at the entry trims the CCW
    # sweep and lets the bridge polyline do the only ring traversal.
    pre_window = ANCHOR_PRE_SB_WINDOW if pre_target is macau_approach else ANCHOR_SEARCH_WINDOW
    pre_search_start = max(min_pre_idx, start - pre_window)
    NEAR_AMARAL_M2 = 200 * 200  # 200m radius
    anchor_pre_idx = start - 1
    if pre_target is macau_approach:
        for i in range(pre_search_start, start):
            if dist_m2(coords[i], pre_target) < NEAR_AMARAL_M2:
                anchor_pre_idx = i
                break
        else:
            # No Amaral-area coord in window — fall back to closest in default
            # 15-coord window (preserves prior behaviour for routes that don't
            # detour through Amaral).
            best_d = dist_m2(coords[anchor_pre_idx], pre_target)
            for i in range(max(min_pre_idx, start - ANCHOR_SEARCH_WINDOW), start):
                d = dist_m2(coords[i], pre_target)
                if d < best_d:
                    best_d = d
                    anchor_pre_idx = i
    else:
        best_d = dist_m2(coords[anchor_pre_idx], pre_target)
        for i in range(pre_search_start, start):
            d = dist_m2(coords[i], pre_target)
            if d < best_d:
                best_d = d
                anchor_pre_idx = i

    # NB direction needs the wider window to skip past the Sai Van peninsula
    # detour (~100 coords) that the OSRM extract laid down before reaching
    # the actual post-bridge stop (e.g., 葡京 for MT1, MT2, MT5).
    post_window = ANCHOR_POST_NB_WINDOW if post_target is MACAU_NB_EXIT else ANCHOR_SEARCH_WINDOW
    post_search_end = min(len(coords), end + 1 + post_window)
    if max_post_idx is not None:
        post_search_end = min(post_search_end, max_post_idx)
    anchor_post_idx = end + 1
    best_d = dist_m2(coords[anchor_post_idx], post_target)
    for i in range(end + 1, post_search_end):
        d = dist_m2(coords[i], post_target)
        if d < best_d:
            best_d = d
            anchor_post_idx = i

    anchor_pre = coords[anchor_pre_idx]
    anchor_post = coords[anchor_post_idx]

    leg_in_hints = [AMARAL_EAST_EXIT] if pre_target is macau_approach else None
    leg_out_hints = [AMARAL_EAST_EXIT] if post_target is macau_approach else None
    # NB leg_out: post_target is MACAU_NB_EXIT and legitimate road paths from
    # there to anchor_post almost always require circling the Amaral ring
    # (4-6x straight). Accept the detour rather than fall back to a straight
    # that cuts through Amaral's buildings.
    leg_out_accept_detour = post_target is MACAU_NB_EXIT
    print(f"    OSRM connector A: {anchor_pre} -> {pre_target}" + (" via Amaral" if leg_in_hints else ""))
    leg_in = osrm_or_straight(anchor_pre, pre_target, via_hints=leg_in_hints)
    print(f"    OSRM connector B: {post_target} -> {anchor_post}" + (" via Amaral" if leg_out_hints else "") + (" accept-detour" if leg_out_accept_detour else ""))
    leg_out = osrm_or_straight(post_target, anchor_post, via_hints=leg_out_hints, accept_detour=leg_out_accept_detour)

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

    # Idempotency guard: MACAU_NB_EXIT is the last coord of polyline_north
    # (preserved by Chaikin since endpoints are fixed). Its high-precision
    # value never appears in pristine OSRM output. The previous Y-junction
    # check was broken because Chaikin smooths interior points.
    sig_lng, sig_lat = MACAU_NB_EXIT
    for c in coords:
        if abs(c[0] - sig_lng) < 1e-9 and abs(c[1] - sig_lat) < 1e-9:
            print(f"    skip: already patched (MACAU_NB_EXIT signature found)")
            return False

    runs = find_channel_runs(coords)
    if not runs:
        print(f"    skip: no channel crossing in geometry")
        return False

    print(f"    {len(runs)} channel run(s)")

    # Process runs in FORWARD (chronological) order with offset tracking.
    # Clamp each run's anchor search window so it cannot intrude into an
    # adjacent run's region:
    #   - anchor_pre search cannot go below the END of the previous run's
    #     splice (would swallow what's already patched)
    #   - anchor_post search cannot exceed the START of the next run
    #     (would swallow the between-runs original coords, critical for
    #     routes like 39 where there's only 1-2 coords of Taipa transit
    #     between the two channel runs)
    sorted_runs = sorted(runs, key=lambda r: r[0])
    offset = 0
    prev_splice_end = 0
    for i, run in enumerate(sorted_runs):
        s, e = run
        s_adj, e_adj = s + offset, e + offset
        # Next run's (adjusted) start bounds our anchor_post search.
        if i + 1 < len(sorted_runs):
            next_s_adj = sorted_runs[i + 1][0] + offset
        else:
            next_s_adj = None
        len_before = len(coords)
        new_coords = replace_run(
            coords, (s_adj, e_adj), polyline_south, polyline_north,
            macau_approach, taipa_approach,
            min_pre_idx=prev_splice_end,
            max_post_idx=next_s_adj,
        )
        size_diff = len(new_coords) - len_before
        offset += size_diff
        # End of the splice we just made, in the new coords -- at least
        # e_adj advanced by size_diff; use that as the floor for the next
        # run's anchor_pre search.
        prev_splice_end = e_adj + size_diff + 1
        coords = new_coords

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
    # Macau roundabout CW -> Macau terminal -> east exit (drivable point)
    polyline_north_raw = (
        list(taipa_nb_ramp)
        + list(reversed(bridge_span))[1:]
        + [y_junction, y_down]
        + list(nb_roundabout)
        + [MACAU_NB_EXIT]
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
