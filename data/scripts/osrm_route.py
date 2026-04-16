"""
OSRM routing utility to snap waypoints to actual road/rail geometry.
Uses the public OSRM demo server to get driving routes between waypoints.
"""

import time
import requests

OSRM_BASE = "https://router.project-osrm.org"


def get_road_geometry(
    waypoints: list[list[float]],
    profile: str = "driving",
    max_retries: int = 3,
) -> list[list[float]] | None:
    """
    Given ordered waypoints [[lon, lat], ...], return a dense polyline
    snapped to roads via OSRM. Returns [[lon, lat], ...] or None on failure.
    """
    if len(waypoints) < 2:
        return None

    coords_str = ";".join(f"{c[0]},{c[1]}" for c in waypoints)
    url = f"{OSRM_BASE}/route/v1/{profile}/{coords_str}"
    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
    }

    for attempt in range(max_retries):
        try:
            resp = requests.get(url, params=params, timeout=15)
            if resp.status_code == 429:
                wait = 2 ** (attempt + 1)
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") == "Ok" and data.get("routes"):
                coords = data["routes"][0]["geometry"]["coordinates"]
                return coords
            print(f"    OSRM returned: {data.get('code', 'unknown')}")
            return None
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(1)
                continue
            print(f"    OSRM request failed: {e}")
            return None

    return None
