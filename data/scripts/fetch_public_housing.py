"""
Build public/data/public-housing.json: every 社會房屋 (social, rental) and
經濟房屋 (economic, subsidised-sale) estate on the Housing Bureau's (房屋局,
Instituto de Habitação, IH) two 位置分佈 lists, with the OpenStreetMap building
footprints of each estate, so the map can draw them as 3D blocks coloured by
type and shaded by the year their blocks were first occupied.

Three types are drawn. `social` and `economic` are IH's two lists. `other` is
the government housing that is neither, and every `other` estate carries a
`category` naming the programme it belongs to: `elderly` (政府長者公寓, which has
its own legal regime and is run by 社會工作局, not IH), `replacement` (置換房) and
`temporary` (暫住房) — the two urban-renewal programmes on the 黑沙環 P lot — and
`sandwich` (夾心房屋). `category` is null on every social and economic estate and
set on every `other` one; `validate_output.py` and the frontend both enforce
that pairing. The `other` estates are hand-written in `OTHER_ESTATES` with their
sources, because no bureau publishes them as a list the way IH publishes 社屋
and 經屋 — each figure below is quoted from the page it came from.

A programme with nothing standing is not an estate: it belongs in
`KNOWN_UNBUILT` and comes out in `unmatched` with the reason, never in
`estates`. Both 夾心房屋 projects are in that state, and 祐漢新村第八街 is the one
that would do damage if it were not — the 順利樓 blocks it replaces are still
mapped in OSM on its site, so a name-or-nearby match there would draw flats
that were demolished to make room for it.

Why our own footprints instead of tinting the basemap: OpenFreeMap's `building`
tiles merge every building of the same height into one multipolygon feature, so
per-building feature-state is impossible. The machinery — Overpass access, OSM
outline -> footprint, and the re-cut against the basemap's own building parts —
lives in `osm_footprints.py` and is shared with `fetch_schools.py` and
`fetch_water_facilities.py`; this file only decides which buildings belong to
which estate.

Sources
  * IH 社會房屋位置分佈  https://www.ihm.gov.mo/zh/sh-location-distribution
    IH 經濟房屋位置分佈  https://www.ihm.gov.mo/zh/eh-location-distribution
    Both in zh and pt, and each in three regions: the page defaults to the
    Macau peninsula and needs `?ioc=T` (氹仔) and `?ioc=C` (路環) for the rest
    (without them you see 13 of 16 social and 47 of 55 economic estates).
    The list is NOT in the served HTML — the site is a Next.js app and the
    estates live in the RSC flight payload inside `self.__next_f.push([...])`
    script chunks. `flight_payload` re-assembles those string chunks and
    `estate_list` pulls the `"list":[...]` array whose items are `postType`
    `building`; each carries `postTitle`, `metas.address`, `metas.buildingType`
    (SH/EH), `metas.ioc` (M/T/C), `metas.xp`/`metas.yp`, and a `relatedPosts[]`
    array of `building-block` records giving each block's name and its 入伙
    (occupation) date in `inputAt`.
  * IH 公共房屋興建進度 (node-1021) and 已成立管理機關之經屋 (node-72) are NOT
    fetched: their figures are transcribed by hand into `UNITS_STOREYS` below,
    each row carrying which page it came from. They are slow-moving reference
    numbers, not a feed.
  * gov.mo press releases for the 新城A區 lots that IH has not put on its list
    pages yet — see `EXTRA_ESTATES`.
  * gov.mo and zh.wikipedia for the `other` programmes, which appear on no IH
    list at all — see `OTHER_ESTATES`, where every row carries its URL.
  * OpenStreetMap via Overpass: every named building in Macau, plus the
    buildings inside a matched footprint.

How the OSM matching works (in this order; every step is per estate)
  1. **Name match.** Each estate gets a set of normalised anchors: its own zh
     name, the tail after a dash (石排灣社屋-樂群樓 -> 樂群樓), the halves of a
     "X及Y" tail (快意樓及快富樓), and its distinctive block names. A named OSM
     building matches when its normalised Chinese name *starts with* an anchor,
     and the estate with the LONGEST matching anchor wins (so 美樂花園大廈 does
     not fall to 美樂花園, and 筷子基社屋-快達樓 does not fall to 筷子基社屋).
     Estates whose own name carries a block spec (新城市花園第17座, 濠江花園
     第3/4/5座) additionally restrict themselves to those block numbers.
     Anchors shorter than the estate's full name, and anchors that several
     estates share, are only accepted near the estate (see 3).
  2. **Claim-within.** Buildings whose representative point falls inside an
     already matched footprint (a named podium with unnamed towers on it, e.g.
     湖畔大廈) or inside a hand-written polygon are claimed too.
  3. **Geography, from IH's own map point.** IH publishes `metas.xp`/`yp` on
     every estate — the 地圖繪製暨地籍局 local grid, not WGS84 — so the script
     fits an affine transform of that grid onto the estates step 1 placed
     unambiguously (estates whose claims are scattered are left out of the fit,
     then its own outliers are dropped; RMS came to ~28 m on 2026-09-10). The
     fit resolves the ties in step 1, gates the weak anchors to ~250 m, and
     drops any claim more than 350 m from IH's point — which is what keeps
     利民大廈, 威龍花園 and 新樂大廈 off the unrelated buildings elsewhere in
     Macau that share those names. It is never the sole evidence for a claim;
     an estate with no footprint at all gets its fitted point (and
     `approximate: true`) only while the fit's RMS stays under 50 m.
  4. **Hand table.** `OSM_MATCH` adds/removes OSM ids per estate and can turn
     off block labelling; every entry carries its reason. As of 2026-09-10 no
     estate needs an id added or removed — steps 1-3 reach all 71 IH estates
     and all ten hand-written ones — so the only entry is 美居廣場's
     block-labelling opt-out.
  5. Every claimed footprint is re-cut against the basemap's own building parts
     so our block is never shorter or narrower than the grey one under it.
     Heights are therefore the basemap's, exactly as for the schools.
  6. **Storey fallback for towers nothing publishes a height for** (see
     `raise_default_height_towers`). Step 5 leaves a footprint at the
     OpenMapTiles 5 m default when neither OSM nor the basemap gives it a
     height, and the estates that hits hardest are the newest and tallest
     (望德樓, 望信樓, the 新城A區 lots) — a 30-storey tower drawn as a 5 m stub.
     Such a footprint is raised to `estate.storeys` x the metres-per-storey
     this run measures on its own data (`storey_height_m`), but only where it
     is a tower rather than a podium. Being taller than a 5 m basemap stub is
     safe; the "never shorter than the basemap" rule is about footprints the
     basemap does give a height for, and those are never touched.

Estates that end with no footprint and no usable point are left out of
`estates` and listed in `unmatched` with a reason — a wrong building is worse
than a missing one.

Run manually when IH's lists or OSM change (not scheduled, no workflow):
    cd data && uv run python scripts/fetch_public_housing.py
Needs network (ihm.gov.mo + overpass-api.de + OpenFreeMap tiles). IH pages are
cached in the OS temp dir for 6 h and Overpass answers for 24 h, so a restarted
run is cheap. Overpass budget: 1 area query for named buildings, 1 for the
claimed geometries, ~2 for the claim-within polygons — plus the basemap tiles.
Budget 5-15 minutes on a cold cache; overpass-api.de answers 429 to
back-to-back calls and the backoff dominates.

To add an estate that IH does not list: put it in `EXTRA_ESTATES` (社屋/經屋) or
`OTHER_ESTATES` (a programme that is neither, with its `category`), with its
sources, and only if OSM has a footprint for it or a defensible coordinate.
Anything that would be a guess belongs in `unmatched`, not in `estates`.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import tempfile
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
from shapely.geometry import Polygon
from shapely.ops import unary_union

from osm_footprints import (
    DEFAULT_RENDER_HEIGHT_M,
    EXTRA_HEIGHT_M,
    LEVEL_HEIGHT_M,
    TilePartIndex,
    buffered_footprint,
    building_record,
    fetch_tile_building_parts,
    metres_xy,
    overpass,
    parse_height,
    part_record,
    polygon_of_element,
    tiles_covering,
)

ROOT = Path(__file__).parent.parent.parent
OUTPUT_PATH = ROOT / "public" / "data" / "public-housing.json"

# ----------------------------------------------------------------------------
# upstream
# ----------------------------------------------------------------------------
IH_BASE = "https://www.ihm.gov.mo"
IH_SOCIAL = f"{IH_BASE}/zh/sh-location-distribution"
IH_ECONOMIC = f"{IH_BASE}/zh/eh-location-distribution"
IH_PROGRESS = f"{IH_BASE}/zh/node-1021"  # 公共房屋興建進度及准許使用日
IH_MANAGED = f"{IH_BASE}/zh/node-72"  # 已成立管理機關之經屋
GOV_A_LOTS = "https://www.gov.mo/zh-hant/news/1256988/"  # 新城A區 A-lot names
OSM_SOURCE = "https://www.openstreetmap.org/relation/1867188"

# Sources for the `other` programmes, which are on none of IH's lists.
GOV_ELDERLY = "https://www.gov.mo/zh-hant/news/1017954/"  # 長者公寓 timeline
WIKI_ELDERLY = "https://zh.wikipedia.org/wiki/政府長者公寓"
GOV_P_LOT = "https://www.gov.mo/zh-hant/news/1155116/"  # 暫住房 竣工, 2025-06-27
MUR_P_LOT = "https://www.mur.com.mo/project/lot_p"  # 都更公司's own project page
WIKI_P_LOT = "https://zh.wikipedia.org/wiki/黑沙環新填海區P地段暫住房及置換房項目"
WIKI_WAI_LONG = "https://zh.wikipedia.org/wiki/偉龍馬路夾心房屋項目"
DSOP_IAO_HON = "https://www.dsop.gov.mo/construction/1/326/"  # 祐漢 works page
IH_SANDWICH = "https://www.ihm.gov.mo/zh/habitacao-intermedia"  # 夾心房屋: law only

# M = 澳門半島, T = 氹仔, C = 路環. The list page defaults to M.
IOC_DISTRICT = {"M": "macau", "T": "taipa", "C": "coloane"}
# Degenerate-upstream guard. IH published 16 social and 55 economic estates on
# 2026-09-10; a smaller list means the payload shape moved, which is a hand
# edit, not a retry (same rule as the water/power operator pages).
MIN_SOCIAL = 16
MIN_ECONOMIC = 55

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)
IH_CACHE_DIR = Path(tempfile.gettempdir()) / "mini-macau-ihm-cache"
IH_CACHE_TTL_S = 6 * 3600

# Overpass area id of the Macau SAR relation (1867188). Using the area instead
# of a bbox keeps Zhuhai and Hengqin out without a second filter.
MACAU_AREA = 3601867188
LAT0 = 22.16  # local metres-per-degree reference, as in the other overlays
PODIUM_MIN_AREA_M2 = 700  # only footprints this big are searched for towers
POLY_CHUNK = 20  # claim polygons per Overpass request
FIT_MAX_RMS_M = 50.0  # above this the xp/yp fit is not used for placement
FIT_MAX_DIST_M = 250.0  # a weak-anchor match must be this close to the estate
FIT_MAX_SPREAD_M = 250.0  # estates whose claims are wider than this do not anchor the fit
CLAIM_MAX_DIST_M = 350.0  # a claim further than this from IH's own point is not this estate


class UpstreamError(RuntimeError):
    """IH's payload no longer looks the way this script expects."""


# ----------------------------------------------------------------------------
# hand-written reference tables
# ----------------------------------------------------------------------------
# IH publishes unit counts and storeys on two other pages, not on the 位置分佈
# list. Transcribed here with the page each figure came from; None where IH
# publishes nothing or where the published figure covers only part of the
# estate. "node-72 independent units" figures are 獨立單位數目 for the estate's
# management body and IH's own footnote warns they include shops and parking
# spaces, so they can over-count the flats of the older estates.
# key = the estate's zh name exactly as IH prints it (asterisk included).
UNITS_STOREYS: dict[str, tuple[int | None, int | None, str]] = {
    # --- 社會房屋 ---
    "台山平民新邨": (None, None, "not published"),
    "濠江花園第3/4/5座": (None, None, "not published; only blocks 3/4/5 are social"),
    "美居廣場*": (None, None, "not published; only some units are social"),
    "美樂花園大廈*": (None, None, "not published; only some units are social"),
    "新城市花園第17座": (None, None, "not published"),
    "青洲社屋": (1491, None, "IH progress page; per-block storeys differ 18-36"),
    "筷子基社屋  - 快意樓及快富樓": (884, None, "IH progress page; 快意 30 vs 快富 29 storeys"),
    "望廈社屋 - 望善樓": (588, 34, "IH progress page; plus 3 basement levels"),
    "筷子基社屋 - 快達樓": (737, 29, "IH progress page; plus 3 basement levels"),
    "望廈社屋 - 望賢樓": (346, 33, "IH progress page"),
    "望廈社屋-望德樓": (768, 37, "IH progress page; plus 3 basement levels"),
    "台山社屋-台暉樓": (510, 34, "IH progress page"),
    "望廈社屋-望信樓": (1590, 35, "IH progress page; plus 3 basement levels"),
    "氹仔平民新邨": (None, None, "not published"),
    "氹仔社屋-日昇樓": (694, None, "IH progress page; storeys a range, 23-25"),
    "石排灣社屋-樂群樓": (4672, 26, "IH progress page"),
    # --- 經濟房屋 ---
    "東民大廈": (754, 29, "IH progress page; plus 2 basement levels"),
    "東城大廈": (1575, 29, "IH progress page; plus 3 basement levels"),
    "東啟大廈": (800, 31, "IH progress page; plus 3 basement levels"),
    "東創大廈": (642, 33, "IH progress page; plus 3 basement levels"),
    "瑞祥新邨": (None, None, "both figures partial: phase 2 vs phase 1"),
    "快盈大廈": (436, 33, "IH progress page"),
    "朝輝大廈": (24, 7, "IH progress page"),
    "澳門大廈": (524, None, "node-72 independent units, may include shops/parking"),
    "海南花園": (500, None, "node-72 independent units, may include shops/parking"),
    "新城市花園": (None, None, "node-72 covers only 13 of 17 blocks"),
    "威苑花園": (962, None, "node-72 independent units, may include shops/parking"),
    "鴻運閣 吉祥閣 如意閣": (589, None, "node-72 independent units, may include shops/parking"),
    "利達新邨": (689, None, "node-72 independent units, may include shops/parking"),
    "泰豐新邨": (None, None, "not published"),
    "美樂花園": (143, None, "node-72 independent units, may include shops/parking"),
    "威翠花園": (None, None, "two estates share the name: 筷子基 970 and 氹仔 451"),
    "運順新邨": (2295, None, "node-72 independent units, may include shops/parking"),
    "八達新邨": (1712, None, "node-72 independent units, may include shops/parking"),
    "百利新邨": (553, None, "node-72 independent units, may include shops/parking"),
    "彩虹苑": (469, None, "node-72 independent units, may include shops/parking"),
    "信達廣場": (None, None, "both sources give per-block subtotals only"),
    "新寶花園": (523, 31, "IH progress page; node-72 says 559"),
    "翡翠廣場": (563, None, "node-72 independent units, may include shops/parking"),
    "杏花新邨": (353, None, "node-72 independent units, may include shops/parking"),
    "海景園": (720, None, "node-72 independent units, may include shops/parking"),
    "康樂新邨": (799, None, "node-72 independent units, may include shops/parking"),
    "麗華新邨": (708, None, "node-72 independent units, may include shops/parking"),
    "美蓮大廈": (577, None, "node-72 independent units, may include shops/parking"),
    "民安新邨": (697, None, "node-72 independent units, may include shops/parking"),
    "永添新邨": (646, None, "node-72 independent units, may include shops/parking"),
    "威龍花園": (634, None, "node-72 independent units, may include shops/parking"),
    "灣景園": (489, None, "node-72 independent units, may include shops/parking"),
    "華茂新邨": (450, None, "node-72 independent units, may include shops/parking"),
    "亨達大廈": (646, 18, "IH progress page; node-72 says 815"),
    "南澳花園": (532, None, "node-72 independent units, may include shops/parking"),
    "廣華新邨": (None, None, "not published"),
    "南華新邨": (None, None, "both figures cover block 1 only"),
    "東華新邨": (1847, None, "node-72 independent units, may include shops/parking"),
    "先進廣場": (104, 17, "IH progress page; node-72 agrees"),
    "信廉花園": (216, 14, "IH progress page; node-72 says 344"),
    "青葱大廈": (500, None, "IH progress page; two block heights, 27 and 37"),
    "永寧廣場大廈": (880, 26, "IH progress page; node-72 agrees"),
    "青怡大廈": (770, 34, "IH progress page; plus 3 basement levels"),
    "青濤大廈": (378, 32, "IH progress page"),
    "青洲坊大廈": (2356, 35, "IH progress page; plus 5 basement levels"),
    "新樂大廈": (209, None, "node-72 independent units, may include shops/parking"),
    "樂富新邨": (702, None, "node-72 independent units, may include shops/parking"),
    "利民大廈": (None, None, "not published"),
    "泉福新邨": (570, None, "node-72 whole estate; IH lists phase 1 as 282"),
    "湖畔大廈": (2703, None, "IH progress page; six blocks, 46-48 storeys"),
    "日暉大廈": (288, 20, "IH progress page"),
    "業興大廈": (2153, None, "IH progress page; storeys a range, 26-27"),
    "居雅大廈": (1824, 26, "IH progress page; node-72 agrees"),
    "安順大廈": (366, None, "IH progress page; blocks are 16 and 23 storeys"),
}

# Estates IH has not put on its 位置分佈 pages yet. Only lots that OSM actually
# has a footprint for are here; 新城A區 A5 and A6 are still building sites with
# no OSM building and no published coordinate, so they go to `unmatched`.
# The five A-lot names were gazetted and announced by GCS on 2026-08-03
# (GOV_A_LOTS); A3 = 東民大廈 is already on IH's list. The Portuguese names
# come from Portuguese-language press (hojemacau, 2026-08-04) reporting the
# same five buildings in the same order — likely, but never officially paired
# lot-by-lot, so they are stored and flagged here rather than treated as IH
# data. None of these has an IH 入伙 date, so none is `occupied`.
EXTRA_ESTATES: list[dict] = [
    {
        "id": "gov:eh:tong-veng",
        "type": "economic",
        "district": "macau",
        "name_zh": "東榮大廈",
        "name_pt": "Edifício Tong Veng",  # press-reported, see note above
        "addr_zh": "新城A區A1地段",
        "addr_pt": "Lote A1 da Zona A dos Novos Aterros",
        "year": 2026,
        "yearKind": "completion",
        "status": "completed",
        "units": 880,
        "storeys": 28,
        "anchors": ["東榮大廈"],
        "sources": [GOV_A_LOTS, IH_PROGRESS],
    },
    {
        "id": "gov:eh:tong-keong",
        "type": "economic",
        "district": "macau",
        "name_zh": "東強大廈",
        "name_pt": "Edifício Tong Keong",
        "addr_zh": "新城A區A2地段",
        "addr_pt": "Lote A2 da Zona A dos Novos Aterros",
        "year": 2026,
        "yearKind": "completion",
        "status": "completed",
        "units": 1100,
        "storeys": 28,
        "anchors": ["東強大廈"],
        "sources": [GOV_A_LOTS, IH_PROGRESS],
    },
    {
        "id": "gov:eh:tong-tat",
        "type": "economic",
        "district": "macau",
        "name_zh": "東達大廈",
        "name_pt": "Edifício Tong Tat",
        "addr_zh": "新城A區A4地段",
        "addr_pt": "Lote A4 da Zona A dos Novos Aterros",
        "year": 2026,
        "yearKind": "completion",
        "status": "completed",
        "units": 1566,
        "storeys": 33,
        "anchors": ["東達大廈"],
        "sources": [GOV_A_LOTS, IH_PROGRESS],
    },
    {
        "id": "gov:eh:tong-ip",
        "type": "economic",
        "district": "macau",
        "name_zh": "東業大廈",
        "name_pt": "Edifício Tong Ip",
        "addr_zh": "新城A區A12地段",
        "addr_pt": "Lote A12 da Zona A dos Novos Aterros",
        "year": 2026,
        "yearKind": "completion",
        "status": "completed",
        "units": 954,
        "storeys": 29,
        "anchors": ["東業大廈"],
        "sources": [GOV_A_LOTS, IH_PROGRESS],
    },
    {
        # Still unnamed: government releases and IH's progress page call it by
        # its lot number, and so does OSM ("A10 地段社會房屋").
        "id": "gov:sh:zona-a-a10",
        "type": "social",
        "district": "macau",
        "name_zh": "新城A區A10地段社會房屋",
        "name_pt": "Habitação Social no Lote A10 da Zona A",
        "addr_zh": "新城A區A10地段",
        "addr_pt": "Lote A10 da Zona A dos Novos Aterros",
        "year": 2026,
        "yearKind": "completion",
        "status": "completed",
        "units": 728,
        "storeys": 32,
        "anchors": ["A10地段社會房屋"],
        "sources": [IH_PROGRESS, "https://www.gov.mo/zh-hant/news/1193991/"],
    },
    {
        "id": "gov:sh:zona-a-a11",
        "type": "social",
        "district": "macau",
        "name_zh": "新城A區A11地段社會房屋",
        "name_pt": "Habitação Social no Lote A11 da Zona A",
        "addr_zh": "新城A區A11地段",
        "addr_pt": "Lote A11 da Zona A dos Novos Aterros",
        "year": 2026,
        "yearKind": "completion",
        "status": "completed",
        "units": 560,
        "storeys": 32,
        "anchors": ["A11地段社會房屋"],
        "sources": [IH_PROGRESS, "https://www.gov.mo/zh-hant/news/1193991/"],
    },
]

# The `other` types: government housing that is neither 社屋 nor 經屋, so it is on
# neither IH 位置分佈 list and has to be written out by hand. Every figure below
# is quoted from the page in that row's `sources`; where a page publishes only a
# combined or a range figure the field is None, exactly as for the IH estates
# whose storeys IH gives as a range (`UNITS_STOREYS` above). `blocks` here carry
# names only: none of these is an IH estate, so there is no per-block 入伙 date
# to shade by, and a block's `year` stays None and falls back to the estate's.
# Portuguese: no publisher gives a Portuguese name to any of the three P-lot
# buildings, so `name_pt` is OSM's own `name:pt` where the mappers set one
# (樂居 "Edifício Lok Koi", 悅居 "Ut Koi") and, for 明珠都滙, OSM's `name:en`
# "Pearl Metropolitan" — an English name standing in for a Portuguese one that
# does not exist. 長者公寓's is the government's own (Wikipedia's infobox and
# OSM `name:pt` agree, up to the accent).
OTHER_ESTATES: list[dict] = [
    {
        # zh.wikipedia: 「共興建2幢37層樓高的大樓和3層地庫停車場，合共提供1,815個
        # 單位」, 「項目於2020年12月動工，於2024年1月完工」 and 「2024年10月15日，
        # 政府長者公寓正式投入服務」 — the service started that day and the first
        # approved applicants signed their occupancy agreements, so this is an
        # occupation year, not just a completion one.
        # Its own legal regime (《政府長者公寓的使用及管理規章》, in force
        # 2023-11-06) run by 社會工作局: not 社會房屋, and absent from IH's list.
        # The two towers have no individual names and OSM maps the whole thing
        # as one multipolygon (r18182569, one outer ring round a courtyard), so
        # there are no blocks to label.
        "id": "gov:other:elderly-apartments",
        "type": "other",
        "category": "elderly",
        "district": "macau",
        "name_zh": "政府長者公寓",
        "name_pt": "Residência do Governo para Idosos",
        # OSM's addr:street on the building reads 東北大馬路 Avenida do Nordeste
        # and the project's own Portuguese name is 東北大馬路長者公寓 /
        # "Apartamentos para Idosos na Avenida do Nordeste". Wikipedia's infobox
        # gives a second frontage, 松柏街311號及337號; the 東北大馬路 side is the
        # one both the government and OSM name, so it is the one used here.
        "addr_zh": "黑沙環新填海區P地段，東北大馬路",
        "addr_pt": "Avenida do Nordeste",
        "year": 2024,
        "yearKind": "occupation",
        "status": "occupied",
        "units": 1815,
        "storeys": 37,
        "anchors": ["政府長者公寓"],
        "sources": [GOV_ELDERLY, WIKI_ELDERLY],
    },
    {
        # 置換房 (replacement housing) for the owners the 海一居 land forfeiture
        # left without a flat. zh.wikipedia: 「地段A為6幢置換房項目，命名為明珠
        # 都滙…合共提供2,064個單位」, 「將興建六棟50層高置換房」 and 「2025年3月
        # 25日，置換房（明珠都滙）項目工程竣工，展開驗收工作」; the developer's own
        # page rounds the same thing to 「6幢置換房，約2,000個單位」. The 使用准照
        # came on 2025-07-08 and handovers were still being scheduled, so no
        # move-in date is published: this is a completion year.
        # IH spells it 都滙, OSM 都匯 — `VARIANTS` folds the two.
        "id": "gov:other:pearl-metropolitan",
        "type": "other",
        "category": "replacement",
        "district": "macau",
        "name_zh": "明珠都滙",
        "name_pt": "Pearl Metropolitan",  # OSM name:en; no pt name exists
        "addr_zh": "黑沙環新填海區P地段",
        "addr_pt": "",
        "year": 2025,
        "yearKind": "completion",
        "status": "completed",
        "units": 2064,
        "storeys": 50,
        "blocks": [f"第{n}座" for n in range(1, 7)],
        "anchors": ["明珠都滙"],
        "sources": [WIKI_P_LOT, MUR_P_LOT],
    },
    {
        # 暫住房 (temporary housing) for the households an urban-renewal rebuild
        # moves out. GCS, 2025-06-27: 「暫住房項目合共8棟樓宇」, 「命名為『悅居』及
        # 『樂居』」, 「樓高37層至50層」, 「提供2,803個單位」.
        # Two estates, not one: the government names the two buildings
        # separately and OSM maps them 200 m apart with their own podiums (悅居
        # two towers, 樂居 six — 2 + 6 = the release's 8棟). What no publisher
        # splits is the numbers: the developer's own project page and its 2024
        # and 2025 annual reports all give the same combined 「8幢暫住房，2,803個
        # 單位」, so both estates carry `units: None` rather than a share of the
        # 2,803 invented here.
        # `storeys: None` for the same reason. 37-50 is a range over all eight
        # towers, and the per-tower figures that exist do not survive contact
        # with each other: the 2021 land grant (第5/2021號運輸工務司司長批示)
        # specified 地段B 塔樓高34層 and 地段C 兩座高37層、四座高46層, the C1
        # contractor built 「四座住宅塔樓，樓高分別為41層、50層」, and the show flat
        # the developer opened in 2025 is on 樂居第四座's 48樓 — above the grant's
        # 46. Nothing published survives as a per-block figure, and 地段B has no
        # as-built one at all. So `storeys` (what the panel shows) stays None —
        # but a 5 m slab misrepresents a 40-storey tower far more than a
        # documented lower bound does, so `heightStoreys` carries the land
        # grant's per-lot figure (地段B 34, 地段C 46) for the 3D height ONLY. It
        # never reaches the JSON as a storey count.
        "id": "gov:other:ut-koi",
        "type": "other",
        "category": "temporary",
        "district": "macau",
        "name_zh": "悅居",
        "name_pt": "Ut Koi",  # OSM name:pt
        "addr_zh": "黑沙環新填海區P地段",
        "addr_pt": "",
        "year": 2025,
        "yearKind": "completion",
        "status": "completed",
        "units": None,
        "storeys": None,
        "heightStoreys": 34,  # 地段B, 第5/2021號運輸工務司司長批示; 3D height only
        "blocks": [f"第{n}座" for n in range(1, 3)],
        "anchors": ["悅居"],
        "sources": [GOV_P_LOT, MUR_P_LOT, WIKI_P_LOT],
    },
    {
        # See 悅居 above: same project, same completion date, same sources.
        # OSM names its six towers 樂居大廈 第一座 … 第六座.
        "id": "gov:other:lok-koi",
        "type": "other",
        "category": "temporary",
        "district": "macau",
        "name_zh": "樂居",
        "name_pt": "Edifício Lok Koi",  # OSM name:pt
        "addr_zh": "黑沙環新填海區P地段",
        "addr_pt": "",
        "year": 2025,
        "yearKind": "completion",
        "status": "completed",
        "units": None,
        "storeys": None,
        "heightStoreys": 46,  # 地段C, same grant (two 37 + four 46 — the taller figure); 3D height only
        "blocks": ["第一座", "第二座", "第三座", "第四座", "第五座", "第六座"],
        "anchors": ["樂居"],
        "sources": [GOV_P_LOT, MUR_P_LOT, WIKI_P_LOT],
    },
]

# Lots that exist on IH's progress page but have neither an OSM footprint nor a
# published coordinate: reported in `unmatched` so the gap is visible. The two
# 夾心房屋 (sandwich-class) projects are here for a stronger reason — neither has
# a building on its site (one is shelved, the other is down to its foundations),
# so there is no footprint to draw and no year to shade. They are listed rather
# than dropped so that the one public-housing programme with nothing built of
# its own is still visible in the output.
KNOWN_UNBUILT: list[dict] = [
    {
        "id": "gov:sh:zona-a-a5",
        "name": "新城A區A5地段社會房屋",
        "reason": "under construction (1,736 units, topped out); no OSM building and no published coordinate",
    },
    {
        "id": "gov:sh:zona-a-a6",
        "name": "新城A區A6地段社會房屋",
        "reason": "under construction (1,064 units, topped out); no OSM building and no published coordinate",
    },
    # 夾心房屋 (sandwich-class, category "sandwich"): the programme exists in law
    # (《夾心房屋法律制度》, in force 2024-04-01) but has produced no building, so
    # neither project can be an estate. IH's own 夾心房屋 page is legislation and
    # publicity with no estate list at all.
    {
        "id": "gov:other:wai-long-sandwich",
        "name": "偉龍馬路夾心房屋項目",
        "reason": "夾心房屋 (sandwich-class), 氹仔: not built — 「擱置興建」, the tender was "
        f"suspended on 2023-11-14 and in November 2025 the 83,000 m2 site was announced as "
        f"the location of the 澳門科技研發產業園 instead ({WIKI_WAI_LONG}, {IH_SANDWICH})",
    },
    {
        "id": "gov:other:iao-hon-rua-oito",
        "name": "祐漢新村第八街公共房屋項目",
        "reason": "夾心房屋 (sandwich-class), 澳門半島: no building yet — DSOP plans 「一幢樓高30層及3層地庫"
        "公共停車場的公共房屋，提供約250個住宅單位」 on a 1,875 m2 site, but only the 基礎及地庫 contract is "
        "awarded (新基業工程有限公司, 工程委託 11/2024, 預計竣工 12/2026) and the 上蓋 is tendered separately, "
        "so nothing stands. The 順利樓 blocks still mapped in OSM on this site are the ones it replaces, so "
        f"nothing here is drawn ({DSOP_IAO_HON})",
    },
]

# IH's Portuguese list has no record for 東民大廈 (46 of the 47 peninsula
# economic estates have one). The name below is what the Portuguese press used
# for the same building on 2026-08-04; it is not IH's own wording.
PT_NAME_FALLBACK = {"東民大廈": "Edifício Tong Man"}

# IH leaves `slug` empty on its four newest economic records, so those ids need
# a stable name of our own. Keyed by zh name; a slug IH later assigns wins.
SLUG_FALLBACK = {
    "東民大廈": "tong-man",
    "東城大廈": "tong-seng",
    "東啟大廈": "tong-kai",
    "東創大廈": "tong-chong",
}

# Per-estate corrections to the automatic OSM match. `osm` adds ids, `exclude`
# removes them, `polygon` claims every building inside a hand-drawn ring.
# Every id carries the reason it is here. Ids were read off the OSM data the
# name pass returns, cross-checked against the estate's fitted xp/yp point.
# As of 2026-09-10 no estate needs an id added or removed: every one of the 71
# IH estates, the six 新城A區 lots and the four `other` estates is reached by the
# name pass, and the three names that other buildings across Macau reuse
# (利民大廈, 威龍花園, 新樂大廈)
# are cut by the distance guard, not by hand. The one entry is a block-labelling
# opt-out, not a footprint change.
OSM_MATCH: dict[str, dict] = {
    # IH lists 美居廣場 as four 座 all occupied on 1992-02-01; OSM maps it as
    # three 期 (phase 3 being 嘉應花園, itself five 座). The two numbering
    # schemes are not published side by side, so no footprint gets a block
    # label here — every block shares the one date, so no shading is lost.
    "ihm:sh:building-15": {"no_block_map": "IH's four 座 do not correspond to OSM's three 期 / 嘉應花園 blocks"},
}

# OSM names that share a prefix with an estate but are not housing. Matched on
# the normalised Chinese name; a candidate containing any of these is dropped
# before the name pass, so no community centre / market / mall / sports centre
# is ever claimed as a block of flats.
NON_HOUSING_PATTERNS = (
    "社區中心", "街市", "商業中心", "工業大廈", "體育中心", "衛生中心", "公廁",
    "污水", "泵站", "學校", "幼稚園", "圖書館", "服務大樓", "綜合社區大樓",
    "社會及衛生服務大樓", "停車場", "街市市政綜合大樓", "活動中心", "會堂",
)

# `building` values that are never a residential block, used as a second filter
# on the claim-within pass (an unnamed shed on a podium is not a tower).
FOREIGN_BUILDING_KINDS = {
    "school", "kindergarten", "university", "college", "hospital", "church",
    "temple", "retail", "supermarket", "industrial", "warehouse", "garage",
    "garages", "parking", "hotel", "office", "public", "civic", "roof",
    "carport", "shed", "hut", "toilets", "service", "train_station",
}


# ----------------------------------------------------------------------------
# text helpers
# ----------------------------------------------------------------------------
CJK_RE = re.compile(r"[一-鿿]")
PUNCT_RE = re.compile(r"[\s\-–—－・·•,，。、．/／()（）\[\]「」『』:：;；_'\"]")
# 邨/村, 葱/蔥 and 匯/滙 are spelled both ways by IH and by OSM mappers (the last
# pair is 明珠都滙 on the government's side, 明珠都匯 on OSM's).
VARIANTS = str.maketrans({"村": "邨", "蔥": "葱", "廈": "廈", "滙": "匯"})


def norm(s: str | None) -> str:
    """Fold a Chinese name to its comparison form: NFKC, no punctuation or
    spacing, 村 -> 邨, 蔥 -> 葱, and no trailing IH asterisk."""
    s = unicodedata.normalize("NFKC", s or "").replace("*", "")
    return PUNCT_RE.sub("", s).translate(VARIANTS)


def zh_side(name: str | None) -> str:
    """The Chinese half of an OSM `name` like '樂群樓第1座 Edifício Lok Kuan
    Bloco I'. Cuts at the first Latin word of two or more letters, which is
    where the Portuguese/English half starts."""
    name = name or ""
    m = re.search(r"(?<![A-Za-z])[A-Za-zÀ-ÿ]{2,}", name)
    return (name[: m.start()] if m else name).strip()


def osm_zh_name(tags: dict) -> str:
    return tags.get("name:zh") or tags.get("name:zh-Hant") or zh_side(tags.get("name"))


PT_SMALL = {"de", "do", "da", "dos", "das", "e", "em", "no", "na", "a", "o",
            "as", "os", "ao", "aos", "à", "às"}
PT_ROMAN = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
            "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII"}
# All-caps words that are acronyms, not words, in IH's Portuguese names.
PT_ACRONYMS = {"ABC", "B.T.B"}


def title_pt(s: str | None) -> str:
    """IH writes the older Portuguese names and addresses in block capitals and
    the newer ones properly. Convert only the all-caps ones, conservatively:
    connective words go lowercase, Roman numerals, listed acronyms and dotted
    abbreviations of up to three letters keep their capitals, accents survive.
    A string that already has a lowercase letter is left exactly as published.
    """
    s = (s or "").replace("*", "").strip()
    if not s or any(c.islower() for c in s):
        return s
    out: list[str] = []
    for i, tok in enumerate(s.split(" ")):
        letters = re.sub(r"[^A-Za-zÀ-ÿ]", "", tok)
        if not letters:
            out.append(tok)
        elif tok in PT_ACRONYMS or letters in PT_ACRONYMS:
            out.append(tok)
        elif letters in PT_ROMAN:
            out.append(tok)
        elif "." in tok and len(letters) <= 3:
            out.append(tok)  # EDF., B.T.B
        else:
            low = tok.lower()
            # Only words of two letters or more go lowercase: a one-letter token
            # in one of IH's block-capital strings is a block designator
            # (TORRE A, BLOCO E), not the article "a"/"o"/"e".
            small = len(letters) >= 2 and low.strip(".,") in PT_SMALL
            out.append(low if i and small else low[:1].upper() + low[1:])
    return " ".join(out)


# ----------------------------------------------------------------------------
# block identity
# ----------------------------------------------------------------------------
CN_DIGITS = {"零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6,
             "七": 7, "八": 8, "九": 9}
ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50}


def cn_number(s: str) -> int | None:
    """一 -> 1, 十四 -> 14, 二十 -> 20. Only the small numbers block names use."""
    if not s:
        return None
    if "十" not in s:
        n = 0
        for ch in s:
            if ch not in CN_DIGITS:
                return None
            n = n * 10 + CN_DIGITS[ch]
        return n
    head, _, tail = s.partition("十")
    if head and head not in CN_DIGITS:
        return None
    if tail and any(ch not in CN_DIGITS for ch in tail):
        return None
    return (CN_DIGITS[head] if head else 1) * 10 + (int("".join(str(CN_DIGITS[c]) for c in tail)) if tail else 0)


def roman_number(s: str) -> int | None:
    if not s or any(ch not in ROMAN_VALUES for ch in s):
        return None
    total, prev = 0, 0
    for ch in reversed(s):
        v = ROMAN_VALUES[ch]
        total += -v if v < prev else v
        prev = max(prev, v)
    return total


NUMERAL = r"\d{1,2}|[零一二三四五六七八九十]{1,3}|[IVXL]{1,5}"
BLOCK_NUM_RE = re.compile(rf"第\s*({NUMERAL})\s*座")
# The same block number written without 第, which is how OSM spells the P-lot
# towers: "悅居 1 座". Digits and Chinese numerals only, and never after a letter
# or a digit, so A1座 stays the letter block ('a', 'A1') it already is and a
# lone Roman "V座" stays the letter block rather than becoming block 5.
BARE_BLOCK_NUM_RE = re.compile(r"(?<![A-Za-z0-9])(\d{1,2}|[零一二三四五六七八九十]{1,3})\s*座")
# 期 (phase) is deliberately a different token type from 座 (block): 利達新邨's
# two OSM buildings are 第一期/第二期 while IH lists 第01座/第02座, and which
# phase is which block is not published — better no label than a guessed one.
PHASE_NUM_RE = re.compile(rf"第\s*({NUMERAL})\s*期")
BLOCK_LETTER_RE = re.compile(r"(?<![A-Za-z])([A-Z]\d?)\s*座")
BLOCO_RE = re.compile(r"\bBLOCO\s+(\d{1,2}|[IVXL]{1,5})\b", re.I)
# A distinctive per-block name: 金來閣, 瑞安樓, 水仙苑, 偉興閣 …
SUBNAME_RE = re.compile(r"[一-鿿]{2,3}(?:閣|苑)|(?<![社公])[一-鿿]{2}樓")


def _numeral(tok: str) -> int | None:
    if tok.isdigit():
        return int(tok)
    n = cn_number(tok)
    return n if n is not None else roman_number(tok)


# A bare ordinal beside a block name: 青翠樓(I), 望善樓II, Edifício Mong Sin I.
PAREN_NUM_RE = re.compile(r"[（(]\s*([IVXL]{1,5}|\d{1,2})\s*[)）]")
TRAIL_ROMAN_RE = re.compile(r"([IVXL]{1,5})\s*$")


def block_keys(raw: str, latin: str = "") -> set[tuple[str, object]]:
    """Every identity token in a block or building name: block numbers (第5座,
    第V座, Bloco 5, 第五座), phase numbers (第一期), letters (A座, A1座),
    distinctive names (金來閣) and name+ordinal pairs (('sn', '望善樓', 2)).

    The pair matters where an estate's blocks differ only by a trailing Roman
    numeral — 望善樓(I) / 望善樓(II), 青翠樓(I) / 青翠樓(II) — because the bare
    name is then the same for both and gets dropped as ambiguous.
    """
    s = unicodedata.normalize("NFKC", raw or "").translate(VARIANTS)
    latin = latin or ""
    keys: set[tuple[str, object]] = set()
    nums: set[int] = set()
    for pattern in (BLOCK_NUM_RE, BARE_BLOCK_NUM_RE):
        for m in pattern.finditer(s):
            n = _numeral(m.group(1))
            if n:
                keys.add(("n", n))
                nums.add(n)
    for m in PHASE_NUM_RE.finditer(s):
        n = _numeral(m.group(1))
        if n:
            keys.add(("p", n))
    for m in BLOCK_LETTER_RE.finditer(s):
        keys.add(("a", m.group(1)))
    for m in BLOCO_RE.finditer(latin):
        n = _numeral(m.group(1).upper())
        if n:
            keys.add(("n", n))
            nums.add(n)
    for text in (s, latin):
        for m in PAREN_NUM_RE.finditer(text):
            n = _numeral(m.group(1).upper())
            if n:
                nums.add(n)
        m = TRAIL_ROMAN_RE.search(text.strip())
        if m:
            n = roman_number(m.group(1))
            if n:
                nums.add(n)
    for m in SUBNAME_RE.finditer(s):
        keys.add(("s", m.group(0)))
        for n in nums:
            keys.add(("sn", m.group(0), n))
    return keys


# ----------------------------------------------------------------------------
# IH pages
# ----------------------------------------------------------------------------
PUSH_RE = re.compile(r'self\.__next_f\.push\(\[\d+,\s*"')


def ih_get(url: str) -> str:
    IH_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = IH_CACHE_DIR / (hashlib.sha1(url.encode()).hexdigest() + ".html")
    if path.exists() and time.time() - path.stat().st_mtime < IH_CACHE_TTL_S:
        return path.read_text(encoding="utf-8")
    last = None
    for i in range(5):
        try:
            r = requests.get(
                url,
                headers={"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9,pt;q=0.8"},
                timeout=60,
            )
            if r.status_code == 200 and r.text:
                path.write_text(r.text, encoding="utf-8")
                return r.text
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = f"{type(e).__name__}: {e}"
        time.sleep(2 * (2**i))
    raise UpstreamError(f"GET {url} failed: {last}")


def flight_payload(html: str) -> str:
    """Re-assemble the RSC flight payload from the `self.__next_f.push([1,"…"])`
    script chunks: each chunk is a JSON string literal and the payload is their
    concatenation."""
    parts: list[str] = []
    for m in PUSH_RE.finditer(html):
        start = m.end() - 1  # the opening quote of the literal
        i, esc = start + 1, False
        while i < len(html):
            c = html[i]
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                break
            i += 1
        try:
            parts.append(json.loads(html[start : i + 1]))
        except ValueError:
            continue
    return "".join(parts)


def json_arrays_after(s: str, key: str):
    """Yield every JSON array that follows `key` in `s` (the payload is not
    valid JSON as a whole, so the array has to be bracket-matched by hand)."""
    at = 0
    while True:
        i = s.find(key, at)
        if i < 0:
            return
        at = i + 1
        start = i + len(key) - 1
        depth, in_str, esc, j = 0, False, False, start
        while j < len(s):
            c = s[j]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        try:
            yield json.loads(s[start : j + 1])
        except ValueError:
            continue


def estate_list(html: str, url: str) -> list[dict]:
    payload = flight_payload(html)
    if not payload:
        raise UpstreamError(f"{url}: no self.__next_f.push payload — the page is no longer a Next.js RSC render")
    found = None
    for arr in json_arrays_after(payload, '"list":['):
        if isinstance(arr, list) and any(isinstance(d, dict) and d.get("postType") == "building" for d in arr):
            found = arr
    if found is None:
        raise UpstreamError(f"{url}: the RSC payload has no \"list\" array of postType=building records")
    return found


def blocks_of(post: dict) -> list[dict]:
    rel = [p for p in post.get("relatedPosts", []) if isinstance(p, dict) and p.get("postType") == "building-block"]
    return sorted(rel, key=lambda p: p.get("order") or 0)


def fetch_ih(kind: str) -> dict[str, dict]:
    """{IH post id: record} for one list (zh + pt, all three regions)."""
    base = IH_SOCIAL if kind == "SH" else IH_ECONOMIC
    out: dict[str, dict] = {}
    for ioc in ("M", "T", "C"):
        q = "" if ioc == "M" else f"?ioc={ioc}"
        zh = estate_list(ih_get(base + q), base + q)
        pt_url = base.replace("/zh/", "/pt/") + q
        pt_by_id = {p["id"]: p for p in estate_list(ih_get(pt_url), pt_url) if isinstance(p, dict)}
        for post in zh:
            if not isinstance(post, dict) or post.get("postType") != "building":
                continue
            metas = post.get("metas") or {}
            p = pt_by_id.get(post["id"])
            pblocks = blocks_of(p) if p else []
            zblocks = blocks_of(post)
            out[post["id"]] = {
                "kind": kind,
                "ioc": (metas.get("ioc") or ioc).upper(),
                "id": post["id"],
                "slug": (post.get("slug") or "").strip(),
                "name_zh": (post.get("postTitle") or "").strip(),
                "name_pt": ((p or {}).get("postTitle") or "").strip(),
                "addr_zh": strip_html(metas.get("address")),
                "addr_pt": strip_html(((p or {}).get("metas") or {}).get("address")),
                "xp": to_float(metas.get("xp")),
                "yp": to_float(metas.get("yp")),
                "url": base + q,
                "url_pt": pt_url,
                "blocks": [
                    {
                        "zh": (b.get("postTitle") or "").strip(),
                        "pt": ((pblocks[i].get("postTitle") if i < len(pblocks) else "") or "").strip(),
                        "date": (b.get("inputAt") or "")[:10],
                    }
                    for i, b in enumerate(zblocks)
                ],
            }
        print(f"  {kind} ioc={ioc}: {len(zh)} estates ({len(pt_by_id)} with a Portuguese record)")
    return out


def strip_html(s: object) -> str:
    if not isinstance(s, str):
        return ""
    s = re.sub(r"<[^>]*>", "", s)
    s = s.replace("&quot;", '"').replace("&amp;", "&").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", s).strip()


def to_float(v: object) -> float | None:
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


# ----------------------------------------------------------------------------
# estate records
# ----------------------------------------------------------------------------
# An estate whose own name pins it to some blocks of a bigger, mixed estate:
# 新城市花園第17座 (the one social block of an otherwise economic estate) and
# 濠江花園第3/4/5座 (three social blocks of a private estate).
NAME_BLOCK_SPEC_RE = re.compile(r"第\s*([\d一二三四五六七八九十IVX/、,，及]+)\s*座\s*$")


def estate_block_restriction(name_zh: str) -> tuple[str, set[tuple[str, object]]]:
    """('新城市花園第17座') -> ('新城市花園', {('n', 17)})."""
    m = NAME_BLOCK_SPEC_RE.search(name_zh)
    if not m:
        return name_zh, set()
    keys: set[tuple[str, object]] = set()
    for tok in re.split(r"[/、,，及]", m.group(1)):
        tok = tok.strip()
        if not tok:
            continue
        n = _numeral(tok)
        if n:
            keys.add(("n", n))
    return (name_zh[: m.start()].strip(), keys) if keys else (name_zh, set())


def split_group(name: str) -> list[str]:
    """IH puts several physical blocks in one row when they share a date:
    '第1座、第2座、第3座' and '青翠樓(I)、青翠樓(II)', whose Portuguese column is
    'BLOCO 1, BLOCO 2, BLOCO 3' with plain commas. Split them so a footprint can
    be matched to the block it actually is."""
    parts = [p.strip() for p in re.split(r"[、，,]", name or "") if p.strip()]
    return parts or ([name.strip()] if name and name.strip() else [])


def build_estate(rec: dict) -> dict:
    """One IH list record -> the estate shape this file writes, minus OSM."""
    name_zh_raw = rec["name_zh"]
    partial = "*" in name_zh_raw or "*" in (rec["name_pt"] or "")
    name_zh = name_zh_raw.replace("*", "").strip()
    name_pt = title_pt(rec["name_pt"]) or PT_NAME_FALLBACK.get(name_zh, "")
    slug = rec["slug"] or SLUG_FALLBACK.get(name_zh) or f"post-{rec['id'][:8]}"
    prefix = "sh" if rec["kind"] == "SH" else "eh"

    blocks: list[dict] = []
    for b in rec["blocks"]:
        date = b["date"] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", b["date"] or "") else None
        year = int(date[:4]) if date else None
        zh_parts = split_group(b["zh"])
        pt_parts = split_group(b["pt"])
        for i, zh in enumerate(zh_parts):
            # IH writes "--" where an estate is a single building with no block
            # name of its own; the estate name is the building name there, in
            # both languages. A named block whose Portuguese IH does not
            # publish gets "", not the estate's name, which would label every
            # block of 東民大廈 "Edifício Tong Man".
            placeholder = zh in ("--", "-", "")
            # Only pair the Portuguese block names when the two columns split
            # into the same number of parts; a mismatch means IH wrote them
            # differently and guessing the pairing would mislabel a footprint.
            pt_raw = pt_parts[i] if len(pt_parts) == len(zh_parts) else ""
            blocks.append({
                "name": {
                    "zh": name_zh if placeholder else zh,
                    "pt": name_pt if placeholder or pt_raw in ("--", "-") else title_pt(pt_raw),
                },
                "year": year,
                "date": date,
            })

    years = [b["year"] for b in blocks if b["year"] is not None]
    year = min(years) if years else None
    units, storeys, note = UNITS_STOREYS.get(name_zh_raw, (None, None, ""))
    sources = [rec["url"]]
    if rec["url_pt"] not in sources:
        sources.append(rec["url_pt"])
    if "progress" in note:
        sources.append(IH_PROGRESS)
    if "node-72" in note:
        sources.append(IH_MANAGED)

    base_name, restrict = estate_block_restriction(name_zh)
    return {
        "id": f"ihm:{prefix}:{slug}",
        "name": {"zh": name_zh, "pt": name_pt},
        "type": "social" if rec["kind"] == "SH" else "economic",
        # `category` names the programme, and only the `other` types have one:
        # an IH estate is 社屋 or 經屋 and that is what `type` already says.
        "category": None,
        "district": IOC_DISTRICT.get(rec["ioc"], "macau"),
        "address": {"zh": rec["addr_zh"], "pt": title_pt(rec["addr_pt"])},
        "year": year,
        "yearKind": "occupation" if year is not None else None,
        "status": "occupied" if year is not None else "completed",
        "partial": partial,
        "units": units,
        "storeys": storeys,
        "blocks": blocks,
        "sources": sources,
        "_base_name": base_name,
        "_restrict": restrict,
        "_xp": rec["xp"],
        "_yp": rec["yp"],
        "_extra_anchors": [],
    }


def build_extra(spec: dict) -> dict:
    """One `EXTRA_ESTATES` / `OTHER_ESTATES` row -> the same estate shape.

    `blocks` is a plain list of Chinese block names ("第1座"): these estates are
    on no IH list, so there is no per-block 入伙 date behind them — the names
    exist only so a footprint can be labelled with the block it is.
    """
    return {
        "id": spec["id"],
        "name": {"zh": spec["name_zh"], "pt": spec["name_pt"]},
        "type": spec["type"],
        "category": spec.get("category"),
        "district": spec["district"],
        "address": {"zh": spec["addr_zh"], "pt": spec["addr_pt"]},
        "year": spec["year"],
        "yearKind": spec["yearKind"],
        "status": spec["status"],
        "partial": False,
        "units": spec["units"],
        "storeys": spec["storeys"],
        "blocks": [{"name": {"zh": zh, "pt": ""}, "year": None, "date": None} for zh in spec.get("blocks", [])],
        "sources": list(spec["sources"]),
        "_base_name": spec["name_zh"],
        "_restrict": set(),
        "_xp": None,
        "_yp": None,
        "_extra_anchors": list(spec["anchors"]),
        # Storey count used for the 3D height when `storeys` is None because
        # the published figures disagree (悅居 / 樂居). Never serialised.
        "_height_storeys": spec.get("heightStoreys"),
    }


# ----------------------------------------------------------------------------
# name matching
# ----------------------------------------------------------------------------
def estate_anchors(est: dict) -> list[tuple[str, bool]]:
    """[(normalised anchor, is_strong)]. A strong anchor is the estate's own
    full name — enough on its own. A weak anchor (the tail after a dash, one
    half of a "X及Y" tail, a distinctive block name) only counts near the
    estate, because those names are short and can repeat across Macau."""
    out: list[tuple[str, bool]] = []
    full = norm(est["name"]["zh"])
    if full:
        out.append((full, True))
    base = norm(est["_base_name"])
    if base and base != full:
        out.append((base, True))
    for extra in est["_extra_anchors"]:
        out.append((norm(extra), True))
    # tail after the last dash: 石排灣社屋-樂群樓 -> 樂群樓, and the halves of
    # 快意樓及快富樓
    tail = re.split(r"[-–—－]", est["name"]["zh"])[-1].strip()
    tails = [tail] if tail else []
    if "及" in tail:
        tails += [t for t in tail.split("及") if t]
    for t in tails:
        n = norm(t)
        if n and n != full and len(n) >= 3:
            out.append((n, False))
    for b in est["blocks"]:
        n = norm(b["name"]["zh"])
        # only distinctive block names, never bare 第1座 / A座
        if len(n) >= 3 and not BLOCK_NUM_RE.fullmatch(n) and not BLOCK_LETTER_RE.fullmatch(n):
            if n != full:
                out.append((n, False))
        sub = SUBNAME_RE.findall(unicodedata.normalize("NFKC", b["name"]["zh"]))
        for s in sub:
            if len(s) >= 3:
                out.append((norm(s), False))
    seen: set[str] = set()
    uniq: list[tuple[str, bool]] = []
    for a, strong in sorted(out, key=lambda x: (-len(x[0]), x[0])):
        if a and a not in seen:
            seen.add(a)
            uniq.append((a, strong))
    return uniq


def is_housing_candidate(el: dict) -> bool:
    tags = el.get("tags") or {}
    if el.get("type") not in ("way", "relation"):
        return False
    if not tags.get("building"):
        return False
    nz = norm(osm_zh_name(tags))
    if not nz:
        return False
    return not any(p in nz for p in NON_HOUSING_PATTERNS)


def element_point(el: dict) -> tuple[float, float] | None:
    c = el.get("center")
    if isinstance(c, dict) and "lon" in c and "lat" in c:
        return (c["lon"], c["lat"])
    if "lon" in el and "lat" in el:
        return (el["lon"], el["lat"])
    return None


def match_by_name(estates: list[dict], elements: list[dict]) -> tuple[dict[str, dict[str, str]], list[dict], dict]:
    """Three passes over the named buildings.

    1. Strong anchors with no ambiguity — a name that matches exactly one
       estate at its longest anchor. These need no geography and are what the
       xp/yp fit is then built on.
    2. Strong anchors that matched several estates (two estates really are both
       called 威翠花園), resolved by the fit.
    3. Weak anchors (a dash tail or a block name), which are short enough to
       repeat elsewhere in Macau and are therefore only accepted near the
       estate.

    Finally every claim more than CLAIM_MAX_DIST_M from the estate's fitted
    point is dropped: three estate names (利民大廈, 威龍花園, 新樂大廈) are
    reused by unrelated buildings across town.

    Returns ({estate id: {osm id: how}}, [ambiguous], {estate id: fitted point}).
    """
    anchors: dict[str, list[tuple[str, bool]]] = {e["id"]: estate_anchors(e) for e in estates}
    by_id = {e["id"]: e for e in estates}
    claims: dict[str, dict[str, str]] = {e["id"]: {} for e in estates}
    owner: dict[str, str] = {}
    ambiguous: list[dict] = []

    cands = [el for el in elements if is_housing_candidate(el)]
    print(f"  {len(cands)} named building candidates after dropping non-housing names")

    def candidates_for(el: dict, strong_only: bool) -> list[tuple[str, str]]:
        """Estates whose anchor matches this building's Chinese name, keeping
        only the best ones: longest anchor first, and an estate pinned to
        certain block numbers (新城市花園第17座) beats the estate that merely
        shares the base name when the building carries one of those numbers."""
        tags = el["tags"]
        nz = norm(osm_zh_name(tags))
        keys = block_keys(osm_zh_name(tags), tags.get("name") or "")
        best: tuple[int, int] = (0, 0)
        hits: list[tuple[str, str]] = []
        for eid, alist in anchors.items():
            for anchor, strong in alist:
                if strong is not strong_only or not nz.startswith(anchor):
                    continue
                restrict = by_id[eid]["_restrict"]
                pinned = bool(restrict and (keys & restrict))
                if restrict and not pinned:
                    continue
                score = (len(anchor), 1 if pinned else 0)
                if score > best:
                    best, hits = score, [(eid, anchor)]
                elif score == best:
                    hits.append((eid, anchor))
                break
        return hits

    def try_pass(strong_only: bool, fitted: dict | None, resolve_ties: bool) -> None:
        for el in cands:
            oid = f"{el['type'][0]}{el['id']}"
            if oid in owner:
                continue
            hits = candidates_for(el, strong_only)
            if not hits:
                continue
            if len(hits) > 1 or not strong_only:
                if not resolve_ties:
                    continue  # wait for the fit
                hits = nearest_estate(hits, element_point(el), claims, fitted)
            if len(hits) != 1:
                if len(hits) > 1:
                    ambiguous.append({"osm": oid, "name": el["tags"].get("name", ""), "estates": [h[0] for h in hits]})
                continue
            eid, anchor = hits[0]
            claims[eid][oid] = anchor
            owner[oid] = eid

    try_pass(True, None, resolve_ties=False)
    fitted = fit_xy_to_lnglat(estates, claims)
    try_pass(True, fitted, resolve_ties=True)
    try_pass(False, fitted, resolve_ties=True)

    if FIT_RMS_M <= FIT_MAX_RMS_M:
        for eid, m in claims.items():
            ref = fitted.get(eid)
            if ref is None:
                continue
            rx, ry = metres_xy(ref[0], ref[1], LAT0)
            for oid in list(m):
                p = _POINTS.get(oid)
                if p is None:
                    continue
                px, py = metres_xy(p[0], p[1], LAT0)
                d = ((px - rx) ** 2 + (py - ry) ** 2) ** 0.5
                if d > CLAIM_MAX_DIST_M:
                    print(f"  dropping {oid} from {eid}: {d:.0f} m from IH's own map point")
                    m.pop(oid)
                    owner.pop(oid, None)
    return claims, ambiguous, fitted


def nearest_estate(hits, pt, claims, fitted) -> list:
    """Keep the single nearest estate when a name matches more than one, or when
    the anchor was weak. Distance is to the estate's already-claimed buildings
    if it has any, else to its fitted xp/yp point."""
    if pt is None:
        return hits if len(hits) == 1 else []
    px, py = metres_xy(pt[0], pt[1], LAT0)
    scored: list[tuple[float, tuple]] = []
    for eid, anchor in hits:
        ref = claims_centre(eid, claims) or (fitted or {}).get(eid)
        if ref is None:
            continue
        rx, ry = metres_xy(ref[0], ref[1], LAT0)
        scored.append((((px - rx) ** 2 + (py - ry) ** 2) ** 0.5, (eid, anchor)))
    if not scored:
        return hits if len(hits) == 1 else []
    scored.sort(key=lambda s: s[0])
    if scored[0][0] > FIT_MAX_DIST_M:
        return []
    if len(scored) > 1 and scored[1][0] < max(2 * scored[0][0], scored[0][0] + 80):
        return [s[1] for s in scored[:2]]  # too close to call
    return [scored[0][1]]


_POINTS: dict[str, tuple[float, float]] = {}


def claims_centre(eid: str, claims: dict[str, dict[str, str]]) -> tuple[float, float] | None:
    pts = [_POINTS[o] for o in claims.get(eid) or {} if o in _POINTS]
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def assign_blocks(est: dict, recs: list[dict]) -> None:
    """Tag each footprint with the IH block it is, so the overlay can shade a
    block by its own occupation year. A distinctive name (金來閣) wins over a
    number, because the numbers repeat between phases; an estate IH lists as a
    single building takes that one block for every footprint it owns."""
    if OSM_MATCH.get(est["id"], {}).get("no_block_map"):
        for rec in recs:
            rec["_block"] = rec["_year"] = None
        return
    # A key two blocks share identifies neither, so it is dropped rather than
    # silently resolved to whichever block came first.
    counts: dict[tuple[str, object], list[dict]] = {}
    for b in est["blocks"]:
        for k in block_keys(b["name"]["zh"], b["name"]["pt"]):
            counts.setdefault(k, []).append(b)
    by_key = {k: v[0] for k, v in counts.items() if len(v) == 1}
    for rec in recs:
        # `_zh` is the OSM name:zh where there is one: a few towers carry only
        # "第一座 Bloco 1" in `name` but the full 廣華新邨(第一座) in name:zh.
        keys = block_keys(rec.get("_zh") or rec.get("name") or "", rec.get("name") or "")
        hit = None
        # name+ordinal first, then a distinctive name, then a bare number
        for k in sorted(keys, key=lambda k: ({"sn": 0, "s": 1}.get(k[0], 2), k)):  # total order, so ties never depend on the hash seed
            if k in by_key:
                hit = by_key[k]
                break
        if hit is None and len(est["blocks"]) == 1:
            hit = est["blocks"][0]
        rec["_block"] = hit["name"]["zh"] if hit else None
        rec["_year"] = hit["year"] if hit else None


def claims_spread_m(eid: str, claims: dict[str, dict[str, str]]) -> float:
    """Widest distance between two of an estate's claimed buildings."""
    pts = [metres_xy(p[0], p[1], LAT0) for p in (_POINTS[o] for o in claims.get(eid) or {} if o in _POINTS)]
    return max(
        (((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 for a in pts for b in pts),
        default=0.0,
    )


# ----------------------------------------------------------------------------
# IH's xp/yp grid -> WGS84
# ----------------------------------------------------------------------------
def _residuals_m(A, B, coef) -> np.ndarray:
    pred = A @ coef
    dx = np.array([metres_xy(p[0] - b[0], 0, LAT0)[0] for p, b in zip(pred, B)])
    dy = np.array([metres_xy(0, p[1] - b[1], LAT0)[1] for p, b in zip(pred, B)])
    return np.hypot(dx, dy)


def fit_xy_to_lnglat(estates, claims) -> dict[str, tuple[float, float]]:
    """Least-squares affine fit of IH's DSCC grid (metas.xp/yp) onto the estates
    the unambiguous name pass already placed, then the fitted point for every
    estate. Two guards keep the fit honest: an estate whose claimed buildings
    are scattered (a name reused across town) is left out, and the fit is
    re-run without its own outliers. The caller refuses to place an estate from
    the fit alone once the RMS goes over FIT_MAX_RMS_M."""
    global FIT_RMS_M
    rows, targets, ids = [], [], []
    for est in estates:
        xp, yp = est["_xp"], est["_yp"]
        if xp is None or yp is None or abs(xp) > 1e6 or abs(yp) > 1e6:
            continue  # IH's 望信樓 record has a corrupt (-38480519, -2453893)
        c = claims_centre(est["id"], claims)
        if c is None or claims_spread_m(est["id"], claims) > FIT_MAX_SPREAD_M:
            continue
        rows.append([xp, yp, 1.0])
        targets.append([c[0], c[1]])
        ids.append(est["id"])
    fitted: dict[str, tuple[float, float]] = {}
    FIT_RMS_M = float("inf")
    if len(rows) < 8:
        print(f"  xp/yp fit skipped: only {len(rows)} anchored estates", file=sys.stderr)
        return fitted
    A, B = np.array(rows), np.array(targets)
    keep = np.ones(len(rows), dtype=bool)
    coef = None
    for _ in range(6):
        coef, *_ = np.linalg.lstsq(A[keep], B[keep], rcond=None)
        res = _residuals_m(A[keep], B[keep], coef)
        rms = float(np.sqrt(np.mean(res**2)))
        drop = res > max(3 * rms, 60.0)
        if not drop.any() or keep.sum() - drop.sum() < 10:
            break
        idx = np.flatnonzero(keep)[drop]
        keep[idx] = False
    res = _residuals_m(A[keep], B[keep], coef)
    FIT_RMS_M = float(np.sqrt(np.mean(res**2)))
    print(
        f"  xp/yp -> WGS84 affine fit on {int(keep.sum())} of {len(rows)} anchored estates: "
        f"RMS {FIT_RMS_M:.1f} m, worst {res.max():.0f} m"
    )
    for est in estates:
        xp, yp = est["_xp"], est["_yp"]
        if xp is None or yp is None or abs(xp) > 1e6 or abs(yp) > 1e6:
            continue
        p = np.array([xp, yp, 1.0]) @ coef
        fitted[est["id"]] = (float(p[0]), float(p[1]))
    return fitted


FIT_RMS_M = float("inf")


# ----------------------------------------------------------------------------
# Overpass
# ----------------------------------------------------------------------------
def fetch_named_buildings() -> list[dict]:
    print("Fetching every named building in Macau (Overpass)")
    els = overpass(f'[out:json][timeout:180];nwr["building"]["name"](area:{MACAU_AREA});out tags center;')
    print(f"  {len(els)} named buildings")
    return els


def fetch_geometry(osm_ids: list[str]) -> dict[str, dict]:
    """`out geom` for the claimed features only, in chunks."""
    out: dict[str, dict] = {}
    ways = sorted({int(o[1:]) for o in osm_ids if o.startswith("w")})
    rels = sorted({int(o[1:]) for o in osm_ids if o.startswith("r")})
    for i in range(0, len(ways), 250):
        chunk = ways[i : i + 250]
        for el in overpass(f"[out:json][timeout:180];way(id:{','.join(map(str, chunk))});out tags geom;"):
            out[f"w{el['id']}"] = el
        print(f"  geometry for ways {i + 1}-{i + len(chunk)}")
    if rels:
        # `out geom`, not `out tags geom`: the tags-only verbosity drops a
        # relation's members, and a multipolygon building is nothing but its
        # members (verified on r18182569, 政府長者公寓).
        for el in overpass(f"[out:json][timeout:180];rel(id:{','.join(map(str, rels))});out geom;"):
            out[f"r{el['id']}"] = el
        print(f"  geometry for {len(rels)} relations")
    return out


def records_from_element(el: dict) -> list[dict]:
    """Building record(s) for one claimed OSM feature.

    A way is the usual case. A relation is a building mapped as a multipolygon —
    政府長者公寓 is one outer ring around a courtyard — and its outer ring(s) are
    extruded one record each, the way `fetch_water_facilities.py` does it, all
    carrying the relation's own id, name and height tags. Inner rings are not
    cut out: every footprint in this pipeline is an outer ring.
    """
    if el["type"] == "way":
        rec = building_record(el, LAT0)
        return [rec] if rec else []
    poly = polygon_of_element(el)
    if poly is None or poly.is_empty:
        return []
    tags = el.get("tags") or {}
    h, mh = parse_height(tags)
    geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
    out: list[dict] = []
    for i, g in enumerate(geoms):
        if g.geom_type != "Polygon" or g.is_empty:
            continue
        out.append({
            "osmId": f"r{el['id']}" + (f"#{i}" if i else ""),
            "name": tags.get("name") or None,
            "kind": tags.get("building") or "yes",
            "height": round(h + EXTRA_HEIGHT_M, 1),
            "minHeight": mh,
            "coordinates": buffered_footprint(g, LAT0),
            "_poly": g,
        })
    return out


def fetch_buildings_in(polys: list) -> list[dict]:
    """Every building way inside any of the given polygons (chunked)."""
    found: dict[int, dict] = {}
    for i in range(0, len(polys), POLY_CHUNK):
        chunk = polys[i : i + POLY_CHUNK]
        parts = []
        for poly in chunk:
            geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
            for g in geoms:
                ring = " ".join(f"{y:.6f} {x:.6f}" for x, y in g.exterior.coords)
                parts.append(f'way["building"](poly:"{ring}");')
        els = overpass(f"[out:json][timeout:180];({''.join(parts)});out tags geom;")
        for el in els:
            found[el["id"]] = el
        print(f"  claim polygons {i + 1}-{i + len(chunk)}: {len(els)} building ways")
    return list(found.values())


# ----------------------------------------------------------------------------
# storey fallback for towers nothing publishes a height for
# ----------------------------------------------------------------------------
# Metres per storey used only when this run's own sample is too small to trust
# (see `storey_height_m`). 3.1 m is the median that sample gave on 2026-09-10
# (77 footprints, 3.111 m), rounded — a documented constant, not a guess.
STOREY_HEIGHT_FALLBACK_M = 3.1
STOREY_SAMPLE_MIN = 5


def lead_num(v: object) -> float | None:
    """Leading number of an OSM tag value, or None — the same lenient parse
    `parse_height` uses, so "20;21" and "20 m" both read as 20."""
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)", str(v or "").replace(",", "."))
    return float(m.group(1)) if m else None


def mark_height_source(rec: dict, tags: dict) -> dict:
    """Note where a footprint's height came from, on the record itself.

    `_height_default` is True when nothing published a height and the record
    therefore sits at the OpenMapTiles 5 m default: no OSM `height`, no OSM
    `building:levels`, and (after the re-cut) no basemap part height either.
    These are working fields like `_poly` and `_block` — `strip_private`-style
    `_` names that never reach the file, so the output contract is unchanged.
    """
    lv = lead_num(tags.get("building:levels"))
    rec["_levels"] = lv if lv and lv > 0 else None
    rec["_osm_height"] = lead_num(tags.get("height")) is not None
    rec["_height_default"] = rec["_levels"] is None and not rec["_osm_height"]
    return rec


def storey_height_m(records: dict[str, list[dict]]) -> float:
    """Metres per storey, measured on this run's own footprints.

    height / `building:levels` over every claimed footprint that has both a
    real height (OSM's or the basemap's) and an OSM levels count; the median,
    not the mean — a handful of ratios are nonsense (a levels tag counting
    only the podium's floors under a tower height). Two exclusions:

      * one sample per OSM way, taking the way's tallest part. A way re-cut
        into a podium part and a tower part carries the same levels tag on
        both, and the podium part alone would drag the ratio down (信達廣場
        第3座 is cut into a 14 m and a 73 m part, both tagged 22 levels).
      * a height that IS `building:levels` x LEVEL_HEIGHT_M, with no `height`
        tag behind it, is circular evidence: it would only re-measure
        OpenMapTiles' own 3.66 m constant.

    Macau's public housing came out at 3.11 m/storey over 77 footprints on
    2026-09-10. Under `STOREY_SAMPLE_MIN` samples the run keeps its hands off
    the measurement and uses `STOREY_HEIGHT_FALLBACK_M`.
    """
    tallest: dict[str, dict] = {}
    for recs in records.values():
        for r in recs:
            if r["_height_default"] or r["_levels"] is None:
                continue
            best = tallest.get(r["_osm"])
            if best is None or r["height"] > best["height"]:
                tallest[r["_osm"]] = r
    ratios = sorted(
        r["height"] / r["_levels"]
        for r in tallest.values()
        if r["_osm_height"] or r["height"] != math.ceil(r["_levels"] * LEVEL_HEIGHT_M - 1e-9)
    )
    if len(ratios) < STOREY_SAMPLE_MIN:
        print(
            f"  storey height: only {len(ratios)} usable footprints "
            f"(< {STOREY_SAMPLE_MIN}) — using the documented {STOREY_HEIGHT_FALLBACK_M} m/storey"
        )
        return STOREY_HEIGHT_FALLBACK_M
    median = float(np.median(ratios))
    print(
        f"  storey height: {median:.3f} m/storey (median of {len(ratios)} footprints "
        f"with both a real height and building:levels; range {ratios[0]:.2f}-{ratios[-1]:.2f})"
    )
    return median


def raise_default_height_towers(estates: list[dict], records: dict[str, list[dict]], per_storey: float) -> None:
    """Give the towers nothing publishes a height for `storeys` x `per_storey`.

    Only footprints left at the 5 m default (`_height_default`) are touched,
    and only where the footprint is a *tower* rather than the podium or base
    slab under one:

      * a footprint mapped to an IH block is a tower, unless another footprint
        of that same block already stands at a real height — then this one is
        the block's podium or its base slab (東創大廈's 5,553 m2 outline under
        two 101 m towers; 信達廣場 第1座's platform beside its 67 m tower);
      * a footprint with no block is a tower only for an estate that has at
        most one block, claims a single OSM feature, and has no footprint at a
        real height at all — the 新城A區 lots, where OSM has one outline for
        the whole plot and nothing else stands for the towers, and 政府長者公寓,
        whose two unnamed towers are one OSM multipolygon. For an estate
        with several blocks an unlabelled default-height footprint is the
        podium the labelled blocks sit on (望德樓's 7,146 m2 deck, 青洲坊大廈's
        13,118 m2 deck, 東華新邨's 16,533 m2 deck), so it keeps its 5 m.

    An estate with no `storeys` figure (nobody publishes one, or only a range
    over blocks of different heights — the IH estates noted in `UNITS_STOREYS`)
    keeps the default: the storey count is the publisher's, never guessed. The
    one exception is a row carrying `heightStoreys` (悅居 / 樂居, whose eight
    towers are published only as "37 to 50" and whose per-lot figures
    contradict each other): that documented figure sets the 3D height while
    the panel's `storeys` stays null, because a 5 m slab is the bigger lie. Where
    an estate's blocks differ in height IH's single figure is the estate's, so
    every raised block of it gets the same height — better one documented
    number than a per-block guess. `minHeight` stays 0: these towers rise from
    the ground, and the podium they share is a separate footprint.
    """
    raised: list[tuple[str, str, int, float]] = []
    skipped: list[str] = []
    for est in estates:
        recs = records[est["id"]]
        defaults = [r for r in recs if r["_height_default"]]
        if not defaults:
            continue
        real_blocks = {r.get("_block") for r in recs if not r["_height_default"] and r.get("_block")}
        estate_has_real = any(not r["_height_default"] for r in recs)
        single_way = len({r["_osm"] for r in recs}) == 1
        for r in defaults:
            block = r.get("_block")
            if block:
                if block in real_blocks:
                    continue
            elif not (len(est["blocks"]) <= 1 and single_way and not estate_has_real):
                continue
            storeys = est["storeys"] if est["storeys"] is not None else est.get("_height_storeys")
            if storeys is None:
                skipped.append(f"{est['name']['zh']} · {block or r['osmId']}")
                continue
            r["height"] = round(storeys * per_storey + EXTRA_HEIGHT_M, 1)
            r["minHeight"] = 0.0
            raised.append((est["name"]["zh"], block or "(estate outline)", storeys, r["height"]))
    print(f"  {len(raised)} tower footprints raised from the {DEFAULT_RENDER_HEIGHT_M:g} m default")
    for name, block, storeys, height in raised:
        print(f"    {name} · {block}: {storeys} storeys -> {height} m")
    if skipped:
        print(f"  {len(skipped)} left at the default because IH publishes no storey count: {skipped}")


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def run() -> int:
    print("Fetching IH 社會房屋 / 經濟房屋 位置分佈")
    social = fetch_ih("SH")
    economic = fetch_ih("EH")
    if len(social) < MIN_SOCIAL or len(economic) < MIN_ECONOMIC:
        print(
            f"ERROR: IH listed {len(social)} social / {len(economic)} economic estates "
            f"(expected >= {MIN_SOCIAL} / {MIN_ECONOMIC}). The list moved — check the pages "
            "by hand rather than re-running.",
            file=sys.stderr,
        )
        return 1

    estates = [build_estate(r) for r in list(social.values()) + list(economic.values())]
    estates += [build_extra(spec) for spec in EXTRA_ESTATES + OTHER_ESTATES]
    # Estates pinned to particular blocks of a bigger estate go first, so the
    # social 新城市花園第17座 owns block 17 before the economic 新城市花園 sees it.
    estates.sort(key=lambda e: (not e["_restrict"], e["id"]))
    print(f"  {len(estates)} estates ({sum(1 for e in estates if e['type'] == 'social')} social)")

    elements = fetch_named_buildings()
    for el in elements:
        p = element_point(el)
        if p:
            _POINTS[f"{el['type'][0]}{el['id']}"] = p

    claims, ambiguous, fitted = match_by_name(estates, elements)

    # --- hand table -----------------------------------------------------------
    owner = {oid: eid for eid, m in claims.items() for oid in m}
    for eid, spec in OSM_MATCH.items():
        if eid not in claims:
            print(f"  WARNING: OSM_MATCH has an unknown estate id {eid}", file=sys.stderr)
            continue
        for oid in spec.get("osm", {}):
            if owner.get(oid) not in (None, eid):
                print(f"  WARNING: {oid} is already claimed by {owner[oid]}, not adding to {eid}", file=sys.stderr)
                continue
            claims[eid][oid] = "hand"
            owner[oid] = eid
        for oid in spec.get("exclude", []):
            claims[eid].pop(oid, None)
            if owner.get(oid) == eid:
                owner.pop(oid)

    matched_ids = sorted({oid for m in claims.values() for oid in m})
    print(f"Fetching geometry for {len(matched_ids)} matched footprints")
    geom = fetch_geometry(matched_ids)

    # --- footprints -----------------------------------------------------------
    records: dict[str, list[dict]] = {e["id"]: [] for e in estates}
    poly_of: dict[str, Polygon] = {}
    for eid, m in claims.items():
        for oid in m:
            el = geom.get(oid)
            if not el:
                print(f"  no geometry for {oid} ({eid})", file=sys.stderr)
                continue
            recs = records_from_element(el)
            if not recs:
                print(f"  no usable geometry for {oid} ({eid})", file=sys.stderr)
                continue
            for rec in recs:
                rec["_osm"] = oid
                rec["_zh"] = osm_zh_name(el.get("tags") or {})
                mark_height_source(rec, el.get("tags") or {})
                records[eid].append(rec)
                poly_of[rec["osmId"]] = rec["_poly"]

    # --- claim-within ---------------------------------------------------------
    # A named podium with unnamed towers on it (湖畔大廈) is one OSM building
    # with several buildings standing inside its outline.
    podium_polys, podium_owner = [], []
    for eid, recs in records.items():
        for rec in recs:
            area_m2 = abs(rec["_poly"].area) * (111320.0 ** 2) * 0.9273  # cos(22.16 deg)
            if area_m2 >= PODIUM_MIN_AREA_M2:
                podium_polys.append(rec["_poly"])
                podium_owner.append((eid, rec))
    for eid, spec in OSM_MATCH.items():
        ring = spec.get("polygon")
        if ring and eid in records:
            poly = Polygon(ring)
            podium_polys.append(poly)
            podium_owner.append((eid, None))
    print(f"Claim-within: {len(podium_polys)} polygons")
    inner = fetch_buildings_in(podium_polys) if podium_polys else []
    added = 0
    for el in inner:
        oid = f"w{el['id']}"
        if oid in owner:
            continue
        tags = el.get("tags") or {}
        if (tags.get("building") or "yes") in FOREIGN_BUILDING_KINDS:
            continue
        nz = norm(osm_zh_name(tags))
        if nz and any(p in nz for p in NON_HOUSING_PATTERNS):
            continue
        rec = building_record(el, LAT0)
        if rec is None:
            continue
        mark_height_source(rec, tags)
        pt = rec["_poly"].representative_point()
        for poly, (eid, _host) in zip(podium_polys, podium_owner):
            if poly.contains(pt):
                rec["_osm"] = oid
                rec["_zh"] = osm_zh_name(tags)
                records[eid].append(rec)
                poly_of[oid] = rec["_poly"]
                claims[eid][oid] = "within"
                owner[oid] = eid
                added += 1
                break
    print(f"  {added} buildings claimed inside a matched footprint")

    # --- block assignment ------------------------------------------------------
    for est in estates:
        assign_blocks(est, records[est["id"]])

    # --- basemap re-cut --------------------------------------------------------
    all_polys = [rec["_poly"] for recs in records.values() for rec in recs]
    tiles = tiles_covering(all_polys)
    print(f"Re-cutting {len(all_polys)} footprints against {len(tiles)} basemap tiles")
    index = TilePartIndex(fetch_tile_building_parts(tiles))
    recut = 0
    for eid, recs in records.items():
        new: list[dict] = []
        for rec in recs:
            inside = index.within(rec["_poly"])
            if not inside:
                new.append(rec)
                continue
            recut += 1
            for i, part in enumerate(inside):
                pr = part_record(part, LAT0, f"{rec['_osm']}#p{i}" if i else rec["_osm"], rec.get("name"), rec.get("kind") or "yes")
                pr["_block"], pr["_year"], pr["_osm"] = rec.get("_block"), rec.get("_year"), rec["_osm"]
                pr["_levels"], pr["_osm_height"] = rec["_levels"], rec["_osm_height"]
                # The basemap has now spoken for this footprint: it is only
                # left at the default if the part it drew is the default too.
                pr["_height_default"] = rec["_height_default"] and part["height"] == DEFAULT_RENDER_HEIGHT_M
                new.append(pr)
        records[eid] = new
    print(f"  {recut} OSM footprints replaced by the basemap's parts")

    # --- storey fallback -------------------------------------------------------
    # Everything above draws what OSM and the basemap publish. Only the
    # footprints neither of them gives a height for are left, and for a tower
    # a 5 m stub is worse than IH's own storey count x this run's measured
    # metres per storey. See `raise_default_height_towers`.
    still_default = sum(1 for recs in records.values() for r in recs if r["_height_default"])
    print(f"Storey fallback: {still_default} footprints have no published height")
    raise_default_height_towers(estates, records, storey_height_m(records))

    # --- assemble --------------------------------------------------------------
    out_estates: list[dict] = []
    unmatched: list[dict] = list(KNOWN_UNBUILT)
    for est in sorted(estates, key=lambda e: (e["type"], e["district"], e["id"])):
        recs = records[est["id"]]
        if recs:
            centre = unary_union([r["_poly"] for r in recs]).centroid
            coords = [round(centre.x, 6), round(centre.y, 6)]
            approximate = False
        else:
            p = fitted.get(est["id"])
            if p is None or FIT_RMS_M > FIT_MAX_RMS_M:
                unmatched.append({
                    "id": est["id"],
                    "name": est["name"]["zh"],
                    "reason": "no OSM footprint matched and no usable coordinate"
                    if p is None else f"no OSM footprint matched; xp/yp fit RMS {FIT_RMS_M:.0f} m is too coarse to place it",
                })
                continue
            coords = [round(p[0], 6), round(p[1], 6)]
            approximate = True
        out_estates.append({
            "id": est["id"],
            "name": est["name"],
            "type": est["type"],
            "category": est["category"],
            "district": est["district"],
            "address": est["address"],
            "year": est["year"],
            "yearKind": est["yearKind"],
            "status": est["status"],
            "partial": est["partial"],
            "units": est["units"],
            "storeys": est["storeys"],
            "blocks": est["blocks"],
            "coordinates": coords,
            "approximate": approximate,
            "osm": sorted(claims[est["id"]]),
            "buildings": [
                {
                    "osmId": r["osmId"],
                    "name": r.get("name"),
                    "block": r.get("_block"),
                    "year": r.get("_year"),
                    "height": r["height"],
                    "minHeight": r["minHeight"],
                    "coordinates": r["coordinates"],
                }
                for r in recs
            ],
            "sources": est["sources"],
        })

    output = {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "sources": {
            "ihmSocial": IH_SOCIAL,
            "ihmEconomic": IH_ECONOMIC,
            "ihmProgress": IH_PROGRESS,
            "ihmManaged": IH_MANAGED,
            "gov": GOV_A_LOTS,
            "govElderly": GOV_ELDERLY,
            "wikiElderly": WIKI_ELDERLY,
            "govPLot": GOV_P_LOT,
            "murPLot": MUR_P_LOT,
            "wikiPLot": WIKI_P_LOT,
            "osm": OSM_SOURCE,
        },
        "types": ["social", "economic", "other"],
        "estates": out_estates,
        "unmatched": unmatched,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total_b = sum(len(e["buildings"]) for e in out_estates)
    empty = [e["name"]["zh"] for e in out_estates if not e["buildings"]]
    print(f"\nDone. {len(out_estates)} estates, {total_b} buildings")
    print(f"Estates with no footprint: {len(empty)} -> {empty}")
    print(f"Unmatched: {[u['name'] for u in unmatched]}")
    if ambiguous:
        print(f"Ambiguous names left unclaimed ({len(ambiguous)}):")
        for a in ambiguous:
            print(f"  {a['osm']} {a['name']} -> {a['estates']}")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run())
    except UpstreamError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
