"""
Monthly fetch: IAM (市政署) 步行徑 / 單車徑 (walking & cycling trails),
normalised into public/data/trails.json for the map's TRAILS overlay.

Four upstreams are combined, joined mostly by the IAM nature UUID:

  * IAM 大自然中心 (nature) BigJson facility_{c,p,e}.json — the MASTER list.
    `{"data": [...]}`; records with `category == "trails"` (18 today: 16
    步行徑/健康徑/家樂徑/環山徑/古道 + 2 單車徑). Per-record fields used: `id`
    (the stable UUID), `area` (區 text, area fallback), `suspendStartDate` /
    `suspendEndDate` ("2025-10-06T00:00:00" or "" — date part only kept),
    `easygoEntranceCoordinate` ("lat,lng | lat,lng | ..." pipe-separated,
    sometimes empty), `mapLink`/`webLink`, and `name`/`address`/`openHours`
    as a trilingual (c/p/e) fallback when the data.gov.mo record below is
    missing a field. No token; a plain browser-UA GET.
  * data.gov.mo 市政活動場地 (IAM venues), dataset
    e410770e-caa6-4a56-872b-68b8af389cac: the bare download endpoint returns
    a ZIP with no token, and intermittently answers HTTP 200 with
    {"msg":"內部錯誤"} instead — retried the same way fetch_toilets.py's
    fetch_zip/read_dataset already handle it, reused here directly. 71
    venues; joined to the nature master list by NORMALISED zh name (strip
    whitespace, fullwidth parens -> halfwidth) — every current trail name
    matches. Supplies the primary trilingual name/address (entrance/exit/
    length parsed out of "入口:"/"出口:"/"長度:" — the upstream mixes full and
    half-width colons and stray whitespace, hence the tolerant regexes
    below), phone, openHours and `tempClose`.
  * DSAT/DSSCU GIS ArcGIS services (web.gis.gov.mo), native Macau Grid
    (EPSG:8433), converted LOCALLY with pyproj (never the server's own
    outSR=4326, which is datum-free and ~334 m off — verified against the
    DSSCU worked example below):
      - Walk_Trail_lane/MapServer/0 — 18 trail centrelines (MultiLineString).
        `HYLINK` embeds the nature UUID (".../detail/<uuid>") — the primary
        join key, with normalised-CNAME as a fallback. `LOCATIONID` (1/2/3)
        gives area (peninsula/taipa/coloane); the nature record's own `area`
        text is the fallback when a line is missing (see geometry
        precedence). `Class` is a single letter per trail with no direct
        numeric meaning of its own — see below.
      - Walk_Trail_point/MapServer/4 — 150 distance posts, `FID_1` a code
        like "1-03-01" or "1-02-B1". A trail's numeric `code` ("1-01") is
        the common 4-char prefix of ITS posts' FID_1, grouped by the shared
        `Class` letter between the lane and point layers — 13 of the 18
        trails have posts (and hence a code); the other 5 (E/N/O/P/Q) have
        none, so `code` is null for them.
      - Walk_Trail_point/MapServer/0 — 25 rest pavilions; `CNAME` is "*" for
        11 of them (no name) -> `null`, matching the contract.

  * OpenStreetMap via Overpass (overpass-api.de, kumi.systems, mail.ru
    mirrors, via osm_footprints.overpass — mirror rotation + 429 backoff +
    a 24h cache) for two independent purposes:
      1. MANDATORY cross-check, every run: every highway=path|footway|
         track|steps|cycleway|pedestrian|bridleway way in Macau (relation
         3601867188) is the reference line network. Each GIS trail is
         sampled every 10 m; the distance from each sample to the nearest
         reference segment (scipy cKDTree over segment midpoints, exact
         point-to-segment distance re-checked against the k nearest) is
         reduced to a median/p90/within-15%. Overpass's own
         `osm3s.timestamp_osm_base` is recorded as `osmCheck.osmBase`. A
         trail whose median exceeds MEDIAN_LIMIT_M (10 m) or whose p90
         exceeds P90_LIMIT_M (30 m) fails the whole run — this is a sanity
         check on the pyproj conversion and the upstream geometry, not an
         accuracy claim about either dataset.
      2. FALLBACK geometry, only when the GIS lane layer answered but has
         no line for a given trail (or — for testing only — the
         TRAILS_SIMULATE_GIS_MISSING env var drops it): first a
         route=hiking|foot|walking|bicycle relation whose `ref` equals the
         trail's code, else whose name/name:zh normalises to the trail's
         zh name (its member ways, fetched by a second targeted query,
         become the lines; osmIds = ["r<relid>"]; if the trail had no GIS
         Class-derived code, the relation's own `ref` tag is read back as
         the code — this is how the two simulated-missing trails below keep
         the SAME code their (still-present) distance posts already
         reference); else standalone highway ways whose name normalises to
         match (osmIds = ["w<id>", ...]). No match at all is a hard error
         (exit non-zero, write nothing) — a total GIS lane/point/pavilion
         outage is the same: the previously committed file stays.

SUMMITS (added 2026-09-27, the user's choice: the official hills a walking
trail reaches or passes). Seven hand-listed entries in SUMMITS below:
  * HEIGHT = the official GROUND height of the main hills — DSEC
    Environmental Statistics 2011 table 2.3 (credited: DSEC allows
    reproduction with the source named), the same figures DSSCU's live
    主要山丘高度 table (geomatics.dsscu.gov.mo .../geo7.json) publishes. Each
    run compares the two; a different figure fails the run (a hand edit), an
    unreachable DSSCU table only warns. NOT the trig pillar's 高程(N), which is
    the concrete top, 1.2-2.8 m higher.
  * POSITION = the DSSCU geodetic control pillar (大地控制點) on the summit,
    Macao Grid M/P copied from its page, converted like the lines.
  * ACCESS per walking trail: 'trail' when its line passes within REACH_M of
    the pillar, 'spur' when a climb (below) starts on it and ends there,
    'near' within NEAR_M. A summit with no trail within NEAR_M fails the run.
The 好漢坡 climb to 疊石塘山 is not in the GIS lines, which stop at the
路環步行徑 / 石面盆古道 junction: it is stitched from four OSM ways (the steps,
the top of the summit-park road, a short flight, the path to the pillar) by a
shortest path over their shared nodes. A missing or disconnected way fails the
run. Every other summit that walking trails only pass (none within REACH_M)
gets a CLIMB: the shortest OSM footpath (footway/path/steps/pedestrian/track,
no roads) from a node beside such a trail to the reachable node nearest the
pillar, within CLIMB_TARGET_M (60 m); a climb that stops more than REACH_M
short keeps that distance, and the panel says so. No such path = no climb.

TRAILS_SIMULATE_GIS_MISSING=<comma-separated trail zh names> drops those
trails' GIS *lines* (not their posts/pavilions) before joining, forcing the
OSM-fallback path above. This exists ONLY to exercise that path in testing;
a normal run does not set it.

DSSCU worked-example self-check (run once, at start): Macau Grid
(20800.082, 18145.042) must convert to 113°32'50" E, 22°11'40" N within 1 m
via pyproj EPSG:8433 -> EPSG:4326 (always_xy=True) — this is the same
conversion CLAUDE.md's old-maps section cites for the DSSCU datum; verified
here for THIS pipeline rather than assumed.
"""

from __future__ import annotations

import heapq
import json
import math
import os
import re
import sys
import time
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from pyproj import Transformer
from scipy.spatial import cKDTree

from fetch_toilets import read_dataset, updated_at, parse_location
from osm_footprints import HEADERS as OSM_HEADERS
from osm_footprints import OVERPASS_ENDPOINTS, overpass

OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "trails.json"

MUNI_ID = "e410770e-caa6-4a56-872b-68b8af389cac"
DETAIL_URL = "https://data.gov.mo/Detail?id={id}"
NATURE_URL = "https://www.iam.gov.mo/nature/BigJson/facility_{lang}.json"
GIS_BASE = "https://web.gis.gov.mo/arcgis/rest/services/ThematicMap/"

NATURE_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
TIMEOUT = 30
MAX_ATTEMPTS = 5
BACKOFF_BASE = 2.0  # seconds; 2, 4, 8, 16

MACAU_TZ = timezone(timedelta(hours=8))

# Loose sanity bbox (validate_output.py enforces the real gate before commit).
LNG_MIN, LNG_MAX = 113.40, 113.70
LAT_MIN, LAT_MAX = 22.05, 22.30

MIN_TRAILS = 16
MIN_POSTS = 100
MIN_PAVILIONS = 10

MEDIAN_LIMIT_M = 10
P90_LIMIT_M = 30

CODE_RE = re.compile(r"^\d-\d{2}$")
POST_PREFIX_RE = re.compile(r"^(\d-\d{2})")
YMD_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HYLINK_UUID_RE = re.compile(r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})")

ENTRANCE_RE = {
    "zh": re.compile(r"入口\s*[:：]\s*(.*)"),
    "pt": re.compile(r"Entrada\s*[:：]\s*(.*)"),
    "en": re.compile(r"Entrance\s*[:：]\s*(.*)"),
}
EXIT_RE = {
    "zh": re.compile(r"出口\s*[:：]\s*(.*)"),
    "pt": re.compile(r"Sa[íi]da\s*[:：]\s*(.*)"),
    "en": re.compile(r"Exit\s*[:：]\s*(.*)"),
}
# 路環石面盆古道 publishes "長度: 約1,375米" (about 1,375 m); the number is kept.
LENGTH_RE = re.compile(r"長度\s*[:：]\s*約?\s*([\d,]+)\s*米")

TRANSFORMER = Transformer.from_crs("EPSG:8433", "EPSG:4326", always_xy=True)

# Reference query for the mandatory OSM cross-check (contract wording, verbatim
# clause — no name-regex fallback added, unlike the broader osm/q2-ways.ql
# prototype this was developed against).
REFERENCE_WAYS_QUERY = """[out:json][timeout:180];
area(3601867188)->.mo;
way["highway"~"^(path|footway|track|steps|cycleway|pedestrian|bridleway)$"](area.mo);
out geom;"""

ROUTE_RELATIONS_QUERY = """[out:json][timeout:180];
area(3601867188)->.mo;
relation["type"="route"]["route"~"^(hiking|foot|walking|bicycle)$"](area.mo);
out tags;"""

NAMED_WAYS_QUERY = """[out:json][timeout:180];
area(3601867188)->.mo;
way["highway"~"^(path|footway|track|steps|pedestrian|bridleway|cycleway)$"]["name"](area.mo);
out geom;"""

LAT0 = 22.15  # local equirectangular projection origin for the cross-check
R_EARTH = 6371008.8


# ----------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------
def clean(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def normalize_name(s: object) -> str:
    s = re.sub(r"\s+", "", str(s or ""))
    return s.replace("（", "(").replace("）", ")")


def today_macau_ymd() -> str:
    return datetime.now(tz=MACAU_TZ).strftime("%Y-%m-%d")


def in_bbox(lng: float, lat: float) -> bool:
    return LNG_MIN <= lng <= LNG_MAX and LAT_MIN <= lat <= LAT_MAX


def extract_field(addr: str, pattern: re.Pattern) -> str:
    m = pattern.search(addr or "")
    return clean(m.group(1)) if m else ""


def parse_length_m(addr_zh: str) -> int | None:
    m = LENGTH_RE.search(addr_zh or "")
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def build_suspensions(start_raw: object, end_raw: object) -> list[dict]:
    start = clean(start_raw)[:10]
    end = clean(end_raw)[:10]
    if not (start and end and YMD_RE.match(start) and YMD_RE.match(end)):
        return []
    return [{"from": start, "to": end}]


def parse_entrances(raw: object) -> list[list[float]]:
    out = []
    for chunk in str(raw or "").split("|"):
        parts = [p.strip() for p in chunk.strip().split(",")]
        if len(parts) != 2:
            continue
        try:
            lat, lng = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        if in_bbox(lng, lat):
            out.append([round(lng, 6), round(lat, 6)])
    return out


def area_from_text(raw: object) -> str:
    s = str(raw or "")
    if "路環" in s:
        return "coloane"
    if "氹仔" in s:
        return "taipa"
    return "peninsula"


# ----------------------------------------------------------------------------
# EPSG:8433 (Macau Grid) -> EPSG:4326, self-checked
# ----------------------------------------------------------------------------
def assert_macau_grid_transform() -> None:
    """DSSCU worked example: Macau Grid (20800.082, 18145.042) -> 113°32'50" E,
    22°11'40" N, within 1 m. Fails the run (not just a warning) if pyproj's
    resolved EPSG:8433 definition ever drifts from this."""
    lng, lat = TRANSFORMER.transform(20800.082, 18145.042)
    exp_lng = 113 + 32 / 60 + 50 / 3600
    exp_lat = 22 + 11 / 60 + 40 / 3600
    d_lat_m = abs(lat - exp_lat) * 111_320.0
    d_lng_m = abs(lng - exp_lng) * 111_320.0 * math.cos(math.radians(exp_lat))
    off_m = math.hypot(d_lat_m, d_lng_m)
    if off_m > 1.0:
        raise RuntimeError(
            f"EPSG:8433->4326 self-check failed: got ({lng:.7f},{lat:.7f}), "
            f"expected ~({exp_lng:.7f},{exp_lat:.7f}), off by {off_m:.2f} m"
        )
    print(f"  EPSG:8433->4326 self-check OK (off by {off_m * 1000:.1f} mm)")


def convert_xy(x: float, y: float) -> list[float]:
    lng, lat = TRANSFORMER.transform(x, y)
    return [round(lng, 6), round(lat, 6)]


def geodesic_length_m(lines: list[list[list[float]]]) -> float:
    total = 0.0
    for line in lines:
        for (lng1, lat1), (lng2, lat2) in zip(line, line[1:]):
            p1, p2 = math.radians(lat1), math.radians(lat2)
            dphi = math.radians(lat2 - lat1)
            dlmb = math.radians(lng2 - lng1)
            a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
            total += 2 * R_EARTH * math.asin(min(1.0, math.sqrt(a)))
    return total


# ----------------------------------------------------------------------------
# IAM nature BigJson
# ----------------------------------------------------------------------------
def fetch_nature(lang: str) -> list[dict]:
    url = NATURE_URL.format(lang=lang)
    last = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            r = requests.get(url, headers=NATURE_HEADERS, timeout=TIMEOUT)
            if r.status_code == 200:
                body = r.json()
                data = body.get("data") if isinstance(body, dict) else None
                if isinstance(data, list):
                    return data
                last = f"unexpected JSON shape: {type(body).__name__}"
            else:
                last = f"HTTP {r.status_code}"
        except (requests.RequestException, ValueError) as e:
            last = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} for nature/{lang} failed ({last}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"IAM nature fetch {lang} failed after {MAX_ATTEMPTS} attempts: {last}")


# ----------------------------------------------------------------------------
# DSAT/DSSCU GIS (ArcGIS REST, native Macau Grid)
# ----------------------------------------------------------------------------
def gis_query(service: str, layer: int) -> list[dict]:
    url = f"{GIS_BASE}{service}/MapServer/{layer}/query"
    last = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            r = requests.get(url, params={"where": "1=1", "outFields": "*", "f": "json"}, headers=NATURE_HEADERS, timeout=60)
            if r.status_code == 200:
                body = r.json()
                if isinstance(body, dict) and "error" in body:
                    last = f"ArcGIS error: {body['error']}"
                else:
                    feats = body.get("features") if isinstance(body, dict) else None
                    if isinstance(feats, list):
                        return feats
                    last = "response has no 'features' list"
            else:
                last = f"HTTP {r.status_code}"
        except (requests.RequestException, ValueError) as e:
            last = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} for GIS {service}/{layer} failed ({last}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"GIS {service}/{layer} query failed after {MAX_ATTEMPTS} attempts: {last}")


def build_lane_index(features: list[dict]) -> tuple[dict[str, dict], dict[str, dict]]:
    by_id: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    for f in features:
        attrs = f["attributes"]
        m = HYLINK_UUID_RE.search(attrs.get("HYLINK") or "")
        entry = {"attrs": attrs, "geometry": f["geometry"]}
        if m:
            by_id[m.group(1).lower()] = entry
        name_norm = normalize_name(attrs.get("CNAME"))
        if name_norm:
            by_name.setdefault(name_norm, entry)
    return by_id, by_name


def build_class_prefix_map(post_features: list[dict]) -> dict[str, str]:
    by_class: dict[str, set[str]] = {}
    for f in post_features:
        attrs = f["attributes"]
        fid = attrs.get("FID_1") or ""
        cls = attrs.get("Class")
        m = POST_PREFIX_RE.match(fid)
        if cls and m:
            by_class.setdefault(cls, set()).add(m.group(1))
    result: dict[str, str] = {}
    for cls, prefixes in by_class.items():
        if len(prefixes) == 1:
            result[cls] = next(iter(prefixes))
        else:
            print(f"  WARNING: Class {cls} has ambiguous post-code prefixes {sorted(prefixes)}; code left unset", file=sys.stderr)
    return result


def lane_lines(geometry: dict) -> list[list[list[float]]]:
    lines: list[list[list[float]]] = []
    for path in geometry.get("paths") or []:
        pts = [convert_xy(x, y) for x, y in path]
        dedup = pts[:1]
        for p in pts[1:]:
            if p != dedup[-1]:
                dedup.append(p)
        if len(dedup) >= 2:
            lines.append(dedup)
    return lines


def build_posts(features: list[dict]) -> list[dict]:
    posts = []
    for f in features:
        code = f["attributes"].get("FID_1")
        geom = f["geometry"]
        posts.append({"code": code, "trail": code[:4] if code else None, "coordinates": convert_xy(geom["x"], geom["y"])})
    posts.sort(key=lambda p: p["code"] or "")
    return posts


def build_pavilions(features: list[dict]) -> list[dict]:
    pavilions = []
    for f in features:
        name = f["attributes"].get("CNAME")
        name = None if (not name or name == "*") else name
        geom = f["geometry"]
        pavilions.append({"name": name, "coordinates": convert_xy(geom["x"], geom["y"])})
    pavilions.sort(key=lambda p: (p["name"] is None, p["name"] or "", p["coordinates"]))
    return pavilions


# ----------------------------------------------------------------------------
# OSM: mandatory cross-check + fallback geometry
# ----------------------------------------------------------------------------
def overpass_raw(query: str, attempts: int = 8) -> dict:
    """Like osm_footprints.overpass, but returns the full response envelope
    (elements + osm3s) instead of just `elements` — needed here for the
    cross-check's `osmCheck.osmBase` timestamp. Deliberately not cached (the
    reference-ways query is only ever run once per invocation)."""
    last = "no attempts made"
    endpoint_i = 0
    same_host_failures = 0
    for i in range(attempts):
        url = OVERPASS_ENDPOINTS[endpoint_i % len(OVERPASS_ENDPOINTS)]
        try:
            r = requests.post(url, data={"data": query}, headers=OSM_HEADERS, timeout=(20, 180))
            if r.status_code == 200:
                time.sleep(2)
                return r.json()
            last = f"HTTP {r.status_code} from {url}"
            if r.status_code == 429:
                same_host_failures += 1
            else:
                endpoint_i += 1
                same_host_failures = 0
        except (requests.RequestException, ValueError) as e:
            last = f"{type(e).__name__} from {url}: {str(e)[:120]}"
            endpoint_i += 1
            same_host_failures = 0
        delay = min(5 * (2**same_host_failures), 60)
        print(f"  overpass attempt {i + 1} failed ({last}); retrying in {delay}s", file=sys.stderr)
        time.sleep(delay)
    raise RuntimeError(f"Overpass failed: {last}")


def to_xy(lng: float, lat: float) -> tuple[float, float]:
    x = math.radians(lng) * R_EARTH * math.cos(math.radians(LAT0))
    y = math.radians(lat) * R_EARTH
    return x, y


def point_seg_dist(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def sample_line_every_10m(line_xy: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for a, b in zip(line_xy, line_xy[1:]):
        seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, math.ceil(seg_len / 10.0))
        for k in range(n):
            t = k / n
            pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    if line_xy:
        pts.append(line_xy[-1])
    return pts


def percentile(sorted_vals: list[float], frac: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(len(sorted_vals) - 1, int(frac * len(sorted_vals)))
    return sorted_vals[idx]


class ReferenceIndex:
    """Nearest-segment lookup over the mandatory OSM reference-way network,
    for the per-trail cross-check. Exact for the k nearest candidates by
    midpoint (k=12), not for every segment — fine at this tolerance (10-30 m
    limits) and matches the same approximate-nearest-neighbour spirit as the
    JS crosscheck.mjs prototype's expanding grid-ring search."""

    def __init__(self, ref_ways: list[dict]):
        self.segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
        for w in ref_ways:
            if w.get("type") != "way":
                continue
            pts = [to_xy(p["lon"], p["lat"]) for p in (w.get("geometry") or []) if p.get("lat") is not None]
            self.segments.extend(zip(pts, pts[1:]))
        mids = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in self.segments]
        self.tree = cKDTree(mids) if mids else None

    def nearest(self, p: tuple[float, float], k: int = 12) -> float:
        if self.tree is None:
            return float("inf")
        k = min(k, len(self.segments))
        _, idxs = self.tree.query(p, k=k)
        idxs = [idxs] if k == 1 else list(idxs)
        return min(point_seg_dist(p, *self.segments[i]) for i in idxs)


def crosscheck_trail(lines: list[list[list[float]]], ref_index: ReferenceIndex) -> dict:
    samples: list[tuple[float, float]] = []
    for line in lines:
        samples.extend(sample_line_every_10m([to_xy(lng, lat) for lng, lat in line]))
    dists = sorted(ref_index.nearest(p) for p in samples)
    n = len(dists)
    within15 = round(100.0 * sum(1 for d in dists if d <= 15.0) / n) if n else 100
    return {"medianM": round(percentile(dists, 0.5), 1), "p90M": round(percentile(dists, 0.9), 1), "within15Pct": within15}


def fetch_route_relations() -> list[dict]:
    return overpass(ROUTE_RELATIONS_QUERY)


def find_matching_relation(relations: list[dict], code: str | None, name_zh: str) -> dict | None:
    if code:
        for rel in relations:
            if (rel.get("tags") or {}).get("ref") == code:
                return rel
    name_norm = normalize_name(name_zh)
    for rel in relations:
        tags = rel.get("tags") or {}
        for key in ("name", "name:zh", "name:zh-Hant"):
            if tags.get(key) and normalize_name(tags[key]) == name_norm:
                return rel
    return None


def fetch_relation_ways(rel_id: int) -> list[dict]:
    return overpass(f"[out:json][timeout:120];relation({rel_id});way(r);out geom;")


_named_ways_cache: list[dict] | None = None


def fetch_named_ways() -> list[dict]:
    global _named_ways_cache
    if _named_ways_cache is None:
        _named_ways_cache = overpass(NAMED_WAYS_QUERY)
    return _named_ways_cache


def ways_to_lines(ways: list[dict]) -> list[list[list[float]]]:
    lines = []
    for w in ways:
        if w.get("type") != "way":
            continue
        pts = [[round(p["lon"], 6), round(p["lat"], 6)] for p in (w.get("geometry") or []) if p.get("lat") is not None]
        if len(pts) >= 2:
            lines.append(pts)
    return lines


def osm_fallback_geometry(
    code: str | None, name_zh: str, relations: list[dict]
) -> tuple[list[list[list[float]]] | None, list[str] | None, str | None]:
    """Geometry precedence step 2/3: a matching route relation's member ways,
    else standalone named highway ways. Returns (lines, osmIds, resolved_code)
    or (None, None, code) when nothing usable was found (caller hard-errors)."""
    rel = find_matching_relation(relations, code, name_zh)
    if rel is not None:
        lines = ways_to_lines(fetch_relation_ways(rel["id"]))
        if lines:
            resolved_code = code
            ref = (rel.get("tags") or {}).get("ref")
            if resolved_code is None and ref and CODE_RE.match(ref):
                resolved_code = ref
            return lines, [f"r{rel['id']}"], resolved_code

    name_norm = normalize_name(name_zh)
    matched_ids, lines = [], []
    for w in fetch_named_ways():
        if w.get("type") != "way":
            continue
        tags = w.get("tags") or {}
        if any(tags.get(k) and normalize_name(tags[k]) == name_norm for k in ("name", "name:zh")):
            pts = [[round(p["lon"], 6), round(p["lat"], 6)] for p in (w.get("geometry") or []) if p.get("lat") is not None]
            if len(pts) >= 2:
                lines.append(pts)
                matched_ids.append(f"w{w['id']}")
    if lines:
        return lines, sorted(matched_ids), code
    return None, None, code


# ----------------------------------------------------------------------------
# summits (山頂) and the 好漢坡 climb
# ----------------------------------------------------------------------------
# `geo7` is the field of DSSCU's hills table that carries the same height.
SUMMITS = [
    {"id": "coloane-alto", "geo7": "coloaneAlto_altitude", "heightM": 170.6, "trig": "A31", "M": 22253.3, "P": 9981.0,
     "name": {"zh": "疊石塘山", "pt": "Coloane Alto", "en": "Coloane Alto"}},
    {"id": "taipa-grande", "geo7": "grande_altitude", "heightM": 158.2, "trig": "A21", "M": 22727.7, "P": 14193.9,
     "name": {"zh": "大潭山", "pt": "Taipa Grande", "en": "Taipa Grande"}},
    # DSSCU's name; IAM's trail texts call it 中央山.
    {"id": "ponto-central", "geo7": "pontoCentral_altitude", "heightM": 136.2, "trig": "A33", "M": 23150.0, "P": 10836.8,
     "name": {"zh": "路環中間（中央山）", "pt": "Ponto Central", "en": "Ponto Central"}},
    {"id": "morro-artilharia", "geo7": "morro_altitude", "heightM": 120.0, "trig": "AB32", "M": 21612.9, "P": 9078.4,
     "name": {"zh": "礮臺山", "pt": "Morro de Artilharia", "en": "Morro de Artilharia"}},
    {"id": "taipa-pequena", "geo7": "pequena_altitude", "heightM": 110.4, "trig": "A22", "M": 20760.3, "P": 14437.4,
     "name": {"zh": "小潭山", "pt": "Taipa Pequena", "en": "Taipa Pequena"}},
    # The pillar stands on the Guia lighthouse lookout.
    {"id": "guia", "geo7": "guia_altitude", "heightM": 90.0, "trig": "AB07", "M": 21026.8, "P": 18367.3,
     "name": {"zh": "東望洋山（松山）", "pt": "Colina da Guia", "en": "Colina da Guia"}},
    # The pillar stands in the Mong Há fort, the hill's highest point.
    {"id": "mong-ha", "geo7": "mongHa_altitude", "heightM": 60.7, "trig": "AB14", "M": 20829.5, "P": 19622.2,
     "name": {"zh": "望廈山", "pt": "Colina de Mong Há", "en": "Colina de Mong Há"}},
]
GEO7_URL = "https://geomatics.dsscu.gov.mo/files/geo_statistic_json/geo7.json"
DSEC_HEIGHTS_URL = "https://www.dsec.gov.mo/getAttachment/a774d773-9696-48c1-b8a7-21efd4dcd1fb/E_AMB_PUB_2011_Y.aspx"
TRIG_LIST_URL = "https://geomatics.dsscu.gov.mo/zh-hant/tripoints1.html"
REACH_M = 30
NEAR_M = 150

# Climbs to the summits a walking trail only passes (the user's request of
# 2026-09-27: "fill in every climb"): the shortest OSM footpath (no roads) from
# a node within CLIMB_SOURCE_M of such a trail to the reachable node nearest
# the pillar, if that is within CLIMB_TARGET_M and the path within
# CLIMB_MAX_M. A climb that stops short of REACH_M says how far short.
FOOT_HIGHWAYS = "footway|path|steps|pedestrian|track"
CLIMB_SOURCE_M = 15
CLIMB_TARGET_M = 60
CLIMB_MAX_M = 600
CLIMB_SEARCH_M = 700

# 好漢坡 (True Man Slope): steps w264076934 from the junction, the top of the
# summit-park road w264076936, the flight w264076937 and the path w264076938
# that ends beside the pillar.
HOU_HON_PO = {
    "id": "hou-hon-po",
    "summit": "coloane-alto",
    "ways": [264076934, 264076936, 264076937, 264076938],
    "fromWay": 264076934,
    "toWay": 264076938,
}


def summit_height_diffs() -> list[str]:
    """Differences between SUMMITS and DSSCU's live hills table. An
    unreachable table is not a difference: the survey heights are fixed."""
    try:
        r = requests.get(GEO7_URL, headers=NATURE_HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        row = r.json()["body"]["content"][0]
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as e:
        print(f"  WARNING: DSSCU hills table unavailable ({e}); keeping the listed heights", file=sys.stderr)
        return []
    diffs = []
    for s in SUMMITS:
        try:
            live = float(row[s["geo7"]])
        except (KeyError, TypeError, ValueError):
            diffs.append(f"{s['name']['zh']}: DSSCU table has no {s['geo7']}")
            continue
        if abs(live - s["heightM"]) > 0.05:
            diffs.append(f"{s['name']['zh']}: listed {s['heightM']} m, DSSCU now {live} m")
    return diffs


def fetch_spur(spec: dict) -> dict:
    """The climb as one line: shortest path over the ways' shared nodes from
    the first node of `fromWay` to the last node of `toWay`."""
    ids = ",".join(str(w) for w in spec["ways"])
    resp = overpass_raw(f"[out:json][timeout:60];way(id:{ids});out body geom;")
    ways = {w["id"]: w for w in resp.get("elements") or [] if w.get("type") == "way"}
    missing = [w for w in spec["ways"] if w not in ways]
    if missing:
        raise RuntimeError(f"{spec['id']}: OSM ways missing {missing}")
    coord: dict[int, list[float]] = {}
    adj: dict[int, list[tuple[int, float]]] = {}
    for w in ways.values():
        nodes, geom = w.get("nodes") or [], w.get("geometry") or []
        for nid, g in zip(nodes, geom):
            coord[nid] = [round(g["lon"], 6), round(g["lat"], 6)]
        for a, b in zip(nodes, nodes[1:]):
            d = math.dist(to_xy(*coord[a]), to_xy(*coord[b]))
            adj.setdefault(a, []).append((b, d))
            adj.setdefault(b, []).append((a, d))
    start = ways[spec["fromWay"]]["nodes"][0]
    goal = ways[spec["toWay"]]["nodes"][-1]
    dist, prev, heap = {start: 0.0}, {}, [(0.0, start)]
    while heap:
        d, n = heapq.heappop(heap)
        if n == goal:
            break
        if d > dist.get(n, math.inf):
            continue
        for m, w in adj.get(n, []):
            if d + w < dist.get(m, math.inf):
                dist[m], prev[m] = d + w, n
                heapq.heappush(heap, (d + w, m))
    if goal not in dist:
        raise RuntimeError(f"{spec['id']}: the OSM ways no longer connect")
    path = [goal]
    while path[-1] != start:
        path.append(prev[path[-1]])
    path.reverse()
    tags = ways[spec["fromWay"]].get("tags") or {}
    name_zh = tags.get("name:zh") or clean(tags.get("name"))
    return {
        "id": spec["id"],
        "name": {"zh": name_zh, "pt": tags.get("name:pt", ""), "en": tags.get("name:en", "")},
        "summit": spec["summit"],
        "trails": [],
        "osmIds": [f"w{w}" for w in spec["ways"]],
        "lines": [[coord[n] for n in path]],
    }


def find_climbs(trails: list[dict], explicit: list[dict]) -> list[dict]:
    """A climb for each summit that walking trails only pass within NEAR_M
    (none within REACH_M) and that no explicit spur already serves."""
    walk = [t for t in trails if t["kind"] == "walk"]
    covered = {sp["summit"] for sp in explicit}
    climbs = []
    for s in SUMMITS:
        if s["id"] in covered:
            continue
        at = convert_xy(s["M"], s["P"])
        dists = {t["id"]: lines_dist_m(at, t["geometry"]["lines"]) for t in walk}
        near = [t for t in walk if dists[t["id"]] <= NEAR_M]
        if not near or min(dists[t["id"]] for t in near) <= REACH_M:
            continue
        query = (f'[out:json][timeout:60];way["highway"~"^({FOOT_HIGHWAYS})$"]'
                 f"(around:{CLIMB_SEARCH_M},{at[1]},{at[0]});out body geom;")
        ways = [w for w in overpass_raw(query).get("elements") or [] if w.get("type") == "way"]
        coord: dict[int, list[float]] = {}
        adj: dict[int, list[tuple[int, float, int]]] = {}
        for w in ways:
            nodes, geom = w.get("nodes") or [], w.get("geometry") or []
            for nid, g in zip(nodes, geom):
                coord[nid] = [round(g["lon"], 6), round(g["lat"], 6)]
            for a, b in zip(nodes, nodes[1:]):
                d = math.dist(to_xy(*coord[a]), to_xy(*coord[b]))
                adj.setdefault(a, []).append((b, d, w["id"]))
                adj.setdefault(b, []).append((a, d, w["id"]))
        sources = [n for n, c in coord.items() if any(lines_dist_m(c, t["geometry"]["lines"]) <= CLIMB_SOURCE_M for t in near)]
        dist = {n: 0.0 for n in sources}
        prev: dict[int, tuple[int, int]] = {}
        heap = [(0.0, n) for n in sources]
        heapq.heapify(heap)
        while heap:
            d, n = heapq.heappop(heap)
            if d > dist.get(n, math.inf) or d > CLIMB_MAX_M:
                continue
            for m, w, wid in adj.get(n, []):
                if d + w < dist.get(m, math.inf):
                    dist[m], prev[m] = d + w, (n, wid)
                    heapq.heappush(heap, (d + w, m))
        # The end is the point on a reachable path SEGMENT nearest the pillar,
        # not the nearest node: footpath nodes are sparse, and a path that
        # passes 20 m from the top can have its nearest node 40 m away.
        pillar = to_xy(*at)
        best: tuple[tuple[int, float], int, tuple[float, float], int | None] | None = None
        for n in dist:
            if dist[n] > CLIMB_MAX_M:
                continue
            a = to_xy(*coord[n])
            candidates = [(a, None)]
            for m, _, wid in adj.get(n, []):
                b = to_xy(*coord[m])
                dx, dy = b[0] - a[0], b[1] - a[1]
                l2 = dx * dx + dy * dy
                t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((pillar[0] - a[0]) * dx + (pillar[1] - a[1]) * dy) / l2))
                candidates.append(((a[0] + t * dx, a[1] + t * dy), wid))
            for q, wid in candidates:
                r = math.dist(q, pillar)
                cost = dist[n] + math.dist(a, q)
                key = (round(r), cost)
                if r <= CLIMB_TARGET_M and cost <= CLIMB_MAX_M and (best is None or key < best[0]):
                    best = (key, n, q, wid)
        if best is None:
            print(f"  WARNING: no OSM footpath climbs within {CLIMB_TARGET_M} m of {s['name']['zh']}", file=sys.stderr)
            continue
        _, goal, end_xy, end_way = best
        path, used = [goal], []
        while path[-1] in prev:
            n, wid = prev[path[-1]]
            path.append(n)
            used.append(wid)
        path.reverse()
        coords = [coord[n] for n in path]
        if math.dist(end_xy, to_xy(*coords[-1])) > .5:
            coords.append(from_xy(*end_xy))
            if end_way is not None:
                used.insert(0, end_way)
        if len(coords) < 2:
            continue
        osm_ids: list[str] = []
        for wid in reversed(used):
            if f"w{wid}" not in osm_ids:
                osm_ids.append(f"w{wid}")
        # The zh name without its bracketed alias: 路環中間（中央山） -> 路環中間登頂路.
        zh = re.sub(r"（.*?）", "", s["name"]["zh"])
        pt, en = s["name"]["pt"], s["name"]["en"]
        climbs.append({
            "id": f"{s['id']}-climb",
            "name": {"zh": f"{zh}登頂路", "pt": f"Caminho até ao cume ({pt})", "en": f"Path to the summit ({en})"},
            "summit": s["id"],
            "trails": [],
            "osmIds": osm_ids,
            "lines": [coords],
        })
    return climbs


def from_xy(x: float, y: float) -> list[float]:
    """Inverse of to_xy."""
    return [round(math.degrees(x / (R_EARTH * math.cos(math.radians(LAT0)))), 6), round(math.degrees(y / R_EARTH), 6)]


def nearest_on_lines(pt: list[float], lines: list[list[list[float]]]) -> tuple[float, list[float] | None]:
    """Distance from `pt` to the nearest point on `lines`, and that point."""
    p = to_xy(*pt)
    best_d, best_q = math.inf, None
    for line in lines:
        xy = [to_xy(*c) for c in line]
        for a, b in zip(xy, xy[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            l2 = dx * dx + dy * dy
            t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
            q = (a[0] + t * dx, a[1] + t * dy)
            d = math.dist(p, q)
            if d < best_d:
                best_d, best_q = d, q
    return best_d, (from_xy(*best_q) if best_q else None)


def join_to_trail(spur: dict, trails: list[dict]) -> None:
    """Start a climb ON the walking-trail line it leaves from. The GIS trail
    lines and the OSM footpaths are separate drawings, so the path's first
    node can sit metres off the line; a straight join closes that gap."""
    start = spur["lines"][0][0]
    options = [nearest_on_lines(start, t["geometry"]["lines"]) for t in trails if t["kind"] == "walk"]
    d, q = min(options, key=lambda o: o[0], default=(math.inf, None))
    if q is not None and .5 < d <= REACH_M:
        spur["lines"][0].insert(0, q)


def lines_dist_m(pt: list[float], lines: list[list[list[float]]]) -> float:
    p = to_xy(*pt)
    best = math.inf
    for line in lines:
        xy = [to_xy(*c) for c in line]
        for a, b in zip(xy, xy[1:]):
            best = min(best, point_seg_dist(p, a, b))
    return best


def build_summits(trails: list[dict], spurs: list[dict]) -> list[dict]:
    """Each summit with its access from every walking trail within NEAR_M;
    also fills each spur's `trails` (the walking trails it starts on)."""
    walk = [t for t in trails if t["kind"] == "walk"]
    order = {"trail": 0, "spur": 1, "near": 2}
    out = []
    for s in SUMMITS:
        at = convert_xy(s["M"], s["P"])
        access: dict[str, dict] = {}
        for t in walk:
            d = lines_dist_m(at, t["geometry"]["lines"])
            if d <= NEAR_M:
                access[t["id"]] = {"trail": t["id"], "via": "trail" if d <= REACH_M else "near", "distanceM": round(d)}
        for sp in spurs:
            if sp["summit"] != s["id"]:
                continue
            end_d = math.dist(to_xy(*at), to_xy(*sp["lines"][-1][-1]))
            if end_d > CLIMB_TARGET_M:
                raise RuntimeError(f"{sp['id']} ends {end_d:.0f} m from {s['name']['zh']}'s pillar")
            for t in walk:
                if lines_dist_m(sp["lines"][0][0], t["geometry"]["lines"]) <= REACH_M:
                    sp["trails"].append(t["id"])
                    if access.get(t["id"], {}).get("via") != "trail":
                        access[t["id"]] = {"trail": t["id"], "via": "spur", "distanceM": round(end_d)}
            if not sp["trails"]:
                raise RuntimeError(f"{sp['id']} starts on no walking trail")
        if not access:
            raise RuntimeError(f"no walking trail within {NEAR_M} m of {s['name']['zh']}")
        out.append({
            "id": s["id"],
            "name": s["name"],
            "heightM": s["heightM"],
            "coordinates": at,
            "trig": s["trig"],
            "access": sorted(access.values(), key=lambda a: (order[a["via"]], a["distanceM"])),
        })
    return out


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def run() -> int:
    print("Fetching TRAILS overlay (IAM nature + data.gov.mo venues + DSAT/DSSCU GIS + mandatory OSM cross-check)")

    assert_macau_grid_transform()

    print("Fetching IAM nature facility JSON (zh/pt/en)")
    nature_c = fetch_nature("c")
    nature_p_by_id = {r["id"]: r for r in fetch_nature("p")}
    nature_e_by_id = {r["id"]: r for r in fetch_nature("e")}
    trails_c = [r for r in nature_c if r.get("category") == "trails"]
    print(f"  {len(nature_c)} nature facilities, {len(trails_c)} category=trails")

    print("Fetching data.gov.mo 市政活動場地 (venues)")
    try:
        muni_records, muni_readme = read_dataset(MUNI_ID)
    except (RuntimeError, zipfile.BadZipFile, json.JSONDecodeError, StopIteration) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    muni_by_name = {normalize_name(m.get("nameZh")): m for m in muni_records}

    print("Fetching GIS Walk_Trail_lane / Walk_Trail_point layers")
    try:
        lane_features = gis_query("Walk_Trail_lane", 0)
        post_features = gis_query("Walk_Trail_point", 4)
        pavilion_features = gis_query("Walk_Trail_point", 0)
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    if not lane_features or not post_features or not pavilion_features:
        print("ERROR: a GIS layer returned zero features — total outage, refusing to write", file=sys.stderr)
        return 1
    print(f"  lane={len(lane_features)} post={len(post_features)} pavilion={len(pavilion_features)}")

    simulate_missing = {normalize_name(n) for n in os.environ.get("TRAILS_SIMULATE_GIS_MISSING", "").split(",") if n.strip()}
    if simulate_missing:
        before = len(lane_features)
        lane_features = [f for f in lane_features if normalize_name(f["attributes"].get("CNAME")) not in simulate_missing]
        print(f"  TRAILS_SIMULATE_GIS_MISSING active: dropped {before - len(lane_features)} lane feature(s) for testing")

    lane_by_id, lane_by_name = build_lane_index(lane_features)
    class_prefix = build_class_prefix_map(post_features)
    area_by_locid = {1: "peninsula", 2: "taipa", 3: "coloane"}

    print("Fetching OSM reference ways (mandatory cross-check) + route relations")
    ref_response = overpass_raw(REFERENCE_WAYS_QUERY)
    ref_ways = ref_response.get("elements") or []
    osm_base = (ref_response.get("osm3s") or {}).get("timestamp_osm_base")
    if not ref_ways or not osm_base:
        print("ERROR: OSM reference-ways query returned no usable data", file=sys.stderr)
        return 1
    print(f"  {len(ref_ways)} reference ways, osm3s base {osm_base}")
    ref_index = ReferenceIndex(ref_ways)
    route_relations = fetch_route_relations()
    print(f"  {len(route_relations)} candidate route relations")

    trails: list[dict] = []
    needs_osm: list[tuple[dict, str]] = []

    for rec in trails_c:
        tid = rec["id"]
        name_zh_nature = clean(rec.get("name"))
        muni = muni_by_name.get(normalize_name(name_zh_nature))
        p_rec = nature_p_by_id.get(tid, {})
        e_rec = nature_e_by_id.get(tid, {})

        name_zh = (clean(muni.get("nameZh")) if muni else "") or name_zh_nature
        name = {
            "zh": name_zh,
            "pt": (clean(muni.get("namePt")) if muni else "") or clean(p_rec.get("name")),
            "en": (clean(muni.get("nameEn")) if muni else "") or clean(e_rec.get("name")),
        }

        addr_zh = (muni.get("addressZh") if muni else None) or rec.get("address") or ""
        addr_pt = (muni.get("addressPt") if muni else None) or p_rec.get("address") or ""
        addr_en = (muni.get("addressEn") if muni else None) or e_rec.get("address") or ""
        entrance = {
            "zh": extract_field(addr_zh, ENTRANCE_RE["zh"]),
            "pt": extract_field(addr_pt, ENTRANCE_RE["pt"]),
            "en": extract_field(addr_en, ENTRANCE_RE["en"]),
        }
        exit_ = {
            "zh": extract_field(addr_zh, EXIT_RE["zh"]),
            "pt": extract_field(addr_pt, EXIT_RE["pt"]),
            "en": extract_field(addr_en, EXIT_RE["en"]),
        }
        open_hours = {
            "zh": (clean(muni.get("openHourZh")) if muni else "") or clean(rec.get("openHours")),
            "pt": (clean(muni.get("openHourPt")) if muni else "") or clean(p_rec.get("openHours")),
            "en": (clean(muni.get("openHourEn")) if muni else "") or clean(e_rec.get("openHours")),
        }
        phone = (clean(muni.get("telZh")) if muni else "") or clean(rec.get("contactTel")) or None
        length_m = parse_length_m(addr_zh)
        closed = bool(muni.get("tempClose")) if muni else False
        suspensions = build_suspensions(rec.get("suspendStartDate"), rec.get("suspendEndDate"))
        # Always a string (never null) — one upstream record (氹仔海濱休憩區(單車徑))
        # genuinely carries "" here, which is a valid (if unhelpful) value, not a
        # missing one.
        web_link = clean(rec.get("webLink"))

        entrances = parse_entrances(rec.get("easygoEntranceCoordinate"))
        if not entrances:
            fallback_loc = parse_location(muni.get("location")) if muni else None
            if fallback_loc is None:
                fallback_loc = parse_location(rec.get("mapLink"))
            if fallback_loc:
                entrances = [fallback_loc]
        if not entrances:
            print(f"  WARNING: '{name_zh}' has no usable entrance coordinate; skipping trail", file=sys.stderr)
            continue

        kind = "cycle" if "單車" in name_zh else "walk"
        lane = lane_by_id.get(tid) or lane_by_name.get(normalize_name(name_zh_nature))

        lines: list[list[list[float]]] | None = None
        area: str
        code: str | None
        if lane is not None:
            attrs = lane["attrs"]
            area = area_by_locid.get(attrs.get("LOCATIONID")) or area_from_text(rec.get("area"))
            code = class_prefix.get(attrs.get("Class"))
            lines = lane_lines(lane["geometry"])
            if not lines:
                print(f"  WARNING: GIS line for '{name_zh}' converted to zero usable lines; falling back to OSM", file=sys.stderr)
                lane = None
        if lane is None:
            area = area_from_text(rec.get("area"))
            code = None

        trail = {
            "id": tid,
            "code": code,
            "kind": kind,
            "area": area,
            "name": name,
            "entrance": entrance,
            "exit": exit_,
            "openHours": open_hours,
            "phone": phone,
            "lengthM": length_m,
            "drawnLengthM": 0,
            "closed": closed,
            "suspensions": suspensions,
            "entrances": entrances,
            "webLink": web_link,
            "geometry": None,
            "osmCheck": None,
        }

        if lane is not None and lines:
            trail["geometry"] = {"source": "gis", "retrievedAt": today_macau_ymd(), "osmIds": None, "lines": lines}
            trail["drawnLengthM"] = round(geodesic_length_m(lines))
            trail["osmCheck"] = crosscheck_trail(lines, ref_index)
            trails.append(trail)
        else:
            needs_osm.append((trail, name_zh_nature))
            trails.append(trail)

    for trail, name_zh_nature in needs_osm:
        lines, osm_ids, resolved_code = osm_fallback_geometry(trail["code"], name_zh_nature, route_relations)
        if lines is None:
            print(f"ERROR: no GIS line and no OSM fallback found for '{name_zh_nature}' — refusing to write", file=sys.stderr)
            return 1
        trail["code"] = resolved_code
        trail["geometry"] = {"source": "osm", "retrievedAt": today_macau_ymd(), "osmIds": osm_ids, "lines": lines}
        trail["drawnLengthM"] = round(geodesic_length_m(lines))
        trail["osmCheck"] = None
        print(f"  OSM fallback for '{name_zh_nature}': {osm_ids} drawnLengthM={trail['drawnLengthM']} (published {trail['lengthM']})")

    over_limit = [
        (t["name"]["zh"], t["osmCheck"])
        for t in trails
        if t["geometry"]["source"] == "gis" and (t["osmCheck"]["medianM"] > MEDIAN_LIMIT_M or t["osmCheck"]["p90M"] > P90_LIMIT_M)
    ]
    if over_limit:
        for name, check in over_limit:
            print(f"ERROR: OSM cross-check exceeded limits for '{name}': {check}", file=sys.stderr)
        return 1

    if len(trails) < MIN_TRAILS:
        print(f"ERROR: only {len(trails)} usable trails (< {MIN_TRAILS}) — refusing to write", file=sys.stderr)
        return 1

    posts = build_posts(post_features)
    pavilions = build_pavilions(pavilion_features)
    if len(posts) < MIN_POSTS:
        print(f"ERROR: only {len(posts)} usable posts (< {MIN_POSTS}) — refusing to write", file=sys.stderr)
        return 1
    if len(pavilions) < MIN_PAVILIONS:
        print(f"ERROR: only {len(pavilions)} usable pavilions (< {MIN_PAVILIONS}) — refusing to write", file=sys.stderr)
        return 1

    trail_codes = {t["code"] for t in trails if t["code"]}
    bad_posts = [p for p in posts if p["trail"] not in trail_codes]
    if bad_posts:
        print(f"ERROR: {len(bad_posts)} post(s) reference an unknown trail code, e.g. {bad_posts[0]}", file=sys.stderr)
        return 1

    print("Summits: heights against DSSCU's hills table, the 好漢坡 climb from OSM")
    diffs = summit_height_diffs()
    if diffs:
        for d in diffs:
            print(f"ERROR: summit height changed — {d}; re-check SUMMITS by hand", file=sys.stderr)
        return 1
    try:
        spurs = [fetch_spur(HOU_HON_PO)]
        spurs += find_climbs(trails, spurs)
        for sp in spurs:
            join_to_trail(sp, trails)
        summits = build_summits(trails, spurs)
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    trails.sort(key=lambda t: (t["kind"], t["code"] or "9-99", t["name"]["zh"]))

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "updatedAt": updated_at(muni_readme),
        "sources": {
            "name": "澳門特別行政區政府數據開放平台 – 市政活動場地（市政署）",
            "license": "https://data.gov.mo/UseClause",
            "venues": DETAIL_URL.format(id=MUNI_ID),
            "trailInfo": NATURE_URL.format(lang="c"),
            "geometry": f"{GIS_BASE}Walk_Trail_lane/MapServer/0",
            "points": f"{GIS_BASE}Walk_Trail_point/MapServer",
            "osm": "https://www.openstreetmap.org/copyright",
            "summitHeights": DSEC_HEIGHTS_URL,
            "summitHeightsDsscu": GEO7_URL,
            "summitPositions": TRIG_LIST_URL,
        },
        "osmCheck": {"osmBase": osm_base, "medianLimitM": MEDIAN_LIMIT_M, "p90LimitM": P90_LIMIT_M},
        "trails": trails,
        "posts": posts,
        "pavilions": pavilions,
        "summits": summits,
        "spurs": spurs,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    n_cycle = sum(1 for t in trails if t["kind"] == "cycle")
    n_osm = sum(1 for t in trails if t["geometry"]["source"] == "osm")
    n_closed = sum(1 for t in trails if t["closed"])
    n_susp = sum(1 for t in trails if t["suspensions"])
    print(
        f"Done. {len(trails)} trails (walk={len(trails) - n_cycle} cycle={n_cycle}, "
        f"gis={len(trails) - n_osm} osm={n_osm}), {len(posts)} posts, {len(pavilions)} pavilions, "
        f"closed={n_closed} suspended={n_susp}, upstream updated {output['updatedAt']}"
    )
    for s in summits:
        reach = ", ".join(f"{a['via']} {a['distanceM']} m" for a in s["access"])
        print(f"  summit {s['name']['zh']} {s['heightM']} m ({s['trig']}): {reach}")
    for sp in spurs:
        print(f"  spur {sp['name']['zh']}: {len(sp['lines'][0])} points, starts on {len(sp['trails'])} trail(s)")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(run())
