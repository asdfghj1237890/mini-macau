"""
Build a static flights.json for Mini Macau covering MFM departures and
arrivals for a given date.

The primary data source is configured via four opaque env vars (kept out
of source as GitHub Actions secrets). The script parses departure +
arrival timetables, filters for schedules active on the target date,
deduplicates, and outputs times in Macau local (UTC+8) as minutes since
midnight.

When AVIATIONSTACK_API_KEY is set, the AviationStack API is also queried
and both sources are cross-referenced to verify correctness.

Usage:
    uv run python data/scripts/fetch_flights.py [YYYY-MM-DD]

    If no date is given, defaults to today.
    Required env:  UPSTREAM_DEP_EN_URL, UPSTREAM_DEP_ZH_URL,
                   UPSTREAM_ARR_EN_URL, UPSTREAM_ARR_ZH_URL
    Optional env:  AVIATIONSTACK_API_KEY  (enables cross-verification)

Output: public/data/flights.json
"""

import json
import math
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

OUTPUT_PATH = Path(__file__).resolve().parent.parent.parent / "public" / "data" / "flights.json"

# Upstream URLs are injected via four opaque env vars (kept out of source
# as GitHub Actions secrets). The code treats them as black-box strings —
# no URL shape, path structure, or query form is hard-coded here.
_UPSTREAM_URLS: dict[str, str] = {
    "dep_en": os.environ.get("UPSTREAM_DEP_EN_URL", ""),
    "dep_zh": os.environ.get("UPSTREAM_DEP_ZH_URL", ""),
    "arr_en": os.environ.get("UPSTREAM_ARR_EN_URL", ""),
    "arr_zh": os.environ.get("UPSTREAM_ARR_ZH_URL", ""),
}


def _upstream_ready() -> bool:
    return all(_UPSTREAM_URLS.values())

MFM_LAT = 22.1494
MFM_LON = 113.5914

KNOWN_AIRPORTS: dict[str, tuple[float, float]] = {
    "HKG": (22.3080, 113.9185),
    "PEK": (40.0799, 116.6031), "PKX": (39.5098, 116.4105),
    "PVG": (31.1443, 121.8083), "SHA": (31.1979, 121.3362),
    "TPE": (25.0797, 121.2342), "KHH": (22.5771, 120.3500),
    "RMQ": (24.2647, 120.6210),
    "ICN": (37.4602, 126.4407), "CJU": (33.5114, 126.4929),
    "PUS": (35.1795, 128.9382),
    "NRT": (35.7720, 140.3929), "KIX": (34.4273, 135.2441),
    "FUK": (33.5859, 130.4510),
    "BKK": (13.6900, 100.7501), "DMK": (13.9126, 100.6068),
    "SIN": (1.3644, 103.9915),
    "KUL": (2.7456, 101.7099),
    "MNL": (14.5086, 121.0198), "CEB": (10.3075, 123.9794),
    "SGN": (10.8188, 106.6520), "HAN": (21.2212, 105.8070),
    "DAD": (16.0439, 108.1992), "PQC": (10.1698, 103.9931),
    "HPH": (20.8194, 106.7250), "CXR": (11.9981, 109.2194),
    "CAN": (23.3924, 113.2988), "SZX": (22.6393, 113.8107),
    "XMN": (24.5440, 118.1277), "NKG": (31.7420, 118.8620),
    "CTU": (30.5728, 103.9472), "TFU": (30.5728, 104.4450),
    "CKG": (29.7192, 106.6422), "WUH": (30.7838, 114.2081),
    "CSX": (28.1892, 113.2200), "HAK": (19.9349, 110.4590),
    "KMG": (25.1019, 102.9291), "TAO": (36.2661, 120.3744),
    "DLC": (38.9657, 121.5386), "TNA": (36.8572, 117.2158),
    "CGO": (34.5197, 113.8409), "HGH": (30.2295, 120.4344),
    "WNZ": (27.9122, 120.8522), "FOC": (25.9351, 119.6633),
    "SWA": (23.4269, 116.7623), "NNG": (22.6083, 108.1722),
    "HFE": (31.7800, 117.2984), "TSN": (39.1244, 117.3462),
    "SYX": (18.3029, 109.4122), "ZUH": (22.0064, 113.3760),
    "NGB": (29.8267, 121.4612), "KWE": (26.5385, 106.8008),
    "JJN": (24.7964, 118.5897), "WUX": (31.4944, 120.4294),
    "KTI": (11.5500, 104.8500), "DOH": (25.2611, 51.5654),
    "CGK": (-6.1256, 106.6559), "TYN": (37.7469, 112.6283),
    "KHN": (28.8650, 115.9000), "ROR": (7.3674, 134.5443),
    "TWU": (4.3133, 118.1219), "CZX": (31.9197, 119.7786),
}

DEST_TO_IATA: dict[str, str] = {
    "beijing": "PEK", "beijing-daxing": "PKX",
    "shanghai": "SHA", "shanghai-pudong": "PVG",
    "taipei": "TPE", "kaohsiung": "KHH", "taichung": "RMQ",
    "seoul-incheon": "ICN", "jeju": "CJU", "busan": "PUS",
    "tokyo-narita": "NRT", "osaka-kansai": "KIX", "fukuoka": "FUK",
    "bangkok": "BKK", "bangkok-donmueang": "DMK",
    "singapore": "SIN",
    "k. lumpur": "KUL", "kuala lumpur": "KUL",
    "manila": "MNL", "cebu": "CEB",
    "ho chi minh city": "SGN", "ha noi": "HAN", "danang": "DAD",
    "phu quoc": "PQC", "haiphong-catbi": "HPH", "cam ranh": "CXR",
    "guangzhou": "CAN", "shenzhen": "SZX",
    "xiamen": "XMN", "nanjing": "NKG",
    "chengdu": "CTU", "chengdu tianfu": "TFU",
    "chongqing": "CKG", "wuhan": "WUH",
    "changsha": "CSX", "haikou": "HAK",
    "kunming": "KMG", "qingdao": "TAO",
    "dalian": "DLC", "jinan": "TNA",
    "zhengzhou": "CGO", "hangzhou": "HGH",
    "wenzhou": "WNZ", "fuzhou": "FOC",
    "shantou": "SWA", "nanning": "NNG",
    "hefei": "HFE", "tianjin": "TSN",
    "sanya": "SYX", "zhuhai": "ZUH",
    "ningbo": "NGB", "guiyang": "KWE",
    "jinjiang": "JJN", "wuxi": "WUX",
    "kandal stueng": "KTI", "doha": "DOH",
    "jakarta": "CGK", "taiyuan": "TYN",
    "nanchang": "KHN", "koror": "ROR",
    "tawau": "TWU", "chang zhou benniu": "CZX",
}


def compute_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(lat2_r)
    y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def fetch_page(url: str) -> str:
    resp = requests.get(url, timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (compatible; flight-data-sync/1.0)",
    })
    resp.raise_for_status()
    return resp.text


_ROW_RE = re.compile(r"<tr\s+class=['\"]detail['\"][^>]*>.*?</tr>", re.DOTALL)
_MD_CELL_RE = re.compile(r"<td class='d-none d-md-table-cell'>(.*?)</td>", re.DOTALL)
_FNUM_RE = re.compile(r"<td class='d-none d-sm-table-cell'>([A-Z0-9]+)</td>")
_DATE_RE = re.compile(r"<td class='d-none d-lg-table-cell'>(\d{4}-\d{2}-\d{2})<br/>.*?(\d{4}-\d{2}-\d{2})</td>", re.DOTALL)
_DOW_RE = re.compile(
    r"(\d{4}-\d{2}-\d{2})</td>\s*"
    r"<td class='d-none d-lg-table-cell'>(.*?)</td>\s*"   # Mon
    r"<td class='d-none d-lg-table-cell'>(.*?)</td>\s*"   # Tue
    r"<td class='d-none d-lg-table-cell'>(.*?)</td>\s*"   # Wed
    r"<td class='d-none d-lg-table-cell'>(.*?)</td>\s*"   # Thu
    r"<td class='d-none d-lg-table-cell'>(.*?)</td>\s*"   # Fri
    r"<td class='d-none d-lg-table-cell'>(.*?)</td>\s*"   # Sat
    r"<td class='d-none d-lg-table-cell'>(.*?)</td>",     # Sun
    re.DOTALL,
)

_ACFT_TOKEN_RE = re.compile(r"^[A-Z0-9]{3,4}$")


def _operates_on_weekday(row: str, weekday: int) -> bool:
    """Check if a timetable row operates on the given weekday (Mon=0 .. Sun=6)."""
    dow_m = _DOW_RE.search(row)
    if not dow_m:
        return True
    day_cell = dow_m.group(weekday + 2)  # +2 because group(1) is the end-date
    return "fa-plane" in day_cell


def parse_timetable_html(html: str, target_date: date, *, label: str = "") -> list[tuple[str, str, str, str]]:
    """Extract (time, dest, flight_no, aircraft) tuples from timetable HTML.

    Uses positional extraction: the 3 'd-md-table-cell' columns are always
    [destination, time, aircraft] in that order. Aircraft is validated against
    known ICAO/IATA type codes (3-4 uppercase alphanumerics like A320, B38M).

    On parse failure (0 rows matched) emits diagnostics to stderr so the
    GitHub Actions log shows enough to debug an upstream layout change
    without needing the secret URLs locally.
    """
    results = []
    weekday = target_date.weekday()
    all_rows = list(_ROW_RE.finditer(html))

    if not all_rows:
        print(
            f"\n[diag:{label or 'timetable'}] _ROW_RE matched 0 <tr class='detail'> rows.\n"
            f"  html length: {len(html)} chars\n"
            f"  <tr count: {html.count('<tr')}\n"
            f"  <table count: {html.count('<table')}\n"
            f"  first 2000 chars:\n{html[:2000]}\n"
            f"  last 500 chars:\n{html[-500:]}",
            file=sys.stderr,
        )
        # Also try a looser pattern to show what rows DO exist so we can
        # update the regex from the log output.
        loose = re.search(r"<tr[^>]*>.*?</tr>", html, re.DOTALL)
        if loose:
            print(
                f"[diag:{label or 'timetable'}] first <tr> block (loose match, first 800 chars):\n"
                f"  {loose.group(0)[:800]}",
                file=sys.stderr,
            )
        return results

    for row_match in all_rows:
        row = row_match.group(0)

        date_m = _DATE_RE.search(row)
        if not date_m:
            continue
        start_d = date.fromisoformat(date_m.group(1))
        end_d = date.fromisoformat(date_m.group(2))
        if not (start_d <= target_date <= end_d):
            continue

        if not _operates_on_weekday(row, weekday):
            continue

        md_cells = _MD_CELL_RE.findall(row)
        fnum_m = _FNUM_RE.search(row)

        if len(md_cells) < 2 or not fnum_m:
            continue

        dest = md_cells[0].strip()
        time_str = md_cells[1].strip()
        aircraft = md_cells[2].strip() if len(md_cells) >= 3 else ""

        if not re.match(r"\d{2}:\d{2}$", time_str):
            continue

        if aircraft and not _ACFT_TOKEN_RE.match(aircraft):
            aircraft = ""

        flight_no = fnum_m.group(1)
        results.append((time_str, dest, flight_no, aircraft))

    return results


def resolve_iata(dest_name: str) -> str:
    dest_lower = dest_name.lower().strip()
    iata = DEST_TO_IATA.get(dest_lower, "")
    if not iata:
        for key, val in DEST_TO_IATA.items():
            if key in dest_lower or dest_lower in key:
                iata = val
                break
    return iata


def build_flight(
    time_str: str,
    place_name: str,
    flight_no: str,
    aircraft: str,
    flight_type: str,
    name_cn: str = "",
) -> dict:
    h, m = map(int, time_str.split(":"))
    scheduled = h * 60 + m

    iata = resolve_iata(place_name)

    if iata and iata in KNOWN_AIRPORTS:
        lat, lon = KNOWN_AIRPORTS[iata]
        bearing = round(compute_bearing(MFM_LAT, MFM_LON, lat, lon), 1)
    else:
        bearing = 0 if flight_type == "departure" else 180

    airport_data: dict = {"iata": iata, "name": place_name, "bearing": bearing}
    if name_cn:
        airport_data["nameCn"] = name_cn

    prefix = "dep" if flight_type == "departure" else "arr"
    fid = f"{flight_no}-{prefix}-{scheduled:04d}"

    result: dict = {
        "id": fid,
        "flightNumber": flight_no,
        "airline": {"name": "", "iata": flight_no[:2] if len(flight_no) >= 2 else ""},
        "type": flight_type,
        "scheduledTime": scheduled,
    }

    if flight_type == "departure":
        result["destination"] = airport_data
    else:
        result["origin"] = airport_data

    if aircraft:
        result["aircraftType"] = aircraft

    return result


AVIATIONSTACK_URL = "http://api.aviationstack.com/v1/flights"
MACAU_TZ = timezone(timedelta(hours=8))


def api_scheduled_to_minutes(time_str: str | None) -> int | None:
    """Parse AviationStack ISO datetime to minutes since midnight (UTC+8)."""
    if not time_str:
        return None
    try:
        dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_local = dt.astimezone(MACAU_TZ)
        return dt_local.hour * 60 + dt_local.minute
    except Exception:
        return None


def fetch_aviationstack(api_key: str, direction: str) -> dict[str, int]:
    """Fetch flights from AviationStack and return {flightNumber: scheduledMinutes}.

    direction: 'dep' or 'arr'.
    """
    param_key = "dep_iata" if direction == "dep" else "arr_iata"
    params = {"access_key": api_key, param_key: "MFM", "limit": 100}
    try:
        resp = requests.get(AVIATIONSTACK_URL, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            print(f"  API error: {data['error']}", file=sys.stderr)
            return {}
    except Exception as e:
        print(f"  Request failed: {e}", file=sys.stderr)
        return {}

    result: dict[str, int] = {}
    for raw in data.get("data", []):
        flight_info = raw.get("flight", {}) or {}
        if flight_info.get("codeshared"):
            continue
        fnum = flight_info.get("iata") or flight_info.get("icao") or ""
        if not fnum:
            continue

        if direction == "dep":
            scheduled = api_scheduled_to_minutes((raw.get("departure") or {}).get("scheduled"))
        else:
            scheduled = api_scheduled_to_minutes((raw.get("arrival") or {}).get("scheduled"))

        if scheduled is not None:
            result[fnum] = scheduled

    return result


def cross_verify(flights: list[dict], api_key: str) -> None:
    """Compare scraped flights against AviationStack API data."""
    print("\n" + "=" * 60)
    print("Cross-verification with AviationStack API")
    print("=" * 60)

    print("  Fetching API departures...")
    api_deps = fetch_aviationstack(api_key, "dep")
    print(f"    Got {len(api_deps)} departures from API")

    print("  Fetching API arrivals...")
    api_arrs = fetch_aviationstack(api_key, "arr")
    print(f"    Got {len(api_arrs)} arrivals from API")

    if not api_deps and not api_arrs:
        print("  No API data available, skipping verification.")
        return

    api_lookup: dict[str, int] = {}
    for fnum, mins in api_deps.items():
        api_lookup[f"{fnum}-dep"] = mins
    for fnum, mins in api_arrs.items():
        api_lookup[f"{fnum}-arr"] = mins

    matched = 0
    mismatched = 0
    api_only = 0
    mismatch_details: list[str] = []

    scraped_lookup: dict[str, int] = {}
    for f in flights:
        key = f"{f['flightNumber']}-{f['type'][:3]}"
        scraped_lookup[key] = f["scheduledTime"]

    for key, api_min in sorted(api_lookup.items()):
        if key in scraped_lookup:
            scraped_min = scraped_lookup[key]
            diff = abs(scraped_min - api_min)
            if diff <= 5:
                matched += 1
            else:
                mismatched += 1
                fnum, typ = key.rsplit("-", 1)
                s_h, s_m = divmod(scraped_min, 60)
                a_h, a_m = divmod(api_min, 60)
                mismatch_details.append(
                    f"    {fnum:>10} {typ.upper()} "
                    f"scraped={s_h:02d}:{s_m:02d}  api={a_h:02d}:{a_m:02d}  "
                    f"diff={diff}min"
                )
        else:
            api_only += 1

    scraped_only = sum(1 for k in scraped_lookup if k not in api_lookup)

    print(f"\n  Results:")
    print(f"    Matched (within 5min): {matched}")
    print(f"    Mismatched:            {mismatched}")
    print(f"    API only (not in MFM): {api_only}")
    print(f"    MFM only (not in API): {scraped_only}")

    if mismatch_details:
        print(f"\n  Mismatches:")
        for line in mismatch_details:
            print(line)

    if mismatched == 0 and matched > 0:
        print(f"\n  All {matched} overlapping flights verified OK.")
    elif matched > 0:
        pct = matched / (matched + mismatched) * 100
        print(f"\n  {pct:.0f}% match rate ({matched}/{matched + mismatched}).")
    print("=" * 60)


def _build_cn_mapping(target_date: date) -> dict[str, str]:
    """Fetch both localized timetables and build {english_name: chinese_name} mapping."""
    mapping: dict[str, str] = {}
    if not _upstream_ready():
        return mapping
    en_by_fnum: dict[str, str] = {}
    zh_by_fnum: dict[str, str] = {}

    pairs = (
        (_UPSTREAM_URLS["dep_en"], _UPSTREAM_URLS["dep_zh"]),
        (_UPSTREAM_URLS["arr_en"], _UPSTREAM_URLS["arr_zh"]),
    )

    for en_url, zh_url in pairs:
        en_html = fetch_page(en_url)
        zh_html = fetch_page(zh_url)

        for row_match in _ROW_RE.finditer(en_html):
            row = row_match.group(0)
            cells = _MD_CELL_RE.findall(row)
            fnum_m = _FNUM_RE.search(row)
            if cells and fnum_m:
                en_by_fnum[fnum_m.group(1)] = cells[0].strip()

        for row_match in _ROW_RE.finditer(zh_html):
            row = row_match.group(0)
            cells = _MD_CELL_RE.findall(row)
            fnum_m = _FNUM_RE.search(row)
            if cells and fnum_m:
                zh_by_fnum[fnum_m.group(1)] = cells[0].strip()

    for fnum, en_name in en_by_fnum.items():
        zh_name = zh_by_fnum.get(fnum, "")
        if en_name and zh_name and en_name not in mapping:
            mapping[en_name] = zh_name

    return mapping


def main():
    if len(sys.argv) > 1:
        target_date = date.fromisoformat(sys.argv[1])
    else:
        target_date = date.today()

    print(f"Target date: {target_date}")

    if not _upstream_ready():
        missing = [k for k, v in _UPSTREAM_URLS.items() if not v]
        print(
            f"Upstream URL env vars not fully set ({', '.join(missing)} missing) —\n"
            "  legacy backup source disabled. Set the env vars (or GitHub Actions\n"
            "  secrets) to enable timetable sync.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Building Chinese name mapping...")
    cn_map = _build_cn_mapping(target_date)
    print(f"  Mapped {len(cn_map)} destination names")

    print("Fetching departures timetable...")
    dep_html = fetch_page(_UPSTREAM_URLS["dep_en"])
    dep_rows = parse_timetable_html(dep_html, target_date, label="dep_en")
    print(f"  Found {len(dep_rows)} active departure entries")

    print("Fetching arrivals timetable...")
    arr_html = fetch_page(_UPSTREAM_URLS["arr_en"])
    arr_rows = parse_timetable_html(arr_html, target_date, label="arr_en")
    print(f"  Found {len(arr_rows)} active arrival entries")

    flights: list[dict] = []
    seen_ids: set[str] = set()

    for time_str, dest, fno, acft in dep_rows:
        f = build_flight(time_str, dest, fno, acft, "departure", cn_map.get(dest, ""))
        if f["id"] not in seen_ids:
            flights.append(f)
            seen_ids.add(f["id"])

    for time_str, orig, fno, acft in arr_rows:
        f = build_flight(time_str, orig, fno, acft, "arrival", cn_map.get(orig, ""))
        if f["id"] not in seen_ids:
            flights.append(f)
            seen_ids.add(f["id"])

    flights.sort(key=lambda x: x["scheduledTime"])

    # Safety guard: MFM never actually has zero flights in a day. A fully
    # empty result means the upstream HTML layout changed, the fetch was
    # blocked, or the parser broke — not a real schedule. Refuse to clobber
    # the last good flights.json in that case so the app keeps rendering
    # yesterday's schedule until the script is fixed. The GitHub Actions
    # workflow checks `git diff --quiet` after this script runs, so exiting
    # non-zero here also prevents the (now unchanged) file from triggering
    # a commit.
    if not flights:
        print(
            "\nERROR: parsed 0 flights from both departure and arrival timetables.\n"
            "  This almost certainly means the upstream page structure changed or\n"
            "  the fetch was blocked. Refusing to overwrite the existing\n"
            f"  {OUTPUT_PATH.name} with an empty list.",
            file=sys.stderr,
        )
        sys.exit(2)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(flights, indent=2, ensure_ascii=False), encoding="utf-8")

    deps = sum(1 for f in flights if f["type"] == "departure")
    arrs = sum(1 for f in flights if f["type"] == "arrival")
    print(f"\nWrote {len(flights)} flights to {OUTPUT_PATH}")
    print(f"  {deps} departures, {arrs} arrivals")

    api_key = os.environ.get("AVIATIONSTACK_API_KEY", "")
    if api_key:
        cross_verify(flights, api_key)
    else:
        print("\n  Set AVIATIONSTACK_API_KEY to enable cross-verification with API data.")


if __name__ == "__main__":
    main()
