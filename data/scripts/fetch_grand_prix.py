"""Build public/data/grand-prix.json: the Macau Grand Prix street circuit —
one closed racing line in race direction, the pit lane, and the nine officially
named locations along the lap.

Sources
  * The GEOMETRY is OpenStreetMap relation 8877949 「Circuito da Guia」
    (`type=circuit`) via Overpass: 67 member ways with an empty role and 5 with
    role `pit_lane`. Member ORDER in the relation is not path order and the
    member set is not a lap — see METHOD below.
  * The NAMES are the Macau Grand Prix Committee's own circuit page, one per
    language, and the circuit diagram each language serves
    (`/uploads/media/page/track_b_{en,tc,pt}.jpg`):
        https://www.macau.grandprix.gov.mo/en/about-us/matchpath
        https://www.macau.grandprix.gov.mo/zh-hant/about-us/matchpath
        https://www.macau.grandprix.gov.mo/pt/about-us/matchpath
    The circuit's own name is the page heading in each language (東望洋跑道 /
    Guia Circuit / Circuito da Guia); the nine location names below are read
    verbatim off each language's own diagram. The pages are a JS app and the
    diagram is a picture, so nothing here is scraped at runtime: the strings
    are transcribed, the URLs are cited, and the diagram is the evidence.
  * The FACTS「Length: 6.2KM」and「Minimum width 7M」are printed on the same
    diagram. The site publishes no coordinates, no turn count and no direction
    text — every coordinate in `corners` is ours (see METHOD).
  * The LAP RECORD is Wikipedia (secondary, not an official source):
    https://en.wikipedia.org/wiki/Guia_Circuit — 2:06.257, Luke Browning,
    Dallara F3 2019, 18 November 2023. The same page gives the lap as
    6.120 km, which is the independent cross-check on the stitched loop below.

METHOD — how one lap is recovered from the relation
  The relation is not a ready-made lap. Its main-role ways sum to ~8.1 km
  against a 6.2 km lap because BOTH carriageways of Avenida da Amizade are
  members, and the south-west-bound carriageway (the one the race and the pit
  lane are on) stops ~310 m short of Lisboa: three ways that continue it are
  simply not in the relation. So:

  1. Every member way is cut at each vertex it shares with another member,
     giving segments whose endpoints are true junctions; endpoints within
     SNAP_M of each other are the same graph node.
  2. Dead ends are repaired in two steps, both reported:
     a. a straight bridge to the nearest non-adjacent node within
        DEAD_END_BRIDGE_M (dual carriageways split at two distinct OSM nodes a
        few metres apart — e.g. the Pescadores/Amizade corner);
     b. otherwise a shortest path of at most NAMED_BRIDGE_MAX_M along OSM ways
        carrying the SAME `name` as the dead-end way, fetched separately, back
        to any node of the graph. That is what restores Avenida da Amizade.
  3. All simple cycles of the resulting graph are enumerated. A racing line
     must touch BOTH ends of the pit lane, so cycles that do not pass within
     PIT_JUNCTION_M of each pit-lane endpoint are dropped; of the rest the one
     closest to the official 6.2 km wins, and the run FAILS if that is more
     than LENGTH_TOLERANCE off. The winner measures 6.12 km — the figure
     Wikipedia publishes.
  4. `oneway` is REPORTED, not enforced. A street circuit is a closed road: a
     lap that honoured every `oneway` tag does not exist here (Rua dos
     Pescadores has no eastbound exit onto Avenida da Amizade in OSM, and the
     Lisboa approach is tagged the other way). The script prints how many
     metres of the lap run against the tags — currently ~0.75 km of 6.12 km —
     so the mismatch is visible instead of silently "fixed".
  5. The lap is oriented from the official diagram's race direction: from
     Start/Finish the cars run south-west along Avenida da Amizade, so the
     Mandarin Oriental and Lisboa corners must both come before the
     Estrada de Cacilhas section. The lap is reversed if they do not, then
     rotated to start at Start/Finish.

  The nine `corners` carry OUR coordinates, never the organiser's: the site
  publishes none. Each one records `approximate: true` and the `rule` that
  produced it. `kind: "section"` entries are stretches, not points, and carry
  `spanKm` as well as a representative point.

CORNERS — where the diagram was used to settle a rule
  The organiser's diagram is a stylised drawing, but it is a faithful rotation:
  fitting image pixels to metres on two points (Start/Finish and Lisboa)
  reproduces the Mandarin Oriental, Maternity and Melco circles to 14 m, 26 m
  and 52 m. That fit is what decided the last two corners, and both differ from
  the obvious reading, so they are called out here:

  * OSM node 2165427895 is the ONLY element in the map carrying an official
    corner name — bus stop「水塘北角/勞工事務局 R Bend / DSAL」— but it is not
    at the "R" Bend. It sits 49 m from the east end of Rua dos Pescadores, i.e.
    at the corner the diagram labels FISHERMEN'S BEND, and 597 m from where the
    diagram puts the「水塘北角彎」/ "R" Bend. Its Chinese name (「reservoir north
    corner」) matches its position: the reservoir's north corner. Pinning the
    "R" Bend to it would put corner 9 ahead of corners 7 and 8 and break the
    organiser's own order, so it is reported as evidence on Fishermen's Bend
    instead of used as the R Bend anchor.
  * The Melco Hairpin — the sharpest vertex of the lap, 158° where Estrada de
    D. Maria II meets Rua dos Pescadores — sits at the START of the Pescadores
    stretch, so Fishermen's Bend skips HAIRPIN_SKIP_M around it, exactly as
    Maternity skips the un-named San Francisco Bend after Lisboa.
  * "R" Bend is then the sharpest vertex of the Avenida da Amizade run between
    Fishermen's Bend and Start/Finish — the turn onto the final straight, 50 m
    from where the diagram draws it.

Run manually when OSM or the organiser's page changes (not scheduled, like
fetch_water_facilities.py / fetch_power_facilities.py):
    cd data && uv run python scripts/fetch_grand_prix.py
Needs network (overpass-api.de). Overpass answers are cached in the OS temp
dir, so a re-run right after a failed one is cheap.
"""

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

from shapely import affinity
from shapely.geometry import LineString, Point

from osm_footprints import overpass, polygon_of_element

ROOT = Path(__file__).parent.parent.parent
OUTPUT_PATH = ROOT / "public" / "data" / "grand-prix.json"

# The summary this prints is mostly Chinese and Portuguese. A Windows console
# defaults to a legacy code page (cp950 here) and would raise UnicodeEncodeError
# AFTER the JSON was written, so the run would report failure on a good file.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

RELATION_ID = 8877949
OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright"
MATCHPATH = {
    "en": "https://www.macau.grandprix.gov.mo/en/about-us/matchpath",
    "zh": "https://www.macau.grandprix.gov.mo/zh-hant/about-us/matchpath",
    "pt": "https://www.macau.grandprix.gov.mo/pt/about-us/matchpath",
}
DIAGRAM = "https://www.macau.grandprix.gov.mo/uploads/media/page/track_b_en.jpg"
WIKIPEDIA = "https://en.wikipedia.org/wiki/Guia_Circuit"

# Straight off the organiser's diagram.
OFFICIAL_LENGTH_KM = 6.2
OFFICIAL_MIN_WIDTH_M = 7
# Wikipedia's Formula 3 record, stored exactly as that page prints it.
LAP_RECORD = {
    "time": "2:06.257",
    "seconds": 126.257,
    "driver": "Luke Browning",
    "year": 2023,
    "car": "Dallara F3 2019",
    "source": "wikipedia",
}

# Local metres-per-degree reference, as in the other scripts.
LAT0 = 22.20
M_PER_DEG_LNG = 111320.0 * math.cos(math.radians(LAT0))
M_PER_DEG_LAT = 110540.0
# Two OSM nodes this close are the same junction for graph purposes. Kept
# tight: the two carriageways of Avenida da Amizade split at nodes ~7 m apart
# and must NOT fuse, or the lap could hop between them.
SNAP_M = 5.0
# A dead end is allowed a straight bridge this far to a non-adjacent node.
DEAD_END_BRIDGE_M = 12.0
# ...and otherwise this far along same-named OSM ways.
NAMED_BRIDGE_MAX_M = 400.0
# How close a candidate lap has to pass to each end of the pit lane.
PIT_JUNCTION_M = 20.0
# Reject the run rather than ship a lap that is not the lap.
LENGTH_TOLERANCE = 0.05
# Heading is measured over this much track either side of a vertex, so the
# turning angle reflects the corner and not one noisy 2 m OSM segment.
ANGLE_WINDOW_M = 25.0
# A long constant-radius sweeper turns little at any one vertex; the "R" Bend
# onto the final straight needs a wider ruler than a point corner does.
SWEEP_WINDOW_M = 60.0
# How close the track has to come to the reservoir to count as alongside it.
RESERVOIR_NEAR_M = 60.0
# The un-named San Francisco Bend sits right after Lisboa; the Maternity
# search starts past it. The Melco Hairpin sits at the start of the Rua dos
# Pescadores stretch, so Fishermen's skips the same distance around it.
MATERNITY_SKIP_M = 150.0
HAIRPIN_SKIP_M = 150.0

# Bus stop 水塘北角/勞工事務局 R Bend / DSAL — the only element in OSM that
# carries one of the official corner names.
R_BEND_NODE = 2165427895

# Officially named locations, in race order, transcribed verbatim from the
# organiser's three diagrams (track_b_tc / track_b_pt / track_b_en).
CORNERS = [
    ("start-finish", "start_finish", "起點/終點", "Partida / Chegada", "Start/Finish"),
    ("mandarin-oriental", "bend", "文華東方彎", "Curva Mandarin Oriental", "Mandarin Oriental Bend"),
    ("lisboa", "bend", "葡京彎", "Curva Lisboa", "Lisboa Bend"),
    ("maternity", "bend", "產房彎", "Curva da Maternidade", "Maternity Bend"),
    ("solitude-esses", "section", "劏狗環", "Esses da Solidão", "Solitude Esses"),
    ("melco-hairpin", "bend", "髮夾彎", "Curva Melco", "Melco Hairpin"),
    ("fishermens", "bend", "漁翁彎", "Curva dos Pescadores", "Fishermen's Bend"),
    ("reservoir", "section", "水塘", "Reservatório", "Reservoir"),
    ("r-bend", "bend", "水塘北角彎", 'Curva "R"', '"R" Bend'),
]
CORNER_ORDER = [c[0] for c in CORNERS]

# OSM `name` fragments that identify the named stretches of the lap.
CACILHAS = "Estrada de Cacilhas"
PESCADORES = "Rua dos Pescadores"
AMIZADE = "Avenida da Amizade"

ONEWAY_FORWARD = {"yes", "true", "1"}
ONEWAY_REVERSE = {"-1", "reverse"}


# ----------------------------------------------------------------------------
# geometry helpers (plane approximation; the circuit is 2 km across)
# ----------------------------------------------------------------------------
def xy(pt: tuple[float, float]) -> tuple[float, float]:
    return (pt[0] * M_PER_DEG_LNG, pt[1] * M_PER_DEG_LAT)


def dist_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    ax, ay = xy(a)
    bx, by = xy(b)
    return math.hypot(ax - bx, ay - by)


def line_length_m(coords: list[tuple[float, float]]) -> float:
    return sum(dist_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def cumulative_m(coords: list[tuple[float, float]]) -> list[float]:
    out = [0.0]
    for i in range(len(coords) - 1):
        out.append(out[-1] + dist_m(coords[i], coords[i + 1]))
    return out


def point_at_m(coords, cum, d: float) -> tuple[float, float]:
    """Interpolate along a polyline, wrapping around a closed ring."""
    d %= cum[-1]
    lo, hi = 0, len(cum) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if cum[mid] <= d:
            lo = mid
        else:
            hi = mid
    span = cum[lo + 1] - cum[lo]
    t = 0.0 if span <= 0 else (d - cum[lo]) / span
    a, b = coords[lo], coords[lo + 1]
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def bearing(a, b) -> float:
    ax, ay = xy(a)
    bx, by = xy(b)
    return math.degrees(math.atan2(bx - ax, by - ay))


def turning_angles(coords, cum, window_m: float = ANGLE_WINDOW_M) -> list[float]:
    """Absolute heading change at each vertex, measured over `window_m` either
    side so one noisy 2 m OSM segment cannot masquerade as a corner. A wider
    window is what finds a long sweeper, whose per-vertex change is small."""
    out = []
    for i, d in enumerate(cum[:-1]):
        back = point_at_m(coords, cum, d - window_m)
        fwd = point_at_m(coords, cum, d + window_m)
        delta = bearing(coords[i], fwd) - bearing(back, coords[i])
        out.append(abs((delta + 180.0) % 360.0 - 180.0))
    return out


def near_span(coords, cum, geom_m, max_m, lo, hi, step: float = 10.0):
    """Longest run of track between `lo` and `hi` metres that stays within
    `max_m` of a geometry. Sampled by distance, not by vertex: the OSM way
    along the reservoir carries one vertex every ~150 m."""
    best = run = None
    d = lo
    while d <= hi:
        if geom_m.distance(metric_point(point_at_m(coords, cum, d))) <= max_m:
            run = (d, d) if run is None else (run[0], d)
            if best is None or run[1] - run[0] > best[1] - best[0]:
                best = run
        else:
            run = None
        d += step
    return best


def to_metres(geom):
    """A shapely geometry in degrees, rescaled so distances come out in metres."""
    return affinity.scale(geom, xfact=M_PER_DEG_LNG, yfact=M_PER_DEG_LAT, origin=(0, 0))


def metric_point(pt) -> Point:
    return Point(pt[0] * M_PER_DEG_LNG, pt[1] * M_PER_DEG_LAT)


def nearest_to_geom(coords, geom_m) -> tuple[int, float]:
    """(index, metres) of the track vertex closest to a metre-scaled geometry."""
    best, best_d = 0, float("inf")
    for i, c in enumerate(coords):
        d = geom_m.distance(metric_point(c))
        if d < best_d:
            best, best_d = i, d
    return best, best_d


def nearest_to_point(coords, pt) -> tuple[int, float]:
    best, best_d = 0, float("inf")
    for i, c in enumerate(coords):
        d = dist_m(c, pt)
        if d < best_d:
            best, best_d = i, d
    return best, best_d


# ----------------------------------------------------------------------------
# Overpass
# ----------------------------------------------------------------------------
def fetch_relation() -> tuple[dict, dict[int, dict]]:
    els = overpass(
        f"[out:json][timeout:180];\nrel({RELATION_ID});\nout meta;\nway(r);\nout meta geom;\n"
    )
    rel = next((e for e in els if e["type"] == "relation"), None)
    if rel is None:
        raise RuntimeError(f"Overpass returned no relation {RELATION_ID}")
    return rel, {e["id"]: e for e in els if e["type"] == "way"}


def fetch_named_ways(name: str, lat: float, lng: float, radius: int) -> list[dict]:
    esc = name.replace("\\", "\\\\").replace('"', '\\"')
    return overpass(
        f"[out:json][timeout:120];\n"
        f'way(around:{radius},{lat},{lng})[highway]["name"="{esc}"];\nout tags geom;\n'
    )


def fetch_landmarks() -> list[dict]:
    return overpass(
        "[out:json][timeout:180];\n"
        "(\n"
        '  nwr[~"^name"~"Mandarin Oriental|文華東方|Grand Lapa|雅辰"](22.17,113.53,22.23,113.58);\n'
        '  nwr[~"^name"~"Lisboa|葡京"][tourism](22.17,113.53,22.23,113.58);\n'
        '  nwr[~"^name"~"Lisboa|葡京"][amenity=casino](22.17,113.53,22.23,113.58);\n'
        '  nwr[~"^name"~"Maternidade|Matern|產房|婦嬰|母親會|Januário",i](22.185,113.540,22.210,113.562);\n'
        "  nwr[natural=water](22.196,113.550,22.212,113.568);\n"
        "  nwr[landuse=reservoir](22.196,113.550,22.212,113.568);\n"
        f"  node({R_BEND_NODE});\n"
        # `body` verbosity, not `tags`: the reservoir is a multipolygon relation
        # and only `body` prints its members (and so its geometry).
        ");\nout geom;\n"
    )


def coords_of(way: dict) -> list[tuple[float, float]]:
    return [(g["lon"], g["lat"]) for g in way["geometry"]]


def el_geometry(el: dict):
    """A shapely geometry in degrees for any OSM element, or None."""
    if el["type"] == "node":
        return Point(el["lon"], el["lat"])
    poly = polygon_of_element(el)
    if poly is not None and not poly.is_empty:
        return poly
    if el.get("geometry") and len(el["geometry"]) >= 2:
        return LineString(coords_of(el))
    parts = [LineString([(g["lon"], g["lat"]) for g in m["geometry"]])
             for m in el.get("members", []) if m.get("geometry") and len(m["geometry"]) >= 2]
    if parts:
        return parts[0] if len(parts) == 1 else LineString(
            [p for part in parts for p in part.coords]
        )
    return None


def el_point(el: dict) -> tuple[float, float]:
    if el["type"] == "node":
        return (el["lon"], el["lat"])
    geom = el_geometry(el)
    c = geom.centroid
    return (c.x, c.y)


def el_ref(el: dict) -> str:
    return f"{el['type']}/{el['id']}"


def name_of(el: dict) -> str:
    t = el.get("tags", {})
    return t.get("name") or t.get("name:en") or t.get("name:pt") or ""


# ----------------------------------------------------------------------------
# graph: snap, split, bridge
# ----------------------------------------------------------------------------
class Nodes:
    """Coordinate -> node id, merging anything within `tol` metres."""

    def __init__(self, tol: float = SNAP_M):
        self.pts: list[tuple[float, float]] = []
        self.cell: dict[tuple[int, int], list[int]] = {}
        self.tol = tol

    def add(self, p: tuple[float, float]) -> int:
        kx, ky = round(p[0] / 0.0002), round(p[1] / 0.0002)
        best, best_d = None, self.tol
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in self.cell.get((kx + dx, ky + dy), ()):
                    d = dist_m(p, self.pts[i])
                    if d < best_d:
                        best, best_d = i, d
        if best is not None:
            return best
        i = len(self.pts)
        self.pts.append(p)
        self.cell.setdefault((kx, ky), []).append(i)
        return i


class Segment:
    __slots__ = ("u", "v", "coords", "name", "way", "oneway", "synthetic")

    def __init__(self, u, v, coords, name, way, oneway, synthetic=False):
        self.u, self.v, self.coords = u, v, coords
        self.name, self.way, self.oneway = name, way, oneway
        self.synthetic = synthetic

    def length(self) -> float:
        return line_length_m(self.coords)


def split_into_segments(ways, ids, nodes: Nodes) -> list[Segment]:
    """Cut every way at the vertices it shares with another way, so segment
    endpoints are real junctions (OSM does not split a through road at a T)."""
    per_way = {wid: [nodes.add(p) for p in coords_of(ways[wid])] for wid in ids}
    touched: dict[int, set[int]] = {}
    for wid, ns in per_way.items():
        for n in set(ns):
            touched.setdefault(n, set()).add(wid)
    cuts = {n for n, ws in touched.items() if len(ws) > 1}
    for ns in per_way.values():
        cuts.add(ns[0])
        cuts.add(ns[-1])

    segs: list[Segment] = []
    for wid, ns in per_way.items():
        tags = ways[wid].get("tags", {})
        pts = coords_of(ways[wid])
        start = 0
        for i in range(1, len(ns)):
            if ns[i] in cuts or i == len(ns) - 1:
                if ns[start] != ns[i]:
                    segs.append(Segment(ns[start], ns[i], pts[start:i + 1],
                                        tags.get("name", ""), wid, tags.get("oneway", "no")))
                start = i
    return segs


def degrees_of(segs) -> dict[int, int]:
    deg: dict[int, int] = {}
    for s in segs:
        deg[s.u] = deg.get(s.u, 0) + 1
        deg[s.v] = deg.get(s.v, 0) + 1
    return deg


def bridge_dead_ends(segs, nodes: Nodes, ways, report: list[str]) -> list[Segment]:
    """Close the gaps the relation leaves. Every bridge is reported."""
    for _ in range(6):
        deg = degrees_of(segs)
        dead = [n for n, d in deg.items() if d == 1]
        if not dead:
            break
        neighbours: dict[int, set[int]] = {}
        for s in segs:
            neighbours.setdefault(s.u, set()).add(s.v)
            neighbours.setdefault(s.v, set()).add(s.u)
        added = False
        for n in dead:
            cand = sorted(
                (dist_m(nodes.pts[n], nodes.pts[m]), m)
                for m in deg if m != n and m not in neighbours.get(n, ())
            )
            if cand and cand[0][0] <= DEAD_END_BRIDGE_M:
                d, m = cand[0]
                segs.append(Segment(n, m, [nodes.pts[n], nodes.pts[m]], "", None,
                                    "no", synthetic=True))
                report.append(f"straight bridge {d:.1f} m at "
                              f"{nodes.pts[n][1]:.6f},{nodes.pts[n][0]:.6f}")
                added = True
        if added:
            continue
        # No short hop available: follow OSM ways of the same name back to the graph.
        for n in dead:
            way = next((s.way for s in segs if s.way and n in (s.u, s.v)), None)
            name = ways.get(way, {}).get("tags", {}).get("name") if way else None
            if not name:
                continue
            path = named_bridge(n, name, segs, nodes, ways, report)
            if path:
                segs.extend(path)
                added = True
        if not added:
            break
    return segs


def named_bridge(start: int, name: str, segs, nodes: Nodes, ways,
                 report: list[str]) -> list[Segment] | None:
    """Shortest chain of same-named OSM ways from a dead end back to the graph."""
    lng, lat = nodes.pts[start]
    extra = [w for w in fetch_named_ways(name, lat, lng, int(NAMED_BRIDGE_MAX_M))
             if w["id"] not in ways and w.get("geometry")]
    if not extra:
        return None
    known = sorted(degrees_of(segs))
    # The candidate ways are indexed at the normal tolerance so consecutive
    # ways are not collapsed into one hop; only the two JOINS to the relation
    # graph (which is where OSM leaves a few metres of slack) are matched at
    # DEAD_END_BRIDGE_M.
    local = Nodes()
    adj: dict[int, list[tuple[int, dict]]] = {}
    for w in extra:
        pts = coords_of(w)
        a, b = local.add(pts[0]), local.add(pts[-1])
        adj.setdefault(a, []).append((b, w))
        adj.setdefault(b, []).append((a, w))

    def loose(pt) -> int | None:
        cand = sorted((dist_m(pt, p), i) for i, p in enumerate(local.pts))
        return cand[0][1] if cand and cand[0][0] <= DEAD_END_BRIDGE_M else None

    graph_node: dict[int, int] = {}
    for i in known:
        j = loose(nodes.pts[i])
        if j is not None:
            graph_node.setdefault(j, i)
    origin = loose(nodes.pts[start])
    if origin is None:
        return None
    best = {origin: (0.0, [])}
    frontier, goal = [origin], None
    while frontier:
        nxt = []
        for u in frontier:
            cost, path = best[u]
            for v, w in adj.get(u, ()):
                c = cost + line_length_m(coords_of(w))
                if c > NAMED_BRIDGE_MAX_M or (v in best and best[v][0] <= c):
                    continue
                best[v] = (c, path + [w])
                nxt.append(v)
                if v in graph_node and graph_node[v] != start and (
                    goal is None or c < best[goal][0]
                ):
                    goal = v
        frontier = nxt
    if goal is None:
        return None
    cost, path = best[goal]

    out: list[Segment] = []
    prev = start
    for w in path:
        pts = coords_of(w)
        if dist_m(pts[-1], nodes.pts[prev]) < dist_m(pts[0], nodes.pts[prev]):
            pts = pts[::-1]
        a, b = nodes.add(pts[0]), nodes.add(pts[-1])
        if a != prev:  # a few metres of slack between two distinct OSM nodes
            out.append(Segment(prev, a, [nodes.pts[prev], nodes.pts[a]], "", None,
                               "no", synthetic=True))
        out.append(Segment(a, b, pts, w.get("tags", {}).get("name", ""), w["id"],
                           w.get("tags", {}).get("oneway", "no")))
        prev = b
    end = graph_node[goal]
    if prev != end:
        out.append(Segment(prev, end, [nodes.pts[prev], nodes.pts[end]], "", None,
                           "no", synthetic=True))
    report.append(f"named bridge {cost:.0f} m along「{name}」: "
                  + ", ".join(str(w["id"]) for w in path))
    return out


# ----------------------------------------------------------------------------
# cycles
# ----------------------------------------------------------------------------
def contract(segs) -> list[dict]:
    """Collapse degree-2 chains into super-edges between junctions."""
    deg = degrees_of(segs)
    junctions = {n for n, d in deg.items() if d != 2} or {segs[0].u}
    adj: dict[int, list[tuple[int, int]]] = {}
    for i, s in enumerate(segs):
        adj.setdefault(s.u, []).append((s.v, i))
        adj.setdefault(s.v, []).append((s.u, i))

    used: set[int] = set()
    supers: list[dict] = []
    for j in sorted(junctions):
        for nxt, si in adj.get(j, ()):
            if si in used:
                continue
            chain, cur = [si], nxt
            used.add(si)
            while cur not in junctions:
                step = next(((v, k) for v, k in adj.get(cur, ()) if k not in used), None)
                if step is None:
                    break
                used.add(step[1])
                chain.append(step[1])
                cur = step[0]
            supers.append({"a": j, "b": cur, "segs": chain})
    return supers


def enumerate_cycles(supers) -> list[list[int]]:
    adj: dict[int, list[tuple[int, int]]] = {}
    for i, sup in enumerate(supers):
        adj.setdefault(sup["a"], []).append((sup["b"], i))
        adj.setdefault(sup["b"], []).append((sup["a"], i))

    found: dict[frozenset, list[int]] = {}
    for i, sup in enumerate(supers):
        if sup["a"] == sup["b"]:  # a super-edge that is already a loop
            found[frozenset({i})] = [i]

    def walk(start, cur, used, path, seen):
        if len(path) > 40:
            return
        for nxt, ei in adj.get(cur, ()):
            if ei in used:
                continue
            if nxt == start and path:
                found.setdefault(frozenset(used | {ei}), path + [ei])
                continue
            if nxt in seen:
                continue
            walk(start, nxt, used | {ei}, path + [ei], seen | {nxt})

    for n in sorted(adj):
        walk(n, n, frozenset(), [], {n})
    return list(found.values())


def order_segments(cycle, supers, segs) -> list[tuple[Segment, bool]]:
    """The chosen cycle as (segment, reversed?) in traversal order."""
    first = supers[cycle[0]]
    if len(cycle) == 1:
        node = first["a"]
    else:
        second = supers[cycle[1]]
        node = first["a"] if first["b"] in (second["a"], second["b"]) else first["b"]
    out: list[tuple[Segment, bool]] = []
    for ei in cycle:
        sup = supers[ei]
        chain = sup["segs"] if sup["a"] == node else list(reversed(sup["segs"]))
        cur = node
        for si in chain:
            s = segs[si]
            rev = s.u != cur
            out.append((s, rev))
            cur = s.u if rev else s.v
        node = cur
    return out


def replay(ordered):
    """(coords, per-vertex way name, metres with / against the oneway tags)."""
    coords: list[tuple[float, float]] = []
    names: list[str] = []
    with_m = against_m = 0.0
    for s, rev in ordered:
        pts = s.coords[::-1] if rev else s.coords
        n = len(pts) if not coords else len(pts) - 1
        coords.extend(pts if not coords else pts[1:])
        names.extend([s.name] * n)
        if s.oneway in ONEWAY_FORWARD or s.oneway in ONEWAY_REVERSE:
            flip = s.oneway in ONEWAY_REVERSE
            if rev == flip:
                with_m += s.length()
            else:
                against_m += s.length()
    if coords[0] != coords[-1]:
        coords.append(coords[0])
        names.append(names[0])
    return coords, names, with_m, against_m


# ----------------------------------------------------------------------------
# pit lane
# ----------------------------------------------------------------------------
def chain_pit_lane(ways, ids) -> list[tuple[float, float]]:
    nodes = Nodes()
    segs = split_into_segments(ways, ids, nodes)
    ends = [n for n, d in degrees_of(segs).items() if d == 1]
    if len(ends) != 2:
        raise RuntimeError(f"pit lane is not a simple chain: {len(ends)} loose end(s)")
    adj: dict[int, list[tuple[int, int]]] = {}
    for i, s in enumerate(segs):
        adj.setdefault(s.u, []).append((s.v, i))
        adj.setdefault(s.v, []).append((s.u, i))
    node, used, out = ends[0], set(), []
    while True:
        step = next(((v, i) for v, i in adj.get(node, ()) if i not in used), None)
        if step is None:
            break
        used.add(step[1])
        s = segs[step[1]]
        pts = s.coords if s.u == node else s.coords[::-1]
        out.extend(pts if not out else pts[1:])
        node = step[0]
    if len(used) != len(segs):
        raise RuntimeError("pit lane did not chain into one line")
    return out


def orient_pit(pit, track):
    """Pit lane entry -> exit, i.e. the same way round as the racing line."""
    mid = point_at_m(pit, cumulative_m(pit), line_length_m(pit) / 2.0)
    i = nearest_to_point(track, mid)[0]
    j = (i + 1) % (len(track) - 1)
    tx = xy(track[j])[0] - xy(track[i])[0]
    ty = xy(track[j])[1] - xy(track[i])[1]
    px = xy(pit[-1])[0] - xy(pit[0])[0]
    py = xy(pit[-1])[1] - xy(pit[0])[1]
    return pit if tx * px + ty * py >= 0 else pit[::-1]


# ----------------------------------------------------------------------------
# landmarks
# ----------------------------------------------------------------------------
def is_mandarin(el) -> bool:
    t = el.get("tags", {})
    n = f"{name_of(el)} {t.get('name:en', '')}"
    return t.get("tourism") == "hotel" and any(
        k in n for k in ("Mandarin Oriental", "文華東方", "Grand Lapa", "雅辰")
    )


def is_lisboa(el) -> bool:
    t = el.get("tags", {})
    n = f"{name_of(el)} {t.get('name:en', '')}"
    if "Grand Lisboa" in n or "新葡京" in n:
        return False  # a different, newer hotel that the corner is not named after
    return ("Lisboa" in n or "葡京" in n) and bool(
        t.get("tourism") or t.get("amenity") == "casino"
    )


def is_reservoir(el) -> bool:
    t = el.get("tags", {})
    return (t.get("natural") == "water" or t.get("landuse") == "reservoir") and bool(
        t.get("name")
    )


def is_maternity(el) -> bool:
    """Context for the Maternity Bend. The query casts wider than this on
    purpose (it also asks for 母親會 / Obra das Mães) so the search is on the
    record, but Obra das Mães is a different institution whose building sits at
    the far end of the lap, and bus stops named after a hospital are not the
    hospital — neither is allowed to stand in for a maternity landmark."""
    t = el.get("tags", {})
    if t.get("highway") == "bus_stop" or t.get("public_transport"):
        return False
    n = f"{name_of(el)} {t.get('name:en', '')} {t.get('name:pt', '')}"
    if any(k in n for k in ("Maternidade", "Maternity", "產房", "婦嬰")):
        return True
    return t.get("amenity") == "hospital"


def pick_landmark(landmarks, predicate, track):
    """(element, metres to the track, metre-scaled geometry) for the nearest
    matching OSM element, or None."""
    best = None
    for el in landmarks:
        if not predicate(el):
            continue
        geom = el_geometry(el)
        if geom is None:
            continue
        gm = to_metres(geom)
        d = min(gm.distance(metric_point(c)) for c in track)
        if best is None or d < best[1]:
            best = (el, d, gm)
    return best


# ----------------------------------------------------------------------------
# corners
# ----------------------------------------------------------------------------
def section_indices(names, key) -> list[int]:
    return [i for i, n in enumerate(names) if key in (n or "")]


def span_of(cum, idx) -> tuple[float, float]:
    return (cum[min(idx)], cum[max(idx)])


def argmax_angle(angles, indices) -> tuple[int, float]:
    best = max(indices, key=lambda i: angles[i])
    return best, angles[best]


def build_corners(coords, cum, names, landmarks) -> list[dict]:
    angles = turning_angles(coords, cum)
    out: list[dict] = []

    def add(cid, i, rule, span=None):
        _, kind, zh, pt, en = next(c for c in CORNERS if c[0] == cid)
        # A section's representative point is the middle of the stretch by
        # distance, interpolated: the OSM way beside the reservoir carries one
        # vertex every ~150 m, so snapping to a vertex would miss the middle.
        d = (span[0] + span[1]) / 2.0 if span else cum[i]
        lng, lat = point_at_m(coords, cum, d) if span else coords[i]
        out.append({
            "id": cid, "order": len(out) + 1, "kind": kind,
            "name": {"zh": zh, "pt": pt, "en": en},
            "lng": round(lng, 6), "lat": round(lat, 6),
            "distKm": round(d / 1000.0, 3),
            "approximate": True, "rule": rule,
            "spanKm": [round(span[0] / 1000.0, 3), round(span[1] / 1000.0, 3)] if span else None,
        })

    # 1 Start/Finish — the lap was rotated here already.
    add("start-finish", 0,
        "Track vertex nearest the midpoint of the pit lane; the lap is rotated to "
        "start here, so distKm is 0 by construction.")

    # 2 Mandarin Oriental Bend
    mo = pick_landmark(landmarks, is_mandarin, coords)
    if mo is None:
        raise RuntimeError("no Mandarin Oriental / Grand Lapa hotel found in OSM")
    i_mo = nearest_to_geom(coords, mo[2])[0]
    add("mandarin-oriental", i_mo,
        f"Track vertex nearest OSM {el_ref(mo[0])} ({name_of(mo[0])}) — the hotel on "
        f"Avenida da Amizade the bend is named after, {mo[1]:.0f} m away.")

    # 3 Lisboa Bend, with the max-turning-angle sanity check
    lis = pick_landmark(landmarks, is_lisboa, coords)
    if lis is None:
        raise RuntimeError("no Hotel/Casino Lisboa found in OSM")
    i_lis = nearest_to_geom(coords, lis[2])[0]
    sw = [i for i in range(len(angles))
          if AMIZADE in (names[i] or "") and cum[i_mo] < cum[i] <= cum[i_lis] + 100.0]
    i_apex, apex_deg = argmax_angle(angles, sw or range(len(angles)))
    add("lisboa", i_lis,
        f"Track vertex nearest OSM {el_ref(lis[0])} ({name_of(lis[0])}), {lis[1]:.0f} m "
        f"away; {abs(cum[i_apex] - cum[i_lis]):.0f} m from the sharpest vertex "
        f"({apex_deg:.0f}°) at the south-west end of the Avenida da Amizade section.")

    # 4 Maternity Bend — sharpest vertex between Lisboa and Estrada de Cacilhas,
    #   skipping the un-named San Francisco Bend right after Lisboa.
    cac = section_indices(names, CACILHAS)
    if not cac:
        raise RuntimeError(f"no「{CACILHAS}」way on the lap")
    lo, hi = cum[i_lis] + MATERNITY_SKIP_M, cum[min(cac)]
    window = [i for i in range(len(angles)) if lo < cum[i] < hi]
    i_mat, mat_deg = argmax_angle(angles, window)
    mat = pick_landmark(landmarks, is_maternity, coords)
    near = (f" No OSM feature is named Maternidade/產房; the nearest hospital is "
            f"{el_ref(mat[0])} ({name_of(mat[0])}) {mat[1]:.0f} m away, so the angle "
            f"rule stands." if mat else "")
    add("maternity", i_mat,
        f"Sharpest vertex ({mat_deg:.0f}° over a {ANGLE_WINDOW_M:.0f} m window) between "
        f"{MATERNITY_SKIP_M:.0f} m past Lisboa and the start of Estrada de Cacilhas."
        + near)

    # 5 Solitude Esses — the 海邊馬路(劏狗環) stretch
    span = span_of(cum, cac)
    add("solitude-esses", 0,
        f"The stretch carried by the OSM way(s) named「{CACILHAS}」(海邊馬路(劏狗環)); "
        f"the point is its midpoint by distance.", span)

    # 6 Melco Hairpin — the tightest corner of the whole lap
    i_hair, hair_deg = argmax_angle(angles, range(len(angles)))
    add("melco-hairpin", i_hair,
        f"Sharpest vertex of the whole lap ({hair_deg:.0f}° over a "
        f"{ANGLE_WINDOW_M:.0f} m window), on「{names[i_hair] or 'an unnamed way'}」.")

    # 7 Fishermen's Bend — sharpest vertex in the Rua dos Pescadores stretch
    #   ±60 m, skipping the Melco Hairpin that sits at the start of it.
    pes = section_indices(names, PESCADORES)
    if not pes:
        raise RuntimeError(f"no「{PESCADORES}」way on the lap")
    plo, phi = span_of(cum, pes)
    pwin = [i for i in range(len(angles))
            if plo - 60.0 <= cum[i] <= phi + 60.0
            and abs(cum[i] - cum[i_hair]) > HAIRPIN_SKIP_M]
    i_fish, fish_deg = argmax_angle(angles, pwin)
    r_el = next((e for e in landmarks if e["type"] == "node" and e["id"] == R_BEND_NODE), None)
    if r_el is None:
        raise RuntimeError(f"OSM node {R_BEND_NODE} (「水塘北角」bus stop) not found")
    bus_d = dist_m(coords[i_fish], el_point(r_el))
    add("fishermens", i_fish,
        f"Sharpest vertex ({fish_deg:.0f}° over a {ANGLE_WINDOW_M:.0f} m window) within "
        f"the「{PESCADORES}」stretch plus 60 m either side, skipping "
        f"{HAIRPIN_SKIP_M:.0f} m around the Melco Hairpin at the start of it. OSM node/"
        f"{R_BEND_NODE}, the only element in the map carrying an official corner name "
        f"(bus stop「{name_of(r_el)}」), stands {bus_d:.0f} m from here — the "
        f"organiser's diagram draws its「R」Bend some 600 m further on, so the stop is "
        f"evidence for this corner, not for that one.")

    # 9 "R" Bend — computed here because the reservoir window is bounded by it.
    #   It is a long sweeper onto the final straight, not a point corner, so it
    #   is found with the wider window; the first HAIRPIN_SKIP_M keeps the
    #   Fishermen's corner complex out of the search.
    sweeps = turning_angles(coords, cum, SWEEP_WINDOW_M)
    rwin = [i for i in range(len(sweeps))
            if cum[i] > cum[i_fish] + HAIRPIN_SKIP_M and AMIZADE in (names[i] or "")]
    if not rwin:
        raise RuntimeError(f"no「{AMIZADE}」way between Fishermen's Bend and Start/Finish")
    i_r, r_deg = argmax_angle(sweeps, rwin)

    # 8 Reservoir — the stretch within 60 m of the water body, taken between
    #   Fishermen's and the R Bend as the official order requires.
    res = pick_landmark(landmarks, is_reservoir, coords)
    if res is None:
        raise RuntimeError("no named reservoir water body found in OSM")
    rspan = near_span(coords, cum, res[2], RESERVOIR_NEAR_M, cum[i_fish], cum[i_r])
    if rspan is None:
        raise RuntimeError("no stretch of track runs beside the reservoir between "
                           "Fishermen's Bend and the R Bend")
    add("reservoir", 0,
        f"The stretch running within {RESERVOIR_NEAR_M:.0f} m of OSM {el_ref(res[0])} "
        f"({name_of(res[0])}), between Fishermen's Bend and the \"R\" Bend; the point "
        f"is its midpoint by distance.", rspan)

    add("r-bend", i_r,
        f"Sharpest vertex ({r_deg:.0f}° over a {SWEEP_WINDOW_M:.0f} m window) of the "
        f"「{AMIZADE}」run between Fishermen's Bend and Start/Finish — the turn onto the "
        f"final straight, where the organiser's diagram draws it. OSM node/"
        f"{R_BEND_NODE} is named R Bend but sits by Fishermen's Bend instead (see that "
        f"corner's rule), so it is not used here.")

    return sorted(out, key=lambda c: CORNER_ORDER.index(c["id"]))


# ----------------------------------------------------------------------------
# output
# ----------------------------------------------------------------------------
def build_sources(rel: dict) -> list[dict]:
    stamp = rel.get("timestamp")
    return [
        {"name": "OpenStreetMap — relation 8877949 Circuito da Guia",
         "url": f"https://www.openstreetmap.org/relation/{RELATION_ID}",
         "role": "geometry", "secondary": False, "upstreamUpdatedAt": stamp},
        {"name": "OpenStreetMap contributors (ODbL)", "url": OSM_COPYRIGHT,
         "role": "geometry", "secondary": False, "upstreamUpdatedAt": None},
        {"name": "澳門格蘭披治大賽車 — 東望洋跑道", "url": MATCHPATH["zh"],
         "role": "names", "secondary": False, "upstreamUpdatedAt": None},
        {"name": "Macau Grand Prix — Guia Circuit", "url": MATCHPATH["en"],
         "role": "names", "secondary": False, "upstreamUpdatedAt": None},
        {"name": "Grande Prémio de Macau — Circuito da Guia", "url": MATCHPATH["pt"],
         "role": "names", "secondary": False, "upstreamUpdatedAt": None},
        {"name": "Macau Grand Prix — circuit diagram (Length 6.2 KM, Minimum width 7 M)",
         "url": DIAGRAM, "role": "facts", "secondary": False, "upstreamUpdatedAt": None},
        {"name": "Wikipedia — Guia Circuit (lap record; 6.120 km cross-check)",
         "url": WIKIPEDIA, "role": "lapRecord", "secondary": True, "upstreamUpdatedAt": None},
        {"name": "OpenStreetMap — hotels, reservoir and the R Bend bus stop the corner "
                 "rules hang on", "url": OSM_COPYRIGHT,
         "role": "landmarks", "secondary": False, "upstreamUpdatedAt": None},
    ]


def signed_area(coords) -> float:
    pts = [xy(c) for c in coords]
    return 0.5 * sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
                     for i in range(len(pts) - 1))


def rotate(coords, names, i):
    if i == 0:
        return coords, names
    body_c, body_n = coords[:-1], names[:-1]
    body_c = body_c[i:] + body_c[:i]
    body_n = body_n[i:] + body_n[:i]
    return body_c + [body_c[0]], body_n + [body_n[0]]


def orient(coords, names, landmarks):
    """Race direction, from the official diagram: leaving Start/Finish the cars
    pass Mandarin Oriental, then Lisboa, before the Estrada de Cacilhas esses."""
    def ok(cs, ns):
        cum = cumulative_m(cs)
        mo = pick_landmark(landmarks, is_mandarin, cs)
        lis = pick_landmark(landmarks, is_lisboa, cs)
        cac = section_indices(ns, CACILHAS)
        if not (mo and lis and cac):
            raise RuntimeError("cannot orient the lap: missing landmark or Cacilhas section")
        return cum[nearest_to_geom(cs, mo[2])[0]] < cum[nearest_to_geom(cs, lis[2])[0]] \
            < cum[min(cac)]

    if ok(coords, names):
        return coords, names, False
    if not ok(coords[::-1], names[::-1]):
        raise RuntimeError(
            "neither direction puts Mandarin Oriental and Lisboa before Estrada de "
            "Cacilhas — check the lap against the official diagram"
        )
    return coords[::-1], names[::-1], True


def round_coords(coords) -> list[list[float]]:
    return [[round(c[0], 6), round(c[1], 6)] for c in coords]


def run() -> int:
    rel, ways = fetch_relation()
    roles: dict[str, list[int]] = {}
    for m in rel["members"]:
        roles.setdefault(m.get("role", ""), []).append(m["ref"])
    main_ids, pit_ids = roles.get("", []), roles.get("pit_lane", [])
    print(f"relation {RELATION_ID} v{rel.get('version')} ({rel.get('timestamp')}): "
          f"{len(main_ids)} main ways, {len(pit_ids)} pit-lane ways")

    nodes = Nodes()
    segs = split_into_segments(ways, main_ids, nodes)
    print(f"  {len(segs)} segments after splitting at shared vertices, "
          f"{sum(s.length() for s in segs) / 1000:.3f} km of member way")
    bridges: list[str] = []
    segs = bridge_dead_ends(segs, nodes, ways, bridges)
    for b in bridges:
        print(f"  bridge: {b}")
    dead = [n for n, d in degrees_of(segs).items() if d == 1]
    print(f"  {len(dead)} dead end(s) left: "
          + (", ".join(f"{nodes.pts[n][1]:.6f},{nodes.pts[n][0]:.6f}" for n in dead) or "none"))

    pit = chain_pit_lane(ways, pit_ids)
    pit_ends = (pit[0], pit[-1])
    print(f"  pit lane chained: {len(pit)} points, {line_length_m(pit):.0f} m")

    supers = contract(segs)
    cycles = enumerate_cycles(supers)
    print(f"  {len(supers)} super-edges, {len(cycles)} simple cycle(s):")
    scored = []
    for cyc in cycles:
        coords = replay(order_segments(cyc, supers, segs))[0]
        km = line_length_m(coords) / 1000.0
        touches = all(min(dist_m(c, e) for c in coords) <= PIT_JUNCTION_M for e in pit_ends)
        scored.append((cyc, km, touches))
        print(f"    {len(cyc):2d} super-edges {km:7.3f} km  "
              f"pit junctions: {'both' if touches else 'no'}")

    usable = [s for s in scored if s[2]]
    if not usable:
        print("ERROR: no cycle passes both ends of the pit lane — the relation no "
              "longer contains the racing line", file=sys.stderr)
        return 1
    cyc, km, _ = min(usable, key=lambda s: abs(s[1] - OFFICIAL_LENGTH_KM))
    err = abs(km - OFFICIAL_LENGTH_KM) / OFFICIAL_LENGTH_KM
    print(f"  chosen lap: {km:.3f} km vs official {OFFICIAL_LENGTH_KM} km "
          f"({err * 100:.1f} % off)")
    if err > LENGTH_TOLERANCE:
        print(f"ERROR: the stitched lap is {err * 100:.1f} % off the official "
              f"{OFFICIAL_LENGTH_KM} km (limit {LENGTH_TOLERANCE * 100:.0f} %) — the "
              "relation changed; fix the stitching, do not relax this check",
              file=sys.stderr)
        return 1

    coords, names, with_m, against_m = replay(order_segments(cyc, supers, segs))
    landmarks = fetch_landmarks()
    coords, names, flipped = orient(coords, names, landmarks)
    if flipped:
        with_m, against_m = against_m, with_m
    print(f"  race direction: {'reversed' if flipped else 'kept'} the stitched order; "
          f"{with_m:.0f} m with / {against_m:.0f} m against the OSM oneway tags")

    pit_mid = point_at_m(pit, cumulative_m(pit), line_length_m(pit) / 2.0)
    sf_index, sf_d = nearest_to_point(coords, pit_mid)
    coords, names = rotate(coords, names, sf_index)
    cum = cumulative_m(coords)
    direction = "clockwise" if signed_area(coords) < 0 else "anticlockwise"
    print(f"  start/finish is {sf_d:.0f} m from the pit-lane midpoint; "
          f"the lap runs {direction}")
    pit = orient_pit(pit, coords)

    corners = build_corners(coords, cum, names, landmarks)
    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "sources": build_sources(rel),
        "circuit": {
            "id": "guia",
            "name": {"zh": "東望洋跑道", "en": "Guia Circuit", "pt": "Circuito da Guia"},
            "lengthKm": OFFICIAL_LENGTH_KM,
            "minWidthM": OFFICIAL_MIN_WIDTH_M,
            "direction": direction,
            "lapRecord": LAP_RECORD,
            "osm": {"relationId": RELATION_ID, "mainWays": len(main_ids),
                    "pitLaneWays": len(pit_ids)},
            "measuredLengthKm": round(cum[-1] / 1000.0, 3),
            "track": {"type": "LineString", "coordinates": round_coords(coords)},
            "pitLane": {"type": "LineString", "coordinates": round_coords(pit)},
            "corners": corners,
        },
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone. lap {cum[-1] / 1000:.3f} km ({len(coords)} points, closed), "
          f"pit lane {line_length_m(pit):.0f} m ({len(pit)} points), {direction}")
    print(f"{'#':>2}  {'id':<18} {'kind':<12} {'lng':>10} {'lat':>10} {'distKm':>7}  span")
    for c in corners:
        span = ("%.3f–%.3f" % tuple(c["spanKm"])) if c["spanKm"] else "—"
        print(f"{c['order']:>2}  {c['id']:<18} {c['kind']:<12} {c['lng']:>10.6f} "
              f"{c['lat']:>10.6f} {c['distKm']:>7.3f}  {span}")
        print(f"      {c['rule']}")
    print(f"\nWrote {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size / 1024:.1f} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(run())
