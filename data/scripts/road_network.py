"""Shared Macau-only road canvas for the utility distribution overlays.

Both `fetch_water_distribution.py` and `fetch_power_distribution.py` ship the
same thing: every drivable road inside the Macau SAR, simplified and ORIENTED
so it runs away from that utility's sources. Only the seed set differs (treated
-water facilities vs every HV substation), so everything else lives here.

Why ship a road file at all when the basemap already draws roads? Because the
basemap cannot be clipped. OpenFreeMap's tiles cover the whole region, so
re-styling the basemap's `transportation` layer to show "the distribution grid"
would light up Zhuhai and Hengqin exactly as brightly as Macau — and the point
of the overlay is that this is MACAU's distribution layer. Clipping has to
happen where the data is made, not in the style, so the roads are cut against
OSM's Macau boundary here and shipped as their own small file.

Scope: OSM relation 1867188 (澳門 Macau), used as Overpass area 3601867188.
That boundary INCLUDES the University of Macau campus on Hengqin (which is
Macau-administered under lease) and excludes Hengqin town, so the file follows
the legal border rather than the shoreline — verified by the campus roads
coming back and the Hengqin town roads not.

Only the ways a car can drive are kept (`highway` in CLASSES); `service` ways
that are parking aisles, driveways or drive-throughs are dropped because they
are car-park furniture, not street network.

Overpass's `(area.macau)` filter is not enough on its own: a way counts as
"in" an area when ANY of its nodes is, so `out geom` hands back whole ways —
including the Zhuhai half of the HZMB port island and the Hengqin Port
approaches to Lotus Bridge (4.7 km of Zhuhai road, measured). Every way is
therefore CLIPPED against the boundary polygon; a way that crosses the border
comes out as one or more Macau-side pieces.

FLOW DIRECTION. Each road's coordinate order is meaningful: it runs from the
end nearer a source to the end further away, so a dashed line animated along
the array reads as the utility flowing outward. The distance field is a
multi-source Dijkstra over the road graph, seeded at the caller's facilities.
`dist` / `distEnd` carry the metres at each end. Roads in a component no source
can reach keep their original order and get `dist: null`.

Two Overpass calls (boundary + roads), cached for a day
(osm_footprints.OVERPASS_CACHE_DIR) and shared by both callers — the second
overlay's run costs nothing.
"""

import heapq
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from typing import Callable, Sequence

from shapely.geometry import LineString, MultiLineString

from osm_footprints import metres_xy, overpass, polygon_of_element, xy_lnglat

OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright"
BOUNDARY_RELATION = 1867188
BOUNDARY_NOTE = f"OSM relation {BOUNDARY_RELATION} (Macau SAR)"
# Overpass area id for a relation is 3600000000 + the relation id.
BOUNDARY_AREA = 3600000000 + BOUNDARY_RELATION

# Drivable street classes, in rough descending importance. The regex is
# anchored, so `motorway_link` and friends never come along.
CLASSES = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "service",
)
# `service` covers both back lanes (worth drawing) and car-park furniture
# (not). These subtypes are the furniture.
SERVICE_EXCLUDED = {"parking_aisle", "driveway", "drive-through"}

LAT0 = 22.16  # local metres-per-degree reference, as in the other scripts
# 6 m rather than a lane's 3 m: the flow pass adds `dist` / `distEnd` to every
# road (~150 KiB) and protects junction vertices from simplification (more
# points again), and the file has a hard size budget. The difference is
# invisible at any map zoom; at 3 m the file lands well over MAX_BYTES.
SIMPLIFY_TOLERANCE_M = 6.0
# A stub this short is a junction artefact, not a street worth drawing. It is
# dropped from the OUTPUT only — the graph is built from every way, short ones
# included, because a 12 m link is often exactly what joins two blocks and
# dropping it before the Dijkstra would strand whatever hangs off it.
MIN_LENGTH_M = 25.0
COORD_PRECISION = 5  # ~1.1 m; the file is a backdrop, not a survey
GRAPH_PRECISION = 6  # graph node key; coordinates are already at COORD_PRECISION

# A source that has to reach this far to touch the road graph is either
# mis-placed or genuinely off-street (a tank on a hilltop, a substation inside
# a casino podium); print it either way.
SNAP_WARN_M = 150.0

# Degenerate-run guards, mirrored by validate_output.py's
# v_water_distribution / v_power_distribution.
MIN_ROADS = 2000
MIN_REACHED_FRACTION = 0.8
MAX_BYTES = 700 * 1024


def out_key(pt) -> tuple[float, float]:
    """Key at the precision the file is written with (junction identity)."""
    return (round(pt[0], COORD_PRECISION), round(pt[1], COORD_PRECISION))


def graph_key(pt) -> tuple[float, float]:
    return (round(pt[0], GRAPH_PRECISION), round(pt[1], GRAPH_PRECISION))


def fetch_boundary():
    """The Macau SAR polygon, used to clip ways that straddle the border."""
    els = overpass(f"[out:json][timeout:180];relation({BOUNDARY_RELATION});out geom;")
    if not els:
        raise RuntimeError(f"OSM relation {BOUNDARY_RELATION} did not resolve")
    poly = polygon_of_element(els[0])
    if poly is None or poly.is_empty:
        raise RuntimeError(f"OSM relation {BOUNDARY_RELATION} has no usable polygon")
    name = els[0].get("tags", {}).get("name", "?")
    print(f"Boundary: relation {BOUNDARY_RELATION} ({name}), {poly.geom_type}, "
          f"bounds {[round(v, 5) for v in poly.bounds]}")
    return poly


def fetch_roads() -> list[dict]:
    """Every drivable way whose geometry Overpass places inside the boundary."""
    pattern = "|".join(CLASSES)
    query = (
        f"[out:json][timeout:300];area({BOUNDARY_AREA})->.macau;"
        f'way["highway"~"^({pattern})$"](area.macau);'
        "out geom;"
    )
    print(f"Fetching drivable ways inside area {BOUNDARY_AREA} ({BOUNDARY_NOTE})")
    return overpass(query)


def clip_to(boundary, geometry: list[dict]) -> list[list[tuple[float, float]]]:
    """The Macau-side piece(s) of one OSM way, as lng/lat point lists."""
    pts = [(p["lon"], p["lat"]) for p in geometry]
    if len(pts) < 2:
        return []
    inside = LineString(pts).intersection(boundary)
    if inside.is_empty:
        return []
    if isinstance(inside, LineString):
        parts = [inside]
    elif isinstance(inside, MultiLineString):
        parts = list(inside.geoms)
    else:  # GeometryCollection: a border touch can yield stray Points
        parts = [g for g in getattr(inside, "geoms", []) if isinstance(g, LineString)]
    return [list(p.coords) for p in parts if len(p.coords) >= 2]


def simplify_protected(pts, junctions) -> tuple[list[list[float]], float] | None:
    """Simplify one clipped way in metres, keeping every junction vertex.

    Simplifying in degrees would squash longitude by cos(lat), so the tolerance
    is applied in the local metric projection. Douglas-Peucker only guarantees
    the first and last vertex survive, and a vertex shared with another way is
    exactly what glues the road graph together — drop one and a T-junction
    becomes two disconnected streets, stranding a whole neighbourhood outside
    the flow field. So the way is simplified in chunks between its junction
    vertices instead of in one go.
    """
    cuts = [0]
    cuts += [i for i in range(1, len(pts) - 1) if out_key(pts[i]) in junctions]
    cuts.append(len(pts) - 1)

    metric: list[tuple[float, float]] = []
    for a, b in zip(cuts, cuts[1:]):
        if b <= a:
            continue
        chunk = [metres_xy(x, y, LAT0) for x, y in pts[a:b + 1]]
        simple = list(LineString(chunk).simplify(SIMPLIFY_TOLERANCE_M).coords)
        metric.extend(simple if not metric else simple[1:])
    if len(metric) < 2:
        return None
    length = sum(math.dist(metric[i], metric[i + 1]) for i in range(len(metric) - 1))

    out: list[list[float]] = []
    for x, y in metric:
        lng, lat = xy_lnglat(x, y, LAT0)
        point = [round(lng, COORD_PRECISION), round(lat, COORD_PRECISION)]
        # Rounding to ~1.1 m can collapse two neighbours onto one point.
        if not out or out[-1] != point:
            out.append(point)
    if len(out) < 2:
        return None
    return out, length


def build_graph(roads) -> dict:
    """Undirected road graph: node = coordinate, edge weight = metres."""
    graph: dict[tuple[float, float], list[tuple[tuple[float, float], float]]] = {}
    for _cls, coords, _emit in roads:
        for a, b in zip(coords, coords[1:]):
            ka, kb = graph_key(a), graph_key(b)
            if ka == kb:
                continue
            w = math.dist(metres_xy(a[0], a[1], LAT0), metres_xy(b[0], b[1], LAT0))
            graph.setdefault(ka, []).append((kb, w))
            graph.setdefault(kb, []).append((ka, w))
    return graph


def snap(nodes_xy, coordinates) -> tuple[tuple[float, float], float]:
    """Nearest graph node to a facility marker, and how far it had to reach."""
    fx, fy = metres_xy(coordinates[0], coordinates[1], LAT0)
    best = None
    best_d = None
    for node, (x, y) in nodes_xy:
        d = (x - fx) ** 2 + (y - fy) ** 2
        if best_d is None or d < best_d:
            best_d, best = d, node
    return best, math.sqrt(best_d)


def multi_source_dijkstra(graph, starts) -> dict:
    """Metres from the nearest source, per node. Unreached nodes are absent."""
    dist: dict[tuple[float, float], float] = {}
    heap = [(0.0, s) for s in starts]
    heapq.heapify(heap)
    while heap:
        d, u = heapq.heappop(heap)
        if u in dist:
            continue
        dist[u] = d
        for v, w in graph.get(u, ()):
            if v not in dist:
                heapq.heappush(heap, (d + w, v))
    return dist


def split_and_orient(coords, dists):
    """Cut a road at every interior local minimum, then point each piece out.

    A road that touches two sources dips in the middle of nowhere and rises at
    both ends — one arrow cannot describe that, so it becomes two roads. After
    the cuts each piece is reversed if its far end is the nearer one, which is
    what makes `distEnd >= dist` hold for everything downstream.
    """
    cuts = [i for i in range(1, len(coords) - 1)
            if dists[i] < dists[i - 1] and dists[i] < dists[i + 1]]
    bounds = [0] + cuts + [len(coords) - 1]
    pieces = []
    for a, b in zip(bounds, bounds[1:]):
        c, d = coords[a:b + 1], dists[a:b + 1]
        if len(c) < 2:
            continue
        if d[-1] < d[0]:
            c, d = c[::-1], d[::-1]
        pieces.append((c, d))
    return pieces


def build_distribution(
    output_path,
    sources: Sequence[dict],
    *,
    source_note: str,
    describe: Callable[[dict], str] = lambda f: "",
) -> int:
    """Fetch, clip, simplify and orient the road canvas; write `output_path`.

    `sources` is the seed list in the order it should appear in `flowSources`;
    each entry needs an `id` and a `[lng, lat]` `coordinates`. `describe`
    returns the short label printed next to a source in the snap report.
    Returns a process exit code (0 = written and within budget).
    """
    boundary = fetch_boundary()
    elements = fetch_roads()
    print(f"  {len(elements)} ways returned")

    # --- clip, then find the vertices two ways share -------------------------
    clipped_ways: list[tuple[str, list[tuple[float, float]]]] = []
    dropped_service = 0
    trimmed = 0
    for el in elements:
        tags = el.get("tags", {})
        cls = tags.get("highway")
        if cls not in CLASSES:
            continue
        if cls == "service" and tags.get("service") in SERVICE_EXCLUDED:
            dropped_service += 1
            continue
        geometry = el.get("geometry", [])
        pieces = clip_to(boundary, geometry)
        if len(pieces) != 1 or len(pieces[0]) != len(geometry):
            trimmed += 1
        for piece in pieces:
            clipped_ways.append((cls, piece))

    seen: Counter = Counter()
    for _cls, pts in clipped_ways:
        for pt in pts:
            seen[out_key(pt)] += 1
    junctions = {k for k, n in seen.items() if n >= 2}
    print(f"  dropped {dropped_service} parking-aisle/driveway service ways; "
          f"{trimmed} ways trimmed at the border; {len(junctions)} shared vertices "
          "protected from simplification")

    # --- simplify ------------------------------------------------------------
    # Everything that survives simplification goes into the graph; `emit` says
    # whether it is also worth drawing.
    simplified: list[tuple[str, list[list[float]], bool]] = []
    degenerate = 0
    stubs = 0
    total_m = 0.0
    for cls, pts in clipped_ways:
        result = simplify_protected(pts, junctions)
        if result is None:
            degenerate += 1
            continue
        coords, length = result
        emit = length >= MIN_LENGTH_M
        if not emit:
            stubs += 1
        simplified.append((cls, coords, emit))
        total_m += length
    print(f"  {len(simplified)} ways after simplification ({degenerate} collapsed "
          f"to a point; {stubs} kept for the graph but too short to draw)")

    # --- flow field ----------------------------------------------------------
    graph = build_graph(simplified)
    nodes_xy = [(n, metres_xy(n[0], n[1], LAT0)) for n in graph]
    print(f"\nFlow sources: {len(sources)} — {source_note}")

    starts = []
    source_ids = []
    worst_snap = 0.0
    for f in sources:
        node, d = snap(nodes_xy, f["coordinates"])
        starts.append(node)
        source_ids.append(f["id"])
        worst_snap = max(worst_snap, d)
        flag = f"   <-- SUSPICIOUS: over {SNAP_WARN_M:.0f} m from any road" if d > SNAP_WARN_M else ""
        print(f"  {f['id']:<20} {describe(f):<8} snap {d:6.1f} m{flag}")
    print(f"  worst snap: {worst_snap:.1f} m")

    dist = multi_source_dijkstra(graph, starts)
    print(f"  {len(dist)} / {len(graph)} graph nodes reached")

    # --- orient every road outward ------------------------------------------
    roads: list[dict] = []
    by_class: Counter = Counter()
    unreached = 0
    split_roads = 0
    extra_pieces = 0
    max_dist = 0.0
    for cls, coords, emit in simplified:
        if not emit:
            continue
        keys = [graph_key(c) for c in coords]
        if any(k not in dist for k in keys):
            # Every vertex of a road is in one component, so this is the whole
            # road: no source can reach it. Leave it as OSM drew it.
            roads.append({"class": cls, "dist": None, "distEnd": None,
                          "coordinates": coords})
            by_class[cls] += 1
            unreached += 1
            continue
        dists = [dist[k] for k in keys]
        pieces = split_and_orient(coords, dists)
        if len(pieces) > 1:
            split_roads += 1
            extra_pieces += len(pieces) - 1
        for c, d in pieces:
            roads.append({"class": cls, "dist": int(round(d[0])),
                          "distEnd": int(round(d[-1])), "coordinates": c})
            by_class[cls] += 1
            max_dist = max(max_dist, d[-1])

    reached = len(roads) - unreached
    print(f"\n  {reached} roads oriented, {unreached} unreached, "
          f"{split_roads} split at a local minimum (+{extra_pieces} pieces), "
          f"max dist {max_dist:.0f} m")

    problems = []
    if len(roads) < MIN_ROADS:
        problems.append(f"only {len(roads)} roads (< {MIN_ROADS})")
    if reached < MIN_REACHED_FRACTION * len(roads):
        problems.append(f"only {reached}/{len(roads)} roads reached by a source "
                        f"(< {MIN_REACHED_FRACTION:.0%}) — the graph is shattered")
    if not source_ids:
        problems.append("no flow sources supplied")
    if problems:
        for p in problems:
            print(f"ERROR: {p}", file=sys.stderr)
        print("refusing to write", file=sys.stderr)
        return 1

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "sources": {"osm": OSM_COPYRIGHT, "boundary": BOUNDARY_NOTE},
        "classes": list(CLASSES),
        # The facilities the flow field was seeded from, how many roads no
        # source could reach, and how many ways had to be cut at a local
        # minimum. Named `flowSources` because `sources` is the provenance
        # block every dataset in public/data carries.
        "flowSources": source_ids,
        "unreached": unreached,
        "splits": split_roads,
        "roads": roads,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Compact: this file is one big geometry blob, and `indent=2` would put
    # every coordinate pair on its own line and triple the size for nothing.
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    size = output_path.stat().st_size
    points = sum(len(r["coordinates"]) for r in roads)
    print(f"\nDone. {len(roads)} roads, {points} coordinate points, "
          f"{total_m / 1000:.1f} km")
    for cls in CLASSES:
        if by_class[cls]:
            print(f"  {cls:<14} {by_class[cls]:>5}")
    print(f"File size: {size / 1024:.1f} KiB "
          f"({'OK' if size < MAX_BYTES else 'OVER'} the {MAX_BYTES / 1024:.0f} KiB budget)")
    print(f"Wrote {output_path}")
    return 0 if size < MAX_BYTES else 1
