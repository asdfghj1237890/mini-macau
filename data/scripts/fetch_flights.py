"""
Fetch MFM (Macau International Airport) flight data from AviationStack API
and generate a static flights.json timetable for the Mini Macau simulation.

Usage:
    AVIATIONSTACK_API_KEY=<key> uv run python data/scripts/fetch_flights.py

Output: public/data/flights.json
"""

import json
import math
import os
import sys
from pathlib import Path

import requests

API_KEY = os.environ.get("AVIATIONSTACK_API_KEY", "")
BASE_URL = "http://api.aviationstack.com/v1/flights"
OUTPUT_PATH = Path(__file__).resolve().parent.parent.parent / "public" / "data" / "flights.json"

MFM_LAT = 22.1494
MFM_LON = 113.5914

KNOWN_AIRPORTS: dict[str, tuple[float, float]] = {
    "HKG": (22.3080, 113.9185),
    "PEK": (40.0799, 116.6031),
    "PKX": (39.5098, 116.4105),
    "PVG": (31.1443, 121.8083),
    "SHA": (31.1979, 121.3362),
    "TPE": (25.0797, 121.2342),
    "KHH": (22.5771, 120.3500),
    "ICN": (37.4602, 126.4407),
    "NRT": (35.7720, 140.3929),
    "KIX": (34.4273, 135.2441),
    "BKK": (13.6900, 100.7501),
    "SIN": (1.3644, 103.9915),
    "KUL": (2.7456, 101.7099),
    "MNL": (14.5086, 121.0198),
    "SGN": (10.8188, 106.6520),
    "HAN": (21.2212, 105.8070),
    "DAD": (16.0439, 108.1992),
    "CAN": (23.3924, 113.2988),
    "SZX": (22.6393, 113.8107),
    "XMN": (24.5440, 118.1277),
    "NKG": (31.7420, 118.8620),
    "CTU": (30.5728, 103.9472),
    "CKG": (29.7192, 106.6422),
    "WUH": (30.7838, 114.2081),
    "CSX": (28.1892, 113.2200),
    "HAK": (19.9349, 110.4590),
    "KMG": (25.1019, 102.9291),
    "TAO": (36.2661, 120.3744),
    "DLC": (38.9657, 121.5386),
    "TNA": (36.8572, 117.2158),
    "CGO": (34.5197, 113.8409),
    "HGH": (30.2295, 120.4344),
    "WNZ": (27.9122, 120.8522),
    "FOC": (25.9351, 119.6633),
    "SWA": (23.4269, 116.7623),
    "NNG": (22.6083, 108.1722),
    "HFE": (31.7800, 117.2984),
    "TSN": (39.1244, 117.3462),
    "SYX": (18.3029, 109.4122),
    "ZUH": (22.0064, 113.3760),
}


def compute_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute initial bearing from point 1 to point 2 in degrees."""
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(lat2_r)
    y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def parse_scheduled_minutes(time_str: str | None) -> int | None:
    """Parse ISO datetime string to minutes since midnight (Macau time UTC+8)."""
    if not time_str:
        return None
    try:
        from datetime import datetime, timezone, timedelta
        dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
        macau_tz = timezone(timedelta(hours=8))
        dt_macau = dt.astimezone(macau_tz)
        return dt_macau.hour * 60 + dt_macau.minute
    except Exception:
        return None


def fetch_flights(direction: str) -> list[dict]:
    """Fetch flights from AviationStack. direction: 'dep' or 'arr'."""
    params = {
        "access_key": API_KEY,
        f"{'dep' if direction == 'dep' else 'arr'}_iata": "MFM",
        "limit": 100,
    }
    try:
        resp = requests.get(BASE_URL, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            print(f"  API error: {data['error']}", file=sys.stderr)
            return []
        return data.get("data", [])
    except Exception as e:
        print(f"  Request failed: {e}", file=sys.stderr)
        return []


def process_flight(raw: dict, flight_type: str) -> dict | None:
    """Convert an AviationStack flight record to our format.

    Codeshare flights (where flight.codeshared is present) are skipped
    to avoid duplicates — only the actual operating flight is kept.
    """
    departure = raw.get("departure", {}) or {}
    arrival = raw.get("arrival", {}) or {}
    flight_info = raw.get("flight", {}) or {}
    airline_info = raw.get("airline", {}) or {}

    if flight_info.get("codeshared"):
        return None

    flight_number = flight_info.get("iata") or flight_info.get("icao") or ""
    if not flight_number:
        return None

    if flight_type == "departure":
        scheduled = parse_scheduled_minutes(departure.get("scheduled"))
        other_iata = (arrival.get("iata") or arrival.get("iataCode") or "").upper()
    else:
        scheduled = parse_scheduled_minutes(arrival.get("scheduled"))
        other_iata = (departure.get("iata") or departure.get("iataCode") or "").upper()

    if scheduled is None:
        return None

    if other_iata and other_iata in KNOWN_AIRPORTS:
        lat, lon = KNOWN_AIRPORTS[other_iata]
        bearing = compute_bearing(MFM_LAT, MFM_LON, lat, lon)
    else:
        bearing = 0 if flight_type == "departure" else 180

    airport_data = {
        "iata": other_iata,
        "name": (arrival if flight_type == "departure" else departure).get("airport", other_iata),
        "bearing": round(bearing, 1),
    }

    flight_id = f"{flight_number}-{'dep' if flight_type == 'departure' else 'arr'}-{scheduled:04d}"

    result: dict = {
        "id": flight_id,
        "flightNumber": flight_number,
        "airline": {
            "name": airline_info.get("name", ""),
            "iata": airline_info.get("iata", ""),
        },
        "type": flight_type,
        "scheduledTime": scheduled,
    }

    if flight_type == "departure":
        result["destination"] = airport_data
    else:
        result["origin"] = airport_data

    aircraft = raw.get("aircraft")
    if aircraft and aircraft.get("iata"):
        result["aircraftType"] = aircraft["iata"]

    return result


def main():
    if not API_KEY:
        print("AVIATIONSTACK_API_KEY not set. Generating sample flights.json.", file=sys.stderr)
        generate_sample()
        return

    print("Fetching MFM departures...")
    dep_raw = fetch_flights("dep")
    print(f"  Got {len(dep_raw)} departure records")

    print("Fetching MFM arrivals...")
    arr_raw = fetch_flights("arr")
    print(f"  Got {len(arr_raw)} arrival records")

    flights = []
    seen_ids: set[str] = set()

    for raw in dep_raw:
        f = process_flight(raw, "departure")
        if f and f["id"] not in seen_ids:
            flights.append(f)
            seen_ids.add(f["id"])

    for raw in arr_raw:
        f = process_flight(raw, "arrival")
        if f and f["id"] not in seen_ids:
            flights.append(f)
            seen_ids.add(f["id"])

    flights.sort(key=lambda f: f["scheduledTime"])

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(flights, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(flights)} flights to {OUTPUT_PATH}")


def generate_sample():
    """Generate a representative sample flights.json without an API key."""
    sample_flights = [
        {"id": "NX102-dep-0130", "flightNumber": "NX102", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 90, "destination": {"iata": "PEK", "name": "Beijing Capital", "bearing": 15.2}, "aircraftType": "A320"},
        {"id": "NX610-dep-0200", "flightNumber": "NX610", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 120, "destination": {"iata": "PVG", "name": "Shanghai Pudong", "bearing": 36.8}, "aircraftType": "A321"},
        {"id": "UO702-arr-0630", "flightNumber": "UO702", "airline": {"name": "HK Express", "iata": "UO"}, "type": "arrival", "scheduledTime": 390, "origin": {"iata": "ICN", "name": "Incheon Int'l", "bearing": 30.5}, "aircraftType": "A320"},
        {"id": "NX116-dep-0700", "flightNumber": "NX116", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 420, "destination": {"iata": "PEK", "name": "Beijing Capital", "bearing": 15.2}, "aircraftType": "A321"},
        {"id": "5J968-arr-0730", "flightNumber": "5J968", "airline": {"name": "Cebu Pacific", "iata": "5J"}, "type": "arrival", "scheduledTime": 450, "origin": {"iata": "MNL", "name": "Manila", "bearing": 161.3}, "aircraftType": "A320"},
        {"id": "NX806-dep-0800", "flightNumber": "NX806", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 480, "destination": {"iata": "TPE", "name": "Taoyuan Int'l", "bearing": 47.5}, "aircraftType": "A321"},
        {"id": "KA801-arr-0830", "flightNumber": "KA801", "airline": {"name": "Cathay Dragon", "iata": "KA"}, "type": "arrival", "scheduledTime": 510, "origin": {"iata": "HKG", "name": "Hong Kong Int'l", "bearing": 63.7}},
        {"id": "NX132-dep-0900", "flightNumber": "NX132", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 540, "destination": {"iata": "CAN", "name": "Guangzhou Baiyun", "bearing": 340.8}, "aircraftType": "A320"},
        {"id": "LJ025-arr-0930", "flightNumber": "LJ025", "airline": {"name": "Jin Air", "iata": "LJ"}, "type": "arrival", "scheduledTime": 570, "origin": {"iata": "ICN", "name": "Incheon Int'l", "bearing": 30.5}, "aircraftType": "B738"},
        {"id": "NX170-dep-1000", "flightNumber": "NX170", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 600, "destination": {"iata": "CTU", "name": "Chengdu Tianfu", "bearing": 315.2}, "aircraftType": "A320"},
        {"id": "FD525-arr-1030", "flightNumber": "FD525", "airline": {"name": "Thai AirAsia", "iata": "FD"}, "type": "arrival", "scheduledTime": 630, "origin": {"iata": "BKK", "name": "Suvarnabhumi", "bearing": 234.6}, "aircraftType": "A320"},
        {"id": "TR905-arr-1100", "flightNumber": "TR905", "airline": {"name": "Scoot", "iata": "TR"}, "type": "arrival", "scheduledTime": 660, "origin": {"iata": "SIN", "name": "Changi", "bearing": 207.1}, "aircraftType": "B788"},
        {"id": "NX622-dep-1130", "flightNumber": "NX622", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 690, "destination": {"iata": "PVG", "name": "Shanghai Pudong", "bearing": 36.8}, "aircraftType": "A321"},
        {"id": "MU2002-arr-1200", "flightNumber": "MU2002", "airline": {"name": "China Eastern", "iata": "MU"}, "type": "arrival", "scheduledTime": 720, "origin": {"iata": "PVG", "name": "Shanghai Pudong", "bearing": 36.8}, "aircraftType": "A320"},
        {"id": "NX118-dep-1230", "flightNumber": "NX118", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 750, "destination": {"iata": "PEK", "name": "Beijing Capital", "bearing": 15.2}, "aircraftType": "A320"},
        {"id": "CA1730-arr-1300", "flightNumber": "CA1730", "airline": {"name": "Air China", "iata": "CA"}, "type": "arrival", "scheduledTime": 780, "origin": {"iata": "PEK", "name": "Beijing Capital", "bearing": 15.2}, "aircraftType": "A321"},
        {"id": "NX808-dep-1330", "flightNumber": "NX808", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 810, "destination": {"iata": "TPE", "name": "Taoyuan Int'l", "bearing": 47.5}, "aircraftType": "A321"},
        {"id": "KE828-arr-1400", "flightNumber": "KE828", "airline": {"name": "Korean Air", "iata": "KE"}, "type": "arrival", "scheduledTime": 840, "origin": {"iata": "ICN", "name": "Incheon Int'l", "bearing": 30.5}, "aircraftType": "A321"},
        {"id": "NX162-dep-1430", "flightNumber": "NX162", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 870, "destination": {"iata": "NKG", "name": "Nanjing Lukou", "bearing": 32.1}, "aircraftType": "A320"},
        {"id": "MF870-arr-1500", "flightNumber": "MF870", "airline": {"name": "Xiamen Airlines", "iata": "MF"}, "type": "arrival", "scheduledTime": 900, "origin": {"iata": "XMN", "name": "Xiamen Gaoqi", "bearing": 48.7}, "aircraftType": "B738"},
        {"id": "NX846-dep-1530", "flightNumber": "NX846", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 930, "destination": {"iata": "ICN", "name": "Incheon Int'l", "bearing": 30.5}, "aircraftType": "A321"},
        {"id": "HO1348-arr-1600", "flightNumber": "HO1348", "airline": {"name": "Juneyao Airlines", "iata": "HO"}, "type": "arrival", "scheduledTime": 960, "origin": {"iata": "PVG", "name": "Shanghai Pudong", "bearing": 36.8}, "aircraftType": "A320"},
        {"id": "NX136-dep-1630", "flightNumber": "NX136", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 990, "destination": {"iata": "CKG", "name": "Chongqing Jiangbei", "bearing": 312.4}, "aircraftType": "A320"},
        {"id": "VJ982-arr-1700", "flightNumber": "VJ982", "airline": {"name": "VietJet Air", "iata": "VJ"}, "type": "arrival", "scheduledTime": 1020, "origin": {"iata": "SGN", "name": "Tan Son Nhat", "bearing": 224.3}, "aircraftType": "A321"},
        {"id": "NX620-dep-1730", "flightNumber": "NX620", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 1050, "destination": {"iata": "PVG", "name": "Shanghai Pudong", "bearing": 36.8}, "aircraftType": "A321"},
        {"id": "BR828-arr-1800", "flightNumber": "BR828", "airline": {"name": "EVA Air", "iata": "BR"}, "type": "arrival", "scheduledTime": 1080, "origin": {"iata": "TPE", "name": "Taoyuan Int'l", "bearing": 47.5}, "aircraftType": "A321"},
        {"id": "NX812-dep-1830", "flightNumber": "NX812", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 1110, "destination": {"iata": "TPE", "name": "Taoyuan Int'l", "bearing": 47.5}, "aircraftType": "A321"},
        {"id": "9C8950-arr-1900", "flightNumber": "9C8950", "airline": {"name": "Spring Airlines", "iata": "9C"}, "type": "arrival", "scheduledTime": 1140, "origin": {"iata": "PVG", "name": "Shanghai Pudong", "bearing": 36.8}, "aircraftType": "A320"},
        {"id": "NX150-dep-1930", "flightNumber": "NX150", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 1170, "destination": {"iata": "WUH", "name": "Wuhan Tianhe", "bearing": 356.8}, "aircraftType": "A320"},
        {"id": "CZ3002-arr-2000", "flightNumber": "CZ3002", "airline": {"name": "China Southern", "iata": "CZ"}, "type": "arrival", "scheduledTime": 1200, "origin": {"iata": "CAN", "name": "Guangzhou Baiyun", "bearing": 340.8}, "aircraftType": "A320"},
        {"id": "NX810-dep-2030", "flightNumber": "NX810", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 1230, "destination": {"iata": "TPE", "name": "Taoyuan Int'l", "bearing": 47.5}, "aircraftType": "A321"},
        {"id": "UO704-arr-2100", "flightNumber": "UO704", "airline": {"name": "HK Express", "iata": "UO"}, "type": "arrival", "scheduledTime": 1260, "origin": {"iata": "ICN", "name": "Incheon Int'l", "bearing": 30.5}, "aircraftType": "A321"},
        {"id": "NX126-dep-2130", "flightNumber": "NX126", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 1290, "destination": {"iata": "PEK", "name": "Beijing Capital", "bearing": 15.2}, "aircraftType": "A320"},
        {"id": "CA1732-arr-2200", "flightNumber": "CA1732", "airline": {"name": "Air China", "iata": "CA"}, "type": "arrival", "scheduledTime": 1320, "origin": {"iata": "PEK", "name": "Beijing Capital", "bearing": 15.2}, "aircraftType": "A321"},
        {"id": "NX180-dep-2230", "flightNumber": "NX180", "airline": {"name": "Air Macau", "iata": "NX"}, "type": "departure", "scheduledTime": 1350, "destination": {"iata": "HAK", "name": "Haikou Meilan", "bearing": 243.5}, "aircraftType": "A320"},
        {"id": "MU260-arr-2300", "flightNumber": "MU260", "airline": {"name": "China Eastern", "iata": "MU"}, "type": "arrival", "scheduledTime": 1380, "origin": {"iata": "PVG", "name": "Shanghai Pudong", "bearing": 36.8}, "aircraftType": "A320"},
    ]
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(sample_flights, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(sample_flights)} sample flights to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
