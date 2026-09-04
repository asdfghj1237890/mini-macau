"""Build public/data/water-facilities.json: Macao Water's 22 supply facilities
with OSM footprints where they exist, so the map can draw them like the schools
overlay (coloured 3D blocks + markers).

Sources
  * The LIST is Macao Water's「供水設施」page
    https://www.macaowater.com/about-macao-water/water-supply-facilities
    — 22 numbered facilities: 4 treatment plants, 3 reservoirs, 4 elevated
    tanks, 4 raw-water pumping stations and 7 treated-water pumping stations.
    The page's schematic (Facilities.jpg) is copyrighted AND not georeferenced,
    so nothing here is traced from it: only the facts (which facilities exist,
    their numbers and their names) are used, and every coordinate comes from
    OpenStreetMap.
  * The GEOMETRY is OpenStreetMap via Overpass, plus the OpenFreeMap basemap
    tiles the map itself draws (see osm_footprints.py for why we re-cut OSM
    outlines against the basemap's own building parts).

The 22 facilities are encoded in FACILITIES below because there is no machine
-readable list upstream — the page is prose + a picture. Each entry carries the
OSM element(s) it is grounded on; those ids are re-queried on every run rather
than trusted, and the OSM `name:pt` / `name:en` tags win over the table when
they are at least as specific.

Only 11 of the 22 exist in OSM (the 4 plants, the 3 reservoirs, 3 of the 4
elevated tanks, and the Seac Pai Van raw-water pump house). The other 11 are
mapped nowhere, so they get a marker only, `approximate: true`, placed
APPROX_OFFSET_M off the facility they are co-located with — or off a district
anchor looked up by name (回力 Jai Alai / 西灣湖 Sai Van / 二龍喉公園 Jardim da
Flora) when even that is unknown. Which anchor element was used is recorded in
`anchors`.

A 23rd facility rides along: 黑沙水庫 (Hac Sa Reservoir) is NOT on Macao Water's
list — it is the government's own raw-water reservoir, run by 海事及水務局
(DSAMA) — but it feeds the Coloane plant, so it is on the map with `no: null`
and `operator: "dsama"` while the 22 carry `operator: "macao_water"`.

The output also carries a `network` of schematic pipes (see PIPES). That edge
list is OURS — Macao Water does not publish where its mains run — and the
geometry is an OSRM driving route between the two markers, so a pipe follows
the roads instead of cutting through blocks, Cities-Skylines style. Short hops
skip the routing and are drawn straight (`direct`), because OSRM answers a 70 m
walk across a plant yard with a 1.2 km drive round the block. The UI has to say
the network is schematic; treating it as the real main network would be wrong.

Run manually when the facility list or OSM changes (not scheduled, like
fetch_schools.py):
    cd data && uv run python scripts/fetch_water_facilities.py
Needs network (overpass-api.de + tiles.openfreemap.org + router.project-osrm.org);
~3 Overpass calls and one OSRM call per pipe. Both are cached in the OS temp dir
(osm_footprints.OVERPASS_CACHE_DIR / OSRM_CACHE_DIR), so a re-run right after a
failed one is cheap.
"""

import hashlib
import json
import math
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from osm_footprints import (
    MACAU_BBOX,
    TilePartIndex,
    building_record,
    buffered_footprint,
    fetch_tile_building_parts,
    metres_xy,
    overpass,
    parse_height,
    part_record,
    plain_ring,
    polygon_of_element,
    strip_private,
    tiles_covering,
    xy_lnglat,
)
from osrm_route import get_road_geometry, path_enters_hengqin

ROOT = Path(__file__).parent.parent.parent
OUTPUT_PATH = ROOT / "public" / "data" / "water-facilities.json"

FACILITIES_PAGE = "https://www.macaowater.com/about-macao-water/water-supply-facilities"
OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright"
SOURCE_NAME = "澳門自來水 (Macao Water) – 供水設施 · OpenStreetMap"
HAC_SA_NOTE = "OpenStreetMap; government reservoir (DSAMA), not a Macao Water facility"

TYPES = ("plant", "reservoir", "tank", "raw_pumping", "pumping")
# Who runs the thing. The 22 numbered facilities are Macao Water's; 黑沙水庫 is
# the government's own raw-water reservoir, run by 海事及水務局 (DSAMA), so it
# carries no Macao Water number and the UI has to say whose it is.
OPERATORS = ("macao_water", "dsama")

LAT0 = 22.16  # local metres-per-degree reference, as in fetch_schools.py
# How far an approximate marker sits off its anchor. 70 m, not the 25 m this
# started at: two markers 25 m apart still overlap at the zoom where the pipe
# network becomes readable, and the co-located station is a separate building
# on the plant's site anyway, not a pin on its roof.
APPROX_OFFSET_M = 70.0
SHORE_OFFSET_M = 15.0  # ... and off the shore when the anchor is open water
# Golden angle: consecutive facility numbers get well-separated bearings, so
# two stations hanging off the same anchor never land on the same pixel.
GOLDEN_ANGLE_DEG = 137.5
# At 70 m the golden-angle bearing can push a marker off the shore: no. 17
# (大水塘泵站) comes out due south of its anchor, which is the middle of 大水塘.
# When that happens the bearing is rotated in these steps until the marker is
# back on land.
WATER_DODGE_STEP_DEG = 30.0
# A slab drawn from an outline the basemap does not render. The three elevated
# tanks are tagged height=58.3 / 81.4 / 58.4, which is height above sea level
# (they sit on Guia hill and Taipa Grande), not building height — capping the
# fallback slab keeps a 80 m spike off the hill. Where the basemap DOES draw a
# part we take its height, exactly like every other footprint.
OUTLINE_MAX_HEIGHT_M = 20.0

# Degenerate-run guards, mirrored by validate_output.py's v_water_facilities.
# NUMBERED_COUNT is Macao Water's list (`no` 1..22); EXPECTED_COUNT adds the one
# un-numbered DSAMA reservoir.
NUMBERED_COUNT = 22
EXPECTED_COUNT = 23
MIN_WITH_BUILDINGS = 8
MIN_WITH_WATER = 4

# ----------------------------------------------------------------------------
# The list (Macao Water) + its OSM grounding.
#
#   geom = "compound"    -> claim every building inside the OSM area polygon
#          "building"    -> the OSM way itself is the building
#          "water"       -> the OSM water polygon(s) become `water[]` rings
#          "approximate" -> no OSM geometry; marker only, off `anchor`
#   anchor = another facility's id, or "district:<slug>" (see DISTRICT_ANCHORS)
# ----------------------------------------------------------------------------
FACILITIES = [
    dict(id="wtp-ilha-verde", no=1, type="plant", geom="compound", osm=["w241618704"],
         zh="青洲水廠", en="Ilha Verde Water Treatment Plant",
         pt="Estação de Tratamento de Água da Ilha Verde"),
    dict(id="wtp-main-reservoir", no=2, type="plant", geom="compound", osm=["w404669393"],
         zh="大水塘水廠", en="Main Storage Reservoir Water Treatment Plant",
         pt="Estação de Tratamento de Água do Reservatório do Porto Exterior"),
    dict(id="wtp-coloane", no=3, type="plant", geom="compound", osm=["w404669394"],
         zh="路環水廠", en="Coloane Water Treatment Plant",
         pt="Estação de Tratamento de Água de Coloane"),
    dict(id="wtp-seac-pai-van", no=4, type="plant", geom="compound", osm=["w518481453"],
         zh="石排灣水廠", en="Seac Pai Van Water Treatment Plant",
         pt="Estação de Tratamento de Água de Seac Pai Van"),
    dict(id="res-main", no=5, type="reservoir", geom="water", osm=["r10266785"],
         zh="大水塘", en="Main Storage Reservoir",
         pt="Reservatório do Porto Exterior"),
    dict(id="res-seac-pai-van", no=6, type="reservoir", geom="water", osm=["w108771115"],
         zh="石排灣水庫", en="Seac Pai Van Reservoir",
         pt="Reservatório de Seac Pai Van"),
    dict(id="res-ka-ho", no=7, type="reservoir", geom="water", osm=["w108771201"],
         zh="九澳水庫", en="Ka Ho Reservoir", pt="Barragem de Ká Hó"),
    dict(id="tank-guia-50", no=8, type="tank", geom="building", osm=["w825698009"],
         zh="松山50米高位水池", en="Guia 50 Elevated Water Tank",
         pt="Tanque Elevado de Água Tratada a 50m da Guia"),
    dict(id="tank-guia-70", no=9, type="tank", geom="building", osm=["w825698010"],
         zh="松山70米高位水池", en="Guia 70 Elevated Water Tank",
         pt="Tanque Elevado de Água Tratada a 70m da Guia"),
    dict(id="tank-taipa-50", no=10, type="tank", geom="building", osm=["w192096101"],
         zh="氹仔50米高位水池", en="Taipa 50 Elevated Water Tank",
         pt="Tanque Elevado de Água Tratada a 50m da Taipa"),
    dict(id="tank-taipa-70", no=11, type="tank", geom="approximate", anchor="tank-taipa-50",
         zh="氹仔70米高位水池", en="Taipa 70 Elevated Water Tank",
         pt=""),
    dict(id="rwps-jai-alai", no=12, type="raw_pumping", geom="approximate", anchor="district:jai-alai",
         zh="回力原水泵站", en="Jai Alai Raw Water Pumping Station",
         pt=""),
    dict(id="rwps-main-reservoir", no=13, type="raw_pumping", geom="approximate", anchor="wtp-main-reservoir",
         zh="大水塘原水泵站", en="Main Storage Reservoir Raw Water Pumping Station",
         pt=""),
    dict(id="rwps-seac-pai-van", no=14, type="raw_pumping", geom="compound", osm=["w945543066"],
         zh="石排灣原水泵站", en="Seac Pai Van Raw Water Pumping Station",
         pt="Bombagem de Água"),
    dict(id="rwps-ka-ho", no=15, type="raw_pumping", geom="approximate", anchor="res-ka-ho",
         zh="九澳原水泵站", en="Ka Ho Raw Water Pumping Station",
         pt=""),
    dict(id="ps-ilha-verde", no=16, type="pumping", geom="approximate", anchor="wtp-ilha-verde",
         zh="青洲泵站", en="Ilha Verde Treatment Plant Pumping Station",
         pt=""),
    dict(id="ps-main-reservoir", no=17, type="pumping", geom="approximate", anchor="wtp-main-reservoir",
         zh="大水塘泵站", en="Main Storage Reservoir Treatment Plant Pumping Station",
         pt=""),
    dict(id="ps-guia-50", no=18, type="pumping", geom="approximate", anchor="tank-guia-50",
         zh="松山50米泵站", en="Guia 50 Pumping Station",
         pt=""),
    dict(id="ps-taipa-50", no=19, type="pumping", geom="approximate", anchor="tank-taipa-50",
         zh="氹仔50米泵站", en="Taipa 50 Pumping Station",
         pt=""),
    dict(id="ps-sai-van", no=20, type="pumping", geom="approximate", anchor="district:sai-van",
         zh="西灣泵站", en="Sai Van Pumping Station",
         pt=""),
    dict(id="ps-seac-pai-van", no=21, type="pumping", geom="approximate", anchor="wtp-seac-pai-van",
         zh="石排灣泵站", en="Seac Pai Van Pumping Station",
         pt=""),
    dict(id="ps-floral", no=22, type="pumping", geom="approximate", anchor="district:jardim-da-flora",
         zh="二龍喉泵站", en="Floral Pumping Station",
         pt=""),
    # Not on Macao Water's list — hence `no=None`. 黑沙水庫 is the government's
    # own raw-water reservoir (海事及水務局 / DSAMA), and it feeds the Coloane
    # plant, so it belongs on the map with the operator spelled out. Its marker
    # goes on the shore facing that plant rather than out in the middle of the
    # water, because that is where the intake and the pipe actually are.
    dict(id="res-hac-sa", no=None, type="reservoir", geom="water", osm=["w108309153"],
         operator="dsama", marker="shore:wtp-coloane",
         zh="黑沙水庫", en="Hac Sa Reservoir", pt="Barragem de Hác-Sá"),
]

# District-level fallbacks for facilities that are co-located with nothing we
# have. Looked up by NAME (not by a hard-coded id) so a re-drawn feature is
# picked up; the largest matching polygon wins, and the chosen element is
# written into the output's `anchors` map.
#   point = "centroid"  -> the polygon's representative point
#           "ne_shore"  -> the ring vertex nearest the bbox's NE corner, i.e.
#                          the Avenida da República side of Sai Van Lake (a
#                          marker in the middle of the lake would read as a bug)
DISTRICT_ANCHORS = {
    "jai-alai": {
        "label": "回力 Jai Alai",
        "key": "回力",
        "filter": '["name"~"回力"]["building"]',
        "point": "centroid",
    },
    "sai-van": {
        "label": "西灣湖 Lago Sai Van",
        "key": "西灣湖",
        "filter": '["name"~"西灣湖"]["natural"="water"]',
        "point": "ne_shore",
    },
    "jardim-da-flora": {
        "label": "二龍喉公園 Jardim da Flora",
        "key": "二龍喉公園",
        "filter": '["name"~"二龍喉公園"]["leisure"="park"]',
        "point": "centroid",
    },
}

# ----------------------------------------------------------------------------
# The schematic pipe network.
#
# Macao Water publishes no route for its mains, so THIS EDGE LIST IS OURS: it
# is the plumbing the facility list implies (raw water in from Zhuhai and from
# the three reservoirs, treated water out to the elevated tanks via the pumping
# stations), not a survey. Only the geometry is real — each pipe follows an
# OSRM driving route between the two markers, so it runs down streets and over
# bridges like a Cities-Skylines pipe instead of cutting through blocks.
#
# The one node that is not a facility: raw water arrives from Zhuhai across the
# border canal. The marker sits on the MACAU bank of 鴨涌河 (Canal dos Patos),
# ~190 m north of the Ilha Verde plant — inside OSM's Macau boundary (relation
# 1867188), on land, and a few metres off 鴨涌馬路 so OSRM has a road to snap to.
# ----------------------------------------------------------------------------
INLET_NODE = {
    "id": "inlet-zhuhai",
    "kind": "inlet",
    "name": {
        "zh": "珠海原水輸入",
        "en": "Raw water from Zhuhai",
        "pt": "Água bruta de Zhuhai",
    },
    "coordinates": [113.540000, 22.213100],
}

PIPE_KINDS = ("raw", "treated")
# (kind, from, to); `from`/`to` are facility ids or INLET_NODE's id.
PIPES = [
    ("raw", "inlet-zhuhai", "wtp-ilha-verde"),
    ("raw", "inlet-zhuhai", "wtp-main-reservoir"),
    ("raw", "rwps-jai-alai", "res-main"),
    ("raw", "res-main", "rwps-main-reservoir"),
    ("raw", "rwps-main-reservoir", "wtp-main-reservoir"),
    ("raw", "res-seac-pai-van", "rwps-seac-pai-van"),
    ("raw", "rwps-seac-pai-van", "wtp-seac-pai-van"),
    ("raw", "res-ka-ho", "rwps-ka-ho"),
    ("raw", "rwps-ka-ho", "wtp-coloane"),
    ("raw", "res-hac-sa", "wtp-coloane"),
    ("treated", "wtp-ilha-verde", "ps-ilha-verde"),
    ("treated", "ps-ilha-verde", "tank-guia-50"),
    ("treated", "wtp-main-reservoir", "ps-main-reservoir"),
    ("treated", "ps-main-reservoir", "tank-guia-70"),
    ("treated", "tank-guia-50", "ps-guia-50"),
    ("treated", "ps-guia-50", "ps-floral"),
    ("treated", "wtp-main-reservoir", "ps-sai-van"),
    # The only cross-harbour leg; OSRM sends it over Sai Van Bridge.
    ("treated", "ps-sai-van", "tank-taipa-50"),
    ("treated", "tank-taipa-50", "ps-taipa-50"),
    ("treated", "ps-taipa-50", "tank-taipa-70"),
    ("treated", "wtp-seac-pai-van", "ps-seac-pai-van"),
    ("treated", "ps-seac-pai-van", "tank-taipa-50"),
    ("treated", "wtp-coloane", "ps-seac-pai-van"),
]
# A straight line is a visible lie about where a pipe runs, so a handful is
# tolerable but a silent OSRM outage (every edge straight) must fail the run.
# `direct` stubs (below) do NOT count: those are deliberate.
MAX_PIPE_FALLBACKS = 3

# Local connectors. A pipe between two markers a few tens of metres apart is
# plumbing inside one site, not a road journey, and OSRM answers it by sending
# a car round the block: the 70 m hop from 大水塘水廠 to its own pumping station
# comes back as 1.2 km (17×), 石排灣水庫 → its intake pump house as 17.8×. So a
# hop shorter than LOCAL_CONNECTOR_M is drawn straight without asking OSRM at
# all, and a short hop whose road route is more than DETOUR_RATIO times the
# straight line is drawn straight too. Those pipes carry `"direct": true`;
# `fallback` stays false, because a stub is a choice and a fallback is a
# failure. Above DETOUR_MAX_STRAIGHT_M the road route is the point (a trunk
# main really does follow the streets and bridges), however long it comes out.
LOCAL_CONNECTOR_M = 150.0
DETOUR_RATIO = 3.0
DETOUR_MAX_STRAIGHT_M = 600.0

# Same scheme as osm_footprints.OVERPASS_CACHE_DIR: SHA-1 of the request in the
# OS temp dir, so a re-run costs no OSRM calls. A week rather than a day — the
# road network moves far more slowly than an Overpass answer.
OSRM_CACHE_DIR = Path(tempfile.gettempdir()) / "mini-macau-osrm-cache"
OSRM_CACHE_TTL_S = 7 * 24 * 3600
OSRM_PACING_S = 1.0  # the public demo server is a shared courtesy


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def osm_ref(el: dict) -> str:
    return f"{el['type'][0]}{el['id']}"


def pick_name(osm_value: str | None, table_value: str) -> str:
    """Prefer the OSM tag, unless the curated Macao Water name is more specific.

    r10266785 is tagged just「水塘 / Reservoir / Reservatório」— that names the
    lake, not「大水塘 / Main Storage Reservoir」the facility — so a bare shorter
    OSM tag must not overwrite the table.
    """
    if osm_value and len(osm_value) >= len(table_value):
        return osm_value
    return table_value


def offset_point(lng: float, lat: float, bearing_deg: float, metres: float) -> tuple[float, float]:
    x, y = metres_xy(lng, lat, LAT0)
    rad = math.radians(bearing_deg)
    dx, dy = xy_lnglat(x + metres * math.sin(rad), y + metres * math.cos(rad), LAT0)
    return (dx, dy)


def bearing_for(no: int) -> float:
    return (no * GOLDEN_ANGLE_DEG) % 360.0


def first_dry_bearing(base: list[float], bearing_deg: float, metres: float,
                      water: list[Polygon]) -> float:
    """`bearing_deg`, or the nearest rotation of it that keeps the marker dry.

    The golden angle knows nothing about geography: at APPROX_OFFSET_M = 70 m
    it sends 大水塘泵站 due south of the treatment plant, which is out into
    大水塘 itself. Tried in order 0°, +30°, -30°, +60°, … so the marker keeps
    the bearing that separates it from its neighbours whenever that works.
    """
    if not water:
        return bearing_deg
    for step in range(0, 7):
        for sign in (1,) if step == 0 else (1, -1):
            candidate = (bearing_deg + sign * step * WATER_DODGE_STEP_DEG) % 360.0
            lng, lat = offset_point(base[0], base[1], candidate, metres)
            if not any(p.contains(Point(lng, lat)) for p in water):
                return candidate
    return bearing_deg


def ring_point_towards(rings: list[list[list[float]]], centre: tuple[float, float], bearing_deg: float):
    """The ring vertex whose bearing from `centre` is closest to `bearing_deg`.

    Used to push a pumping station out of the reservoir it is anchored on: a
    raw-water pump house sits on the shore, not in the middle of the water.
    """
    cx, cy = metres_xy(centre[0], centre[1], LAT0)
    want = math.radians(bearing_deg)
    best = None
    best_delta = None
    for ring in rings:
        for lng, lat in ring:
            x, y = metres_xy(lng, lat, LAT0)
            if x == cx and y == cy:
                continue
            ang = math.atan2(x - cx, y - cy)
            delta = abs((ang - want + math.pi) % (2 * math.pi) - math.pi)
            if best_delta is None or delta < best_delta:
                best_delta, best = delta, (lng, lat)
    return best


def table_order(f: dict) -> tuple[int, int]:
    """Sort the table by Macao Water's number; the un-numbered DSAMA reservoir
    (`no=None`) sorts last, after the 22."""
    return (1, 0) if f["no"] is None else (0, f["no"])


def nearest_ring_point(rings: list[list[list[float]]],
                       target: list[float]) -> tuple[float, float]:
    """The ring vertex closest to `target`. Puts a reservoir's marker on the
    shore facing whatever it feeds instead of out in the middle of the water."""
    tx, ty = metres_xy(target[0], target[1], LAT0)
    best = None
    best_d = None
    for ring in rings:
        for lng, lat in ring:
            x, y = metres_xy(lng, lat, LAT0)
            d = (x - tx) ** 2 + (y - ty) ** 2
            if best_d is None or d < best_d:
                best_d, best = d, (lng, lat)
    return best


def centroid_of(polys: list[Polygon]) -> tuple[float, float]:
    merged = unary_union(polys)
    c = merged.centroid
    if c.is_empty:
        c = merged.representative_point()
    return (c.x, c.y)


# ----------------------------------------------------------------------------
# pipe geometry (OSRM)
# ----------------------------------------------------------------------------
def routed_line(a: list[float], b: list[float]) -> list[list[float]] | None:
    """Cached OSRM driving geometry a → b; None when it is unusable.

    Unusable means OSRM failed, answered with fewer than two points, or routed
    through Hengqin — the same exclusion the bus pipeline applies, because a
    path that only exists on the mainland side of the border is not a path.
    Only successes are cached, so a transient outage is retried on the re-run.
    """
    key = f"driving|{a[0]:.6f},{a[1]:.6f};{b[0]:.6f},{b[1]:.6f}"
    OSRM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = OSRM_CACHE_DIR / (hashlib.sha1(key.encode("utf-8")).hexdigest() + ".json")
    if cache_file.exists() and time.time() - cache_file.stat().st_mtime < OSRM_CACHE_TTL_S:
        return json.loads(cache_file.read_text(encoding="utf-8"))
    coords = get_road_geometry([list(a), list(b)], profile="driving")
    time.sleep(OSRM_PACING_S)
    if not coords or len(coords) < 2 or path_enters_hengqin(coords):
        return None
    cache_file.write_text(json.dumps(coords), encoding="utf-8")
    return coords


def line_length_m(coords: list[list[float]]) -> float:
    """Length along the emitted polyline (so it matches what the map draws,
    endpoint stubs included — OSRM's own `distance` stops at the snapped ends)."""
    pts = [metres_xy(x, y, LAT0) for x, y in coords]
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def pipe_geometry(a: list[float], b: list[float]) -> tuple[list[list[float]], bool, bool]:
    """(coordinates, direct, fallback).

    OSRM snaps to the nearest road, which can be hundreds of metres from a
    marker (a reservoir marker sits on the water), so the exact marker
    coordinates are pinned back on: a pipe must start and end at the facility
    it serves, not near it. Short hops skip OSRM entirely and long detours are
    thrown away — see LOCAL_CONNECTOR_M / DETOUR_RATIO.
    """
    start = [round(a[0], 6), round(a[1], 6)]
    end = [round(b[0], 6), round(b[1], 6)]
    straight = [start, end]
    straight_m = line_length_m(straight)
    if straight_m < LOCAL_CONNECTOR_M:
        return straight, True, False  # same site: not worth a routing call

    routed = routed_line(a, b)
    if routed is None:
        return straight, False, True  # OSRM failed; the line is a guess

    line = [[round(c[0], 6), round(c[1], 6)] for c in routed]
    if line[0] != start:
        line.insert(0, start)
    if line[-1] != end:
        line.append(end)
    if straight_m < DETOUR_MAX_STRAIGHT_M and line_length_m(line) > DETOUR_RATIO * straight_m:
        return straight, True, False  # the roads take the long way round
    return line, False, False


def build_network(markers: dict[str, list[float]]) -> dict:
    """The `network` block: the extra inlet node plus every pipe."""
    coords = dict(markers)
    coords[INLET_NODE["id"]] = INLET_NODE["coordinates"]
    print(f"\nBuilding {len(PIPES)} schematic pipes (OSRM routes + local connectors)")
    pipes = []
    for kind, src, dst in PIPES:
        line, direct, fallback = pipe_geometry(coords[src], coords[dst])
        length = line_length_m(line)
        straight = line_length_m([line[0], line[-1]])
        pipes.append({
            "id": f"{kind}-{src}-{dst}",
            "from": src,
            "to": dst,
            "kind": kind,
            "lengthM": int(round(length)),
            "direct": direct,
            "fallback": fallback,
            "coordinates": line,
        })
        mark = "~" if fallback else ("=" if direct else " ")
        ratio = length / straight if straight > 0 else 1.0
        print(f" {mark}{kind:<8} {src:<20} -> {dst:<20} {len(line):>4} pts  {length:>7.0f} m"
              f"  straight {straight:>6.0f} m  x{ratio:.2f}"
              + ("  (straight-line FALLBACK)" if fallback
                 else "  (direct connector)" if direct else ""))
    return {"nodes": [INLET_NODE], "pipes": pipes}


# ----------------------------------------------------------------------------
# OSM fetches
# ----------------------------------------------------------------------------
def fetch_listed_elements() -> dict[str, dict]:
    """Re-query every OSM id the table names; keyed by "<type letter><id>"."""
    refs = [ref for f in FACILITIES for ref in f.get("osm", [])]
    kinds = {"w": "way", "r": "relation", "n": "node"}
    body = "".join(f"{kinds[ref[0]]}({ref[1:]});" for ref in refs)
    print(f"Fetching {len(refs)} listed OSM elements")
    els = overpass(f"[out:json][timeout:120];({body});out geom;")
    found = {osm_ref(el): el for el in els}
    missing = [r for r in refs if r not in found]
    if missing:
        raise RuntimeError(f"OSM ids in the facility table no longer exist: {missing}")
    return found


def fetch_buildings_in(polys: list[Polygon]) -> list[dict]:
    """Every building way/relation inside any of the given compound polygons."""
    parts = []
    for poly in polys:
        geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
        for g in geoms:
            ring = " ".join(f"{y:.6f} {x:.6f}" for x, y in g.exterior.coords)
            parts.append(f'nwr["building"](poly:"{ring}");')
    print(f"Fetching buildings inside {len(polys)} compound polygons")
    # `out geom` (not `out tags geom`): the tags-only mode drops relation
    # members, and a courtyard building is a multipolygon relation.
    return overpass(f"[out:json][timeout:180];({''.join(parts)});out geom;")


def fetch_district_anchors() -> dict[str, dict]:
    """Resolve every district anchor by name; returns slug -> anchor record."""
    slugs = sorted({f["anchor"].split(":", 1)[1] for f in FACILITIES
                    if f.get("anchor", "").startswith("district:")})
    body = "".join(f'nwr{DISTRICT_ANCHORS[s]["filter"]};' for s in slugs)
    print(f"Fetching {len(slugs)} district anchors by name")
    els = overpass(f"[out:json][timeout:120][bbox:{MACAU_BBOX}];({body});out geom;")

    resolved: dict[str, dict] = {}
    for slug in slugs:
        spec = DISTRICT_ANCHORS[slug]
        best = None
        for el in els:
            poly = polygon_of_element(el)
            if poly is None or poly.is_empty:
                continue
            # The one query returns all three anchors' matches; keep the ones
            # whose name matches this anchor's Chinese key.
            if spec["key"] not in (el.get("tags", {}).get("name") or ""):
                continue
            if best is None or poly.area > best[1].area:
                best = (el, poly)
        if best is None:
            raise RuntimeError(f"district anchor '{slug}' ({spec['label']}) not found in OSM")
        el, poly = best
        rings = plain_ring(poly if poly.geom_type == "Polygon"
                           else max(poly.geoms, key=lambda g: g.area))
        if spec["point"] == "ne_shore":
            minx, miny, maxx, maxy = poly.bounds
            pt = min(rings[0], key=lambda p: (p[0] - maxx) ** 2 + (p[1] - maxy) ** 2)
            point = (pt[0], pt[1])
        else:
            rp = poly.representative_point()
            point = (rp.x, rp.y)
        resolved[slug] = {
            "osmId": osm_ref(el),
            "name": el.get("tags", {}).get("name") or spec["label"],
            "coordinates": [round(point[0], 6), round(point[1], 6)],
        }
        print(f"  district:{slug} -> {resolved[slug]['osmId']} {resolved[slug]['name']}")
    return resolved


# ----------------------------------------------------------------------------
# geometry assembly
# ----------------------------------------------------------------------------
def records_from_element(el: dict) -> list[dict]:
    """Building record(s) for one OSM building way or multipolygon relation."""
    if el["type"] == "way":
        rec = building_record(el, LAT0)
        return [rec] if rec else []
    poly = polygon_of_element(el)
    if poly is None or poly.is_empty:
        return []
    geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
    h, mh = parse_height(el.get("tags", {}))
    out = []
    for i, g in enumerate(geoms):
        out.append({
            "osmId": f"r{el['id']}" + (f"#{i}" if i else ""),
            "name": el.get("tags", {}).get("name") or None,
            "height": round(h, 1),
            "minHeight": mh,
            "coordinates": buffered_footprint(g, LAT0),
            "_poly": g,
        })
    return out


def outline_record(el: dict, poly: Polygon, index: int) -> dict:
    """Low slab cut straight from an outline the basemap does not render."""
    h, mh = parse_height(el.get("tags", {}))
    return {
        "osmId": osm_ref(el) + (f"#{index}" if index else ""),
        "name": el.get("tags", {}).get("name") or None,
        "height": round(min(h, OUTLINE_MAX_HEIGHT_M), 1),
        "minHeight": mh,
        "kind": "outline",
        "coordinates": buffered_footprint(poly, LAT0),
        "_poly": poly,
    }


def finalize(rec: dict, kind: str) -> dict:
    rec["kind"] = kind
    return rec


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def run() -> int:
    elements = fetch_listed_elements()
    anchors = fetch_district_anchors()

    # --- resolve the OSM areas each grounded facility owns ---------------------
    areas: dict[str, list[tuple[dict, Polygon]]] = {}
    for f in FACILITIES:
        if f["geom"] == "approximate":
            continue
        pairs = []
        for ref in f["osm"]:
            el = elements[ref]
            poly = polygon_of_element(el)
            if poly is None or poly.is_empty:
                raise RuntimeError(f"{f['id']}: OSM {ref} has no usable polygon")
            geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
            for g in geoms:
                pairs.append((el, g))
        areas[f["id"]] = pairs

    # --- buildings inside the compounds ----------------------------------------
    compound_ids = [f["id"] for f in FACILITIES if f["geom"] == "compound"]
    compound_polys = [g for fid in compound_ids for _, g in areas[fid]]
    building_els = fetch_buildings_in(compound_polys) if compound_polys else []
    print(f"  {len(building_els)} building features inside the compounds")

    claimed: dict[str, list[dict]] = {fid: [] for fid in compound_ids}
    seen_osm: set[str] = set()
    for el in building_els:
        for rec in records_from_element(el):
            if rec["osmId"] in seen_osm:
                continue
            rep = rec["_poly"].representative_point()
            for fid in compound_ids:
                if any(g.contains(rep) for _, g in areas[fid]):
                    seen_osm.add(rec["osmId"])
                    claimed[fid].append(finalize(rec, "building"))
                    break

    # The tanks are buildings in their own right.
    for f in FACILITIES:
        if f["geom"] == "building":
            claimed[f["id"]] = [finalize(r, "building") for el, _ in areas[f["id"]]
                                for r in records_from_element(el)]

    # --- re-cut everything against the basemap's own building parts ------------
    fallback = [(fid, el, g) for fid in compound_ids if not claimed[fid]
                for el, g in areas[fid]]
    geoms_for_tiles = [rec["_poly"] for recs in claimed.values() for rec in recs]
    geoms_for_tiles += [g for _, _, g in fallback]
    tiles = tiles_covering(geoms_for_tiles)
    print(f"Re-cutting footprints against basemap tiles ({len(tiles)} tiles; "
          f"{len(fallback)} compounds need fallback footprints)")
    index = TilePartIndex(fetch_tile_building_parts(tiles))

    recut = 0
    for fid, recs in claimed.items():
        new_recs: list[dict] = []
        for rec in recs:
            inside = index.within(rec["_poly"])
            if not inside:
                # Nothing quantised into this outline: the basemap draws no
                # block here, so a capped slab of the OSM shape stands in.
                rec["height"] = round(min(rec["height"], OUTLINE_MAX_HEIGHT_M), 1)
                new_recs.append(finalize(rec, "outline"))
                continue
            recut += 1
            for i, part in enumerate(inside):
                osm_id = f"{rec['osmId']}#p{i}" if i else rec["osmId"]
                new_recs.append(finalize(
                    part_record(part, LAT0, osm_id, rec.get("name"), "building"), "building"))
        claimed[fid] = new_recs
    print(f"  {recut} OSM footprints replaced by the basemap's parts")

    for fid, el, g in fallback:
        inside = index.within(g)
        if inside:
            for part in inside:
                claimed[fid].append(finalize(
                    part_record(part, LAT0, part["id"], None, "tile"), "tile"))
            print(f"  {fid}: {len(inside)} basemap building parts")
        else:
            claimed[fid].append(outline_record(el, g, len(claimed[fid])))
            print(f"  {fid}: no basemap part — outline slab")

    # --- assemble --------------------------------------------------------------
    out_by_id: dict[str, dict] = {}
    for f in sorted(FACILITIES, key=table_order):
        if f["geom"] == "approximate":
            continue
        tags = {}
        for ref in f["osm"]:
            tags.update(elements[ref].get("tags", {}))
        buildings = [strip_private(b) for b in claimed.get(f["id"], [])]
        water = []
        if f["geom"] == "water":
            for el, g in areas[f["id"]]:
                water.append({"osmId": osm_ref(el) if len(areas[f["id"]]) == 1
                              else f"{osm_ref(el)}#{len(water)}",
                              "coordinates": plain_ring(g)})
        marker = f.get("marker", "")
        if marker.startswith("shore:"):
            cx, cy = nearest_ring_point([w["coordinates"][0] for w in water],
                                        out_by_id[marker.split(":", 1)[1]]["coordinates"])
        else:
            polys = ([Polygon(b["coordinates"][0]) for b in buildings] if buildings
                     else [g for _, g in areas[f["id"]]])
            cx, cy = centroid_of(polys)
        out_by_id[f["id"]] = {
            "id": f["id"],
            "no": f["no"],
            "type": f["type"],
            "operator": f.get("operator", "macao_water"),
            "name": {
                "zh": f["zh"],
                "en": pick_name(tags.get("name:en"), f["en"]),
                "pt": pick_name(tags.get("name:pt"), f["pt"]),
            },
            "coordinates": [round(cx, 6), round(cy, 6)],
            "approximate": False,
            "anchor": None,
            "osm": list(f["osm"]),
            "buildings": buildings,
            "water": water,
        }

    # Every reservoir surface we know about, so an offset marker can be kept
    # out of the water (see first_dry_bearing).
    reservoirs = [Polygon(w["coordinates"][0])
                  for rec in out_by_id.values() for w in rec["water"]]

    district_used: set[str] = set()
    for f in sorted(FACILITIES, key=table_order):
        if f["geom"] != "approximate":
            continue
        anchor = f["anchor"]
        bearing = bearing_for(f["no"])
        if anchor.startswith("district:"):
            # Each district anchor currently carries one facility, so there is
            # no marker to dodge — and nudging off e.g. the Sai Van Lake shore
            # point would drop the marker into the lake. A second facility on
            # the same anchor does get the usual offset.
            base = anchors[anchor.split(":", 1)[1]]["coordinates"]
            if anchor in district_used:
                lng, lat = offset_point(base[0], base[1], bearing, APPROX_OFFSET_M)
            else:
                lng, lat = base
            district_used.add(anchor)
        else:
            src = out_by_id[anchor]
            if src["water"] and not src["buildings"]:
                # Anchored on open water: walk out to the shore first.
                edge = ring_point_towards([w["coordinates"][0] for w in src["water"]],
                                          tuple(src["coordinates"]), bearing)
                lng, lat = offset_point(edge[0], edge[1], bearing, SHORE_OFFSET_M)
            else:
                dry = first_dry_bearing(src["coordinates"], bearing,
                                        APPROX_OFFSET_M, reservoirs)
                if dry != bearing:
                    print(f"  {f['id']}: bearing {bearing:.1f}° lands in water; "
                          f"using {dry:.1f}°")
                lng, lat = offset_point(src["coordinates"][0], src["coordinates"][1],
                                        dry, APPROX_OFFSET_M)
        out_by_id[f["id"]] = {
            "id": f["id"],
            "no": f["no"],
            "type": f["type"],
            "operator": f.get("operator", "macao_water"),
            "name": {"zh": f["zh"], "en": f["en"], "pt": f["pt"]},
            "coordinates": [round(lng, 6), round(lat, 6)],
            "approximate": True,
            "anchor": anchor,
            "osm": [],
            "buildings": [],
            "water": [],
        }

    facilities = [out_by_id[f["id"]] for f in sorted(FACILITIES, key=table_order)]

    # --- the schematic pipe network --------------------------------------------
    network = build_network({f["id"]: f["coordinates"] for f in facilities})

    # --- degenerate-run guard --------------------------------------------------
    problems = []
    if len(facilities) != EXPECTED_COUNT:
        problems.append(f"{len(facilities)} facilities, expected {EXPECTED_COUNT}")
    if len({f["id"] for f in facilities}) != len(facilities):
        problems.append("duplicate facility ids")
    numbered = [f for f in facilities if f["operator"] == "macao_water"]
    unnumbered = [f for f in facilities if f["operator"] == "dsama"]
    if sorted(f["no"] for f in numbered) != list(range(1, NUMBERED_COUNT + 1)):
        problems.append(f"Macao Water `no` is not 1..{NUMBERED_COUNT} without gaps")
    if len(unnumbered) != EXPECTED_COUNT - NUMBERED_COUNT:
        problems.append(f"{len(unnumbered)} DSAMA facilities, expected "
                        f"{EXPECTED_COUNT - NUMBERED_COUNT}")
    if any(f["no"] is not None for f in unnumbered):
        problems.append("a DSAMA facility carries a Macao Water number")
    bad_types = sorted({f["type"] for f in facilities} - set(TYPES))
    if bad_types:
        problems.append(f"unknown type(s): {bad_types}")
    bad_ops = sorted({f["operator"] for f in facilities} - set(OPERATORS))
    if bad_ops:
        problems.append(f"unknown operator(s): {bad_ops}")
    with_buildings = sum(1 for f in facilities if f["buildings"])
    with_water = sum(1 for f in facilities if f["water"])
    if with_buildings < MIN_WITH_BUILDINGS:
        problems.append(f"only {with_buildings} facilities have buildings (< {MIN_WITH_BUILDINGS})")
    if with_water < MIN_WITH_WATER:
        problems.append(f"only {with_water} facilities have water (< {MIN_WITH_WATER})")

    pipes = network["pipes"]
    node_ids = {n["id"] for n in network["nodes"]}
    known = {f["id"] for f in facilities} | node_ids
    if len(pipes) != len(PIPES):
        problems.append(f"{len(pipes)} pipes, expected {len(PIPES)}")
    if len({p["id"] for p in pipes}) != len(pipes):
        problems.append("duplicate pipe ids")
    dangling = sorted({e for p in pipes for e in (p["from"], p["to"]) if e not in known})
    if dangling:
        problems.append(f"pipe endpoint(s) resolve to nothing: {dangling}")
    short = [p["id"] for p in pipes if len(p["coordinates"]) < 2]
    if short:
        problems.append(f"pipe(s) with fewer than 2 coordinates: {short}")
    bent = [p["id"] for p in pipes if p["direct"] and len(p["coordinates"]) != 2]
    if bent:
        problems.append(f"direct pipe(s) that are not a 2-point segment: {bent}")
    fallbacks = [p["id"] for p in pipes if p["fallback"]]
    if len(fallbacks) > MAX_PIPE_FALLBACKS:
        problems.append(f"{len(fallbacks)} pipes fell back to straight lines "
                        f"(> {MAX_PIPE_FALLBACKS}) — OSRM is probably down: {fallbacks}")

    if problems:
        for p in problems:
            print(f"ERROR: {p}", file=sys.stderr)
        print("refusing to write", file=sys.stderr)
        return 1

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "sources": {
            "name": SOURCE_NAME,
            "facilities": FACILITIES_PAGE,
            "osm": OSM_COPYRIGHT,
            # 黑沙水庫 is not on Macao Water's page at all; it is on the map
            # because it feeds the Coloane plant, and the UI must not imply
            # Macao Water runs it.
            "hacSa": HAC_SA_NOTE,
        },
        # Which OSM element each `district:<slug>` anchor resolved to, so a
        # reader can see where an approximate marker was hung.
        "anchors": {f"district:{slug}": rec for slug, rec in sorted(anchors.items())},
        "facilities": facilities,
        # Our schematic, not Macao Water's mains — see PIPES.
        "network": network,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    exact = sum(1 for f in facilities if not f["approximate"])
    total_b = sum(len(f["buildings"]) for f in facilities)
    total_w = sum(len(f["water"]) for f in facilities)
    print(f"\nDone. {len(facilities)} facilities ({exact} exact / {len(facilities) - exact} "
          f"approximate; {len(numbered)} macao_water / {len(unnumbered)} dsama), "
          f"{total_b} buildings, {total_w} water polygons")
    for f in facilities:
        mark = "~" if f["approximate"] else " "
        no = "--" if f["no"] is None else f"{f['no']:>2}"
        print(f" {mark}{no} {f['id']:<20} {f['type']:<12} {f['operator']:<11} "
              f"b={len(f['buildings'])} w={len(f['water'])} anchor={f['anchor'] or '-'}")

    by_kind = {k: sum(1 for p in pipes if p["kind"] == k) for k in PIPE_KINDS}
    total_km = sum(p["lengthM"] for p in pipes) / 1000.0
    n_direct = sum(1 for p in pipes if p["direct"])
    print(f"Network: {len(pipes)} pipes ("
          + ", ".join(f"{k} {n}" for k, n in by_kind.items())
          + f"), {n_direct} direct connectors / {len(pipes) - n_direct} routed, "
          f"{len(fallbacks)} straight-line fallbacks, {total_km:.1f} km total, "
          f"{len(network['nodes'])} extra node(s)")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
