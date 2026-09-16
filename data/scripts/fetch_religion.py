"""
Manual fetch: RELIGION overlay, first category 土地公 / Tou Tei (Earth God)
temples and street shrines, normalised into public/data/religion.json.

There is no single upstream list of Macau's Tou Tei sites (official figures —
"近10所" temples, "160多個" public shrines, culturalheritage.mo/detail/101974
— are a rough estimate, not a register). Three sources are combined instead:

  * OpenStreetMap via Overpass (area = relation 1867188, i.e. Macau): two
    queries — worship-tagged features (amenity=place_of_worship, building=
    temple/shrine, historic=wayside_shrine, or a name already containing a
    Tou Tei keyword) and name-only candidates ending in 社 or 石敢當, which
    catches street-level 社壇/石敢當 markers that carry no amenity tag at
    all. Both are filtered client-side (see is_shrine_like / is_she_like)
    rather than trusted as-is — the raw Overpass hits include unrelated
    religious buildings, streets/squares named after a shrine, and unnamed
    survey nodes, none of which belong in this layer. A node within
    DEDUPE_M of a way sharing the same name is dropped in favour of the way
    (the same physical shrine mapped twice, once as a point and once as its
    footprint). Unnamed nodes are dropped outright — a "土地公" pin with no
    name is not distinguishable from a false positive.
  * 文化局 (IC) 文化遺產資料 API on data.gov.mo (dataset
    7e1eca8e-6ffe-4f74-8c81-25c25beb45b2): the 6 heritage-listed 土地/福德
    sites (5 福德祠 + 石敢當行臺) among the "被評定的不動產" list, in CN/EN/PT.
    `POST .../culturalheritage_prod/ICH/<lang>/` — the trailing slash is
    mandatory, the gateway 404s without it. Response shape is defensive
    here (bare array, or {data: [...]}, or {data: "<json>"} — seen all
    three across sibling scripts) even though live testing only ever
    returned a bare array. Each matched row is ATTACHED to the nearest OSM
    site within IC_MATCH_M (not kept as a separate point) — see
    attach_heritage(). A code with no OSM site that close becomes its own
    "ic-<CODE>" site instead; on 2026-09 data this path is unused (all six
    match within 46 m) but is kept for when the OSM side loses a node.
  * 澳門記憶 (Macau Memory)'s online exhibition 社區守護神, via the embedded
    Google My Maps "澳門的土地信仰" (mid 1rDU1yLGprtVVOVTVkxiAMzyqz9c746PL).
    This is the only source with any Coloane/Taipa street-shrine coverage
    beyond OSM. Its KML export carries name/address/record id per
    placemark but NO coordinates (it's an address-geocoded My Maps layer,
    not a surveyed one) — the coordinates live in the *viewer* page's
    embedded `_pageData` JS string, in the same placemark order as the KML,
    so the two are fetched and zipped by index (fetch_mymaps_sites() hard-
    fails if the names don't line up — a reordering upstream would silently
    corrupt every geocode otherwise). Placemarks sharing a name within
    MYMAPS_DEDUPE_M collapse into one site (multiple photos of the same
    shrine). Each resulting site is matched to the nearest OSM/IC site
    within MYMAPS_MATCH_M: a match ATTACHES (accumulates into
    site.macaumemory.{names,records,entries} — more than one distinctly
    named My Maps placemark can land on the same physical site, which is
    why those are arrays, not scalars); no match creates a new
    `approximate: true` site (Google's geocode of a street address is
    street-level, not a surveyed point). New sites never match against each
    other, only against the original OSM/IC pool. A separate crawl of the
    exhibition's six 堂區 (parish) sub-pages resolves each KML 登錄號碼
    (photo record id) to its own entry page URL, best-effort (not every
    record has one).

DATAGOVMO_APPCODE (the IC gateway's public APPCODE, the same one used by
fetch_car_parks.py / fetch_waste.py) is read from the environment and never
written to any file — see run().

Run manually when the source data changes (not scheduled):
    DATAGOVMO_APPCODE=... uv run python data/scripts/fetch_religion.py
"""

import hashlib
import html
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from osm_footprints import overpass

# The progress lines print Chinese/Portuguese site names. A Windows console
# defaults to a legacy code page and would garble or raise UnicodeEncodeError
# partway through the run — same fix as fetch_schools.py.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "religion.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; mini-macau data pipeline)"}
# The Google My Maps endpoints and macaumemory.mo expect a browser, not a
# self-identifying bot UA (same reasoning as fetch_waste.py's IAM_MAP_HEADERS).
BROWSER_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
TIMEOUT = 30
MAX_ATTEMPTS = 5
BACKOFF_BASE = 2.0  # seconds; 2, 4, 8, 16

RELIGION_MIN_SITES = 60  # degenerate-fetch guard; mirrored in validate_output.py

# ----------------------------------------------------------------------------
# OSM (Overpass)
# ----------------------------------------------------------------------------
# area id = 3600000000 + relation id (Macau = 1867188), matching every other
# Overpass caller in this repo (see fetch_schools.py's fetch_buildings_in_relation).
Q1_WORSHIP = """[out:json][timeout:90];
area(3601867188)->.mo;
(
  nwr["amenity"="place_of_worship"](area.mo);
  nwr["historic"="wayside_shrine"](area.mo);
  nwr["amenity"="shrine"](area.mo);
  nwr["building"="shrine"](area.mo);
  nwr["building"="temple"](area.mo);
  nwr["name"~"土地|福德|社稷|伯公|Tou Tei|Tudi|Tou Tei"](area.mo);
);
out center tags;"""

Q2_SHE = """[out:json][timeout:90];
area(3601867188)->.mo;
(
  nwr["name"~"社$|社壇|神位|神龕|石敢當|神壇|土地"](area.mo);
);
out center tags;"""

NAME_RE = re.compile(r"土地|福德|社稷|伯公|Tou Tei|Fok Tak|Foc Tac|石敢當", re.I)
NAME_EXCLUDE_RE = re.compile(r"博物館|邨")
STREET_RE = re.compile(r"前地|Largo|Beco|Travessa|Rua ")
TEMPLE_RE = re.compile(r"廟|祠")
# The 社壇 group: a name ending in 社, or 石敢當, that isn't a mundane
# organisation (travel agency, publisher, mutual-aid club, newspaper office,
# co-op, company, association) that happens to end in the same character.
SHE_RE = re.compile(r"社$|石敢當")
SHE_EXCLUDE_RE = re.compile(r"旅行社|出版社|同樂社|報社|合作社|公司|會社")
DEDUPE_M = 15.0  # node-vs-way same-name dedupe radius

CATEGORIES = [
    {
        "id": "tudigong",
        "name": {"zh": "土地公", "en": "Tou Tei (Earth God)", "pt": "Tou Tei (Deus da Terra)"},
        "officialCounts": {
            "temples": "近10所",
            "publicShrines": "160多個",
            "source": "https://www.culturalheritage.mo/detail/101974",
        },
    },
]

SOURCES_META = {
    "osm": {
        "name": "OpenStreetMap contributors (ODbL)",
        "url": "https://www.openstreetmap.org/copyright",
    },
    "ic": {
        "name": "文化局 文化遺產資料 (data.gov.mo)",
        "url": "https://data.gov.mo/Detail?id=7e1eca8e-6ffe-4f74-8c81-25c25beb45b2",
    },
    "macaumemory": {
        "name": "澳門記憶 網上展覽《社區守護神》/ Google My Maps 澳門的土地信仰",
        "url": "https://www.macaumemory.mo/exhibitions/showexhibition!toSep?id=8c35d71325374eeda344f11a351a27d7",
        "mapId": "1rDU1yLGprtVVOVTVkxiAMzyqz9c746PL",
        "note": "positions are Google geocodes of the address field (street-level); names and record ids only, no photos or descriptions copied",
    },
}


def clean(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Planar metre approximation, local to lat1 — matches the thresholds the
    Node prototypes (refine-osm.mjs / geocoded.mjs / merge3.mjs) were tuned
    against; deliberately NOT osm_footprints.metres_xy's fixed-lat0 projection."""
    dy = (lat1 - lat2) * 111320.0
    dx = (lon1 - lon2) * 111320.0 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


def osm_ref(el: dict) -> str:
    return f"{el['type']}/{el['id']}"


def osm_pos(el: dict) -> tuple[float | None, float | None]:
    if el.get("type") == "node":
        return el.get("lat"), el.get("lon")
    c = el.get("center") or {}
    return c.get("lat"), c.get("lon")


def is_shrine_like(el: dict) -> bool:
    t = el.get("tags") or {}
    n = f"{t.get('name', '')} {t.get('name:pt', '')} {t.get('name:en', '')}"
    if not NAME_RE.search(n) or NAME_EXCLUDE_RE.search(n):
        return False
    feature = t.get("amenity") == "place_of_worship" or t.get("building") == "temple" or bool(t.get("historic"))
    if feature:
        return True
    if t.get("building") == "yes":
        return not STREET_RE.search(n) or bool(TEMPLE_RE.search(n))
    return False


def is_she_like(el: dict) -> bool:
    t = el.get("tags") or {}
    if t.get("amenity") != "place_of_worship" and t.get("building") != "yes":
        return False
    name = t.get("name") or ""
    return bool(SHE_RE.search(name)) and not SHE_EXCLUDE_RE.search(name)


def dedupe_node_way(elements: list[dict]) -> list[dict]:
    """Drop a node within DEDUPE_M of a way that shares its name, keeping the
    way — the same shrine mapped twice, once as a point and once as its
    footprint."""
    ways = [e for e in elements if e.get("type") != "node"]
    nodes = [e for e in elements if e.get("type") == "node"]
    drop: set[str] = set()
    for n in nodes:
        nlat, nlon = osm_pos(n)
        nname = clean((n.get("tags") or {}).get("name"))
        if nlat is None or not nname:
            continue
        for w in ways:
            wlat, wlon = osm_pos(w)
            if wlat is None or clean((w.get("tags") or {}).get("name")) != nname:
                continue
            if metres(nlat, nlon, wlat, wlon) < DEDUPE_M:
                drop.add(osm_ref(n))
                break
    return [e for e in elements if osm_ref(e) not in drop]


# OSM's Macau convention puts both languages in ONE `name` tag ("雀仔園福德祠 Templo
# Foc Tac Chi …"). The Chinese side is the inscription the panel shows; the
# Latin side only feeds `name.pt` when there is no `name:pt` tag. `name:zh-Hant`
# wins over both because `name:zh` is sometimes simplified.
LATIN_TAIL_RE = re.compile(r"\s+([A-Za-zÀ-ÿ][^\u4e00-\u9fff]*)$")


def split_osm_name(tags: dict) -> tuple[str, str | None]:
    """(zh, pt-or-None) from an OSM tag set."""
    raw = clean(tags.get("name"))
    tail: str | None = None
    m = LATIN_TAIL_RE.search(raw)
    if m:
        tail = m.group(1).strip() or None
        raw = raw[: m.start()].strip()
    name_zh = clean(tags.get("name:zh-Hant")) or raw or clean(tags.get("name:zh"))
    name_pt = clean(tags.get("name:pt")) or tail
    return name_zh, name_pt


def build_osm_site(el: dict) -> dict | None:
    tags = el.get("tags") or {}
    name_zh, name_pt = split_osm_name(tags)
    lat, lon = osm_pos(el)
    if not name_zh or lat is None or lon is None:
        return None  # unnamed / no usable position — excluded, not a "site"
    kind = "temple" if TEMPLE_RE.search(name_zh) else "shrine"
    return {
        "id": f"osm-{el['type']}-{el['id']}",
        "category": "tudigong",
        "kind": kind,
        "name": {"zh": name_zh, "en": clean(tags.get("name:en")) or None, "pt": name_pt},
        "coordinates": [round(float(lon), 6), round(float(lat), 6)],
        "approximate": False,
        "address": None,
        "heritage": None,
        "sources": ["osm"],
        "osm": osm_ref(el),
        "macaumemory": None,
    }


def fetch_osm_sites() -> dict[str, dict]:
    q1 = overpass(Q1_WORSHIP)
    q2 = overpass(Q2_SHE)
    print(f"  q1 (worship-tag candidates): {len(q1)}   q2 (社-name candidates): {len(q2)}")

    tou_tei = [e for e in q1 if is_shrine_like(e)]
    she = [e for e in (q1 + q2) if is_she_like(e)]

    merged: dict[str, dict] = {}
    for e in tou_tei + she:  # tou-tei group wins ties (e.g. 石敢當行臺 matches both)
        merged.setdefault(osm_ref(e), e)

    deduped = dedupe_node_way(list(merged.values()))
    print(f"  {len(merged)} named candidates ({len(tou_tei)} worship + {len(she)} 社壇) -> {len(deduped)} after node/way dedupe")

    sites: dict[str, dict] = {}
    skipped = 0
    for e in deduped:
        site = build_osm_site(e)
        if site is None:
            skipped += 1
            continue
        sites[site["id"]] = site
    if skipped:
        print(f"  skipped {skipped} unnamed/no-position element(s)")
    return sites


# ----------------------------------------------------------------------------
# 文化局 (IC) 文化遺產資料 API
# ----------------------------------------------------------------------------
IC_BASE = "https://ic.apigateway.data.gov.mo/culturalheritage_prod/ICH/{lang}/"
IC_CODE_RE = re.compile(r"^([A-Z]{2}\d{3})-(.*)$")
IC_WANT_RE = re.compile(r"土地|福德祠|石敢當")
IC_GPS_RE = re.compile(r"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)")
IC_MATCH_M = 50.0
TAG_RE = re.compile(r"<[^>]+>")


def strip_html(s: object) -> str:
    text = TAG_RE.sub(" ", str(s or ""))
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def parse_ic_gps(raw: object) -> tuple[float, float] | None:
    m = IC_GPS_RE.search(str(raw or ""))
    return (float(m.group(1)), float(m.group(2))) if m else None  # (lat, lng)


def fetch_ic(lang: str, appcode: str) -> list[dict]:
    """POST the IC culturalheritage_prod gateway (trailing slash mandatory —
    the gateway 404s without it). Response is documented as a bare JSON
    array; parsed defensively anyway (a sibling script, fetch_waste.py, has
    seen data.gov.mo endpoints wrap their payload in {data: ...})."""
    url = IC_BASE.format(lang=lang)
    headers = {**HEADERS, "Authorization": f"APPCODE {appcode}"}
    last_error = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, data=b"", headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read()
            parsed = json.loads(body.decode("utf-8-sig"))
            rows = parsed
            if isinstance(parsed, dict):
                data = parsed.get("data")
                rows = json.loads(data) if isinstance(data, str) else data
            if isinstance(rows, list):
                return rows
            last_error = f"unexpected JSON shape: {type(parsed).__name__}"
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} for IC/{lang} failed ({last_error}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"IC gateway fetch {lang} failed after {MAX_ATTEMPTS} attempts: {last_error}")


def fetch_heritage_rows(appcode: str) -> list[dict]:
    cn, en, pt = fetch_ic("CN", appcode), fetch_ic("EN", appcode), fetch_ic("PT", appcode)

    def by_code(rows: list[dict]) -> dict[str, dict]:
        out = {}
        for r in rows:
            m = IC_CODE_RE.match(clean(r.get("Name")))
            if m:
                out[m.group(1)] = {"name": m.group(2).strip(), "description": strip_html(r.get("Description_html"))}
        return out

    en_by_code, pt_by_code = by_code(en), by_code(pt)

    rows = []
    for r in cn:
        m = IC_CODE_RE.match(clean(r.get("Name")))
        if not m:
            continue
        code, zh_name = m.group(1), m.group(2).strip()
        if not IC_WANT_RE.search(zh_name):
            continue
        en_entry, pt_entry = en_by_code.get(code, {}), pt_by_code.get(code, {})
        rows.append(
            {
                "code": code,
                "zh_name": zh_name,
                "en_name": en_entry.get("name"),
                "pt_name": pt_entry.get("name"),
                "gps": parse_ic_gps(r.get("GPS")),
                "description": {
                    "zh": strip_html(r.get("Description_html")),
                    "en": en_entry.get("description", ""),
                    "pt": pt_entry.get("description", ""),
                },
            }
        )
    return rows


def attach_heritage(sites: dict[str, dict], rows: list[dict]) -> None:
    """Attach each heritage row to the nearest OSM site within IC_MATCH_M
    (mutating it in place: heritage block + sources + EN/PT names) rather
    than keeping it as a separate point. A row with no site that close
    becomes its own "ic-<CODE>" site — unused on current data (all six rows
    match within 46 m) but kept for when the OSM side loses a node."""
    for h in rows:
        if h["gps"] is None:
            print(f"  WARNING: heritage {h['code']} has no parseable GPS; skipped", file=sys.stderr)
            continue
        hlat, hlon = h["gps"]
        best_id, best_d = None, None
        for sid, site in sites.items():
            slon, slat = site["coordinates"]
            d = metres(hlat, hlon, slat, slon)
            if best_d is None or d < best_d:
                best_id, best_d = sid, d
        heritage_block = {"code": h["code"], "description": h["description"]}
        if best_d is not None and best_d <= IC_MATCH_M:
            site = sites[best_id]
            site["heritage"] = heritage_block
            if h["en_name"]:
                site["name"]["en"] = h["en_name"]
            if h["pt_name"]:
                site["name"]["pt"] = h["pt_name"]
            if "ic" not in site["sources"]:
                site["sources"].append("ic")
            print(f"  heritage {h['code']} {h['zh_name']} -> {best_id} ({best_d:.1f} m)")
        else:
            new_id = f"ic-{h['code']}"
            sites[new_id] = {
                "id": new_id,
                "category": "tudigong",
                "kind": "shrine" if h["code"] == "MM049" else "temple",
                "name": {"zh": h["zh_name"], "en": h["en_name"], "pt": h["pt_name"]},
                "coordinates": [round(hlon, 6), round(hlat, 6)],
                "approximate": False,
                "address": None,
                "heritage": heritage_block,
                "sources": ["ic"],
                "osm": None,
                "macaumemory": None,
            }
            far = f"{best_d:.1f} m" if best_d is not None else "no OSM sites at all"
            print(f"  heritage {h['code']} {h['zh_name']} -> standalone (nearest OSM {far} > {IC_MATCH_M:.0f} m)")


# ----------------------------------------------------------------------------
# 澳門記憶 / Google My Maps
# ----------------------------------------------------------------------------
MYMAPS_MAP_ID = "1rDU1yLGprtVVOVTVkxiAMzyqz9c746PL"
MYMAPS_KML_URL = f"https://www.google.com/maps/d/kml?mid={MYMAPS_MAP_ID}&forcekml=1"
MYMAPS_VIEWER_URL = f"https://www.google.com/maps/d/viewer?mid={MYMAPS_MAP_ID}"
MYMAPS_DEDUPE_M = 5.0
MYMAPS_MATCH_M = 30.0
MYMAPS_TEMPLE_RE = re.compile(r"福德祠|土地廟")

PARISH_IDS = [
    "4be545ec41a742748ff03c732f1d3442",
    "9d34bd36f0e3408f89b0ab33face968c",
    "9a4a78f4891e4d9da0e4975a4f3d6d6e",
    "812f9cd599984dd69aef0abae8e97da4",
    "25ac2390b78e44d88700c79fbe809229",
    "c2538c0444ba4ff4a7130d4b58b9d422",
]
PARISH_PAGE = "https://www.macaumemory.mo/exhibitions/showexhibition!toSep?id={pid}"
ENTRY_URL = "https://www.macaumemory.mo/entries_{entry_hash}"

PLACEMARK_RE = re.compile(r"<Placemark>[\s\S]*?</Placemark>")
NAME_TAG_RE = re.compile(r"<name>([\s\S]*?)</name>")
ADDRESS_TAG_RE = re.compile(r"<address>([\s\S]*?)</address>")
RECORD_DATA_RE = re.compile(r'<Data name="登錄號碼">\s*<value>([^<]*)</value>')
CDATA_RE = re.compile(r"^<!\[CDATA\[([\s\S]*?)\]\]>$")
FEATURE_RE = re.compile(r'\[(22\.\d+),(113\.\d+)\],\[0,-128\],"[0-9A-F]+"\],\[\["([^"]*)"\]\]')
ENTRY_RE = re.compile(r"entries_([0-9a-f]{32})")
RECORD_ID_RE = re.compile(r"p00\d{5}")


def http_get_browser(url: str) -> bytes:
    last_error = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, headers=BROWSER_HEADERS, method="GET")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} for {url} failed ({last_error}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"GET {url} failed after {MAX_ATTEMPTS} attempts: {last_error}")


def strip_cdata(s: str | None) -> str:
    if not s:
        return ""
    m = CDATA_RE.match(s.strip())
    return clean(m.group(1) if m else s)


def parse_kml_placemarks(kml_text: str) -> list[dict]:
    """KML placemarks carry name/address/record id but deliberately NO
    coordinates (this is an address-geocoded My Maps layer, not a surveyed
    one) — see the module docstring."""
    out = []
    for block in PLACEMARK_RE.findall(kml_text):
        name_m, addr_m, rec_m = NAME_TAG_RE.search(block), ADDRESS_TAG_RE.search(block), RECORD_DATA_RE.search(block)
        out.append(
            {
                "name": strip_cdata(name_m.group(1) if name_m else None),
                "address": strip_cdata(addr_m.group(1) if addr_m else None),
                "record": rec_m.group(1).strip() if rec_m and rec_m.group(1).strip() else None,
            }
        )
    return out


def extract_page_data(viewer_html: str) -> str:
    """The viewer page embeds `_pageData = "<JSON-escaped string>"`. Walk it
    like the Node prototype did: find the opening quote, copy chars through
    to the matching closing quote (honouring backslash escapes), then decode
    as a JSON string literal — falling back to a manual \\uXXXX / \\" unescape
    if that fails, same as the prototype."""
    marker = '_pageData = "'
    start = viewer_html.find(marker)
    if start < 0:
        raise RuntimeError("no _pageData in viewer page")
    i, n = start + len(marker), len(viewer_html)
    chars: list[str] = []
    while i < n:
        c = viewer_html[i]
        if c == "\\" and i + 1 < n:
            chars.append(c)
            chars.append(viewer_html[i + 1])
            i += 2
            continue
        if c == '"':
            break
        chars.append(c)
        i += 1
    body = "".join(chars)
    try:
        return json.loads('"' + body + '"')
    except json.JSONDecodeError:
        return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), body).replace('\\"', '"')


def parse_viewer_features(viewer_html: str) -> list[dict]:
    decoded = extract_page_data(viewer_html)
    return [{"lat": float(m.group(1)), "lon": float(m.group(2)), "name": m.group(3)} for m in FEATURE_RE.finditer(decoded)]


def dedupe_mymaps(rows: list[dict]) -> list[dict]:
    """Placemarks sharing a name within MYMAPS_DEDUPE_M collapse into one
    site (multiple photos of the same shrine), keeping every record id."""
    sites: list[dict] = []
    for r in rows:
        match = next(
            (s for s in sites if s["name"] == r["name"] and metres(s["lat"], s["lon"], r["lat"], r["lon"]) < MYMAPS_DEDUPE_M),
            None,
        )
        if match:
            if r["record"]:
                match["records"].append(r["record"])
        else:
            sites.append({"name": r["name"], "lat": r["lat"], "lon": r["lon"], "address": r["address"], "records": [r["record"]] if r["record"] else []})
    return sites


def fetch_mymaps_sites() -> list[dict]:
    kml_text = http_get_browser(MYMAPS_KML_URL).decode("utf-8", "replace")
    viewer_html = http_get_browser(MYMAPS_VIEWER_URL).decode("utf-8", "replace")
    placemarks = parse_kml_placemarks(kml_text)
    features = parse_viewer_features(viewer_html)
    if len(placemarks) != len(features):
        raise RuntimeError(f"KML placemark count {len(placemarks)} != viewer pageData feature count {len(features)}")
    mismatches = [i for i, (p, f) in enumerate(zip(placemarks, features)) if p["name"] != f["name"]]
    if mismatches:
        raise RuntimeError(f"KML/pageData placemark order mismatch at indices {mismatches[:10]} — cannot zip coordinates onto names safely")
    rows = [{"name": f["name"], "lat": f["lat"], "lon": f["lon"], "address": p["address"], "record": p["record"]} for p, f in zip(placemarks, features)]
    print(f"  {len(rows)} My Maps placemarks (KML names/addresses + viewer pageData coordinates)")
    sites = dedupe_mymaps(rows)
    print(f"  {len(sites)} distinct sites after same-name/{MYMAPS_DEDUPE_M:.0f}m dedupe")
    return sites


def fetch_macaumemory_entry_map() -> dict[str, str]:
    """record id (登錄號碼, e.g. "p0003801") -> entry-page hash, crawled from
    the exhibition's six parish sub-pages. Best-effort per record: not every
    KML record resolves to an entry link."""
    by_record: dict[str, str] = {}
    for pid in PARISH_IDS:
        page_html = http_get_browser(PARISH_PAGE.format(pid=pid)).decode("utf-8", "replace")
        for m in ENTRY_RE.finditer(page_html):
            window = page_html[max(0, m.start() - 300) : m.start() + 1500]
            idx = window.find("entries_")
            rm = RECORD_ID_RE.search(window[idx:] if idx >= 0 else window)
            if rm:
                by_record.setdefault(rm.group(0), m.group(1))
    print(f"  {len(by_record)} MacauMemory record -> entry-page links from {len(PARISH_IDS)} parish pages")
    return by_record


def merge_mymaps(sites: dict[str, dict], mymaps_sites: list[dict], entry_by_record: dict[str, str]) -> tuple[int, int]:
    """Match each My Maps site to the nearest OSM/IC site within
    MYMAPS_MATCH_M and attach (accumulating into macaumemory.{names,records,
    entries} — more than one distinctly named placemark can land on the same
    physical site); the rest become new `approximate: true` sites. New sites
    are matched only against the original OSM/IC pool, never against each
    other (a `candidate_ids` snapshot taken before this loop starts)."""
    candidate_ids = list(sites.keys())
    seen_ids = set(sites.keys())
    matched = added = 0
    for s in mymaps_sites:
        best_id, best_d = None, None
        for sid in candidate_ids:
            slon, slat = sites[sid]["coordinates"]
            d = metres(s["lat"], s["lon"], slat, slon)
            if best_d is None or d < best_d:
                best_id, best_d = sid, d
        entries = [ENTRY_URL.format(entry_hash=entry_by_record[r]) for r in s["records"] if r in entry_by_record]
        if best_d is not None and best_d <= MYMAPS_MATCH_M:
            target = sites[best_id]
            mm = target["macaumemory"] or {"names": [], "records": [], "entries": []}
            mm["names"].append(s["name"])
            mm["records"].extend(s["records"])
            mm["entries"].extend(entries)
            target["macaumemory"] = mm
            if "macaumemory" not in target["sources"]:
                target["sources"].append("macaumemory")
            matched += 1
        else:
            base_id = f"mm-{s['records'][0]}" if s["records"] else f"mm-{hashlib.sha1(s['name'].encode('utf-8')).hexdigest()[:8]}"
            new_id, i = base_id, 1
            while new_id in seen_ids:
                i += 1
                new_id = f"{base_id}-{i}"
            seen_ids.add(new_id)
            sites[new_id] = {
                "id": new_id,
                "category": "tudigong",
                "kind": "temple" if MYMAPS_TEMPLE_RE.search(s["name"]) else "shrine",
                "name": {"zh": s["name"], "en": None, "pt": None},
                "coordinates": [round(s["lon"], 6), round(s["lat"], 6)],
                "approximate": True,
                "address": {"zh": s["address"]} if s["address"] else None,
                "heritage": None,
                "sources": ["macaumemory"],
                "osm": None,
                "macaumemory": {"names": [s["name"]], "records": list(s["records"]), "entries": entries},
            }
            added += 1
    return matched, added


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def run() -> int:
    appcode = os.environ.get("DATAGOVMO_APPCODE")
    if not appcode:
        print(
            "ERROR: DATAGOVMO_APPCODE is not set. Export the public APPCODE printed on "
            "the culturalheritage_prod dataset page "
            "(https://data.gov.mo/Detail?id=7e1eca8e-6ffe-4f74-8c81-25c25beb45b2) before "
            "running this script, e.g. DATAGOVMO_APPCODE=... uv run python data/scripts/fetch_religion.py",
            file=sys.stderr,
        )
        return 1

    print("Fetching RELIGION overlay: 土地公 / Tou Tei temples and street shrines")

    print("- OSM (Overpass): worship + 社壇 candidates")
    osm_queried_at = datetime.now(tz=timezone.utc).isoformat()
    try:
        sites = fetch_osm_sites()
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    print(f"  {len(sites)} named OSM sites")

    print("- 文化局 (IC) 文化遺產資料: heritage-listed 土地/福德 sites")
    try:
        attach_heritage(sites, fetch_heritage_rows(appcode))
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    n_heritage = sum(1 for s in sites.values() if s["heritage"])
    print(f"  {n_heritage} heritage-matched sites")

    print("- 澳門記憶 / Google My Maps 澳門的土地信仰")
    try:
        mymaps_sites = fetch_mymaps_sites()
        entry_map = fetch_macaumemory_entry_map()
        matched, added = merge_mymaps(sites, mymaps_sites, entry_map)
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    print(f"  {matched} matched onto an existing site, {added} new")

    if len(sites) < RELIGION_MIN_SITES:
        print(f"ERROR: only {len(sites)} sites (< {RELIGION_MIN_SITES}) — looks like a degenerate run, refusing to write", file=sys.stderr)
        return 1

    site_list = sorted(sites.values(), key=lambda s: s["id"])
    stats = {
        "total": len(site_list),
        "temples": sum(1 for s in site_list if s["kind"] == "temple"),
        "shrines": sum(1 for s in site_list if s["kind"] == "shrine"),
        "approximate": sum(1 for s in site_list if s["approximate"]),
        "bySource": {src: sum(1 for s in site_list if src in s["sources"]) for src in ("osm", "ic", "macaumemory")},
    }

    output = {
        "version": 1,
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "layer": "religion",
        "categories": CATEGORIES,
        "sites": site_list,
        "sources": {
            "osm": {**SOURCES_META["osm"], "queriedAt": osm_queried_at},
            "ic": SOURCES_META["ic"],
            "macaumemory": SOURCES_META["macaumemory"],
        },
        "stats": stats,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(
        f"\nDone. {stats['total']} sites (temples={stats['temples']}, shrines={stats['shrines']}, "
        f"approximate={stats['approximate']}); bySource={stats['bySource']}"
    )
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
