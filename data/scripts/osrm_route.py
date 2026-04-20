"""
OSRM routing utility to snap waypoints to actual road/rail geometry.
Uses the public OSRM demo server to get driving routes between waypoints.
"""

import time
import requests

OSRM_BASE = "https://router.project-osrm.org"

# Hengqin island exclusion zone. OSRM's driving profile happily routes
# through Hengqin (mainland China, 橫琴) when it finds a shorter path,
# but Macau buses cannot cross the border — the path is physically real
# but illegal for the bus. Any OSRM response containing a coord inside
# this bbox is treated as invalid.
#
# The box is drawn so it catches the Hengqin land mass (west of the
# Shizimen Waterway) without touching legitimate Macau areas:
#   - Sai Van Bridge (lng ~113.53, lat 22.16-22.19): lat > 22.17 excludes it
#   - Inner Harbour / 內港 (lng 113.53, lat >22.18): lat > 22.17 excludes it
#   - Macau-Taipa Bridge (lng 113.545-113.555): lng > 113.535 excludes it
#   - All 102/21A/25B Taipa stops (lng > 113.54): excluded
HENGQIN_LNG_MIN = 113.460
HENGQIN_LNG_MAX = 113.535
HENGQIN_LAT_MIN = 22.130
HENGQIN_LAT_MAX = 22.170


def is_in_hengqin(coord: list[float]) -> bool:
    lng, lat = coord[0], coord[1]
    return (
        HENGQIN_LNG_MIN <= lng <= HENGQIN_LNG_MAX
        and HENGQIN_LAT_MIN <= lat <= HENGQIN_LAT_MAX
    )


def path_enters_hengqin(coords: list[list[float]]) -> bool:
    for c in coords:
        if is_in_hengqin(c):
            return True
    return False


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
