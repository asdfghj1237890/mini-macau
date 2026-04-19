"""
Scrape ferry schedules covering Macau.

Turbojet (噴射飛航): https://www2.turbojet.com.hk/zh-tw/海-船/
  Tab 1 (香港 - 澳門線) hosts two separate regular schedules, one per Macau
  terminal — we emit both:
    - hkgmacroute     香港(上環) ↔ 澳門(外港)
    - hkgtaiparoute   香港(上環) ↔ 澳門(氹仔)   (block 2, past 至尊轎車)
  Tabs 2-4 use Macau Outer Harbour (外港) only:
    - maczykroute          澳門 - 蛇口線
    - shenzhenmacauroute   深圳機場 - 澳門線
    - clkmacroute          香港國際機場 - 澳門線
  Picks the schedule effective on today's date (most recent
  "以下航班時間於YYYY年M月D日起生效" marker <= today), and extracts
  per-direction day and night times plus journey duration and notes.
  至尊轎車 (Premier Car Service) tables are skipped.

Cotai Water Jet (金光飛航):
  https://m.cotaiwaterjet.com/hk/ferry-schedule/hongkong-macau-taipa.html
  One scheduled route pair (cotai_hkg_taipa), two directions:
    - 香港(上環) → 澳門(氹仔)
    - 澳門(氹仔) → 香港(上環)
  (Airport ↔ Taipa routes on the same page are charter-only and skipped.)

Output: public/data/ferry-schedules.json — each route carries
`operator` ("turbojet" | "cotai") and `terminal` ("outer_harbour" | "taipa").
"""

import io
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Tag

# Console output sometimes falls back to cp950 on Windows — force UTF-8 so
# Chinese route names print cleanly regardless of the host terminal.
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

TURBOJET_URL = "https://www2.turbojet.com.hk/zh-tw/%E6%B5%B7-%E8%88%B9/"
COTAI_URL = "https://m.cotaiwaterjet.com/hk/ferry-schedule/hongkong-macau-taipa.html"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
MACAU_TZ = timezone(timedelta(hours=8))

# Turbojet tabs. Tab number matches the page order; `terminal` selects
# which Macau endpoint within the tab's schedule blocks. Tab 1 appears
# twice: its block 2 also carries a regular 氹仔 schedule below the
# 至尊轎車 (Premier Car Service) table.
TARGET_TABS = [
    {"num": 1, "id": "hkgmacroute",        "terminal": "outer_harbour",
     "nameZh": "香港 - 澳門(外港)線", "nameEn": "Hong Kong - Macau (Outer Harbour)"},
    {"num": 1, "id": "hkgtaiparoute",      "terminal": "taipa",
     "nameZh": "香港 - 澳門(氹仔)線", "nameEn": "Hong Kong - Macau (Taipa)"},
    {"num": 2, "id": "maczykroute",        "terminal": "outer_harbour",
     "nameZh": "澳門 - 蛇口線",         "nameEn": "Macau - Shekou"},
    {"num": 3, "id": "shenzhenmacauroute", "terminal": "outer_harbour",
     "nameZh": "深圳機場 - 澳門線",     "nameEn": "Shenzhen Airport - Macau"},
    {"num": 4, "id": "clkmacroute",        "terminal": "outer_harbour",
     "nameZh": "香港國際機場 - 澳門線",  "nameEn": "HK Intl Airport - Macau"},
]

# Cotai Water Jet scheduled route (charter-only airport legs are skipped).
# The page keeps all directions in #schedule-tableall-N containers; the
# route picker JS maps index 0 → 上環→氹仔 and index 2 → 氹仔→上環.
COTAI_ROUTE = {
    "id": "cotai_hkg_taipa",
    "terminal": "taipa",
    "nameZh": "香港(上環) - 澳門(氹仔)線",
    "nameEn": "Hong Kong (Sheung Wan) - Macau (Taipa)",
    "journeyMinutes": 60,
    "directions": [
        {"tableallIndex": 0, "from": "香港(上環)",   "to": "澳門(氹仔)"},
        {"tableallIndex": 2, "from": "澳門(氹仔)",   "to": "香港(上環)"},
    ],
}

OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "ferry-schedules.json"

DATE_RE = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日")
EFFECTIVE_RE = re.compile(r"以下航班時間.*生效")
# Markers observed on operator pages: * (Turbojet), # (Turbojet/Cotai),
# @ (Cotai). All denote footnoted conditional sailings.
TIME_RE = re.compile(r"(\d{1,2}):(\d{2})([@#*]*)")


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
    markers with the tables that follow them. Skips bg-gold premium tables
    and 至尊轎車 (Premier Car Service) tables — the latter sit inline with
    regular tables inside the same block (see Tab 1 block 2).
    """
    blocks = []
    for block in section.find_all("div", class_="details-editor-block"):
        tables = []
        current = None
        is_premium = False  # latched true by 至尊轎車 text, cleared by regular EFFECTIVE_RE
        for elem in block.descendants:
            if not isinstance(elem, Tag):
                continue
            if elem.name == "p":
                text = elem.get_text(strip=True)
                if "至尊轎車" in text:
                    is_premium = True
                if EFFECTIVE_RE.search(text):
                    current = parse_effective_date(text)
                    is_premium = False
                    continue
            if elem.name == "div":
                classes = elem.get("class", []) or []
                if "details-table" in classes and "details-table-block" not in classes:
                    if "bg-gold" in classes:
                        continue
                    if is_premium:
                        continue
                    tables.append({"effective": current, "table": elem})
        notes = []
        for p in block.find_all("p"):
            t = p.get_text(" ", strip=True)
            if not t or EFFECTIVE_RE.search(t) or t.startswith("[") or "購票須知" in t or "備註" in t:
                continue
            if "至尊轎車" in t:
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


TERMINAL_MARKER = {
    "outer_harbour": "外港",
    "taipa": "氹仔",
}


def has_terminal(directions: list[dict], terminal: str) -> bool:
    marker = TERMINAL_MARKER[terminal]
    return any(marker in d["header"] for d in directions)


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


def process_tab(soup: BeautifulSoup, meta: dict, today: date,
                tab_cache: dict) -> dict | None:
    """Emit the schedule for (tab, terminal). Tab parsing is cached so a
    single tab feeding multiple terminals (e.g. Tab 1 → outer_harbour + taipa)
    is parsed once.
    """
    cache_key = meta["num"]
    cached = tab_cache.get(cache_key)
    if cached is None:
        tab = find_content_tab(soup, meta["num"])
        if not tab:
            print(f"    WARN: tab div not found")
            tab_cache[cache_key] = {"journey": None, "blocks": []}
            return None
        journey = extract_journey_minutes(tab)
        section = find_schedule_section(tab)
        if not section:
            print(f"    WARN: 船期表 section not found")
            tab_cache[cache_key] = {"journey": journey, "blocks": []}
            return None
        blocks = parse_schedule_blocks(section)
        cached = {"journey": journey, "blocks": blocks}
        tab_cache[cache_key] = cached

    journey = cached["journey"]
    blocks = cached["blocks"]
    terminal = meta["terminal"]
    marker = TERMINAL_MARKER[terminal]

    # Collect candidates across *all* blocks; different terminals may live
    # in different blocks of the same tab (Tab 1: OH in block 1, 氹仔 in
    # block 2). Notes come from the winning candidate's block.
    candidates: list[dict] = []
    for block in blocks:
        for c in block["tables"]:
            dirs = parse_direction_table(c["table"])
            if not dirs or not has_terminal(dirs, terminal):
                continue
            candidates.append({
                "effective": c["effective"],
                "directions": dirs,
                "notes": block["notes"],
            })
    if not candidates:
        print(f"    WARN: no {marker} schedule found")
        return None

    active = pick_active(candidates, today)
    if not active:
        return None

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
        "operator": "turbojet",
        "terminal": terminal,
        "nameZh": meta["nameZh"],
        "nameEn": meta["nameEn"],
        "journeyMinutes": journey,
        "effectiveDate": active["effective"].isoformat() if active["effective"] else None,
        "directions": directions_out,
        "notes": active["notes"],
    }


def fetch_cotai() -> dict | None:
    """Scrape Cotai Water Jet 上環↔氹仔 schedules.

    The page hosts one active route pair plus two airport legs that are
    currently charter-only (skipped). Each direction lives in its own
    #schedule-tableall-N container; we pull the .sch-table inside and
    extract HH:MM[@#*] tokens. No day/night split on this site — all
    times go into `day` and `night` stays empty.
    """
    print(f"Fetching {COTAI_URL}")
    resp = requests.get(COTAI_URL, timeout=30, headers=HEADERS)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    directions_out = []
    for spec in COTAI_ROUTE["directions"]:
        idx = spec["tableallIndex"]
        container = soup.find("div", id=f"schedule-tableall-{idx}")
        if not container:
            print(f"    WARN: schedule-tableall-{idx} not found")
            continue
        table = container.find("table", class_="sch-table")
        if not table:
            print(f"    WARN: sch-table in tableall-{idx} not found")
            continue
        times = extract_times(table.get_text(" ", strip=True))
        if not times:
            print(f"    WARN: no times in tableall-{idx}")
            continue
        directions_out.append({
            "header": f"{spec['from']} -> {spec['to']}",
            "from": spec["from"],
            "to": spec["to"],
            "day": times,
            "night": [],
        })

    if not directions_out:
        return None

    # Footnote legends (e.g. "@ 只於4月3-6日提供服務").
    legend_re = re.compile(r"([@#*])\s*(只於[^<>\n]{1,80}|Only[^<>\n]{1,80})")
    notes: list[str] = []
    for m in legend_re.finditer(resp.text):
        note = f"{m.group(1)} {m.group(2).strip()}"
        if note not in notes:
            notes.append(note)

    day_total = sum(len(d["day"]) for d in directions_out)
    print(f"    journey={COTAI_ROUTE['journeyMinutes']}min  "
          f"{day_total} departures across {len(directions_out)} directions  "
          f"notes={len(notes)}")

    return {
        "id": COTAI_ROUTE["id"],
        "operator": "cotai",
        "terminal": COTAI_ROUTE["terminal"],
        "nameZh": COTAI_ROUTE["nameZh"],
        "nameEn": COTAI_ROUTE["nameEn"],
        "journeyMinutes": COTAI_ROUTE["journeyMinutes"],
        "effectiveDate": None,
        "directions": directions_out,
        "notes": notes,
    }


def run() -> int:
    today = datetime.now(tz=MACAU_TZ).date()
    print(f"Today (Macau): {today}")

    routes: list[dict] = []

    # --- Turbojet ---
    print(f"\nFetching {TURBOJET_URL}")
    resp = requests.get(TURBOJET_URL, timeout=30, headers=HEADERS)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    turbojet_ok = 0
    tab_cache: dict = {}
    for meta in TARGET_TABS:
        print(f"  Tab {meta['num']} [{meta['terminal']}]: {meta['nameZh']} (#{meta['id']})")
        r = process_tab(soup, meta, today, tab_cache)
        if not r:
            continue
        day_total = sum(len(d["day"]) for d in r["directions"])
        night_total = sum(len(d["night"]) for d in r["directions"])
        print(f"    effective={r['effectiveDate']}  journey={r['journeyMinutes']}min  "
              f"{day_total} day + {night_total} night departures across "
              f"{len(r['directions'])} directions")
        routes.append(r)
        turbojet_ok += 1

    # --- Cotai Water Jet ---
    print()
    cotai_route = fetch_cotai()
    cotai_ok = 1 if cotai_route else 0
    if cotai_route:
        routes.append(cotai_route)

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "effectiveAs": today.isoformat(),
        "sources": {
            "turbojet": TURBOJET_URL,
            "cotai": COTAI_URL,
        },
        "routes": routes,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nWrote {OUTPUT_PATH}")
    expected = len(TARGET_TABS) + 1
    print(f"Done: {len(routes)}/{expected} routes "
          f"(turbojet {turbojet_ok}/{len(TARGET_TABS)}, cotai {cotai_ok}/1)")
    return 0 if len(routes) == expected else 1


if __name__ == "__main__":
    sys.exit(run())
