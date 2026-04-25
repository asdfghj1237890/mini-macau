"""Batch OCR timetable block tiles with geometric row/column clustering.

For each day-group block tile (produced by _crop_helper.py), finds 1-or-2
hour columns and extracts {hour: [minutes]} dicts per direction.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
CROPS = ROOT / "_tmp_crops"
OCR_SCRIPT = ROOT / "_win_ocr.ps1"


def ocr(path: Path) -> str:
    res = subprocess.run(
        ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(OCR_SCRIPT), str(path)],
        capture_output=True,
    )
    return res.stdout.decode("utf-8", errors="replace")


def parse_words(raw: str):
    """Parse raw OCR lines to (x, y, w, h, digits_only_text)."""
    words = []
    for ln in raw.splitlines():
        parts = ln.split("\t", 4)
        if len(parts) < 5:
            continue
        try:
            x, y, w, h = int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])
        except ValueError:
            continue
        digits = re.sub(r"\D", "", parts[4])
        if not digits:
            continue
        words.append((x, y, w, h, digits))
    return words


def _normalize_wrapped(seq):
    """Given a sorted-by-y list of (yc, v), repair single-digit wraps.

    Windows OCR sometimes reads "10" as "0", "11" as "1" (the leading "1"
    is dropped). When the value drops by > 3 between consecutive items, add
    10 to the offset; this recovers 10-19 → 0-9 and 20-23 → 0-3.
    """
    out = []
    offset = 0
    prev_raw = None
    for yc, v in seq:
        if prev_raw is not None and v < prev_raw - 3:
            offset += 10
        out.append((yc, v + offset))
        prev_raw = v
    return out


def find_hour_columns(words):
    """Detect all hour-column x-ranges in a block tile.

    Returns a sorted list of (x_min, x_max, hour_labels) where hour_labels is
    a list of (y_center, value) sorted by y.
    """
    candidates = []  # (x, yc, value)
    for x, y, w, h, digits in words:
        if len(digits) > 2:
            continue
        try:
            v = int(digits)
        except ValueError:
            continue
        # Accept 0-9 (possibly wrapped single-digit) and 10-23
        if 0 <= v <= 23:
            candidates.append((x, y + h / 2, v))
    if not candidates:
        return []
    # Cluster by x (within 80 px)
    candidates.sort()
    clusters = []
    for c in candidates:
        if clusters and c[0] - clusters[-1][-1][0] < 80:
            clusters[-1].append(c)
        else:
            clusters.append([c])
    # Keep clusters whose LIS (by y) spans a real hour range.
    cols = []
    for cluster in clusters:
        by_y = sorted(cluster, key=lambda t: t[1])
        yv_raw = [(yc, v) for _, yc, v in by_y]
        yv_normalized = _normalize_wrapped(yv_raw)
        # LIS with backtracking: find longest strictly increasing subseq by value
        n = len(yv_normalized)
        if n == 0:
            continue
        dp = [1] * n
        prev_idx = [-1] * n
        for i in range(1, n):
            for j in range(i):
                if yv_normalized[j][1] < yv_normalized[i][1] and dp[j] + 1 > dp[i]:
                    dp[i] = dp[j] + 1
                    prev_idx[i] = j
        end = max(range(n), key=lambda i: dp[i])
        path = []
        while end != -1:
            path.append(yv_normalized[end])
            end = prev_idx[end]
        path.reverse()
        if len(path) < 10:
            continue
        span = path[-1][1] - path[0][1]
        if span < 12:
            continue
        if len(path) >= 3:
            diffs = [path[i + 1][0] - path[i][0] for i in range(len(path) - 1)]
            import statistics
            med = statistics.median(diffs)
            if med < 80 or med > 400:
                continue
        x_min = min(c[0] for c in cluster)
        x_max = max(c[0] for c in cluster)
        cols.append((x_min, x_max + 100, path))
    cols.sort(key=lambda c: c[0])
    return cols


def extract_hour_dict_for_col(words, col_x_min, col_x_max, hours, next_col_x_min):
    """Given hour labels for one column and x-bound of next column, extract minutes."""
    mins = []  # (yc, x, digits)
    for x, y, w, h, digits in words:
        yc = y + h / 2
        if len(digits) < 2:
            continue
        # Minutes: right of THIS hour column, left of NEXT hour column
        if x >= col_x_max and x < next_col_x_min:
            mins.append((yc, x, digits))

    if len(hours) > 1:
        row_h = min(hours[i + 1][0] - hours[i][0] for i in range(len(hours) - 1))
    else:
        row_h = 180

    out = {}
    for i, (yc, H) in enumerate(hours):
        y_top = yc - row_h if i == 0 else (hours[i - 1][0] + yc) / 2
        y_bot = yc + row_h if i == len(hours) - 1 else (hours[i + 1][0] + yc) / 2
        band = [(y, x, d) for y, x, d in mins if y_top <= y < y_bot]
        band.sort(key=lambda t: t[0])
        sublines = []
        for t in band:
            if sublines and abs(t[0] - sublines[-1][0][0]) < 30:
                sublines[-1].append(t)
            else:
                sublines.append([t])
        all_digits = ""
        for sl in sublines:
            sl.sort(key=lambda t: t[1])
            for _, _, d in sl:
                all_digits += d
        if len(all_digits) % 2 != 0:
            all_digits = all_digits[:-1]
        pairs = [int(all_digits[j : j + 2]) for j in range(0, len(all_digits), 2)]
        pairs = [p for p in pairs if 0 <= p <= 59]
        cleaned = []
        for p in pairs:
            if not cleaned or p > cleaned[-1]:
                cleaned.append(p)
        out[H] = cleaned
    return out


def ocr_block(path: Path):
    """OCR a block tile, returning list of {hour: [mins]} per direction column."""
    raw = ocr(path)
    words = parse_words(raw)
    cols = find_hour_columns(words)
    results = []
    for i, (x_min, x_max, hours) in enumerate(cols):
        next_x = cols[i + 1][0] if i + 1 < len(cols) else 1_000_000
        d = extract_hour_dict_for_col(words, x_min, x_max, hours, next_x)
        results.append(d)
    return results


def format_dict(d):
    lines = []
    for h in sorted(d.keys()):
        mins_str = ", ".join(f"{m}" for m in d[h])
        lines.append(f"    {h}:  [{mins_str}],")
    return "{\n" + "\n".join(lines) + "\n}"


def run_label(label: str, directions: list[str], schedules=None):
    """Run OCR on all blocks for a label.

    directions: list of direction names to assign to the detected hour columns,
      e.g. ["barra", "tft"] for intermediate (2-col), or ["fwd"] for single-col.
    """
    schedules = schedules or ["mon_thu", "fri", "ssh"]
    for sched in schedules:
        path = CROPS / f"{label}_{sched}_block.png"
        if not path.exists():
            print(f"# MISSING: {path}")
            continue
        results = ocr_block(path)
        for dir_name, result in zip(directions, results):
            print(f"# {label} {sched} {dir_name}")
            print(format_dict(result))
            print()
        # If more columns detected than directions provided, dump extras
        for extra_i in range(len(directions), len(results)):
            print(f"# {label} {sched} EXTRA_COL_{extra_i}")
            print(format_dict(results[extra_i]))
            print()


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "i":
        label = sys.argv[2]
        scheds = sys.argv[3].split(",") if len(sys.argv) > 3 else None
        run_label(label, ["barra", "tft"], scheds)
    elif mode == "t":
        label = sys.argv[2]
        dir_name = sys.argv[3] if len(sys.argv) > 3 else "fwd"
        scheds = sys.argv[4].split(",") if len(sys.argv) > 4 else None
        run_label(label, [dir_name], scheds)
    elif mode == "test":
        path = Path(sys.argv[2])
        results = ocr_block(path)
        for i, d in enumerate(results):
            print(f"# column {i}")
            print(format_dict(d))
            print()
