"""Parse timetable_verified/<STATION>.md into the per-station departure dicts
and (dry-run) compare against the literals currently in generate_timetable.py.

Run with `--write` to rewrite the dict literals in generate_timetable.py from
the .md files (the .md files are the human-verified source of truth).
"""
import re, sys, importlib.util
from pathlib import Path

HERE = Path(__file__).parent
VERIFIED = HERE.parent / "timetable_verified"
GEN = HERE / "generate_timetable.py"

# md file -> (var prefix, has_forward, has_backward)
STATIONS = {
    "BAR":  ("BARRA",   True,  False),
    "OCE":  ("OCEAN",   True,  True),
    "JOC":  ("JC",      True,  True),
    "STA":  ("STADIUM", True,  True),
    "PAK":  ("PAI_KOK", True,  True),
    "COW":  ("CW",      True,  True),
    "LOT":  ("LOTUS",   True,  True),
    "HU":   ("UH",      True,  True),
    "EAG":  ("EAG",     True,  True),
    "COE":  ("CE",      True,  True),
    "MUST": ("MUST",    True,  True),
    "AIR":  ("AIRPORT", True,  True),
    "TFT":  ("TFT",     False, True),
}
DAYTYPE_SUFFIX = {"mon_thu": "", "friday": "_FRI", "sat_sun": "_SSH"}


def parse_md(path: Path) -> dict:
    """Return {(daytype, direction): {hour: [mins]}} for one station file."""
    text = path.read_text(encoding="utf-8")
    out = {}
    daytype = None
    direction = None
    in_block = False
    for line in text.splitlines():
        if line.startswith("## "):
            if "星期一" in line:
                daytype = "mon_thu"
            elif "星期五" in line:
                daytype = "friday"
            elif "星期六" in line:
                daytype = "sat_sun"
            else:
                daytype = None
            direction = None
            continue
        if line.startswith("### "):
            if "氹仔碼頭" in line or "To TFT" in line:
                direction = "forward"
            elif "媽閣" in line or "To Barra" in line:
                direction = "backward"
            else:
                direction = None
            continue
        if line.strip() == "```":
            in_block = not in_block
            continue
        if in_block and daytype and direction:
            m = re.match(r"\s*(\d{1,2}):\s*([\d ]*)$", line)
            if not m:
                continue
            hour = int(m.group(1))
            mins = [int(x) for x in m.group(2).split()]
            out.setdefault((daytype, direction), {})[hour] = mins
    return out


def build_varmap() -> dict:
    """varname -> {hour:[mins]} parsed from all station .md files."""
    varmap = {}
    for code, (prefix, has_f, has_b) in STATIONS.items():
        data = parse_md(VERIFIED / f"{code}.md")
        for (daytype, direction), table in data.items():
            if direction == "forward" and not has_f:
                continue
            if direction == "backward" and not has_b:
                continue
            suffix = DAYTYPE_SUFFIX[daytype]
            if direction == "backward" and prefix == "TFT":
                # Terminus quirk: Friday/SSH backward dicts are named TFT_FRI / TFT_SSH
                varname = {"": "TFT_TO_BARRA", "_FRI": "TFT_FRI", "_SSH": "TFT_SSH"}[suffix]
            else:
                base = f"{prefix}_TO_TFT" if direction == "forward" else f"{prefix}_TO_BARRA"
                varname = base + suffix
            varmap[varname] = table
    return varmap


def load_current_dicts():
    spec = importlib.util.spec_from_file_location("gen_tt", GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def render_literal(varname: str, table: dict) -> str:
    lines = [f"{varname}: dict[int, list[int]] = {{"]
    for h in sorted(table):
        mins = ", ".join(str(m) for m in table[h])
        lines.append(f"    {h}: [{mins}],")
    lines.append("}")
    return "\n".join(lines)


def write_dicts(varmap: dict) -> int:
    text = GEN.read_text(encoding="utf-8")
    rewritten = 0
    for varname, table in varmap.items():
        pattern = re.compile(
            r"^" + re.escape(varname) + r": dict\[int, list\[int\]\] = \{.*?^\}",
            re.MULTILINE | re.DOTALL,
        )
        if not pattern.search(text):
            print(f"  WARN: could not locate literal for {varname}")
            continue
        text, n = pattern.subn(lambda m: render_literal(varname, table), text, count=1)
        rewritten += n
    GEN.write_text(text, encoding="utf-8")
    print(f"Rewrote {rewritten} dict literals into {GEN.name}")
    return 0


def main():
    varmap = build_varmap()
    if "--write" in sys.argv:
        return write_dicts(varmap)
    mod = load_current_dicts()
    mismatches = 0
    checked = 0
    for varname, table in sorted(varmap.items()):
        cur = getattr(mod, varname, None)
        checked += 1
        if cur is None:
            print(f"  MISSING in script: {varname}")
            mismatches += 1
            continue
        if cur != table:
            mismatches += 1
            diff_hours = sorted(set(cur) | set(table))
            print(f"  DIFF {varname}:")
            for h in diff_hours:
                if cur.get(h) != table.get(h):
                    print(f"      {h}: md={table.get(h)}  script={cur.get(h)}")
    print(f"\nChecked {checked} dicts, {mismatches} mismatch(es).")
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
