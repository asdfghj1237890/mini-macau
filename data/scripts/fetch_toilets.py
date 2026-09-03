"""
Daily fetch: IAM (市政署) public toilets from the Macau open-data platform,
normalised into public/data/toilets.json for the map's toilets overlay.

Upstream (data.gov.mo, no API token needed — the bare download endpoint
returns a ZIP; it intermittently answers HTTP 200 with {"msg":"內部錯誤"}
instead, which is retried here):
  * 公共廁所   f6a9892d-7e16-49f0-bcd3-573d670cefe5  → toliet.json (sic)
    198 toilets: names/addresses/phone/opening hours in zh/cn/pt/en,
    `location` as "lat,lng", `hasDwc` (barrier-free cubicle), `hasFwc`
    (family cubicle), `photo`, `tempClose`.
  * 無障礙公廁 513cba0e-684d-4cf1-bd3c-f8af1adb0392  → accessibletoliet.json
    The subset with barrier-free cubicles. Used as a cross-check only: a
    toilet is `accessible` when the main record says hasDwc OR it appears
    in this list.

Names carry an IAM code ("AM01 食品資訊站", or glued: "M35文化中心廣場公廁").
The code becomes the stable id and is stripped from the display names.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
import io
from datetime import datetime, timezone
from pathlib import Path

MAIN_ID = "f6a9892d-7e16-49f0-bcd3-573d670cefe5"
ACCESSIBLE_ID = "513cba0e-684d-4cf1-bd3c-f8af1adb0392"
DOWNLOAD = "https://api.data.gov.mo/document/download/{id}"
DETAIL = "https://data.gov.mo/Detail?id={id}"
OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "toilets.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; mini-macau data pipeline)"}
TIMEOUT = 30
MAX_ATTEMPTS = 6
BACKOFF_BASE = 2.0
MIN_TOILETS = 50  # degenerate-fetch guard (the feed carries ~200)

CODE_RE = re.compile(r"^([A-Z]{1,3}\d{1,3})\s*")
# Macau, loosely (validate_output.py enforces the real bbox before commit).
LAT_RANGE = (22.0, 22.3)
LNG_RANGE = (113.4, 113.7)


def fetch_zip(dataset_id: str) -> bytes:
    url = DOWNLOAD.format(id=dataset_id)
    last = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read()
            if body[:2] == b"PK":
                return body
            last = f"non-ZIP body ({len(body)} bytes): {body[:80]!r}"
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} for {dataset_id[:8]} failed ({last}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"download of {dataset_id} failed after {MAX_ATTEMPTS} attempts: {last}")


def read_dataset(dataset_id: str) -> tuple[list[dict], dict]:
    """(records, readme) from the dataset ZIP; the data file is the one .json
    that is not readme.json."""
    zf = zipfile.ZipFile(io.BytesIO(fetch_zip(dataset_id)))
    names = [n for n in zf.namelist() if n.lower().endswith(".json")]
    data_name = next(n for n in names if not n.lower().endswith("readme.json"))
    records = json.loads(zf.read(data_name).decode("utf-8-sig"))
    readme = {}
    if "readme.json" in zf.namelist():
        readme = json.loads(zf.read("readme.json").decode("utf-8-sig"))
    if not isinstance(records, list):
        raise RuntimeError(f"{data_name}: expected a JSON list, got {type(records).__name__}")
    print(f"  {data_name}: {len(records)} records")
    return records, readme


def clean(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def strip_code(s: str) -> str:
    return CODE_RE.sub("", s, count=1).strip()


def parse_location(raw: object) -> list[float] | None:
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


def updated_at(readme: dict) -> str | None:
    """readme.json's dataDir[0].updateTime is Macau wall time; emit ISO +08:00."""
    try:
        raw = readme["dataDir"][0]["updateTime"]
        dt = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
        return dt.strftime("%Y-%m-%dT%H:%M:%S+08:00")
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def build(main: list[dict], accessible: list[dict]) -> list[dict]:
    accessible_names = {clean(r.get("nameZh")) for r in accessible}
    toilets: list[dict] = []
    seen_ids: dict[str, int] = {}
    for r in main:
        name_zh = clean(r.get("nameZh"))
        coords = parse_location(r.get("location"))
        if not name_zh or coords is None:
            print(f"  skipping {name_zh or '?'}: bad location {r.get('location')!r}", file=sys.stderr)
            continue
        m = CODE_RE.match(name_zh)
        code = m.group(1) if m else None
        base_id = code or re.sub(r"[^A-Za-z0-9]+", "-", name_zh)[:24]
        n = seen_ids.get(base_id, 0) + 1
        seen_ids[base_id] = n
        toilet_id = base_id if n == 1 else f"{base_id}-{n}"
        toilets.append(
            {
                "id": toilet_id,
                "code": code,
                "name": {
                    "zh": strip_code(name_zh),
                    "pt": strip_code(clean(r.get("namePt"))),
                    "en": strip_code(clean(r.get("nameEn"))),
                },
                "address": {"zh": clean(r.get("addressZh")), "pt": clean(r.get("addressPt")), "en": clean(r.get("addressEn"))},
                "phone": {"zh": clean(r.get("telZh")), "pt": clean(r.get("telPt")), "en": clean(r.get("telEn"))},
                "openHours": {"zh": clean(r.get("openHourZh")), "pt": clean(r.get("openHourPt")), "en": clean(r.get("openHourEn"))},
                "accessible": bool(r.get("hasDwc")) or name_zh in accessible_names,
                "family": bool(r.get("hasFwc")),
                "closed": bool(r.get("tempClose")),
                "photo": clean(r.get("photo")) or None,
                "coordinates": coords,
            }
        )
    toilets.sort(key=lambda t: t["id"])
    return toilets


def run() -> int:
    print("Fetching IAM public toilets")
    try:
        main, readme_main = read_dataset(MAIN_ID)
        accessible, _ = read_dataset(ACCESSIBLE_ID)
    except (RuntimeError, zipfile.BadZipFile, json.JSONDecodeError, StopIteration) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    toilets = build(main, accessible)
    if len(toilets) < MIN_TOILETS:
        print(f"ERROR: only {len(toilets)} usable toilets (< {MIN_TOILETS}) — upstream likely broken, refusing to write", file=sys.stderr)
        return 1

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "updatedAt": updated_at(readme_main),
        "sources": {
            "name": "市政署 (IAM) – 公共廁所 / 無障礙公廁",
            "toilets": DETAIL.format(id=MAIN_ID),
            "accessibleToilets": DETAIL.format(id=ACCESSIBLE_ID),
        },
        "toilets": toilets,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    n_acc = sum(1 for t in toilets if t["accessible"])
    n_fam = sum(1 for t in toilets if t["family"])
    n_closed = sum(1 for t in toilets if t["closed"])
    print(f"Done. {len(toilets)} toilets (accessible={n_acc}, family={n_fam}, closed={n_closed}), upstream updated {output['updatedAt']}")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
