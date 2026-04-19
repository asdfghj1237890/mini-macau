"""
Scrape Turbojet ferry schedules for routes from Macau Outer Harbour (外港).

Downloads https://www2.turbojet.com.hk/zh-tw/海-船/ and parses the four
tabs covering routes using Macau (外港) as an endpoint:
  - 香港 - 澳門線           (hkgmacroute)
  - 澳門 - 蛇口線           (maczykroute)
  - 深圳機場 - 澳門線       (shenzhenmacauroute)
  - 香港國際機場 - 澳門線   (clkmacroute)

For each tab picks the schedule effective on today's date (most recent
"以下航班時間於YYYY年M月D日起生效" marker <= today), and extracts per-
direction day and night departure times, plus journey duration and any
conditional-service footnotes.

Output: public/data/ferry-schedules.json
"""

import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Tag

URL = "https://www2.turbojet.com.hk/zh-tw/%E6%B5%B7-%E8%88%B9/"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
MACAU_TZ = timezone(timedelta(hours=8))

# Tabs we scrape. Tab number matches the page order (Tab 1..Tab 6).
TARGET_TABS = [
    {"num": 1, "id": "hkgmacroute",        "nameZh": "香港 - 澳門線",        "nameEn": "Hong Kong - Macau"},
    {"num": 2, "id": "maczykroute",        "nameZh": "澳門 - 蛇口線",        "nameEn": "Macau - Shekou"},
    {"num": 3, "id": "shenzhenmacauroute", "nameZh": "深圳機場 - 澳門線",    "nameEn": "Shenzhen Airport - Macau"},
    {"num": 4, "id": "clkmacroute",        "nameZh": "香港國際機場 - 澳門線", "nameEn": "HK Intl Airport - Macau"},
]

OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "ferry-schedules.json"

DATE_RE = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日")
EFFECTIVE_RE = re.compile(r"以下航班時間.*生效")
TIME_RE = re.compile(r"(\d{1,2}):(\d{2})([*#]*)")


def parse_effective_date(text: str) -> date | None:
    m = DATE_RE.search(text)
    if not m:
        return None
    return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))


def extract_times(text: str) -> list[dict]:
    """Find HH:MM optionally followed by *,# markers; normalise to zero-padded."""
    out = []
    for m in TIME_RE.finditer(text):
        hh, mm, markers = m.group(1), m.group(2), m.group(3)
        entry = {"time": f"{int(hh):02d}:{mm}"}
        if markers:
            entry["markers"] = markers
        out.append(entry)
    return out


def parse_cell_times(cell: Tag) -> dict:
    """A cell may be day-only, night-only, or day+night split by '夜航 :'."""
    text = cell.get_text("\n", strip=True)
    parts = re.split(r"夜航\s*[:：︰]?", text)
    day_text = parts[0] if parts else ""
    night_text = parts[1] if len(parts) > 1 else ""
    return {"day": extract_times(day_text), "night": extract_times(night_text)}


def find_content_tab(soup: BeautifulSoup, tab_num: int) -> Tag | None:
    """Find the content tab-pane (inside .tabs-content), not the banner tab."""
    container = soup.find("div", class_="tabs-content")
    if not container:
        return None
    return container.find("div", attrs={"data-w-tab": f"Tab {tab_num}"})


def extract_journey_minutes(container: Tag) -> int | None:
    road = container.find("div", class_="road-time-tx")
    if not road:
        return None
    nums = re.findall(r"\d+", road.get_text(strip=True))
    return int(nums[-1]) if nums else None


def find_schedule_section(tab: Tag) -> Tag | None:
    """Return the details-collapse-info under the '船期表' collapse-row."""
    for row in tab.find_all("div", class_="details-collapse-row"):
        title = row.find("div", class_="details-collapse-title")
        if title and "船期表" in title.get_text():
            return row.find("div", class_="details-collapse-info")
    return None


def parse_schedule_blocks(section: Tag) -> list[dict]:
    """Walk each editor-block in document order, pairing effective-date
    markers with the tables that follow them. Skips bg-gold premium tables.
    """
    blocks = []
    for block in section.find_all("div", class_="details-editor-block"):
        tables = []
        current = None
        for elem in block.descendants:
            if not isinstance(elem, Tag):
                continue
            if elem.name == "p":
                text = elem.get_text(strip=True)
                if EFFECTIVE_RE.search(text):
                    current = parse_effective_date(text)
                    continue
            if elem.name == "div":
                classes = elem.get("class", []) or []
                if "details-table" in classes and "details-table-block" not in classes:
                    if "bg-gold" in classes:
                        continue
                    tables.append({"effective": current, "table": elem})
        notes = []
        for p in block.find_all("p"):
            t = p.get_text(" ", strip=True)
            if not t or EFFECTIVE_RE.search(t) or t.startswith("[") or "購票須知" in t or "備註" in t:
                continue
            notes.append(t)
        blocks.append({"tables": tables, "notes": notes})
    return blocks


def parse_direction_table(table: Tag) -> list[dict] | None:
    thead = table.find("div", class_="details-table-thead")
    if not thead:
        return None
    headers = [td.get_text(strip=True) for td in thead.find_all("div", class_="details-table-td-tx")]
    if not headers:
        return None
    directions = [{"header": h, "day": [], "night": []} for h in headers]
    for row in table.find_all("div", class_="details-table-tr"):
        cells = [c for c in row.children if isinstance(c, Tag)
                 and "details-table-td" in (c.get("class", []) or [])]
        if len(cells) != len(headers):
            continue
        for i, cell in enumerate(cells):
            parsed = parse_cell_times(cell)
            directions[i]["day"].extend(parsed["day"])
            directions[i]["night"].extend(parsed["night"])
    return directions


def has_outer_harbour(directions: list[dict]) -> bool:
    return any("外港" in d["header"] for d in directions)


def pick_active(candidates: list[dict], today: date) -> dict | None:
    past = [c for c in candidates if c["effective"] and c["effective"] <= today]
    if past:
        return max(past, key=lambda c: c["effective"])
    undated = [c for c in candidates if c["effective"] is None]
    if undated:
        return undated[0]
    if candidates:
        return min(candidates, key=lambda c: c["effective"])
    return None


def split_direction_header(header: str) -> dict:
    """'澳門(外港) -> 香港(上環)' → {from, to}; falls back to single endpoint."""
    parts = re.split(r"\s*(?:->|-&gt;|→|&lt;-&gt;|<->)\s*", header)
    if len(parts) == 2:
        return {"from": parts[0].strip(), "to": parts[1].strip()}
    return {"from": header, "to": header}


def process_tab(soup: BeautifulSoup, meta: dict, today: date) -> dict | None:
    tab = find_content_tab(soup, meta["num"])
    if not tab:
        print(f"    WARN: tab div not found")
        return None
    journey = extract_journey_minutes(tab)
    section = find_schedule_section(tab)
    if not section:
        print(f"    WARN: 船期表 section not found")
        return None
    blocks = parse_schedule_blocks(section)

    for block in blocks:
        candidates = []
        for c in block["tables"]:
            dirs = parse_direction_table(c["table"])
            if not dirs or not has_outer_harbour(dirs):
                continue
            candidates.append({"effective": c["effective"], "directions": dirs})
        if not candidates:
            continue
        active = pick_active(candidates, today)
        if not active:
            continue
        directions_out = []
        for d in active["directions"]:
            endpoints = split_direction_header(d["header"])
            directions_out.append({
                "header": d["header"],
                "from": endpoints["from"],
                "to": endpoints["to"],
                "day": d["day"],
                "night": d["night"],
            })
        return {
            "id": meta["id"],
            "nameZh": meta["nameZh"],
            "nameEn": meta["nameEn"],
            "journeyMinutes": journey,
            "effectiveDate": active["effective"].isoformat() if active["effective"] else None,
            "directions": directions_out,
            "notes": block["notes"],
        }
    print(f"    WARN: no 外港 schedule found")
    return None


def run() -> int:
    print(f"Fetching {URL}")
    resp = requests.get(URL, timeout=30, headers=HEADERS)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    today = datetime.now(tz=MACAU_TZ).date()
    print(f"Today (Macau): {today}")

    routes = []
    for meta in TARGET_TABS:
        print(f"  Tab {meta['num']}: {meta['nameZh']} (#{meta['id']})")
        r = process_tab(soup, meta, today)
        if not r:
            continue
        day_total = sum(len(d["day"]) for d in r["directions"])
        night_total = sum(len(d["night"]) for d in r["directions"])
        print(f"    effective={r['effectiveDate']}  journey={r['journeyMinutes']}min  "
              f"{day_total} day + {night_total} night departures across "
              f"{len(r['directions'])} directions")
        routes.append(r)

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "effectiveAs": today.isoformat(),
        "source": URL,
        "routes": routes,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nWrote {OUTPUT_PATH}")
    print(f"Done: {len(routes)}/{len(TARGET_TABS)} routes")
    return 0 if len(routes) == len(TARGET_TABS) else 1


if __name__ == "__main__":
    sys.exit(run())
