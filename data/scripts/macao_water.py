"""Macao Water's website, read for its figures and its plant names — never for
geometry.

macaowater.com is an Angular app: the pages are empty shells and the content
comes from a JSON API the app calls. Three answers are read:

  * website-api/page/cms/operations/waterSupplyFacilities?lang=<zh_TW|en_US|pt_PT>
    — the「供水設施」page: a Drupal node whose `body` is HTML. Its text names
    the four treatment plants (links to their photos) and points at the
    brochure; the 22-facility LIST itself exists only in the schematic
    /sites/default/files/Facilities.jpg, which is copyrighted and not
    georeferenced, so it is never parsed. Its SHA-256 is compared with the one
    recorded when fetch_water_facilities.py's table was transcribed, and a
    changed picture fails the run so a human re-checks the list.
  * website-api/page/cms/operations/waterSources — the「供澳原水」page: prose
    with the raw-water facts (over 90 % from the Xijiang's Modaomen waterway,
    the Zhuhai pipelines and their daily capacity, the 竹仙洞 and 竹銀
    reservoirs). The Chinese text is the source of the numbers. The English
    page's pipe figure disagrees with it (190,000 vs 220,000 m³/day for the two
    1 m pipes, 2026-09), so only the share and the reservoir figures are
    cross-checked against en.
  * website-api/page/icis/operations/wateSupplyStatistics/ (sic) — the
    「統計數據」table. `result.a` / `result.b` are the previous and the latest
    year's rows in a FIXED order with no labels (the labels live in the app;
    STAT_ROWS below is that order), `data1` / `data2` are the annual supply
    and consumption series by year in million m³, which pin the year and two
    of the rows — a reordered table cannot pass unnoticed.

Anything unexpected raises MacaoWaterPageError and fetch_water_facilities.py
refuses to write. Answers are cached for a day in the OS temp dir.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

from osm_footprints import cached_get

SITE = "https://www.macaowater.com"
CMS_URL = SITE + "/website-api/page/cms/operations/{endpoint}?lang={lang}"
STATISTICS_URL = SITE + "/website-api/page/icis/operations/wateSupplyStatistics/?lang={lang}"
# The human-readable pages, for `sources` in the output file.
FACILITIES_PAGE = SITE + "/about-macao-water/water-supply-facilities"
WATER_SOURCES_PAGE = SITE + "/about-macao-water/water-sources"
STATISTICS_PAGE = SITE + "/about-macao-water/water-supply-statistics"

LANGS = {"zh": "zh_TW", "en": "en_US", "pt": "pt_PT"}
CACHE_DIR = Path(tempfile.gettempdir()) / "mini-macau-macaowater-cache"

# The statistics table's rows, top to bottom, as the app labels them (2026-09):
# key, and the factor that turns the published unit into the one we ship
# (千立方米 -> m³). Rows after `leakagePct` are maintenance / business figures
# the map has no use for; they are still parsed so the row count is checked.
STAT_ROWS = (
    ("designCapacityM3PerDay", 1),          # 日設計供水能力, m³
    ("peakDailySupplyM3", 1000),            # 最高日供水量, 千 m³
    ("annualSupplyM3", 1000),               # 年供水量, 千 m³
    ("rawWaterImportedM3", 1000),           # 輸入原水量, 千 m³
    ("annualConsumptionM3", 1000),          # 年用水量 (metered), 千 m³
    ("mainsKm", 1),                         # 管網長度 (incl. service pipes)
    ("plants", 1),                          # 水處理廠數目
    ("reservoirs", 1),                      # 水庫數目
    ("tanks", 1),                           # 蓄水池數目
    ("rawWaterPumpingStations", 1),         # 原水泵站數目
    ("treatedWaterPumpingStations", 1),     # 處理水泵站數目
    ("perCapitaLitresPerDay", 1),           # 全城人均日用水量
    ("householdPerCapitaLitresPerDay", 1),  # 家居人均日用水量
    ("co2KgPerM3", 1),                      # 每立方米供水碳排放量
    ("leakagePct", 1),                      # 漏損率
    ("mainsReplacedM", 1),
    ("leakRepairs", 1),
    ("metersReplaced", 1),
    ("metersTotal", 1),
    ("staff", 1),
    ("fixedAssetInvestmentMopM", 1),
)
SHIPPED_STAT_KEYS = tuple(k for k, _ in STAT_ROWS[:15])

_CJK_DIGITS = {"一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5,
               "六": 6, "七": 7, "八": 8, "九": 9}


class MacaoWaterPageError(RuntimeError):
    """The site did not answer with what the parser expects."""


@dataclass(frozen=True)
class CmsPage:
    lang: str
    url: str
    title: str
    blocks: list[str]              # every text block, whitespace-normalised
    links: list[tuple[str, str]]   # (text, href)
    images: list[str]              # img src, page order


@dataclass(frozen=True)
class RawWaterFacts:
    xijiang_share_min_pct: int                       # 「超過九成」-> 90
    zhuhai_pipelines: tuple[dict, ...]               # {diameterM, count, capacityM3PerDay}
    lapa_reservoir_m3: int                           # 竹仙洞水庫 庫容
    lapa_reservoir_year: int
    zhuyin_reservoir_m3: int                         # 竹銀水庫 總庫容
    zhuyin_regulating_m3: int                        # 調節庫容
    zhuyin_macau_share_m3: int                       # Macau's usable share
    zhuyin_reservoir_year: int


@dataclass(frozen=True)
class Statistics:
    year: int
    previous_year: int
    latest: dict[str, float]     # every STAT_ROWS key, converted
    previous: dict[str, float]
    supply_series: tuple[tuple[int, float], ...]       # (year, million m³)
    consumption_series: tuple[tuple[int, float], ...]


@dataclass(frozen=True)
class MacaoWater:
    facilities: dict[str, CmsPage]     # lang -> the 供水設施 page
    plants: dict[str, list[str]]       # lang -> the plant names it lists
    schematic_url: str
    schematic_sha256: str
    raw_water: RawWaterFacts
    statistics: Statistics


# ----------------------------------------------------------------------------
# Fetch + parse
# ----------------------------------------------------------------------------
def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _num(s) -> float:
    if isinstance(s, (int, float)):
        return float(s)
    return float(str(s).replace(",", "").strip())


def _api(url: str):
    raw = json.loads(cached_get(url, CACHE_DIR).decode("utf-8"))
    if str(raw.get("state")) != "0":
        raise MacaoWaterPageError(f"{url}: state {raw.get('state')!r} ({raw.get('msg')!r})")
    return raw.get("result")


def fetch_cms_page(endpoint: str, lang: str) -> CmsPage:
    url = CMS_URL.format(endpoint=endpoint, lang=LANGS[lang])
    result = _api(url)
    if isinstance(result, str):
        result = json.loads(result)
    nodes = (result or {}).get("nodes") or []
    if not nodes:
        raise MacaoWaterPageError(f"{url}: no content nodes")
    node = nodes[0].get("node", nodes[0])
    soup = BeautifulSoup(node.get("body") or "", "lxml")
    blocks = [_squash(el.get_text(" ", strip=True))
              for el in soup.find_all(["p", "li", "h1", "h2", "h3", "h4", "td", "th"])]
    page = CmsPage(
        lang=lang, url=url, title=_squash(node.get("title") or ""),
        blocks=[b for b in blocks if b],
        links=[(_squash(a.get_text(" ", strip=True)), a.get("href") or "") for a in soup.find_all("a")],
        images=[img.get("src") or "" for img in soup.find_all("img")],
    )
    if not page.blocks:
        raise MacaoWaterPageError(f"{url}: the page body has no text")
    return page


def plant_names(page: CmsPage) -> list[str]:
    """The treatment plants the 供水設施 page lists: the links to the plant
    photos (…WTP_<year>.jpg). The brochure link is a PDF and drops out."""
    names = [text for text, href in page.links if text and "WTP" in href]
    if len(names) < 3:
        raise MacaoWaterPageError(
            f"{page.url}: only {len(names)} plant links found — has the page changed?"
        )
    return names


def schematic_source(page: CmsPage) -> str:
    for src in page.images:
        if "Facilities" in src:
            return src if src.startswith("http") else SITE + src
    raise MacaoWaterPageError(f"{page.url}: no Facilities schematic image on the page")


def sha256_of(url: str) -> str:
    return hashlib.sha256(cached_get(url, CACHE_DIR)).hexdigest()


# ----------------------------------------------------------------------------
# 供澳原水 — the raw-water facts
# ----------------------------------------------------------------------------
_ZH_SHARE = re.compile(r"超過([一二兩三四五六七八九])成")
# 「兩條直徑1米（可日供原水共約22萬立方米）」and「一條直徑1.6米（日可供原水約24萬立方米）」
# — the page words the two brackets differently, hence the optional 可 / 共.
_ZH_PIPE = re.compile(r"([一二兩三四五六七八九\d]+)條直徑([\d.]+)米（可?日可?供原水共?約([\d,.]+)萬立方米）")
_ZH_LAPA = re.compile(r"竹仙洞水庫於(\d{4})年建成，[^。]*?庫容為([\d,.]+)萬立方米")
_ZH_ZHUYIN = re.compile(
    r"竹銀水庫於(\d{4})年竣工，其總庫容為([\d,.]+)萬立方米，調節庫容為([\d,.]+)萬立方米。"
    r"澳門可使用竹銀水源系統的([一二兩三四五六七八九])成調節庫容，即約([\d,.]+)萬立方米"
)
_EN_SHARE = re.compile(r"Over (\d+)% of Macao.s water comes from the West River")
_EN_LAPA = re.compile(r"capacity of ([\d.]+) ?millions? m3")
_EN_ZHUYIN = re.compile(
    r"total capacity of ([\d.]+) million cubic meters of water and actual capacity of "
    r"([\d.]+) million cubic meters.*?about ([\d.]+) million cubic meters"
)


def _find(pattern: re.Pattern, text: str, what: str, url: str) -> re.Match:
    m = pattern.search(text)
    if m is None:
        raise MacaoWaterPageError(f"{url}: the {what} sentence was not found — has Macao Water "
                                  f"re-worded it? (pattern {pattern.pattern!r})")
    return m


def _cjk_count(token: str) -> int:
    return _CJK_DIGITS[token] if token in _CJK_DIGITS else int(token)


def _wan_m3(s: str) -> int:
    """「240萬立方米」-> 2,400,000."""
    return int(round(_num(s) * 10_000))


def extract_raw_water(zh: CmsPage, en: CmsPage) -> RawWaterFacts:
    text = "\n".join(zh.blocks)
    share = _cjk_count(_find(_ZH_SHARE, text, "share", zh.url).group(1)) * 10
    pipes = tuple(
        {"diameterM": float(d), "count": _cjk_count(n), "capacityM3PerDay": _wan_m3(cap)}
        for n, d, cap in _ZH_PIPE.findall(text)
    )
    if len(pipes) < 2:
        # The page describes the 1 m pair and the 1.6 m pipe in two brackets;
        # matching only one means the wording moved, not that a pipe is gone.
        raise MacaoWaterPageError(f"{zh.url}: {len(pipes)} pipeline bracket(s) matched, expected "
                                  f"at least 2 (pattern {_ZH_PIPE.pattern!r})")
    m = _find(_ZH_LAPA, text, "Lapa reservoir", zh.url)
    lapa_year, lapa_m3 = int(m.group(1)), _wan_m3(m.group(2))
    m = _find(_ZH_ZHUYIN, text, "Zhuyin reservoir", zh.url)
    zhuyin_year, zhuyin_m3, regulating_m3 = int(m.group(1)), _wan_m3(m.group(2)), _wan_m3(m.group(3))
    share_tenths, macau_share_m3 = _cjk_count(m.group(4)), _wan_m3(m.group(5))

    en_text = "\n".join(en.blocks)
    en_share = int(_find(_EN_SHARE, en_text, "share", en.url).group(1))
    en_lapa = float(_find(_EN_LAPA, en_text, "Lapa reservoir", en.url).group(1))
    m = _find(_EN_ZHUYIN, en_text, "Zhuyin reservoir", en.url)
    en_zhuyin, en_regulating, en_macau = (float(m.group(i)) for i in (1, 2, 3))

    problems = []
    if en_share != share:
        problems.append(f"share: zh {share}% vs en {en_share}%")
    for label, zh_m3, en_million in (("Lapa", lapa_m3, en_lapa), ("Zhuyin", zhuyin_m3, en_zhuyin),
                                     ("Zhuyin regulating", regulating_m3, en_regulating),
                                     ("Zhuyin Macau share", macau_share_m3, en_macau)):
        if abs(zh_m3 - en_million * 1_000_000) > 20_000:
            problems.append(f"{label}: zh {zh_m3} m³ vs en {en_million} million m³")
    if abs(macau_share_m3 - regulating_m3 * share_tenths / 10) > regulating_m3 * 0.01:
        problems.append(f"Macau's {share_tenths}0% of {regulating_m3} m³ is not {macau_share_m3} m³")
    if problems:
        raise MacaoWaterPageError("the raw-water pages do not agree: " + "; ".join(problems))

    return RawWaterFacts(
        xijiang_share_min_pct=share, zhuhai_pipelines=pipes,
        lapa_reservoir_m3=lapa_m3, lapa_reservoir_year=lapa_year,
        zhuyin_reservoir_m3=zhuyin_m3, zhuyin_regulating_m3=regulating_m3,
        zhuyin_macau_share_m3=macau_share_m3, zhuyin_reservoir_year=zhuyin_year,
    )


# ----------------------------------------------------------------------------
# 統計數據 — the table
# ----------------------------------------------------------------------------
def fetch_statistics(lang: str = "zh") -> Statistics:
    url = STATISTICS_URL.format(lang=LANGS[lang])
    result = _api(url)
    data = (result or {}).get("data") if isinstance(result, dict) else None
    if not data:
        raise MacaoWaterPageError(f"{url}: no data")
    table = json.loads(data[0]) if isinstance(data[0], str) else data[0]
    try:
        supply = tuple((int(y), float(v)) for y, v in table["data1"])
        consumption = tuple((int(y), float(v)) for y, v in table["data2"])
        rows = table["result"]
        prev, latest = rows["a"], rows["b"]
    except (KeyError, TypeError, ValueError) as e:
        raise MacaoWaterPageError(f"{url}: unexpected table shape ({e})") from e
    if len(latest) != len(STAT_ROWS) or len(prev) != len(STAT_ROWS):
        raise MacaoWaterPageError(
            f"{url}: {len(latest)} / {len(prev)} rows, expected {len(STAT_ROWS)} — has a row "
            "been added or removed? Update STAT_ROWS."
        )
    if len(supply) < 2 or [y for y, _ in supply] != [y for y, _ in consumption]:
        raise MacaoWaterPageError(f"{url}: the supply and consumption series do not line up")

    def convert(values) -> dict[str, float]:
        out = {}
        for (key, factor), raw in zip(STAT_ROWS, values):
            v = _num(raw) * factor
            out[key] = int(round(v)) if abs(v - round(v)) < 1e-9 else round(v, 3)
        return out

    latest_d, prev_d = convert(latest), convert(prev)
    year, prev_year = supply[-1][0], supply[-2][0]

    # The two chart series are the table's supply and consumption rows in
    # million m³: if they do not match, the rows are not what STAT_ROWS says.
    problems = []
    for label, series, key in (("supply", supply, "annualSupplyM3"),
                               ("consumption", consumption, "annualConsumptionM3")):
        for yr, table_d in ((year, latest_d), (prev_year, prev_d)):
            chart = dict(series)[yr]
            if abs(chart - table_d[key] / 1_000_000) > 1.0:
                problems.append(f"{yr} {label}: chart {chart} vs table {table_d[key] / 1e6:.1f} million m³")
    this_year = datetime.now(tz=timezone.utc).year
    if not 2020 <= year <= this_year or prev_year != year - 1:
        problems.append(f"years {prev_year} / {year} are not two consecutive recent years")
    if latest_d["designCapacityM3PerDay"] < latest_d["peakDailySupplyM3"]:
        problems.append("peak daily supply exceeds the design capacity")
    if not 1 <= latest_d["plants"] <= 10:
        problems.append(f"{latest_d['plants']} treatment plants is not plausible")
    if not 100 <= latest_d["perCapitaLitresPerDay"] <= 1000:
        problems.append(f"{latest_d['perCapitaLitresPerDay']} L per person per day is not plausible")
    if not 0 <= latest_d["leakagePct"] <= 100:
        problems.append(f"leakage {latest_d['leakagePct']}% is not a percentage")
    if problems:
        raise MacaoWaterPageError(f"{url}: the statistics do not add up: " + "; ".join(problems))

    return Statistics(year=year, previous_year=prev_year, latest=latest_d, previous=prev_d,
                      supply_series=supply, consumption_series=consumption)


# ----------------------------------------------------------------------------
# Everything
# ----------------------------------------------------------------------------
def read_macao_water() -> MacaoWater:
    facilities = {lang: fetch_cms_page("waterSupplyFacilities", lang) for lang in LANGS}
    plants = {lang: plant_names(page) for lang, page in facilities.items()}
    counts = {lang: len(v) for lang, v in plants.items()}
    if len(set(counts.values())) != 1:
        raise MacaoWaterPageError(f"the three language pages list different plant counts: {counts}")
    schematic = schematic_source(facilities["zh"])
    raw_water = extract_raw_water(fetch_cms_page("waterSources", "zh"),
                                  fetch_cms_page("waterSources", "en"))
    statistics = fetch_statistics("zh")
    # The other languages must carry the same table.
    for lang in ("en", "pt"):
        other = fetch_statistics(lang)
        if other.latest != statistics.latest or other.year != statistics.year:
            raise MacaoWaterPageError(f"the {lang} statistics table differs from the zh one")
    return MacaoWater(facilities=facilities, plants=plants, schematic_url=schematic,
                      schematic_sha256=sha256_of(schematic), raw_water=raw_water,
                      statistics=statistics)


def facts_json(mw: MacaoWater) -> dict:
    """The `facts` block of water-facilities.json — the keys validate_output.py's
    v_water_facilities and the frontend's WaterFacilitiesFileSchema expect."""
    s, r = mw.statistics, mw.raw_water
    return {
        "statistics": {
            "year": s.year,
            "previousYear": s.previous_year,
            **{key: s.latest[key] for key in SHIPPED_STAT_KEYS},
        },
        "rawWater": {
            "xijiangShareMinPct": r.xijiang_share_min_pct,
            "zhuhaiPipelines": list(r.zhuhai_pipelines),
            "lapaReservoirM3": r.lapa_reservoir_m3,
            "lapaReservoirYear": r.lapa_reservoir_year,
            "zhuyinReservoirM3": r.zhuyin_reservoir_m3,
            "zhuyinRegulatingM3": r.zhuyin_regulating_m3,
            "zhuyinMacauShareM3": r.zhuyin_macau_share_m3,
            "zhuyinReservoirYear": r.zhuyin_reservoir_year,
        },
    }


if __name__ == "__main__":
    # `uv run python scripts/macao_water.py` prints what the site says, which is
    # the quickest way to see why fetch_water_facilities.py refused a run.
    mw = read_macao_water()
    for lang, names in mw.plants.items():
        print(f"{lang} plants ({len(names)}): {names}")
    print(f"schematic: {mw.schematic_url}\n  sha256 {mw.schematic_sha256}")
    facts = facts_json(mw)
    for section, values in facts.items():
        print(f"\n{section}:")
        for k, v in values.items():
            print(f"  {k:>34}  {v}")
    print(f"\nprevious year ({mw.statistics.previous_year}):")
    for k in SHIPPED_STAT_KEYS:
        print(f"  {k:>34}  {mw.statistics.previous[k]}")
    print(f"\nsupply series: {mw.statistics.supply_series[-5:]}")
    print(f"consumption series: {mw.statistics.consumption_series[-5:]}")
    sys.exit(0)
