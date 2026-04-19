"""
Fetch all Macau bus route and stop data from motransportinfo.com.
Extracts: route list, stop IDs, Chinese stop names, coordinates,
service hours, and frequency for every official bus route.
Saves structured JSON to data/bus_reference/ for downstream use.
"""

import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

os.environ["PYTHONUNBUFFERED"] = "1"

BASE_URL = "https://motransportinfo.com/zh"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
OUTPUT_DIR = Path(__file__).parent.parent / "bus_reference"
DELAY = 1.0


def fetch(url: str) -> bytes:
    """Fetch URL and return raw bytes."""
    resp = requests.get(url, timeout=20, headers=HEADERS)
    resp.raise_for_status()
    return resp.content


def get_route_list() -> list[dict]:
    """Get all bus route numbers and Chinese descriptions from search page."""
    raw = fetch(f"{BASE_URL}/search")
    text = raw.decode("utf-8", errors="replace")
    soup = BeautifulSoup(text, "html.parser")

    routes = []
    # Route cards: <a href="route/1/0"> containing route number and description
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        m = re.match(r"route/([^/]+)/0$", href)
        if not m:
            continue
        route_no = m.group(1)
        lines = [l.strip() for l in a.get_text().split("\n") if l.strip()]
        if len(lines) >= 2:
            description = lines[1]
        elif len(lines) == 1:
            description = ""
        else:
            continue
        routes.append({"id": route_no, "description": description})

    return routes


def parse_route_page(raw: bytes, route_no: str, direction: int) -> dict | None:
    """Parse a route page and extract stop/geo/schedule data."""
    text = raw.decode("utf-8", errors="replace")

    # Extract JavaScript arrays
    stop_m = re.search(r"var stop = \[(.*?)\];", text, re.DOTALL)
    station_m = re.search(r"var station = \[(.*?)\];", text, re.DOTALL)
    lat_m = re.search(r"var lat = \[(.*?)\];", text, re.DOTALL)
    lng_m = re.search(r"var lng = \[(.*?)\];", text, re.DOTALL)
    dir_m = re.search(r"var direction = '(\w+)';", text)
    textnum_m = re.search(r"var textnum = '(\d+)';", text)

    if not all([stop_m, lat_m, lng_m]):
        return None

    def parse_js_array(s: str) -> list[str]:
        return [x.strip().strip('"').strip("'") for x in s.split(",") if x.strip()]

    stops = parse_js_array(stop_m.group(1))
    lats = parse_js_array(lat_m.group(1))
    lngs = parse_js_array(lng_m.group(1))

    stations = []
    if station_m:
        stations = parse_js_array(station_m.group(1))

    # Parse service hours from HTML
    soup = BeautifulSoup(text, "html.parser")
    schedule = parse_schedule(soup)

    # Route type from page body text
    route_type = ""
    page_text = soup.get_text()
    if "雙向" in page_text:
        route_type = "bilateral"
    elif "循環" in page_text:
        route_type = "circular"

    return {
        "route_no": route_no,
        "direction": direction,
        "direction_name": dir_m.group(1) if dir_m else "",
        "route_type": route_type,
        "stop_count": int(textnum_m.group(1)) if textnum_m else len(stops),
        "stops": stops,
        "stations": stations,
        "lats": lats,
        "lngs": lngs,
        "schedule": schedule,
    }


def parse_schedule(soup: BeautifulSoup) -> list[dict]:
    """Parse service hours table into structured data."""
    schedule = []
    table = None
    for t in soup.find_all("table"):
        if any("服務時間" in (th.get_text() or "") for th in t.find_all("th")):
            table = t
            break

    if not table:
        return schedule

    current_period = ""
    for tr in table.find_all("tr"):
        th = tr.find("th")
        if th:
            period_text = th.get_text(strip=True)
            if period_text and "服務" not in period_text and "班次" not in period_text:
                current_period = period_text
            continue

        tds = tr.find_all("td")
        if len(tds) >= 2:
            time_range = tds[0].get_text(strip=True)
            freq_text = tds[1].get_text(strip=True)
            time_m = re.match(r"(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})", time_range)
            freq_m = re.match(r"(\d+)\s*-\s*(\d+)", freq_text)
            if time_m and freq_m:
                schedule.append({
                    "period": current_period,
                    "start": time_m.group(1),
                    "end": time_m.group(2),
                    "freq_min": int(freq_m.group(1)),
                    "freq_max": int(freq_m.group(2)),
                })

    return schedule


def compute_service_summary(schedule: list[dict]) -> dict:
    """Compute representative start hour, end hour, and avg frequency."""
    if not schedule:
        return {"start_hour": 6, "end_hour": 23, "avg_freq": 12}

    all_starts = []
    all_ends = []
    total_freq = 0
    count = 0

    for entry in schedule:
        sh, sm = map(int, entry["start"].split(":"))
        eh, em = map(int, entry["end"].split(":"))
        start_min = sh * 60 + sm
        end_min = eh * 60 + em
        # Period crosses midnight (e.g. 20:00-01:15) — treat end as next day
        if end_min <= start_min:
            end_min += 1440
        all_starts.append(start_min)
        all_ends.append(end_min)
        avg = (entry["freq_min"] + entry["freq_max"]) / 2
        total_freq += avg
        count += 1

    earliest_start = min(all_starts)
    latest_end = max(all_ends)

    start_hour = earliest_start // 60
    end_hour = latest_end // 60
    if latest_end % 60 > 0:
        end_hour += 1
    # Cap at 28 (past 4am) — downstream uses start<=end for same-day routes
    # and serviceHoursEnd*60 as minute offset, so values >24 are accepted.
    if end_hour > 28:
        end_hour = 28

    avg_freq = round(total_freq / count) if count else 12

    return {"start_hour": start_hour, "end_hour": end_hour, "avg_freq": avg_freq}


def fetch_route_data(route_no: str) -> dict:
    """Fetch data for a single route (both directions if bilateral)."""
    time.sleep(DELAY)
    raw0 = fetch(f"{BASE_URL}/route/{route_no}/0")
    d0 = parse_route_page(raw0, route_no, 0)

    if not d0:
        return {"route_no": route_no, "error": "failed to parse direction 0"}

    d1 = None
    if d0["route_type"] == "bilateral":
        time.sleep(DELAY)
        raw1 = fetch(f"{BASE_URL}/route/{route_no}/1")
        d1 = parse_route_page(raw1, route_no, 1)

    return {
        "route_no": route_no,
        "route_type": d0["route_type"],
        "directions": [d0] + ([d1] if d1 else []),
    }


def run():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    log = lambda msg: (print(msg, flush=True),)

    log("Fetching route list...")
    route_list = get_route_list()
    log(f"  Found {len(route_list)} routes")

    with open(OUTPUT_DIR / "route_list.json", "w", encoding="utf-8") as f:
        json.dump(route_list, f, ensure_ascii=False, indent=2)

    all_routes = []
    all_stops = {}

    for i, r in enumerate(route_list):
        route_no = r["id"]
        desc = r["description"]
        log(f"  [{i+1}/{len(route_list)}] Route {route_no}: {desc}")

        try:
            rd = fetch_route_data(route_no)
        except Exception as e:
            log(f"    ERROR: {e}")
            all_routes.append({"route_no": route_no, "error": str(e)})
            continue

        if "error" in rd:
            log(f"    WARN: {rd['error']}")
            all_routes.append(rd)
            continue

        sched_summary = {}
        for d in rd["directions"]:
            if d["schedule"] and not sched_summary:
                sched_summary = compute_service_summary(d["schedule"])

            for j, stop_id in enumerate(d["stops"]):
                if stop_id not in all_stops:
                    station_name = d["stations"][j] if j < len(d["stations"]) else ""
                    lat = float(d["lats"][j]) if j < len(d["lats"]) else 0
                    lng = float(d["lngs"][j]) if j < len(d["lngs"]) else 0
                    all_stops[stop_id] = {
                        "id": stop_id,
                        "nameCn": station_name,
                        "lat": lat,
                        "lng": lng,
                        "route_ids": [],
                    }
                if route_no not in all_stops[stop_id]["route_ids"]:
                    all_stops[stop_id]["route_ids"].append(route_no)

        route_entry = {
            "id": route_no,
            "description": desc,
            "route_type": rd["route_type"],
            "service_start": sched_summary.get("start_hour", 6),
            "service_end": sched_summary.get("end_hour", 23),
            "avg_freq": sched_summary.get("avg_freq", 12),
            "schedule": rd["directions"][0]["schedule"] if rd["directions"] else [],
            "directions": [],
        }
        for d in rd["directions"]:
            route_entry["directions"].append({
                "direction": d["direction"],
                "direction_name": d["direction_name"],
                "stops": d["stops"],
                "stations": d["stations"],
                "lats": d["lats"],
                "lngs": d["lngs"],
            })
        all_routes.append(route_entry)

        stop_count = sum(len(d["stops"]) for d in rd["directions"])
        freq = sched_summary.get("avg_freq", "?")
        log(f"    OK: {stop_count} stops, freq={freq}min, "
            f"hours={sched_summary.get('start_hour','?')}-{sched_summary.get('end_hour','?')}")

    routes_path = OUTPUT_DIR / "routes.json"
    stops_path = OUTPUT_DIR / "stops.json"

    with open(routes_path, "w", encoding="utf-8") as f:
        json.dump(all_routes, f, ensure_ascii=False, indent=2)
    with open(stops_path, "w", encoding="utf-8") as f:
        json.dump(list(all_stops.values()), f, ensure_ascii=False, indent=2)

    ok_count = sum(1 for r in all_routes if "error" not in r)
    log(f"\nDone: {ok_count}/{len(all_routes)} routes, {len(all_stops)} unique stops")
    log(f"Saved to {routes_path} and {stops_path}")


if __name__ == "__main__":
    run()
