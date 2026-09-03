"""
Daily fetch: DSAT (交通事務局) public car parks from the Macau open-data API
gateway, normalised into public/data/car-parks.json for the map's car-parks
overlay.

Upstream is one of two DSAT datasets served by dsat.apigateway.data.gov.mo,
both behind a *public* APPCODE (printed on the dataset page for every
visitor, no login needed) sent as an `Authorization: APPCODE <key>` header:
  * car_park_detail    (this script) — 88 public car parks, static, updated
    daily. https://data.gov.mo/Detail?id=ac55c2f1-780a-4dc8-875f-851b2203b706
  * car_park_maintance — ~87 live vacancy rows, refreshed every 10s. CORS is
    `*`, so the browser polls this one directly (only at 1x sim speed) —
    it is not part of this pipeline.
    https://data.gov.mo/Detail?id=ea50a770-cc35-47cc-a3ba-7f60092d4bc4

Both endpoints return XML: a single <CarPark> root whose children are
<Car_park_info ATTR="..." .../> elements — every field lives in ATTRIBUTES,
there is no element text/children to parse.

Quirks handled here:
  * `X_coords` is LATITUDE and `Y_coords` is LONGITUDE — the names are
    swapped from what you'd expect. `coordinates` is built as
    [float(Y_coords), float(X_coords)] to get the usual [lng, lat] order.
  * Multi-line text fields (prices, remarks) glue their lines together with
    a literal "##" separator, occasionally with a stray trailing one (and
    with the usual whitespace noise around each line). "##" becomes "\n";
    blank leading/trailing lines produced by that split are trimmed.
  * A lone "-" is DSAT's placeholder for "not applicable" and becomes "".
  * `height` (vehicle clearance, metres) carries "--", "---", or "" for car
    parks with no stated limit; those parse to `null` rather than a float.

The APPCODE is public information but still stays OUT of the repo: it is
read from the DATAGOVMO_APPCODE env var (a GitHub secret in CI, exported by
hand locally) and is never hard-coded — see the check at the top of run().

Pure stdlib (urllib + xml.etree), same dependency footprint as
fetch_road_works.py.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

DATASET_PAGE = "https://data.gov.mo/Detail?id=ac55c2f1-780a-4dc8-875f-851b2203b706"
VACANCY_DATASET_PAGE = "https://data.gov.mo/Detail?id=ea50a770-cc35-47cc-a3ba-7f60092d4bc4"
API_URL = "https://dsat.apigateway.data.gov.mo/car_park_detail?lang=zh_TW"
OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "car-parks.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; mini-macau data pipeline)"}
TIMEOUT = 30
MAX_ATTEMPTS = 5
BACKOFF_BASE = 2.0  # seconds; 2, 4, 8, 16

# Degenerate-fetch guard: the feed carries 88 car parks; refuse to overwrite
# a good file with a near-empty one if the upstream export breaks.
MIN_CAR_PARKS = 40

# Generous Macau-region bounding box (validate_output.py enforces the real,
# tighter bbox before commit — this is just a sanity net on the raw fetch).
LAT_RANGE = (22.0, 22.3)
LNG_RANGE = (113.4, 113.7)


def fetch_xml(appcode: str) -> bytes:
    """GET car_park_detail, retrying network errors, non-200s, and any body
    that isn't XML (the API gateway can answer errors as JSON/HTML too)."""
    headers = {**HEADERS, "Authorization": f"APPCODE {appcode}"}
    last_error = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(API_URL, headers=headers)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read()
            if body.lstrip()[:1] == b"<":
                return body
            last_error = f"non-XML body ({len(body)} bytes): {body[:120]!r}"
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} failed ({last_error}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"fetch failed after {MAX_ATTEMPTS} attempts: {last_error}")


def clean(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def multiline(s: object) -> str:
    """"##"-joined field -> "\n"-joined text: collapse whitespace on each
    line, drop blank leading/trailing lines left behind by a stray
    separator, then collapse a whole-field lone "-" to ""."""
    parts = [clean(p) for p in str(s or "").split("##")]
    while parts and parts[0] == "":
        parts.pop(0)
    while parts and parts[-1] == "":
        parts.pop()
    text = "\n".join(parts)
    return "" if text == "-" else text


def parse_height(raw: object) -> float | None:
    try:
        return float(clean(raw))
    except ValueError:
        return None


def parse_coords(x_raw: object, y_raw: object) -> list[float] | None:
    try:
        lat, lng = float(clean(x_raw)), float(clean(y_raw))
    except ValueError:
        return None
    if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LNG_RANGE[0] <= lng <= LNG_RANGE[1]):
        return None
    return [round(lng, 6), round(lat, 6)]


def build_record(attrs: dict[str, str]) -> dict | None:
    cp_id = clean(attrs.get("CP_ID"))
    coords = parse_coords(attrs.get("X_coords"), attrs.get("Y_coords"))
    if not cp_id or coords is None:
        print(
            f"  skipping CP_ID={cp_id or '?'}: bad coordinates "
            f"X={attrs.get('X_coords')!r} Y={attrs.get('Y_coords')!r}",
            file=sys.stderr,
        )
        return None
    return {
        "id": cp_id,
        "name": {"zh": clean(attrs.get("NameC")), "pt": clean(attrs.get("NameP")), "en": clean(attrs.get("NameE"))},
        "location": {
            "zh": clean(attrs.get("LocationC")),
            "pt": clean(attrs.get("LocationP")),
            "en": clean(attrs.get("LocationE")),
        },
        "entrance": {
            "zh": clean(attrs.get("CarParkEntryC")),
            "pt": clean(attrs.get("CarParkEntryP")),
            "en": clean(attrs.get("CarParkEntryE")),
        },
        "phone": clean(attrs.get("ContactNo")),
        "heightLimitM": parse_height(attrs.get("height")),
        "fees": {
            "light": {
                "zh": multiline(attrs.get("Lcar_price_C")),
                "pt": multiline(attrs.get("Lcar_price_P")),
                "en": multiline(attrs.get("Lcar_price_E")),
            },
            "heavy": {
                "zh": multiline(attrs.get("Hcar_price_C")),
                "pt": multiline(attrs.get("Hcar_price_P")),
                "en": multiline(attrs.get("Hcar_price_E")),
            },
            "moto": {
                "zh": multiline(attrs.get("moto_price_C")),
                "pt": multiline(attrs.get("moto_price_P")),
                "en": multiline(attrs.get("moto_price_E")),
            },
            "remark": {
                "zh": multiline(attrs.get("remark_price_C")),
                "pt": multiline(attrs.get("remark_price_P")),
                "en": multiline(attrs.get("remark_price_E")),
            },
        },
        "zone": {"zh": clean(attrs.get("zone_C")), "pt": clean(attrs.get("zone_P")), "en": clean(attrs.get("zone_E"))},
        "parish": {
            "zh": clean(attrs.get("subdistrict_C")),
            "pt": clean(attrs.get("subdistrict_P")),
            "en": clean(attrs.get("subdistrict_E")),
        },
        "coordinates": coords,
    }


def build(records: list[ET.Element]) -> list[dict]:
    car_parks = [r for el in records if (r := build_record(el.attrib)) is not None]
    car_parks.sort(key=lambda c: int(c["id"]) if c["id"].isdigit() else 10**9)
    return car_parks


def run() -> int:
    appcode = os.environ.get("DATAGOVMO_APPCODE")
    if not appcode:
        print(
            "ERROR: DATAGOVMO_APPCODE is not set. Export the public APPCODE printed on "
            f"the dataset page ({DATASET_PAGE}) before running this script, "
            "e.g. DATAGOVMO_APPCODE=... uv run python scripts/fetch_car_parks.py",
            file=sys.stderr,
        )
        return 2

    print("Fetching DSAT public car parks")
    try:
        body = fetch_xml(appcode)
        root = ET.fromstring(body)
    except (RuntimeError, ET.ParseError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    records = root.findall("Car_park_info")
    print(f"  {API_URL}: {len(records)} records")

    car_parks = build(records)
    if len(car_parks) < MIN_CAR_PARKS:
        print(
            f"ERROR: only {len(car_parks)} usable car parks (< {MIN_CAR_PARKS}) — "
            "upstream likely broken, refusing to write",
            file=sys.stderr,
        )
        return 1

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "sources": {
            "name": "交通事務局 (DSAT) – 停車場資料",
            "dataset": DATASET_PAGE,
            "vacancyDataset": VACANCY_DATASET_PAGE,
        },
        "carParks": car_parks,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    by_zone: dict[str, int] = {}
    for c in car_parks:
        z = c["zone"]["zh"] or "?"
        by_zone[z] = by_zone.get(z, 0) + 1
    print(f"Done. {len(car_parks)} car parks (by zone: {by_zone})")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
