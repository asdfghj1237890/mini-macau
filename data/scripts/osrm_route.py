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

# Ponte Flor de Lótus (蓮花大橋) — the only legal Macau bus crossing
# between Cotai and Hengqin Port. The public OSRM demo refuses to route
# over it (no profile recognises it as drivable; it falls back to a
# 6km detour up to Macau peninsula via Sai Van Bridge), so we splice
# these hand-built polylines in whenever a stop pair would otherwise
# either traverse Hengqin or fall back to a straight line across the
# Shizimen waterway.
#
# Two polylines because the bus uses different roads in each direction:
# returning from the port loops through several Hengqin Port internal
# roads before crossing the bridge, while the outbound trip enters the
# port from a different ramp. RETURN ordered Hengqin Port → Cotai,
# OUTBOUND ordered Cotai → Hengqin Port.
LOTUS_BRIDGE_RETURN_POLYLINE = [
    [113.54577, 22.13767],
    [113.54722, 22.13787],
    [113.54748, 22.14083],
    [113.54694, 22.14140],
    [113.54634, 22.14115],
    [113.54632, 22.14069],
    [113.54651, 22.14041],
    [113.54734, 22.14026],
    [113.55019, 22.14003],
    [113.55608, 22.13949],
    [113.55736, 22.13944],
    [113.55783, 22.13973],
    [113.55930, 22.13962],
    [113.56005, 22.13908],
    [113.56078, 22.13918],
    [113.56119, 22.13931],
]
# Outbound is the reverse of the return path until precise outbound
# waypoints are sourced. The Hengqin Port loop is approximate this way
# but visually still follows the bridge alignment correctly.
LOTUS_BRIDGE_OUTBOUND_POLYLINE = list(reversed(LOTUS_BRIDGE_RETURN_POLYLINE))
# Anchor used as a "via" hint when probing OSRM — picked from the bridge
# centreline crossing, which is the lat where the actual span sits.
LOTUS_BRIDGE_ANCHOR = [113.55313, 22.13976]


def lotus_bridge_segment(a: list[float], b: list[float]) -> list[list[float]]:
    """Return [a, ...bridge polyline..., b] oriented to match a→b direction.
    Used as a final fallback when OSRM cannot route a pair without entering
    Hengqin — gives a geometry that visibly crosses the bridge rather than
    a straight line over the waterway.
    """
    poly = LOTUS_BRIDGE_OUTBOUND_POLYLINE if a[0] > b[0] else LOTUS_BRIDGE_RETURN_POLYLINE
    return [a] + [list(p) for p in poly] + [b]


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
