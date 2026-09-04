"""
Daily fetch: IAM (市政署) refuse rooms / compacting bins + DSPA (環境保護局)
recycling-point lists from the Macau open-data platform, normalised into
public/data/waste.json for the map's WASTE overlay.

Seven upstream datasets (data.gov.mo, all WGS84) collapse into six site
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
from datetime import datetime, timezone
from pathlib import Path

from fetch_toilets import fetch_zip

DSPA_BASE = "https://dspa.apigateway.data.gov.mo/T_Bas_POI_Basic"
DETAIL = "https://data.gov.mo/Detail?id={id}"
OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "waste.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; mini-macau data pipeline)"}
TIMEOUT = 30
MAX_ATTEMPTS = 5
BACKOFF_BASE = 2.0  # seconds; 2, 4, 8, 16

# Degenerate-fetch guard, per type: refuse to write a file where an upstream
# scrape broke silently. validate_output.py enforces the same floor again
# before commit.
TYPE_MIN = 20

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
TYPE_ORDER = ["refuse_room", "compactor", "smart_machine", "three_colour", "e_waste", "lamp_battery"]


def clean(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


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
    """POST an empty body to the DSPA API gateway — same public-APPCODE-header
    pattern as fetch_car_parks.py's DSAT gateway — retrying network errors,
    non-200s, and any body that doesn't parse as a JSON list."""
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

    print("Fetching IAM refuse rooms / compacting bins + DSPA recycling points")

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

    short = {k: counts.get(k, 0) for k in TYPE_ORDER if counts.get(k, 0) < TYPE_MIN}
    if short:
        print(f"ERROR: type(s) below the {TYPE_MIN}-site floor: {short} — refusing to write", file=sys.stderr)
        return 1

    sites.sort(key=lambda s: (TYPE_ORDER.index(s["type"]), s["id"]))

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "sources": sources,
        "counts": {k: counts[k] for k in TYPE_ORDER},
        "sites": sites,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Whitespace-minimal: 1,094 records at indent=2 would blow the 600 KiB
    # budget (toilets.json is ~1 KiB/record at indent=2 for 1/5th as many
    # records).
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Done. {len(sites)} sites across {len(counts)} types: {counts}")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
