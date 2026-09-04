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


def check_footprint_building(errs: list[str], bctx: str, b: object, *, kinds: set[str] | None = None) -> None:
    """One 3D building record: ids, heights and closed rings inside Macau.

    Shared by schools and water facilities — both overlays feed the same
    fill-extrusion contract (`osmId`, `name`, `height`, `minHeight`,
    `coordinates`), so a bad ring must fail the same way in both. `kinds`
    constrains the `kind` field where it is an enum (water facilities);
    schools leave it free-form because it carries the OSM `building` tag.
    """
    if not require_fields(errs, bctx, b, ("osmId", "name", "height", "minHeight", "coordinates")):
        return
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
    if kinds is not None and b.get("kind") not in kinds:
        errs.append(f"{bctx}: kind '{b.get('kind')}' invalid")
    rings = b["coordinates"]
    if not (isinstance(rings, list) and rings):
        errs.append(f"{bctx}: coordinates must be a non-empty list of rings")
        return
    for k, ring in enumerate(rings):
        check_building_ring(errs, f"{bctx}.coordinates[{k}]", ring)


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
            # `kind` is free-form here (it carries the OSM `building` tag),
            # unlike water-facilities' three-value enum.
            check_footprint_building(errs, f"{label}.buildings[{j}]", b)

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


WATER_FACILITY_TYPES = {"plant", "reservoir", "tank", "raw_pumping", "pumping"}
WATER_BUILDING_KINDS = {"building", "tile", "outline"}
WATER_OPERATORS = {"macao_water", "dsama"}
# Macao Water publishes exactly 22 numbered supply facilities, so this is an
# equality check, not a floor: a short list means the table in
# fetch_water_facilities.py was edited or the OSM re-query silently dropped
# something. 11 of the 22 are grounded in OSM (4 plants + 3 reservoirs +
# 3 elevated tanks + 1 pump house), hence the 8-with-buildings / 4-with-water
# floors — mirrored by the script's own guard.
#
# The 23rd facility is 黑沙水庫, which belongs to 海事及水務局 (DSAMA), not to
# Macao Water: it carries `operator: "dsama"` and `no: null`, and the split is
# checked exactly, because silently letting a government reservoir into the
# numbered list would put a wrong number in the UI.
WATER_MACAO_WATER_COUNT = 22
WATER_DSAMA_COUNT = 1
WATER_FACILITY_COUNT = WATER_MACAO_WATER_COUNT + WATER_DSAMA_COUNT
WATER_MIN_WITH_BUILDINGS = 8
WATER_MIN_WITH_WATER = 4

# The `network` block is a schematic drawn by fetch_water_facilities.py, not
# Macao Water's real mains: the edge list is hard-coded there (PIPES), so the
# count is an equality check like the facility count, and only the geometry
# comes from outside (an OSRM driving route per edge). A pipe that could not be
# routed degrades to a straight line and says so via `fallback`; a handful is
# survivable, but a whole file of them means OSRM was down and the "network"
# is a fan of lines through buildings and across the harbour.
WATER_NODE_KINDS = {"inlet"}
WATER_PIPE_KINDS = {"raw", "treated"}
WATER_PIPE_COUNT = 23
WATER_MAX_PIPE_FALLBACKS = 3


def v_water_network(errs: list[str], network: object, facility_ids: set[str]) -> None:
    ctx = "water-facilities.network"
    if not require_fields(errs, ctx, network, ("nodes", "pipes")):
        return

    # `nodes` carries only the extra non-facility endpoints (today: the Zhuhai
    # raw-water inlet). Facilities are implicit nodes, referenced by their id.
    node_ids: set[str] = set()
    nodes = network["nodes"]
    if not isinstance(nodes, list):
        errs.append(f"{ctx}.nodes: expected a list")
        nodes = []
    for i, n in enumerate(nodes):
        nctx = f"{ctx}.nodes[{i}]"
        if not require_fields(errs, nctx, n, ("id", "kind", "name", "coordinates")):
            continue
        nid = n["id"]
        if not (isinstance(nid, str) and nid):
            errs.append(f"{nctx}: id must be a non-empty string")
        elif nid in node_ids or nid in facility_ids:
            errs.append(f"{nctx}: duplicate node id '{nid}'")
        else:
            node_ids.add(nid)
        if n["kind"] not in WATER_NODE_KINDS:
            errs.append(f"{nctx}: kind '{n['kind']}' invalid")
        if require_fields(errs, f"{nctx}.name", n["name"], ("zh", "en", "pt")):
            for lang in ("zh", "en", "pt"):
                if not (isinstance(n["name"][lang], str) and n["name"][lang]):
                    errs.append(f"{nctx}.name.{lang} must be a non-empty string")
        check_coords(errs, nctx, n["coordinates"])

    pipes = network["pipes"]
    if not isinstance(pipes, list):
        errs.append(f"{ctx}.pipes: expected a list")
        return

    known = facility_ids | node_ids
    seen_pipe_ids: set[str] = set()
    fallbacks = 0
    for i, p in enumerate(pipes):
        pctx = f"{ctx}.pipes[{i}]"
        if not require_fields(
            errs, pctx, p,
            ("id", "from", "to", "kind", "lengthM", "direct", "fallback", "coordinates"),
        ):
            continue

        pid = p["id"]
        if not (isinstance(pid, str) and pid):
            errs.append(f"{pctx}: id must be a non-empty string")
        elif pid in seen_pipe_ids:
            errs.append(f"{pctx}: duplicate id '{pid}'")
        else:
            seen_pipe_ids.add(pid)
        label = f"{pctx} ({pid if isinstance(pid, str) and pid else '?'})"

        for end in ("from", "to"):
            if p[end] not in known:
                errs.append(f"{label}: {end} '{p[end]}' is neither a facility id "
                            "nor a network node id")

        if p["kind"] not in WATER_PIPE_KINDS:
            errs.append(f"{label}: kind '{p['kind']}' invalid")

        length = p["lengthM"]
        if not (isinstance(length, int) and not isinstance(length, bool) and length >= 0):
            errs.append(f"{label}: lengthM must be an int >= 0")

        # `direct` = a deliberate two-point stub (same site, or the road route
        # was an absurd detour); `fallback` = OSRM failed. They are different
        # things and must not be conflated, so a direct pipe is never a
        # fallback and is always exactly one straight segment.
        direct = p["direct"]
        if not isinstance(direct, bool):
            errs.append(f"{label}: direct must be a boolean")
            direct = False

        if not isinstance(p["fallback"], bool):
            errs.append(f"{label}: fallback must be a boolean")
        else:
            if p["fallback"]:
                fallbacks += 1
            if p["fallback"] and direct:
                errs.append(f"{label}: a direct pipe cannot also be a fallback")

        line = p["coordinates"]
        if not (isinstance(line, list) and len(line) >= 2):
            errs.append(f"{label}: coordinates must be a list of >= 2 [lng, lat] points")
            continue
        if direct and len(line) != 2:
            errs.append(f"{label}: a direct pipe must be exactly 2 coordinates, "
                        f"got {len(line)}")
        for j, pt in enumerate(line):
            check_coords(errs, f"{label}.coordinates[{j}]", pt)

    if len(pipes) != WATER_PIPE_COUNT:
        errs.append(f"{ctx}: {len(pipes)} pipes, expected exactly {WATER_PIPE_COUNT}")
    if fallbacks > WATER_MAX_PIPE_FALLBACKS:
        errs.append(
            f"{ctx}: {fallbacks} pipes fell back to straight lines "
            f"(> {WATER_MAX_PIPE_FALLBACKS}) — OSRM was probably down"
        )


def v_water_facilities(data: object) -> list[str]:
    errs: list[str] = []
    if not require_fields(
        errs, "water-facilities", data, ("fetchedAtUtc", "sources", "facilities", "network")
    ):
        return errs

    if not isinstance(data["fetchedAtUtc"], str):
        errs.append("water-facilities: fetchedAtUtc must be a string")

    sources = data["sources"]
    if require_fields(errs, "water-facilities.sources", sources, ("name", "facilities", "osm")):
        for key in ("name", "facilities", "osm"):
            if not isinstance(sources[key], str):
                errs.append(f"water-facilities.sources: '{key}' must be a string")

    # `anchors` is optional metadata (which OSM element a `district:` anchor
    # resolved to); validate it when present rather than requiring it.
    anchors = data.get("anchors")
    anchor_keys: set[str] = set()
    if anchors is not None:
        if not isinstance(anchors, dict):
            errs.append("water-facilities.anchors: expected an object")
        else:
            anchor_keys = set(anchors)
            for key, a in anchors.items():
                actx = f"water-facilities.anchors['{key}']"
                if not key.startswith("district:"):
                    errs.append(f"{actx}: key must start with 'district:'")
                if not require_fields(errs, actx, a, ("osmId", "name", "coordinates")):
                    continue
                for field in ("osmId", "name"):
                    if not (isinstance(a[field], str) and a[field]):
                        errs.append(f"{actx}: {field} must be a non-empty string")
                check_coords(errs, actx, a["coordinates"])

    if not require_nonempty_list(errs, "water-facilities.facilities", data["facilities"]):
        return errs

    facilities = data["facilities"]
    seen_ids: set[str] = set()
    seen_nos: set[int] = set()
    by_operator: dict[str, int] = {}
    with_buildings = 0
    with_water = 0
    for i, f in enumerate(facilities):
        ctx = f"water-facilities.facilities[{i}]"
        if not require_fields(
            errs, ctx, f,
            ("id", "no", "type", "operator", "name", "coordinates", "approximate",
             "anchor", "osm", "buildings", "water"),
        ):
            continue

        fid = f["id"]
        if not (isinstance(fid, str) and fid):
            errs.append(f"{ctx}: id must be a non-empty string")
        elif fid in seen_ids:
            errs.append(f"{ctx}: duplicate id '{fid}'")
        else:
            seen_ids.add(fid)
        label = f"{ctx} ({fid if isinstance(fid, str) and fid else '?'})"

        operator = f["operator"]
        if operator not in WATER_OPERATORS:
            errs.append(f"{label}: operator '{operator}' invalid")
        else:
            by_operator[operator] = by_operator.get(operator, 0) + 1

        # Only Macao Water's own facilities carry its 1..22 numbering; anything
        # else on the map (today: 黑沙水庫, DSAMA) must have `no: null` so the UI
        # cannot print a number that does not exist upstream.
        no = f["no"]
        if operator == "macao_water":
            if not (isinstance(no, int) and not isinstance(no, bool)
                    and 1 <= no <= WATER_MACAO_WATER_COUNT):
                errs.append(f"{label}: no must be an int in 1..{WATER_MACAO_WATER_COUNT}")
            elif no in seen_nos:
                errs.append(f"{label}: duplicate no {no}")
            else:
                seen_nos.add(no)
        elif no is not None:
            errs.append(f"{label}: no must be null for a non-Macao-Water facility")

        if f["type"] not in WATER_FACILITY_TYPES:
            errs.append(f"{label}: type '{f['type']}' invalid")

        name = f["name"]
        if require_fields(errs, f"{label}.name", name, ("zh", "en", "pt")):
            for lang in ("zh", "en"):
                if not (isinstance(name[lang], str) and name[lang]):
                    errs.append(f"{label}.name.{lang} must be a non-empty string")
            # Macao Water publishes no Portuguese names for the pumping stations
            # and the Taipa 70 m tank; rather than ship invented translations the
            # pipeline leaves `pt` empty and the UI falls back pt → en → zh.
            if not isinstance(name["pt"], str):
                errs.append(f"{label}.name.pt must be a string")

        check_coords(errs, label, f["coordinates"])

        approximate = f["approximate"]
        if not isinstance(approximate, bool):
            errs.append(f"{label}: approximate must be a boolean")

        anchor = f["anchor"]
        if anchor is None:
            if approximate is True:
                errs.append(f"{label}: approximate facilities need an anchor")
        elif not (isinstance(anchor, str) and anchor):
            errs.append(f"{label}: anchor must be null or a non-empty string")
        elif approximate is False:
            errs.append(f"{label}: exact facilities must have anchor null")

        if not isinstance(f["osm"], list):
            errs.append(f"{label}.osm must be a list")
        else:
            for j, o in enumerate(f["osm"]):
                if not (isinstance(o, str) and o):
                    errs.append(f"{label}.osm[{j}] must be a non-empty string")
            if approximate is False and not f["osm"]:
                errs.append(f"{label}: an exact facility must cite at least one OSM id")

        buildings = f["buildings"]
        if not isinstance(buildings, list):
            errs.append(f"{label}.buildings must be a list")
        else:
            if buildings:
                with_buildings += 1
            for j, b in enumerate(buildings):
                check_footprint_building(errs, f"{label}.buildings[{j}]", b, kinds=WATER_BUILDING_KINDS)

        water = f["water"]
        if not isinstance(water, list):
            errs.append(f"{label}.water must be a list")
        else:
            if water:
                with_water += 1
            for j, w in enumerate(water):
                wctx = f"{label}.water[{j}]"
                if not require_fields(errs, wctx, w, ("osmId", "coordinates")):
                    continue
                if not (isinstance(w["osmId"], str) and w["osmId"]):
                    errs.append(f"{wctx}: osmId must be a non-empty string")
                rings = w["coordinates"]
                if not (isinstance(rings, list) and rings):
                    errs.append(f"{wctx}: coordinates must be a non-empty list of rings")
                    continue
                for k, ring in enumerate(rings):
                    check_building_ring(errs, f"{wctx}.coordinates[{k}]", ring)

    # Anchors must resolve: a facility id for a co-located one, an `anchors`
    # entry (when the file carries one) for a district-level fallback.
    for f in facilities:
        if not isinstance(f, dict):
            continue
        anchor = f.get("anchor")
        if not isinstance(anchor, str) or not anchor:
            continue
        label = f"water-facilities.facilities ({f.get('id', '?')})"
        if anchor.startswith("district:"):
            if anchor_keys and anchor not in anchor_keys:
                errs.append(f"{label}: anchor '{anchor}' is not in `anchors`")
        elif anchor not in seen_ids:
            errs.append(f"{label}: anchor '{anchor}' is not a facility id")

    if len(facilities) != WATER_FACILITY_COUNT:
        errs.append(
            f"water-facilities: {len(facilities)} facilities, expected exactly {WATER_FACILITY_COUNT}"
        )
    for op, expected in (("macao_water", WATER_MACAO_WATER_COUNT),
                         ("dsama", WATER_DSAMA_COUNT)):
        if by_operator.get(op, 0) != expected:
            errs.append(
                f"water-facilities: {by_operator.get(op, 0)} facilities with operator "
                f"'{op}', expected exactly {expected}"
            )
    if with_buildings < WATER_MIN_WITH_BUILDINGS:
        errs.append(
            f"water-facilities: only {with_buildings} facilities have buildings "
            f"(< {WATER_MIN_WITH_BUILDINGS}) — looks like a degenerate run"
        )
    if with_water < WATER_MIN_WITH_WATER:
        errs.append(
            f"water-facilities: only {with_water} facilities have water polygons "
            f"(< {WATER_MIN_WITH_WATER}) — looks like a degenerate run"
        )

    v_water_network(errs, data["network"], seen_ids)

    return errs


# The Macau-only road network the water and power overlays draw their
# distribution layers on. Both files come out of the same pipeline module
# (data/scripts/road_network.py) and differ only in what seeded the flow field,
# so one validator checks both. They are shipped rather than styled out of the
# basemap because OpenFreeMap's tiles cannot be clipped to the SAR — a restyled
# basemap layer would light up Zhuhai just as brightly. ~4,900 ways come back
# from OSM after simplification; the floor catches a truncated Overpass answer,
# not a slow OSM week.
#
# Each road also carries a FLOW DIRECTION: its coordinates run from the end
# nearer a source to the end further away, so the frontend's dash animation
# reads as water (or power) flowing outward. `dist`/`distEnd` are the metres at
# the two ends, which makes the invariant checkable — if `distEnd < dist` the
# pipeline forgot to reverse an array and that road's flow would run backwards.
# Roads no source can reach carry `null` for both.
DISTRIBUTION_MIN_ROADS = 2000
WATER_DISTRIBUTION_MIN_ROADS = DISTRIBUTION_MIN_ROADS
POWER_DISTRIBUTION_MIN_ROADS = DISTRIBUTION_MIN_ROADS


def v_distribution(data: object, name: str) -> list[str]:
    """Shared body for `water-distribution` and `power-distribution`."""
    errs: list[str] = []
    if not require_fields(
        errs, name, data,
        ("fetchedAtUtc", "sources", "classes", "flowSources", "unreached", "splits", "roads"),
    ):
        return errs

    if not isinstance(data["fetchedAtUtc"], str):
        errs.append(f"{name}: fetchedAtUtc must be a string")

    sources = data["sources"]
    if require_fields(errs, f"{name}.sources", sources, ("osm", "boundary")):
        for key in ("osm", "boundary"):
            if not (isinstance(sources[key], str) and sources[key]):
                errs.append(f"{name}.sources: '{key}' must be a non-empty string")

    # `classes` is the file's own enum, so a new road class only has to be added
    # in the pipeline; this checks the roads against whatever it declares.
    classes = data["classes"]
    if not require_nonempty_list(errs, f"{name}.classes", classes):
        return errs
    for i, c in enumerate(classes):
        if not (isinstance(c, str) and c):
            errs.append(f"{name}.classes[{i}] must be a non-empty string")
    known = {c for c in classes if isinstance(c, str)}

    # The facilities the flow field was seeded from. Named `flowSources`
    # because `sources` is the provenance block every dataset here carries.
    if not require_nonempty_list(errs, f"{name}.flowSources", data["flowSources"]):
        return errs
    for i, s in enumerate(data["flowSources"]):
        if not (isinstance(s, str) and s):
            errs.append(f"{name}.flowSources[{i}] must be a non-empty string")

    unreached = data["unreached"]
    if not (isinstance(unreached, int) and not isinstance(unreached, bool) and unreached >= 0):
        errs.append(f"{name}: unreached must be an int >= 0")
    splits = data["splits"]
    if not (isinstance(splits, int) and not isinstance(splits, bool) and splits >= 0):
        errs.append(f"{name}: splits must be an int >= 0")

    if not require_nonempty_list(errs, f"{name}.roads", data["roads"]):
        return errs

    roads = data["roads"]
    unflowed = 0
    for i, r in enumerate(roads):
        ctx = f"{name}.roads[{i}]"
        if not require_fields(errs, ctx, r, ("class", "dist", "distEnd", "coordinates")):
            continue
        if r["class"] not in known:
            errs.append(f"{ctx}: class '{r['class']}' is not one of `classes`")

        # Both ends are set, or neither is: a road with only one end measured
        # would leave the frontend guessing which way the flow goes.
        ends = []
        for field in ("dist", "distEnd"):
            v = r[field]
            if v is None:
                ends.append(None)
            elif isinstance(v, int) and not isinstance(v, bool) and v >= 0:
                ends.append(v)
            else:
                errs.append(f"{ctx}: {field} must be null or an int >= 0")
                ends.append(None)
        if (r["dist"] is None) != (r["distEnd"] is None):
            errs.append(f"{ctx}: dist and distEnd must both be set or both be null")
        elif r["dist"] is None:
            unflowed += 1
        elif ends[0] is not None and ends[1] is not None and ends[1] < ends[0]:
            errs.append(
                f"{ctx}: distEnd ({ends[1]}) < dist ({ends[0]}) — the road was not "
                "oriented outward from its source"
            )

        line = r["coordinates"]
        if not (isinstance(line, list) and len(line) >= 2):
            errs.append(f"{ctx}: coordinates must be a list of >= 2 [lng, lat] points")
            continue
        for j, pt in enumerate(line):
            check_coords(errs, f"{ctx}.coordinates[{j}]", pt)

    if isinstance(unreached, int) and not isinstance(unreached, bool) and unreached != unflowed:
        errs.append(
            f"{name}: `unreached` says {unreached} but {unflowed} roads "
            "have a null dist"
        )

    if len(roads) < DISTRIBUTION_MIN_ROADS:
        errs.append(
            f"{name}: only {len(roads)} roads "
            f"(< {DISTRIBUTION_MIN_ROADS}) — looks like a degenerate run"
        )

    return errs


def v_water_distribution(data: object) -> list[str]:
    return v_distribution(data, "water-distribution")


def v_power_distribution(data: object) -> list[str]:
    return v_distribution(data, "power-distribution")


# CEM's generation and high-voltage transmission assets. The facility count is
# an equality check, not a floor: the list is hard-coded in
# fetch_power_facilities.py from CEM's own「營運」page (its three voltage tables
# name 33 distinct substations once 澳北 A/B collapse onto OSM's single 澳北
# 變電站, plus 北安 from the interconnection prose), so a short list means the
# table was edited or the OSM re-query silently dropped something. Five of the
# 33 are not in OSM and ship as marker-only records anchored on a named
# landmark; MAX_APPROXIMATE catches a regressed match (e.g. an OSM rename
# turning ten stations into pins).
#
# `voltageKv` is the HIGHEST voltage a site carries and must agree with `type`
# — 澳北 is tagged 110000;66000 in OSM and is a `sub110`, and a file that says
# `sub66` with `voltageKv: 110` would colour and size the wrong things.
POWER_FACILITY_TYPES = {"plant", "incinerator", "sub220", "sub110", "sub66"}
POWER_BUILDING_KINDS = {"building", "tile", "outline"}
POWER_OPERATORS = {"cem", "dspa"}
POWER_PROVENANCE = {"cem", "dspa", "osm"}
POWER_TYPE_VOLTAGE = {"sub220": 220, "sub110": 110, "sub66": 66}
POWER_SUBSTATION_COUNT = 33
POWER_FACILITY_COUNT = POWER_SUBSTATION_COUNT + 2  # + power station + incinerator
POWER_MIN_WITH_BUILDINGS = 20
POWER_MAX_APPROXIMATE = 8

# The `network` block is a schematic drawn by fetch_power_facilities.py, not
# CEM's cable routes: Macau's 1,088 km of HV cable is underground and not in
# OSM. The 220 kV backbone is a hard-coded edge list and every 110/66 kV
# station is hung off its nearest higher-level station by road, so the line
# count is an equality check like the facility count. A line that could not be
# routed degrades to a straight line and says so via `fallback`; a handful is
# survivable, but a whole file of them means OSRM was down.
POWER_NODE_KINDS = {"inlet"}
POWER_INLET_COUNT = 3
POWER_LINE_COUNT = 37
POWER_MAX_LINE_FALLBACKS = 3


def v_power_network(errs: list[str], network: object, facility_ids: set[str]) -> None:
    ctx = "power-facilities.network"
    if not require_fields(errs, ctx, network, ("nodes", "lines")):
        return

    # `nodes` carries only the non-facility endpoints: the three Guangdong
    # interconnection inlets. Facilities are implicit nodes, referenced by id.
    node_ids: set[str] = set()
    nodes = network["nodes"]
    if not isinstance(nodes, list):
        errs.append(f"{ctx}.nodes: expected a list")
        nodes = []
    for i, n in enumerate(nodes):
        nctx = f"{ctx}.nodes[{i}]"
        if not require_fields(errs, nctx, n, ("id", "kind", "name", "coordinates")):
            continue
        nid = n["id"]
        if not (isinstance(nid, str) and nid):
            errs.append(f"{nctx}: id must be a non-empty string")
        elif nid in node_ids or nid in facility_ids:
            errs.append(f"{nctx}: duplicate node id '{nid}'")
        else:
            node_ids.add(nid)
        if n["kind"] not in POWER_NODE_KINDS:
            errs.append(f"{nctx}: kind '{n['kind']}' invalid")
        if require_fields(errs, f"{nctx}.name", n["name"], ("zh", "en", "pt")):
            for lang in ("zh", "en", "pt"):
                if not (isinstance(n["name"][lang], str) and n["name"][lang]):
                    errs.append(f"{nctx}.name.{lang} must be a non-empty string")
        check_coords(errs, nctx, n["coordinates"])
        # Optional: an inlet whose landing point is our estimate rather than a
        # published location (the panel says so).
        if "approximate" in n and not isinstance(n["approximate"], bool):
            errs.append(f"{nctx}.approximate must be a boolean")
    if len(nodes) != POWER_INLET_COUNT:
        errs.append(f"{ctx}: {len(nodes)} inlet nodes, expected exactly {POWER_INLET_COUNT}")

    lines = network["lines"]
    if not isinstance(lines, list):
        errs.append(f"{ctx}.lines: expected a list")
        return

    known = facility_ids | node_ids
    connected: set[str] = set()
    seen_line_ids: set[str] = set()
    fallbacks = 0
    for i, ln in enumerate(lines):
        lctx = f"{ctx}.lines[{i}]"
        if not require_fields(
            errs, lctx, ln,
            ("id", "from", "to", "voltageKv", "lengthM", "direct", "fallback", "coordinates"),
        ):
            continue

        lid = ln["id"]
        if not (isinstance(lid, str) and lid):
            errs.append(f"{lctx}: id must be a non-empty string")
        elif lid in seen_line_ids:
            errs.append(f"{lctx}: duplicate id '{lid}'")
        else:
            seen_line_ids.add(lid)
        label = f"{lctx} ({lid if isinstance(lid, str) and lid else '?'})"

        for end in ("from", "to"):
            if ln[end] not in known:
                errs.append(f"{label}: {end} '{ln[end]}' is neither a facility id "
                            "nor a network node id")
            else:
                connected.add(ln[end])
        if ln["from"] == ln["to"]:
            errs.append(f"{label}: from and to are the same node")

        if ln["voltageKv"] not in set(POWER_TYPE_VOLTAGE.values()):
            errs.append(f"{label}: voltageKv '{ln['voltageKv']}' invalid")

        length = ln["lengthM"]
        if not (isinstance(length, int) and not isinstance(length, bool) and length >= 0):
            errs.append(f"{label}: lengthM must be an int >= 0")

        # `direct` = a deliberate two-point stub (same site, or the road route
        # was an absurd detour); `fallback` = OSRM failed. They are different
        # things and must not be conflated, so a direct line is never a
        # fallback and is always exactly one straight segment.
        direct = ln["direct"]
        if not isinstance(direct, bool):
            errs.append(f"{label}: direct must be a boolean")
            direct = False

        if not isinstance(ln["fallback"], bool):
            errs.append(f"{label}: fallback must be a boolean")
        else:
            if ln["fallback"]:
                fallbacks += 1
            if ln["fallback"] and direct:
                errs.append(f"{label}: a direct line cannot also be a fallback")

        line = ln["coordinates"]
        if not (isinstance(line, list) and len(line) >= 2):
            errs.append(f"{label}: coordinates must be a list of >= 2 [lng, lat] points")
            continue
        if direct and len(line) != 2:
            errs.append(f"{label}: a direct line must be exactly 2 coordinates, "
                        f"got {len(line)}")
        for j, pt in enumerate(line):
            check_coords(errs, f"{label}.coordinates[{j}]", pt)

    # A substation with no line is a pin the grid does not reach: the overlay
    # would draw it lit up and connected to nothing.
    orphans = sorted(known - connected)
    if orphans:
        errs.append(f"{ctx}: {len(orphans)} facilit(ies)/node(s) carry no line: {orphans}")

    if len(lines) != POWER_LINE_COUNT:
        errs.append(f"{ctx}: {len(lines)} lines, expected exactly {POWER_LINE_COUNT}")
    if fallbacks > POWER_MAX_LINE_FALLBACKS:
        errs.append(
            f"{ctx}: {fallbacks} lines fell back to straight lines "
            f"(> {POWER_MAX_LINE_FALLBACKS}) — OSRM was probably down"
        )


def v_power_facilities(data: object) -> list[str]:
    errs: list[str] = []
    if not require_fields(
        errs, "power-facilities", data,
        ("fetchedAtUtc", "sources", "facts", "facilities", "network"),
    ):
        return errs

    if not isinstance(data["fetchedAtUtc"], str):
        errs.append("power-facilities: fetchedAtUtc must be a string")

    sources = data["sources"]
    if require_fields(errs, "power-facilities.sources", sources, ("name", "operation", "osm")):
        for key in ("name", "operation", "osm"):
            if not (isinstance(sources[key], str) and sources[key]):
                errs.append(f"power-facilities.sources: '{key}' must be a non-empty string")

    # The 2025 figures the panel quotes, straight off CEM's page. Checked for
    # shape and sanity only — the numbers themselves come from upstream.
    facts = data["facts"]
    if require_fields(errs, "power-facilities.facts", facts,
                      ("year", "consumptionGwh", "localSharePct", "importedSharePct",
                       "cemHvSubstations", "hvCableKm")):
        for key in ("year", "cemHvSubstations", "hvCableKm"):
            if not (isinstance(facts[key], int) and not isinstance(facts[key], bool)
                    and facts[key] > 0):
                errs.append(f"power-facilities.facts.{key} must be an int > 0")
        if not (isinstance(facts["consumptionGwh"], (int, float))
                and not isinstance(facts["consumptionGwh"], bool)
                and facts["consumptionGwh"] > 0):
            errs.append("power-facilities.facts.consumptionGwh must be a number > 0")
        shares = [facts["localSharePct"], facts["importedSharePct"]]
        if any(not (isinstance(s, int) and not isinstance(s, bool) and 0 <= s <= 100)
               for s in shares):
            errs.append("power-facilities.facts: the share percentages must be ints in 0..100")
        elif sum(shares) != 100:
            errs.append(
                f"power-facilities.facts: local {shares[0]}% + imported {shares[1]}% "
                "does not add up to 100"
            )

    # Which OSM element each `landmark:` anchor resolved to. Optional metadata:
    # validated when present rather than required.
    anchors = data.get("anchors")
    anchor_keys: set[str] = set()
    if anchors is not None:
        if not isinstance(anchors, dict):
            errs.append("power-facilities.anchors: expected an object")
        else:
            anchor_keys = set(anchors)
            for key, a in anchors.items():
                actx = f"power-facilities.anchors['{key}']"
                if not key.startswith("landmark:"):
                    errs.append(f"{actx}: key must start with 'landmark:'")
                if not require_fields(errs, actx, a, ("osmId", "name", "coordinates")):
                    continue
                for field in ("osmId", "name"):
                    if not (isinstance(a[field], str) and a[field]):
                        errs.append(f"{actx}: {field} must be a non-empty string")
                check_coords(errs, actx, a["coordinates"])

    if not require_nonempty_list(errs, "power-facilities.facilities", data["facilities"]):
        return errs

    facilities = data["facilities"]
    seen_ids: set[str] = set()
    by_type: dict[str, int] = {}
    with_buildings = 0
    approximate_ids: list[str] = []
    for i, f in enumerate(facilities):
        ctx = f"power-facilities.facilities[{i}]"
        if not require_fields(
            errs, ctx, f,
            ("id", "type", "operator", "voltageKv", "name", "coordinates",
             "approximate", "anchor", "source", "osm", "buildings", "details"),
        ):
            continue

        fid = f["id"]
        if not (isinstance(fid, str) and fid):
            errs.append(f"{ctx}: id must be a non-empty string")
        elif fid in seen_ids:
            errs.append(f"{ctx}: duplicate id '{fid}'")
        else:
            seen_ids.add(fid)
        label = f"{ctx} ({fid if isinstance(fid, str) and fid else '?'})"

        ftype = f["type"]
        if ftype not in POWER_FACILITY_TYPES:
            errs.append(f"{label}: type '{ftype}' invalid")
        else:
            by_type[ftype] = by_type.get(ftype, 0) + 1

        if f["operator"] not in POWER_OPERATORS:
            errs.append(f"{label}: operator '{f['operator']}' invalid")
        if f["source"] not in POWER_PROVENANCE:
            errs.append(f"{label}: source '{f['source']}' invalid")

        # A substation's voltage is its level; generation carries none. The two
        # must agree, or the UI colours and sizes the wrong thing.
        kv = f["voltageKv"]
        expected_kv = POWER_TYPE_VOLTAGE.get(ftype) if ftype in POWER_FACILITY_TYPES else None
        if expected_kv is None:
            if kv is not None:
                errs.append(f"{label}: voltageKv must be null for a '{ftype}'")
        elif kv != expected_kv:
            errs.append(f"{label}: voltageKv {kv!r} does not match type '{ftype}' "
                        f"(expected {expected_kv})")

        name = f["name"]
        if require_fields(errs, f"{label}.name", name, ("zh", "en", "pt")):
            for lang in ("zh", "en"):
                if not (isinstance(name[lang], str) and name[lang]):
                    errs.append(f"{label}.name.{lang} must be a non-empty string")
            # OSM has no `name:pt` for several stations; rather than ship
            # invented translations the pipeline leaves `pt` empty and the UI
            # falls back pt → en → zh.
            if not isinstance(name["pt"], str):
                errs.append(f"{label}.name.pt must be a string")

        check_coords(errs, label, f["coordinates"])

        approximate = f["approximate"]
        if not isinstance(approximate, bool):
            errs.append(f"{label}: approximate must be a boolean")
        elif approximate:
            approximate_ids.append(fid if isinstance(fid, str) else "?")

        anchor = f["anchor"]
        if anchor is None:
            if approximate is True:
                errs.append(f"{label}: approximate facilities need an anchor")
        elif not (isinstance(anchor, str) and anchor):
            errs.append(f"{label}: anchor must be null or a non-empty string")
        elif approximate is False:
            errs.append(f"{label}: exact facilities must have anchor null")
        elif anchor_keys and anchor not in anchor_keys:
            errs.append(f"{label}: anchor '{anchor}' is not in `anchors`")

        if not isinstance(f["osm"], list):
            errs.append(f"{label}.osm must be a list")
        else:
            for j, o in enumerate(f["osm"]):
                if not (isinstance(o, str) and o):
                    errs.append(f"{label}.osm[{j}] must be a non-empty string")
            if approximate is False and not f["osm"]:
                errs.append(f"{label}: an exact facility must cite at least one OSM id")
            if approximate is True and f["osm"]:
                errs.append(f"{label}: an approximate facility must cite no OSM id")

        if not (f["details"] is None or isinstance(f["details"], dict)):
            errs.append(f"{label}.details must be null or an object")
        elif ftype == "plant":
            if not require_fields(errs, f"{label}.details", f["details"],
                                  ("capacityMw", "unitsZh", "unitsEn", "unitsPt")):
                pass
            else:
                if not (isinstance(f["details"]["capacityMw"], (int, float))
                        and not isinstance(f["details"]["capacityMw"], bool)
                        and f["details"]["capacityMw"] > 0):
                    errs.append(f"{label}.details.capacityMw must be a number > 0")
                for lang in ("unitsZh", "unitsEn", "unitsPt"):
                    if not (isinstance(f["details"][lang], str) and f["details"][lang]):
                        errs.append(f"{label}.details.{lang} must be a non-empty string")

        buildings = f["buildings"]
        if not isinstance(buildings, list):
            errs.append(f"{label}.buildings must be a list")
        else:
            if buildings:
                with_buildings += 1
            for j, b in enumerate(buildings):
                check_footprint_building(errs, f"{label}.buildings[{j}]", b,
                                         kinds=POWER_BUILDING_KINDS)

    if len(facilities) != POWER_FACILITY_COUNT:
        errs.append(
            f"power-facilities: {len(facilities)} facilities, expected exactly "
            f"{POWER_FACILITY_COUNT}"
        )
    substations = sum(by_type.get(t, 0) for t in POWER_TYPE_VOLTAGE)
    if substations != POWER_SUBSTATION_COUNT:
        errs.append(
            f"power-facilities: {substations} substations, expected exactly "
            f"{POWER_SUBSTATION_COUNT}"
        )
    for t in ("plant", "incinerator"):
        if by_type.get(t, 0) != 1:
            errs.append(f"power-facilities: {by_type.get(t, 0)} '{t}' facilities, expected 1")
    if with_buildings < POWER_MIN_WITH_BUILDINGS:
        errs.append(
            f"power-facilities: only {with_buildings} facilities have buildings "
            f"(< {POWER_MIN_WITH_BUILDINGS}) — looks like a degenerate run"
        )
    if len(approximate_ids) > POWER_MAX_APPROXIMATE:
        errs.append(
            f"power-facilities: {len(approximate_ids)} approximate facilities "
            f"(> {POWER_MAX_APPROXIMATE}) — the OSM name match probably regressed: "
            f"{approximate_ids}"
        )

    v_power_network(errs, data["network"], seen_ids)

    return errs


# Bilingual (zh/en/pt) name, {zh,pt}-or-null address: IAM refuse rooms have no
# address upstream; IAM compactors and every DSPA type always carry one (even
# when zh/pt individually come back "" — that's real upstream data, not a
# scrape failure). `upstreamStatus` is DSPA's own undocumented status code,
# stored raw and NEVER derived from `closed` (see fetch_waste.py's docstring).
# `refuse_station` (round 2) is IAM's own site id, not derived like the other
# two IAM types — see fetch_waste.py's build_refuse_station().
# `glass`/`clothing` (round 3) come from a third, unrelated IAM feed
# (facility_c.json, no APPCODE) and are the only two types where `closed` is
# derived from a date window (suspendStartDate/suspendEndDate span today)
# rather than a tempClose/status flag — see fetch_waste.py's
# build_iam_map_sites().
WASTE_TYPES = {
    "refuse_room", "refuse_station", "compactor", "smart_machine", "three_colour",
    "e_waste", "lamp_battery", "glass", "clothing",
}
# Degenerate-fetch guards mirroring fetch_waste.py's own floors: ~1,157 sites
# total (114 + 42 + 140 + 67 + 311 + 56 + 406 + 5 + 16 as of 2026-09). Round 3's
# glass/clothing recycling points are genuinely rare upstream (not a scrape
# failure), so the per-type floor is a table rather than one constant.
WASTE_MIN_TOTAL = 800
WASTE_MIN_PER_TYPE_DEFAULT = 20
WASTE_MIN_PER_TYPE = {"glass": 3, "clothing": 8}
# lamp_battery cites both the lightBulb and battery datasets (identical
# lists, one type) alongside the other five, one dataset each; round 2 adds
# one more (iam-refuse-station); round 3 adds two more (iam-map-glass,
# iam-map-clothing).
WASTE_SOURCE_COUNT = 10

# Round 2: treatment facilities, eco stations, incinerator stats.
WASTE_FACILITY_KINDS = {"hazardous", "landfill"}
WASTE_FACILITY_COUNT = 3
WASTE_ECO_STATION_COUNT = 10
WASTE_PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
WASTE_INCINERATOR_MAX_MONTHS = 12


def v_waste_facilities(errs: list[str], facilities: object) -> None:
    """`waste.facilities[]`: the hazardous-waste station + two OSM landfill
    polygons (spec-waste-round2.md §2). `polygon` is null (marker-only) or a
    single ring — reuses check_building_ring, which isn't building-specific."""
    if not require_nonempty_list(errs, "waste.facilities", facilities):
        return
    seen_ids: set[str] = set()
    for i, fac in enumerate(facilities):
        ctx = f"waste.facilities[{i}]"
        if not require_fields(
            errs, ctx, fac,
            ("id", "kind", "name", "coordinates", "approximate", "polygon", "note", "source", "osm"),
        ):
            continue
        fid = fac["id"]
        if not (isinstance(fid, str) and fid):
            errs.append(f"{ctx}: id must be a non-empty string")
        elif fid in seen_ids:
            errs.append(f"{ctx}: duplicate id '{fid}'")
        else:
            seen_ids.add(fid)
        label = f"{ctx} ({fid if isinstance(fid, str) and fid else '?'})"

        if fac["kind"] not in WASTE_FACILITY_KINDS:
            errs.append(f"{label}: kind '{fac['kind']}' invalid")

        name = fac["name"]
        if require_fields(errs, f"{label}.name", name, ("zh", "en", "pt")):
            for lang in ("zh", "en", "pt"):
                if not (isinstance(name[lang], str) and name[lang]):
                    errs.append(f"{label}.name.{lang} must be a non-empty string")

        check_coords(errs, label, fac["coordinates"])

        if not isinstance(fac["approximate"], bool):
            errs.append(f"{label}: approximate must be a boolean")

        polygon = fac["polygon"]
        if polygon is not None:
            check_building_ring(errs, f"{label}.polygon", polygon)

        note = fac["note"]
        if require_fields(errs, f"{label}.note", note, ("zh", "en", "pt")):
            for lang in ("zh", "en", "pt"):
                if not (isinstance(note[lang], str) and note[lang]):
                    errs.append(f"{label}.note.{lang} must be a non-empty string")

        source = fac["source"]
        if require_fields(errs, f"{label}.source", source, ("name", "url")):
            for key in ("name", "url"):
                if not (isinstance(source[key], str) and source[key]):
                    errs.append(f"{label}.source.{key} must be a non-empty string")

        osm = fac["osm"]
        if not (isinstance(osm, list) and all(isinstance(o, str) and o for o in osm)):
            errs.append(f"{label}.osm must be a list of non-empty strings")

    if len(facilities) != WASTE_FACILITY_COUNT:
        errs.append(f"waste.facilities: {len(facilities)} facilities, expected exactly {WASTE_FACILITY_COUNT}")


def v_waste_eco_stations(errs: list[str], stations: object) -> None:
    """`waste.ecoStations[]`: DSPA's 環保加Fun站, hand-transcribed (no open
    dataset) — spec-waste-round2.md §3."""
    if not require_nonempty_list(errs, "waste.ecoStations", stations):
        return
    seen_ids: set[str] = set()
    for i, e in enumerate(stations):
        ctx = f"waste.ecoStations[{i}]"
        if not require_fields(
            errs, ctx, e,
            ("id", "name", "address", "coordinates", "approximate", "hours", "accepts", "since", "source"),
        ):
            continue
        eid = e["id"]
        if not (isinstance(eid, str) and eid):
            errs.append(f"{ctx}: id must be a non-empty string")
        elif eid in seen_ids:
            errs.append(f"{ctx}: duplicate id '{eid}'")
        else:
            seen_ids.add(eid)
        label = f"{ctx} ({eid if isinstance(eid, str) and eid else '?'})"

        name = e["name"]
        if require_fields(errs, f"{label}.name", name, ("zh", "en", "pt")):
            for lang in ("zh", "en", "pt"):
                if not (isinstance(name[lang], str) and name[lang]):
                    errs.append(f"{label}.name.{lang} must be a non-empty string")

        address = e["address"]
        if require_fields(errs, f"{label}.address", address, ("zh", "pt")):
            if not (isinstance(address["zh"], str) and address["zh"]):
                errs.append(f"{label}.address.zh must be a non-empty string")
            if not isinstance(address["pt"], str):
                errs.append(f"{label}.address.pt must be a string")

        check_coords(errs, label, e["coordinates"])

        if not isinstance(e["approximate"], bool):
            errs.append(f"{label}: approximate must be a boolean")

        hours = e["hours"]
        if require_fields(errs, f"{label}.hours", hours, ("zh", "en", "pt")):
            for lang in ("zh", "en", "pt"):
                if not (isinstance(hours[lang], str) and hours[lang]):
                    errs.append(f"{label}.hours.{lang} must be a non-empty string")

        accepts = e["accepts"]
        if require_fields(errs, f"{label}.accepts", accepts, ("zh", "en", "pt")):
            for lang in ("zh", "en", "pt"):
                if not (isinstance(accepts[lang], str) and accepts[lang]):
                    errs.append(f"{label}.accepts.{lang} must be a non-empty string")

        since = e["since"]
        if not (isinstance(since, int) and not isinstance(since, bool) and 2000 <= since <= 2100):
            errs.append(f"{label}: since must be a plausible year (int)")

        source = e["source"]
        if require_fields(errs, f"{label}.source", source, ("name", "url")):
            for key in ("name", "url"):
                if not (isinstance(source[key], str) and source[key]):
                    errs.append(f"{label}.source.{key} must be a non-empty string")

    if len(stations) != WASTE_ECO_STATION_COUNT:
        errs.append(f"waste.ecoStations: {len(stations)} entries, expected exactly {WASTE_ECO_STATION_COUNT}")


def v_waste_incinerator(errs: list[str], incinerator: object) -> None:
    """`waste.incinerator`: null (best-effort fetch failed) or DSPA's monthly
    stats + hand-typed facts — spec-waste-round2.md §4."""
    if incinerator is None:
        return
    ctx = "waste.incinerator"
    if not require_fields(errs, ctx, incinerator, ("datasetId", "url", "latest", "months", "facts")):
        return

    if not (isinstance(incinerator["datasetId"], str) and incinerator["datasetId"]):
        errs.append(f"{ctx}.datasetId must be a non-empty string")
    if not (isinstance(incinerator["url"], str) and incinerator["url"]):
        errs.append(f"{ctx}.url must be a non-empty string")

    def check_month(mctx: str, m: object) -> bool:
        if not require_fields(errs, mctx, m, ("period", "receivedT", "electricityMwh", "metalRecycledT")):
            return False
        ok = True
        if not (isinstance(m["period"], str) and WASTE_PERIOD_RE.match(m["period"])):
            errs.append(f"{mctx}.period must be 'YYYY-MM'")
            ok = False
        for key in ("receivedT", "electricityMwh", "metalRecycledT"):
            v = m[key]
            if not (isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0):
                errs.append(f"{mctx}.{key} must be a number >= 0")
        return ok

    latest_ok = check_month(f"{ctx}.latest", incinerator["latest"])

    months = incinerator["months"]
    if not require_nonempty_list(errs, f"{ctx}.months", months):
        months = []
    else:
        for i, m in enumerate(months):
            check_month(f"{ctx}.months[{i}]", m)
        if len(months) > WASTE_INCINERATOR_MAX_MONTHS:
            errs.append(f"{ctx}.months: {len(months)} entries, expected at most {WASTE_INCINERATOR_MAX_MONTHS}")
        periods = [m.get("period") for m in months if isinstance(m, dict)]
        if periods != sorted(periods):
            errs.append(f"{ctx}.months: periods must be in ascending order")
        if (
            latest_ok
            and months
            and isinstance(months[-1], dict)
            and incinerator["latest"].get("period") != months[-1].get("period")
        ):
            errs.append(f"{ctx}.latest.period must match the last entry of months")

    facts = incinerator["facts"]
    if require_fields(errs, f"{ctx}.facts", facts, ("phases", "lines", "capacityTPerDay", "generationMw", "areaM2")):
        phases = facts["phases"]
        if not (
            isinstance(phases, list) and phases
            and all(isinstance(p, int) and not isinstance(p, bool) for p in phases)
        ):
            errs.append(f"{ctx}.facts.phases must be a non-empty list of ints")
        for key in ("lines", "capacityTPerDay", "areaM2"):
            if not (isinstance(facts[key], int) and not isinstance(facts[key], bool) and facts[key] > 0):
                errs.append(f"{ctx}.facts.{key} must be an int > 0")
        gen = facts["generationMw"]
        if not (isinstance(gen, (int, float)) and not isinstance(gen, bool) and gen > 0):
            errs.append(f"{ctx}.facts.generationMw must be a number > 0")


def v_waste(data: object) -> list[str]:
    errs: list[str] = []
    if not require_fields(
        errs, "waste", data,
        ("fetchedAtUtc", "sources", "counts", "sites", "facilities", "ecoStations", "incinerator"),
    ):
        return errs
    if not isinstance(data["fetchedAtUtc"], str):
        errs.append("waste: fetchedAtUtc must be a string")

    sources = data["sources"]
    if not (isinstance(sources, list) and sources):
        errs.append("waste.sources: expected a non-empty array")
        sources = []
    for i, s in enumerate(sources):
        ctx = f"waste.sources[{i}]"
        if not require_fields(
            errs, ctx, s, ("id", "type", "datasetId", "name", "url", "upstreamUpdatedAt", "count")
        ):
            continue
        if not (isinstance(s["id"], str) and s["id"]):
            errs.append(f"{ctx}: id must be a non-empty string")
        if s["type"] not in WASTE_TYPES:
            errs.append(f"{ctx}: type '{s['type']}' invalid")
        if not (isinstance(s["datasetId"], str) and s["datasetId"]):
            errs.append(f"{ctx}: datasetId must be a non-empty string")
        if not (isinstance(s["url"], str) and s["url"]):
            errs.append(f"{ctx}: url must be a non-empty string")
        if not (s["upstreamUpdatedAt"] is None or isinstance(s["upstreamUpdatedAt"], str)):
            errs.append(f"{ctx}: upstreamUpdatedAt must be null or a string")
        if not (isinstance(s["count"], int) and not isinstance(s["count"], bool) and s["count"] >= 0):
            errs.append(f"{ctx}: count must be an int >= 0")
    if len(sources) != WASTE_SOURCE_COUNT:
        errs.append(f"waste: {len(sources)} sources, expected exactly {WASTE_SOURCE_COUNT}")

    counts = data["counts"]
    if not isinstance(counts, dict):
        errs.append("waste.counts: expected an object")
        counts = {}

    if not require_nonempty_list(errs, "waste.sites", data["sites"]):
        return errs

    seen_ids: set[str] = set()
    tally: dict[str, int] = {}
    for i, s in enumerate(data["sites"]):
        ctx = f"waste.sites[{i}]"
        if not require_fields(
            errs, ctx, s,
            ("id", "type", "name", "address", "coordinates", "closed", "tel", "photo", "upstreamStatus"),
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

        if s["type"] not in WASTE_TYPES:
            errs.append(f"{label}: type '{s['type']}' invalid")
        else:
            tally[s["type"]] = tally.get(s["type"], 0) + 1

        name = s["name"]
        if require_fields(errs, f"{label}.name", name, ("zh", "en", "pt")):
            if not (isinstance(name["zh"], str) and name["zh"]):
                errs.append(f"{label}.name.zh must be a non-empty string")
            for lang in ("en", "pt"):
                if not isinstance(name[lang], str):
                    errs.append(f"{label}.name.{lang} must be a string")

        address = s["address"]
        if address is not None:
            if require_fields(errs, f"{label}.address", address, ("zh", "pt")):
                for lang in ("zh", "pt"):
                    if not isinstance(address[lang], str):
                        errs.append(f"{label}.address.{lang} must be a string")

        check_coords(errs, label, s["coordinates"])

        if not isinstance(s["closed"], bool):
            errs.append(f"{label}: closed must be a boolean")

        tel = s["tel"]
        if not (tel is None or isinstance(tel, str)):
            errs.append(f"{label}: tel must be null or a string")

        photo = s["photo"]
        if not (photo is None or (isinstance(photo, str) and photo.startswith("https"))):
            errs.append(f"{label}: photo must be null or an https URL")

        status = s["upstreamStatus"]
        if not (status is None or (isinstance(status, int) and not isinstance(status, bool))):
            errs.append(f"{label}: upstreamStatus must be null or an int")

    total = len(data["sites"])
    if total < WASTE_MIN_TOTAL:
        errs.append(f"waste: only {total} sites (< {WASTE_MIN_TOTAL}) — looks like a degenerate run")

    for t in WASTE_TYPES:
        n = tally.get(t, 0)
        floor = WASTE_MIN_PER_TYPE.get(t, WASTE_MIN_PER_TYPE_DEFAULT)
        if n < floor:
            errs.append(f"waste: only {n} sites of type '{t}' (< {floor})")

    for t, n in counts.items():
        if not (isinstance(n, int) and not isinstance(n, bool) and n >= 0):
            errs.append(f"waste.counts.{t} must be an int >= 0")
        elif tally.get(t, 0) != n:
            errs.append(f"waste.counts.{t} says {n} but {tally.get(t, 0)} sites have type '{t}'")
    for t in WASTE_TYPES:
        if t not in counts:
            errs.append(f"waste.counts: missing type '{t}'")

    v_waste_facilities(errs, data["facilities"])
    v_waste_eco_stations(errs, data["ecoStations"])
    v_waste_incinerator(errs, data["incinerator"])

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
    "water-facilities": (PUBLIC / "data/water-facilities.json", v_water_facilities),
    "water-distribution": (PUBLIC / "data/water-distribution.json", v_water_distribution),
    "power-facilities": (PUBLIC / "data/power-facilities.json", v_power_facilities),
    "power-distribution": (PUBLIC / "data/power-distribution.json", v_power_distribution),
    "toilets": (PUBLIC / "data/toilets.json", v_toilets),
    "car-parks": (PUBLIC / "data/car-parks.json", v_car_parks),
    "waste": (PUBLIC / "data/waste.json", v_waste),
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
