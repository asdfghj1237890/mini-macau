"""CEM's「營運」(Operation) page, read for its figures and its names — never
for geometry.

    https://www.cem-macau.com/{zh,en}/about-cem/company-profile/operation/

The page is a server-rendered Nuxt site, and three parts of it are data:

  * The 輸電及接駁網絡圖 is a picture with one marker layer per voltage level
    (`div.locations-container`, labelled by its `.popup-header span`: 66千伏
    (65兆伏安), 110千伏 (125兆伏安), 110千伏 (200兆伏安), 220千伏 (350兆伏安),
    plus 發電廠 and an all-substations layer). Every marker names a site in
    `.location-box .P4`. Only the NAMES are read: the marker positions are
    percentages across CEM's copyrighted diagram, not coordinates, and are
    never used. The Guangdong interconnection is prose, so 北安變電站 (the third
    corridor's landing station) is on the map but in none of the level layers.
  * The prose (`div.rich-text`) carries the annual figures in fixed sentences:
    the year's consumption, own generation and imports in GWh with their
    percentages, the two Coloane stations' capacities and generation shares,
    「29 座高壓變電站、8 座高壓開關站」, 1,088 km of HV cable, the three
    Guangdong corridors with their years, the circuit counts and 1,700 MW.
  * Two generator tables (Station A, Station B) list every unit's commissioning
    year and the station's total capacity; the year range and the total are
    read.

Every sentence is matched by a regex anchored on the words around the number,
so a re-worded page fails loudly (CemPageError) instead of shipping a wrong
figure — fetch_power_facilities.py then refuses to write. The English page is
read for the English marker names and to cross-check the headline figures.

Pages are cached for a day in the OS temp dir, like the Overpass answers.
"""

from __future__ import annotations

import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

from osm_footprints import cached_get

OPERATION_URL = "https://www.cem-macau.com/{lang}/about-cem/company-profile/operation/"

CACHE_DIR = Path(tempfile.gettempdir()) / "mini-macau-cem-cache"

# A layer label that names a voltage level: "66千伏 (65兆伏安)", "110kV (125MVA)".
_LEVEL_LABEL = re.compile(r"^(\d{2,3})\s*(?:千伏|kV)\b", re.IGNORECASE)
# "1,088", "6,259.7", "91"
_NUM = r"([\d,]+(?:\.\d+)?)"


class CemPageError(RuntimeError):
    """The page did not contain what the parser expects."""


@dataclass(frozen=True)
class OperationPage:
    lang: str
    url: str
    layers: dict[str, list[str]]   # map-layer label -> marker names, in page order
    prose: list[str]               # every rich-text block, whitespace-normalised
    tables: list[list[list[str]]]  # every <table>, as rows of cell text


@dataclass(frozen=True)
class CemFacts:
    """The figures CEM publishes, as read from the Chinese page and cross-checked
    against the English one."""
    year: int
    consumption_gwh: float
    local_generation_gwh: float
    imported_gwh: float
    local_share_pct: int
    imported_share_pct: int
    peak_demand_mw: float
    hv_substations: int
    hv_switching_stations: int
    hv_cable_km: int
    corridor_years: tuple[int, ...]   # the Guangdong corridors, in order
    circuits_220kv: int
    backup_circuits_110kv: int
    interconnection_mw: int
    station_a_mw: float
    station_b_mw: float
    station_a_share_pct: int          # share of CEM's own generation in `year`
    station_b_share_pct: int
    station_a_years: tuple[int, int]  # first and last unit commissioned
    station_b_years: tuple[int, int]


# ----------------------------------------------------------------------------
# Fetch + parse
# ----------------------------------------------------------------------------
def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def fetch_operation_page(lang: str) -> OperationPage:
    url = OPERATION_URL.format(lang=lang)
    html = cached_get(url, CACHE_DIR).decode("utf-8", errors="replace")
    return parse_operation_page(html, lang, url)


def parse_operation_page(html: str, lang: str, url: str = "") -> OperationPage:
    soup = BeautifulSoup(html, "lxml")
    layers: dict[str, list[str]] = {}
    for layer in soup.select("div.locations-container"):
        label_el = layer.select_one(".popup-header span")
        names = [_squash(el.get_text(" ", strip=True))
                 for el in layer.select(".location-box .P4")]
        names = [n for n in names if n]
        if label_el is None or not names:
            continue
        label = _squash(label_el.get_text(" ", strip=True))
        seen = layers.setdefault(label, [])
        seen.extend(n for n in names if n not in seen)
    prose = [_squash(rt.get_text(" ", strip=True)) for rt in soup.select("div.rich-text")]
    prose = [p for p in prose if p]
    tables = [
        [[_squash(c.get_text(" ", strip=True)) for c in tr.find_all(["td", "th"])]
         for tr in t.find_all("tr")]
        for t in soup.find_all("table")
    ]
    if not layers or not prose:
        raise CemPageError(
            f"{lang} page: {len(layers)} marker layers and {len(prose)} text blocks "
            "found — has the page layout changed?"
        )
    return OperationPage(lang=lang, url=url, layers=layers, prose=prose, tables=tables)


# ----------------------------------------------------------------------------
# The substation list
# ----------------------------------------------------------------------------
def voltage_levels(page: OperationPage) -> dict[str, int]:
    """Marker name -> the HIGHEST voltage level whose layer lists it.

    A site on the 66 kV and both 110 kV layers is a 110 kV station here, which is
    the `level` rule fetch_power_facilities.py uses.
    """
    levels: dict[str, int] = {}
    for label, names in page.layers.items():
        m = _LEVEL_LABEL.match(label)
        if not m:
            continue
        kv = int(m.group(1))
        for name in names:
            levels[name] = max(kv, levels.get(name, 0))
    if len(levels) < 20:
        raise CemPageError(
            f"{page.lang} page: only {len(levels)} names on the voltage layers "
            f"({sorted(page.layers)}) — has the map changed?"
        )
    return levels


# CEM's page splits 澳北 into 澳北 A / 澳北 B rows and, on one layer, calls
# 路環 「路環B」; OSM (and this pipeline) map each as ONE site. Drop a single
# Latin unit letter in front of the 變電站 / SS suffix so both sides compare
# equal. "上葡京開關站" and "…開關站及變電站" have no letter and pass through.
_UNIT_ZH = re.compile(r"[A-Z](?=變電站$)")
_UNIT_EN = re.compile(r"-[A-Z](?= SS$)")


def norm_zh_name(name: str) -> str:
    return _UNIT_ZH.sub("", re.sub(r"\s+", "", name))


def norm_en_name(name: str) -> str:
    return _UNIT_EN.sub("", _squash(name).upper())


def cem_en_style(en: str) -> str:
    """Our English name in the page's style: upper-case, 'SS' / 'SWS&SS'."""
    n = _squash(en).upper()
    n = n.replace(" SWITCHING STATION AND SUBSTATION", " SWS&SS")
    return n.replace(" SUBSTATION", " SS")


# ----------------------------------------------------------------------------
# The figures
# ----------------------------------------------------------------------------
_ZH = {
    "energy": re.compile(
        rf"在(\d{{4}})年，澳門總用電量為{_NUM}吉瓦時，其中{_NUM}吉瓦時是由澳電所生產，"
        rf"{_NUM}吉瓦時是從外來購入，比例分別為(\d+)%和(\d+)%"
    ),
    "peak": re.compile(rf"最高峰值為{_NUM}兆瓦"),
    "capacity": re.compile(rf"額定裝機容量分別為{_NUM}兆瓦和{_NUM}兆瓦"),
    "generation_share": re.compile(r"於(\d{4})年發電量各佔澳電總發電量的(\d+)%和(\d+)%"),
    "stations": re.compile(r"澳電現時共有\s*([\d,]+)\s*座高壓變電站、\s*([\d,]+)\s*座高壓開關站"),
    "cable": re.compile(r"([\d,]+)公里長的高壓"),
    "corridors": re.compile(r"先後在(\d{4})年、(\d{4})年及(\d{4})年建成了第一、二、三條通道"),
    "circuits": re.compile(r"(\d+)回220千伏主供[綫線]路及(\d+)回110千伏備用[綫線]路"),
    "interconnection": re.compile(rf"對澳輸電能力達到{_NUM}兆瓦"),
}
_EN = {
    "energy": re.compile(
        rf"In (\d{{4}}), Macau.s gross energy consumption was {_NUM} GWh, of which "
        rf"{_NUM} GWh was produced by CEM and {_NUM} GWh was acquired from external suppliers"
    ),
    "stations": re.compile(
        r"CEM has (\d+) high-voltage substations and (\d+) high-voltage switching stations"
    ),
}


def _num(s: str) -> float:
    return float(s.replace(",", ""))


def _int(s: str) -> int:
    v = _num(s)
    if v != int(v):
        raise CemPageError(f"expected a whole number, got {s!r}")
    return int(v)


def _find(patterns: dict[str, re.Pattern], key: str, text: str, lang: str) -> re.Match:
    m = patterns[key].search(text)
    if m is None:
        raise CemPageError(
            f"{lang} page: the '{key}' sentence was not found — has CEM re-worded it? "
            f"(pattern {patterns[key].pattern!r})"
        )
    return m


def _generator_table_facts(page: OperationPage, which: int) -> tuple[tuple[int, int], float]:
    """(first, last) commissioning year and the total MW of generator table `which`
    (0 = Station A, 1 = Station B). A table is a generator table when a unit row
    carries a 4-digit year."""
    tables = [t for t in page.tables
              if any(re.fullmatch(r"(19|20)\d\d", c) for row in t for c in row)]
    if len(tables) <= which:
        raise CemPageError(f"{page.lang} page: generator table {which} not found "
                           f"({len(tables)} tables with unit years)")
    years: list[int] = []
    total: float | None = None
    for row in tables[which]:
        cells = [c for c in row if c]
        if cells and cells[0] in ("合共", "Total") and len(cells) >= 2:
            total = _num(cells[1])
        years.extend(int(c) for c in cells if re.fullmatch(r"(19|20)\d\d", c))
    if not years or total is None:
        raise CemPageError(f"{page.lang} page: generator table {which} has no unit years "
                           "or no total row")
    return (min(years), max(years)), total


def extract_facts(zh: OperationPage, en: OperationPage) -> CemFacts:
    text = "\n".join(zh.prose)
    m = _find(_ZH, "energy", text, "zh")
    year = int(m.group(1))
    consumption, local, imported = (_num(m.group(i)) for i in (2, 3, 4))
    local_pct, imported_pct = int(m.group(5)), int(m.group(6))
    peak = _num(_find(_ZH, "peak", text, "zh").group(1))
    m = _find(_ZH, "capacity", text, "zh")
    a_mw, b_mw = _num(m.group(1)), _num(m.group(2))
    m = _find(_ZH, "generation_share", text, "zh")
    share_year, a_pct, b_pct = int(m.group(1)), int(m.group(2)), int(m.group(3))
    m = _find(_ZH, "stations", text, "zh")
    hv_subs, hv_sws = _int(m.group(1)), _int(m.group(2))
    cable_km = _int(_find(_ZH, "cable", text, "zh").group(1))
    corridor_years = tuple(int(y) for y in _find(_ZH, "corridors", text, "zh").groups())
    m = _find(_ZH, "circuits", text, "zh")
    circuits_220, backup_110 = int(m.group(1)), int(m.group(2))
    interconnection_mw = _int(_find(_ZH, "interconnection", text, "zh").group(1))
    a_years, a_total = _generator_table_facts(zh, 0)
    b_years, b_total = _generator_table_facts(zh, 1)

    # --- the English page must tell the same story -----------------------------
    en_text = "\n".join(en.prose)
    m = _find(_EN, "energy", en_text, "en")
    en_energy = (int(m.group(1)),) + tuple(_num(m.group(i)) for i in (2, 3, 4))
    if en_energy != (year, consumption, local, imported):
        raise CemPageError(f"zh and en pages disagree on the energy figures: "
                           f"zh {(year, consumption, local, imported)} vs en {en_energy}")
    m = _find(_EN, "stations", en_text, "en")
    if (int(m.group(1)), int(m.group(2))) != (hv_subs, hv_sws):
        raise CemPageError("zh and en pages disagree on the substation headline")

    # --- sanity: the figures must agree with each other -------------------------
    problems = []
    this_year = datetime.now(tz=timezone.utc).year
    if not 2020 <= year <= this_year:
        problems.append(f"year {year} is not in 2020..{this_year}")
    if share_year != year:
        problems.append(f"generation shares are for {share_year}, consumption for {year}")
    if abs(local + imported - consumption) > 0.2:
        problems.append(f"{local} + {imported} GWh != {consumption} GWh consumed")
    if local_pct + imported_pct != 100 or a_pct + b_pct != 100:
        problems.append("percentages do not add up to 100")
    if round(imported / consumption * 100) != imported_pct:
        problems.append(f"{imported}/{consumption} GWh is not {imported_pct}%")
    if list(corridor_years) != sorted(corridor_years) or len(corridor_years) != 3:
        problems.append(f"corridor years {corridor_years} are not three ascending years")
    for label, prose_mw, table_mw in (("A", a_mw, a_total), ("B", b_mw, b_total)):
        if abs(prose_mw - table_mw) > 0.05:
            # CEM's own inconsistency, not ours: the prose figure is what we ship.
            print(f"  WARNING: Station {label} is {prose_mw} MW in the prose but "
                  f"{table_mw} MW in its table", file=sys.stderr)
    if problems:
        raise CemPageError("CEM's figures do not add up: " + "; ".join(problems))

    return CemFacts(
        year=year, consumption_gwh=consumption, local_generation_gwh=local,
        imported_gwh=imported, local_share_pct=local_pct, imported_share_pct=imported_pct,
        peak_demand_mw=peak, hv_substations=hv_subs, hv_switching_stations=hv_sws,
        hv_cable_km=cable_km, corridor_years=corridor_years, circuits_220kv=circuits_220,
        backup_circuits_110kv=backup_110, interconnection_mw=interconnection_mw,
        station_a_mw=a_mw, station_b_mw=b_mw, station_a_share_pct=a_pct,
        station_b_share_pct=b_pct, station_a_years=a_years, station_b_years=b_years,
    )


def facts_json(c: CemFacts) -> dict:
    """The `facts` block of power-facilities.json — the keys validate_output.py's
    v_power_facilities and the frontend's PowerFacilitiesFileSchema expect."""
    return {
        "year": c.year,
        "consumptionGwh": c.consumption_gwh,
        "localGenerationGwh": c.local_generation_gwh,
        "importedGwh": c.imported_gwh,
        "localSharePct": c.local_share_pct,
        "importedSharePct": c.imported_share_pct,
        "peakDemandMw": c.peak_demand_mw,
        "cemHvSubstations": c.hv_substations,
        "cemHvSwitchingStations": c.hv_switching_stations,
        "hvCableKm": c.hv_cable_km,
        "interconnectionCorridors": len(c.corridor_years),
        "interconnectionCapacityMw": c.interconnection_mw,
        "interconnection220kvCircuits": c.circuits_220kv,
        "interconnection110kvBackupCircuits": c.backup_circuits_110kv,
    }


def read_cem() -> tuple[CemFacts, OperationPage, OperationPage]:
    """Both pages and the figures, or a CemPageError."""
    zh = fetch_operation_page("zh")
    en = fetch_operation_page("en")
    return extract_facts(zh, en), zh, en


if __name__ == "__main__":
    # `uv run python scripts/cem_operation.py` prints what the page says, which is
    # the quickest way to see why fetch_power_facilities.py refused a run.
    facts, zh_page, en_page = read_cem()
    for k, v in facts_json(facts).items():
        print(f"{k:>36}  {v}")
    print(f"{'stationA':>36}  {facts.station_a_mw} MW, {facts.station_a_years}, "
          f"{facts.station_a_share_pct}%")
    print(f"{'stationB':>36}  {facts.station_b_mw} MW, {facts.station_b_years}, "
          f"{facts.station_b_share_pct}%")
    for page in (zh_page, en_page):
        levels = voltage_levels(page)
        print(f"\n{page.lang}: {len(levels)} names on the voltage layers")
        for name, kv in sorted(levels.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"  {kv:>3} kV  {name}")
