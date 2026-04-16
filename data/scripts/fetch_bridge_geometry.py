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

# Hand-picked approach coordinates on ordinary public roads just outside
# the bridge's restricted zone. OSRM can route to these; it cannot route
# to the bridge endpoints themselves (OSM tags bus/taxi only). These are
# used as OSRM connection targets so route geometry ties into real roads
# rather than snapping to an arbitrary nearby street.
MACAU_APPROACH = [113.5467, 22.1925]
TAIPA_APPROACH = [113.5510, 22.1625]


QUERY = """
[out:json][timeout:60];
(
  way(22.14,113.53,22.21,113.57)["bridge"="yes"]["name"~"Carvalho"];
  way(22.14,113.53,22.21,113.57)["bridge"="yes"]["name:zh"~"嘉樂庇"];
  way(22.14,113.53,22.21,113.57)["bridge"="yes"]["name"~"嘉樂庇"];
  way(22.186,113.541,22.194,113.549)["bridge"="yes"];
  way(22.159,113.544,22.167,113.555)["bridge"="yes"];
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
    """Combine all ways connected to the named main bridge into a single
    ordered polyline.

    The Macau-Taipa Bridge is mapped as several parallel/overlapping ways
    plus short on-/off-ramp ways. Other grade-separated overpasses nearby
    (e.g. Ferreira do Amaral roundabout) share the bbox but are NOT
    connected. We do a connected-component filter: start from ways whose
    name matches the bridge, then iteratively add any way sharing a node
    with a kept way. Latitude is monotonic along the bridge+ramps, so we
    then sort by latitude descending and dedup near-coincident nodes.
    """
    nodes = {}
    ways: list[dict] = []
    for el in elements:
        if el.get("type") == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])
        elif el.get("type") == "way":
            ways.append(el)

    if not ways:
        return []

    def is_seed(w: dict) -> bool:
        tags = w.get("tags", {})
        name = tags.get("name", "") + " " + tags.get("name:zh", "")
        return "Carvalho" in name or "嘉樂庇" in name

    kept_ids: set[int] = {w["id"] for w in ways if is_seed(w)}
    if not kept_ids:
        return []

    kept_nodes: set[int] = set()
    for w in ways:
        if w["id"] in kept_ids:
            kept_nodes.update(w["nodes"])

    changed = True
    while changed:
        changed = False
        for w in ways:
            if w["id"] in kept_ids:
                continue
            w_nodes = set(w["nodes"])
            if w_nodes & kept_nodes:
                kept_ids.add(w["id"])
                kept_nodes.update(w_nodes)
                changed = True

    pts = [nodes[nid] for nid in kept_nodes if nid in nodes]
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
            "macau_approach": MACAU_APPROACH,
            "taipa_approach": TAIPA_APPROACH,
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
