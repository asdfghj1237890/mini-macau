"""
Daily fetch: DSAT "工程改道消息" (road-works / traffic-diversion notices) from the
Macau open-data platform, normalized into public/data/road-works.json for the
map's road-works overlay.

Upstream: data.gov.mo dataset 81c17efc-3e92-484e-ab14-de7fa0f90f01
(交通事務局, updated daily). The bare download endpoint needs no API token and
returns a ZIP containing `dsat_aviso.xml`: one <entry> per notice with
bilingual (zh/pt) text fields, ISO dates, and a WGS84 "lon lat" point.

Quirks handled here:
  * The endpoint intermittently answers HTTP 200 with a JSON body
    {"msg":"內部錯誤","code":1} instead of the ZIP — non-ZIP bodies are retried
    with exponential backoff.
  * `summary_cn`/`summary_pt` are HTML (a header table that duplicates the
    structured fields, then <pre><p>…</p></pre> paragraphs with hard line
    breaks mid-sentence). Only the paragraphs are kept, as plain text.
  * "--" / "na" placeholders become "" / null.

Pure stdlib (no requests/bs4) so it runs wherever validate_output.py runs.
"""

import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

DATASET_ID = "81c17efc-3e92-484e-ab14-de7fa0f90f01"
DATASET_PAGE = f"https://data.gov.mo/Detail?id={DATASET_ID}"
DOWNLOAD_URL = f"https://api.data.gov.mo/document/download/{DATASET_ID}"
XML_NAME = "dsat_aviso.xml"
OUTPUT_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "road-works.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; mini-macau data pipeline)"}
TIMEOUT = 30
MAX_ATTEMPTS = 6
BACKOFF_BASE = 2.0  # seconds; 2, 4, 8, 16, 32

# Degenerate-fetch guard: the feed has carried ~90 live notices; a near-empty
# result means the upstream export broke, not that Macau ran out of roadworks.
MIN_NOTICES = 5

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DURATION_RE = re.compile(r"^\s*(\d+)\s*日\s*(\d+)\s*小時\s*$")

# Restriction kind, derived from the last comma-separated segment of title_cn
# (the only place the feed states it). "有限度通車" carries suffixes such as
# "*" or "(佔用一條行車道)", hence substring matching.
RESTRICTION_RULES = (
    ("封閉", "closed"),
    ("有限度通車", "limited"),
    ("單一方向", "one_way"),
    ("禁止泊車", "no_parking"),
)


def fetch_zip() -> bytes:
    """Download the dataset ZIP, retrying non-ZIP (error JSON) and network failures."""
    last_error = "no attempts made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(DOWNLOAD_URL, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read()
            if body[:2] == b"PK":
                return body
            last_error = f"non-ZIP body ({len(body)} bytes): {body[:120]!r}"
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt < MAX_ATTEMPTS:
            delay = BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"  attempt {attempt} failed ({last_error}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"download failed after {MAX_ATTEMPTS} attempts: {last_error}")


class _ParagraphExtractor(HTMLParser):
    """Plain-text paragraphs from a notice summary.

    Skips <style>/<script> and any <table id="header…"> (its cells duplicate the
    structured fields). Block tags start a new paragraph; whitespace inside a
    paragraph — including the feed's mid-sentence hard line breaks — collapses
    to single spaces. Empty paragraphs are dropped.
    """

    BLOCK_TAGS = {"p", "br", "div", "li", "tr", "table", "pre", "h1", "h2", "h3", "h4"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[str] = []
        self._buf: list[str] = []
        self._skip_depth = 0
        self._header_depth = 0

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self._buf)).strip()
        self._buf = []
        if text:
            self.paragraphs.append(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("style", "script"):
            self._skip_depth += 1
            return
        if tag == "table":
            attr = dict(attrs)
            if self._header_depth or (attr.get("id") or "").lower().startswith("header"):
                self._header_depth += 1
                return
        if self._skip_depth or self._header_depth:
            return
        if tag in self.BLOCK_TAGS:
            self._flush()
        elif tag == "td":
            self._buf.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("style", "script"):
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag == "table" and self._header_depth:
            self._header_depth -= 1
            return
        if self._skip_depth or self._header_depth:
            return
        if tag in self.BLOCK_TAGS:
            self._flush()

    def handle_data(self, data: str) -> None:
        if not (self._skip_depth or self._header_depth):
            self._buf.append(data)

    def close(self) -> None:
        super().close()
        self._flush()


def html_to_paragraphs(html: str) -> str:
    parser = _ParagraphExtractor()
    parser.feed(html)
    parser.close()
    return "\n".join(parser.paragraphs)


def clean(s: str | None) -> str:
    """Collapse whitespace (the feed embeds tabs/newlines) and drop '--' placeholders."""
    text = re.sub(r"\s+", " ", s or "").strip()
    text = re.sub(r"\s+,", ",", text)  # "Rua X\t,Rua Y" → "Rua X,Rua Y"
    return "" if text == "--" else text


def restriction_of(title_cn: str) -> tuple[str, str]:
    """(kind, raw zh phrase) from the title's last comma-separated segment."""
    phrase = title_cn.rsplit(",", 1)[-1].strip() if "," in title_cn else ""
    for needle, kind in RESTRICTION_RULES:
        if needle in phrase:
            return kind, phrase
    return "other", phrase


def parse_duration(duration_cn: str) -> dict:
    m = DURATION_RE.match(duration_cn or "")
    if not m:
        return {"days": 0, "hours": 0}
    return {"days": int(m.group(1)), "hours": int(m.group(2))}


def parse_point(point_wgs84: str) -> list[float] | None:
    parts = re.split(r"[\s,;]+", (point_wgs84 or "").strip())
    if len(parts) < 2:
        return None
    try:
        lng, lat = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    # Sanity only (rules out swapped/zero coordinates); validate_output.py
    # enforces the real Macau bounding box before anything is committed.
    if not (100.0 < lng < 130.0 and 15.0 < lat < 30.0):
        return None
    return [round(lng, 6), round(lat, 6)]


def parse_entry(entry: ET.Element) -> dict | None:
    def field(name: str) -> str:
        el = entry.find(name)
        return (el.text or "") if el is not None else ""

    aviso_no = clean(field("aviso_no"))
    start_date = clean(field("start_date"))
    end_date = clean(field("end_date"))
    coords = parse_point(field("point_wgs84"))
    problems = []
    if not aviso_no:
        problems.append("missing aviso_no")
    if not DATE_RE.match(start_date):
        problems.append(f"bad start_date {start_date!r}")
    if not DATE_RE.match(end_date):
        problems.append(f"bad end_date {end_date!r}")
    if coords is None:
        problems.append(f"bad point_wgs84 {field('point_wgs84')!r}")
    if problems:
        print(f"  skipping notice {aviso_no or '?'}: {'; '.join(problems)}", file=sys.stderr)
        return None

    title_cn = clean(field("title_cn"))
    title_pt = clean(field("title_pt"))
    kind, phrase_cn = restriction_of(title_cn)
    phrase_pt = title_pt.rsplit(",", 1)[-1].strip() if "," in title_pt else ""
    previous = clean(field("previousnotice"))
    online = clean(field("online_date"))[:10]

    return {
        "id": aviso_no,
        "restriction": kind,
        "restrictionText": {"zh": phrase_cn, "pt": phrase_pt},
        "location": {"zh": clean(field("location_cn")), "pt": clean(field("location_pt"))},
        "reason": {"zh": clean(field("reason_cn")), "pt": clean(field("reason_pt"))},
        "principal": {"zh": clean(field("principal_cn")), "pt": clean(field("principal_pt"))},
        "contractor": {"zh": clean(field("contractor_cn")), "pt": clean(field("contractor_pt"))},
        "details": {
            "zh": html_to_paragraphs(field("summary_cn")),
            "pt": html_to_paragraphs(field("summary_pt")),
        },
        "duration": parse_duration(clean(field("duration_cn"))),
        "startDate": start_date,
        "endDate": end_date,
        "onlineDate": online if DATE_RE.match(online) else start_date,
        "coordinates": coords,
        "previousNotice": previous if previous and previous.lower() != "na" else None,
    }


def build_output(xml_bytes: bytes) -> dict:
    root = ET.fromstring(xml_bytes)
    entries = root.findall("entry")
    notices = [n for n in (parse_entry(e) for e in entries) if n is not None]
    seen: set[str] = set()
    deduped = []
    for n in notices:
        if n["id"] in seen:
            print(f"  dropping duplicate notice id {n['id']}", file=sys.stderr)
            continue
        seen.add(n["id"])
        deduped.append(n)
    deduped.sort(key=lambda n: (n["startDate"], n["id"]))
    return {
        "fetchedAtUtc": datetime.now(tz=timezone.utc).isoformat(),
        "exportedAt": root.attrib.get("exported", ""),
        "source": {
            "name": "交通事務局 (DSAT) – 工程改道消息",
            "dataset": DATASET_PAGE,
            "download": DOWNLOAD_URL,
        },
        "notices": deduped,
    }


def run() -> int:
    print(f"Fetching {DOWNLOAD_URL}")
    try:
        blob = fetch_zip()
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = zf.namelist()
        if XML_NAME not in names:
            print(f"ERROR: {XML_NAME} not in ZIP (entries: {names})", file=sys.stderr)
            return 1
        xml_bytes = zf.read(XML_NAME)
    print(f"  ZIP ok, {XML_NAME} = {len(xml_bytes)} bytes")

    try:
        output = build_output(xml_bytes)
    except ET.ParseError as e:
        print(f"ERROR: XML parse failed: {e}", file=sys.stderr)
        return 1

    count = len(output["notices"])
    if count < MIN_NOTICES:
        print(
            f"ERROR: only {count} usable notices (< {MIN_NOTICES}) — upstream likely broken, "
            f"refusing to write {OUTPUT_PATH.name}",
            file=sys.stderr,
        )
        return 1

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    kinds: dict[str, int] = {}
    for n in output["notices"]:
        kinds[n["restriction"]] = kinds.get(n["restriction"], 0) + 1
    summary = ", ".join(f"{k}={v}" for k, v in sorted(kinds.items()))
    print(f"Done. {count} notices ({summary}), exported {output['exportedAt']}")
    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
