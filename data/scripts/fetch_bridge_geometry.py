"""
Fetch geometry of the Macau-Taipa Bridge (Ponte Governador Nobre de Carvalho /
嘉樂庇總督大橋) from OpenStreetMap via Overpass API, and save as GeoJSON-style
LineString with Macau-side and Taipa-side endpoints in
data/bus_reference/bridges.json.

Public OSRM cannot route over this bridge because OSM tags it as
bus/taxi-only (motor_vehicle=no). We use the resulting polyline in
patch_bus_bridges.py to manually re-stitch bus routes that should use it.

Run once. Output is committed to git so re-fetching is rarely needed.
"""

import json
from pathlib import Path

import requests

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
OUTPUT_PATH = Path(__file__).parent.parent / "bus_reference" / "bridges.json"


QUERY = """
[out:json][timeout:60];
(
  way(22.14,113.53,22.21,113.57)["bridge"="yes"]["name"~"Carvalho"];
  way(22.14,113.53,22.21,113.57)["bridge"="yes"]["name:zh"~"嘉樂庇"];
  way(22.14,113.53,22.21,113.57)["bridge"="yes"]["name"~"嘉樂庇"];
);
(._;>;);
out body;
"""


def fetch_bridge() -> dict:
    """POST Overpass query to mirrors until one succeeds."""
    last_err: Exception | None = None
    for url in OVERPASS_MIRRORS:
        try:
            print(f"  Trying {url}")
            resp = requests.post(url, data={"data": QUERY}, timeout=90)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            print(f"    failed: {e}")
            last_err = e
    raise RuntimeError(f"All Overpass mirrors failed: {last_err}")


def stitch_ways(elements: list[dict]) -> list[list[float]]:
    """Combine all matching ways into a single ordered polyline.

    The Macau-Taipa Bridge is mapped as several parallel/overlapping ways
    (carriageways per direction). Latitude is monotonic along the bridge,
    so we collect every node and sort by latitude descending (Macau north
    -> Taipa south), de-duplicating near-coincident neighbours.
    """
    nodes = {}
    way_node_ids: set[int] = set()
    for el in elements:
        if el.get("type") == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])
        elif el.get("type") == "way":
            for nid in el.get("nodes", []):
                way_node_ids.add(nid)

    pts = [nodes[nid] for nid in way_node_ids if nid in nodes]
    if not pts:
        return []

    pts.sort(key=lambda p: -p[1])

    DEDUP_M = 1.5
    METERS_PER_DEG_LAT = 111320.0
    deduped: list[tuple[float, float]] = []
    for p in pts:
        if not deduped:
            deduped.append(p)
            continue
        last = deduped[-1]
        d_lat_m = (p[1] - last[1]) * METERS_PER_DEG_LAT
        cos_lat = max(0.1, abs(__import__("math").cos(__import__("math").radians(p[1]))))
        d_lng_m = (p[0] - last[0]) * METERS_PER_DEG_LAT * cos_lat
        if (d_lat_m * d_lat_m + d_lng_m * d_lng_m) ** 0.5 >= DEDUP_M:
            deduped.append(p)

    return [[lon, lat] for lon, lat in deduped]


def run():
    print(f"Querying Overpass for Macau-Taipa Bridge ...")
    data = fetch_bridge()
    elements = data.get("elements", [])
    print(f"  Got {len(elements)} elements")

    coords = stitch_ways(elements)
    if not coords:
        raise SystemExit("Failed to extract bridge geometry from Overpass response")

    # Ensure orientation is Macau-side -> Taipa-side (north -> south by lat)
    if coords[0][1] < coords[-1][1]:
        coords = list(reversed(coords))

    macau_end = coords[0]
    taipa_end = coords[-1]

    out = {
        "macau_taipa_bridge": {
            "name_zh": "嘉樂庇總督大橋",
            "name_pt": "Ponte Governador Nobre de Carvalho",
            "name_en": "Macau-Taipa Bridge",
            "coordinates": coords,
            "macau_end": macau_end,
            "taipa_end": taipa_end,
        }
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Saved {len(coords)} points -> {OUTPUT_PATH}")
    print(f"  Macau end: {macau_end}")
    print(f"  Taipa end: {taipa_end}")


if __name__ == "__main__":
    run()
