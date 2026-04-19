"""
Daily scraper: determines which Macau bus routes have no service today.

Reads route IDs from data/bus_reference/route_list.json, fetches each
route's schedule page from motransportinfo.com, and parses the service
time table to detect '不設服務' rows under the category that matches
today's day-of-week / public-holiday status (Macau timezone).

Output: service-status.json with today's date, day category, and the
list of route IDs that are inactive today.
"""

import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import holidays
import requests
from bs4 import BeautifulSoup

MACAU_TZ = timezone(timedelta(hours=8))
BASE_URL = "https://motransportinfo.com/zh"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
DELAY = 0.4
TIMEOUT = 15

REFERENCE_DIR = Path(__file__).parent.parent / "bus_reference"
OUTPUT_DIR = Path(__file__).parent.parent / "output"

DAY_CHARS = "一二三四五六日"


def today_macau() -> datetime:
    return datetime.now(tz=MACAU_TZ)


def is_macau_holiday(d: datetime) -> bool:
    year = d.year
    try:
        cal = holidays.country_holidays("MO", years=year)
    except (NotImplementedError, KeyError):
        cal = holidays.country_holidays("HK", years=year)
    return d.date() in cal


def category_matches(text: str, dow: int, is_holiday: bool) -> bool:
    """Does this schedule category header apply to today?"""
    excludes_holiday = "公眾假期除外" in text

    if is_holiday:
        if not excludes_holiday and ("公眾假期" in text or (text.strip() == "假期")):
            return True

    for m in re.finditer(r"星期([一二三四五六日])至([一二三四五六日])", text):
        s = DAY_CHARS.index(m.group(1))
        e = DAY_CHARS.index(m.group(2))
        if s <= dow <= e:
            if is_holiday and excludes_holiday:
                return False
            return True

    if "星期六" in text and ("星期日" in text or "、日" in text):
        if dow in (5, 6):
            return True

    for m in re.finditer(r"星期([一二三四五六日])(?!至)", text):
        if DAY_CHARS.index(m.group(1)) == dow:
            if is_holiday and excludes_holiday:
                return False
            return True

    return False


def parse_schedule_status(html: str, dow: int, is_holiday: bool) -> dict:
    """Parse the service-hours table and decide if today has service."""
    soup = BeautifulSoup(html, "html.parser")

    table = None
    for t in soup.find_all("table"):
        if any("服務時間" in (th.get_text() or "") for th in t.find_all("th")):
            table = t
            break

    if not table:
        return {"matched": False, "has_service": True, "categories": [], "reason": "no_schedule_table"}

    categories: list[dict] = []
    current: dict | None = None

    for tr in table.find_all("tr"):
        header_th = None
        for th in tr.find_all("th"):
            if th.get("colspan") == "2":
                header_th = th
                break
        if header_th:
            text = header_th.get_text(strip=True)
            if "服務時間" in text or "班次" in text:
                continue
            current = {
                "text": text,
                "matches": category_matches(text, dow, is_holiday),
                "has_service": False,
            }
            categories.append(current)
            continue
        if not current:
            continue
        tds = tr.find_all("td")
        if not tds:
            continue
        row_text = " ".join(td.get_text(strip=True) for td in tds)
        if "不設服務" not in row_text and row_text.strip():
            current["has_service"] = True

    matched_cats = [c for c in categories if c["matches"]]
    if not matched_cats:
        return {"matched": False, "has_service": True, "categories": categories, "reason": "no_category_match"}
    has_service = any(c["has_service"] for c in matched_cats)
    return {"matched": True, "has_service": has_service, "categories": categories}


def fetch_route_status(route_id: str, dow: int, is_holiday: bool) -> dict:
    url = f"{BASE_URL}/route/{route_id}/0"
    resp = requests.get(url, timeout=TIMEOUT, headers=HEADERS)
    resp.raise_for_status()
    status = parse_schedule_status(resp.text, dow, is_holiday)
    return {"id": route_id, **status}


def run() -> int:
    now = today_macau()
    dow = now.weekday()
    holiday = is_macau_holiday(now)

    day_category = "weekday"
    if holiday:
        day_category = "holiday"
    elif dow == 5:
        day_category = "saturday"
    elif dow == 6:
        day_category = "sunday"

    route_list_path = REFERENCE_DIR / "route_list.json"
    if not route_list_path.exists():
        print(f"ERROR: {route_list_path} missing", file=sys.stderr)
        return 1
    route_list = json.load(open(route_list_path, "r", encoding="utf-8"))

    print(f"Today (Macau): {now.date()}  dow={dow}  holiday={holiday}  category={day_category}")
    print(f"Checking {len(route_list)} routes...")

    inactive: list[str] = []
    errors: list[dict] = []

    for i, r in enumerate(route_list):
        rid = r["id"]
        try:
            time.sleep(DELAY)
            result = fetch_route_status(rid, dow, holiday)
            status_label = "ACTIVE" if result["has_service"] else "INACTIVE"
            matched_note = "" if result["matched"] else "  (no category match, defaulted ACTIVE)"
            print(f"  [{i+1}/{len(route_list)}] {rid:>6}  {status_label}{matched_note}")
            if not result["has_service"]:
                inactive.append(rid)
        except Exception as e:
            print(f"  [{i+1}/{len(route_list)}] {rid:>6}  ERROR: {e}", file=sys.stderr)
            errors.append({"id": rid, "error": str(e)})

    output = {
        "date": now.date().isoformat(),
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "dayOfWeek": dow,
        "dayCategory": day_category,
        "isHoliday": holiday,
        "totalRoutes": len(route_list),
        "inactive": sorted(inactive),
        "errors": errors,
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "service-status.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone. {len(inactive)}/{len(route_list)} routes inactive today.")
    print(f"Errors: {len(errors)}")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
