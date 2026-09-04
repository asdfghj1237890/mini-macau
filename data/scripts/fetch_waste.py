"""
Daily fetch: IAM (市政署) refuse rooms / compacting bins + DSPA (環境保護局)
recycling-point lists from the Macau open-data platform, normalised into
public/data/waste.json for the map's WASTE overlay.

Seven data.gov.mo datasets plus IAM's facility-map JSON (all WGS84) collapse into nine site
types:

  IAM, via the same ZIP-download endpoint as fetch_toilets.py (no APPCODE):
    * 57964cb5-5868-47e5-bd8d-334385467a21  垃圾房             -> refuse_room  (114)
    * e49ac4a5-83c1-48f8-8317-e783f4a1867e  壓縮式垃圾收集點    -> compactor    (140)

  DSPA, via the dspa.apigateway.data.gov.mo API gateway (POST, empty body,
  header `Authorization: APPCODE <key>` — the same *public* APPCODE as
  fetch_car_parks.py's DSAT gateway, read from DATAGOVMO_APPCODE, never
  hard-coded — see the check at the top of run()):
    * 12d42ec3-6d61-4daf-b713-eecbfcff5daa  智能回收機          -> smart_machine (67)
    * db6f226e-1fbe-413a-b558-b5c2b2b0be52  三色資源回收點      -> three_colour  (311)
    * d358a990-06f2-4a65-9045-7543ae9f826f  電腦及通訊設備回收點 -> e_waste       (56)
    * 33264820-4523-4e8b-a91a-9089f922220a  光管回收點         -\
    * a536616e-d870-4137-8dd6-0b2125a6c2a5  電池回收點         -/-> lamp_battery (406)
      (光管/lightBulb and 電池/battery are published as two IDENTICAL lists —
      same 406 ids, names and coordinates. Sites are built from the lightBulb
      list only; both dataset ids are still fetched and both cited in
      `sources`. A mismatch between the two id sets is logged as a warning,
      not treated as fatal — see the check after the fetch loop in run().)

Round 2 adds a seventh site type and three more top-level blocks:
  * `refuse_station` (42, sort key between refuse_room and compactor): IAM's
    *combined* 全澳垃圾收集設施 list (6c7617b7-8165-4564-9b51-055ddda8b3ad,
    `iam-refuse-station` source), fetched with a GET — not POST like the DSPA
    gateway above — against iam.apigateway.data.gov.mo, same APPCODE header.
    Its 296 rows mix in the refuse_room/compactor types already covered by
    their own dedicated datasets above, so only `typeZh == "垃圾站"` is kept
    (see build_refuse_station()). Unlike every other source, this source's
    `sources[].count` is the FILTERED site count (42), not the raw fetch size
    (296) — see the comment at that source's entry in run().
  * `facilities[]` (3): a hand-placed hazardous-waste treatment station plus
    two landfill polygons fetched fresh from OpenStreetMap (Overpass
    `out geom`, ways 552848944 / 552740242) via osm_footprints.overpass() —
    see FACILITIES_TABLE / fetch_landfill_polygons().
  * `ecoStations[]` (10): DSPA's 環保加Fun站, hand-transcribed like
    fetch_power_facilities.py's SUBSTATIONS table — no open dataset publishes
    these. See ECO_STATIONS.
  * `incinerator`: DSPA's monthly 焚化中心 statistics, BEST-EFFORT (a failure
    did not fail the run — the block was written as `null`). RETIRED round 4:
    this now lives in public/data/dspa-stats.json (fetch_dspa_stats.py), which
    carries the incinerator series alongside the hazardous station, the
    landfill and the four DSPA-published wastewater treatment plants. See the
    round 4 note below.

Round 4 adds a `statsKey` to every entry in `facilities[]` (null where no
monthly series exists) and five more entries there, kind `wwtp`: the DSPA
sewage treatment plants, each with its own OSM building footprints via the
same "compound" claim-buildings-inside + recut-against-basemap-tiles pipeline
fetch_water_facilities.py / fetch_power_facilities.py use for their own
plants — copied here, not shared, like everything else in this file (see
WWTP_TABLE / build_wwtp_facilities()). `statsKey` points into
public/data/dspa-stats.json: "hazardous" / "landfill" / "wwtp.<plant>" for
five of the eight facilities, `null` for the two with no monthly series (the
Ka Ho ash landfill, wwtp-mia — see fetch_dspa_stats.py's docstring for why
wwtp-mia has none). The incinerator's own monthly stats moved OUT of this
file entirely (see the retired bullet above) — `facilities[]` has no
`kind == "incinerator"`; the incineration plant itself already appears on the
POWER overlay (fetch_power_facilities.py) and is not duplicated here.

Round 3 adds two more site types, both filtered from one shared feed:
  * `glass` (5) and `clothing` (16): IAM's public facility-map JSON
    (https://www.iam.gov.mo/macaohygiene/data/facility_c.json — plain GET, a
    browser-like User-Agent, no APPCODE at all; this is NOT a data.gov.mo
    dataset, unlike everything else in this file). 1,457 rows across many
    categories (public toilets, pet-waste bins, dog runs, …); only
    `category == "玻璃樽公共回收點"` / `"全澳衣物公共回收點"` are kept (see
    build_iam_map_sites()). The two types share one fetch and one raw record
    list but get their own `sources` entries (`iam-map-glass`,
    `iam-map-clothing`), each `upstreamUpdatedAt` the max `lastModDate` among
    that type's own rows. Unlike every other type, `closed` here is derived
    from a date window (`suspendStartDate`/`suspendEndDate` span today, Macau
    date) rather than a tempClose/status flag — see parse_suspend_ymd().
    Genuinely small counts (5 / 16), so the degenerate-fetch floor is a table
    (TYPE_MIN_PER_TYPE), not the one-size-fits-all TYPE_MIN_DEFAULT used by
    every other type — validate_output.py mirrors the same table.

Quirks handled here:
  * IAM records: `location` is "lat,lng" (lat first, like fetch_toilets.py).
    Names start with a zone code (M#, T#, C# = 澳門/氹仔/路環); unlike
    fetch_toilets.py, the code is KEPT in the display name — that's how IAM
    itself labels these, per the spec this script was built against.
  * DSPA records: every field is a string, including `status`, which is
    undocumented upstream (seen: "1" almost everywhere, "2" on 9 of the 311
    three-colour points). Stored as-is in `upstreamStatus`; deliberately NOT
    mapped to `closed` — only IAM's `tempClose` ever produces `closed: true`,
    every DSPA site is `closed: false`.
  * The ZIP-download endpoint used for the two IAM datasets
    (`api.data.gov.mo/document/download/<id>`) also answers the five DSPA
    dataset ids, but with no data file inside — just `readme.json` (dataset
    display name + upstream update time), because those five are published
    through the API gateway instead. That readme is still fetched here, for
    the `sources[].name` / `upstreamUpdatedAt` metadata, but best-effort: a
    failure there falls back to a hard-coded name and `upstreamUpdatedAt:
    null` rather than failing the run — the real site data for those five
    comes from the gateway, not this ZIP.

Reuses fetch_toilets.py's `fetch_zip()` (ZIP download + retry, including the
intermittent `{"msg":"內部錯誤"}` body) by import — it's a plain function with
no import-time side effects. Everything else here (clean(), coordinate
parsing, the readme reader) is its own small copy, matching how
fetch_toilets.py and fetch_car_parks.py each already keep their own trivial
helpers rather than share them.
"""

import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from shapely.geometry import Polygon
from shapely.ops import unary_union

from fetch_toilets import fetch_zip
from osm_footprints import (
    TilePartIndex,
    building_record,
    buffered_footprint,
    fetch_tile_building_parts,
    metres_xy,
    overpass,
    parse_height,
    part_record,
    polygon_of_element,
    strip_private,
    tiles_covering,
    xy_lnglat,
)

DSPA_BASE = "https://dspa.apigateway.data.gov.mo/T_Bas_POI_Basic"
DETAIL = "https://data.gov.mo/Detail?id={id}"
OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "waste.json"
LAT0 = 22.16  # local metres-per-degree reference, as in the other scripts
MACAU_TZ = timezone(timedelta(hours=8))  # round 3: suspend dates are Macau wall-clock dates

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; mini-macau data pipeline)"}
TIMEOUT = 30
MAX_ATTEMPTS = 5
BACKOFF_BASE = 2.0  # seconds; 2, 4, 8, 16

# Degenerate-fetch guard, per type: refuse to write a file where an upstream
# scrape broke silently. validate_output.py enforces the same floor again
# before commit. Round 3's glass/clothing recycling points are genuinely rare
# upstream (5 and 16 — not a scrape failure), so the floor is a table rather
# than one constant.
TYPE_MIN_DEFAULT = 20
TYPE_MIN_PER_TYPE = {"glass": 3, "clothing": 8}

# Generous Macau-region bounding box (validate_output.py enforces the real,
# tighter bbox before commit — this is just a sanity net on the raw fetch).
LAT_RANGE = (22.0, 22.3)
LNG_RANGE = (113.4, 113.7)

CODE_RE = re.compile(r"^([A-Z]{1,3}\d{1,3})\s*")

# source_id, our type id, dataset uuid, DSPA gateway endpoint (None = IAM ZIP
# carries the real data), whether this source's records become sites (the
# lamp/battery pair share one type — only lightBulb contributes sites),
# fallback bilingual dataset name (used if the readme fetch fails or the ZIP
# carries none — see read_zip()).
DATASET_TABLE = [
    ("iam-refuse-room", "refuse_room", "57964cb5-5868-47e5-bd8d-334385467a21", None,
     True, "垃圾房", "Depósitos de lixo fechados"),
    ("iam-compactor", "compactor", "e49ac4a5-83c1-48f8-8317-e783f4a1867e", None,
     True, "壓縮式垃圾收集點", "Pontos de recolha de lixo compactado"),
    ("dspa-smart-machine", "smart_machine", "12d42ec3-6d61-4daf-b713-eecbfcff5daa", "plasticNCanRecycle",
     True, "智能回收機位置清單", "Lista de locais de recolha de máquina de reciclagem inteligente"),
    ("dspa-three-colour", "three_colour", "db6f226e-1fbe-413a-b558-b5c2b2b0be52", "recycleBin",
     True, "三色資源回收位置清單", "Lista de locais de recolha de resíduos recicláveis por três cores"),
    ("dspa-e-waste", "e_waste", "d358a990-06f2-4a65-9045-7543ae9f826f", "electronicRecycling",
     True, "電腦及通訊設備回收計劃回收位置清單", "Lista de locais de recolha de programa de reciclagem de equipamentos electrónicos e eléctricos"),
    ("dspa-lamp", "lamp_battery", "33264820-4523-4e8b-a91a-9089f922220a", "lightBulb",
     True, "光管回收位置清單", "Lista de locais de recolha de lâmpadas"),
    ("dspa-battery", "lamp_battery", "a536616e-d870-4137-8dd6-0b2125a6c2a5", "battery",
     False, "電池回收位置清單", "Lista de locais de recolha de pilhas e baterias"),
]
TYPE_ORDER = ["refuse_room", "refuse_station", "compactor", "smart_machine", "three_colour", "e_waste", "lamp_battery", "glass", "clothing"]


def clean(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def today_macau_ymd() -> str:
    """Round 3: "today" for the suspendStartDate/suspendEndDate window check,
    as Macau wall-clock "YYYY-MM-DD"."""
    return datetime.now(tz=MACAU_TZ).strftime("%Y-%m-%d")


def parse_iam_location(raw: object) -> list[float] | None:
    """IAM's `location` field: "lat,lng" -> [lng, lat] rounded to 6 dp."""
    parts = [p.strip() for p in str(raw or "").split(",")]
    if len(parts) != 2:
        return None
    try:
        lat, lng = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LNG_RANGE[0] <= lng <= LNG_RANGE[1]):
        return None
    return [round(lng, 6), round(lat, 6)]


def parse_dspa_coords(lat_raw: object, lng_raw: object) -> list[float] | None:
    """DSPA's separate `latitude`/`longitude` string fields -> [lng, lat]."""
    try:
        lat, lng = float(clean(lat_raw)), float(clean(lng_raw))
    except ValueError:
        return None
    if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LNG_RANGE[0] <= lng <= LNG_RANGE[1]):
        return None
    return [round(lng, 6), round(lat, 6)]


def iam_id(kind: str, index: int, name_zh: str) -> str:
    """"<type>-<zone code or index>-<sha1(nameZh)[:8]>" — IAM has no id of its
    own. The zone code alone is unique today (checked against a live fetch
    while building this script) but the hash suffix keeps ids stable even if
    a future zone gets two entries with the same code."""
    m = CODE_RE.match(name_zh)
    slug = m.group(1) if m else str(index)
    digest = hashlib.sha1(name_zh.encode("utf-8")).hexdigest()[:8]
    return f"{kind}-{slug}-{digest}"


def read_zip(dataset_id: str) -> tuple[list[dict] | None, dict]:
    """Open the dataset's ZIP (fetch_toilets.fetch_zip(): download + the
    intermittent "内部錯誤" retry) and return (records, readme). `records` is
    None when the ZIP carries no data file, just readme.json — true for the
    five DSPA-only dataset ids, whose real site data lives behind the API
    gateway instead (see fetch_dspa)."""
    zf = zipfile.ZipFile(io.BytesIO(fetch_zip(dataset_id)))
    names = zf.namelist()
    readme: dict = {}
    if "readme.json" in names:
        readme = json.loads(zf.read("readme.json").decode("utf-8-sig"))
    data_names = [n for n in names if n.lower().endswith(".json") and not n.lower().endswith("readme.json")]
    if not data_names:
        return None, readme
    records = json.loads(zf.read(data_names[0]).decode("utf-8-sig"))
    if not isinstance(records, list):
        raise RuntimeError(f"{data_names[0]}: expected a JSON list, got {type(records).__name__}")
    print(f"  {data_names[0]}: {len(records)} records")
    return records, readme


def fetch_dspa(endpoint: str, appcode: str) -> list[dict]:
    """POST an empty body to a DSPA API gateway endpoint — same public-APPCODE-
    header pattern as fetch_car_parks.py's DSAT gateway — retrying network
    errors, non-200s, and any body that doesn't parse as a JSON list."""
    url = f"{DSPA_BASE}/{endpoint}"
    headers = {**HEADERS, "Authorization": f"APPCODE {appcode}"}
    last_error = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, data=b"", headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read()
            records = json.loads(body.decode("utf-8-sig"))
            if isinstance(records, list):
                return records
            last_error = f"unexpected JSON shape: {type(records).__name__}"
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} for {endpoint} failed ({last_error}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"DSPA gateway fetch {endpoint} failed after {MAX_ATTEMPTS} attempts: {last_error}")


def fetch_iam_gateway(url: str, appcode: str) -> list[dict]:
    """GET an IAM API gateway endpoint — same `Authorization: APPCODE` header
    as fetch_dspa's POST gateway, but IAM's macaohygiene_allgarbage endpoint is
    a GET — retrying network errors, non-200s, and any body that doesn't parse
    as a JSON list."""
    headers = {**HEADERS, "Authorization": f"APPCODE {appcode}"}
    last_error = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read()
            records = json.loads(body.decode("utf-8-sig"))
            if isinstance(records, list):
                return records
            last_error = f"unexpected JSON shape: {type(records).__name__}"
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} for {url} failed ({last_error}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"IAM gateway fetch {url} failed after {MAX_ATTEMPTS} attempts: {last_error}")


def dataset_display_name(readme: dict, fallback_zh: str, fallback_pt: str) -> dict:
    try:
        info = readme["dataDir"][0]["info"][0]
        zh = clean(info.get("nameTc")) or fallback_zh
        pt = clean(info.get("namePt")) or fallback_pt
    except (KeyError, IndexError, TypeError):
        zh, pt = fallback_zh, fallback_pt
    return {"zh": zh, "pt": pt}


def raw_updated_at(readme: dict) -> str | None:
    """readme.json's dataDir[0].updateTime, passed through as-is (Macau wall
    time, "YYYY-MM-DD HH:MM:SS") — unlike fetch_toilets.py's `updated_at()`,
    this is NOT reformatted to ISO+08:00; the spec this was built against
    shows the raw upstream string."""
    try:
        raw = clean(readme["dataDir"][0]["updateTime"])
    except (KeyError, IndexError, TypeError):
        return None
    return raw or None


def build_iam(records: list[dict], kind: str, *, with_address: bool) -> list[dict]:
    """Shared shape for refuse_room and compactor. Only compactor records
    carry addressZh/addressPt/telZh upstream (`with_address`); refuse rooms
    get `address: null`, `tel: null`."""
    sites = []
    for i, r in enumerate(records):
        name_zh = clean(r.get("nameZh"))
        coords = parse_iam_location(r.get("location"))
        if not name_zh or coords is None:
            print(f"  skipping {kind} {name_zh or '?'}: bad location {r.get('location')!r}", file=sys.stderr)
            continue
        sites.append(
            {
                "id": iam_id(kind, i, name_zh),
                "type": kind,
                "name": {"zh": name_zh, "en": clean(r.get("nameEn")), "pt": clean(r.get("namePt"))},
                "address": {"zh": clean(r.get("addressZh")), "pt": clean(r.get("addressPt"))} if with_address else None,
                "coordinates": coords,
                "closed": bool(r.get("tempClose")),
                "tel": (clean(r.get("telZh")) or None) if with_address else None,
                "photo": clean(r.get("photo")) or None,
                "upstreamStatus": None,
            }
        )
    return sites


def build_dspa(records: list[dict], kind: str) -> list[dict]:
    sites = []
    for r in records:
        rid = clean(r.get("ID"))
        name_zh = clean(r.get("name_tc"))
        coords = parse_dspa_coords(r.get("latitude"), r.get("longitude"))
        if not rid or not name_zh or coords is None:
            print(
                f"  skipping {kind} ID={rid or '?'}: bad record "
                f"(name={name_zh!r} lat={r.get('latitude')!r} lng={r.get('longitude')!r})",
                file=sys.stderr,
            )
            continue
        status_raw = clean(r.get("status"))
        try:
            status: int | None = int(status_raw)
        except ValueError:
            status = None
        sites.append(
            {
                "id": f"{kind}-{rid}",
                "type": kind,
                "name": {"zh": name_zh, "en": "", "pt": clean(r.get("name_pt"))},
                "address": {"zh": clean(r.get("address_tc")), "pt": clean(r.get("address_pt"))},
                "coordinates": coords,
                "closed": False,
                "tel": None,
                "photo": None,
                "upstreamStatus": status,
            }
        )
    return sites


def build_refuse_station(records: list[dict]) -> list[dict]:
    """Filter IAM's combined 全澳垃圾收集設施 list down to typeZh == '垃圾站'
    (42 of 296 rows; the other two types duplicate the dedicated refuse_room /
    compactor datasets fetched above) and shape them like every other site.
    Unlike refuse_room/compactor's upstream `nameZh`, this dataset's `titleZh`
    does NOT carry the zone code, so it is prefixed on here (IAM's code first,
    as for the other IAM types) — see spec-waste-round2.md §1."""
    sites = []
    for r in records:
        if clean(r.get("typeZh")) != "垃圾站":
            continue
        rid = clean(r.get("id"))
        title_zh = clean(r.get("titleZh"))
        coords = parse_iam_location(r.get("coordinate"))
        if not rid or not title_zh or coords is None:
            print(
                f"  skipping refuse_station id={rid or '?'}: bad record "
                f"(titleZh={title_zh!r} coordinate={r.get('coordinate')!r})",
                file=sys.stderr,
            )
            continue
        sites.append(
            {
                "id": f"refuse_station-{rid}",
                "type": "refuse_station",
                "name": {
                    "zh": f"{rid} {title_zh}",
                    "en": f"{rid} {clean(r.get('titleEn'))}",
                    "pt": f"{rid} {clean(r.get('titlePt'))}",
                },
                "address": None,
                "coordinates": coords,
                "closed": bool(r.get("tempClose")),
                "tel": None,
                "photo": clean(r.get("image")) or None,
                "upstreamStatus": None,
            }
        )
    return sites


# ----------------------------------------------------------------------------
# round 2: treatment facilities (`facilities[]`)
#
# Hand-maintained like fetch_power_facilities.py's SUBSTATIONS / INLET_NODES
# tables: `hazardous-station` is a marker at a DSPA-published address with no
# OSM footprint; the two landfills are OSM ways fetched fresh each run — their
# `coordinates` (centroid) / `polygon` (simplified outer ring) are filled in
# by fetch_landfill_polygons() and merged into the table in run().
# ----------------------------------------------------------------------------
LANDFILL_OSM_WAYS = {
    "landfill-construction": 552848944,
    "landfill-ka-ho-ash": 552740242,
}
RING_SIMPLIFY_M = 0.5  # spec-waste-round2.md §2: "≤ 0.5 m simplification"

FACILITIES_TABLE: list[dict] = [
    {
        "id": "hazardous-station",
        "kind": "hazardous",
        "name": {
            "zh": "澳門特殊和危險廢物處理站",
            "en": "Macau Special and Hazardous Waste Treatment Station",
            "pt": "Estação de Tratamento de Resíduos Especiais e Perigosos de Macau",
        },
        "coordinates": [113.573000, 22.160800],
        "approximate": True,
        "polygon": None,
        "osm": [],
        "note": {
            "zh": "位於氹仔北安信安馬路 U2 地段、垃圾焚化中心旁；處理廢舊輪胎、固態及液態危險廢物、動物屍體及屠場廢料、醫療廢物，設計處理量每日 24 公噸。",
            "en": "At Avenida Son On lot U2, Pac On, beside the incineration plant; treats used tyres, solid and liquid hazardous waste, animal carcasses, abattoir and medical waste — designed for 24 t/day.",
            "pt": "Na Avenida Son On, lote U2, Pac On, junto à central de incineração; trata pneus usados, resíduos perigosos sólidos e líquidos, carcaças de animais, resíduos de matadouro e hospitalares — capacidade de 24 t/dia.",
        },
        "source": {"name": "環境保護局 (DSPA)", "url": "https://www.dspa.gov.mo/place1_3.aspx"},
        "statsKey": "hazardous",
        "buildings": [],
    },
    {
        "id": "landfill-construction",
        "kind": "landfill",
        "name": {
            "zh": "建築廢料堆填區",
            "en": "Construction waste landfill",
            "pt": "Aterro para resíduos de materiais de construção",
        },
        "approximate": False,
        "osm": ["w552848944"],
        "note": {
            "zh": "機場南聯絡橋以西、路環發電廠以北，2003 年啟用的建築廢料堆填區（環境保護局）。",
            "en": "West of the airport's south link bridge and north of the Coloane power station; receiving construction waste since 2003 (DSPA).",
            "pt": "A oeste da ponte de ligação sul do aeroporto e a norte da central de Coloane; recebe resíduos de construção desde 2003 (DSPA).",
        },
        "source": {"name": "環境保護局 (DSPA) · OpenStreetMap", "url": "https://www.dspa.gov.mo/place1_3.aspx"},
        "statsKey": "landfill",
        "buildings": [],
    },
    {
        "id": "landfill-ka-ho-ash",
        "kind": "landfill",
        "name": {
            "zh": "九澳飛灰堆填區",
            "en": "Ka Ho fly-ash landfill",
            "pt": "Aterro de Cinzas Volantes de Ká-Hó",
        },
        "approximate": False,
        "osm": ["w552740242"],
        "note": {
            "zh": "路環九澳，接收垃圾焚化中心穩定化處理後的飛灰。",
            "en": "Ká-Hó, Coloane — receives the incineration plant's stabilised fly ash.",
            "pt": "Ká-Hó, Coloane — recebe as cinzas volantes estabilizadas da central de incineração.",
        },
        "source": {"name": "OpenStreetMap", "url": "https://www.openstreetmap.org/way/552740242"},
        "statsKey": None,
        "buildings": [],
    },
]


def simplify_ring(poly: Polygon, tolerance_m: float = RING_SIMPLIFY_M) -> list[list[float]]:
    """Outer ring of `poly`, Douglas-Peucker simplified at `tolerance_m` metres
    and rounded to 6 dp. Overpass ways survey every kerb wiggle; the map only
    needs a shape that reads at zoom."""
    xy = Polygon([metres_xy(x, y, LAT0) for x, y in poly.exterior.coords])
    simple = xy.simplify(tolerance_m)
    if simple.geom_type == "MultiPolygon":
        simple = max(simple.geoms, key=lambda g: g.area)
    return [[round(v, 6) for v in xy_lnglat(x, y, LAT0)] for x, y in simple.exterior.coords]


def facility_centroid(poly: Polygon) -> list[float]:
    c = poly.centroid
    if c.is_empty:
        c = poly.representative_point()
    return [round(c.x, 6), round(c.y, 6)]


def fetch_landfill_polygons() -> dict[str, dict]:
    """Overpass `out geom` for the two landfill ways ->
    {facility id: {"coordinates": [centroid], "polygon": [ring]}}."""
    ids = ",".join(str(w) for w in LANDFILL_OSM_WAYS.values())
    elements = overpass(f"[out:json][timeout:60];way(id:{ids});out geom;")
    by_way_id = {el["id"]: el for el in elements if el.get("type") == "way"}
    result: dict[str, dict] = {}
    for fac_id, way_id in LANDFILL_OSM_WAYS.items():
        el = by_way_id.get(way_id)
        if el is None:
            raise RuntimeError(f"way {way_id} ({fac_id}) not returned by Overpass")
        poly = polygon_of_element(el)
        if poly is None or poly.geom_type != "Polygon":
            raise RuntimeError(f"way {way_id} ({fac_id}) did not resolve to a single closed polygon")
        result[fac_id] = {"coordinates": facility_centroid(poly), "polygon": simplify_ring(poly)}
    return result


# ----------------------------------------------------------------------------
# round 4: sewage treatment plants join `facilities[]` (kind "wwtp"), each with
# OSM building footprints — the same "compound" claim-buildings-inside +
# recut-against-basemap-tiles pipeline fetch_water_facilities.py and
# fetch_power_facilities.py use for their own plants (see osm_footprints.py
# for the shared low-level pieces; the orchestration below is its own copy,
# like every other fetch_*.py — see the module docstring).
#
# Every `osm` ref, whether it already carries a `building` tag (e.g. the
# standalone buildings inside 澳門半島/氹仔's compounds, or 路環再生水站
# w679638321) or is only the plant's own area outline, is fed into the SAME
# "compound" polygon set: the buildings-inside-compound Overpass query then
# claims any ref that is itself a building sitting inside another ref's area,
# and the outline/tile fallback below still fires for any facility with
# nothing claimed at all — so a bare compound with nothing else mapped inside
# it still gets exactly one footprint (an outline slab of its own shape),
# which is what guarantees "every wwtp has >= 1 building" without
# special-casing any one plant. build_wwtp_facilities() raises if that ever
# comes up empty regardless — fatal on failure, like the landfill polygons
# above (unlike dspa-stats.json's monthly figures, this is core map content).
#
# `statsKey` points into public/data/dspa-stats.json (fetch_dspa_stats.py);
# null for wwtp-mia, which has no open dataset (see that script's docstring).
# ----------------------------------------------------------------------------
WWTP_SOURCE = {"name": "環境保護局 (DSPA) · OpenStreetMap", "url": "https://www.dspa.gov.mo/place1_3.aspx"}
WWTP_OUTLINE_MAX_HEIGHT_M = 20.0  # a slab drawn from an outline the basemap does not render

WWTP_TABLE: list[dict] = [
    {
        "id": "wwtp-macau", "osm": ["w330666093", "w330666087"], "statsKey": "wwtp.macau",
        "name": {
            "zh": "澳門半島污水處理廠",
            "en": "Macau Peninsula Wastewater Treatment Plant",
            "pt": "Estação de Tratamento de Águas Residuais da Península de Macau",
        },
        "note": {
            "zh": "環境保護局轄下污水處理廠，1995 年啟用，處理澳門半島的城市污水。",
            "en": "A DSPA wastewater treatment plant commissioned in 1995, serving the Macau peninsula.",
            "pt": "Estação de tratamento de águas residuais da DSPA, em funcionamento desde 1995, ao serviço da península de Macau.",
        },
    },
    {
        "id": "wwtp-taipa", "osm": ["w679817667", "w192095995"], "statsKey": "wwtp.taipa",
        "name": {
            "zh": "氹仔污水處理廠",
            "en": "Taipa Wastewater Treatment Plant",
            "pt": "Estação de Tratamento de Águas Residuais da Taipa",
        },
        "note": {
            "zh": "環境保護局轄下污水處理廠，1997 年啟用，處理氹仔的城市污水。",
            "en": "A DSPA wastewater treatment plant commissioned in 1997, serving Taipa.",
            "pt": "Estação de tratamento de águas residuais da DSPA, em funcionamento desde 1997, ao serviço da Taipa.",
        },
    },
    {
        "id": "wwtp-coloane", "osm": ["w679638313", "w241741095", "w241741096", "w679638321"],
        "statsKey": "wwtp.coloane",
        "name": {
            "zh": "路環污水處理廠",
            "en": "Coloane Wastewater Treatment Plant",
            "pt": "Estação de Tratamento de Águas Residuais de Coloane",
        },
        "note": {
            "zh": "環境保護局轄下污水處理廠，處理路環的城市污水；廠區內的路環再生水站於 2026 年 3 月啟用。",
            "en": "A DSPA wastewater treatment plant serving Coloane; the Coloane Recycled Water Plant on the same site opened in March 2026.",
            "pt": "Estação de tratamento de águas residuais da DSPA ao serviço de Coloane; a Estação de Água Reciclada de Coloane, no mesmo terreno, abriu em março de 2026.",
        },
    },
    {
        "id": "wwtp-crossborder", "osm": ["w679372916"], "statsKey": "wwtp.crossborder",
        "name": {
            "zh": "澳門跨境工業區污水處理站",
            "en": "Cross-Border Industrial Zone Wastewater Treatment Station",
            "pt": "Estação de Tratamento de Águas Residuais do Parque Industrial Transfronteiriço",
        },
        "note": {
            "zh": "環境保護局轄下污水處理站，2009 年啟用，處理澳門跨境工業區的污水。",
            "en": "A DSPA wastewater treatment station commissioned in 2009, serving the Cross-Border Industrial Zone.",
            "pt": "Estação de tratamento de águas residuais da DSPA, em funcionamento desde 2009, ao serviço do Parque Industrial Transfronteiriço.",
        },
    },
    {
        "id": "wwtp-mia", "osm": ["w817108499"], "statsKey": None,
        "name": {
            "zh": "澳門國際機場污水處理站",
            "en": "Macau International Airport Wastewater Treatment Station",
            "pt": "Estação de Tratamento de Águas Residuais do Aeroporto Internacional de Macau",
        },
        "note": {
            "zh": "環境保護局轄下污水處理站，處理澳門國際機場的污水。",
            "en": "A DSPA wastewater treatment station serving Macau International Airport.",
            "pt": "Estação de tratamento de águas residuais da DSPA ao serviço do Aeroporto Internacional de Macau.",
        },
    },
]


def osm_ref(el: dict) -> str:
    return f"{el['type'][0]}{el['id']}"


def fetch_wwtp_elements() -> dict[str, dict]:
    """Re-query every OSM id WWTP_TABLE names, keyed by "<type letter><id>" —
    same pattern as fetch_water_facilities.py's fetch_listed_elements()."""
    refs = [ref for f in WWTP_TABLE for ref in f["osm"]]
    kinds = {"w": "way", "r": "relation", "n": "node"}
    body = "".join(f"{kinds[ref[0]]}({ref[1:]});" for ref in refs)
    print(f"  fetching {len(refs)} OSM elements for {len(WWTP_TABLE)} wastewater treatment plants")
    els = overpass(f"[out:json][timeout:120];({body});out geom;")
    found = {osm_ref(el): el for el in els}
    missing = [r for r in refs if r not in found]
    if missing:
        raise RuntimeError(f"OSM ids in WWTP_TABLE no longer exist: {missing}")
    return found


def fetch_wwtp_buildings_in(polys: list[Polygon]) -> list[dict]:
    """Every building way/relation inside any of the given compound polygons —
    same pattern as fetch_water_facilities.py / fetch_power_facilities.py."""
    parts = []
    for poly in polys:
        geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
        for g in geoms:
            ring = " ".join(f"{y:.6f} {x:.6f}" for x, y in g.exterior.coords)
            parts.append(f'nwr["building"](poly:"{ring}");')
    print(f"  fetching buildings inside {len(polys)} compound polygons")
    # `out geom` (not `out tags geom`): the tags-only mode drops relation
    # members, and a courtyard building is a multipolygon relation.
    return overpass(f"[out:json][timeout:180];({''.join(parts)});out geom;")


def wwtp_records_from_element(el: dict) -> list[dict]:
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


def wwtp_outline_record(el: dict, poly: Polygon, index: int) -> dict:
    """Low slab cut straight from an outline the basemap does not render."""
    h, mh = parse_height(el.get("tags", {}))
    return {
        "osmId": osm_ref(el) + (f"#{index}" if index else ""),
        "name": el.get("tags", {}).get("name") or None,
        "height": round(min(h, WWTP_OUTLINE_MAX_HEIGHT_M), 1),
        "minHeight": mh,
        "kind": "outline",
        "coordinates": buffered_footprint(poly, LAT0),
        "_poly": poly,
    }


def wwtp_finalize(rec: dict, kind: str) -> dict:
    rec["kind"] = kind
    return rec


def wwtp_centroid(polys: list[Polygon]) -> list[float]:
    merged = unary_union(polys)
    c = merged.centroid
    if c.is_empty:
        c = merged.representative_point()
    return [round(c.x, 6), round(c.y, 6)]


def build_wwtp_facilities() -> list[dict]:
    """The five `kind: "wwtp"` facilities: OSM building footprints claimed
    inside each plant's compound polygon(s) and recut against the basemap's
    own building parts, exactly like fetch_water_facilities.py's `run()` —
    see the section comment above for how a bare compound (no OSM buildings
    mapped inside it) still ends up with one outline footprint."""
    elements = fetch_wwtp_elements()

    areas: dict[str, list[tuple[dict, Polygon]]] = {}
    for f in WWTP_TABLE:
        pairs = []
        for ref in f["osm"]:
            el = elements[ref]
            poly = polygon_of_element(el)
            if poly is None or poly.is_empty:
                raise RuntimeError(f"{f['id']}: OSM {ref} has no usable polygon")
            geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
            pairs += [(el, g) for g in geoms]
        areas[f["id"]] = pairs

    wwtp_ids = [f["id"] for f in WWTP_TABLE]
    compound_polys = [g for fid in wwtp_ids for _, g in areas[fid]]
    building_els = fetch_wwtp_buildings_in(compound_polys)
    print(f"  {len(building_els)} building features inside the compounds")

    claimed: dict[str, list[dict]] = {fid: [] for fid in wwtp_ids}
    seen_osm: set[str] = set()
    for el in building_els:
        for rec in wwtp_records_from_element(el):
            if rec["osmId"] in seen_osm:
                continue
            rep = rec["_poly"].representative_point()
            for fid in wwtp_ids:
                if any(g.contains(rep) for _, g in areas[fid]):
                    seen_osm.add(rec["osmId"])
                    claimed[fid].append(wwtp_finalize(rec, "building"))
                    break

    # --- re-cut everything against the basemap's own building parts --------
    fallback = [(fid, el, g) for fid in wwtp_ids if not claimed[fid] for el, g in areas[fid]]
    geoms_for_tiles = [rec["_poly"] for recs in claimed.values() for rec in recs]
    geoms_for_tiles += [g for _, _, g in fallback]
    tiles = tiles_covering(geoms_for_tiles)
    print(f"  re-cutting footprints against basemap tiles ({len(tiles)} tiles; "
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
                rec["height"] = round(min(rec["height"], WWTP_OUTLINE_MAX_HEIGHT_M), 1)
                new_recs.append(wwtp_finalize(rec, "outline"))
                continue
            recut += 1
            for i, part in enumerate(inside):
                osm_id = f"{rec['osmId']}#p{i}" if i else rec["osmId"]
                new_recs.append(wwtp_finalize(
                    part_record(part, LAT0, osm_id, rec.get("name"), "building"), "building"))
        claimed[fid] = new_recs
    print(f"  {recut} OSM footprints replaced by the basemap's parts")

    for fid, el, g in fallback:
        inside = index.within(g)
        if inside:
            for part in inside:
                claimed[fid].append(wwtp_finalize(
                    part_record(part, LAT0, part["id"], None, "tile"), "tile"))
            print(f"  {fid}: {len(inside)} basemap building parts")
        else:
            claimed[fid].append(wwtp_outline_record(el, g, len(claimed[fid])))
            print(f"  {fid}: no basemap part — outline slab")

    # --- assemble ------------------------------------------------------------
    facilities = []
    for f in WWTP_TABLE:
        buildings = [strip_private(b) for b in claimed[f["id"]]]
        polys = [Polygon(b["coordinates"][0]) for b in buildings] or [g for _, g in areas[f["id"]]]
        facilities.append({
            "id": f["id"],
            "kind": "wwtp",
            "name": f["name"],
            "coordinates": wwtp_centroid(polys),
            "approximate": False,
            "polygon": None,
            "osm": list(f["osm"]),
            "note": f["note"],
            "source": WWTP_SOURCE,
            "statsKey": f["statsKey"],
            "buildings": buildings,
        })

    empty = [fac["id"] for fac in facilities if not fac["buildings"]]
    if empty:
        raise RuntimeError(f"wwtp facilit(ies) with no building claimed at all: {empty}")

    print("  " + "  ".join(f"{fac['id']} (b={len(fac['buildings'])})" for fac in facilities))
    return facilities


# ----------------------------------------------------------------------------
# round 2: eco stations (`ecoStations[]`)
#
# DSPA's 環保加Fun站 — no open dataset publishes these, so the table is
# hand-transcribed from https://www.dspa.gov.mo/, like fetch_power_facilities
# .py's SUBSTATIONS table. The 台山 station closed 2024-06 and is deliberately
# excluded — see spec-waste-round2.md §3.
# ----------------------------------------------------------------------------
ECO_HOURS_STANDARD = {
    "zh": "星期二至星期日 10:00–13:00、14:00–19:00（星期一及公眾假期休息）",
    "en": "Tue–Sun 10:00–13:00, 14:00–19:00 (closed Mon and public holidays)",
    "pt": "Ter–Dom 10:00–13:00, 14:00–19:00 (fechado seg. e feriados)",
}
# 官也街 is closed Tuesdays instead of Mondays.
ECO_HOURS_RUA_DO_CUNHA = {
    "zh": "星期一、星期三至星期日 10:00–13:00、14:00–19:00（星期二及公眾假期休息）",
    "en": "Mon, Wed–Sun 10:00–13:00, 14:00–19:00 (closed Tue and public holidays)",
    "pt": "Seg., Qua–Dom 10:00–13:00, 14:00–19:00 (fechado à ter. e feriados)",
}
ECO_ACCEPTS = {
    "zh": "膠樽、鋁罐、光管、電池、舊衣、玻璃樽、廚餘等",
    "en": "Plastic bottles, aluminium cans, fluorescent tubes, batteries, used clothing, glass bottles, food waste, etc.",
    "pt": "Garrafas de plástico, latas de alumínio, lâmpadas fluorescentes, pilhas, roupas usadas, garrafas de vidro, resíduos alimentares, etc.",
}
ECO_SOURCE = {"name": "環境保護局 (DSPA)", "url": "https://www.dspa.gov.mo/"}

# id, zh name, zh address, [lng, lat], approximate, since, en/pt district label
ECO_STATIONS_RAW: list[tuple] = [
    ("eco-seac-pai-van", "環保加Fun站（石排灣）", "路環和諧大馬路石排灣業興大廈第三座地下C舖",
     [113.564510, 22.130280], False, 2018, "Seac Pai Van"),
    ("eco-ilha-verde", "環保加Fun站（青洲）", "澳門青洲新馬路青洲社屋青雅樓地下A社會設施空間",
     [113.537880, 22.212870], False, 2018, "Ilha Verde"),
    ("eco-barbosa", "環保加Fun站（巴波沙）", "澳門台山平民新邨A座地下11、12號舖",
     [113.548210, 22.212100], False, 2024, "Tamagnini Barbosa"),
    ("eco-iao-hon", "環保加Fun站（祐漢）", "澳門永寧街永寧廣場大廈地面層96號及100號地下",
     [113.553130, 22.212950], True, 2021, "Iao Hon"),
    ("eco-ha-wan", "環保加Fun站（下環）", "澳門鵝眉街6-6A號怡景臺花園大廈地下及M層",
     [113.535870, 22.191380], False, 2021, "Ha Wan"),
    ("eco-hac-kiu", "環保加Fun站（黑橋）", "氹仔黑橋街平民新邨第10座75號E(M)地下",
     [113.555740, 22.154590], True, 2021, "Hac Kiu"),
    ("eco-mong-ha", "環保加Fun站（望廈）", "澳門俾利喇街望廈社屋望德樓一樓D社會設施",
     [113.551430, 22.207180], False, 2022, "Mong Há"),
    ("eco-rua-do-cunha", "環保加Fun站（官也街）", "氹仔告利雅施利華街25號地下",
     [113.556600, 22.152800], True, 2024, "Rua do Cunha"),
    ("eco-lam-mau", "環保加Fun站（林茂塘）", "澳門林茂海邊大馬路雨水箱涵排水口臨時污水處理設施地下",
     [113.537520, 22.203380], False, 2025, "Lam Mau"),
    ("eco-venceslau", "環保加Fun站（慕拉士）", "慕拉士大馬路望廈社屋望信樓第1座地下G",
     [113.554190, 22.204840], False, 2025, "Venceslau de Morais"),
]

ECO_STATIONS: list[dict] = [
    {
        "id": eid,
        "name": {
            "zh": zh,
            "en": f"Eco Fun Station ({district})",
            "pt": f"Centro Ambiental Alegria ({district})",
        },
        "address": {"zh": addr_zh, "pt": ""},
        "coordinates": coords,
        "approximate": approx,
        "hours": ECO_HOURS_RUA_DO_CUNHA if eid == "eco-rua-do-cunha" else ECO_HOURS_STANDARD,
        "accepts": ECO_ACCEPTS,
        "since": since,
        "source": ECO_SOURCE,
    }
    for eid, zh, addr_zh, coords, approx, since, district in ECO_STATIONS_RAW
]


IAM_GATEWAY_URL = "https://iam.apigateway.data.gov.mo/macaohygiene_allgarbage"
REFUSE_STATION_DATASET_ID = "6c7617b7-8165-4564-9b51-055ddda8b3ad"
REFUSE_STATION_SOURCE_ID = "iam-refuse-station"


# ----------------------------------------------------------------------------
# round 3: glass-bottle + clothing recycling points (`glass` / `clothing`)
#
# IAM's public facility-map JSON — the feed behind
# https://www.iam.gov.mo/macaohygiene/c/allgarbage/map, NOT a data.gov.mo
# dataset and not behind the APPCODE gateway at all. 1,457 rows across many
# categories (public toilets, pet-waste bins, dog runs, large-furniture
# collection, …); only the two recycling categories are kept here. See
# build_iam_map_sites().
# ----------------------------------------------------------------------------
IAM_MAP_URL = "https://www.iam.gov.mo/macaohygiene/data/facility_c.json"
IAM_MAP_SOURCE_URL = "https://www.iam.gov.mo/macaohygiene/c/allgarbage/map"
IAM_MAP_DATASET_ID = "facility_c.json"
# A real desktop UA — unlike HEADERS above, which self-identifies as a bot —
# because this endpoint isn't a data.gov.mo API and expects a browser.
IAM_MAP_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# upstream category (zh, as published) -> (our type id, fallback bilingual
# `sources[].name` — there is no separate readme for this feed, unlike the ZIP
# datasets above, so this is always what ships).
IAM_MAP_CATEGORIES: list[tuple[str, str, dict]] = [
    ("玻璃樽公共回收點", "glass", {"zh": "玻璃樽公共回收點", "pt": "Pontos de recolha pública de garrafas de vidro"}),
    ("全澳衣物公共回收點", "clothing", {"zh": "全澳衣物公共回收點", "pt": "Pontos de recolha pública de roupas usadas"}),
]


def parse_suspend_ymd(raw: object) -> str | None:
    """IAM map's suspendStartDate/suspendEndDate: "YYYY-MM-DDTHH:MM:SS" (Macau
    wall time, no offset) or "" when unset -> just the "YYYY-MM-DD" date part,
    or None when unset/unparseable."""
    s = clean(raw)
    if len(s) < 10 or s[4:5] != "-" or s[7:8] != "-":
        return None
    return s[:10]


def iam_map_photo(r: dict) -> str | None:
    """First non-empty photo1..photo4, made absolute against iam.gov.mo (the
    upstream paths are already percent-encoded, site-relative)."""
    for key in ("photo1", "photo2", "photo3", "photo4"):
        p = clean(r.get(key))
        if p:
            return p if p.startswith("http") else f"https://www.iam.gov.mo{p}"
    return None


def format_last_mod(raw: str) -> str:
    """"2018-10-07T14:35:27" -> "2018-10-07 14:35:27" (also truncates any
    fractional seconds/offset the upstream might one day add)."""
    return raw.replace("T", " ")[:19]


def build_iam_map_sites(records: list[dict], category: str, kind: str, today_ymd: str) -> list[dict]:
    """Filter IAM's shared facility-map list (facility_c.json) down to one
    `category` and shape it like every other waste site. `closed` is the only
    type in this file derived from a suspend-date window rather than a
    tempClose/status flag."""
    sites = []
    for r in records:
        if clean(r.get("category")) != category:
            continue
        rid = clean(r.get("id"))
        name_zh = clean(r.get("name"))
        coords = parse_iam_location(r.get("mapLink"))
        if not rid or not name_zh or coords is None:
            print(
                f"  skipping {kind} id={rid or '?'}: bad record "
                f"(name={name_zh!r} mapLink={r.get('mapLink')!r})",
                file=sys.stderr,
            )
            continue
        addr_zh = clean(r.get("address"))
        start = parse_suspend_ymd(r.get("suspendStartDate"))
        end = parse_suspend_ymd(r.get("suspendEndDate"))
        sites.append(
            {
                "id": f"{kind}-{rid[:8]}",
                "type": kind,
                "name": {"zh": name_zh, "en": "", "pt": ""},
                "address": {"zh": addr_zh, "pt": ""} if addr_zh else None,
                "coordinates": coords,
                "closed": start is not None and end is not None and start <= today_ymd <= end,
                "tel": None,
                "photo": iam_map_photo(r),
                "upstreamStatus": None,
            }
        )
    return sites


def fetch_iam_map(url: str) -> list[dict]:
    """GET IAM's public facility-map JSON — a plain fetch with no
    Authorization header (unlike fetch_iam_gateway/fetch_dspa, this feed isn't
    behind data.gov.mo's APPCODE gateway at all). Same retry/backoff shape as
    the other fetch_* helpers here. The response envelope is `{"data": [...]}`,
    not a bare list like every other source in this file."""
    last_error = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, headers=IAM_MAP_HEADERS, method="GET")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read()
            parsed = json.loads(body.decode("utf-8-sig"))
            records = parsed.get("data") if isinstance(parsed, dict) else parsed
            if isinstance(records, list):
                return records
            last_error = f"unexpected JSON shape: {type(parsed).__name__}"
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} for {url} failed ({last_error}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"IAM map fetch {url} failed after {MAX_ATTEMPTS} attempts: {last_error}")


def run() -> int:
    appcode = os.environ.get("DATAGOVMO_APPCODE")
    if not appcode:
        print(
            "ERROR: DATAGOVMO_APPCODE is not set. Export the public APPCODE printed on "
            "the DSPA dataset pages (e.g. https://data.gov.mo/Detail?id=12d42ec3-6d61-4daf-b713-eecbfcff5daa) "
            "before running this script, e.g. DATAGOVMO_APPCODE=... uv run python scripts/fetch_waste.py",
            file=sys.stderr,
        )
        return 2

    print(
        "Fetching IAM refuse rooms / compacting bins / refuse stations + DSPA "
        "recycling points + treatment facilities (incl. wwtp footprints)"
    )

    sites: list[dict] = []
    sources: list[dict] = []
    failed: list[str] = []
    records_by_source: dict[str, list[dict]] = {}

    for source_id, kind, dataset_id, endpoint, contributes, fallback_zh, fallback_pt in DATASET_TABLE:
        print(f"- {source_id} ({dataset_id[:8]}...)")
        try:
            if endpoint is None:
                records, readme = read_zip(dataset_id)
                if records is None:
                    raise RuntimeError(f"{dataset_id}: ZIP carried no data file")
            else:
                records = fetch_dspa(endpoint, appcode)
                print(f"  {endpoint}: {len(records)} records")
                readme = {}
                try:
                    _, readme = read_zip(dataset_id)
                except (RuntimeError, zipfile.BadZipFile, json.JSONDecodeError, urllib.error.URLError, OSError) as e:
                    print(f"  warning: readme metadata fetch failed, using fallback name/null upstreamUpdatedAt: {e}", file=sys.stderr)
        except (RuntimeError, zipfile.BadZipFile, json.JSONDecodeError, urllib.error.URLError, OSError) as e:
            print(f"  ERROR: {e}", file=sys.stderr)
            failed.append(source_id)
            continue

        records_by_source[source_id] = records

        if contributes:
            built = build_iam(records, kind, with_address=(kind == "compactor")) if endpoint is None else build_dspa(records, kind)
            sites.extend(built)

        sources.append(
            {
                "id": source_id,
                "type": kind,
                "datasetId": dataset_id,
                "name": dataset_display_name(readme, fallback_zh, fallback_pt),
                "url": DETAIL.format(id=dataset_id),
                "upstreamUpdatedAt": raw_updated_at(readme),
                "count": len(records),
            }
        )

    # --- round 2: IAM's all-facilities gateway -> 垃圾站 refuse_station -----
    # A GET (not POST like the DSPA gateway above), same env-var APPCODE.
    print(f"- {REFUSE_STATION_SOURCE_ID} ({REFUSE_STATION_DATASET_ID[:8]}...)")
    try:
        all_garbage = fetch_iam_gateway(IAM_GATEWAY_URL, appcode)
        print(f"  {IAM_GATEWAY_URL}: {len(all_garbage)} records")
        station_sites = build_refuse_station(all_garbage)
        try:
            _, refuse_station_readme = read_zip(REFUSE_STATION_DATASET_ID)
        except (RuntimeError, zipfile.BadZipFile, json.JSONDecodeError, urllib.error.URLError, OSError) as e:
            print(f"  warning: readme metadata fetch failed, using fallback name/null upstreamUpdatedAt: {e}", file=sys.stderr)
            refuse_station_readme = {}
        sites.extend(station_sites)
        sources.append(
            {
                "id": REFUSE_STATION_SOURCE_ID,
                "type": "refuse_station",
                "datasetId": REFUSE_STATION_DATASET_ID,
                "name": dataset_display_name(
                    refuse_station_readme,
                    "全澳垃圾收集設施的資訊列表",
                    "Lista de informações sobre instalações de recolha de lixo de Macau",
                ),
                "url": DETAIL.format(id=REFUSE_STATION_DATASET_ID),
                "upstreamUpdatedAt": raw_updated_at(refuse_station_readme),
                # NOTE: unlike every other source, this is the FILTERED site
                # count (42 垃圾站), not the raw fetch size (296 — see
                # build_refuse_station()'s docstring) — spec-waste-round2.md §1.
                "count": len(station_sites),
            }
        )
    except RuntimeError as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        failed.append(REFUSE_STATION_SOURCE_ID)

    # --- round 3: IAM's public facility-map JSON -> glass + clothing
    # recycling points. Plain GET, no APPCODE — fatal on failure like
    # everything else above. -------------------------------------------------
    print(f"- iam-map-glass / iam-map-clothing ({IAM_MAP_DATASET_ID})")
    try:
        facility_map = fetch_iam_map(IAM_MAP_URL)
        print(f"  {IAM_MAP_URL}: {len(facility_map)} records")
        today_ymd = today_macau_ymd()
        for category, kind, fallback_name in IAM_MAP_CATEGORIES:
            kind_sites = build_iam_map_sites(facility_map, category, kind, today_ymd)
            sites.extend(kind_sites)
            last_mods = sorted(
                clean(r.get("lastModDate"))
                for r in facility_map
                if clean(r.get("category")) == category and clean(r.get("lastModDate"))
            )
            sources.append(
                {
                    "id": f"iam-map-{kind}",
                    "type": kind,
                    "datasetId": IAM_MAP_DATASET_ID,
                    "name": fallback_name,
                    "url": IAM_MAP_SOURCE_URL,
                    "upstreamUpdatedAt": format_last_mod(last_mods[-1]) if last_mods else None,
                    # Like refuse_station, this is the FILTERED site count for
                    # this one category, not the raw fetch size (1,457, shared
                    # across every category in the feed).
                    "count": len(kind_sites),
                }
            )
    except RuntimeError as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        failed.append("iam-map-glass")
        failed.append("iam-map-clothing")

    if failed:
        print(f"ERROR: {len(failed)} source(s) failed after retries: {', '.join(failed)} — refusing to write", file=sys.stderr)
        return 1

    if "dspa-lamp" in records_by_source and "dspa-battery" in records_by_source:
        lamp_ids = {clean(r.get("ID")) for r in records_by_source["dspa-lamp"]}
        battery_ids = {clean(r.get("ID")) for r in records_by_source["dspa-battery"]}
        if lamp_ids != battery_ids:
            print(
                f"  WARNING: lightBulb/battery id sets differ ({len(lamp_ids ^ battery_ids)} symmetric difference) "
                "— lamp_battery sites are built from the lightBulb list only; that assumption (see module "
                "docstring) may now be stale",
                file=sys.stderr,
            )

    counts: dict[str, int] = {}
    for s in sites:
        counts[s["type"]] = counts.get(s["type"], 0) + 1

    short = {
        k: counts.get(k, 0)
        for k in TYPE_ORDER
        if counts.get(k, 0) < TYPE_MIN_PER_TYPE.get(k, TYPE_MIN_DEFAULT)
    }
    if short:
        print(f"ERROR: type(s) below their per-type floor: {short} — refusing to write", file=sys.stderr)
        return 1

    sites.sort(key=lambda s: (TYPE_ORDER.index(s["type"]), s["id"]))

    # --- round 2/4: treatment facilities — fatal on failure, like everything
    # above. The hazardous station and both landfills are hand-placed/OSM
    # -fetched (round 2); round 4 adds the five DSPA wastewater treatment
    # plants (kind "wwtp"), each with OSM building footprints — see
    # build_wwtp_facilities(). ------------------------------------------------
    print("- treatment facilities (hazardous station + 2 landfill polygons)")
    try:
        landfill_geo = fetch_landfill_polygons()
    except RuntimeError as e:
        print(f"ERROR: landfill polygon fetch failed: {e} — refusing to write", file=sys.stderr)
        return 1
    facilities: list[dict] = []
    for row in FACILITIES_TABLE:
        fac = dict(row)
        if fac["kind"] == "landfill":
            fac.update(landfill_geo[fac["id"]])
        facilities.append(fac)

    print(f"- {len(WWTP_TABLE)} wastewater treatment plants (OSM building footprints)")
    try:
        facilities.extend(build_wwtp_facilities())
    except RuntimeError as e:
        print(f"ERROR: wwtp facility fetch failed: {e} — refusing to write", file=sys.stderr)
        return 1

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "sources": sources,
        "counts": {k: counts[k] for k in TYPE_ORDER},
        "sites": sites,
        "facilities": facilities,
        "ecoStations": ECO_STATIONS,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Whitespace-minimal: 1,094 records at indent=2 would blow the 600 KiB
    # budget (toilets.json is ~1 KiB/record at indent=2 for 1/5th as many
    # records).
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Done. {len(sites)} sites across {len(counts)} types: {counts}")
    total_fac_buildings = sum(len(f["buildings"]) for f in facilities)
    print(
        f"Facilities: {len(facilities)} ({total_fac_buildings} buildings total)   "
        f"Eco stations: {len(ECO_STATIONS)}"
    )
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
