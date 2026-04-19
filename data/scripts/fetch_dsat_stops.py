"""
Fetch authoritative per-direction stop lists for every Macau bus route from
the DSAT real-time endpoint (https://bis.dsat.gov.mo).

Output: data/bus_reference/dsat_stops.json, keyed by route id:

  {
    "fetchedAtUtc": "...",
    "routes": {
      "25AX": {
        "forward":  ["M9/5", "M50", "M172/14", "T403", ...],
        "backward": ["C690/2", "C689/2", "T376/2", ...],
        "forwardOk":  true,
        "backwardOk": true
      },
      ...
    }
  }

Notes
-----
* staCode values include a "/N" platform suffix when DSAT distinguishes
  multiple platforms at the same physical station (e.g. "M172/14" vs
  "M172/16"). We preserve the suffix verbatim so the frontend can match
  DSAT realtime responses exactly.
* An empty list for a direction usually means one of:
    1. The route is circular and DSAT only publishes dir=0
       (e.g. route 25: dir=0 = 50-stop loop, dir=1 = []).
    2. The route has no scheduled service today (e.g. 101X outside peak
       hours). In that case BOTH directions may come back empty.
  We store an "ok" flag and let downstream pipelines decide whether to
  fall back to the previous snapshot or to motransportinfo data.
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE_URL = "https://bis.dsat.gov.mo/macauweb/routestation/bus"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Referer": "https://bis.dsat.gov.mo/macauweb/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
}
TIMEOUT = 15
DELAY = 0.2
RETRIES = 2

REFERENCE_DIR = Path(__file__).parent.parent / "bus_reference"
ROUTE_LIST_PATH = REFERENCE_DIR / "route_list.json"
OUTPUT_PATH = REFERENCE_DIR / "dsat_stops.json"


def fetch_direction(route_id: str, direction: int) -> tuple[list[str], bool]:
    """Return (stop_codes, ok).

    ok is False on network/payload errors; empty list with ok=True means
    DSAT legitimately reported no stops for this direction.
    """
    url = f"{BASE_URL}?routeName={route_id}&dir={direction}"
    last_err: Exception | None = None
    for attempt in range(RETRIES + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            payload = r.json()
            if payload.get("header") != "000":
                return [], False
            route_info = payload.get("data", {}).get("routeInfo", []) or []
            return [s.get("staCode", "") for s in route_info if s.get("staCode")], True
        except Exception as e:
            last_err = e
            if attempt < RETRIES:
                time.sleep(0.5 * (attempt + 1))
    print(f"  !! {route_id} dir={direction}  error: {last_err}", file=sys.stderr)
    return [], False


def run() -> int:
    if not ROUTE_LIST_PATH.exists():
        print(f"ERROR: {ROUTE_LIST_PATH} missing", file=sys.stderr)
        return 1
    route_list = json.loads(ROUTE_LIST_PATH.read_text(encoding="utf-8"))

    print(f"Fetching DSAT stops for {len(route_list)} routes...")

    routes_out: dict[str, dict] = {}
    empty_routes: list[str] = []
    for i, r in enumerate(route_list):
        rid = r["id"]
        time.sleep(DELAY)
        fwd, fwd_ok = fetch_direction(rid, 0)
        time.sleep(DELAY)
        bwd, bwd_ok = fetch_direction(rid, 1)

        tag = "circular" if fwd_ok and bwd_ok and bwd == [] and fwd else \
              "empty"    if fwd == [] and bwd == [] else \
              "bidir"
        print(f"  [{i+1}/{len(route_list)}] {rid:>6}  fwd={len(fwd):>3}  bwd={len(bwd):>3}  [{tag}]")
        if tag == "empty":
            empty_routes.append(rid)

        routes_out[rid] = {
            "forward": fwd,
            "backward": bwd,
            "forwardOk": fwd_ok,
            "backwardOk": bwd_ok,
        }

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "totalRoutes": len(route_list),
        "emptyRoutes": empty_routes,
        "routes": routes_out,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nDone. Routes with both directions empty: {len(empty_routes)}")
    if empty_routes:
        print(f"  (likely outside service hours today): {', '.join(empty_routes)}")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
