"""Shared OpenStreetMap + basemap-tile footprint machinery.

Both overlays that draw their own 3D buildings — `fetch_schools.py` and
`fetch_water_facilities.py` — need the same three things, so they live here
instead of being copied:

1. **Overpass access** (`overpass`) with mirror rotation, a sticky endpoint,
   a SHA-1-keyed response cache in the OS temp dir and 429 backoff. The cache
   is what makes a half-finished run cheap to restart: overpass-api.de answers
   429 to back-to-back calls and the exponential backoff dominates wall time.
2. **OSM geometry → footprint** (`polygon_of_element`, `building_record`,
   `buffered_footprint`, `parse_height`) following the OpenMapTiles height
   rules, with a 0.5 m outward buffer so our walls do not z-fight the
   basemap's.
3. **Recutting against the basemap** (`fetch_tile_building_parts`,
   `TilePartIndex`). OpenFreeMap's `building` tiles merge every building of
   the same height into one multipolygon feature (a z14 tile holds ~8,000
   footprints in ~120 features), so per-building `setFeatureState` on the
   basemap is impossible — we draw our own extrusions. To make a coloured
   block never shorter or narrower than the grey one under it, each claimed
   OSM outline is replaced by whatever the basemap actually renders inside it
   (`TilePartIndex.within`, ≥ 50 % area overlap). OSM only decides which
   buildings belong to which feature.

Nothing here is specific to schools or to water: callers supply the OSM query
and decide ownership.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import tempfile
import time
from pathlib import Path

import mapbox_vector_tile as mvt
import requests
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union

HEADERS = {"User-Agent": "mini-macau data pipeline (https://github.com/asdfghj1237890/mini-macau)"}

# Tried in order; a connection failure / 5xx moves to the next mirror for that
# call (429 = rate limit, retried on the same host). All run the same API;
# the mirrors can lag the main instance by minutes, which does not matter here.
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
# south, west, north, east — generous; it spills into Zhuhai / Hengqin, so
# callers that query by bbox need their own "is this actually Macau" filter.
MACAU_BBOX = "22.06,113.52,22.23,113.62"

DEFAULT_RENDER_HEIGHT_M = 5.0  # OpenMapTiles default for untagged buildings
LEVEL_HEIGHT_M = 3.66  # OpenMapTiles building:levels -> metres
BUILDING_BUFFER_M = 0.5  # grow footprints so our walls do not z-fight the basemap's
# Heights are stored as the basemap draws them (no margin). The frontend adds
# its own vertical margin when it builds the layer (see SCHOOL_HEIGHT_MARGIN_M
# in src/schools.ts): a data-side 0.5 m was not enough — large low roofs
# z-fought the basemap's roof at oblique angles, and the z14→15.5 height ramp
# shrank the margin further.
EXTRA_HEIGHT_M = 0.0

# Fallback footprint source: the very tiles the map draws.
OFM_TILEJSON = "https://tiles.openfreemap.org/planet"
TILE_ZOOM = 14  # OpenFreeMap maxzoom; higher zooms are overzoomed from this


# ----------------------------------------------------------------------------
# HTTP / Overpass
# ----------------------------------------------------------------------------
def http_get(url: str, attempts: int = 6, **kw) -> requests.Response:
    last = None
    for i in range(attempts):
        try:
            r = requests.get(url, headers=HEADERS, timeout=60, **kw)
            if r.status_code == 200:
                return r
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = f"{type(e).__name__}: {e}"
        time.sleep(2 * (2**i))
    raise RuntimeError(f"GET {url} failed: {last}")


# Overpass answers are cached in the OS temp dir for a day, keyed by the query
# text: a run that dies half-way (this machine's network drops; overpass-api.de
# 429s back-to-back calls) can be restarted without repeating finished calls.
OVERPASS_CACHE_DIR = Path(tempfile.gettempdir()) / "mini-macau-overpass-cache"
OVERPASS_CACHE_TTL_S = 24 * 3600
# Index of the mirror that last answered; sticky across calls so one dead host
# costs its connect timeout once per run, not once per query.
_overpass_endpoint = 0


def overpass(query: str, attempts: int = 8) -> list[dict]:
    """POST an Overpass QL query; backs off on 429/5xx and transient errors."""
    global _overpass_endpoint
    OVERPASS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = OVERPASS_CACHE_DIR / (hashlib.sha1(query.encode("utf-8")).hexdigest() + ".json")
    if cache_file.exists() and time.time() - cache_file.stat().st_mtime < OVERPASS_CACHE_TTL_S:
        return json.loads(cache_file.read_text(encoding="utf-8"))
    last = None
    same_host_failures = 0
    for i in range(attempts):
        url = OVERPASS_ENDPOINTS[_overpass_endpoint % len(OVERPASS_ENDPOINTS)]
        try:
            r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=(20, 180))
            if r.status_code == 200:
                elements = r.json().get("elements", [])
                cache_file.write_text(json.dumps(elements), encoding="utf-8")
                time.sleep(2)  # be polite between calls
                return elements
            last = f"HTTP {r.status_code} from {url}"
            if r.status_code == 429:
                same_host_failures += 1  # rate limit: back off on this host
            else:
                _overpass_endpoint += 1  # server-side trouble: next mirror
                same_host_failures = 0
        except (requests.RequestException, ValueError) as e:
            last = f"{type(e).__name__} from {url}: {str(e)[:120]}"
            _overpass_endpoint += 1  # unreachable host: next mirror
            same_host_failures = 0
        # Short pause right after switching mirrors; exponential (capped)
        # only while hammering the same host.
        delay = min(5 * (2**same_host_failures), 60)
        print(f"  overpass attempt {i + 1} failed ({last}); retrying in {delay}s", file=sys.stderr)
        time.sleep(delay)
    raise RuntimeError(f"Overpass failed: {last}")


# ----------------------------------------------------------------------------
# geometry helpers
# ----------------------------------------------------------------------------
def metres_xy(lng: float, lat: float, lat0: float) -> tuple[float, float]:
    return (lng * 111320.0 * math.cos(math.radians(lat0)), lat * 110540.0)


def xy_lnglat(x: float, y: float, lat0: float) -> tuple[float, float]:
    return (x / (111320.0 * math.cos(math.radians(lat0))), y / 110540.0)


def ring_from_geometry(geom: list[dict]) -> list[tuple[float, float]]:
    return [(p["lon"], p["lat"]) for p in geom]


def polygon_of_element(el: dict) -> Polygon | MultiPolygon | None:
    """Area polygon for an OSM way (closed) or relation (outer members)."""
    if el["type"] == "way":
        ring = ring_from_geometry(el.get("geometry", []))
        if len(ring) >= 4 and ring[0] == ring[-1]:
            poly = Polygon(ring)
            return poly if poly.is_valid else poly.buffer(0)
        return None
    if el["type"] == "relation":
        lines = [
            LineString(ring_from_geometry(m["geometry"]))
            for m in el.get("members", [])
            if m.get("role") == "outer" and m.get("geometry") and len(m["geometry"]) >= 2
        ]
        if not lines:
            return None
        polys = list(polygonize(unary_union(lines)))
        if not polys:
            return None
        return unary_union(polys)
    return None


def parse_height(tags: dict) -> tuple[float, float]:
    """(render_height, render_min_height) following the OpenMapTiles rule."""

    def num(v: str | None) -> float | None:
        if not v:
            return None
        m = re.match(r"^\s*(-?\d+(?:\.\d+)?)", v.replace(",", "."))
        return float(m.group(1)) if m else None

    h = num(tags.get("height"))
    if h is None:
        lv = num(tags.get("building:levels"))
        h = lv * LEVEL_HEIGHT_M if lv else DEFAULT_RENDER_HEIGHT_M
    mh = num(tags.get("min_height"))
    if mh is None:
        ml = num(tags.get("building:min_level"))
        mh = ml * LEVEL_HEIGHT_M if ml else 0.0
    # The tiles carry integer heights: planetiler rounds `height` UP (11.3 → 12,
    # 23.1 → 24, verified against MUST's buildings), so our top must clear the
    # rounded-up value or the basemap's grey roof pokes through our colour.
    # The base is rounded down for the same reason (we must start no higher).
    return (float(math.ceil(h - 1e-9)), float(math.floor(mh + 1e-9)))


def buffered_footprint(poly: Polygon, lat0: float) -> list[list[list[float]]]:
    """Outer ring(s) grown by BUILDING_BUFFER_M, as GeoJSON polygon coordinates."""
    xy = Polygon([metres_xy(x, y, lat0) for x, y in poly.exterior.coords])
    grown = xy.buffer(BUILDING_BUFFER_M, join_style="mitre").simplify(0.3)
    if grown.geom_type == "MultiPolygon":
        grown = max(grown.geoms, key=lambda g: g.area)
    ring = [list(map(lambda v: round(v, 6), xy_lnglat(x, y, lat0))) for x, y in grown.exterior.coords]
    return [ring]


def plain_ring(poly: Polygon, precision: int = 6) -> list[list[list[float]]]:
    """Outer ring as GeoJSON polygon coordinates, unbuffered (water surfaces)."""
    return [[[round(x, precision), round(y, precision)] for x, y in poly.exterior.coords]]


def building_record(el: dict, lat0: float) -> dict | None:
    """One OSM building way -> the shared building record (`_poly` kept for callers)."""
    ring = ring_from_geometry(el.get("geometry", []))
    if len(ring) < 4 or ring[0] != ring[-1]:
        return None
    poly = Polygon(ring)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty or poly.geom_type != "Polygon":
        return None
    h, mh = parse_height(el["tags"])
    return {
        "osmId": f"w{el['id']}",
        "name": el["tags"].get("name") or None,
        "kind": el["tags"].get("building") or "yes",
        "height": round(h + EXTRA_HEIGHT_M, 1),
        "minHeight": mh,
        "coordinates": buffered_footprint(poly, lat0),
        "_poly": poly,
    }


def strip_private(rec: dict) -> dict:
    """Drop the `_`-prefixed working fields before the record is serialised."""
    return {k: v for k, v in rec.items() if not k.startswith("_")}


# ----------------------------------------------------------------------------
# basemap tiles
# ----------------------------------------------------------------------------
def tile_xy(lng: float, lat: float, z: int = TILE_ZOOM) -> tuple[int, int]:
    n = 2**z
    x = int((lng + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def tile_px_to_lnglat(px: float, py: float, tx: int, ty: int, z: int, extent: int) -> tuple[float, float]:
    n = 2**z
    lng = (tx + px / extent) / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * (ty + py / extent) / n))))
    return (lng, lat)


def tiles_covering(geoms) -> set[tuple[int, int]]:
    """The z14 tiles whose extent touches any of the given shapely geometries."""
    tiles: set[tuple[int, int]] = set()
    for geom in geoms:
        minx, miny, maxx, maxy = geom.bounds
        x0, y0 = tile_xy(minx, maxy)
        x1, y1 = tile_xy(maxx, miny)
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                tiles.add((tx, ty))
    return tiles


def fetch_tile_building_parts(tiles: set[tuple[int, int]]) -> list[dict]:
    """Every building polygon part in the given z14 tiles, in lng/lat, with the
    basemap's render heights. Merged multipolygons are split into their parts."""
    tilejson = http_get(OFM_TILEJSON).json()
    template = tilejson["tiles"][0]
    parts: list[dict] = []
    seen_shapes: set[tuple] = set()  # the tiles repeat some footprints verbatim
    for tx, ty in sorted(tiles):
        url = template.replace("{z}", str(TILE_ZOOM)).replace("{x}", str(tx)).replace("{y}", str(ty))
        data = http_get(url).content
        if not data:
            continue
        layer = mvt.decode(data, default_options={"y_coord_down": True}).get("building")
        if not layer:
            continue
        extent = layer.get("extent", 4096)
        for feat in layer["features"]:
            geom = feat["geometry"]
            polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
            props = feat.get("properties", {})
            for i, rings in enumerate(polys):
                if not rings or len(rings[0]) < 4:
                    continue
                ring = [tile_px_to_lnglat(px, py, tx, ty, TILE_ZOOM, extent) for px, py in rings[0]]
                poly = Polygon(ring)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.is_empty or poly.geom_type != "Polygon":
                    continue
                shape_key = (round(poly.centroid.x, 6), round(poly.centroid.y, 6), round(poly.area * 1e10), props.get("render_height"))
                if shape_key in seen_shapes:
                    continue
                seen_shapes.add(shape_key)
                parts.append(
                    {
                        "_poly": poly,
                        "id": f"t{TILE_ZOOM}/{tx}/{ty}/{feat.get('id', 0)}#{i}",
                        "height": float(props.get("render_height") or DEFAULT_RENDER_HEIGHT_M),
                        "minHeight": float(props.get("render_min_height") or 0.0),
                    }
                )
        print(f"  tile {TILE_ZOOM}/{tx}/{ty}: {len(parts)} building parts so far")
    return parts


class TilePartIndex:
    """Coarse (~50 m cell) spatial index over basemap building parts.

    `within(poly)` returns the parts that mostly (≥ 50 % of their own area) lie
    inside `poly` and marks them used, so the same basemap block is never
    claimed twice by two overlapping outlines.
    """

    CELL = 0.0005

    def __init__(self, parts: list[dict]):
        self.parts = parts
        self.grid: dict[tuple[int, int], list[dict]] = {}
        for part in parts:
            c = part["_poly"].representative_point()
            self.grid.setdefault((int(c.x / self.CELL), int(c.y / self.CELL)), []).append(part)
        self.used: set[str] = set()

    def within(self, poly) -> list[dict]:
        """Basemap parts that mostly (≥ 50 % of their area) lie inside `poly`.
        Area overlap, not point-in-polygon: the z14 tile quantises footprints
        by ~0.6 m and tower parts can spill past the OSM outline."""
        cell = self.CELL
        minx, miny, maxx, maxy = poly.bounds
        found = []
        for gx in range(int(minx / cell) - 2, int(maxx / cell) + 3):
            for gy in range(int(miny / cell) - 2, int(maxy / cell) + 3):
                for part in self.grid.get((gx, gy), []):
                    if part["id"] in self.used:
                        continue
                    ppoly = part["_poly"]
                    if not ppoly.intersects(poly):
                        continue
                    if ppoly.intersection(poly).area >= 0.5 * ppoly.area:
                        found.append(part)
        for part in found:
            self.used.add(part["id"])
        return found


def part_record(part: dict, lat0: float, osm_id: str, name: str | None, kind: str) -> dict:
    """A basemap building part as a building record."""
    return {
        "osmId": osm_id,
        "name": name,
        "kind": kind,
        "height": round(part["height"] + EXTRA_HEIGHT_M, 1),
        "minHeight": round(part["minHeight"], 1),
        "coordinates": buffered_footprint(part["_poly"], lat0),
        "_poly": part["_poly"],
    }
