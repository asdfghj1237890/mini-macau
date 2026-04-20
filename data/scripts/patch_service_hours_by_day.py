"""
Rewrite bus-routes.json service hours with:
  - serviceHoursStart / serviceHoursEnd       -> Mon-Sat window
  - serviceHoursStartSun / serviceHoursEndSun -> Sun + public-holiday window

Values are fractional hours (e.g. 01:15 -> 1.25, 05:45 -> 5.75). End hour
may exceed 24 if service crosses midnight (e.g. ends 01:15 -> 25.25).

Period-to-bucket mapping matches how motransportinfo.com presents schedules:
  Mon-Sat bucket: "星期一至六…", "星期一至五…", "星期六…", "星期六、日…", "每日"
  Sun+PH bucket : "星期日及公眾假期",            "星期六、日…", "每日"
"""

import json
from pathlib import Path

REFERENCE = Path(__file__).parent.parent / "bus_reference" / "routes.json"
TARGET = Path(__file__).parent.parent.parent / "public" / "data" / "bus-routes.json"


def hm_to_hours(hm: str) -> float:
    h, m = map(int, hm.split(":"))
    return h + m / 60.0


def period_buckets(period: str) -> tuple[bool, bool]:
    """Return (matches_monsat, matches_sun)."""
    p = period or ""
    is_monsat = (
        "星期一至六" in p
        or "星期一至五" in p
        or ("星期六" in p and "日" not in p)
        or "星期六、日" in p
        or p == "每日"
    )
    is_sun = (
        "星期日及公眾假期" in p
        or "星期六、日" in p
        or p == "每日"
    )
    return is_monsat, is_sun


def window_for(schedule: list[dict], want_monsat: bool) -> tuple[float, float] | None:
    """Earliest start / latest end across all entries matching the bucket."""
    starts = []
    ends = []
    for e in schedule:
        is_monsat, is_sun = period_buckets(e.get("period", ""))
        if want_monsat and not is_monsat:
            continue
        if not want_monsat and not is_sun:
            continue
        s = hm_to_hours(e["start"])
        en = hm_to_hours(e["end"])
        # Crosses midnight within this band
        if en <= s:
            en += 24.0
        starts.append(s)
        ends.append(en)
    if not starts:
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

        monsat = window_for(sched, True)
        sun = window_for(sched, False)
        # Fall back: if one bucket is missing, copy the other so spawn logic
        # always has a valid window. This happens mostly for "每日" night
        # buses that we already put in both anyway.
        if monsat is None and sun is not None:
            monsat = sun
        if sun is None and monsat is not None:
            sun = monsat
        if monsat is None:
            missing.append(rid)
            continue

        ms_s, ms_e = monsat
        su_s, su_e = sun  # type: ignore[misc]

        old = (
            route.get("serviceHoursStart"),
            route.get("serviceHoursEnd"),
            route.get("serviceHoursStartSun"),
            route.get("serviceHoursEndSun"),
        )
        new = (ms_s, ms_e, su_s, su_e)
        if old != new:
            print(f"  {rid:<6} {old} -> {new}")
            route["serviceHoursStart"] = ms_s
            route["serviceHoursEnd"] = ms_e
            route["serviceHoursStartSun"] = su_s
            route["serviceHoursEndSun"] = su_e
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
