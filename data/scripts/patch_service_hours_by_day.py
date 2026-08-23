"""
Rewrite bus-routes.json service hours with:
  - serviceHoursStart / serviceHoursEnd       -> weekday/default window
  - serviceHoursStartSat / serviceHoursEndSat -> Saturday window
  - serviceHoursStartSun / serviceHoursEndSun -> Sunday window

Values are fractional hours (e.g. 01:15 -> 1.25, 05:45 -> 5.75). End hour
may exceed 24 if service crosses midnight (e.g. ends 01:15 -> 25.25).
If a bucket is explicitly "不設服務", both fields are written as null so the
browser can distinguish "no service" from "unknown".

Period-to-bucket mapping matches how motransportinfo.com presents schedules:
  Weekday bucket: "星期一至六…", "星期一至五…", "每日"
  Saturday bucket: "星期一至六…", "星期六…", "星期六、日…", "每日"
  Sunday bucket  : "星期日及公眾假期", "星期六、日…", "每日"
"""

import json
from pathlib import Path
from typing import Literal

REFERENCE = Path(__file__).parent.parent / "bus_reference" / "routes.json"
TARGET = Path(__file__).parent.parent.parent / "public" / "data" / "bus-routes.json"
NO_SERVICE: Literal["no_service"] = "no_service"


def hm_to_hours(hm: str) -> float:
    h, m = map(int, hm.split(":"))
    return h + m / 60.0


def period_buckets(period: str) -> tuple[bool, bool, bool]:
    """Return (matches_weekday, matches_sat, matches_sun)."""
    p = period or ""
    is_weekday = (
        "星期一至六" in p
        or "星期一至五" in p
        or p == "每日"
    )
    is_sat = (
        "星期一至六" in p
        or ("星期六" in p and "日" not in p)
        or "星期六、日" in p
        or p == "每日"
    )
    is_sun = (
        "星期日及公眾假期" in p
        or "星期六、日" in p
        or p == "每日"
    )
    return is_weekday, is_sat, is_sun


def window_for(schedule: list[dict], bucket: Literal["weekday", "sat", "sun"]) -> tuple[float, float] | Literal["no_service"] | None:
    """Earliest start / latest end across all entries matching the bucket."""
    starts = []
    ends = []
    saw_match = False
    saw_no_service = False
    for e in schedule:
        is_weekday, is_sat, is_sun = period_buckets(e.get("period", ""))
        matches = {
            "weekday": is_weekday,
            "sat": is_sat,
            "sun": is_sun,
        }[bucket]
        if not matches:
            continue
        saw_match = True
        if e.get("no_service"):
            saw_no_service = True
            continue
        s = hm_to_hours(e["start"])
        en = hm_to_hours(e["end"])
        # Crosses midnight within this band
        if en <= s:
            en += 24.0
        starts.append(s)
        ends.append(en)
    if not starts:
        if saw_match and saw_no_service:
            return NO_SERVICE
        return None
    return min(starts), max(ends)


def run() -> None:
    ref = json.loads(REFERENCE.read_text(encoding="utf-8"))
    target = json.loads(TARGET.read_text(encoding="utf-8"))
    ref_by_id = {r["id"]: r for r in ref}

    patched = 0
    missing = []
    for route in target:
        rid = route["id"]
        r = ref_by_id.get(rid)
        if not r:
            missing.append(rid)
            continue
        sched = r.get("schedule") or []
        if not sched:
            missing.append(rid)
            continue

        weekday = window_for(sched, "weekday")
        sat = window_for(sched, "sat")
        sun = window_for(sched, "sun")
        # Missing day buckets mean no service for that day. Routes that really
        # run on a day have a matching "每日", "星期一至六", or day-specific row.
        if sat is None and weekday is not None:
            sat = NO_SERVICE
        if sun is None and weekday is not None:
            sun = NO_SERVICE
        if weekday is None:
            missing.append(rid)
            continue

        if weekday == NO_SERVICE:
            ms_s = None
            ms_e = None
        else:
            ms_s, ms_e = weekday
        if sat == NO_SERVICE:
            sat_s = None
            sat_e = None
        else:
            sat_s, sat_e = sat  # type: ignore[misc]
        if sun == NO_SERVICE:
            su_s = None
            su_e = None
        else:
            su_s, su_e = sun  # type: ignore[misc]
        new_freq = r.get("avg_freq", route.get("frequency"))

        old = (
            route.get("serviceHoursStart"),
            route.get("serviceHoursEnd"),
            route.get("serviceHoursStartSat"),
            route.get("serviceHoursEndSat"),
            route.get("serviceHoursStartSun"),
            route.get("serviceHoursEndSun"),
            route.get("frequency"),
        )
        new = (ms_s, ms_e, sat_s, sat_e, su_s, su_e, new_freq)
        missing_day_keys = (
            "serviceHoursStartSat" not in route
            or "serviceHoursEndSat" not in route
            or "serviceHoursStartSun" not in route
            or "serviceHoursEndSun" not in route
        )
        if old != new or ((sat == NO_SERVICE or sun == NO_SERVICE) and missing_day_keys):
            print(f"  {rid:<6} {old} -> {new}")
            route["serviceHoursStart"] = ms_s
            route["serviceHoursEnd"] = ms_e
            route["serviceHoursStartSat"] = sat_s
            route["serviceHoursEndSat"] = sat_e
            route["serviceHoursStartSun"] = su_s
            route["serviceHoursEndSun"] = su_e
            if new_freq is not None:
                route["frequency"] = new_freq
            patched += 1

    # Preserve the original compact (minified) layout to keep the diff small.
    TARGET.write_text(
        json.dumps(target, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"\nPatched {patched}/{len(target)} routes.")
    if missing:
        print(f"Missing reference for {len(missing)}: {missing}")


if __name__ == "__main__":
    run()
