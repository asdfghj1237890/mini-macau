"""
Extract Macau bus route and stop data.
Sources: DSAT website scraping + hardcoded major route data.
Generates bus-routes.json and bus-stops.json for the frontend.
"""

import json
import math
import time
import requests
from pathlib import Path
from osrm_route import get_road_geometry

OUTPUT_DIR = Path(__file__).parent.parent / "output"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

MACAU_BUS_OVERPASS = """
[out:json][timeout:120];
area["name:en"="Macau"]["admin_level"="4"]->.macau;
(
  relation["route"="bus"](area.macau);
  node["highway"="bus_stop"](22.10,113.50,22.22,113.60);
);
out body;
>;
out skel qt;
"""

ROUTE_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#e67e22", "#9b59b6",
    "#1abc9c", "#f39c12", "#d35400", "#c0392b", "#2980b9",
    "#27ae60", "#8e44ad", "#16a085", "#f1c40f", "#e84393",
    "#00b894", "#6c5ce7", "#fd79a8", "#0984e3", "#00cec9",
]

MAJOR_BUS_ROUTES = [
    {"id": "1", "name": "1", "stops": ["Barra", "Horta e Costa", "Flora Garden", "Portas do Cerco"], "freq": 8, "start": 6, "end": 24},
    {"id": "2", "name": "2", "stops": ["Barra", "Praia Grande", "NAPE", "Outer Harbour Ferry"], "freq": 10, "start": 6, "end": 23},
    {"id": "3", "name": "3", "stops": ["Portas do Cerco", "Horta e Costa", "Almeida Ribeiro", "Inner Harbour"], "freq": 6, "start": 6, "end": 24},
    {"id": "3A", "name": "3A", "stops": ["Portas do Cerco", "Horta e Costa", "NAPE", "Outer Harbour Ferry"], "freq": 8, "start": 6, "end": 24},
    {"id": "5", "name": "5", "stops": ["Barra", "Praia Grande", "Guia Hill", "Fai Chi Kei"], "freq": 8, "start": 6, "end": 24},
    {"id": "6A", "name": "6A", "stops": ["Portas do Cerco", "Red Market", "Inner Harbour", "Barra"], "freq": 10, "start": 6, "end": 23},
    {"id": "7", "name": "7", "stops": ["Barra", "Inner Harbour", "Horta e Costa", "Mong Ha"], "freq": 12, "start": 6, "end": 23},
    {"id": "8", "name": "8", "stops": ["Portas do Cerco", "Horta e Costa", "NAPE", "Science Museum"], "freq": 10, "start": 6, "end": 23},
    {"id": "10", "name": "10", "stops": ["Barra", "Praia Grande", "Horta e Costa", "Portas do Cerco"], "freq": 8, "start": 6, "end": 24},
    {"id": "10A", "name": "10A", "stops": ["Barra", "Praia Grande", "NAPE", "Outer Harbour Ferry"], "freq": 10, "start": 6, "end": 24},
    {"id": "11", "name": "11", "stops": ["Taipa Village", "Jockey Club", "Stadium", "Cotai"], "freq": 10, "start": 6, "end": 23},
    {"id": "15", "name": "15", "stops": ["Barra", "Taipa Bridge", "Taipa Village", "Hac Sa Beach"], "freq": 12, "start": 6, "end": 23},
    {"id": "21A", "name": "21A", "stops": ["Barra", "Nam Van", "Taipa Bridge", "Coloane Village"], "freq": 12, "start": 6, "end": 23},
    {"id": "22", "name": "22", "stops": ["Fai Chi Kei", "Portas do Cerco", "Taipa Bridge", "Cotai"], "freq": 10, "start": 6, "end": 23},
    {"id": "25", "name": "25", "stops": ["Barra", "Praia Grande", "Taipa Bridge", "Cotai Strip"], "freq": 8, "start": 6, "end": 24},
    {"id": "26", "name": "26", "stops": ["Fai Chi Kei", "NAPE", "Macau Tower", "Taipa"], "freq": 10, "start": 6, "end": 24},
    {"id": "26A", "name": "26A", "stops": ["Portas do Cerco", "NAPE", "Science Museum", "Taipa Village"], "freq": 12, "start": 6, "end": 23},
    {"id": "28A", "name": "28A", "stops": ["Barra", "Inner Harbour", "Horta e Costa", "Portas do Cerco"], "freq": 8, "start": 6, "end": 24},
    {"id": "30", "name": "30", "stops": ["Portas do Cerco", "Fai Chi Kei", "Taipa Bridge", "Cotai Strip"], "freq": 10, "start": 6, "end": 23},
    {"id": "33", "name": "33", "stops": ["Fai Chi Kei", "Areia Preta", "Taipa Bridge", "Cotai Strip"], "freq": 10, "start": 6, "end": 23},
    {"id": "34", "name": "34", "stops": ["Barra", "Macau Tower", "Taipa Bridge", "Airport"], "freq": 12, "start": 6, "end": 23},
    {"id": "50", "name": "50", "stops": ["Barra", "Praia Grande", "Sai Van Bridge", "Seac Pai Van"], "freq": 12, "start": 6, "end": 23},
    {"id": "AP1", "name": "AP1", "stops": ["Portas do Cerco", "Outer Harbour", "Airport", "Taipa Ferry Terminal"], "freq": 15, "start": 6, "end": 24},
    {"id": "MT1", "name": "MT1", "stops": ["Cotai Strip", "Galaxy", "Stadium", "Taipa Ferry Terminal"], "freq": 10, "start": 7, "end": 23},
    {"id": "MT2", "name": "MT2", "stops": ["Galaxy", "Venetian", "City of Dreams", "Lotus"], "freq": 10, "start": 7, "end": 23},
    {"id": "N1A", "name": "N1A", "stops": ["Portas do Cerco", "Red Market", "NAPE", "Macau Tower"], "freq": 20, "start": 0, "end": 6},
    {"id": "N2", "name": "N2", "stops": ["Portas do Cerco", "Horta e Costa", "Taipa Bridge", "Cotai Strip"], "freq": 20, "start": 0, "end": 6},
]

BUS_STOP_LOCATIONS = {
    "Barra": [113.5356, 22.1875],
    "Horta e Costa": [113.5475, 22.2010],
    "Flora Garden": [113.5500, 22.2035],
    "Portas do Cerco": [113.5541, 22.2140],
    "Praia Grande": [113.5402, 22.1920],
    "NAPE": [113.5510, 22.1880],
    "Outer Harbour Ferry": [113.5570, 22.1950],
    "Almeida Ribeiro": [113.5398, 22.1935],
    "Inner Harbour": [113.5355, 22.1960],
    "Guia Hill": [113.5508, 22.2005],
    "Fai Chi Kei": [113.5380, 22.2095],
    "Red Market": [113.5460, 22.2065],
    "Mong Ha": [113.5497, 22.2070],
    "Science Museum": [113.5545, 22.1850],
    "Taipa Village": [113.5570, 22.1510],
    "Jockey Club": [113.5525, 22.1536],
    "Stadium": [113.5568, 22.1530],
    "Cotai": [113.5600, 22.1420],
    "Taipa Bridge": [113.5450, 22.1750],
    "Hac Sa Beach": [113.5690, 22.1200],
    "Coloane Village": [113.5640, 22.1240],
    "Nam Van": [113.5410, 22.1890],
    "Cotai Strip": [113.5610, 22.1380],
    "Macau Tower": [113.5380, 22.1830],
    "Areia Preta": [113.5520, 22.2090],
    "Airport": [113.5764, 22.1496],
    "Seac Pai Van": [113.5510, 22.1268],
    "Taipa Ferry Terminal": [113.5780, 22.1560],
    "Galaxy": [113.5560, 22.1490],
    "Venetian": [113.5620, 22.1410],
    "City of Dreams": [113.5590, 22.1440],
    "Lotus": [113.5546, 22.1382],
    "Sai Van Bridge": [113.5410, 22.1800],
}


def build_route_geometry(stop_names: list[str], route_name: str = "") -> dict:
    """Build a GeoJSON LineString snapped to roads via OSRM."""
    waypoints = []
    for name in stop_names:
        if name in BUS_STOP_LOCATIONS:
            waypoints.append(BUS_STOP_LOCATIONS[name])
    if len(waypoints) < 2:
        return {"type": "Feature", "geometry": {"type": "LineString", "coordinates": []}, "properties": {}}

    road_coords = get_road_geometry(waypoints, profile="driving")
    if road_coords and len(road_coords) > len(waypoints):
        print(f"    Route {route_name}: {len(road_coords)} points from OSRM")
        return {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": road_coords},
            "properties": {},
        }

    print(f"    Route {route_name}: fallback to straight lines")
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": waypoints},
        "properties": {},
    }


def try_fetch_osm_bus_data() -> tuple[list, list]:
    """Try to get bus routes/stops from OSM. Returns (routes, stops) or ([], [])."""
    try:
        print("Querying Overpass API for Macau bus data...")
        resp = requests.post(OVERPASS_URL, data={"data": MACAU_BUS_OVERPASS}, timeout=60)
        resp.raise_for_status()
        data = resp.json()

        stops = []
        nodes = {}
        for elem in data.get("elements", []):
            if elem["type"] == "node":
                nodes[elem["id"]] = (elem.get("lon", 0), elem.get("lat", 0))
                tags = elem.get("tags", {})
                if tags.get("highway") == "bus_stop" or tags.get("public_transport") == "platform":
                    name = tags.get("name:en", tags.get("name", f"Stop_{elem['id']}"))
                    stops.append({
                        "id": str(elem["id"]),
                        "name": name,
                        "nameCn": tags.get("name:zh", name),
                        "coordinates": [elem["lon"], elem["lat"]],
                        "routeIds": [],
                    })

        print(f"  Found {len(stops)} bus stops from OSM")
        return [], stops
    except Exception as e:
        print(f"  OSM bus query failed: {e}")
        return [], []


def run():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    _, osm_stops = try_fetch_osm_bus_data()

    bus_routes = []
    print("Routing bus routes via OSRM...")
    for i, route in enumerate(MAJOR_BUS_ROUTES):
        color = ROUTE_COLORS[i % len(ROUTE_COLORS)]
        geometry = build_route_geometry(route["stops"], route["name"])
        time.sleep(0.5)
        bus_routes.append({
            "id": route["id"],
            "name": route["name"],
            "color": color,
            "stops": [s.replace(" ", "_") for s in route["stops"]],
            "geometry": geometry,
            "frequency": route["freq"],
            "serviceHoursStart": route["start"],
            "serviceHoursEnd": route["end"],
        })

    bus_stops = []
    used_ids = set()
    for name, coords in BUS_STOP_LOCATIONS.items():
        sid = name.replace(" ", "_")
        if sid in used_ids:
            continue
        used_ids.add(sid)
        route_ids = [r["id"] for r in MAJOR_BUS_ROUTES if name in r["stops"]]
        bus_stops.append({
            "id": sid,
            "name": name,
            "nameCn": name,
            "coordinates": coords,
            "routeIds": route_ids,
        })

    if osm_stops:
        existing_coords = set()
        for s in bus_stops:
            existing_coords.add((round(s["coordinates"][0], 4), round(s["coordinates"][1], 4)))
        for s in osm_stops:
            key = (round(s["coordinates"][0], 4), round(s["coordinates"][1], 4))
            if key not in existing_coords:
                bus_stops.append(s)
                existing_coords.add(key)

    routes_path = OUTPUT_DIR / "bus-routes.json"
    stops_path = OUTPUT_DIR / "bus-stops.json"
    with open(routes_path, "w", encoding="utf-8") as f:
        json.dump(bus_routes, f, ensure_ascii=False, indent=2)
    with open(stops_path, "w", encoding="utf-8") as f:
        json.dump(bus_stops, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(bus_routes)} bus routes to {routes_path}")
    print(f"Wrote {len(bus_stops)} bus stops to {stops_path}")


if __name__ == "__main__":
    run()
