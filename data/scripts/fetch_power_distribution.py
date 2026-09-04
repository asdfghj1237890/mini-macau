"""Build public/data/power-distribution.json: every drivable road inside the
Macau SAR, simplified and ORIENTED so it runs away from CEM's substations —
the canvas the power overlay draws its 11 kV / low-voltage distribution layer on.

The road canvas itself (Overpass fetch, boundary clip, junction-protected
simplification, the multi-source Dijkstra and the outward orientation) is
`road_network.py`, shared with `fetch_water_distribution.py`: the two overlays
draw the same streets and differ only in what seeds the flow field. Everything
about WHY the file exists and how the roads are cut is documented there.

What is power-specific is only this: the flow field is seeded at EVERY HV
substation in power-facilities.json (220 / 110 / 66 kV alike), because that is
where the grid actually steps down to the 11 kV feeders under the streets —
2,893 km of them, per CEM. The power station and the incineration plant are
NOT seeds: they push power INTO the transmission network rather than out into
the city, and seeding them would make Coloane's streets appear to feed
themselves. Unlike the water overlay there is no raw/treated split to make,
so the filter is simply "has a voltage".

Run manually when OSM changes (not scheduled, like fetch_power_facilities.py):
    cd data && uv run python scripts/fetch_power_distribution.py
Two Overpass calls (boundary + roads), cached for a day and shared with the
water overlay (osm_footprints.OVERPASS_CACHE_DIR). Reads
public/data/power-facilities.json, so run fetch_power_facilities.py first if
the substation list changed.
"""

import json
import sys
from pathlib import Path

from road_network import build_distribution

ROOT = Path(__file__).parent.parent.parent
OUTPUT_PATH = ROOT / "public" / "data" / "power-distribution.json"
FACILITIES_PATH = ROOT / "public" / "data" / "power-facilities.json"

FLOW_SOURCE_TYPES = ("sub220", "sub110", "sub66")


def load_sources() -> list[dict]:
    """Every HV substation, in the order power-facilities.json lists them
    (220 kV first, then 110, then 66 — so `flowSources` reads top-down)."""
    if not FACILITIES_PATH.exists():
        raise RuntimeError(
            f"{FACILITIES_PATH} is missing — run fetch_power_facilities.py first"
        )
    data = json.loads(FACILITIES_PATH.read_text(encoding="utf-8"))
    return [f for f in data["facilities"] if f["type"] in FLOW_SOURCE_TYPES]


def run() -> int:
    return build_distribution(
        OUTPUT_PATH,
        load_sources(),
        source_note=f"HV substations (types {list(FLOW_SOURCE_TYPES)})",
        describe=lambda f: f"{f['voltageKv']} kV",
    )


if __name__ == "__main__":
    sys.exit(run())
