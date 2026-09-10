"""
Build public/data/parishes.json: Macau's seven civil parishes (堂區 /
freguesias) plus the Cotai reclamation zone, each as a MultiPolygon with
trilingual names and the census figures, so the map can tint and label the
areas the city is actually divided into.

Eight areas, not seven. 路氹填海區 (Zona do Aterro de Cotai) is reclaimed land
between Taipa and Coloane that was never assigned to a parish — the Cotai
casinos and the airport stand on it. The government's own maps and DSEC's
census tables show it as an eighth area alongside the seven parishes, so this
file does too, marked `kind: "reclamation"` (every other area is `"parish"`).
It is the only one, and `validate_output.py` enforces that pairing.

The parishes are ecclesiastical in origin and have no local government of their
own — Macau abolished the two municipal councils in 2001 — but they remain the
units DSEC publishes population by, and the units addresses are written in.

Geometry comes from OpenStreetMap, live on every run (Overpass, cached for a
day by `osm_footprints.overpass`). The figures do NOT: they are transcribed by
hand into `AREAS` below, each next to the URL it was read from, because they
are slow-moving reference numbers published as PDF/statistics tables rather
than a feed. A figure nobody publishes for an area is `None`, never a guess,
and `population` / `populationYear` are set or cleared together.

Two areas are worth understanding before trusting a number here:

  * **Land area vs the drawn polygon.** `areaKm2` is the government's published
    *land* area. The OSM administrative boundary is bigger — it follows the
    administrative line out over water and over reclamation that is not counted
    as land yet. `node scripts/inspect.mjs parishes` prints both side by side;
    they are not supposed to match.
  * **嘉模堂區 is multi-part.** Besides Taipa it carries the University of
    Macau's Hengqin campus and the tunnel corridor reaching it — land leased
    from Guangdong but under Macau jurisdiction — as separate polygons. Coloane
    and the peninsula parishes are single polygons.

Sources
  * OpenStreetMap, `relation["boundary"="administrative"]["admin_level"="6"]`
    inside relation 1867188 (Macau). The eight relation ids are pinned in
    `AREAS` rather than discovered by query: an admin boundary appearing or
    disappearing is a thing a human should look at, not something this script
    should quietly absorb.
    OSM's `name` combines the two official languages ("花地瑪堂區 Nossa Senhora
    de Fátima"); `name:zh-Hant` / `name:zh` / `name:pt` are preferred where
    they exist, and `split_bilingual_name` is the fallback. Prefer `zh-Hant`
    specifically: r5758865 tags `name:zh` in *simplified* characters (嘉模堂区)
    while `name:zh-Hant` is the Traditional 嘉模堂區 this project writes.
    Both are cross-checked against `AREAS` and a mismatch fails the run.
  * English names: OSM has almost none (only 花王堂區 and a "Cotai Landfill
    Zone" for the reclamation), so `en` is the government's own English form,
    hand-written in `AREAS` with the page it came from. See EN_SOURCE.
  * Population and land area: see the URL next to each figure in `AREAS`.
    zh.wikipedia's 澳門堂區 table was used only to cross-check, never as a
    source.

Run it
    cd data && uv run python scripts/fetch_parishes.py
    cd data && uv run python scripts/validate_output.py parishes
    node scripts/inspect.mjs parishes          # from the repo root

Manual, on purpose — there is no workflow. Parish boundaries change when land
is reclaimed, which is a once-in-years event, and the census figures change
once a decade. Re-run it when a boundary moves or a new census lands.

Network: Overpass only (responses cached ~24 h in the OS temp dir, so a
re-run costs nothing). No API key.

Adding or changing an area
  1. Add a row to `AREAS` with its OSM relation id, the three names, `island`,
     `kind`, and each figure beside the URL it came from (`None` if nobody
     publishes it).
  2. Add the slug to `PARISH_SLUGS` in `data/scripts/validate_output.py` and to
     `parishSlug` in `src/dataSchemas.ts` and `ParishSlug` in `src/types.ts` —
     the eight slugs are a closed set in all three.
  3. Re-run the three commands above.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from osm_footprints import overpass, polygon_of_element
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.polygon import orient

OUTPUT_PATH = Path(__file__).resolve().parents[2] / "public" / "data" / "parishes.json"

OSM_SOURCE = "https://www.openstreetmap.org/relation/1867188"
OSM_RELATION_URL = "https://www.openstreetmap.org/relation/{}"

# Coordinates are written at 6 decimals (~0.11 m at this latitude) — far finer
# than an administrative line is surveyed, and it keeps the file readable.
COORD_PRECISION = 6
# Boundaries are kept faithful: only a ring longer than this is simplified, and
# only enough to get under it. Today the longest is 聖方濟各堂區 at 751 points,
# so nothing is simplified — the guard exists for a future re-survey.
MAX_RING_POINTS = 2000
SIMPLIFY_START_DEG = 1e-6  # ~0.11 m; doubled until the ring fits

# Macau's land bbox, a little generous. Every vertex must fall inside it: an
# administrative boundary that reaches Zhuhai or the open sea means the wrong
# relation was fetched, and `validate_output.py` checks the same thing.
LNG_MIN, LNG_MAX = 113.50, 113.62
LAT_MIN, LAT_MAX = 22.09, 22.23


class UpstreamError(RuntimeError):
    """OSM no longer matches what this script was written against."""


# ---------------------------------------------------------------------------
# The hand table: ids, names and every figure with the page it was read from.
# ---------------------------------------------------------------------------
# English parish names as the government writes them. DSEC's English census
# tables and the Macao Yearbook use these forms; OSM has almost none of them.
# English edition of the 2021 census tables (parish column headers).
EN_SOURCE = "https://www.dsec.gov.mo/getAttachment/289476bb-b6f1-4aa9-b1dd-a679bf2432cc/E_CEN_PUB_2021_Y_1.aspx"

# 2021 population census (人口普查 / Censos 2021), reference moment 2021-08-09.
# 2021人口普查詳細結果 統計表一, Table 1 按性別、歲組及堂區統計的總人口 (總人口, row
# 總數 MF). The report PDF (§1.10, 圖十七 note 2) is where 「路環區包括路氹填海區」
# is stated — the reason Cotai has no population of its own below.
CENSUS_2021 = "https://www.dsec.gov.mo/getAttachment/174c4ad4-0192-483c-adf1-9aa11b6ce37b/C_CEN_PUB_2021_Y_1.aspx"
CENSUS_2021_REPORT = "https://www.dsec.gov.mo/getAttachment/b9cf8539-4731-48a9-8319-116d761ea03a/C_CEN_PUB_2021_Y.aspx"
# Land area by parish.
# 統計年鑑2021 統計表一, table 1.2 土地面積 / Área de solos / Land area, by 堂區 —
# the census year's figures, so population and area describe the same moment
# (the 2025 yearbook moves 花地瑪 to 3.3 km² with new reclamation). Cotai has
# its own row here even though the census folds its people into Coloane.
LAND_AREA = "https://www.dsec.gov.mo/getAttachment/e1e9009b-42af-47ce-8fed-0fc9b6487ce6/CPE_AE_PUB_2021_Y_01.aspx"

# North to south: the five peninsula parishes, then Taipa, the Cotai
# reclamation and Coloane. `zh` / `pt` are what OSM tagged when this was
# written — they are the tripwire in `build_area`, not the values written out.
AREAS: tuple[dict, ...] = (
    {
        "slug": "fatima", "relation": 9506156,
        "zh": "花地瑪堂區", "pt": "Nossa Senhora de Fátima",
        "en": "Parish of Our Lady of Fátima", "enSource": EN_SOURCE,
        "island": "macau", "kind": "parish",
        "population": 256381, "populationYear": 2021, "populationSource": CENSUS_2021,
        "areaKm2": 3.2, "areaSource": LAND_AREA,
    },
    {
        # The government also writes this one 聖安多尼堂區 (after Santo António);
        # 花王堂區 is the older, commoner Chinese name and the one OSM carries.
        "slug": "santo-antonio", "relation": 9506168,
        "zh": "花王堂區", "pt": "Santo António",
        "en": "Parish of St. Anthony", "enSource": EN_SOURCE,
        "island": "macau", "kind": "parish",
        "population": 133920, "populationYear": 2021, "populationSource": CENSUS_2021,
        "areaKm2": 1.1, "areaSource": LAND_AREA,
    },
    {
        "slug": "sao-lazaro", "relation": 12107628,
        "zh": "望德堂區", "pt": "São Lázaro",
        "en": "Parish of St. Lazarus", "enSource": EN_SOURCE,
        "island": "macau", "kind": "parish",
        "population": 33442, "populationYear": 2021, "populationSource": CENSUS_2021,
        "areaKm2": 0.6, "areaSource": LAND_AREA,
    },
    {
        "slug": "se", "relation": 12107627,
        "zh": "大堂區", "pt": "Sé",
        "en": "Cathedral Parish (Sé)", "enSource": EN_SOURCE,
        "island": "macau", "kind": "parish",
        "population": 55275, "populationYear": 2021, "populationSource": CENSUS_2021,
        "areaKm2": 3.4, "areaSource": LAND_AREA,
    },
    {
        "slug": "sao-lourenco", "relation": 12107629,
        "zh": "風順堂區", "pt": "São Lourenço",
        "en": "Parish of St. Lawrence", "enSource": EN_SOURCE,
        "island": "macau", "kind": "parish",
        "population": 53840, "populationYear": 2021, "populationSource": CENSUS_2021,
        "areaKm2": 1.0, "areaSource": LAND_AREA,
    },
    {
        # Taipa, plus the University of Macau's Hengqin campus and the tunnel
        # corridor to it — see the module docstring.
        "slug": "carmo", "relation": 5758865,
        "zh": "嘉模堂區", "pt": "Nossa Senhora do Carmo",
        "en": "Parish of Our Lady of Carmel", "enSource": EN_SOURCE,
        "island": "taipa", "kind": "parish",
        "population": 112051, "populationYear": 2021, "populationSource": CENSUS_2021,
        "areaKm2": 7.9, "areaSource": LAND_AREA,
    },
    {
        "slug": "cotai", "relation": 5758867,
        "zh": "路氹填海區", "pt": "Zona do Aterro de Cotai",
        "en": "Cotai Reclamation Zone", "enSource": EN_SOURCE,
        "island": "cotai", "kind": "reclamation",
        "population": None, "populationYear": None, "populationSource": CENSUS_2021,
        "areaKm2": 6.1, "areaSource": LAND_AREA,
        "note": {
            "zh": "2021年普查未單獨公佈路氹填海區人口，已併入路環（聖方濟各堂區）。",
            "pt": "Os Censos 2021 não publicam a população de Cotai em separado; está incluída em Coloane (São Francisco Xavier).",
            "en": "The 2021 census publishes no separate count for Cotai; its residents are included in Coloane (São Francisco Xavier).",
        },
    },
    {
        "slug": "sao-francisco", "relation": 5758866,
        "zh": "聖方濟各堂區", "pt": "São Francisco Xavier",
        "en": "Parish of St. Francis Xavier", "enSource": EN_SOURCE,
        "island": "coloane", "kind": "parish",
        "population": 36384, "populationYear": 2021, "populationSource": CENSUS_2021,
        "areaKm2": 7.6, "areaSource": LAND_AREA,
        # DSEC folds the Cotai reclamation into the Coloane count (census report
        # §1.10 note 2), while the land-area table lists Cotai's 6.1 km² on its own
        # row — so residents per km² is 36,384 over 7.6 + 6.1, not over 7.6.
        "densityKm2Denominator": 7.6 + 6.1, "densitySource": CENSUS_2021_REPORT,
        "note": {
            "zh": "人口為2021年普查數字，含路氹填海區；密度以路環與路氹填海區合計13.7平方公里計算。",
            "pt": "População dos Censos 2021, incluindo a Zona do Aterro de Cotai; densidade calculada sobre 13,7 km² (Coloane + Cotai).",
            "en": "Population is the 2021 census count including the Cotai reclamation zone; density uses the combined 13.7 km².",
        },
    },
)


# ---------------------------------------------------------------------------
# names
# ---------------------------------------------------------------------------
CJK = re.compile(r"[㐀-䶿一-鿿]")


def split_bilingual_name(name: str) -> tuple[str, str]:
    """"花地瑪堂區 Nossa Senhora de Fátima" -> ("花地瑪堂區", "Nossa Senhora de Fátima").

    Fallback only. Every one of the eight relations currently carries explicit
    `name:zh*` and `name:pt` tags; this exists so a relation that loses one
    still yields a usable pair instead of a mangled combined string.
    """
    cut = len(name)
    for i, ch in enumerate(name):
        if not CJK.match(ch) and ch not in "（）()·-— ":
            cut = i
            break
    return name[:cut].strip(), name[cut:].strip()


def osm_names(tags: dict) -> tuple[str, str]:
    """(zh, pt) for one boundary relation, Traditional Chinese preferred."""
    combined = tags.get("name", "")
    zh_fallback, pt_fallback = split_bilingual_name(combined) if combined else ("", "")
    zh = tags.get("name:zh-Hant") or tags.get("name:zh") or zh_fallback
    pt = tags.get("name:pt") or pt_fallback
    return zh.strip(), pt.strip()


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------
def round_ring(ring: list[tuple[float, float]]) -> list[list[float]]:
    """Round to COORD_PRECISION, drop points the rounding made duplicates, and
    keep the ring closed. Fails if that leaves too few points to be a ring."""
    out: list[list[float]] = []
    for lng, lat in ring:
        pt = [round(lng, COORD_PRECISION), round(lat, COORD_PRECISION)]
        if not out or out[-1] != pt:
            out.append(pt)
    if out[0] != out[-1]:
        out.append(list(out[0]))
    if len(out) < 4:
        raise UpstreamError(f"ring collapsed to {len(out)} points after rounding")
    return out


def simplify_if_huge(poly: Polygon, label: str) -> Polygon:
    """Only a ring past MAX_RING_POINTS is touched, and only until it fits."""
    if len(poly.exterior.coords) <= MAX_RING_POINTS:
        return poly
    tol = SIMPLIFY_START_DEG
    simplified = poly
    while len(simplified.exterior.coords) > MAX_RING_POINTS and tol < 1e-3:
        simplified = poly.simplify(tol, preserve_topology=True)
        tol *= 2
    print(
        f"    {label}: simplified {len(poly.exterior.coords)} -> "
        f"{len(simplified.exterior.coords)} points (tolerance {tol / 2:.1e} deg)"
    )
    return simplified


def multipolygon_coordinates(geom: Polygon | MultiPolygon, label: str) -> list[list[list[list[float]]]]:
    """shapely area -> GeoJSON MultiPolygon coordinates [polygon][ring][lng, lat].

    Rings are oriented the RFC 7946 way (exterior counter-clockwise, holes
    clockwise) and every vertex is checked to be inside Macau.
    """
    parts = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    parts = [p for p in parts if not p.is_empty and p.area > 0]
    if not parts:
        raise UpstreamError(f"{label}: polygon is empty")
    parts.sort(key=lambda p: -p.area)

    coordinates: list[list[list[list[float]]]] = []
    for i, part in enumerate(parts):
        part = orient(simplify_if_huge(part, f"{label} part {i}"), sign=1.0)
        rings = [round_ring(list(part.exterior.coords))]
        rings += [round_ring(list(hole.coords)) for hole in part.interiors]
        for j, ring in enumerate(rings):
            for lng, lat in ring:
                if not (LNG_MIN <= lng <= LNG_MAX and LAT_MIN <= lat <= LAT_MAX):
                    raise UpstreamError(f"{label}: ring {i}.{j} has a vertex outside Macau: {lng}, {lat}")
        coordinates.append(rings)
    return coordinates


def label_anchor(geom: Polygon | MultiPolygon) -> list[float]:
    """A point guaranteed to be inside the biggest piece of the area.

    `representative_point` — not the centroid: 大堂區 and 嘉模堂區 are concave
    enough that their centroids fall outside them, which would put the label
    in the sea.
    """
    parts = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    biggest = max(parts, key=lambda p: p.area)
    pt = biggest.representative_point()
    return [round(pt.x, COORD_PRECISION), round(pt.y, COORD_PRECISION)]


# ---------------------------------------------------------------------------
def fetch_relations(ids: list[int]) -> dict[int, dict]:
    query = (
        "[out:json][timeout:180];\n(\n"
        + "\n".join(f"  relation({i});" for i in ids)
        + "\n);\nout geom;"
    )
    elements = overpass(query)
    found = {el["id"]: el for el in elements if el.get("type") == "relation"}
    missing = [i for i in ids if i not in found]
    if missing:
        raise UpstreamError(f"Overpass returned no relation for {missing}")
    return found


def build_area(spec: dict, el: dict) -> dict:
    slug = spec["slug"]
    tags = el.get("tags", {})
    label = f"{slug} (r{el['id']})"

    if tags.get("boundary") != "administrative" or tags.get("admin_level") != "6":
        raise UpstreamError(
            f"{label}: expected boundary=administrative admin_level=6, got "
            f"boundary={tags.get('boundary')!r} admin_level={tags.get('admin_level')!r}"
        )

    zh, pt = osm_names(tags)
    # Tripwire, the same shape as the plant-name check in macao_water.py: OSM is
    # the source of these two names, `AREAS` records what it said when this was
    # written. A rename is a human decision, not something to absorb silently.
    for lang, got, want in (("zh", zh, spec["zh"]), ("pt", pt, spec["pt"])):
        if got != want:
            raise UpstreamError(
                f"{label}: OSM name:{lang} is {got!r}, this script was written against "
                f"{want!r}. Check the rename, then update AREAS."
            )

    geom = polygon_of_element(el)
    if geom is None or geom.is_empty:
        raise UpstreamError(f"{label}: no polygon could be built from the relation's outer ways")
    if not geom.is_valid:
        geom = geom.buffer(0)

    sources = [OSM_RELATION_URL.format(el["id"]), spec["enSource"]]
    if spec["population"] is not None:
        sources.append(spec["populationSource"])
    if spec["areaKm2"] is not None:
        sources.append(spec["areaSource"])
    if spec.get("densitySource"):
        sources.append(spec["densitySource"])

    # Residents per km²: population over the land the count actually covers.
    # `densityKm2Denominator` overrides the area for the one case where the
    # two DSEC tables disagree on what "Coloane" is; null when either is missing.
    density = None
    if spec["population"] is not None:
        denominator = spec.get("densityKm2Denominator", spec["areaKm2"])
        if denominator:
            density = round(spec["population"] / denominator, 1)

    return {
        "id": f"osm:r{el['id']}",
        "slug": slug,
        "name": {"zh": zh, "pt": pt, "en": spec["en"]},
        "kind": spec["kind"],
        "island": spec["island"],
        "areaKm2": spec["areaKm2"],
        "population": spec["population"],
        "populationYear": spec["populationYear"] if spec["population"] is not None else None,
        "densityPerKm2": density,
        "note": spec.get("note"),
        "coordinates": label_anchor(geom),
        "geometry": multipolygon_coordinates(geom, label),
        "osm": [f"r{el['id']}"],
        "sources": list(dict.fromkeys(sources)),
    }


def run() -> int:
    print(f"Fetching {len(AREAS)} boundary relations from OSM...")
    elements = fetch_relations([a["relation"] for a in AREAS])

    areas = []
    for spec in AREAS:
        area = build_area(spec, elements[spec["relation"]])
        polys = len(area["geometry"])
        pts = sum(len(r) for poly in area["geometry"] for r in poly)
        pop = "—" if area["population"] is None else f"{area['population']:,} ({area['populationYear']})"
        km2 = "—" if area["areaKm2"] is None else f"{area['areaKm2']:.2f} km2"
        print(
            f"  {area['slug']:<14} {area['name']['zh']:<7} {area['name']['en']:<34} "
            f"{km2:>10}  pop {pop:>17}  {polys} poly / {pts} pts"
        )
        areas.append(area)

    output = {
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sources": {
            "osm": OSM_SOURCE,
            "dsecCensus2021": CENSUS_2021,
            "dsecLandArea": LAND_AREA,
            "dsecEnglishNames": EN_SOURCE,
        },
        "parishes": areas,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    no_pop = [a["slug"] for a in areas if a["population"] is None]
    no_area = [a["slug"] for a in areas if a["areaKm2"] is None]
    total_pop = sum(a["population"] or 0 for a in areas)
    print(f"\nDone. {len(areas)} areas, {sum(len(a['geometry']) for a in areas)} polygons, "
          f"{sum(len(r) for a in areas for poly in a['geometry'] for r in poly)} points")
    print(f"Population summed over the areas with a figure: {total_pop:,}")
    print(f"Areas with no published population: {no_pop or 'none'}")
    print(f"Areas with no published land area: {no_area or 'none'}")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run())
    except UpstreamError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
