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

# repo/data/scripts/validate_output.py -> repo/public
PUBLIC = Path(__file__).resolve().parents[2] / "public"

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


def v_lrt_lines(data: object) -> list[str]:
    errs: list[str] = []
    if not require_nonempty_list(errs, "lrt-lines", data):
        return errs
    station_ids = load_station_ids(errs, "lrt-lines")
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
    return errs


def load_station_ids(errs: list[str], name: str) -> set[str] | None:
    """Station ids from stations.json for cross-file checks; None if unreadable.

    The SEO renderer silently drops station ids it can't resolve, so a dangling
    reference must fail here at the gate — an unreadable stations.json is an
    error too, not a reason to skip the check.
    """
    path = PUBLIC / "data/stations.json"
    try:
        stations = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        errs.append(f"{name}: cannot read stations.json for station-id cross-check — {e}")
        return None
    if not isinstance(stations, list):
        errs.append(f"{name}: stations.json is not a list — cannot cross-check station ids")
        return None
    return {s["id"] for s in stations if isinstance(s, dict) and "id" in s}


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
    seen: set[str] = set()
    for i, r in enumerate(data):
        ctx = f"bus-routes[{i}]"
        if not require_fields(
            errs, ctx, r,
            ("id", "name", "color", "stopsForward", "stopsBackward", "geometry",
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
        for key in ("serviceHoursStart", "serviceHoursEnd", "frequency"):
            if not isinstance(r[key], (int, float)):
                errs.append(f"{ctx} ({rid}): {key} must be numeric")
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


# name -> (path relative to public/, validator)
DATASETS: dict[str, tuple[str, object]] = {
    "lrt-lines": ("data/lrt-lines.json", v_lrt_lines),
    "stations": ("data/stations.json", v_stations),
    "trips-mon_thu": ("data/trips-mon_thu.json", v_trips),
    "trips-friday": ("data/trips-friday.json", v_trips),
    "trips-sat_sun": ("data/trips-sat_sun.json", v_trips),
    "bus-routes": ("data/bus-routes.json", v_bus_routes),
    "bus-stops": ("data/bus-stops.json", v_bus_stops),
    "flights": ("data/flights.json", v_flights),
    "flights-timetable": ("data/flights-timetable.json", v_flights_timetable),
    "ferries": ("data/ferry-schedules.json", v_ferries),
    "service-status": ("service-status.json", v_service_status),
}

# Convenience aliases for the names the trips loader / workflows use.
ALIASES = {"trips": ["trips-mon_thu", "trips-friday", "trips-sat_sun"]}


def validate_one(name: str) -> list[str]:
    rel, validator = DATASETS[name]
    path = PUBLIC / rel
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
