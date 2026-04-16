"""
Extract Macau LRT track geometry and station data from OpenStreetMap.
Uses railway=light_rail ways directly (NOT road routing) since the LRT
runs on its own elevated/independent guideway.
"""

import json
import math
import requests
from pathlib import Path

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
OUTPUT_DIR = Path(__file__).parent.parent / "output"

MACAU_BBOX = "22.10,113.50,22.22,113.60"

OVERPASS_QUERY = f"""
[out:json][timeout:60];
(
  relation["route"="train"]({MACAU_BBOX});
  relation["route"="light_rail"]({MACAU_BBOX});
  relation["route"="railway"]({MACAU_BBOX});
  way["railway"="light_rail"]({MACAU_BBOX});
  way["railway"="rail"]["usage"="tourism"]({MACAU_BBOX});
  node["railway"="station"]({MACAU_BBOX});
  node["public_transport"="station"]({MACAU_BBOX});
  node["public_transport"="stop_position"]({MACAU_BBOX});
);
out body;
>;
out skel qt;
"""

LRT_LINES_META = {
    "taipa": {
        "id": "taipa",
        "name": "Taipa Line",
        "nameCn": "氹仔線",
        "color": "#84C44A",
        "stations_ordered": [
            "Barra", "Ocean", "Jockey Club", "Stadium", "Pai Kok",
            "Cotai West", "Lotus", "East Asian Games", "Cotai East",
            "MUST", "Airport", "Taipa Ferry Terminal"
        ],
    },
    "seac_pai_van": {
        "id": "seac_pai_van",
        "name": "Seac Pai Van Line",
        "nameCn": "石排灣線",
        "color": "#8A66C3",
        "stations_ordered": ["Union Hospital", "Seac Pai Van"],
    },
    "hengqin": {
        "id": "hengqin",
        "name": "Hengqin Line",
        "nameCn": "橫琴線",
        "color": "#BD283B",
        "stations_ordered": ["Lotus", "Hengqin"],
    },
}

STATION_DATA = {
    "Barra": {"nameCn": "媽閣", "namePt": "Barra", "coords": [113.5351, 22.1870]},
    "Ocean": {"nameCn": "海洋", "namePt": "Oceano", "coords": [113.5490, 22.1563]},
    "Jockey Club": {"nameCn": "馬會", "namePt": "Jockey Clube", "coords": [113.5525, 22.1536]},
    "Stadium": {"nameCn": "運動場", "namePt": "Estádio", "coords": [113.5568, 22.1530]},
    "Pai Kok": {"nameCn": "排角", "namePt": "Pai Kok", "coords": [113.5553, 22.1490]},
    "Cotai West": {"nameCn": "路氹西", "namePt": "Cotai Oeste", "coords": [113.5530, 22.1440]},
    "Lotus": {"nameCn": "蓮花", "namePt": "Lótus", "coords": [113.5546, 22.1382]},
    "East Asian Games": {"nameCn": "東亞運", "namePt": "Jogos da Ásia Oriental", "coords": [113.5643, 22.1370]},
    "Cotai East": {"nameCn": "路氹東", "namePt": "Cotai Leste", "coords": [113.5690, 22.1417]},
    "MUST": {"nameCn": "科大", "namePt": "UCTM", "coords": [113.5671, 22.1479]},
    "Airport": {"nameCn": "機場", "namePt": "Aeroporto", "coords": [113.5764, 22.1496]},
    "Taipa Ferry Terminal": {"nameCn": "氹仔碼頭", "namePt": "Terminal Marítimo da Taipa", "coords": [113.5780, 22.1560]},
    "Union Hospital": {"nameCn": "協和醫院", "namePt": "Hospital Union", "coords": [113.5540, 22.1340]},
    "Seac Pai Van": {"nameCn": "石排灣", "namePt": "Seac Pai Van", "coords": [113.5510, 22.1268]},
    "Hengqin": {"nameCn": "橫琴", "namePt": "Hengqin", "coords": [113.5440, 22.1300]},
}


def fetch_overpass():
    for url in OVERPASS_URLS:
        try:
            print(f"Querying {url} ...")
            resp = requests.post(url, data={"data": OVERPASS_QUERY}, timeout=45)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            print(f"  Failed: {e}")
    return None


def parse_osm(data: dict):
    """Parse all nodes, ways, and relations from the OSM response."""
    nodes = {}
    ways = {}
    relations = []

    for elem in data.get("elements", []):
        if elem["type"] == "node":
            nodes[elem["id"]] = {
                "lon": elem["lon"],
                "lat": elem["lat"],
                "tags": elem.get("tags", {}),
            }
        elif elem["type"] == "way":
            ways[elem["id"]] = {
                "node_ids": elem.get("nodes", []),
                "tags": elem.get("tags", {}),
            }
        elif elem["type"] == "relation":
            relations.append({
                "id": elem["id"],
                "tags": elem.get("tags", {}),
                "members": elem.get("members", []),
            })

    return nodes, ways, relations


def way_to_coords(way: dict, nodes: dict) -> list[tuple[float, float]]:
    """Convert a way's node list to (lon, lat) coordinates."""
    coords = []
    for nid in way["node_ids"]:
        if nid in nodes:
            n = nodes[nid]
            coords.append((n["lon"], n["lat"]))
    return coords


def merge_way_segments(
    segments: list[list[tuple[float, float]]],
    target_start: tuple[float, float] | None = None,
) -> list[tuple[float, float]]:
    """Merge multiple way segments into a single ordered linestring using
    endpoint proximity matching. If target_start is given, orient the
    result so it starts near that point."""
    if not segments:
        return []
    if len(segments) == 1:
        return list(segments[0])

    remaining = list(range(len(segments)))
    best_first = 0
    if target_start:
        best_d = float("inf")
        for i, seg in enumerate(segments):
            for pt in [seg[0], seg[-1]]:
                d = math.hypot(pt[0] - target_start[0], pt[1] - target_start[1])
                if d < best_d:
                    best_d = d
                    best_first = i

    remaining.remove(best_first)
    first_seg = segments[best_first]
    if target_start:
        d_start = math.hypot(first_seg[0][0] - target_start[0], first_seg[0][1] - target_start[1])
        d_end = math.hypot(first_seg[-1][0] - target_start[0], first_seg[-1][1] - target_start[1])
        if d_end < d_start:
            first_seg = list(reversed(first_seg))
    merged = list(first_seg)

    while remaining:
        tail = merged[-1]
        best_idx = -1
        best_rev = False
        best_dist = float("inf")

        for i in remaining:
            seg = segments[i]
            d_head = math.hypot(seg[0][0] - tail[0], seg[0][1] - tail[1])
            d_tail = math.hypot(seg[-1][0] - tail[0], seg[-1][1] - tail[1])
            if d_head < best_dist:
                best_dist = d_head
                best_idx = i
                best_rev = False
            if d_tail < best_dist:
                best_dist = d_tail
                best_idx = i
                best_rev = True

        if best_idx < 0 or best_dist > 0.01:
            break
        remaining.remove(best_idx)
        seg = segments[best_idx]
        if best_rev:
            seg = list(reversed(seg))
        if best_dist < 0.0001:
            seg = seg[1:]
        merged.extend(seg)

    return merged


def find_ways_near_stations(
    all_way_coords: dict[int, list[tuple[float, float]]],
    station_coords: list[list[float]],
    max_dist: float = 0.008,
) -> list[list[tuple[float, float]]]:
    """Find ways whose any point is within max_dist of any station."""
    station_set = [(c[0], c[1]) for c in station_coords]
    matched_segments = []

    for wid, coords in all_way_coords.items():
        for pt in coords:
            for sc in station_set:
                if math.hypot(pt[0] - sc[0], pt[1] - sc[1]) < max_dist:
                    matched_segments.append(coords)
                    break
            else:
                continue
            break

    return matched_segments


def extract_relation_ways(
    relations: list[dict],
    ways: dict,
    nodes: dict,
    station_names: list[str],
) -> list[list[tuple[float, float]]] | None:
    """Try to find an OSM relation matching these stations and extract
    its way members in order. Requires ALL stations to be near the
    relation's track geometry."""
    scoords = [
        (STATION_DATA[s]["coords"][0], STATION_DATA[s]["coords"][1])
        for s in station_names if s in STATION_DATA
    ]

    best_match = None
    best_hits = 0

    for rel in relations:
        way_members = [m for m in rel["members"] if m["type"] == "way"]
        if len(way_members) < 1:
            continue

        way_segments = []
        for wm in way_members:
            wid = wm["ref"]
            if wid in ways:
                coords = way_to_coords(ways[wid], nodes)
                if coords:
                    way_segments.append(coords)

        if not way_segments:
            continue

        all_pts = [pt for seg in way_segments for pt in seg]
        hits = 0
        for sc in scoords:
            for pt in all_pts:
                if math.hypot(pt[0] - sc[0], pt[1] - sc[1]) < 0.003:
                    hits += 1
                    break

        if hits == len(scoords) and hits > best_hits:
            best_hits = hits
            best_match = (rel, way_segments)

    if best_match:
        rel, way_segments = best_match
        tags = rel["tags"]
        rname = tags.get('name:en', tags.get('name', '?'))
        print(f"    Matched relation {rel['id']}: {rname!r} ({len(way_segments)} ways, {best_hits}/{len(scoords)} stations)")
        return way_segments

    return None


def build_line_geometry_from_stations(station_names: list[str]) -> dict:
    coords = []
    for name in station_names:
        if name in STATION_DATA:
            coords.append(STATION_DATA[name]["coords"])
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {},
    }


def snap_stations_to_osm(osm_data: dict | None) -> dict[str, list[float]]:
    if not osm_data:
        return {}
    osm_stations = {}
    for elem in osm_data.get("elements", []):
        if elem["type"] == "node" and "tags" in elem:
            tags = elem["tags"]
            name = tags.get("name:en", tags.get("name", ""))
            if name and ("station" in tags.get("railway", "") or "station" in tags.get("public_transport", "")):
                osm_stations[name] = [elem["lon"], elem["lat"]]
    return osm_stations


def run():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    osm_data = fetch_overpass()
    osm_stations = snap_stations_to_osm(osm_data)

    for name, sdata in STATION_DATA.items():
        for osm_name, coords in osm_stations.items():
            if name.lower() in osm_name.lower() or osm_name.lower() in name.lower():
                print(f"  Snapped '{name}' from OSM: {coords}")
                sdata["coords"] = coords
                break

    nodes, ways, relations = {}, {}, []
    all_way_coords: dict[int, list[tuple[float, float]]] = {}
    if osm_data:
        nodes, ways, relations = parse_osm(osm_data)
        for wid, w in ways.items():
            coords = way_to_coords(w, nodes)
            if coords:
                all_way_coords[wid] = coords
        print(f"Parsed {len(nodes)} nodes, {len(ways)} ways, {len(relations)} relations")
        for rel in relations:
            tags = rel["tags"]
            rname = tags.get("name:en", tags.get("name", "?"))
            route = tags.get("route", "?")
            nways = sum(1 for m in rel["members"] if m["type"] == "way")
            print(f"  Relation {rel['id']}: route={route}, ways={nways}, name={rname!r}")
        rail_ways = {wid: c for wid, c in all_way_coords.items()
                     if ways[wid]["tags"].get("railway") in ("light_rail", "rail")}
        print(f"  {len(rail_ways)} railway ways")
    else:
        rail_ways = {}

    lrt_lines = []
    for line_key, meta in LRT_LINES_META.items():
        station_names = meta["stations_ordered"]
        first_station_coord = STATION_DATA[station_names[0]]["coords"]
        target_start = (first_station_coord[0], first_station_coord[1])

        print(f"\n  Building {meta['name']} geometry...")

        # Strategy 1: Try to find a matching OSM relation
        rel_ways = extract_relation_ways(relations, ways, nodes, station_names)
        if rel_ways:
            merged = merge_way_segments(rel_ways, target_start)
            if len(merged) > len(station_names):
                print(f"    Used relation: {len(merged)} points")
                geometry = {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [list(c) for c in merged]},
                    "properties": {},
                }
                lrt_lines.append(_make_line(meta, geometry))
                continue

        # Strategy 2: Find railway ways near this line's stations
        if rail_ways:
            scoords = [STATION_DATA[s]["coords"] for s in station_names if s in STATION_DATA]
            matched = find_ways_near_stations(rail_ways, scoords, max_dist=0.006)
            if matched and len(matched) >= 1:
                merged = merge_way_segments(matched, target_start)
                if len(merged) > len(station_names):
                    print(f"    Used {len(matched)} nearby rail ways: {len(merged)} points")
                    geometry = {
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": [list(c) for c in merged]},
                        "properties": {},
                    }
                    lrt_lines.append(_make_line(meta, geometry))
                    continue

        # Strategy 3: Use ALL rail ways merged together (legacy fallback)
        if rail_ways:
            all_segments = list(rail_ways.values())
            merged = merge_way_segments(all_segments, target_start)
            if len(merged) > len(station_names) * 2:
                print(f"    Used all rail ways merged: {len(merged)} points (less accurate)")
                geometry = {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [list(c) for c in merged]},
                    "properties": {},
                }
                lrt_lines.append(_make_line(meta, geometry))
                continue

        # Strategy 4: straight lines between stations
        print(f"    Fallback: straight lines between {len(station_names)} stations")
        geometry = build_line_geometry_from_stations(station_names)
        lrt_lines.append(_make_line(meta, geometry))

    stations = []
    for name, sdata in STATION_DATA.items():
        sid = name.replace(" ", "_")
        line_ids = []
        for _lk, meta in LRT_LINES_META.items():
            if name in meta["stations_ordered"]:
                line_ids.append(meta["id"])
        stations.append({
            "id": sid,
            "name": name,
            "nameCn": sdata["nameCn"],
            "namePt": sdata["namePt"],
            "coordinates": sdata["coords"],
            "lineIds": line_ids,
        })

    lrt_path = OUTPUT_DIR / "lrt-lines.json"
    stations_path = OUTPUT_DIR / "stations.json"
    with open(lrt_path, "w", encoding="utf-8") as f:
        json.dump(lrt_lines, f, ensure_ascii=False, indent=2)
    with open(stations_path, "w", encoding="utf-8") as f:
        json.dump(stations, f, ensure_ascii=False, indent=2)

    print(f"\nWrote {len(lrt_lines)} LRT lines to {lrt_path}")
    print(f"Wrote {len(stations)} stations to {stations_path}")


def _make_line(meta: dict, geometry: dict) -> dict:
    return {
        "id": meta["id"],
        "name": meta["name"],
        "nameCn": meta["nameCn"],
        "color": meta["color"],
        "stations": [s.replace(" ", "_") for s in meta["stations_ordered"]],
        "geometry": geometry,
    }


if __name__ == "__main__":
    run()
