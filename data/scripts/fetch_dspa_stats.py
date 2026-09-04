"""Monthly fetch: DSPA (環境保護局) statistics for the incinerator, the
hazardous-waste treatment station, the construction-waste landfill and the
four wastewater treatment plants (WWTP) that publish data, normalised into
public/data/dspa-stats.json.

DSPA publishes each of these as its own small table behind the same
dspa.apigateway.data.gov.mo API gateway fetch_waste.py already talks to for
the recycling-point lists (POST, empty body, header `Authorization: APPCODE
<key>`, the same public APPCODE, read from DATAGOVMO_APPCODE — never
hard-coded, see the check at the top of run()). This script COPIES
fetch_waste.py's `fetch_dspa()` gateway helper rather than importing it: the
two scripts run on unrelated monthly schedules and otherwise share no code —
see fetch_waste.py's own module docstring for the same convention (only the
low-level osm_footprints.py / osrm_route.py pieces are shared across
data/scripts/*.py; per-file orchestration is each script's own copy).

Seven series ship in the output, six of them fetched here:

  key               endpoint (under https://dspa.apigateway.data.gov.mo/)   dataset id
  incinerator       T_Bas_MRIP_Approved            monthly    8142c05e-818a-478a-9256-4ecd494d3f87
  hazardous         T_Bas_MHWTP_Approved           monthly    (no data.gov.mo id — DSPA GIS page only)
  landfill          T_Bas_Landfill_Approved        monthly    (no data.gov.mo id — DSPA GIS page only)
  wwtp.macau        T_Bas_WWTP_Macau_Approved      DAILY      9c555082-70e8-452f-a86b-073cd0da4a55
  wwtp.taipa        V_T_Bas_MRIP_Approved_2        monthly    9d257556-9d52-4a59-afa0-d1a2a2bab0a8
  wwtp.coloane      V_T_Bas_WWTP_Approved/coloane  monthly    a5a05d0e-30c5-4298-81d5-e6bee5af5e8b
  wwtp.crossborder  V_T_Bas_WWTP_Approved/crossborder monthly 4a57b120-60f2-4a36-a6eb-7f93f340f2e6
  wwtp.mia          — no open dataset (the airport's own system is not on data.gov.mo) — always `null`

wwtp.macau is the only DAILY feed (CollectionPeriod like "2026/6/9", ~6,400
rows total): it is grouped by (year, month) here and its two flow fields
summed — MDTOverflow -> basicM3, Influent_ProcessFlow -> biologicalM3,
totalM3 = the two added — see build_wwtp_macau(). That reproduces the DSPA
GIS page's own monthly 污水處理總量 (checked against a live fetch while
building this script: June 2026 = 2,267,341 + 3,806,060 = 6,073,401 m3).
Upstream `Category` comes back as both "macau" and "Macau"; both are kept.
Every other series is already one row per month (`CollectionPeriod` or
`Period`, "YYYY/M" or "YYYY/MM") — see build_series().

BEST-EFFORT, every series: unlike fetch_waste.py's site lists (which fail the
whole run if any one source breaks), each of the six fetches here is
independent, and a failure (network, unexpected shape, no usable rows) prints
a warning and leaves that key `null` rather than failing the run — see
fetch_series(). This mirrors fetch_waste.py's old incinerator-stats block
(BEST-EFFORT, `null` on failure), which this script's `incinerator` series
now replaces: fetch_waste.py's `incinerator` block, validate_output.py's old
`v_waste_incinerator` and its `WASTE_FACILITY_KINDS` incinerator entry are all
retired now that this file carries it (waste.json's `facilities[]` instead
gets a `statsKey` on every entry — "incinerator" is not one of them, only the
hazardous station / landfill / wwtp facilities point back into this file).

`incinerator.facts` (phases, line count, daily capacity, generation, compound
area) is hand-typed from https://www.dspa.gov.mo/place1_2.aspx — moved here
verbatim from fetch_waste.py's old INCINERATOR_FACTS. It lives inside the
`incinerator` series object (`dspa-stats.json`'s `incinerator.facts`), so a
failed incinerator fetch drops it too, exactly like before.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "dspa-stats.json"

GATEWAY_BASE = "https://dspa.apigateway.data.gov.mo"
DETAIL = "https://data.gov.mo/Detail?id={id}"
GIS_PAGE = "https://apps.dspa.gov.mo/gis/publicData.html?data={code}&lng=zh-TW"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; mini-macau data pipeline)"}
TIMEOUT = 30
MAX_ATTEMPTS = 5
BACKOFF_BASE = 2.0  # seconds; 2, 4, 8, 16

MONTHS_KEPT = 12
PERIOD_RE = re.compile(r"^(\d{4})/(\d{1,2})$")
DAILY_PERIOD_RE = re.compile(r"^(\d{4})/(\d{1,2})/(\d{1,2})$")

# Hand-typed from https://www.dspa.gov.mo/place1_2.aspx — moved verbatim from
# fetch_waste.py's old INCINERATOR_FACTS (spec-waste-round2.md §4).
INCINERATOR_FACTS = {
    "phases": [1992, 2008, 2024],
    "lines": 8,
    "capacityTPerDay": 3000,
    "generationMw": 56.7,
    "areaM2": 51000,
}

# (key, endpoint, period field, {upstream field: our field}, dataset id or
# None, url used when dataset id is None, unit, category field or None,
# category value). `unit` is a lookup key for the frontend's own i18n strings
# ("t" -> 公噸/t/t, "m3" -> m³/m³/m³) — see spec-dspa-stats.md §1. incinerator
# carries three differently-unitted fields (t, MWh, t); "t" tags the headline
# receivedT bar-chart metric, and the frontend hard-codes the other two units
# the same way the old incinerator panel already did.
SERIES_TABLE: list[tuple] = [
    ("incinerator", "T_Bas_MRIP_Approved", "CollectionPeriod",
     {"AmountReceived": "receivedT", "ElectricityProduced": "electricityMwh", "MetalRecycled": "metalRecycledT"},
     "8142c05e-818a-478a-9256-4ecd494d3f87", None, "t", None, None),
    ("hazardous", "T_Bas_MHWTP_Approved", "CollectionPeriod",
     {"AmountReceived": "receivedT", "AmountProcessed": "processedT"},
     None, GIS_PAGE.format(code="T_Bas_MHWTP_Approved"), "t", None, None),
    ("landfill", "T_Bas_Landfill_Approved", "CollectionPeriod",
     {"MonthlyLanfillVolume": "volumeM3"},
     None, GIS_PAGE.format(code="T_Bas_Landfill_Approved"), "m3", None, None),
    ("wwtp.taipa", "V_T_Bas_MRIP_Approved_2", "Period",
     {"Effluent_Flow": "totalM3"},
     "9d257556-9d52-4a59-afa0-d1a2a2bab0a8", None, "m3", "Category", "taipa"),
    ("wwtp.coloane", "V_T_Bas_WWTP_Approved/coloane", "Period",
     {"Influent_Flow": "totalM3"},
     "a5a05d0e-30c5-4298-81d5-e6bee5af5e8b", None, "m3", "Category", "coloane"),
    ("wwtp.crossborder", "V_T_Bas_WWTP_Approved/crossborder", "Period",
     {"Influent_Flow": "totalM3"},
     "4a57b120-60f2-4a36-a6eb-7f93f340f2e6", None, "m3", "Category", "crossborder"),
]
WWTP_MACAU_ENDPOINT = "T_Bas_WWTP_Macau_Approved"
WWTP_MACAU_DATASET_ID = "9c555082-70e8-452f-a86b-073cd0da4a55"


def clean(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def normalize_period(raw: object) -> str | None:
    """DSPA's "YYYY/M" or "YYYY/MM" -> "YYYY-MM"."""
    m = PERIOD_RE.match(clean(raw))
    if not m:
        return None
    year, month = int(m.group(1)), int(m.group(2))
    if not (1 <= month <= 12):
        return None
    return f"{year:04d}-{month:02d}"


def daily_to_month(raw: object) -> str | None:
    """DSPA's daily "YYYY/M/D" (wwtp.macau only) -> the "YYYY-MM" it falls in."""
    m = DAILY_PERIOD_RE.match(clean(raw))
    if not m:
        return None
    year, month = int(m.group(1)), int(m.group(2))
    if not (1 <= month <= 12):
        return None
    return f"{year:04d}-{month:02d}"


def fetch_dspa(endpoint: str, appcode: str) -> list[dict]:
    """POST an empty body to a DSPA API gateway endpoint — copied from
    fetch_waste.py's fetch_dspa() (see the module docstring for why this is a
    copy, not an import): same public-APPCODE-header pattern, retrying network
    errors, non-200s, and any body that doesn't parse as a JSON list.
    `endpoint` may itself carry a "/" — wwtp.coloane / wwtp.crossborder are
    server-side-filtered views at .../V_T_Bas_WWTP_Approved/coloane etc."""
    url = f"{GATEWAY_BASE}/{endpoint}"
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


def build_series(records: list[dict], period_field: str, value_fields: dict[str, str],
                  dataset_id: str | None, url: str, unit: str,
                  category_field: str | None = None, category_value: str | None = None) -> dict | None:
    """One series' `{datasetId, url, unit, latest, months}` from upstream rows
    that are already one-per-month, or None if nothing usable came back."""
    by_period: dict[str, dict] = {}
    for r in records:
        if category_field is not None and clean(r.get(category_field)).lower() != category_value:
            continue
        period = normalize_period(r.get(period_field))
        if period is None:
            continue
        try:
            entry = {"period": period}
            for src, dst in value_fields.items():
                entry[dst] = float(clean(r.get(src)))
        except ValueError:
            continue
        by_period[period] = entry
    if not by_period:
        return None
    months = [by_period[p] for p in sorted(by_period)][-MONTHS_KEPT:]
    return {
        "datasetId": dataset_id,
        "url": url,
        "unit": unit,
        "latest": months[-1],
        "months": months,
    }


def build_wwtp_macau(records: list[dict]) -> dict | None:
    """wwtp.macau's series: T_Bas_WWTP_Macau_Approved is DAILY (~6,400 rows),
    unlike every other series here, so its CollectionPeriod ("2026/6/9") is
    grouped by (year, month) and MDTOverflow / Influent_ProcessFlow summed per
    month -> basicM3 / biologicalM3, totalM3 = the two added — this is what
    reproduces the DSPA GIS page's monthly 污水處理總量 (checked against a live
    fetch: June 2026 = 2,267,341 + 3,806,060 = 6,073,401 m3). `Category` comes
    back as both "macau" and "Macau" upstream; both are kept."""
    sums: dict[str, dict[str, float]] = {}
    for r in records:
        if clean(r.get("Category")).lower() != "macau":
            continue
        period = daily_to_month(r.get("CollectionPeriod"))
        if period is None:
            continue
        try:
            basic = float(clean(r.get("MDTOverflow")))
            bio = float(clean(r.get("Influent_ProcessFlow")))
        except ValueError:
            continue
        agg = sums.setdefault(period, {"basicM3": 0.0, "biologicalM3": 0.0})
        agg["basicM3"] += basic
        agg["biologicalM3"] += bio
    if not sums:
        return None
    months = []
    for p in sorted(sums):
        basic = round(sums[p]["basicM3"], 3)
        bio = round(sums[p]["biologicalM3"], 3)
        months.append({"period": p, "basicM3": basic, "biologicalM3": bio, "totalM3": round(basic + bio, 3)})
    months = months[-MONTHS_KEPT:]
    return {
        "datasetId": WWTP_MACAU_DATASET_ID,
        "url": DETAIL.format(id=WWTP_MACAU_DATASET_ID),
        "unit": "m3",
        "latest": months[-1],
        "months": months,
    }


def fetch_series(key: str, endpoint: str, appcode: str, builder, *builder_args) -> dict | None:
    """Best-effort wrapper shared by every series: any failure (network,
    shape, no usable rows) prints a warning and returns None — see the module
    docstring."""
    try:
        records = fetch_dspa(endpoint, appcode)
    except RuntimeError as e:
        print(f"  warning: {key} fetch failed, series will be null: {e}", file=sys.stderr)
        return None
    print(f"  {endpoint}: {len(records)} records")
    series = builder(records, *builder_args)
    if series is None:
        print(f"  warning: {key} had no usable rows, series will be null", file=sys.stderr)
    return series


def run() -> int:
    appcode = os.environ.get("DATAGOVMO_APPCODE")
    if not appcode:
        print(
            "ERROR: DATAGOVMO_APPCODE is not set. Export the public APPCODE printed on "
            "the DSPA dataset pages (e.g. https://data.gov.mo/Detail?id=8142c05e-818a-478a-9256-4ecd494d3f87) "
            "before running this script, e.g. DATAGOVMO_APPCODE=... uv run python scripts/fetch_dspa_stats.py",
            file=sys.stderr,
        )
        return 2

    print("Fetching DSPA monthly statistics (incinerator, hazardous station, landfill, 4 WWTPs; best-effort per series)")

    series: dict[str, dict | None] = {}
    for key, endpoint, period_field, value_fields, dataset_id, url, unit, cat_field, cat_value in SERIES_TABLE:
        print(f"- {key} ({endpoint})")
        resolved_url = DETAIL.format(id=dataset_id) if dataset_id else url
        series[key] = fetch_series(
            key, endpoint, appcode, build_series,
            period_field, value_fields, dataset_id, resolved_url, unit, cat_field, cat_value,
        )

    if series.get("incinerator") is not None:
        series["incinerator"]["facts"] = INCINERATOR_FACTS

    print(f"- wwtp.macau ({WWTP_MACAU_ENDPOINT}, daily rows summed per month)")
    wwtp_macau = fetch_series("wwtp.macau", WWTP_MACAU_ENDPOINT, appcode, build_wwtp_macau)

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "incinerator": series["incinerator"],
        "hazardous": series["hazardous"],
        "landfill": series["landfill"],
        "wwtp": {
            "macau": wwtp_macau,
            "taipa": series["wwtp.taipa"],
            "coloane": series["wwtp.coloane"],
            "crossborder": series["wwtp.crossborder"],
            "mia": None,  # no open dataset — see the module docstring
        },
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    def latest_label(name: str, s: dict | None) -> str:
        return f"{name}=null" if s is None else f"{name}={s['latest']['period']}"

    print("Done. " + "  ".join(latest_label(k, output[k]) for k in ("incinerator", "hazardous", "landfill")))
    print("  " + "  ".join(latest_label(f"wwtp.{k}", v) for k, v in output["wwtp"].items()))
    size = OUTPUT_PATH.stat().st_size
    print(f"Wrote {OUTPUT_PATH} ({size / 1024:.1f} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(run())
