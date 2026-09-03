"""Validate generated JSON before it ships to the frontend.

This is the hard gate the browser-side zod schemas (`src/dataSchemas.ts`)
mirror as a tripwire: the GitHub Actions data workflows run this on the file
they just regenerated and abort the commit if it fails, so a broken upstream
scrape or a bad hand-edit can never auto-deploy garbage to production.

Pure stdlib — no third-party deps — so it runs anywhere `python` does.

Usage:
    uv run python scripts/validate_output.py flights
    uv run python scripts/validate_output.py flights-timetable ferries
    uv run python scripts/validate_output.py all

Exits 0 when every requested dataset is valid, 1 (with a per-issue report)
otherwise.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from route_offsets import MAX_STOP_TO_ROUTE_M, distance_m2

# repo/data/scripts/validate_output.py -> repo
REPO = Path(__file__).resolve().parents[2]
PUBLIC = REPO / "public"
# LRT trips live in src/data and are bundled into the app by Vite rather than
# served under public/data — see `loadTrips` in src/hooks/useTransitData.ts.
SRC_DATA = REPO / "src" / "data"

# Generous Macau-region bounding box. Tight enough to catch null-island (0,0)
# and grossly wrong coordinates, loose enough to include the cross-harbour
# bridges, the airport apron, and the Cotai/Hengqin fringe without false
# positives.
LNG_MIN, LNG_MAX = 113.40, 113.70
LAT_MIN, LAT_MAX = 22.05, 22.30

HHMM = re.compile(r"^\d{1,2}:\d{2}$")
YMD = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def in_macau(lng: object, lat: object) -> bool:
    return (
        isinstance(lng, (int, float))
        and isinstance(lat, (int, float))
        and LNG_MIN <= lng <= LNG_MAX
        and LAT_MIN <= lat <= LAT_MAX
    )


def check_coords(errs: list[str], ctx: str, coords: object) -> None:
    if not (isinstance(coords, list) and len(coords) == 2):
        errs.append(f"{ctx}: coordinates must be [lng, lat]")
        return
    lng, lat = coords
    if lng == 0 and lat == 0:
        errs.append(f"{ctx}: coordinates are null-island (0, 0)")
    elif not in_macau(lng, lat):
        errs.append(f"{ctx}: coordinates {coords} outside Macau bbox")


def require_fields(errs: list[str], ctx: str, obj: object, fields: tuple[str, ...]) -> bool:
    if not isinstance(obj, dict):
        errs.append(f"{ctx}: expected an object")
        return False
    ok = True
    for f in fields:
        if f not in obj:
            errs.append(f"{ctx}: missing field '{f}'")
            ok = False
    return ok


def require_nonempty_list(errs: list[str], name: str, data: object) -> bool:
    if not isinstance(data, list):
        errs.append(f"{name}: expected a JSON array")
        return False
    if not data:
        errs.append(f"{name}: array is empty")
        return False
    return True


# ── per-dataset validators ────────────────────────────────────────────────


def v_stations(data: object) -> list[str]:
    errs: list[str] = []
    if not require_nonempty_list(errs, "stations", data):
        return errs
    seen: set[str] = set()
    for i, s in enumerate(data):
        ctx = f"stations[{i}]"
        if not require_fields(errs, ctx, s, ("id", "name", "nameCn", "coordinates", "lineIds")):
            continue
        check_coords(errs, f"{ctx} ({s['id']})", s["coordinates"])
        if s["id"] in seen:
            errs.append(f"{ctx}: duplicate id '{s['id']}'")
        seen.add(s["id"])
    return errs


# A line's polyline must actually serve its stations: every station within
# LRT_STATION_TO_LINE_M of some vertex, and the polyline's two ends within
# LRT_LINE_END_TO_STATION_M of the first/last entry of `stations`. This keeps
# the hand-fixed public/data/lrt-lines.json (2026-04-19: station order and
# trimmed line ends) from being silently undone by a raw extract_lrt_osm.py
# re-run — the pre-fix file overshot 氹仔碼頭 by 280 m and listed 石排灣線's
# stations against the direction of its geometry.
LRT_STATION_TO_LINE_M = 100.0
LRT_LINE_END_TO_STATION_M = 100.0


def check_line_reaches_stations(
    errs: list[str], ctx: str, ln: dict, station_coords: dict[str, list[float]]
) -> None:
    coords = ln["geometry"].get("geometry", {}).get("coordinates", [])
    stations = ln.get("stations", [])
    if not isinstance(coords, list) or len(coords) < 2 or not stations:
        return
    for sid in stations:
        p = station_coords.get(sid)
        if p is None:
            continue
        d = min(distance_m2(p, c) for c in coords) ** 0.5
        if d > LRT_STATION_TO_LINE_M:
            errs.append(
                f"{ctx}: station '{sid}' is {d:.0f}m from the line "
                f"(limit {LRT_STATION_TO_LINE_M:.0f}m)"
            )
    for label, end, sid in (("start", coords[0], stations[0]), ("end", coords[-1], stations[-1])):
        p = station_coords.get(sid)
        if p is None:
            continue
        d = distance_m2(p, end) ** 0.5
        if d > LRT_LINE_END_TO_STATION_M:
            errs.append(
                f"{ctx}: line {label} is {d:.0f}m from its terminal station '{sid}' "
                f"(limit {LRT_LINE_END_TO_STATION_M:.0f}m) — stations out of order or line trimmed wrong"
            )


def v_lrt_lines(data: object) -> list[str]:
    errs: list[str] = []
    if not require_nonempty_list(errs, "lrt-lines", data):
        return errs
    station_coords = load_station_coords(errs, "lrt-lines")
    station_ids = set(station_coords) if station_coords is not None else None
    trips = load_trips_for_direction_check(errs, "lrt-lines")
    for i, ln in enumerate(data):
        ctx = f"lrt-lines[{i}]"
        if not require_fields(errs, ctx, ln, ("id", "name", "color", "stations", "geometry")):
            continue
        if not (isinstance(ln["stations"], list) and ln["stations"]):
            errs.append(f"{ctx} ({ln['id']}): no stations")
        elif station_ids is not None:
            for sid in ln["stations"]:
                if sid not in station_ids:
                    errs.append(f"{ctx} ({ln['id']}): station '{sid}' not in stations.json")
        check_geometry(errs, f"{ctx} ({ln['id']})", ln["geometry"])
        if station_coords is not None and isinstance(ln.get("geometry"), dict):
            check_line_reaches_stations(errs, f"{ctx} ({ln['id']})", ln, station_coords)
        if trips is not None:
            check_line_matches_trip_direction(errs, f"{ctx} ({ln['id']})", ln, trips)
    return errs


def load_trips_for_direction_check(errs: list[str], name: str) -> list | None:
    """Weekday trips (src/data/trips-mon_thu.json) for the direction cross-check;
    None if unreadable."""
    path = SRC_DATA / "trips-mon_thu.json"
    try:
        trips = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        errs.append(f"{name}: cannot read trips-mon_thu.json for direction cross-check — {e}")
        return None
    if not isinstance(trips, list):
        errs.append(f"{name}: trips-mon_thu.json is not a list — cannot cross-check directions")
        return None
    return trips


def check_line_matches_trip_direction(errs: list[str], ctx: str, ln: dict, trips: list) -> None:
    """`stations` must run in the direction of the line's forward trips.

    Downstream readers (macaubus.app's adapter) label direction 0 as
    stations[0] → stations[-1] and attach the `forward` timetable to it, so a
    reversed list silently pins every departure to the wrong platform. The
    2026-04-19 hand edit flipped 石排灣線 exactly that way.
    """
    stations = ln.get("stations", [])
    if not stations:
        return
    for direction, first, last in (
        ("forward", stations[0], stations[-1]),
        ("backward", stations[-1], stations[0]),
    ):
        trip = next(
            (
                t for t in trips
                if isinstance(t, dict) and t.get("lineId") == ln.get("id")
                and t.get("direction") == direction and t.get("entries")
            ),
            None,
        )
        if trip is None:
            errs.append(f"{ctx}: no {direction} trip in trips-mon_thu.json to cross-check direction")
            continue
        entries = trip["entries"]
        got = (entries[0].get("stationId"), entries[-1].get("stationId"))
        if got != (first, last):
            errs.append(
                f"{ctx}: {direction} trips run {got[0]} → {got[1]} but `stations` lists "
                f"{first} → {last} — station order must follow the forward direction"
            )


def load_station_coords(errs: list[str], name: str) -> dict[str, list[float]] | None:
    """Station id -> [lng, lat] from stations.json for cross-file checks; None if unreadable.

    The SEO renderer silently drops station ids it can't resolve, so a dangling
    reference must fail here at the gate — an unreadable stations.json is an
    error too, not a reason to skip the check.
    """
    path = PUBLIC / "data/stations.json"
    try:
        stations = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        errs.append(f"{name}: cannot read stations.json for station checks — {e}")
        return None
    if not isinstance(stations, list):
        errs.append(f"{name}: stations.json is not a list — cannot cross-check stations")
        return None
    return {
        s["id"]: s["coordinates"]
        for s in stations
        if isinstance(s, dict) and "id" in s and "coordinates" in s
    }


def check_geometry(errs: list[str], ctx: str, geom: object) -> None:
    if not isinstance(geom, dict):
        errs.append(f"{ctx}: geometry must be a GeoJSON Feature")
        return
    line = geom.get("geometry") if isinstance(geom.get("geometry"), dict) else None
    coords = line.get("coordinates") if line else None
    if not (isinstance(coords, list) and len(coords) >= 2):
        errs.append(f"{ctx}: geometry needs a LineString with >= 2 points")
        return
    for j, pt in enumerate(coords):
        if not (isinstance(pt, list) and len(pt) >= 2):
            errs.append(f"{ctx}: vertex {j} is not [lng, lat]")
            return
        if pt[0] == 0 and pt[1] == 0:
            errs.append(f"{ctx}: vertex {j} is null-island (0, 0)")
            return
        if not in_macau(pt[0], pt[1]):
            errs.append(f"{ctx}: vertex {j} {pt[:2]} outside Macau bbox")
            return


def v_bus_routes(data: object) -> list[str]:
    errs: list[str] = []
    if not require_nonempty_list(errs, "bus-routes", data):
        return errs
    try:
        bus_stops = json.loads((PUBLIC / "data/bus-stops.json").read_text(encoding="utf-8"))
        stop_coords = {
            stop["id"]: stop["coordinates"]
            for stop in bus_stops
            if isinstance(stop, dict) and "id" in stop and "coordinates" in stop
        }
    except (OSError, json.JSONDecodeError, TypeError) as e:
        errs.append(f"bus-routes: cannot read bus-stops.json for offset checks — {e}")
        stop_coords = {}

    seen: set[str] = set()
    for i, r in enumerate(data):
        ctx = f"bus-routes[{i}]"
        if not require_fields(
            errs, ctx, r,
            ("id", "name", "color", "stopsForward", "stopsBackward", "stopOffsets",
             "directionSplitIndex", "geometry",
             "frequency", "serviceHoursStart", "serviceHoursEnd", "routeType"),
        ):
            continue
        rid = r["id"]
        if rid in seen:
            errs.append(f"{ctx}: duplicate id '{rid}'")
        seen.add(rid)
        if r["routeType"] not in ("bilateral", "circular"):
            errs.append(f"{ctx} ({rid}): routeType '{r['routeType']}' invalid")
        if not r["stopsForward"]:
            errs.append(f"{ctx} ({rid}): stopsForward is empty")
        offsets = r["stopOffsets"]
        geometry_coords = (
            r.get("geometry", {}).get("geometry", {}).get("coordinates", [])
            if isinstance(r.get("geometry"), dict)
            else []
        )
        if not isinstance(offsets, list) or len(offsets) != len(r["stopsForward"]):
            errs.append(
                f"{ctx} ({rid}): stopOffsets length must match stopsForward"
            )
        else:
            previous_offset = -1
            for stop_index, (stop_id, offset) in enumerate(zip(r["stopsForward"], offsets)):
                offset_ctx = f"{ctx} ({rid}) stopOffsets[{stop_index}]"
                if not isinstance(offset, int) or isinstance(offset, bool):
                    errs.append(f"{offset_ctx}: must be an integer vertex index")
                    continue
                if offset <= previous_offset:
                    errs.append(f"{offset_ctx}: offsets must be strictly increasing")
                previous_offset = offset
                if not 0 <= offset < len(geometry_coords):
                    errs.append(f"{offset_ctx}: vertex {offset} is outside geometry")
                    continue
                stop_coord = stop_coords.get(stop_id)
                if stop_coord is None:
                    errs.append(f"{offset_ctx}: stop '{stop_id}' not in bus-stops.json")
                    continue
                distance_m = distance_m2(stop_coord, geometry_coords[offset]) ** 0.5
                if distance_m > MAX_STOP_TO_ROUTE_M:
                    errs.append(
                        f"{offset_ctx}: stop '{stop_id}' is {distance_m:.0f}m from "
                        f"vertex {offset} (limit {MAX_STOP_TO_ROUTE_M:.0f}m)"
                    )
        split_index = r["directionSplitIndex"]
        if (
            not isinstance(split_index, int)
            or isinstance(split_index, bool)
            or not 0 <= split_index <= len(r["stopsForward"])
        ):
            errs.append(
                f"{ctx} ({rid}): directionSplitIndex must be within stopsForward"
            )
        for key in ("serviceHoursStart", "serviceHoursEnd"):
            if r[key] is not None and not isinstance(r[key], (int, float)):
                errs.append(f"{ctx} ({rid}): {key} must be numeric or null")
        if not isinstance(r["frequency"], (int, float)):
            errs.append(f"{ctx} ({rid}): frequency must be numeric")
        check_geometry(errs, f"{ctx} ({rid})", r["geometry"])
    return errs


def v_bus_stops(data: object) -> list[str]:
    errs: list[str] = []
    if not require_nonempty_list(errs, "bus-stops", data):
        return errs
    seen: set[str] = set()
    for i, s in enumerate(data):
        ctx = f"bus-stops[{i}]"
        if not require_fields(errs, ctx, s, ("id", "coordinates", "routeIds")):
            continue
        check_coords(errs, f"{ctx} ({s['id']})", s["coordinates"])
        if s["id"] in seen:
            errs.append(f"{ctx}: duplicate id '{s['id']}'")
        seen.add(s["id"])
    return errs


def v_trips(data: object) -> list[str]:
    errs: list[str] = []
    if not require_nonempty_list(errs, "trips", data):
        return errs
    for i, tr in enumerate(data):
        ctx = f"trips[{i}]"
        if not require_fields(errs, ctx, tr, ("id", "lineId", "direction", "entries")):
            continue
        if tr["direction"] not in ("forward", "backward"):
            errs.append(f"{ctx} ({tr['id']}): direction '{tr['direction']}' invalid")
        if not tr["entries"]:
            errs.append(f"{ctx} ({tr['id']}): no entries")
            continue
        for j, e in enumerate(tr["entries"]):
            if not isinstance(e, dict) or "stationId" not in e or "arrivalMinutes" not in e:
                errs.append(f"{ctx} entry[{j}]: missing stationId/arrivalMinutes")
            elif not isinstance(e["arrivalMinutes"], (int, float)):
                errs.append(f"{ctx} entry[{j}]: arrivalMinutes must be numeric")
    return errs


def _v_flights(data: object, *, require_date: bool) -> list[str]:
    errs: list[str] = []
    label = "flights-timetable" if require_date else "flights"
    if not require_nonempty_list(errs, label, data):
        return errs
    for i, fl in enumerate(data):
        ctx = f"{label}[{i}]"
        if not require_fields(errs, ctx, fl, ("id", "flightNumber", "airline", "type", "scheduledTime")):
            continue
        if fl["type"] not in ("departure", "arrival"):
            errs.append(f"{ctx} ({fl['id']}): type '{fl['type']}' invalid")
        t = fl["scheduledTime"]
        if not (isinstance(t, (int, float)) and 0 <= t < 1440):
            errs.append(f"{ctx} ({fl['id']}): scheduledTime {t} out of [0, 1440)")
        if not (isinstance(fl["airline"], dict) and fl["airline"].get("iata")):
            errs.append(f"{ctx} ({fl['id']}): airline.iata missing")
        if require_date and not (isinstance(fl.get("date"), str) and YMD.match(fl["date"])):
            errs.append(f"{ctx} ({fl['id']}): date must be YYYY-MM-DD")
    return errs


def v_flights(data: object) -> list[str]:
    return _v_flights(data, require_date=False)


def v_flights_timetable(data: object) -> list[str]:
    return _v_flights(data, require_date=True)


def v_ferries(data: object) -> list[str]:
    errs: list[str] = []
    if not require_fields(errs, "ferry-schedules", data, ("fetchedAtUtc", "effectiveAs", "routes")):
        return errs
    if not require_nonempty_list(errs, "ferry-schedules.routes", data["routes"]):
        return errs
    for i, r in enumerate(data["routes"]):
        ctx = f"routes[{i}]"
        if not require_fields(
            errs, ctx, r,
            ("id", "operator", "terminal", "nameZh", "nameEn",
             "journeyMinutes", "effectiveDate", "directions"),
        ):
            continue
        if r["operator"] not in ("turbojet", "cotai"):
            errs.append(f"{ctx} ({r['id']}): operator '{r['operator']}' invalid")
        if r["terminal"] not in ("outer_harbour", "taipa"):
            errs.append(f"{ctx} ({r['id']}): terminal '{r['terminal']}' invalid")
        for key in ("nameZh", "nameEn"):
            if not (isinstance(r[key], str) and r[key]):
                errs.append(f"{ctx} ({r['id']}): {key} must be a non-empty string")
        if r["journeyMinutes"] is not None and not isinstance(r["journeyMinutes"], (int, float)):
            errs.append(f"{ctx} ({r['id']}): journeyMinutes must be a number or null")
        if r["effectiveDate"] is not None and not isinstance(r["effectiveDate"], str):
            errs.append(f"{ctx} ({r['id']}): effectiveDate must be a string or null")
        if not require_nonempty_list(errs, f"{ctx}.directions", r["directions"]):
            continue
        for j, d in enumerate(r["directions"]):
            dctx = f"{ctx}.directions[{j}]"
            if not require_fields(errs, dctx, d, ("header", "from", "to", "day", "night")):
                continue
            if not isinstance(d["header"], str):
                errs.append(f"{dctx}: header must be a string")
            for slot in ("day", "night"):
                for k, entry in enumerate(d.get(slot, [])):
                    tm = entry.get("time") if isinstance(entry, dict) else None
                    if not (isinstance(tm, str) and HHMM.match(tm)):
                        errs.append(f"{dctx}.{slot}[{k}]: time '{tm}' not HH:MM")
    return errs


def v_service_status(data: object) -> list[str]:
    errs: list[str] = []
    if not require_fields(errs, "service-status", data, ("totalRoutes", "inactive", "errors")):
        return errs
    total = data["totalRoutes"]
    if not (isinstance(total, int) and total > 0):
        errs.append(f"service-status: totalRoutes {total} must be a positive int")
        return errs
    n_err = len(data["errors"]) if isinstance(data["errors"], list) else total
    # Degenerate-scrape guard: if more than half the routes failed to fetch the
    # upstream layout almost certainly changed — refuse to ship the result.
    if n_err > total * 0.5:
        errs.append(f"service-status: {n_err}/{total} routes errored — upstream likely broken")
    if not isinstance(data["inactive"], list):
        errs.append("service-status: 'inactive' must be a list")
    return errs


ROAD_WORK_RESTRICTIONS = {"closed", "limited", "one_way", "no_parking", "other"}
# Bilingual text fields on a notice: {"zh": str, "pt": str}. Only location.zh is
# required non-empty — the upstream XML leaves others ("" contractor_pt, etc.)
# genuinely blank, and that's a valid notice, not a scrape failure.
ROAD_WORK_TEXT_FIELDS = ("restrictionText", "location", "reason", "principal", "contractor", "details")


def v_road_works(data: object) -> list[str]:
    errs: list[str] = []
    if not require_fields(errs, "road-works", data, ("fetchedAtUtc", "exportedAt", "source", "notices")):
        return errs
    if not isinstance(data["fetchedAtUtc"], str):
        errs.append("road-works: fetchedAtUtc must be a string")
    if not isinstance(data["exportedAt"], str):
        errs.append("road-works: exportedAt must be a string")
    source = data["source"]
    if require_fields(errs, "road-works.source", source, ("name", "dataset", "download")):
        for key in ("name", "dataset", "download"):
            if not isinstance(source[key], str):
                errs.append(f"road-works.source: '{key}' must be a string")
    if not require_nonempty_list(errs, "road-works.notices", data["notices"]):
        return errs

    seen_ids: set[str] = set()
    for i, n in enumerate(data["notices"]):
        ctx = f"road-works.notices[{i}]"
        if not require_fields(
            errs, ctx, n,
            ("id", "restriction", "restrictionText", "location", "reason", "principal",
             "contractor", "details", "duration", "startDate", "endDate", "onlineDate",
             "coordinates", "previousNotice"),
        ):
            continue
        nid = n["id"]
        if not (isinstance(nid, str) and nid):
            errs.append(f"{ctx}: id must be a non-empty string")
        elif nid in seen_ids:
            errs.append(f"{ctx}: duplicate id '{nid}'")
        else:
            seen_ids.add(nid)
        label = f"{ctx} ({nid if isinstance(nid, str) and nid else '?'})"

        if n["restriction"] not in ROAD_WORK_RESTRICTIONS:
            errs.append(f"{label}: restriction '{n['restriction']}' invalid")

        for key in ROAD_WORK_TEXT_FIELDS:
            obj = n[key]
            if not require_fields(errs, f"{label}.{key}", obj, ("zh", "pt")):
                continue
            for lang in ("zh", "pt"):
                if not isinstance(obj[lang], str):
                    errs.append(f"{label}.{key}.{lang} must be a string")
            if key == "location" and isinstance(obj.get("zh"), str) and not obj["zh"]:
                errs.append(f"{label}.location.zh must not be empty")

        duration = n["duration"]
        if require_fields(errs, f"{label}.duration", duration, ("days", "hours")):
            for k in ("days", "hours"):
                v = duration[k]
                if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                    errs.append(f"{label}.duration.{k} must be a non-negative int")

        date_values: dict[str, str] = {}
        for k in ("startDate", "endDate", "onlineDate"):
            v = n[k]
            if isinstance(v, str) and YMD.match(v):
                date_values[k] = v
            else:
                errs.append(f"{label}: {k} must match YYYY-MM-DD")
        if (
            "startDate" in date_values
            and "endDate" in date_values
            and date_values["startDate"] > date_values["endDate"]
        ):
            errs.append(
                f"{label}: startDate {date_values['startDate']} is after endDate {date_values['endDate']}"
            )

        check_coords(errs, label, n["coordinates"])

        prev = n["previousNotice"]
        if not (prev is None or (isinstance(prev, str) and prev)):
            errs.append(f"{label}: previousNotice must be null or a non-empty string")

    return errs


SCHOOL_LEVELS = {"kindergarten", "primary", "secondary", "university", "all_through"}
SCHOOL_SYSTEMS = {"private", "public", "tertiary"}
# Degenerate-run guard: a broken Overpass fetch or a regressed DSEDJ/OSM name
# match should fail loudly here rather than silently ship a near-empty overlay.
SCHOOLS_MIN_COUNT = 40
SCHOOL_BUILDINGS_MIN_COUNT = 100


def check_building_ring(errs: list[str], ctx: str, ring: object) -> None:
    if not (isinstance(ring, list) and len(ring) >= 4):
        errs.append(f"{ctx}: ring must be a list of >= 4 [lng, lat] points")
        return
    for j, pt in enumerate(ring):
        check_coords(errs, f"{ctx} vertex[{j}]", pt)
    if ring[0] != ring[-1]:
        errs.append(f"{ctx}: ring is not closed (first point != last point)")


def v_schools(data: object) -> list[str]:
    errs: list[str] = []
    if not require_fields(
        errs, "schools", data,
        ("fetchedAtUtc", "sources", "levels", "schools", "unmatchedDsedj", "droppedOsm"),
    ):
        return errs

    if not isinstance(data["fetchedAtUtc"], str):
        errs.append("schools: fetchedAtUtc must be a string")

    sources = data["sources"]
    if require_fields(errs, "schools.sources", sources, ("dsedj", "osm")):
        for key in ("dsedj", "osm"):
            if not isinstance(sources[key], str):
                errs.append(f"schools.sources: '{key}' must be a string")

    levels = data["levels"]
    if not (isinstance(levels, list) and len(levels) == len(SCHOOL_LEVELS) and set(levels) == SCHOOL_LEVELS):
        errs.append(f"schools.levels: must be exactly {sorted(SCHOOL_LEVELS)}")

    if not require_nonempty_list(errs, "schools.schools", data["schools"]):
        return errs

    seen_ids: set[str] = set()
    total_buildings = 0
    for i, s in enumerate(data["schools"]):
        ctx = f"schools.schools[{i}]"
        if not require_fields(
            errs, ctx, s,
            ("id", "name", "level", "levels", "system", "coordinates", "osm", "buildings"),
        ):
            continue

        sid = s["id"]
        if not (isinstance(sid, str) and sid):
            errs.append(f"{ctx}: id must be a non-empty string")
        elif sid in seen_ids:
            errs.append(f"{ctx}: duplicate id '{sid}'")
        else:
            seen_ids.add(sid)
        label = f"{ctx} ({sid if isinstance(sid, str) and sid else '?'})"

        name = s["name"]
        if require_fields(errs, f"{label}.name", name, ("zh", "pt")):
            if not (isinstance(name["zh"], str) and name["zh"]):
                errs.append(f"{label}.name.zh must be a non-empty string")
            if not isinstance(name["pt"], str):
                errs.append(f"{label}.name.pt must be a string")

        if s["level"] not in SCHOOL_LEVELS:
            errs.append(f"{label}: level '{s['level']}' invalid")

        lv = s["levels"]
        if require_fields(errs, f"{label}.levels", lv, ("kindergarten", "primary", "secondary")):
            for key in ("kindergarten", "primary", "secondary"):
                if not isinstance(lv[key], bool):
                    errs.append(f"{label}.levels.{key} must be a boolean")

        if s["system"] not in SCHOOL_SYSTEMS:
            errs.append(f"{label}: system '{s['system']}' invalid")

        check_coords(errs, label, s["coordinates"])

        if require_nonempty_list(errs, f"{label}.osm", s["osm"]):
            for j, o in enumerate(s["osm"]):
                if not isinstance(o, str):
                    errs.append(f"{label}.osm[{j}] must be a string")

        buildings = s["buildings"]
        if not isinstance(buildings, list):
            errs.append(f"{label}.buildings must be a list")
            continue
        total_buildings += len(buildings)
        for j, b in enumerate(buildings):
            bctx = f"{label}.buildings[{j}]"
            if not require_fields(errs, bctx, b, ("osmId", "name", "height", "minHeight", "coordinates")):
                continue
            if not (isinstance(b["osmId"], str) and b["osmId"]):
                errs.append(f"{bctx}: osmId must be a non-empty string")
            if not (b["name"] is None or isinstance(b["name"], str)):
                errs.append(f"{bctx}: name must be null or a string")
            height = b["height"]
            height_ok = isinstance(height, (int, float)) and not isinstance(height, bool) and height > 0
            if not height_ok:
                errs.append(f"{bctx}: height must be a number > 0")
            min_height = b["minHeight"]
            if not (isinstance(min_height, (int, float)) and not isinstance(min_height, bool) and min_height >= 0):
                errs.append(f"{bctx}: minHeight must be a number >= 0")
            elif height_ok and min_height >= height:
                errs.append(f"{bctx}: minHeight must be < height")
            rings = b["coordinates"]
            if not (isinstance(rings, list) and rings):
                errs.append(f"{bctx}: coordinates must be a non-empty list of rings")
            else:
                for k, ring in enumerate(rings):
                    check_building_ring(errs, f"{bctx}.coordinates[{k}]", ring)

    if len(data["schools"]) < SCHOOLS_MIN_COUNT:
        errs.append(
            f"schools: only {len(data['schools'])} schools (< {SCHOOLS_MIN_COUNT}) — looks like a degenerate run"
        )
    if total_buildings < SCHOOL_BUILDINGS_MIN_COUNT:
        errs.append(
            f"schools: only {total_buildings} buildings total (< {SCHOOL_BUILDINGS_MIN_COUNT}) — "
            "looks like a degenerate run"
        )

    for i, u in enumerate(data["unmatchedDsedj"]):
        uctx = f"schools.unmatchedDsedj[{i}]"
        if not require_fields(errs, uctx, u, ("code", "name", "level")):
            continue
        for key in ("code", "name", "level"):
            if not isinstance(u[key], str):
                errs.append(f"{uctx}.{key} must be a string")

    if not isinstance(data["droppedOsm"], list):
        errs.append("schools.droppedOsm: expected a JSON array")
    else:
        for i, d in enumerate(data["droppedOsm"]):
            if not isinstance(d, str):
                errs.append(f"schools.droppedOsm[{i}] must be a string")

    return errs


# Bilingual (zh/pt/en) text fields on a toilet record. Only name.zh is
# required non-empty — address/phone/openHours genuinely come back blank for
# some upstream records, and that's a valid toilet, not a scrape failure.
TOILET_TEXT_FIELDS = ("name", "address", "phone", "openHours")
# Degenerate-fetch guard mirroring fetch_toilets.py's own MIN_TOILETS — the
# feed carries ~200.
TOILETS_MIN_COUNT = 50


def v_toilets(data: object) -> list[str]:
    errs: list[str] = []
    if not require_fields(errs, "toilets", data, ("fetchedAtUtc", "updatedAt", "sources", "toilets")):
        return errs
    if not isinstance(data["fetchedAtUtc"], str):
        errs.append("toilets: fetchedAtUtc must be a string")
    if not (data["updatedAt"] is None or isinstance(data["updatedAt"], str)):
        errs.append("toilets: updatedAt must be null or a string")
    sources = data["sources"]
    if require_fields(errs, "toilets.sources", sources, ("name", "toilets", "accessibleToilets")):
        for key in ("name", "toilets", "accessibleToilets"):
            if not isinstance(sources[key], str):
                errs.append(f"toilets.sources: '{key}' must be a string")
    if not require_nonempty_list(errs, "toilets.toilets", data["toilets"]):
        return errs

    seen_ids: set[str] = set()
    for i, t in enumerate(data["toilets"]):
        ctx = f"toilets.toilets[{i}]"
        if not require_fields(
            errs, ctx, t,
            ("id", "code", "name", "address", "phone", "openHours",
             "accessible", "family", "closed", "photo", "coordinates"),
        ):
            continue
        tid = t["id"]
        if not (isinstance(tid, str) and tid):
            errs.append(f"{ctx}: id must be a non-empty string")
        elif tid in seen_ids:
            errs.append(f"{ctx}: duplicate id '{tid}'")
        else:
            seen_ids.add(tid)
        label = f"{ctx} ({tid if isinstance(tid, str) and tid else '?'})"

        if not (t["code"] is None or isinstance(t["code"], str)):
            errs.append(f"{label}: code must be null or a string")

        for key in TOILET_TEXT_FIELDS:
            obj = t[key]
            if not require_fields(errs, f"{label}.{key}", obj, ("zh", "pt", "en")):
                continue
            for lang in ("zh", "pt", "en"):
                if not isinstance(obj[lang], str):
                    errs.append(f"{label}.{key}.{lang} must be a string")
            if key == "name" and isinstance(obj.get("zh"), str) and not obj["zh"]:
                errs.append(f"{label}.name.zh must not be empty")

        for key in ("accessible", "family", "closed"):
            if not isinstance(t[key], bool):
                errs.append(f"{label}.{key} must be a boolean")

        photo = t["photo"]
        if not (photo is None or (isinstance(photo, str) and photo.startswith("http"))):
            errs.append(f"{label}: photo must be null or a URL starting with 'http'")

        check_coords(errs, label, t["coordinates"])

    if len(data["toilets"]) < TOILETS_MIN_COUNT:
        errs.append(
            f"toilets: only {len(data['toilets'])} toilets (< {TOILETS_MIN_COUNT}) — looks like a degenerate run"
        )

    return errs


# Bilingual (zh/pt/en) text fields on a car park record. Only name.zh is
# required non-empty — location/entrance genuinely come back "--" for a
# couple of upstream records, and that's a valid car park, not a scrape
# failure.
CAR_PARK_TEXT_FIELDS = ("name", "location", "entrance", "zone", "parish")
CAR_PARK_FEE_CATEGORIES = ("light", "heavy", "moto", "remark")
# Degenerate-fetch guard mirroring fetch_car_parks.py's own MIN_CAR_PARKS —
# the feed carries 88.
CAR_PARKS_MIN_COUNT = 40


def v_car_parks(data: object) -> list[str]:
    errs: list[str] = []
    if not require_fields(errs, "car-parks", data, ("fetchedAtUtc", "sources", "carParks")):
        return errs
    if not isinstance(data["fetchedAtUtc"], str):
        errs.append("car-parks: fetchedAtUtc must be a string")
    sources = data["sources"]
    if require_fields(errs, "car-parks.sources", sources, ("name", "dataset", "vacancyDataset")):
        for key in ("name", "dataset", "vacancyDataset"):
            if not isinstance(sources[key], str):
                errs.append(f"car-parks.sources: '{key}' must be a string")
    if not require_nonempty_list(errs, "car-parks.carParks", data["carParks"]):
        return errs

    seen_ids: set[str] = set()
    for i, c in enumerate(data["carParks"]):
        ctx = f"car-parks.carParks[{i}]"
        if not require_fields(
            errs, ctx, c,
            ("id", "name", "location", "entrance", "phone", "heightLimitM",
             "fees", "zone", "parish", "coordinates"),
        ):
            continue
        cid = c["id"]
        if not (isinstance(cid, str) and cid):
            errs.append(f"{ctx}: id must be a non-empty string")
        elif cid in seen_ids:
            errs.append(f"{ctx}: duplicate id '{cid}'")
        else:
            seen_ids.add(cid)
        label = f"{ctx} ({cid if isinstance(cid, str) and cid else '?'})"

        for key in CAR_PARK_TEXT_FIELDS:
            obj = c[key]
            if not require_fields(errs, f"{label}.{key}", obj, ("zh", "pt", "en")):
                continue
            for lang in ("zh", "pt", "en"):
                if not isinstance(obj[lang], str):
                    errs.append(f"{label}.{key}.{lang} must be a string")
            if key == "name" and isinstance(obj.get("zh"), str) and not obj["zh"]:
                errs.append(f"{label}.name.zh must not be empty")

        if not isinstance(c["phone"], str):
            errs.append(f"{label}: phone must be a string")

        height = c["heightLimitM"]
        if not (height is None or (isinstance(height, (int, float)) and not isinstance(height, bool))):
            errs.append(f"{label}: heightLimitM must be null or a number")

        fees = c["fees"]
        if require_fields(errs, f"{label}.fees", fees, CAR_PARK_FEE_CATEGORIES):
            for cat in CAR_PARK_FEE_CATEGORIES:
                obj = fees[cat]
                if not require_fields(errs, f"{label}.fees.{cat}", obj, ("zh", "pt", "en")):
                    continue
                for lang in ("zh", "pt", "en"):
                    if not isinstance(obj[lang], str):
                        errs.append(f"{label}.fees.{cat}.{lang} must be a string")

        check_coords(errs, label, c["coordinates"])

    if len(data["carParks"]) < CAR_PARKS_MIN_COUNT:
        errs.append(
            f"car-parks: only {len(data['carParks'])} car parks (< {CAR_PARKS_MIN_COUNT}) — looks like a degenerate run"
        )

    return errs


# name -> (absolute path, validator)
DATASETS: dict[str, tuple[Path, object]] = {
    "lrt-lines": (PUBLIC / "data/lrt-lines.json", v_lrt_lines),
    "stations": (PUBLIC / "data/stations.json", v_stations),
    "trips-mon_thu": (SRC_DATA / "trips-mon_thu.json", v_trips),
    "trips-friday": (SRC_DATA / "trips-friday.json", v_trips),
    "trips-sat_sun": (SRC_DATA / "trips-sat_sun.json", v_trips),
    "bus-routes": (PUBLIC / "data/bus-routes.json", v_bus_routes),
    "bus-stops": (PUBLIC / "data/bus-stops.json", v_bus_stops),
    "flights": (PUBLIC / "data/flights.json", v_flights),
    "flights-timetable": (PUBLIC / "data/flights-timetable.json", v_flights_timetable),
    "ferries": (PUBLIC / "data/ferry-schedules.json", v_ferries),
    "service-status": (PUBLIC / "service-status.json", v_service_status),
    "road-works": (PUBLIC / "data/road-works.json", v_road_works),
    "schools": (PUBLIC / "data/schools.json", v_schools),
    "toilets": (PUBLIC / "data/toilets.json", v_toilets),
    "car-parks": (PUBLIC / "data/car-parks.json", v_car_parks),
}

# Convenience aliases for the names the trips loader / workflows use.
ALIASES = {"trips": ["trips-mon_thu", "trips-friday", "trips-sat_sun"]}


def validate_one(name: str) -> list[str]:
    path, validator = DATASETS[name]
    if not path.exists():
        return [f"{name}: file not found at {path}"]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"{name}: invalid JSON — {e}"]
    return validator(data)  # type: ignore[operator]


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        print("Known datasets:", ", ".join(DATASETS))
        return 2

    requested: list[str] = []
    for arg in argv:
        if arg == "all":
            requested = list(DATASETS)
            break
        requested.extend(ALIASES.get(arg, [arg]))

    unknown = [n for n in requested if n not in DATASETS]
    if unknown:
        print(f"ERROR: unknown dataset(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"Known: {', '.join(DATASETS)}", file=sys.stderr)
        return 2

    total_errors = 0
    for name in requested:
        errs = validate_one(name)
        if errs:
            total_errors += len(errs)
            print(f"FAIL {name}: {len(errs)} issue(s)")
            for e in errs[:25]:
                print(f"    {e}")
            if len(errs) > 25:
                print(f"    ... and {len(errs) - 25} more")
        else:
            print(f"OK   {name}")

    if total_errors:
        print(f"\nFAILED: {total_errors} validation issue(s)", file=sys.stderr)
        return 1
    print("\nAll datasets valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
