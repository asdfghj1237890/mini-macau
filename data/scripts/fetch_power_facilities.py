"""Build public/data/power-facilities.json: CEM's generation and high-voltage
transmission assets, plus a SCHEMATIC 220/110/66 kV grid drawn along the roads.

Sources
  * The LIST is CEM's「營運」page
    https://www.cem-macau.com/zh/about-cem/company-profile/operation/
    — the 輸電及接駁網絡圖 legend and the three voltage-level tables name the
    substations; the prose carries the 2025 figures (6,259.7 GWh consumed,
    9 % generated locally / 91 % imported from Guangdong, 「29 座高壓變電站、
    8 座高壓開關站」, 1,088 km of HV cable) and the interconnection history
    (1984 first 110 kV link; the 2008 / 2012 / 2022 corridors commissioned
    with 鴨涌河, 蓮花 and 北安變電站). Nothing is traced from the page's
    diagram, which is copyrighted and not georeferenced: only the facts.
  * The GEOMETRY is OpenStreetMap via Overpass, plus the OpenFreeMap basemap
    tiles the map itself draws (see osm_footprints.py for why we re-cut OSM
    outlines against the basemap's own building parts).

COUNTING. CEM's headline is「29 座高壓變電站、8 座高壓開關站」, but the page never
says which asset falls in which bucket — several sites are a 開關站及變電站, i.e.
both. What the page DOES enumerate is names: its three voltage tables list 33
distinct substation names (澳北 A and 澳北 B are separate rows there, and OSM
maps them as one site, so they collapse into one facility here) and the
interconnection prose adds 北安變電站. That is the list SUBSTATIONS below
carries — 33 facilities — and the file records CEM's own 29/8 headline in
`facts` rather than trying to reverse-engineer their split. `level` is the
HIGHEST voltage a site carries, so 澳北 (110/66) is a `sub110` and 路氹
(110/66) is a `sub110`, not a `sub66`.

MATCHING. Each CEM name is matched to an OSM `power=substation` area by its
Chinese base name — the OSM `name` tag's first whitespace-separated token,
minus a trailing parenthetical and minus the 變電站 / 開關站及變電站 / 開關站
suffix — compared for EQUALITY, never as a substring: 焚化爐 must not match
新焚化爐變電站 (a different, 110 kV station), 氹仔 must not match 新氹仔, and
路氹 must not match 路氹醫院變電站. Two names differ from OSM's spelling and
carry an explicit `osm_name`. Five CEM substations are not in OSM at all and
become marker-only records (`approximate: true`) at a named landmark anchor;
which OSM element each anchor resolved to is written into `anchors`.

The `network` block is OURS, not CEM's. 1,088 km of Macau's HV cable is
almost entirely underground and is not in OSM, so there is nothing to trace:
the edge list below is the topology CEM's own voltage tables imply (three
220 kV corridors in from the Guangdong grid, a 220 kV backbone between the
three landing substations and the power station, then every 110 kV and 66 kV
site hung off its nearest higher-level station BY ROAD), and the geometry is
an OSRM driving route so a line follows the streets instead of cutting through
blocks. The UI has to say the grid is schematic (「電網為示意」); treating it as
CEM's real cable routes would be wrong.

Run manually when the CEM page or OSM changes (not scheduled, like
fetch_water_facilities.py):
    cd data && uv run python scripts/fetch_power_facilities.py
Needs network (overpass-api.de + tiles.openfreemap.org + router.project-osrm.org).
Overpass and OSRM answers are cached in the OS temp dir, so a re-run right
after a failed one is cheap.
"""

import hashlib
import json
import math
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import LineString, Polygon

from osm_footprints import (
    MACAU_BBOX,
    TilePartIndex,
    buffered_footprint,
    building_record,
    fetch_tile_building_parts,
    metres_xy,
    overpass,
    parse_height,
    polygon_of_element,
    strip_private,
    tiles_covering,
    xy_lnglat,
)
from osrm_route import get_road_geometry, path_enters_hengqin

ROOT = Path(__file__).parent.parent.parent
OUTPUT_PATH = ROOT / "public" / "data" / "power-facilities.json"

OPERATION_PAGE = "https://www.cem-macau.com/zh/about-cem/company-profile/operation/"
OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright"
SOURCE_NAME = "澳電 (CEM) – 營運 · OpenStreetMap"
SCHEMATIC_NOTE = (
    "The 220/110/66 kV network in `network` is a schematic drawn by this script "
    "(edge list + OSRM road geometry), not CEM's cable routes: Macau's HV grid is "
    "underground and not mapped."
)
INCINERATOR_NOTE = (
    "澳門垃圾焚化中心 is the government's incineration plant (DSPA/IAM), not a CEM "
    "asset; it sells its power to CEM through 焚化爐變電站."
)

TYPES = ("plant", "incinerator", "sub220", "sub110", "sub66")
OPERATORS = ("cem", "dspa")
VOLTAGES = (220, 110, 66)
LEVEL_TYPE = {220: "sub220", 110: "sub110", 66: "sub66"}

LAT0 = 22.16  # local metres-per-degree reference, as in the other scripts
# A slab drawn from an outline the basemap does not render. Substation
# outlines are small and low; the cap keeps a mis-tagged height off the map.
OUTLINE_MAX_HEIGHT_M = 20.0

# Degenerate-run guards, mirrored by validate_output.py's v_power_facilities.
SUBSTATION_COUNT = 33
EXPECTED_COUNT = SUBSTATION_COUNT + 2  # + the power station + the incinerator
MIN_WITH_BUILDINGS = 20
MAX_APPROXIMATE = 8

# 2025 figures, straight off the CEM page. Shipped so the UI can say where the
# power comes from without hard-coding numbers in three languages of frontend.
FACTS = {
    "year": 2025,
    "consumptionGwh": 6259.7,
    "localGenerationGwh": 582.9,
    "importedGwh": 5676.8,
    "localSharePct": 9,
    "importedSharePct": 91,
    # CEM's own headline, kept verbatim next to our 33-name list — see the
    # COUNTING note in the module docstring.
    "cemHvSubstations": 29,
    "cemHvSwitchingStations": 8,
    "hvCableKm": 1088,
    "interconnectionCorridors": 3,
    "interconnectionCapacityMw": 1700,
    "interconnection220kvCircuits": 8,
    "interconnection110kvBackupCircuits": 4,
}

# ----------------------------------------------------------------------------
# Generation.
# ----------------------------------------------------------------------------
PLANTS = [
    dict(
        id="plant-coloane", type="plant", operator="cem", osm=["w192095882"],
        zh="路環發電廠", en="Coloane Power Station", pt="Central Térmica de Coloane",
        details={
            "capacityMw": 407.8,
            "unitsZh": "A 廠 271.4 MW 低速柴油機組（1978–1996 年投產，2025 年佔本地發電量 6%）；"
                       "B 廠 136.4 MW 複式循環燃氣渦輪機組（2002–2003 年投產，佔 94%）",
            "unitsEn": "Station A: 271.4 MW low-speed diesel (commissioned 1978–1996, 6% of "
                       "2025 local output); Station B: 136.4 MW combined-cycle gas turbine "
                       "(2002–2003, 94%)",
            "unitsPt": "Central A: 271,4 MW a diesel de baixa velocidade (1978–1996, 6% da "
                       "produção local em 2025); Central B: 136,4 MW de ciclo combinado a gás "
                       "(2002–2003, 94%)",
        },
    ),
    dict(
        id="incinerator", type="incinerator", operator="dspa", osm=["w530851414"],
        zh="澳門垃圾焚化中心", en="Macau Refuse Incineration Plant",
        pt="Central de Incineração de Resíduos Sólidos de Macau",
        details=None,
    ),
]

# ----------------------------------------------------------------------------
# The substations (CEM's page), highest voltage first.
#
#   kv       = the highest voltage the site carries -> `type` via LEVEL_TYPE
#   osm_name = the Chinese base name to match in OSM, when it differs from `zh`
#   anchor   = "landmark:<slug>" for the five CEM sites OSM does not map
# ----------------------------------------------------------------------------
SUBSTATIONS = [
    # --- 220 kV: the three Guangdong interconnection landing substations -----
    dict(id="sub-canal-dos-patos", kv=220, zh="鴨涌河變電站",
         en="Canal dos Patos Substation", commissioned=2008),
    dict(id="sub-lotus", kv=220, zh="蓮花變電站",
         en="Lotus Substation", commissioned=2012),
    dict(id="sub-pac-on", kv=220, zh="北安變電站",
         en="Pac On Substation", commissioned=2022),
    # --- 110 kV --------------------------------------------------------------
    # CEM lists 澳北 A 變電站 and 澳北 B 變電站 as two rows (A also carries 66 kV);
    # OSM maps the site once, as 澳北變電站 w713089729 tagged 110000;66000. One
    # facility here, carrying both units — `units` says so.
    dict(id="sub-macau-norte", kv=110, zh="澳北變電站", osm_name="澳北",
         en="Macau Norte Substation", units="A + B"),
    dict(id="sub-jardins-do-oceano", kv=110, zh="海洋花園變電站",
         en="Jardins do Oceano Substation"),
    dict(id="sub-nova-taipa", kv=110, zh="新氹仔變電站", en="Nova Taipa Substation"),
    dict(id="sub-cotai", kv=110, zh="路氹變電站", en="Cotai Substation"),
    dict(id="sub-galaxy", kv=110, zh="銀河開關站及變電站",
         en="Galaxy Switching Station and Substation"),
    dict(id="sub-parisian", kv=110, zh="巴黎人開關站及變電站",
         en="Parisian Switching Station and Substation", anchor="landmark:parisian"),
    dict(id="sub-studio-city", kv=110, zh="新濠影匯開關站及變電站",
         en="Studio City Switching Station and Substation"),
    dict(id="sub-hzmb", kv=110, zh="大橋變電站",
         en="HZMB Landing Point Substation"),
    dict(id="sub-hospital", kv=110, zh="山頂醫院變電站",
         en="Hospital Conde de São Januário Substation"),
    dict(id="sub-wynn", kv=110, zh="永利開關站及變電站",
         en="Wynn Switching Station and Substation"),
    dict(id="sub-lrt-depot", kv=110, zh="車廠變電站",
         en="LRT Depot Substation"),
    dict(id="sub-grand-lisboa-palace", kv=110, zh="上葡京開關站",
         en="Grand Lisboa Palace Switching Station",
         anchor="landmark:grand-lisboa-palace"),
    dict(id="sub-theme-park", kv=110, zh="樂園變電站", en="Theme Park Substation"),
    dict(id="sub-university", kv=110, zh="澳門大學變電站",
         en="University of Macau Substation"),
    # --- 66 kV ---------------------------------------------------------------
    # CEM writes 青州; OSM (and every street sign) writes 青洲.
    dict(id="sub-ilha-verde", kv=66, zh="青州變電站", osm_name="青洲",
         en="Ilha Verde Substation"),
    dict(id="sub-areia-preta", kv=66, zh="黑沙環變電站", en="Areia Preta Substation"),
    dict(id="sub-dona-maria", kv=66, zh="馬交石變電站", en="Dona Maria Substation"),
    dict(id="sub-sao-paulo", kv=66, zh="聖保祿變電站", en="São Paulo Substation"),
    dict(id="sub-penha", kv=66, zh="西望洋變電站", en="Penha Substation"),
    dict(id="sub-lisboa", kv=66, zh="葡京變電站", en="Lisboa Substation"),
    dict(id="sub-nape", kv=66, zh="新口岸變電站", en="NAPE Substation"),
    dict(id="sub-porto-exterior", kv=66, zh="外港變電站",
         en="Porto Exterior Substation", anchor="landmark:porto-exterior"),
    dict(id="sub-taipa", kv=66, zh="氹仔變電站", en="Taipa Substation"),
    dict(id="sub-cirs", kv=66, zh="焚化爐變電站", en="Incineration Plant Substation"),
    dict(id="sub-venetian", kv=66, zh="威尼斯人變電站", en="Venetian Substation",
         anchor="landmark:venetian"),
    dict(id="sub-city-of-dreams", kv=66, zh="新濠天地開關站及變電站",
         en="City of Dreams Switching Station and Substation"),
    # The Sheraton Grand Macao is part of the Londoner complex, which is how
    # OSM maps that block — hence the Londoner anchor for CEM's 喜來登 station.
    dict(id="sub-sheraton", kv=66, zh="喜來登開關站及變電站",
         en="Sheraton Switching Station and Substation", anchor="landmark:londoner"),
    dict(id="sub-coloane", kv=66, zh="路環變電站", en="Coloane Substation"),
    dict(id="sub-ka-ho", kv=66, zh="九澳變電站", en="Ká Hó Substation"),
    dict(id="sub-concordia", kv=66, zh="聯生變電站", en="Concórdia Substation"),
]

# Where a marker-only substation is hung. Resolved by NAME (not by a hard-coded
# id) so a re-drawn feature is picked up; the largest matching polygon wins and
# the marker goes at its representative point — inside the complex the station
# serves, which is all CEM tells us. The chosen element is written to `anchors`.
LANDMARK_ANCHORS = {
    "parisian": {"label": "澳門巴黎人 The Parisian Macau",
                 "key": "澳門巴黎人", "filter": '["name"~"澳門巴黎人"]'},
    "grand-lisboa-palace": {"label": "澳門上葡京 Grand Lisboa Palace",
                            "key": "上葡京", "filter": '["name"~"上葡京"]'},
    "venetian": {"label": "澳門威尼斯人 The Venetian Macau",
                 "key": "澳門威尼斯人", "filter": '["name"~"澳門威尼斯人"]'},
    "londoner": {"label": "澳門倫敦人 The Londoner Macao",
                 "key": "澳門倫敦人", "filter": '["name"~"澳門倫敦人"]'},
    "porto-exterior": {"label": "外港客運碼頭 Terminal Marítimo do Porto Exterior",
                       "key": "外港客運碼頭", "filter": '["name"~"外港客運碼頭"]'},
}

# ----------------------------------------------------------------------------
# The schematic grid.
#
# Three inlet nodes stand for the Guangdong (China Southern Grid) corridors.
# Each sits on the MACAU side of the border, on land and a few metres off a
# road so OSRM has something to snap to — verified against OSM's Macau boundary
# (relation 1867188) and the drivable-way set fetch_power_distribution.py uses.
# What is documented about the corridors (CEM press release 598, 2022-11;
# hengqin-cooperation.gov.mo news 7228「粵澳聯網40載」):
#   北通道 珠河甲/乙/丙線  珠海 220 kV 拱北變電站 (OSM w443670394, ~1 km NW of
#            關閘) → 鴨涌河變電站, 2008. 鴨涌河 sits on the border river, so the
#            inlet is the opposite bank: 34.6 m off 鴨涌馬路. Exact crossing
#            point of the cable is not published.
#   南通道 琴蓮甲/乙/丙線  橫琴 220 kV 琴韻變電站 (OSM w443620082, west-central
#            Hengqin) → 蓮花變電站, 3 × 220 kV cables, 2011-12-30. The inlet is
#            海濱圓形地 Rotunda Marginal (OSM w108771106), the roundabout under
#            the Lotus Bridge's Macau abutment — the bridge ways end 100 m west
#            of it — i.e. the point where the only fixed link from Hengqin
#            enters Cotai, ~2 km by road from the substation.
#   中通道 (第三通道)     珠海 220 kV 煙墩變電站 → 北安變電站, ~10.3 km of cable,
#            commissioned 2022-11; the Zhuhai section (5.75 km, all underground,
#            ~30 % under water) "穿越馬騮洲、匯金灣及十字門三條水道" — i.e. it
#            reaches Macau across the 十字門 channel from the Hengqin side, NOT
#            over the HZMB port island in the north-east (where it used to be
#            drawn). The Macau landing is not published; the inlet is placed on
#            the shore ~40 m north-west of 海洋花園變電站 (110 kV, OSM
#            w321628441) at Taipa's north-western tip facing 十字門 — a real
#            CEM site on the shore the route implies, 8 m off a service road —
#            with 10.3 − 5.75 ≈ 4.5 km of cable to 北安. It is flagged
#            `approximate`; the 110 kV station itself is not the landing, so the
#            220 kV line starts at the inlet, not at that substation.
# ----------------------------------------------------------------------------
INLET_NODES = [
    {
        "id": "inlet-canal-dos-patos", "kind": "inlet", "corridor": 1, "since": 2008,
        "name": {
            "zh": "廣東電網輸入（鴨涌河）",
            "en": "Guangdong grid infeed (Canal dos Patos)",
            "pt": "Interligação com a rede de Guangdong (Canal dos Patos)",
        },
        "coordinates": [113.540000, 22.213100],
    },
    {
        "id": "inlet-lotus", "kind": "inlet", "corridor": 2, "since": 2012,
        "name": {
            "zh": "廣東電網輸入（蓮花）",
            "en": "Guangdong grid infeed (Lotus Bridge)",
            "pt": "Interligação com a rede de Guangdong (Flor de Lótus)",
        },
        # The north-east edge of the roundabout ring: from the ring's centre
        # OSRM snaps onto the bridge deck above it and drives into Hengqin.
        "coordinates": [113.552900, 22.140200],
    },
    {
        "id": "inlet-pac-on", "kind": "inlet", "corridor": 3, "since": 2022,
        "name": {
            "zh": "廣東電網輸入（海洋花園 → 北安）",
            "en": "Guangdong grid infeed (Jardins do Oceano → Pac On)",
            "pt": "Interligação com a rede de Guangdong (Jardins do Oceano → Pac On)",
        },
        "coordinates": [113.539600, 22.163440],
        # Landing point estimated from the published route (see above).
        "approximate": True,
    },
]

# The 220 kV backbone, hand-written from CEM's interconnection description
# (three corridors, 8 × 220 kV circuits, the three landing substations, and the
# power station at the south end). 蓮花 → 路環發電廠 passes the plant's own
# 路環B變電站 (OSM w321628440), which sits ~90 m inside the plant compound, so
# the routed line reaches it as part of reaching the plant.
BACKBONE_220 = [
    ("inlet-canal-dos-patos", "sub-canal-dos-patos"),
    ("inlet-lotus", "sub-lotus"),
    ("inlet-pac-on", "sub-pac-on"),
    ("sub-canal-dos-patos", "sub-pac-on"),
    ("sub-pac-on", "sub-lotus"),
    ("sub-lotus", "plant-coloane"),
]
# The incineration plant sells its power to CEM through 焚化爐變電站, 40 m away.
GENERATOR_LINKS = [("incinerator", "sub-cirs", 66)]
# How many straight-line candidates are routed before the nearest-by-road
# parent is picked. Three is enough: the 4th-nearest in a straight line has
# never won on road distance in Macau, and every extra candidate is an OSRM call.
NEAREST_CANDIDATES = 3

# Local connectors, exactly as in fetch_water_facilities.py: a hop shorter than
# LOCAL_CONNECTOR_M is plumbing inside one site, not a road journey, and OSRM
# answers it by sending a car round the block; a short hop whose road route is
# more than DETOUR_RATIO times the straight line is drawn straight too. Those
# lines carry `"direct": true`; `fallback` stays false, because a stub is a
# choice and a fallback is a failure.
LOCAL_CONNECTOR_M = 150.0
DETOUR_RATIO = 3.0
DETOUR_MAX_STRAIGHT_M = 600.0
# OSRM answers a 7 km route with ~370 vertices, which is a survey of the kerb
# line — and this file is written with `indent=2`, so every vertex costs ~50
# bytes. A schematic 220 kV line does not need lane-level detail, so a routed
# line is Douglas-Peucker'd in metres afterwards. 10 m is invisible at the zoom
# the grid becomes readable and takes the file from 427 KiB to comfortably
# inside MAX_BYTES; the endpoints survive simplification by construction, so a
# line still starts and ends exactly on its two stations.
LINE_SIMPLIFY_M = 10.0
# A straight line is a visible lie about where a cable runs, so a handful is
# tolerable but a silent OSRM outage (every edge straight) must fail the run.
MAX_LINE_FALLBACKS = 3
# Budget, mirrored by validate_output.py. The overlay is lazy-loaded but it
# still ships with the site, and this file is 3D geometry, not a document.
MAX_BYTES = 400 * 1024

OSRM_CACHE_DIR = Path(tempfile.gettempdir()) / "mini-macau-osrm-cache"
OSRM_CACHE_TTL_S = 7 * 24 * 3600
OSRM_PACING_S = 1.0  # the public demo server is a shared courtesy


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def osm_ref(el: dict) -> str:
    return f"{el['type'][0]}{el['id']}"


def base_name(osm_name: str) -> str:
    """The Chinese base name of an OSM substation: first whitespace token,
    minus a trailing parenthetical, minus the 變電站 / 開關站 suffix.

    「西望洋變電站 (磨盤山變電站) Subestação Penha」 -> 西望洋
    「新濠天地開關站及變電站 Subestação City of Dreams」 -> 新濠天地
    """
    head = (osm_name or "").split()[0] if (osm_name or "").split() else ""
    head = head.split("(")[0].split("（")[0].strip()
    for suffix in ("開關站及變電站", "變電站及開關站", "變電站", "開關站"):
        if head.endswith(suffix):
            return head[: -len(suffix)]
    return head


def want_name(f: dict) -> str:
    """The base name a table row expects to find in OSM."""
    return f.get("osm_name") or base_name(f["zh"])


def parse_voltages(tag: str | None) -> list[int]:
    """OSM `voltage` is a `;`-separated list in volts."""
    out = []
    for part in (tag or "").split(";"):
        part = part.strip()
        if part.isdigit():
            out.append(int(part) // 1000)
    return out


def line_length_m(coords: list[list[float]]) -> float:
    """Length along the emitted polyline (so it matches what the map draws,
    endpoint stubs included — OSRM's own `distance` stops at the snapped ends)."""
    pts = [metres_xy(x, y, LAT0) for x, y in coords]
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def straight_m(a, b) -> float:
    return math.dist(metres_xy(a[0], a[1], LAT0), metres_xy(b[0], b[1], LAT0))


def simplify_line(coords: list[list[float]]) -> list[list[float]]:
    """Douglas-Peucker in metres, at LINE_SIMPLIFY_M. Endpoints always survive."""
    if len(coords) < 3:
        return coords
    metric = LineString([metres_xy(x, y, LAT0) for x, y in coords])
    simple = list(metric.simplify(LINE_SIMPLIFY_M).coords)
    out: list[list[float]] = []
    for x, y in simple:
        lng, lat = xy_lnglat(x, y, LAT0)
        point = [round(lng, 6), round(lat, 6)]
        if not out or out[-1] != point:
            out.append(point)
    return out if len(out) >= 2 else coords


# ----------------------------------------------------------------------------
# line geometry (OSRM) — the water pipeline's rules, verbatim
# ----------------------------------------------------------------------------
def routed_line(a: list[float], b: list[float]) -> list[list[float]] | None:
    """Cached OSRM driving geometry a → b; None when it is unusable.

    Unusable means OSRM failed, answered with fewer than two points, or routed
    through Hengqin — a path that only exists on the mainland side of the
    border is not a path. Only successes are cached, so a transient outage is
    retried on the re-run.
    """
    key = f"driving|{a[0]:.6f},{a[1]:.6f};{b[0]:.6f},{b[1]:.6f}"
    OSRM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = OSRM_CACHE_DIR / (hashlib.sha1(key.encode("utf-8")).hexdigest() + ".json")
    if cache_file.exists() and time.time() - cache_file.stat().st_mtime < OSRM_CACHE_TTL_S:
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            # A truncated entry (the disk filled mid-write) is a miss, not a crash.
            cache_file.unlink()
    coords = get_road_geometry([list(a), list(b)], profile="driving")
    time.sleep(OSRM_PACING_S)
    if not coords or len(coords) < 2 or path_enters_hengqin(coords):
        return None
    cache_file.write_text(json.dumps(coords), encoding="utf-8")
    return coords


def line_geometry(a: list[float], b: list[float]) -> tuple[list[list[float]], bool, bool]:
    """(coordinates, direct, fallback) for one schematic line.

    OSRM snaps to the nearest road, which can be a hundred metres from a
    substation marker, so the exact marker coordinates are pinned back on: a
    line must start and end at the station it serves, not near it.
    """
    start = [round(a[0], 6), round(a[1], 6)]
    end = [round(b[0], 6), round(b[1], 6)]
    straight = [start, end]
    length = line_length_m(straight)
    if length < LOCAL_CONNECTOR_M:
        return straight, True, False  # same site: not worth a routing call

    # A cable does not obey one-way streets, so the route is asked for in both
    # directions and the shorter one wins (flipped so the line still runs from
    # `a` to `b`). Driving OUT of the 海洋花園 pocket at Taipa's north-western
    # tip, for instance, is an 11 km loop over the bridges to the peninsula
    # and back, while driving in is the 5.6 km along the north shore.
    routed = routed_line(a, b)
    reverse = routed_line(b, a)
    if reverse is not None:
        reverse = list(reversed(reverse))
        if routed is None or line_length_m(reverse) < line_length_m(routed):
            routed = reverse
    if routed is None:
        return straight, False, True  # OSRM failed; the line is a guess

    line = simplify_line([[round(c[0], 6), round(c[1], 6)] for c in routed])
    if line[0] != start:
        line.insert(0, start)
    if line[-1] != end:
        line.append(end)
    if length < DETOUR_MAX_STRAIGHT_M and line_length_m(line) > DETOUR_RATIO * length:
        return straight, True, False  # the roads take the long way round
    return line, False, False


def nearest_parent(child: dict, candidates: list[dict]) -> tuple[dict, tuple]:
    """The candidate closest BY ROAD, and the geometry of the line to it.

    Straight-line distance is only a pre-filter: on a peninsula split by two
    bridges the nearest station as the crow flies is often across the water.
    The NEAREST_CANDIDATES closest in a straight line are routed and the
    shortest routed line wins; if every route fails, the straight-line nearest
    is used (and carries `fallback`).
    """
    shortlist = sorted(candidates, key=lambda c: straight_m(child["coordinates"],
                                                            c["coordinates"]))
    shortlist = shortlist[:NEAREST_CANDIDATES]
    best = None
    for cand in shortlist:
        geom = line_geometry(child["coordinates"], cand["coordinates"])
        length = line_length_m(geom[0])
        # A fallback is a failed route, not a short road: never let one win on
        # length against a real routed candidate.
        rank = (1 if geom[2] else 0, length)
        if best is None or rank < best[0]:
            best = (rank, cand, geom)
    return best[1], best[2]


# ----------------------------------------------------------------------------
# OSM fetches
# ----------------------------------------------------------------------------
def fetch_substations() -> list[dict]:
    """Every named `power=substation` area in and around Macau, with geometry."""
    print(f"Fetching power=substation areas in {MACAU_BBOX}")
    return overpass(
        f'[out:json][timeout:180][bbox:{MACAU_BBOX}];'
        'nwr["power"="substation"];out geom;'
    )


def fetch_plants() -> dict[str, dict]:
    """The two generation compounds, re-queried by id rather than trusted."""
    refs = [ref for p in PLANTS for ref in p["osm"]]
    kinds = {"w": "way", "r": "relation", "n": "node"}
    body = "".join(f"{kinds[r[0]]}({r[1:]});" for r in refs)
    print(f"Fetching {len(refs)} generation compounds")
    els = overpass(f"[out:json][timeout:120];({body});out geom;")
    found = {osm_ref(el): el for el in els}
    missing = [r for r in refs if r not in found]
    if missing:
        raise RuntimeError(f"OSM ids in PLANTS no longer exist: {missing}")
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


def fetch_landmark_anchors(slugs: list[str]) -> dict[str, dict]:
    """Resolve every landmark anchor by name; returns slug -> anchor record."""
    body = "".join(f'nwr{LANDMARK_ANCHORS[s]["filter"]};' for s in slugs)
    print(f"Fetching {len(slugs)} landmark anchors by name")
    els = overpass(f"[out:json][timeout:120][bbox:{MACAU_BBOX}];({body});out geom;")

    resolved: dict[str, dict] = {}
    for slug in slugs:
        spec = LANDMARK_ANCHORS[slug]
        best = None
        for el in els:
            poly = polygon_of_element(el)
            if poly is None or poly.is_empty:
                continue
            # The one query returns every anchor's matches; keep the ones whose
            # name carries this anchor's Chinese key.
            if spec["key"] not in (el.get("tags", {}).get("name") or ""):
                continue
            if best is None or poly.area > best[1].area:
                best = (el, poly)
        if best is None:
            raise RuntimeError(f"landmark anchor '{slug}' ({spec['label']}) not found in OSM")
        el, poly = best
        rp = poly.representative_point()
        resolved[slug] = {
            "osmId": osm_ref(el),
            "name": el.get("tags", {}).get("name") or spec["label"],
            "coordinates": [round(rp.x, 6), round(rp.y, 6)],
        }
        print(f"  landmark:{slug} -> {resolved[slug]['osmId']} "
              f"{resolved[slug]['name'].split()[0]}")
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
        "name": (el.get("tags", {}).get("name") or "").split()[0] or None,
        "height": round(min(h, OUTLINE_MAX_HEIGHT_M), 1),
        "minHeight": mh,
        "kind": "outline",
        "coordinates": buffered_footprint(poly, LAT0),
        "_poly": poly,
    }


def part_as_record(part: dict, osm_id: str, name: str | None, kind: str) -> dict:
    return {
        "osmId": osm_id,
        "name": name,
        "kind": kind,
        "height": round(min(part["height"], OUTLINE_MAX_HEIGHT_M * 6), 1),
        "minHeight": round(part["minHeight"], 1),
        "coordinates": buffered_footprint(part["_poly"], LAT0),
        "_poly": part["_poly"],
    }


def finalize(rec: dict, kind: str) -> dict:
    rec["kind"] = kind
    return rec


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def run() -> int:
    # --- match the CEM table against OSM -------------------------------------
    elements = fetch_substations()
    by_base: dict[str, list[dict]] = {}
    for el in elements:
        poly = polygon_of_element(el)
        if poly is None or poly.is_empty:
            continue  # nodes and open ways carry no footprint
        name = el.get("tags", {}).get("name") or ""
        key = base_name(name)
        if key:
            by_base.setdefault(key, []).append(el)
    print(f"  {len(elements)} power=substation elements, "
          f"{len(by_base)} distinct Chinese base names with a polygon")

    matched: dict[str, tuple[dict, Polygon]] = {}
    unmatched: list[dict] = []
    for f in SUBSTATIONS:
        cands = by_base.get(want_name(f), [])
        if not cands:
            unmatched.append(f)
            continue
        # Two OSM ways can carry the same name (大橋變電站 is mapped twice, one
        # of them untagged): prefer the one that declares a voltage, then the
        # larger polygon.
        def rank(el):
            poly = polygon_of_element(el)
            return (0 if parse_voltages(el.get("tags", {}).get("voltage")) else 1,
                    -poly.area)
        el = sorted(cands, key=rank)[0]
        poly = polygon_of_element(el)
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
        matched[f["id"]] = (el, poly)
        if len(cands) > 1:
            print(f"  {f['id']}: {len(cands)} OSM ways named {want_name(f)}; "
                  f"chose {osm_ref(el)}")

    print(f"\nMatched {len(matched)}/{len(SUBSTATIONS)} CEM substations to OSM; "
          f"{len(unmatched)} need a landmark anchor")
    for f in unmatched:
        if not f.get("anchor"):
            raise RuntimeError(
                f"{f['id']} ({f['zh']}) is not in OSM and has no `anchor` in the table"
            )
        print(f"  ~ {f['id']:<26} {f['zh']:<12} -> {f['anchor']}")
    stale = [f["id"] for f in SUBSTATIONS if f.get("anchor") and f["id"] in matched]
    if stale:
        print(f"  NOTE: OSM now maps {stale} — drop their `anchor` from the table")

    anchors = fetch_landmark_anchors(
        sorted({f["anchor"].split(":", 1)[1] for f in unmatched})
    )

    # --- the two generation compounds ---------------------------------------
    plant_els = fetch_plants()
    plant_areas: dict[str, list[tuple[dict, Polygon]]] = {}
    for p in PLANTS:
        pairs = []
        for ref in p["osm"]:
            el = plant_els[ref]
            poly = polygon_of_element(el)
            if poly is None or poly.is_empty:
                raise RuntimeError(f"{p['id']}: OSM {ref} has no usable polygon")
            geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
            pairs += [(el, g) for g in geoms]
        plant_areas[p["id"]] = pairs

    compound_polys = [g for pairs in plant_areas.values() for _, g in pairs]
    building_els = fetch_buildings_in(compound_polys)
    print(f"  {len(building_els)} building features inside the compounds")

    claimed: dict[str, list[dict]] = {p["id"]: [] for p in PLANTS}
    seen_osm: set[str] = set()
    for el in building_els:
        for rec in records_from_element(el):
            if rec["osmId"] in seen_osm:
                continue
            rep = rec["_poly"].representative_point()
            for pid, pairs in plant_areas.items():
                if any(g.contains(rep) for _, g in pairs):
                    seen_osm.add(rec["osmId"])
                    claimed[pid].append(finalize(rec, "building"))
                    break

    # --- re-cut everything against the basemap's own building parts ----------
    # A substation outline is NOT queried for OSM buildings: the casino ones sit
    # inside a podium, and a building query would hand back the whole resort.
    # Instead the outline claims whatever the basemap actually draws inside it
    # (TilePartIndex.within needs ≥ 50 % of a PART inside, so a resort-sized
    # block is correctly rejected) and otherwise becomes a capped slab.
    sub_polys = [poly for _, poly in matched.values()]
    geoms_for_tiles = [rec["_poly"] for recs in claimed.values() for rec in recs]
    geoms_for_tiles += compound_polys + sub_polys
    tiles = tiles_covering(geoms_for_tiles)
    print(f"Re-cutting footprints against basemap tiles ({len(tiles)} tiles)")
    index = TilePartIndex(fetch_tile_building_parts(tiles))

    recut = 0
    for pid, recs in claimed.items():
        new_recs: list[dict] = []
        for rec in recs:
            inside = index.within(rec["_poly"])
            if not inside:
                rec["height"] = round(min(rec["height"], OUTLINE_MAX_HEIGHT_M), 1)
                new_recs.append(finalize(rec, "outline"))
                continue
            recut += 1
            for i, part in enumerate(inside):
                osm_id = f"{rec['osmId']}#p{i}" if i else rec["osmId"]
                new_recs.append(part_as_record(part, osm_id, rec.get("name"), "building"))
        claimed[pid] = new_recs
    for pid, pairs in plant_areas.items():
        if claimed[pid]:
            continue
        for el, g in pairs:  # pragma: no cover - both compounds have buildings
            claimed[pid].append(outline_record(el, g, len(claimed[pid])))
    print(f"  {recut} OSM footprints replaced by the basemap's parts")

    sub_buildings: dict[str, list[dict]] = {}
    tile_backed = 0
    for fid, (el, poly) in matched.items():
        inside = index.within(poly)
        if inside:
            tile_backed += 1
            sub_buildings[fid] = [part_as_record(part, part["id"],
                                                 base_name(el.get("tags", {}).get("name") or "") or None,
                                                 "tile")
                                  for part in inside]
        else:
            sub_buildings[fid] = [outline_record(el, poly, 0)]
    print(f"  {tile_backed}/{len(matched)} substations backed by basemap parts; "
          f"{len(matched) - tile_backed} drawn as outline slabs")

    # --- assemble -------------------------------------------------------------
    facilities: list[dict] = []
    for p in PLANTS:
        tags = {}
        for ref in p["osm"]:
            tags.update(plant_els[ref].get("tags", {}))
        buildings = [strip_private(b) for b in claimed[p["id"]]]
        polys = [Polygon(b["coordinates"][0]) for b in buildings] or \
                [g for _, g in plant_areas[p["id"]]]
        centre = max(polys, key=lambda g: g.area).representative_point() \
            if buildings else plant_areas[p["id"]][0][1].representative_point()
        facilities.append({
            "id": p["id"],
            "type": p["type"],
            "operator": p["operator"],
            "voltageKv": None,
            "name": {"zh": p["zh"], "en": p["en"],
                     "pt": tags.get("name:pt") or p["pt"]},
            "coordinates": [round(centre.x, 6), round(centre.y, 6)],
            "approximate": False,
            "anchor": None,
            "source": "cem" if p["operator"] == "cem" else "dspa",
            "osm": list(p["osm"]),
            "buildings": buildings,
            "details": p["details"],
        })

    for f in SUBSTATIONS:
        if f["id"] in matched:
            el, poly = matched[f["id"]]
            tags = el.get("tags", {})
            buildings = [strip_private(b) for b in sub_buildings[f["id"]]]
            rp = poly.representative_point()
            record = {
                "coordinates": [round(rp.x, 6), round(rp.y, 6)],
                "approximate": False,
                "anchor": None,
                "osm": [osm_ref(el)],
                "buildings": buildings,
                "pt": tags.get("name:pt") or "",
            }
        else:
            anchor = f["anchor"]
            base = anchors[anchor.split(":", 1)[1]]["coordinates"]
            record = {
                "coordinates": list(base),
                "approximate": True,
                "anchor": anchor,
                "osm": [],
                "buildings": [],
                "pt": "",
            }
        facilities.append({
            "id": f["id"],
            "type": LEVEL_TYPE[f["kv"]],
            "operator": "cem",
            "voltageKv": f["kv"],
            "name": {"zh": f["zh"], "en": f["en"], "pt": record["pt"]},
            "coordinates": record["coordinates"],
            "approximate": record["approximate"],
            "anchor": record["anchor"],
            "source": "cem",
            "osm": record["osm"],
            "buildings": record["buildings"],
            "details": ({"units": f["units"]} if f.get("units") else
                        {"commissioned": f["commissioned"]} if f.get("commissioned") else None),
        })

    # --- the schematic grid ---------------------------------------------------
    network = build_network(facilities)
    lines = network["lines"]

    # --- degenerate-run guard -------------------------------------------------
    problems = []
    if len(facilities) != EXPECTED_COUNT:
        problems.append(f"{len(facilities)} facilities, expected {EXPECTED_COUNT}")
    if len({f["id"] for f in facilities}) != len(facilities):
        problems.append("duplicate facility ids")
    subs = [f for f in facilities if f["voltageKv"] is not None]
    if len(subs) != SUBSTATION_COUNT:
        problems.append(f"{len(subs)} substations, expected {SUBSTATION_COUNT}")
    bad_types = sorted({f["type"] for f in facilities} - set(TYPES))
    if bad_types:
        problems.append(f"unknown type(s): {bad_types}")
    bad_ops = sorted({f["operator"] for f in facilities} - set(OPERATORS))
    if bad_ops:
        problems.append(f"unknown operator(s): {bad_ops}")
    bad_kv = sorted({f["voltageKv"] for f in subs} - set(VOLTAGES))
    if bad_kv:
        problems.append(f"unknown voltage(s): {bad_kv}")
    with_buildings = sum(1 for f in facilities if f["buildings"])
    if with_buildings < MIN_WITH_BUILDINGS:
        problems.append(f"only {with_buildings} facilities have buildings "
                        f"(< {MIN_WITH_BUILDINGS})")
    approximate = [f["id"] for f in facilities if f["approximate"]]
    if len(approximate) > MAX_APPROXIMATE:
        problems.append(f"{len(approximate)} approximate facilities "
                        f"(> {MAX_APPROXIMATE}): {approximate}")

    node_ids = {n["id"] for n in network["nodes"]}
    known = {f["id"] for f in facilities} | node_ids
    if len({ln["id"] for ln in lines}) != len(lines):
        problems.append("duplicate line ids")
    dangling = sorted({e for ln in lines for e in (ln["from"], ln["to"]) if e not in known})
    if dangling:
        problems.append(f"line endpoint(s) resolve to nothing: {dangling}")
    short = [ln["id"] for ln in lines if len(ln["coordinates"]) < 2]
    if short:
        problems.append(f"line(s) with fewer than 2 coordinates: {short}")
    bent = [ln["id"] for ln in lines if ln["direct"] and len(ln["coordinates"]) != 2]
    if bent:
        problems.append(f"direct line(s) that are not a 2-point segment: {bent}")
    connected = {e for ln in lines for e in (ln["from"], ln["to"])}
    orphans = sorted(known - connected)
    if orphans:
        problems.append(f"facilit(ies)/node(s) with no line: {orphans}")
    fallbacks = [ln["id"] for ln in lines if ln["fallback"]]
    if len(fallbacks) > MAX_LINE_FALLBACKS:
        problems.append(f"{len(fallbacks)} lines fell back to straight lines "
                        f"(> {MAX_LINE_FALLBACKS}) — OSRM is probably down: {fallbacks}")

    if problems:
        for p in problems:
            print(f"ERROR: {p}", file=sys.stderr)
        print("refusing to write", file=sys.stderr)
        return 1

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "sources": {
            "name": SOURCE_NAME,
            "operation": OPERATION_PAGE,
            "osm": OSM_COPYRIGHT,
            "network": SCHEMATIC_NOTE,
            "incinerator": INCINERATOR_NOTE,
        },
        "facts": FACTS,
        # Which OSM element each `landmark:<slug>` anchor resolved to, so a
        # reader can see where an approximate marker was hung.
        "anchors": {f"landmark:{slug}": rec for slug, rec in sorted(anchors.items())},
        "facilities": facilities,
        # Our schematic, not CEM's cable routes — see the module docstring.
        "network": network,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    by_type = {t: sum(1 for f in facilities if f["type"] == t) for t in TYPES}
    total_b = sum(len(f["buildings"]) for f in facilities)
    size = OUTPUT_PATH.stat().st_size
    print(f"\nDone. {len(facilities)} facilities ("
          + ", ".join(f"{t} {n}" for t, n in by_type.items() if n)
          + f"), {len(facilities) - len(approximate)} exact / {len(approximate)} "
          f"approximate, {total_b} buildings")
    for f in facilities:
        mark = "~" if f["approximate"] else " "
        kv = f"{f['voltageKv']:>3} kV" if f["voltageKv"] else "     "
        print(f" {mark}{f['id']:<26} {f['type']:<12} {kv} b={len(f['buildings']):<3} "
              f"{','.join(f['osm']) or f['anchor'] or '-':<24} {f['name']['zh']}")

    by_kv = {kv: sum(1 for ln in lines if ln["voltageKv"] == kv) for kv in VOLTAGES}
    n_direct = sum(1 for ln in lines if ln["direct"])
    total_km = sum(ln["lengthM"] for ln in lines) / 1000.0
    print(f"Network: {len(lines)} lines ("
          + ", ".join(f"{kv} kV {n}" for kv, n in by_kv.items())
          + f"), {n_direct} direct connectors / {len(lines) - n_direct} routed, "
          f"{len(fallbacks)} straight-line fallbacks, {total_km:.1f} km total, "
          f"{len(network['nodes'])} inlet nodes")
    print(f"Wrote {OUTPUT_PATH} ({size / 1024:.1f} KiB, "
          f"{'OK' if size < MAX_BYTES else 'OVER'} the {MAX_BYTES / 1024:.0f} KiB budget)")
    return 0 if size < MAX_BYTES else 1


def build_network(facilities: list[dict]) -> dict:
    """The `network` block: the three inlet nodes plus every schematic line.

    220 kV is the hand-written backbone; every 110 kV and 66 kV station is hung
    off its nearest higher-level station BY ROAD (see nearest_parent).
    """
    by_id = {f["id"]: f for f in facilities}
    coords = {f["id"]: f["coordinates"] for f in facilities}
    for node in INLET_NODES:
        coords[node["id"]] = node["coordinates"]

    sub220 = [f for f in facilities if f["type"] == "sub220"]
    sub110 = [f for f in facilities if f["type"] == "sub110"]
    sub66 = [f for f in facilities if f["type"] == "sub66"]
    # 澳北 is a 110 kV station that other 110 kV stations hang off, so it needs
    # a 220 kV parent of its own rather than being its own candidate.
    hub110 = by_id["sub-macau-norte"]

    edges: list[tuple[str, str, int]] = [(a, b, 220) for a, b in BACKBONE_220]
    edges += [(a, b, kv) for a, b, kv in GENERATOR_LINKS]

    print(f"\nHanging {len(sub110)} × 110 kV and {len(sub66)} × 66 kV stations off "
          "their nearest higher-level station by road")
    routed_geom: dict[tuple[str, str], tuple] = {}
    for child in sub110:
        pool = sub220 if child is hub110 else sub220 + [hub110]
        parent, geom = nearest_parent(child, pool)
        edges.append((child["id"], parent["id"], 110))
        routed_geom[(child["id"], parent["id"])] = geom
    for child in sub66:
        parent, geom = nearest_parent(child, sub220 + sub110)
        edges.append((child["id"], parent["id"], 66))
        routed_geom[(child["id"], parent["id"])] = geom

    lines = []
    for src, dst, kv in edges:
        geom = routed_geom.get((src, dst))
        line, direct, fallback = geom if geom else line_geometry(coords[src], coords[dst])
        length = line_length_m(line)
        straight = line_length_m([line[0], line[-1]])
        lines.append({
            "id": f"{kv}kv-{src}-{dst}",
            "from": src,
            "to": dst,
            "voltageKv": kv,
            "lengthM": int(round(length)),
            "direct": direct,
            "fallback": fallback,
            "coordinates": line,
        })
        mark = "~" if fallback else ("=" if direct else " ")
        ratio = length / straight if straight > 0 else 1.0
        print(f" {mark}{kv:>3} kV {src:<26} -> {dst:<26} {len(line):>4} pts "
              f"{length:>7.0f} m  straight {straight:>6.0f} m  x{ratio:.2f}"
              + ("  (straight-line FALLBACK)" if fallback
                 else "  (direct connector)" if direct else ""))
    return {"nodes": INLET_NODES, "lines": lines}


if __name__ == "__main__":
    sys.exit(run())
