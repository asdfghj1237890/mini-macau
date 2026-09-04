"""Build public/data/water-distribution.json: every drivable road inside the
Macau SAR, simplified and ORIENTED so it runs away from the treated-water
sources — the canvas the water overlay draws its distribution network on.

The road canvas itself (Overpass fetch, boundary clip, junction-protected
simplification, the multi-source Dijkstra and the outward orientation) is
`road_network.py`, shared with `fetch_power_distribution.py`: the two overlays
draw the same streets and differ only in what seeds the flow field. Everything
about WHY the file exists and how the roads are cut is documented there.

What is water-specific is only this: the flow field is seeded at the
TREATED-water facilities in water-facilities.json (plants, elevated tanks and
treated-water pumping stations). The raw-water side — reservoirs and
`raw_pumping` — is deliberately excluded, because raw water flows INTO the
plants; seeding it would make half the city appear to drain towards 大水塘.
The operator filter drops 黑沙水庫 (DSAMA) along with the rest of the raw side.

Run manually when OSM changes (not scheduled, like fetch_water_facilities.py):
    cd data && uv run python scripts/fetch_water_distribution.py
Two Overpass calls (boundary + roads), cached for a day
(osm_footprints.OVERPASS_CACHE_DIR). Reads public/data/water-facilities.json,
so run fetch_water_facilities.py first if the facility list changed.
"""

import json
import sys
from pathlib import Path

from road_network import build_distribution

ROOT = Path(__file__).parent.parent.parent
OUTPUT_PATH = ROOT / "public" / "data" / "water-distribution.json"
FACILITIES_PATH = ROOT / "public" / "data" / "water-facilities.json"

FLOW_SOURCE_OPERATOR = "macao_water"
FLOW_SOURCE_TYPES = {"plant", "tank", "pumping"}


def load_sources() -> list[dict]:
    """Treated-water facilities, from the sibling dataset, in Macao Water's
    own numbering order (so `flowSources` reads like their list)."""
    if not FACILITIES_PATH.exists():
        raise RuntimeError(
            f"{FACILITIES_PATH} is missing — run fetch_water_facilities.py first"
        )
    data = json.loads(FACILITIES_PATH.read_text(encoding="utf-8"))
    facilities = [
        f for f in data["facilities"]
        if f.get("operator") == FLOW_SOURCE_OPERATOR and f["type"] in FLOW_SOURCE_TYPES
    ]
    return sorted(facilities, key=lambda x: x["no"])


def run() -> int:
    return build_distribution(
        OUTPUT_PATH,
        load_sources(),
        source_note=(f"treated-water facilities (operator {FLOW_SOURCE_OPERATOR}, "
                     f"types {sorted(FLOW_SOURCE_TYPES)})"),
        describe=lambda f: f["type"],
    )


if __name__ == "__main__":
    sys.exit(run())
