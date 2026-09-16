"""
Manual fetch: RELIGION overlay — 土地公 / Tou Tei (Earth God) temples and
street shrines, Chinese temples, churches and chapels, the mosque, and other
faiths — normalised into public/data/religion.json.

The tudigong category (below) claims its OSM elements first, unchanged from
the original single-category fetch. The other four categories (temple/
church/mosque/other) are a separate OSM fetch + classification pass — see
the "New categories" section below Q2_SHE's block for the query, the name/
religion-tag classification rules, the dedupe rule, and the 文化局 (IC)
heritage join that mirrors attach_heritage() for them.

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

import difflib
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

RELIGION_MIN_SITES = 120  # degenerate-fetch guard; mirrored in validate_output.py

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
    {
        "id": "temple",
        "name": {"zh": "廟宇", "en": "Chinese temples", "pt": "Templos chineses"},
        "officialCounts": None,
    },
    {
        "id": "church",
        "name": {"zh": "教堂", "en": "Churches and chapels", "pt": "Igrejas e capelas"},
        "officialCounts": None,
    },
    {
        "id": "mosque",
        "name": {"zh": "清真寺", "en": "Mosque", "pt": "Mesquita"},
        "officialCounts": None,
    },
    {
        "id": "other",
        "name": {"zh": "其他信仰", "en": "Other faiths", "pt": "Outras religiões"},
        "officialCounts": None,
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
        "religion": "folk",
        "denomination": None,
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
                "religion": "folk",
                "denomination": None,
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
                "religion": "folk",
                "denomination": None,
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
# New categories: temple 廟宇 / church 教堂 / mosque 清真寺 / other 其他信仰
# ----------------------------------------------------------------------------
# One Overpass query unions the five selection criteria: worship-tagged
# amenity, a qualifying building enum, any element carrying a religion tag,
# named historic church ruins, and a building=yes element whose name reads
# like a temple/church. Tudigong claims its own elements FIRST (the
# unchanged Q1_WORSHIP/Q2_SHE fetch above) — anything already claimed (by
# OSM ref) is excluded below, so the 107 tudigong sites are only ever added
# to, never touched.
#
# RUINS_NAME_PATTERN/QUERY_E_NAME_PATTERN are shared, as plain strings,
# between the query text below and matches_new_worship_query()'s compiled
# regexes, so the two can never drift apart — matches_new_worship_query is a
# defensive re-check that classification never trusts an element none of
# these five clauses would actually select (live Overpass already only
# returns matching elements; this only bites when the offline dry-run
# harness feeds fetch_new_osm_sites a broader test dump).
RUINS_NAME_PATTERN = r"教堂|Igreja"
QUERY_E_NAME_PATTERN = r"聖堂|小堂|教堂|教會|宣道堂|浸信|聖公會|修院|靜院|Igreja|Capela|Ermida|廟|寺|庵|禪院|Templo"

Q_NEW_WORSHIP = f"""[out:json][timeout:180];
area(3601867188)->.mo;
(
  nwr["amenity"="place_of_worship"](area.mo);
  nwr["building"~"^(church|chapel|cathedral|temple|mosque|monastery|shrine|synagogue)$"](area.mo);
  nwr["religion"](area.mo);
  nwr["historic"="ruins"]["name"~"{RUINS_NAME_PATTERN}"](area.mo);
  nwr["building"="yes"]["name"~"{QUERY_E_NAME_PATTERN}"](area.mo);
);
out center tags;"""

QUALIFYING_BUILDING_RE = re.compile(r"^(church|chapel|cathedral|temple|mosque|monastery|shrine|synagogue)$")
RUINS_NAME_RE = re.compile(RUINS_NAME_PATTERN)
QUERY_E_NAME_RE = re.compile(QUERY_E_NAME_PATTERN)

RELIGION_TAG_CATEGORY = {
    "christian": "church",
    "muslim": "mosque",
    "hindu": "other",
    "sikh": "other",
    "jewish": "other",
    "bahai": "other",
    "buddhist": "temple",
    "taoist": "temple",
    "chinese_folk": "temple",
    "confucian": "temple",
    "shinto": "temple",
}

# Rule 3 name-based classification, checked against the combined
# name+name:pt+name:en string — same convention as is_shrine_like above,
# since the pt/en half is sometimes the only half that reads as a temple or
# church (e.g. 望廈聖方濟各堂 only carries a recognisable word, "Igreja", in
# its pt name). These three regexes are a deliberately separate family from
# NAME_RE/TEMPLE_RE/STREET_RE above (tudigong's own), so neither can change
# the other's behaviour.
CHURCH2_NAME_RE = re.compile(r"聖堂|小堂|教堂|教會|宣道堂|浸信|聖公會|主教座堂|修院|靜院|修會|Igreja|Capela|Ermida|Church|Chapel|Cristo")
MOSQUE2_NAME_RE = re.compile(r"清真寺|Mesquita|Mosque")
# DECISION: 包相府 (node/11166808354, one of "the 2023 survey's non-土地
# street altars" the task spec names as an expected temple/shrine result)
# matches none of the deity/temple words the spec gives verbatim. Appended
# here as one more specific proper-noun alternative, the same way the given
# list already mixes generic building words (廟/宮/寺) with deity names
# (譚公/康公/包公/女媧/星君/水仙/尊王/老爺) — see the report for the one node
# this changes the outcome for.
TEMPLE2_NAME_RE = re.compile(
    r"廟|宮|寺|庵|禪院|觀音|媽祖|天后|北帝|關帝|哪咤|哪吒|譚公|康公|包公|城隍|龍母|女媧|龍王|星君|水仙|尊王|老爺|包相府|Templo|Temple|Pagode"
)
# Rule 4: temple-vs-shrine kind, consulted only once category == temple (or,
# see classify_new_category, as a last-resort category signal in its own
# right — DECISION below). 仙院 added (coordinator correction): 呂祖仙院 reads
# as a proper temple building, not a street shrine.
KIND_TEMPLE_RE = re.compile(r"廟|宮|寺|庵|禪院|仙院|堂|殿|會館|園|岩|文化村|佛學社")

# Rule 5: hard exclusions, checked against the zh half only (split_osm_name)
# and only for elements NOT independently confirmed as a worship site (see
# is_confirmed_worship) — e.g. amenity=place_of_worship "康真君廟, 望廈坊眾
# 互助會" keeps its 互助會 clause, while the building=yes-only guesthouse
# "家欣賓館（康公廟）" does not survive it.
HARD_EXCLUDE_RE = re.compile(
    r"皇宮|娛樂場|酒店|賓館|旅館|餅店|餐廳|火鍋|停車場|辦公室|中心|慈善會|互助會|大廈|Hotel|Casino|Car Park|Palace|Marquee|Gallery|Shuttle|Restaurant|Beer"
)
RELIGION2_STREET_RE = re.compile(r"前地|巷|街|里|斜巷|馬路|Largo|Beco|Travessa|Rua |Calçada|Estrada|Av\.|站$")
# Plain civic/commercial amenities are never the worship site itself, even
# when the name or a religion tag matches — school and grave_yard earn their
# place here empirically: Macau has several church-run schools and Catholic/
# Protestant cemeteries that carry religion=christian (and, for the schools,
# a name containing "聖公會"/"浸信" — an affiliation, not a building type) —
# see DECISION in the report. social_facility is deliberately left off this
# set, since a real chapel (澳門基督教會宣道堂) can legitimately carry it; that
# one lives or dies on the normal category-name match instead.
PLAIN_AMENITY_EXCLUDE = {"restaurant", "pub", "toilets", "parking", "casino", "community_centre", "school", "grave_yard"}
# A religion tag alone must not admit a feature (coordinator correction):
# Macau's Catholic/Protestant cemeteries, the diocesan funeral home, the
# Bishop's residence and several church-run schools all carry
# religion=christian despite not being a place of worship themselves —
# see classify_new_category's religion-tag gate, which additionally
# requires this to NOT match and one of amenity=place_of_worship / a
# qualifying building tag / a worship name pattern to independently hold.
RELIGION2_NONWORSHIP_EXCLUDE_RE = re.compile(
    r"墳場|Cemetery|Cemitério|殯儀|學校|中學|小學|學院|College|Escola|School|公署|大樓|安老院|舊址|醫院|中心|辦事處|會所"
)
# An OSM name that is a comma list ending in the maintaining association,
# not the site itself (e.g. "康真君廟, 望廈坊眾互助會") — the temple/church is
# only the part before the comma; the pt half (the association's Portuguese
# name) stops applying once the zh half is truncated to match.
COMMA_ASSOCIATION_RE = re.compile(r"^(.+?)[,，]\s*.+(?:互助會|慈善會|坊會)$")

RELIGION2_DEDUPE_M = 60.0
RELIGION2_IC_MATCH_M = 60.0

# DECISION (coordinator correction): OSM and IC disagree on a handful of
# variant/traditional characters for the same site — 蓮峰廟 (OSM) vs 蓮峯廟
# (IC), 大三巴哪吒廟 vs an IC 哪咤 spelling, 譚僊聖廟 vs a hypothetical 譚仙聖廟,
# etc. Every zh-name comparison used for matching (dedupe's same_site AND
# attach_new_heritage's join) normalises through this map first and strips
# spaces/punctuation, so e.g. "蓮峯廟" and "蓮峰廟" compare equal. The map is
# for COMPARISON ONLY — build_new_site/attach_new_heritage still write the
# original, un-normalised characters into the output.
NAME_VARIANT_MAP = str.maketrans({"峯": "峰", "芳": "方", "咤": "吒", "僊": "仙", "靑": "青", "裡": "里"})
NAME_PUNCT_RE = re.compile(r"[\s,，、。·:：\-\(\)（）《》\[\]【】\"'‘’“”]")


def normalize_for_compare(s: str) -> str:
    return NAME_PUNCT_RE.sub("", s.translate(NAME_VARIANT_MAP))


def has_cjk(s: str) -> bool:
    return any("一" <= ch <= "鿿" for ch in s)


def is_confirmed_worship(tags: dict) -> bool:
    """A strong, tag-level signal that the element IS a place of worship, as
    opposed to being pulled in only by the generic building=yes name regex.
    Confirmed elements skip the hard-exclusion word list (rule 5) — the tag
    itself is taken as decisive over an incidental word in a compound name."""
    if tags.get("amenity") == "place_of_worship":
        return True
    if tags.get("religion"):
        return True
    if QUALIFYING_BUILDING_RE.match(tags.get("building") or ""):
        return True
    if tags.get("historic") == "ruins":
        return True
    return False


def matches_new_worship_query(tags: dict, combined: str) -> bool:
    """True if the element satisfies at least one of Q_NEW_WORSHIP's five
    clauses. A live Overpass fetch only ever returns matching elements, so
    this is a no-op in production; it earns its keep against the offline
    dry-run harness's broader test dump, which also carries elements with
    NONE of these tags (a casino resort whose name happens to contain 宮, or
    a bus-stop node named after a nearby temple) that the name-based rules
    below would otherwise wrongly classify."""
    if is_confirmed_worship(tags):
        return True
    if tags.get("building") == "yes" and QUERY_E_NAME_RE.search(combined):
        return True
    return False


def classify_new_category(tags: dict, zh: str, combined: str, confirmed: bool) -> tuple[str | None, str | None]:
    """(category, kind) per rules 2-4, or (None, None) to skip (and print)."""
    cat = RELIGION_TAG_CATEGORY.get(tags.get("religion") or "")
    if cat is not None:
        # DECISION (coordinator correction): a religion tag alone must not
        # admit a feature — a cemetery, funeral home, administrative office
        # or school can carry the parent institution's religion tag without
        # itself being a place of worship. Also needs amenity=place_of_
        # worship, a qualifying building tag, or a worship name pattern, AND
        # the zh name must not read as one of those non-worship uses.
        has_worship_signal = (
            tags.get("amenity") == "place_of_worship"
            or QUALIFYING_BUILDING_RE.match(tags.get("building") or "")
            or CHURCH2_NAME_RE.search(combined)
            or MOSQUE2_NAME_RE.search(combined)
            or TEMPLE2_NAME_RE.search(combined)
        )
        if has_worship_signal and not RELIGION2_NONWORSHIP_EXCLUDE_RE.search(zh):
            if cat == "church":
                return "church", "church"
            if cat == "mosque":
                return "mosque", "mosque"
            if cat == "other":
                return "other", "shrine"
            if cat == "temple":
                return "temple", ("temple" if KIND_TEMPLE_RE.search(zh) else "shrine")
        # Gate failed: fall through to the name-only rules below rather than
        # skip outright — a real worship name pattern can still admit it.

    # No (recognised, or gate-failed) religion tag: by name.
    if CHURCH2_NAME_RE.search(combined):
        return "church", "church"
    if MOSQUE2_NAME_RE.search(combined):
        return "mosque", "mosque"
    if TEMPLE2_NAME_RE.search(combined):
        return "temple", ("temple" if KIND_TEMPLE_RE.search(zh) else "shrine")

    # DECISION: rule 4's kind vocabulary (堂|殿|會館|園|岩|文化村|佛學社) names a
    # real element the task spec expects present (澳門佛學社, via the 佛學社
    # token) that rule 3's own list never reaches on its own. Applied only to
    # independently confirmed worship sites (see is_confirmed_worship) so a
    # plain building=yes candidate still needs an explicit rule-3 match.
    if confirmed and KIND_TEMPLE_RE.search(zh):
        return "temple", "temple"
    return None, None


RELIGION_ENUM = ("folk", "taoist", "buddhist", "catholic", "protestant", "christian", "islam", "hindu", "other")

# church: denomination extraction, shared between the OSM-tag branch (a
# generic evangelical/pentecostal/protestant tag) and the no-tag branch —
# both fall back to reading the specific body's Chinese short name out of
# the site's own name.
DENOMINATION_RE = re.compile(r"聖公會|浸信會|宣道會|信義會|循道|基督教會|志道堂")
CHURCH_DENOM_TAG_MAP = {
    "catholic": ("catholic", None),
    "roman_catholic": ("catholic", None),
    "anglican": ("protestant", "聖公會"),
    "baptist": ("protestant", "浸信會"),
    "lutheran": ("protestant", "信義會"),
    "methodist": ("protestant", "循道衛理"),
}
# A denomination tag that already says "protestant family" without naming a
# specific body — evangelical/pentecostal/protestant (the last one is what
# 馬禮遜教堂 carries) — is still decisive on its own: protestant, denomination
# read from the name if recognisable. Only a MISSING or truly unmapped tag
# value falls through further, to deciding protestant-vs-catholic by name.
CHURCH_GENERIC_PROTESTANT_TAGS = {"evangelical", "pentecostal", "protestant"}
# Broader than DENOMINATION_RE on purpose — this only decides IS it
# protestant (福音|Evangel|Cristo|Christ catch generic evangelical names with
# no denomination of their own), not which specific body.
CHURCH_NAME_PROTESTANT_RE = re.compile(r"聖公會|浸信|宣道|信義|循道|福音|基督教會|志道|Baptist|Anglican|Evangel|Cristo|Christ")
CHURCH_NAME_CATHOLIC_RE = re.compile(
    r"聖母|主教|修院|靜院|靜修院|避靜院|修會|天主教|牌坊|遺址|小堂|聖堂|七苦|雪地殿|慈悲者|聖十字架|聖彌額爾|"
    r"玫瑰|望德|花地瑪|嘉模|聖老楞佐|聖安多尼|聖奧斯定|聖若瑟|聖方濟各|聖保祿|Igreja|Capela|Ermida"
)

# temple: by NAME first — OSM's own religion tag on a Chinese temple is
# unreliable (媽閣廟 is tagged buddhist but reads, and is generally treated,
# as a folk/Taoist-adjacent Tin Hau-lineage temple by name).
TEMPLE_BUDDHIST_RE = re.compile(r"禪院|寺|庵|觀音|菩提|佛")
TEMPLE_TAOIST_RE = re.compile(r"呂祖|仙院|二仙|真君|北帝|玄天|三清|道")
TEMPLE_FOLK_RE = re.compile(
    r"媽閣|媽祖|天后|關帝|譚公|康公|哪咤|哪吒|包公|城隍|龍母|女媧|三聖|大王|醫靈|三婆|先鋒|"
    r"蓮峯|蓮峰|蓮溪|會館|龍王|水仙|星君|社稷|石敢當|社$"
)


def classify_religion(category: str, name_zh: str, combined: str, osm_denomination: str | None, osm_religion: str | None) -> tuple[str, str | None]:
    """(religion, denomination) for a temple/church/mosque/other site.
    `combined` (name+pt+en, or the IC row's zh/pt/en for a standalone site)
    carries the English/Portuguese words some of the name regexes need
    (Baptist, Anglican, Igreja, ...); denomination is always extracted from
    `name_zh` alone so it comes out as a clean Chinese string.
    osm_denomination/osm_religion are None for an IC standalone site (no OSM
    tags exist), which correctly skips straight to the name-based rules —
    the only information a heritage-only record has anyway."""
    if category == "mosque":
        return "islam", None
    if category == "other":
        return ("hindu", None) if osm_religion == "hindu" else ("other", None)
    if category == "church":
        denom_tag = (osm_denomination or "").lower()
        if denom_tag in CHURCH_DENOM_TAG_MAP:
            return CHURCH_DENOM_TAG_MAP[denom_tag]
        if denom_tag in CHURCH_GENERIC_PROTESTANT_TAGS:
            # A tag that already says which family it is (e.g. 馬禮遜教堂's
            # denomination=protestant) is decisive on its own — it must NOT
            # fall through to CHURCH_NAME_CATHOLIC_RE below, which a generic
            # word like "Capela" (its own pt name is "Capela Protestante de
            # Macau") would otherwise wrongly match.
            m = DENOMINATION_RE.search(name_zh)
            return "protestant", (m.group(0) if m else None)
        # No denomination tag at all (or an unmapped value): read the name.
        if CHURCH_NAME_PROTESTANT_RE.search(combined):
            m = DENOMINATION_RE.search(name_zh)
            return "protestant", (m.group(0) if m else None)
        if CHURCH_NAME_CATHOLIC_RE.search(combined):
            return "catholic", None
        return "christian", None
    if category == "temple":
        if TEMPLE_BUDDHIST_RE.search(name_zh):
            return "buddhist", None
        if TEMPLE_TAOIST_RE.search(name_zh):
            return "taoist", None
        if TEMPLE_FOLK_RE.search(name_zh):
            return "folk", None
        if osm_religion == "taoist":
            return "taoist", None
        if osm_religion == "buddhist":
            return "buddhist", None
        return "folk", None
    return "other", None  # unreachable: every category above is handled


def build_new_site(el: dict, category: str, kind: str, name_zh: str, name_pt: str | None, tags: dict) -> dict:
    lat, lon = osm_pos(el)
    combined = f"{tags.get('name', '')} {tags.get('name:pt', '')} {tags.get('name:en', '')}"
    religion, denomination = classify_religion(category, name_zh, combined, tags.get("denomination"), tags.get("religion"))
    return {
        "id": f"osm-{el['type']}-{el['id']}",
        "category": category,
        "religion": religion,
        "denomination": denomination,
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


def dedupe_new_candidates(items: list[dict]) -> list[dict]:
    """Cluster candidates within RELIGION2_DEDUPE_M whose zh names share
    their first 3 characters or contain one another (rule 6), then keep one
    per cluster: amenity=place_of_worship > qualifying building tag/ruins >
    building=yes, a way over a node, else the lower OSM id — deterministic,
    and matches every pair named in the task spec."""

    def tier(item: dict) -> int:
        t = item["tags"]
        if t.get("amenity") == "place_of_worship":
            return 1
        if QUALIFYING_BUILDING_RE.match(t.get("building") or "") or t.get("historic") == "ruins":
            return 2
        return 3

    def same_site(a: dict, b: dict) -> bool:
        if metres(a["lat"], a["lon"], b["lat"], b["lon"]) > RELIGION2_DEDUPE_M:
            return False
        # normalize_for_compare (variant characters + punctuation/space
        # stripping) — e.g. "望廈聖方濟各堂" and "望廈聖芳濟各聖堂" are the same
        # church under a mapper typo/variant, which would not share a
        # first-3-chars/containment match on the raw strings.
        za, zb = normalize_for_compare(a["zh"]), normalize_for_compare(b["zh"])
        return za[:3] == zb[:3] or za in zb or zb in za

    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if same_site(items[i], items[j]):
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(len(items)):
        clusters.setdefault(find(i), []).append(i)

    def rank(i: int) -> tuple:
        item = items[i]
        return (tier(item), 0 if item["ref"].startswith("way/") else 1, item["el"]["id"])

    return [items[min(idxs, key=rank)] for idxs in clusters.values()]


def fetch_new_osm_sites(claimed_refs: set[str]) -> dict[str, dict]:
    elements = overpass(Q_NEW_WORSHIP)
    print(f"  {len(elements)} raw elements (amenity/building/religion/ruins/name queries unioned)")

    candidates = []
    skipped_claimed = skipped_unnamed = skipped_no_cjk = skipped_not_selected = skipped_excluded = skipped_no_category = 0
    for el in elements:
        ref = osm_ref(el)
        if ref in claimed_refs:
            skipped_claimed += 1
            continue
        tags = el.get("tags") or {}
        name_zh, name_pt = split_osm_name(tags)
        lat, lon = osm_pos(el)
        if not name_zh or lat is None or lon is None:
            skipped_unnamed += 1
            continue
        if not has_cjk(name_zh):
            # DECISION: a few OSM elements (e.g. "IGLISIA NI CRSTO",
            # "Evangelize China Fellowship") carry no CJK name at all, so
            # split_osm_name's Latin-tail stripping produces a garbled "zh"
            # for them (e.g. "Evangelize") — skipped rather than written
            # with a fake Chinese name. See the report for the full list.
            print(f"  skip (no CJK name): {ref} {clean(tags.get('name'))!r}")
            skipped_no_cjk += 1
            continue
        tag_zh = clean(tags.get("name:zh"))
        if tag_zh and not tags.get("name:zh-Hant") and name_zh.startswith(tag_zh) and has_cjk(tag_zh):
            leftover = name_zh[len(tag_zh):]
            if leftover and not has_cjk(leftover) and re.search(r"[A-Za-zÀ-ÿ]", leftover):
                # DECISION: split_osm_name's Latin-tail regex assumes a space
                # before the Latin half; when a full-width bracket butts
                # straight up against it (觀音廟（九澳）Templo de Kun Iam
                # (Ká-Hó)) it cuts after the first LATER space instead,
                # leaving "Templo" stuck onto the zh half. Narrowly scoped to
                # "name:zh is a prefix, and what is left over is Latin text
                # with no CJK of its own" so it does not also strip a
                # legitimate CJK parenthetical alt-name split_osm_name
                # otherwise preserves (e.g. "聖安多尼堂 (花王堂)", where
                # name:zh is just "聖安多尼堂"). split_osm_name itself is
                # untouched — it is shared with the tudigong fetch above,
                # which must stay byte-identical.
                name_zh = tag_zh
        combined = f"{tags.get('name', '')} {tags.get('name:pt', '')} {tags.get('name:en', '')}"
        if not matches_new_worship_query(tags, combined):
            skipped_not_selected += 1
            continue
        amenity = tags.get("amenity")
        if amenity and amenity != "place_of_worship" and amenity in PLAIN_AMENITY_EXCLUDE:
            print(f"  skip (plain amenity={amenity}): {ref} {name_zh}")
            skipped_excluded += 1
            continue
        confirmed = is_confirmed_worship(tags)
        if not confirmed and (HARD_EXCLUDE_RE.search(name_zh) or RELIGION2_STREET_RE.search(name_zh)):
            print(f"  skip (hard exclusion): {ref} {name_zh}")
            skipped_excluded += 1
            continue
        category, kind = classify_new_category(tags, name_zh, combined, confirmed)
        if category is None:
            print(f"  skip (no category signal): {ref} {name_zh}")
            skipped_no_category += 1
            continue
        assoc_m = COMMA_ASSOCIATION_RE.match(name_zh)
        if assoc_m:
            # DECISION (coordinator correction): "康真君廟, 望廈坊眾互助會" names
            # the maintaining association alongside the temple — only the
            # part before the comma is the site; the pt half (the
            # association's Portuguese name) no longer applies once zh is
            # truncated to match, so it is dropped rather than left mismatched.
            name_zh, name_pt = assoc_m.group(1).strip(), None
        candidates.append(
            {"el": el, "ref": ref, "tags": tags, "zh": name_zh, "pt": name_pt, "lat": lat, "lon": lon, "category": category, "kind": kind}
        )

    print(
        f"  {len(candidates)} candidates after excluding {skipped_claimed} tudigong-claimed, "
        f"{skipped_unnamed} unnamed, {skipped_no_cjk} no-CJK-name, {skipped_not_selected} not "
        f"matching any selection clause, {skipped_excluded} excluded, {skipped_no_category} uncategorised"
    )

    winners = dedupe_new_candidates(candidates)
    print(f"  {len(winners)} sites after {RELIGION2_DEDUPE_M:.0f} m / shared-name dedupe")

    sites: dict[str, dict] = {}
    for item in winners:
        site = build_new_site(item["el"], item["category"], item["kind"], item["zh"], item["pt"], item["tags"])
        sites[site["id"]] = site
    return sites


# 文化局 (IC) heritage join for the new categories — independently fetched
# and filtered from tudigong's own fetch_heritage_rows/attach_heritage pair
# above (left untouched) rather than sharing a refactored fetch, so neither
# path can change the other's behaviour.
NEW_IC_WANT_RE = re.compile(r"堂|廟|宮|寺|殿|仙院|會館|牌坊|清真寺|修院|教堂")
# DECISION (coordinator correction): only individual-monument code series —
# MM/MT/MC (Macau/Taipa/Coloane monuments) and AM/AT/AC (Macau/Taipa/Coloane
# 具建築藝術價值之樓宇, architecturally valuable buildings) — name a single
# site. CM/SM/SC (conjuntos/ensembles) name a group of buildings or a whole
# precinct (CM002 望德堂坊 is the São Lázaro PARISH area, not one church) and
# were double-joining onto a site an MM/AM code already legitimately claimed.
NEW_IC_ALLOWED_PREFIXES = ("MM", "MT", "MC", "AM", "AT", "AC")
NEW_IC_EXCLUDE_RE = re.compile(
    r"墳場|石塊|海旁|炮台|大屋|房屋|街|馬路|舊址|大樓|安老院|仁慈堂|春草堂|公園|圖書館|學校|醫院|藥房|中心"
)
# Rule: temple FIRST (its vocabulary — 廟/宮/寺/禪院/會館/殿/仙院/公所/媽閣/觀音 —
# is specific enough that nothing here is ambiguously a church), THEN church.
# The old church-first order used a bare "堂"/"聖" catch-all that wrongly
# swallowed temple names carrying either character as part of a proper noun
# (三聖宮, 三聖廟, 譚僊聖廟, 普濟禪院(觀音堂)), sending their IC rows hunting a
# nearby OSM CHURCH when the real match was a TEMPLE a few metres away.
NEW_IC_TEMPLE_RE = re.compile(r"廟|宮|寺|禪院|觀音|會館|殿|仙院|公所|媽閣")
NEW_IC_CHURCH_RE = re.compile(r"教堂|聖堂|小堂|主教座堂|聖母|牌坊|修院|遺址|聖[^廟宮]*堂$")


def classify_ic_new_category(zh_name: str) -> str:
    if NEW_IC_TEMPLE_RE.search(zh_name):
        return "temple"
    if NEW_IC_CHURCH_RE.search(zh_name):
        return "church"
    if "堂" in zh_name:
        # DECISION: a name like "聖安多尼堂及前地（花王堂）" carries a 及前地/
        # parenthetical suffix after the 堂, so the anchored 聖[^廟宮]*堂$
        # pattern never reaches the true end of the string. By this point
        # every temple-specific word has already been ruled out, so a bare
        # "堂" left over is a worship-hall/church use.
        return "church"
    return "temple"


def fetch_new_heritage_rows(appcode: str) -> list[dict]:
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
        if code[:2] not in NEW_IC_ALLOWED_PREFIXES:
            continue
        if not NEW_IC_WANT_RE.search(zh_name) or NEW_IC_EXCLUDE_RE.search(zh_name):
            continue
        if IC_WANT_RE.search(zh_name):
            continue  # tudigong's own (福德祠 etc.) — handled by fetch_heritage_rows/attach_heritage above
        category = classify_ic_new_category(zh_name)
        en_entry, pt_entry = en_by_code.get(code, {}), pt_by_code.get(code, {})
        rows.append(
            {
                "code": code,
                "zh_name": zh_name,
                "en_name": en_entry.get("name"),
                "pt_name": pt_entry.get("name"),
                "gps": parse_ic_gps(r.get("GPS")),
                "category": category,
                "kind": category,  # standalone-site kind mirrors category: church->church, temple->temple
                "description": {
                    "zh": strip_html(r.get("Description_html")),
                    "en": en_entry.get("description", ""),
                    "pt": pt_entry.get("description", ""),
                },
            }
        )
    return rows


def longest_common_substring_len(a: str, b: str) -> int:
    match = difflib.SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b))
    return match.size


def attach_new_heritage(sites: dict[str, dict], rows: list[dict]) -> None:
    """Join each row to a same-category OSM site within RELIGION2_IC_MATCH_M:
    among every such site, prefer the one whose (normalised) zh name shares
    the longest common substring with the row's zh name, nearest metres only
    as a tie-break (mirrors attach_heritage above, but nearest-only there was
    wrong here: two same-category temples both within range of an IC point
    is common — e.g. MM022 觀音古廟（觀音仔）has both the actual 觀音古廟 OSM
    site and an unrelated 城隍廟 within 60 m, and 城隍廟 happened to be
    nearer). A standalone ic-<code> site is reserved for a row with NO
    same-category OSM site within range at all — if one exists but shares no
    substring (e.g. two names that are just genuinely different), the
    nearest one still wins rather than forking a near-duplicate point next
    to it (this is what MM024 蓮峯廟 vs OSM's 蓮峰廟 needs even after variant-
    character normalisation closes most such gaps)."""
    for h in rows:
        if h["gps"] is None:
            print(f"  WARNING: heritage {h['code']} has no parseable GPS; skipped", file=sys.stderr)
            continue
        hlat, hlon = h["gps"]
        h_norm = normalize_for_compare(h["zh_name"])
        best_id, best_d, best_lcs = None, None, None
        for sid, site in sites.items():
            if site["category"] != h["category"]:
                continue
            slon, slat = site["coordinates"]
            d = metres(hlat, hlon, slat, slon)
            if d > RELIGION2_IC_MATCH_M:
                continue
            lcs = longest_common_substring_len(h_norm, normalize_for_compare(site["name"]["zh"]))
            if best_id is None or lcs > best_lcs or (lcs == best_lcs and d < best_d):
                best_id, best_d, best_lcs = sid, d, lcs
        heritage_block = {"code": h["code"], "description": h["description"]}
        if best_d is not None and best_d <= RELIGION2_IC_MATCH_M:
            site = sites[best_id]
            site["heritage"] = heritage_block
            if h["en_name"]:
                site["name"]["en"] = h["en_name"]
            if h["pt_name"]:
                site["name"]["pt"] = h["pt_name"]
            if "ic" not in site["sources"]:
                site["sources"].append("ic")
            print(f"  heritage {h['code']} {h['zh_name']} -> {best_id} ({best_d:.1f} m, lcs={best_lcs})")
        else:
            new_id = f"ic-{h['code']}"
            # No OSM element (and so no OSM tags) exists for a standalone IC
            # site — classify_religion's tag-based branches naturally no-op
            # and fall through to its name-based rules, the only information
            # a heritage-only record has anyway.
            ic_combined = f"{h['zh_name']} {h['pt_name'] or ''} {h['en_name'] or ''}"
            religion, denomination = classify_religion(h["category"], h["zh_name"], ic_combined, None, None)
            sites[new_id] = {
                "id": new_id,
                "category": h["category"],
                "religion": religion,
                "denomination": denomination,
                "kind": h["kind"],
                "name": {"zh": h["zh_name"], "en": h["en_name"], "pt": h["pt_name"]},
                "coordinates": [round(hlon, 6), round(hlat, 6)],
                "approximate": False,
                "address": None,
                "heritage": heritage_block,
                "sources": ["ic"],
                "osm": None,
                "macaumemory": None,
            }
            print(
                f"  heritage {h['code']} {h['zh_name']} -> standalone "
                f"(no same-category OSM site within {RELIGION2_IC_MATCH_M:.0f} m at all)"
            )


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

    print("Fetching RELIGION overlay: 土地公, Chinese temples, churches, the mosque and other faiths")

    print("- OSM (Overpass): tudigong worship + 社壇 candidates")
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
    print(f"  tudigong total: {len(sites)}")

    print("- OSM (Overpass): temples, churches, the mosque, other faiths")
    claimed_refs = {s["osm"] for s in sites.values() if s.get("osm")}
    try:
        new_sites = fetch_new_osm_sites(claimed_refs)
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    sites.update(new_sites)
    print(f"  {len(new_sites)} new OSM sites (temple/church/mosque/other)")

    print("- 文化局 (IC) 文化遺產資料: heritage-listed temples/churches")
    try:
        attach_new_heritage(sites, fetch_new_heritage_rows(appcode))
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    if len(sites) < RELIGION_MIN_SITES:
        print(f"ERROR: only {len(sites)} sites (< {RELIGION_MIN_SITES}) — looks like a degenerate run, refusing to write", file=sys.stderr)
        return 1

    site_list = sorted(sites.values(), key=lambda s: s["id"])
    category_ids = [c["id"] for c in CATEGORIES]
    stats = {
        "total": len(site_list),
        "temples": sum(1 for s in site_list if s["kind"] == "temple"),
        "shrines": sum(1 for s in site_list if s["kind"] == "shrine"),
        "approximate": sum(1 for s in site_list if s["approximate"]),
        "bySource": {src: sum(1 for s in site_list if src in s["sources"]) for src in ("osm", "ic", "macaumemory")},
        "byCategory": {cid: sum(1 for s in site_list if s["category"] == cid) for cid in category_ids},
        "byReligion": {r: sum(1 for s in site_list if s["religion"] == r) for r in RELIGION_ENUM},
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
        f"\nDone. {stats['total']} sites; byCategory={stats['byCategory']}; "
        f"byReligion={stats['byReligion']}; "
        f"kinds (temple={stats['temples']}, shrine={stats['shrines']}); "
        f"approximate={stats['approximate']}; bySource={stats['bySource']}"
    )
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
