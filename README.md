# Mini Map Macau 🚈🚌✈️🛥️

> **[mini-map-macau.app](https://mini-map-macau.app/)**

[![Live site](https://img.shields.io/website?url=https%3A%2F%2Fmini-map-macau.app&label=live&up_message=online&down_message=offline)](https://mini-map-macau.app/)
[![CI](https://img.shields.io/github/actions/workflow/status/asdfghj1237890/mini-macau/ci.yml?label=ci&branch=master)](https://github.com/asdfghj1237890/mini-macau/actions/workflows/ci.yml)
[![Deploy](https://img.shields.io/github/actions/workflow/status/asdfghj1237890/mini-macau/deploy.yml?label=deploy&branch=master)](https://github.com/asdfghj1237890/mini-macau/actions/workflows/deploy.yml)

[![Flights sync](https://img.shields.io/github/actions/workflow/status/asdfghj1237890/mini-macau/update-flights.yml?label=flights%20sync)](https://github.com/asdfghj1237890/mini-macau/actions/workflows/update-flights.yml)
[![Ferries sync](https://img.shields.io/github/actions/workflow/status/asdfghj1237890/mini-macau/update-ferry-schedules.yml?label=ferries%20sync)](https://github.com/asdfghj1237890/mini-macau/actions/workflows/update-ferry-schedules.yml)

[![License](https://img.shields.io/github/license/asdfghj1237890/mini-macau)](./LICENSE)
[![Made with React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-5-396CB2?logo=maplibre&logoColor=white)](https://maplibre.org/)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)](./data/pyproject.toml)

3D visualization of Macau's public transit, ferry, and aviation system, inspired by [Mini Tokyo 3D](https://minitokyo3d.com) and [Mini Taiwan](https://mini-taiwan-learning-project.itsmigu.com/).

Visualizes the **Macau Light Rapid Transit (LRT)**, **bus network**, **HK–Macau ferry routes**, and **MFM airport flights** on an interactive 3D map. Vehicles move along actual geometry in a **timetable-driven simulation**. A **CITY** layer set adds Macau's open data on top: DSAT road-works notices, every school's buildings coloured by level and shaded by founding era, the Housing Bureau's social and economic housing estates, the seven civil parishes as a boundary tint, IAM public toilets, the territory's temples, churches, mosque and Earth God (土地公) street shrines, DSAT public car parks with live vacancy, and IAM/DSPA refuse rooms, compacting bins and recycling points.

> **How fresh is this?** See [Data freshness & update strategy](#data-freshness--update-strategy) for a per-layer breakdown — LRT and buses run on simulated, manually regenerated timetables, while flights and ferries refresh on their own daily/monthly sync schedule.

![og-image](https://mini-map-macau.app/og-image.png)

![Demo — Macau bus fleet on the roundabout](https://github.com/asdfghj1237890/mini-macau/releases/download/readme-assets-v1/demo-01.gif)

![Demo — LRT line with timetable panel](https://github.com/asdfghj1237890/mini-macau/releases/download/readme-assets-v1/demo-02.gif)

<sup>Full-quality MP4s: [bus fleet](https://github.com/asdfghj1237890/mini-macau/releases/download/readme-assets-v1/demo-01.mp4) · [LRT line](https://github.com/asdfghj1237890/mini-macau/releases/download/readme-assets-v1/demo-02.mp4)</sup>

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Data Pipeline](#data-pipeline)
- [Data Sources](#data-sources)
- [Data freshness & update strategy](#data-freshness--update-strategy)
- [Project Structure](#project-structure)
- [Performance Notes](#performance-notes)
- [Acknowledgements](#acknowledgements)
- [License](#license)
- [Developer Docs 開發筆記 (繁中)](docs/development/README.md)

## Features

- **3D LRT vehicles** — 3 lines, 15 stations, real track geometry and elevated viaducts
- **3D Bus fleet** — 92 routes, road-snapped via OSRM, with accurate cross-harbour bridge geometry
- **3D Aircraft** — 176 real MFM flights (87 dep + 89 arr) with detailed airplane models, apron stands, and taxi paths
- **3D Ferries** — 6 HK/Shenzhen ↔ Macau sea routes (TurboJET + CotaiJet) with jetfoil-shaped hull, red belly belt, and multi-deck cabin
- **Timetable-driven simulation** — Schedule-synced playback with ETAs, service status, and trilingual labels (EN / 繁中 / PT)
- **Time controls** — Play/pause, 1×–60× speed, jump-to-now, free date/time picker
- **Vehicle tracking** — Click-to-follow with smooth camera and free zoom/pan

<details>
<summary><strong>Full feature list</strong></summary>

- **3D LRT vehicles** — All 3 lines (Taipa, Seac Pai Van, Hengqin) with 15 stations, rendered as 3D models with real track geometry and elevated viaducts
- **3D Bus fleet** — 92 routes with road-snapped paths via OSRM, including accurate bridge geometry (Macau–Taipa bridges)
- **3D Aircraft** — 176 real MFM airport flights (87 departures + 89 arrivals) with detailed airplane models (fuselage, swept wings, vertical tail in airline colors, engine nacelles, window rows, cockpit windshield); aircraft park at 12 apron stands before departure and taxi along waypoint paths before takeoff
- **Landing & holding patterns** — Aircraft approach from North or South with multi-waypoint landing routes; when the runway is occupied, arriving flights enter a realistic circular holding pattern above the airport and smoothly transition back to the landing route when clear
- **3D Ferries** — 6 sea routes (Hong Kong Outer Harbour / Taipa / Sheung Wan, HKIA, Shenzhen Airport, Shekou) served by TurboJET and CotaiJet, rendered as jetfoil models (pontoon hull, red belt, white TurboJET band, cabin, windows, wheelhouse, roof) following great-circle paths with wake-aware headings
- **Real-time simulation** — Vehicles move along routes based on timetables, service frequencies, and schedule types (Mon–Thu / Friday / Sat–Sun)
- **ETA & vehicle info** — Click any vehicle or station to see live ETAs, next arrivals, route details, and service status
- **Flight info** — Click any aircraft to see flight number, airline, destination/origin (with localized names), scheduled time, aircraft type, and live/sim status
- **Ferry info** — Click any ferry to see operator, route, origin/destination port (localized), scheduled departure, crossing time, and live progress
- **Parishes** — Macau's seven civil parishes (花地瑪堂區 / 花王堂區 / 望德堂區 / 大堂區 / 風順堂區 on the peninsula, 嘉模堂區 on Taipa, 聖方濟各堂區 on Coloane) plus the Cotai reclamation zone, which belongs to no parish, drawn as a faint tint with a thin boundary and the area's name in the reading language (the name steps out above zoom 15.5, where a parish label across a street block is noise). Boundaries from OpenStreetMap, land area and the 2021 census population from DSEC. The tint draws above historical maps and below buildings and city/transport overlays, so it can be combined with any of them. Clicking a school block inside a parish opens the school; click empty ground inside an area for its name in all three languages, kind, island, area, population with the census year, and density.
- **Road-works notices** — DSAT traffic-diversion notices shown on the map for the simulated date, toggleable
- **School buildings** — Every school and tertiary campus rendered as coloured 3D blocks. Colour carries two facts: the hue is the teaching level (kindergarten fuchsia / primary crimson / secondary blue / university leaf green / all-through gold — a hue set chosen to stay clear of the public-housing families, since the two overlays can be read together), and the shade is the era the school was founded, from before 1900 (darkest) to 2000 onwards (lightest); a school with no known year takes the middle shade. Founding years are hand-transcribed by the pipeline from DSEDJ school profiles, the schools' own sites and zh.wikipedia. The legend section collapses, each level can be switched on/off on its own and carries its five-stop ramp; click a block for the school's name, level, system, founding year and approved stages
- **Public housing** — The Housing Bureau's social (社會房屋) and economic (經濟房屋) housing estates as 3D footprints, plus the government's elderly apartments (長者公寓) and the urban-renewal replacement (置換房) and temporary (暫住房) housing as a third colour — sandwich-class (夾心房屋) housing belongs to the same group but has no estate in the data yet. Coloured by type and shaded by the decade each block was first occupied; the legend section collapses and each type can be switched on/off on its own; click a block for the estate's name, type, category, district, address, occupation year, units, storeys and per-block dates. Footprints from OpenStreetMap. Can be combined with schools and any other city or transport layer.
- **Public toilets** — IAM public toilets as map markers with opening hours, barrier-free / family cubicles and temporary closures; toggleable
- **Religion** — every place of worship with a known location, in five toggleable groups: **Tou Tei (土地公)** — the Earth God's temples (土地廟 / 福德祠) and street shrines (土地神壇), merged from OpenStreetMap, the six sites the Cultural Affairs Bureau (IC) has classified as immovable heritage (with the IC's own trilingual name and description) and the sites photographed for Macau Memory's 社區守護神 exhibition (street-level positions, drawn dimmer and flagged approximate); the other **Chinese temples** and folk altars (媽閣廟, 蓮峯廟, 普濟禪院, 哪咤廟, 北帝廟, 譚公廟 …); **churches and chapels** from the Ruins of St. Paul's to the Anglican and Baptist churches; the **mosque**; and **other faiths**. Colour is the group, the marker's shape the building type (temple roof, cross, crescent, tablet); the classified sites carry the IC's description. Click a marker for its name (the inscription, in English or Portuguese only where a source publishes one), type, address, heritage code and the sources it came from. For Tou Tei the IC counts about 10 temples and 160+ public shrines; the layer maps the ones with a known location and says so; each group can be switched on/off on its own
- **Historical maps** — old plans of the city georeferenced onto today's streets and drawn as a translucent ground layer under the buildings, which turn into a paper-toned, half-see-through massing model while a plate is up so that the old town engraved underneath stays readable. Local plates with zoomable detail use a tile pyramid, so they get sharper as the map is zoomed in — down to about half a metre per pixel on the 1889 survey — while a phone only ever loads the tiles in view. The collection includes: de Guignes' *Plan de la Ville de Macao* (surveyed in 1792 after Manuel de Agote's plan, published in 1808 as plate 94 of the atlas to *Voyages à Péking, Manille et l'île de France*; the Getty Research Institute's public-domain scan on the Internet Archive, straightened and stitched across its fold) Benjamin Baker's *A Plan of the City and Harbour of Macao* (engraved in 1796 for Staunton's *Authentic Account* of the Macartney embassy, with soundings and seabed notes across the Inner Harbour and the Praia Grande; the Library of Congress sheet), António Heitor's *Planta da Peninsula de Macau* at 1:5,000 (the Public Works Department's survey, lithographed in Macau in 1889 with every street named and the public buildings in red; the Library of Congress sheet), and the Public Works Department's 1:10,000 manuscript *Planta da Peninsula de Macau* signed by Alcino António Sauvage in 1893 (west at the top, a legend of 33 sites; the Arquivo Histórico Ultramarino's CC BY-SA 4.0 scan), the Comissão de Cartografia's 1912 city plan at 1:10,000 and Alves / Pires' 1927 city and new harbour plan at 1:4,000 (BNP public-domain scans; the latter includes proposed works and is labelled accordingly), and the Chinese *Aomen Shi quan tu* at approximately 1:10,000 (the Library of Congress catalogue dates it circa 1953; MUST dates the depicted geography to 1938–1941, so the legend marks the year as approximate; watermark-free scan via Wikimedia Commons). The catalogue now contains twelve maps, also including the 1858 revision of Admiralty Chart 1290 (surveyed in 1804, first published in 1840; PD-UKGov scan via Wikimedia Commons), the separate 1912 Taipa and Coloane sheets from BNP’s public-domain Atlas de Macau, the 1963 geological sketch (traditional 2× enlargement and light sharpening), and the provider-hosted 1996 Sinica map. Full sheets retain their paper margins and insets; inset positions are part of the printed layout, not separate geographic overlays. The 1858 chart has approximate island relief and suits regional comparisons. Local spline-registered plates are treated as pieces of cloth: a thin-plate spline pins it exactly at its control points — 4–24 landmarks per plate (churches, forts, the Barrier Gate, the Ilha Verde summit, the Guia lighthouse — every one checked on a contact sheet of the scan and on an affine leave-one-out test), plus, on the two 18th-century plans, some 80 points round the whole shoreline of the peninsula, taken about every 120 m from the coast of 1794 — the 1889 survey's shoreline where it was still the old one, and along the Inner Harbour reclaimed after 1863 the streets that the 1993 *Geografia de Macau* names as the old shore; the whole shoreline of those two plans then gets a second pass, a coast snap that walks their traced coast line onto that coast of 1794 through about a thousand pairs a plate (along the Inner Harbour, where the drawings show wharves and inlets and the reference is a generalised line, it is the general run of the waterfront that is matched), so the drawn coast and the reference coincide all round the peninsula; the 1889 sheet's own north-east shore is in turn pinned to the shoreline of the 1893 manuscript, the baseline chosen for that stretch (without a control point on the D. Maria II fort it still puts the fort within 14 m of where it stands) — and stretches or pinches the paper between them as needed, so both 18th-century surveys, which draw the peninsula shorter than it is, are pulled back onto today's streets at every pin, while the two 1890s surveys barely move; what lies between the pins is interpolated, and the sea and the Zhuhai shore beyond them are extrapolated decoration. Ten selectors control twelve source sheets: the three 1912 Atlas de Macau sheets (peninsula, Taipa and Coloane) share one switch. Other maps remain independently selectable, with one opacity slider for all plates. Titles identify the author or distinguishing content, while the second line gives scale, coverage or publication context. Expandable notes preserve each original catalogue title and source credit, including all three atlas sheets
- **Public car parks** — DSAT's 88 public car parks as map markers with entrances, height limits and fees, plus live vacancy shown only while the clock is at the present; toggleable
- **Waste & recycling** — IAM's refuse rooms, compacting bins, refuse stations and (via its own facility map) glass-bottle and clothing recycling banks, plus DSPA's smart recycling machines, three-colour recycling points, e-waste points and lamp/battery points — ≈1,157 collection points across nine types; DSPA's 10 Eco Fun drop-off stations; and a treatment-facilities layer covering the 澳門垃圾焚化中心 incineration plant, the hazardous-waste station, two landfills and the territory's 5 sewage treatment plants, all drawn as coloured 3D buildings or filled outlines — ≈1,176 marks across twelve toggleable key rows. The incinerator, the hazardous station, the construction-waste landfill and each sewage plant carry a monthly bar chart (tonnes received or cubic metres treated) from a small dedicated stats file, best-effort if DSPA's API is unreachable. Seven recycling-heavy rows start hidden so the ~300 collection/treatment points are not buried; switch them on from the key. Can be combined with every other layer.
- **Water supply facilities** — Macao Water's 22 plants, reservoirs, elevated tanks and pumping stations, plus the government's own Hac Sa Reservoir; footprints coloured by type where OSM has them, markers for the rest flagged approximate, connected by a schematic pipe network drawn along the roads (from two raw-water inlets: the Ilha Verde border canal, and a schematic Lotus Bridge point for the raw water that arrives via Hengqin, flagged as such) and a Macau-only distribution network along every road. Every marker carries its step number in the supply chain, the mains carry direction arrows, and a bright pulse walks the whole chain in order — inlet, reservoir, raw-water pump, plant, pump, elevated tank, then outward through the streets — so the sequence reads, not just the direction. Can be combined with electricity, historical maps and transport.
- **Electricity grid** — CEM's power station, the incineration plant and 33 HV substations (220 / 110 / 66 kV) with a schematic grid drawn along the roads and the three Guangdong interconnection inlets. Same reading aids as the water layer: every marker carries its step in the supply chain (① sources — import points, power station, incinerator — then ② 220 kV, ③ 110 kV, ④ 66 kV, ⑤ the streets), the lines carry direction chevrons, and a pulse walks the grid in that order; independently toggleable alongside other layers
- **Grand Prix circuit** — the Guia Circuit of the Macau Grand Prix: the 6.2 km racing line stitched from OpenStreetMap's `Circuito da Guia` relation (cross-checked against the organiser's official lap length), the pit lane, direction chevrons, the nine officially named corners in race order (names quoted from the Macau Grand Prix Committee in all three languages; positions derived from the track geometry by a stated rule and flagged as schematic), and a single open-wheel car lapping on the simulation clock in the record time — braking for the hairpin and running out along the straight on a speed profile derived from the track's curvature, stretched so every lap takes exactly the record — with a fading wake behind it and its live speed beside it. Flies to the circuit when enabled (never below zoom 14.4), without switching off other layers. The clock and speed controls appear while any transport layer is enabled. Turning off all transport layers hides them and resets playback speed to 1×.
- **Layer panel** — desktop and mobile panels separate transport from everyday city layers and thematic overlays. All switches are independent and persist in localStorage; enabling or disabling a layer preserves every other selection. City layers also offer **Show only**, an explicit one-shot action that clears other city and transport layers; users can then add any layer back. No earlier selection is restored automatically. Road works are on by default and the other city layers remain opt-in.
- **Automated ferry data** — GitHub Actions workflow scrapes TurboJET and CotaiJet timetables monthly and commits updated schedules if changed
- **Time controls** — Play, pause (spacebar), speed up (1×–60×), jump to current time, or pick any date/time with the DateTimePicker; Esc toggles the sidebar menu
- **Vehicle tracking** — Click a vehicle to follow it with smooth camera animation; freely zoom/pan while tracking
- **Route visibility** — Toggle individual bus routes by group (Peninsula, Cross-Harbour, Taipa/Cotai, Night, Special); auto-mode shows only routes currently in service
- **3D/2D toggle** — Switch between perspective and top-down views
- **Dark/Light mode** — Two map styles (CARTO Dark Matter / Positron)
- **Trilingual UI** — English / 繁體中文 / Português — flight destinations, station names, and all labels switch with the language
- **Cyberpunk-styled menu** — Hamburger menu with Orbitron-font title and gradient branding
- **Responsive mobile UI** — Hamburger menu for map controls, a chip stack for LRT / Bus / Air / Sea plus one CITY chip that opens a list of the four city layers (each keeps its own modal), optimized touch layout with safe-area support, and Add to Home Screen (a web app manifest plus an install card that names the Share / menu route for iOS and Android browsers)
- **Lazy loading** — Code-split panels (VehicleInfoPanel, StationInfoPanel, FlightInfoPanel, RoadWorkInfoPanel, SchoolInfoPanel, PublicHousingInfoPanel, ParishInfoPanel, ToiletInfoPanel, ReligionInfoPanel, CarParkInfoPanel, WasteSiteInfoPanel, WasteIncineratorInfoPanel, WasteEcoStationInfoPanel, WasteFacilityInfoPanel) for fast initial load
- **Automated flight data** — GitHub Actions workflow syncs MFM flight schedules from the [AviationStack](https://aviationstack.com/) API daily

</details>

## Architecture

Upstream sources are normalized into JSON, loaded through static assets and schedule-specific API requests, and replayed by the browser on a simulated clock. The DSAT car-park vacancy API provides live updates only while the clock sits at the present.

![Architecture — sources flow through the data pipeline into JSON assets and APIs, which the browser replays on a simulated clock; the DSAT car-park vacancy feed provides live updates](./docs/architecture.svg)

<sup>Animated SVG (SMIL, no scripts) — generated, see <code>docs/architecture.svg</code>.</sup>

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 6, Vite 8 |
| 3D Map | MapLibre GL JS 6 (WebGL 2 required), procedural instanced vehicle meshes + fill-extrusion building/overlay layers |
| Geo utilities | Turf.js (nearest-point-on-line) + custom precomputed-polyline cache |
| Styling | Tailwind CSS v4 |
| Fonts | Orbitron, JetBrains Mono, Noto Sans HK (Google Fonts) |
| Data pipeline | Python 3.13+, uv, OpenStreetMap Overpass API, OSRM |
| Flight data | [AviationStack API](https://aviationstack.com/) (daily sync) |
| Ferry data | [TurboJET](https://www2.turbojet.com.hk/) + [CotaiJet](https://www.cotaiwaterjet.com/) timetables (monthly web scraper) |
| City data | [data.gov.mo](https://data.gov.mo/) — DSAT road works, DSAT car parks + live vacancy (daily syncs); IAM toilets, IAM/DSPA waste & recycling points (monthly syncs); DSEDJ school list, IH's public-housing lists, Macao Water's facility list and CEM's substation list, all + OSM footprints (manual); DSEC 2021 census + OSM boundaries for the parishes (manual); OpenStreetMap + the IC cultural-heritage API (+ Macau Memory's exhibition map for the Tou Tei shrines) for the temples, churches and shrines (manual) |
| Data validation | zod schemas at load time, mirrored by `validate_output.py` in CI |
| Deployment | Cloudflare Pages (via GitHub Actions) |
| Analytics | Google Analytics (gtag.js) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- npm
- [uv](https://docs.astral.sh/uv/) (for data pipeline only)

### Install & Run

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

### Build for Production

```bash
npm run build
npm run preview
```

### Diagnosing a device

Phones have no console, so the app carries its own. Append `?debug=1` to any URL (or set localStorage `mini-macau-debug` to `1`) and a panel pins to the bottom of the page ([`src/debugOverlay.ts`](src/debugOverlay.ts)): the browser's capabilities (the existing map WebGL 2 context and renderer, GL limits, a module-worker probe), every error and unhandled rejection, MapLibre `error` events with their source and tile, a heartbeat every 3 s (`alive`, canvas size, shaders and programs compiled, map renders, tile reloads with the four busiest sources named), and a pinned strip for the lines that decide a diagnosis — a failed shader with its info log and whether the context was lost. The previous page load's tail is kept in localStorage and replayed on the next load, so a page the OS killed still leaves a trace.

Switches for narrowing a failure down without a redeploy:

| URL | What it does |
|-----|--------------|
| `?debug=1&layers=none` | Basemap only: none of the app's sources or layers |
| `?debug=1&nosim=1` | Never runs the simulation tick |
| `?debug=1&no3d=1` | Starts flat, buildings off |
| `?debug=1&maxdpr=2` | Caps the render pixel ratio |
| `?debug=1&nowebgl2=1` | Pretends the device has no WebGL 2: switches to the raster compatibility map |
| `?map=2d` | Opens the compatibility map directly, using raster tiles and Canvas2D overlays |

On context loss or shader failure the app rebuilds the map once, retaining its camera. Repeated failure switches to a 2D compatibility map with routes, moving vehicle points, city markers and the existing time/layer controls. It does not require WebGL; 3D buildings and animated network flows are unavailable. Debugging observes the map's existing context without creating probe contexts, and reports null shader query results separately from false compile status. See [recovery behavior and investigation](docs/development/11-webgl-recovery.md).

[`public/gltest.html`](public/gltest.html) is a page with no app code at all: MapLibre 5.23 or 6.7 straight from a CDN (`?v=5|6`), the same CARTO basemap and camera, and a synthetic fill-extrusion + circle `setData` load (`&veh=150&hz=30&circles=300`; `&veh=0&circles=0` for the basemap alone; `&theme=light`, `&dpr=2`, `&buildings=1`, `&overscale=off`). It separates "MapLibre on this device" from "our app". Both pages are `noindex`.

## Data Pipeline

Transit geometry and other static datasets are pre-generated in `public/data/`. LRT movement is computed by the Pages Function. The browser loads fixed two-minute state windows through `/api/lrt/state?at=<epoch-ms>` and prefetches the next overlapping window for playback and seeking.

<details>
<summary><strong>Regenerate transit data</strong></summary>

```bash
cd data

# Set up Python environment
uv sync

# Run all data extraction scripts
uv run python main.py
```

This will:
1. Extract LRT track geometry from OpenStreetMap (`railway=light_rail` ways)
2. Extract bus routes and stops from OpenStreetMap + [motransportinfo.com](https://www.motransportinfo.com) reference data
3. Fetch bridge approach geometry for accurate cross-harbour routing
4. Snap bus routes to roads via OSRM with custom bridge geometry patching
5. Generate timetables based on published service frequencies
6. Write the JSON straight to where it is consumed: `public/data/`, served as-is. There is no intermediate `data/output/` copy to sync.

</details>

<details>
<summary><strong>Flight data sync</strong></summary>

Flight schedules are fetched from the [AviationStack](https://aviationstack.com/) API and stored as a static JSON file:

```bash
cd data

# Fetch today's MFM flights (requires API key)
AVIATIONSTACK_API_KEY=your_key uv run python scripts/fetch_flights.py

# Fetch a specific date
AVIATIONSTACK_API_KEY=your_key uv run python scripts/fetch_flights.py 2026-04-19
```

The sync:
- Pulls arrivals and departures for MFM (IATA: `MFM`) from the AviationStack flights endpoint
- Filters by the target date's active schedule
- Validates aircraft type codes (ICAO format like A320, B738)
- Outputs `public/data/flights.json` with times in Macau local (UTC+8)

This is also automated via GitHub Actions (`.github/workflows/update-flights.yml`), which runs daily at 04:00 Macau time (UTC+8) and commits updated flight data if changed.

</details>

<details>
<summary><strong>Ferry schedule scraper</strong></summary>

Ferry timetables are scraped from the operator sites and stored as a single static JSON file with 6 routes across two operators (TurboJET and CotaiJet):

```bash
cd data

# Scrape the current month's schedules for all routes
uv run python scripts/fetch_ferry_schedules.py
```

The scraper:
- Pulls TurboJET schedules for Hong Kong (Outer Harbour), Hong Kong (Taipa), HKIA, Shenzhen Airport, and Shekou
- Pulls CotaiJet schedule for Hong Kong (Sheung Wan) ↔ Macau Taipa
- Records `fetchedAtUtc` and `effectiveAs` metadata so stale data is easy to spot
- Outputs `public/data/ferry-schedules.json`

Automated via GitHub Actions (`.github/workflows/update-ferry-schedules.yml`), which runs on the 1st of each month at 00:00 UTC (08:00 Macau) and commits updates if changed.

</details>

## Data Sources

- **LRT tracks & stations** — [OpenStreetMap](https://www.openstreetmap.org/) (railway=light_rail relations)
- **LRT timetables** — [MLM 澳門輕軌股份有限公司](https://www.mlm.com.mo/) official per-station timetable publications (Taipa / Seac Pai Van / Hengqin lines), transcribed and checked for timetable-driven playback
- **Bus routes & stops** — OpenStreetMap + [motransportinfo.com](https://www.motransportinfo.com) curated stop data
- **Road-snapped routes** — [OSRM](http://project-osrm.org/) with custom bridge approach geometry
- **Bus timetables** — Based on published DSAT service frequencies
- **Flight schedules** — [AviationStack API](https://aviationstack.com/) (MFM arrivals + departures)
- **Ferry schedules** — [TurboJET](https://www2.turbojet.com.hk/zh-tw/%E6%B5%B7-%E8%88%B9/) + [CotaiJet](https://m.cotaiwaterjet.com/hk/ferry-schedule/hongkong-macau-taipa.html) official monthly timetables
- **Parishes** — [OpenStreetMap](https://www.openstreetmap.org/copyright) administrative boundaries (the seven freguesias plus the Cotai reclamation zone) + [DSEC](https://www.dsec.gov.mo/) 2021 census population and land area by parish (manual refresh)
- **Road-works notices** — [DSAT via data.gov.mo](https://data.gov.mo/Detail?id=81c17efc-3e92-484e-ab14-de7fa0f90f01) (daily)
- **School buildings** — [DSEDJ school list](https://data.gov.mo/Detail?id=f0578833-7dd6-4ed5-b825-75e9c4f56012) on data.gov.mo + OpenStreetMap building footprints (manual refresh); founding years hand-transcribed from DSEDJ school profiles, the schools' own sites and zh.wikipedia
- **Public housing** — [房屋局 (IH) 社會房屋位置分佈](https://www.ihm.gov.mo/) and 經濟房屋位置分佈 lists, plus the bureau's 長者公寓 / 置換房 / 暫住房 / 夾心房屋 pages for the other public-housing programmes, + OpenStreetMap building footprints (manual refresh)
- **Public toilets** — [IAM via data.gov.mo](https://data.gov.mo/Detail?id=f6a9892d-7e16-49f0-bcd3-573d670cefe5) (monthly)
- **Religion** — [OpenStreetMap](https://www.openstreetmap.org/copyright) places of worship (temples, churches, the mosque, the Tou Tei and other folk shrines: positions and names), the [IC 文化遺產資料 API via data.gov.mo](https://data.gov.mo/Detail?id=7e1eca8e-6ffe-4f74-8c81-25c25beb45b2) (every classified temple and church: official GPS and trilingual descriptions, joined to the OSM buildings), and — for the Tou Tei shrines only — Macau Memory's [社區守護神 exhibition](https://www.macaumemory.mo/exhibitions/showexhibition!toSep?id=8c35d71325374eeda344f11a351a27d7) map (names, street addresses and record ids only — its positions are Google geocodes of a street name, flagged approximate; no photos or text are copied) (manual refresh)
- **Historical maps** — de Guignes 1792/1808: the Getty Research Institute's copy of the atlas on the [Internet Archive](https://archive.org/details/gri_33125008481232) (public domain; leaves 141–142 straightened, stitched and georeferenced by `scripts/build-old-maps.mjs`), with the [BnF catalogue record](https://catalogue.bnf.fr/ark:/12148/cb30555797m) and the MUST Library's [全球地圖中的澳門 entry](https://libspc.must.edu.mo/fullRead/000051/991003001149605076) as references; Baker 1796: the [Library of Congress sheet](https://www.loc.gov/item/2002628198/) (Geography and Map Division, no known restrictions) via its [Wikimedia Commons mirror](https://commons.wikimedia.org/wiki/File:A_Plan_of_the_city_and_harbour_of_Macao_-_a_colony_of_the_Portugueze,_situated_at_the_southern_extremity_of_the_Chinese_Empire_in_Lat._22_%E2%81%B012%CA%B944%CA%BA_N.,_long._113%E2%81%B035%CA%B90%CA%BA_east_of_Greenwich_LOC_2002628198.jpg), with the MUST Library's [entry](https://libspc.must.edu.mo/fullRead/000051/991003375723705076) as reference; Heitor 1889: the [Library of Congress sheet](https://www.loc.gov/item/2002624048/) (no known restrictions) via its [Wikimedia Commons mirror](https://commons.wikimedia.org/wiki/File:Planta_da_peninsula_de_Macau._LOC_2002624048.jpg), with the MUST Library's [entry](https://libspc.must.edu.mo/fullRead/000051/991000435439705076) as reference; Sauvage 1893: the [Arquivo Histórico Ultramarino's DigitArq record PT/AHU/CARTM/062/01433](https://digitarq.arquivos.pt/documentDetails/d1726557bef843a39756d7945439d6ba) (digitised under the PRR, CC BY-SA 4.0 — the georeferenced plate carries the same licence), with the MUST Library's [entry](https://libspc.must.edu.mo/fullRead/000051/991003573202005076) as reference; Comissão de Cartografia 1912: the [BNP Atlas de Macau](https://purl.pt/27811), peninsula sheet at 1:10,000 (viewer page 3, 4606×6018 scan); Alves / Pires 1927: the [BNP city and new harbour plan](https://purl.pt/11434), 1:4,000 (12484×16318 scan, includes proposed harbour and reclamation works). BNP marks both digitised works Public Domain Mark 1.0; their native IIIF regions are assembled without resizing, the complete sheets, including paper margins, inset maps and the 1927 panorama, are retained in the overlay. Insets keep their original page layout rather than matching the modern basemap beneath them; Aomen Shi quan tu, circa 1953: the [Library of Congress sheet](https://www.loc.gov/item/2002626773/) (free to use and reuse; credit Library of Congress, Geography and Map Division) via its [Wikimedia Commons mirror](https://commons.wikimedia.org/wiki/File:Aomen_Shi_quan_tu._LOC_2002626773.jpg), with the MUST Library’s [entry](https://libspc.must.edu.mo/fullRead/000051/991000429929705076) documenting the alternative 1938–1941 dating; the 1921 Leitão 1:20,000 plan from *Tellurologie et Climatologie Médicales de Macao* has no accessible scan (the NLA holds it on paper, HathiTrust is search-only outside the US) and is not included — the MUST scans themselves are watermarked and all rights reserved, so they are not used (manual refresh)
- **1996 historical map service** — The **Territory of Macau** map is loaded directly from [Academia Sinica’s public WMTS service](https://gis.sinica.edu.tw/showwmts/index.php?l=Macau_20K_1996&s=macau), with the provider’s georeferencing and attribution. It requires an internet connection. Imagery remains subject to the provider’s terms (commercial use requires permission), and is not included under this repository’s MIT licence.
- **1963 geological sketch** — M. J. Lemos de Sousa’s 1:25,000 map covers the peninsula, Taipa and Coloane. The [1000×1386 scan on Mindat, uploaded by Rui Nunes](https://www.mindat.org/photo-695342.html), is marked public domain by the provider; the underlying publication rights have not been independently established. A single affine registration preserves the sheet’s relative shapes using six approximate reservoir and hilltop matches. The scan is enlarged to 2000×2772 with conventional 2× resampling and gentle sharpening, without generating text or geographic features. Small labels remain limited by the source resolution; the overlay is intended for territory-scale comparison, not precise measurement. Imagery is separate from the repository’s MIT code licence.
- **Public car parks** — [DSAT via data.gov.mo](https://data.gov.mo/Detail?id=ac55c2f1-780a-4dc8-875f-851b2203b706) (daily) + [live vacancy](https://data.gov.mo/Detail?id=ea50a770-cc35-47cc-a3ba-7f60092d4bc4) (live, polled by the browser)
- **Waste & recycling** — IAM [垃圾房](https://data.gov.mo/Detail?id=57964cb5-5868-47e5-bd8d-334385467a21) (refuse rooms) + [壓縮式垃圾收集點](https://data.gov.mo/Detail?id=e49ac4a5-83c1-48f8-8317-e783f4a1867e) (compactors) via data.gov.mo ZIP download, and [全澳垃圾收集設施的資訊列表](https://data.gov.mo/Detail?id=6c7617b7-8165-4564-9b51-055ddda8b3ad) via the API gateway (垃圾站 refuse stations only — the feed's other two site types duplicate the ZIP downloads above) (monthly); DSPA [智能回收機](https://data.gov.mo/Detail?id=12d42ec3-6d61-4daf-b713-eecbfcff5daa) (smart recycling machines), [三色資源回收點](https://data.gov.mo/Detail?id=db6f226e-1fbe-413a-b558-b5c2b2b0be52) (three-colour recycling), [電腦及通訊設備回收點](https://data.gov.mo/Detail?id=d358a990-06f2-4a65-9045-7543ae9f826f) (e-waste), and [光管](https://data.gov.mo/Detail?id=33264820-4523-4e8b-a91a-9089f922220a) + [電池回收點](https://data.gov.mo/Detail?id=a536616e-d870-4137-8dd6-0b2125a6c2a5) (lamp/battery, merged — identical site lists) via the data.gov.mo API gateway (monthly); DSPA [垃圾焚化中心 monthly statistics](https://data.gov.mo/Detail?id=8142c05e-818a-478a-9256-4ecd494d3f87) (monthly, best-effort — the panel just omits the stats block if the call fails) — eight datasets plus IAM's [環境資訊網 facility map](https://www.iam.gov.mo/macaohygiene/c/allgarbage/map) JSON (`facility_c.json`, not on data.gov.mo: the 5 玻璃樽公共回收點 glass-bottle and 16 全澳衣物公共回收點 clothing recycling points), ≈1,157 sites total; plus 10 hand-placed DSPA [環保加Fun站](https://www.dspa.gov.mo/) Eco Fun stations, the hand-placed [特殊和危險廢物處理站](https://www.dspa.gov.mo/place1_3.aspx) hazardous-waste station, and two OpenStreetMap landfill outlines (ways [552848944](https://www.openstreetmap.org/way/552848944), [552740242](https://www.openstreetmap.org/way/552740242)) — the incineration plant's own buildings come from OpenStreetMap through `power-facilities.json` already, no extra dataset. Monthly throughput for four of those — the incinerator, the hazardous-waste station, the construction-waste landfill and the territory's five sewage plants — lands in a separate `dspa-stats.json`: the incinerator dataset above, plus DSPA's [澳門半島污水處理廠](https://data.gov.mo/Detail?id=9c555082-70e8-452f-a86b-073cd0da4a55), [氹仔污水處理廠](https://data.gov.mo/Detail?id=9d257556-9d52-4a59-afa0-d1a2a2bab0a8), [路環污水處理廠](https://data.gov.mo/Detail?id=a5a05d0e-30c5-4298-81d5-e6bee5af5e8b) and [澳門跨境工業區污水處理站](https://data.gov.mo/Detail?id=4a57b120-60f2-4a36-a6eb-7f93f340f2e6) monthly figures via the API gateway (monthly); the hazardous station's, the landfill's and the airport plant's monthly figures are published only on [DSPA's GIS pages](https://apps.dspa.gov.mo/gis/publicData.html), not on data.gov.mo — every series is best-effort, `null` in the file (and hidden in the panel) when a call fails
- **Water supply facilities** — [Macao Water 供水設施](https://www.macaowater.com/about-macao-water/water-supply-facilities) (the list of 22) + OpenStreetMap footprints, plus 黑沙水庫 Hac Sa Reservoir from OpenStreetMap (a DSAMA government reservoir, not a Macao Water facility); the figures in the panel come from Macao Water's [供澳原水](https://www.macaowater.com/about-macao-water/water-sources) and [統計數據](https://www.macaowater.com/about-macao-water/water-supply-statistics) pages, re-read on every run (twice a year)
- **Electricity grid** — [CEM 澳電 營運](https://www.cem-macau.com/zh/about-cem/company-profile/operation/) (the substation list in Chinese and [English](https://www.cem-macau.com/en/about-cem/company-profile/operation/), the year's generation/import figures and the Guangdong interconnection history, re-read on every run) + OpenStreetMap footprints; the 220/110/66 kV lines between them are our schematic, not CEM's cable routes, which are underground and unmapped (twice a year)
- **Grand Prix circuit** — OpenStreetMap relation [8877949 Circuito da Guia](https://www.openstreetmap.org/relation/8877949) (the racing line and the pit lane) + the [Macau Grand Prix Committee's circuit page](https://www.macau.grandprix.gov.mo/en/about-us/matchpath) (the corner names in three languages, the 6.2 km lap length and the 7 m minimum width); the lap record the car runs at is Wikipedia's figure, flagged as a secondary source in the panel; corner coordinates are ours, derived from the track geometry by a rule the file records (manual refresh)

Everything under `/data/*.json` is fetchable as-is but served with `X-Robots-Tag: noindex, nofollow` (`public/_headers`) so the raw files stay out of search results. It is a header rather than a `robots.txt` Disallow on purpose: a crawler that is disallowed never sees the `noindex`, and a disallowed URL can still be listed bare when something links to it.

## Data freshness & update strategy

Not every layer is equally fresh. LRT and buses are **fully simulated** from published timetables; flights and ferries are **static syncs** on their own schedule. None of the transit layers below touch a live feed.

| Layer | Mode | Source | Refresh cadence | Staleness indicator |
|-------|------|--------|-----------------|---------------------|
| **LRT** | Simulated | OSM geometry + MLM published per-station timetable | Manual updates following official publications | Schedule-specific API; no live vehicle feed |
| **Bus** | Simulated | OSM geometry + DSAT published service frequencies, dimmed by a daily service-status scrape | Manual regen (routes) · daily (`service-status.yml`) | DSAT stop snapshot timestamp in `data/bus_reference/dsat_stops.json` (current: 2026-09-02 Macau) |
| **Flights** | Static daily sync | [AviationStack API](https://aviationstack.com/) | Daily at 04:00 Macau time — `update-flights.yml` | `fetchedAtUtc` embedded in `flights.json` |
| **Ferries** | Static monthly sync | TurboJET + CotaiJet timetable pages (scraped) | 1st of month · `update-ferry-schedules.yml` | `fetchedAtUtc` + `effectiveAs` in `ferry-schedules.json` |

**What each mode means**

- **Simulated** — Vehicles are placed on pre-generated polylines and moved by the client clock using the published timetable. They don't reflect any single bus or train's actual position at that moment; they show "what the schedule says should be moving through this segment right now."
- **Static sync** — A scheduled GitHub Actions job fetches upstream data and commits a new `public/data/*.json` if it changed. The app reads whatever was in the last build; there is no per-page-load fetch for flights or ferries.

## Project Structure

<details>
<summary><strong>File tree</strong></summary>

```
mini-macau/
├── src/
│   ├── components/
│   │   ├── MapView.tsx           # Main map + hamburger menu
│   │   ├── ControlPanel.tsx      # Playback speed controls
│   │   ├── TimeDisplay.tsx       # Clock + DateTimePicker trigger
│   │   ├── DateTimePicker.tsx    # Date/time selection overlay
│   │   ├── LineLegend.tsx        # Layer legend — desktop TRANSIT/CITY pages + mobile chips
│   │   ├── VehicleInfoPanel.tsx  # Vehicle detail + ETA
│   │   ├── StationInfoPanel.tsx  # Station detail + next arrivals
│   │   ├── FlightInfoPanel.tsx   # Flight detail panel
│   │   ├── FerryInfoPanel.tsx    # Ferry detail panel
│   │   ├── RoadWorkInfoPanel.tsx # Road-work notice detail panel
│   │   ├── SchoolInfoPanel.tsx   # School building detail panel
│   │   ├── PublicHousingInfoPanel.tsx # Public-housing estate detail panel
│   │   ├── ParishInfoPanel.tsx   # Parish / reclamation-zone detail panel
│   │   ├── ToiletInfoPanel.tsx   # Public toilet detail panel
│   │   ├── ReligionInfoPanel.tsx # Tou Tei temple / shrine detail panel
│   │   ├── CarParkInfoPanel.tsx  # Car park detail + live vacancy panel
│   │   ├── WasteSiteInfoPanel.tsx # Waste site/incinerator/eco-station/facility panels (4 exports)
│   │   └── StatsChart.tsx         # Shared monthly bar chart (incinerator/hazardous/landfill/WWTP panels)
│   ├── engines/
│   │   └── simulationEngine.ts   # Timetable-driven vehicle + flight position computation
│   ├── data/
│   │   └── hourDensity.ts
│   ├── hooks/
│   │   ├── useSimulationClock.ts # RAF-based clock with speed/pause
│   │   ├── useTransitData.ts     # JSON data loader
│   │   └── useCarParkVacancy.ts  # Live car-park vacancy polling (1x + tab visible only)
│   ├── layers/
│   │   ├── InstancedVehicleModelLayer.ts # Shared WebGL2 instanced renderer + shaders
│   │   ├── busMesh.ts            # Procedural triangle mesh for the Macau city bus
│   │   ├── lrtMesh.ts            # Procedural articulated two-car LRT mesh
│   │   ├── aircraftMesh.ts       # Procedural aircraft fuselage/wing/engine mesh
│   │   ├── ferryMesh.ts          # Procedural high-speed catamaran mesh
│   │   ├── Bus3DLayer.ts         # Instanced bus mesh + invisible picking volume
│   │   ├── LRT3DLayer.ts         # Instanced articulated LRT + picking volumes
│   │   ├── Flight3DLayer.ts      # Instanced aircraft fleet/tracked batches + picking volumes
│   │   ├── Ferry3DLayer.ts       # Instanced ferry mesh + invisible picking volumes
│   │   ├── RaceCar3DLayer.ts     # 3D open-wheel car for the Grand Prix layer (fill-extrusion, moved by diff)
│   │   └── VehicleLayer.ts       # 2D vehicle circles + labels (VEHICLE_SOURCE_MAXZOOM shared by the vehicle sources)
│   ├── App.tsx                   # Root layout + state management
│   ├── main.tsx                  # React entry point with I18nProvider
│   ├── debugOverlay.ts           # ?debug=1 on-screen diagnostics (capabilities, errors, heartbeat, pinned lines)
│   ├── routeGroups.ts            # Bus route grouping logic
│   ├── roadWorks.ts              # Road-works notice helpers (status, colours)
│   ├── schools.ts                # School overlay helpers (level + founding-era colours, footprint features)
│   ├── publicHousing.ts          # Public-housing overlay helpers (type + decade colours, footprint features)
│   ├── parishes.ts               # Parish overlay helpers (per-area tints, area + label features, density)
│   ├── toilets.ts                # Public-toilet overlay helpers (variant, marker features)
│   ├── religion.ts               # Religion overlay helpers (categories, kinds, colours, marker features)
│   ├── oldMaps.ts                # Historical-maps overlay helpers (ids, names, hidden set, opacity)
│   ├── carParks.ts               # Car-park overlay helpers + live-vacancy XML parsing
│   ├── waste.ts                  # Waste & recycling overlay helpers (colours, text pickers, visible-site filtering)
│   ├── dspaStats.ts              # DSPA monthly-stats chart model (axis rounding, series lookup)
│   ├── water.ts                  # Water overlay helpers (supply-chain stages, labels, pulse buckets)
│   ├── power.ts                  # Power overlay helpers (stages, voltages, grid features)
│   ├── flowPulse.ts              # Shared pulse engine for the water / power flows
│   ├── grandPrix.ts              # Guia Circuit: track & corner features, speed profile, car pose, wake
│   ├── layerVisibility.ts       # Independent overlay visibility + explicit Show only action
│   ├── theme.ts                  # dark / light theme store (data-theme on <html>)
│   ├── timeControls.ts           # Clock shortcut guard for native controls
│   ├── macauTime.ts              # All wall-clock math (Macau, UTC+8)
│   ├── dataSchemas.ts            # zod schemas for public/data/*.json (mirrors validate_output.py)
│   ├── i18n.tsx                  # Internationalization (EN / 繁中 / PT)
│   ├── types.ts                  # TypeScript interfaces
│   └── index.css                 # Tailwind + MapLibre control overrides
├── public/
│   ├── _headers                  # X-Robots-Tag: noindex for /data/* and /gltest.html
│   ├── gltest.html               # Standalone MapLibre 5/6 device test page (no app code)
│   ├── data/                     # served as-is under /data/
│   │   ├── lrt-lines.json
│   │   ├── stations.json
│   │   ├── bus-routes.json
│   │   ├── bus-stops.json
│   │   ├── flights.json          # MFM flight schedules (with localized names)
│   │   ├── ferry-schedules.json  # TurboJET + CotaiJet monthly timetables
│   │   ├── road-works.json       # DSAT road-works notices
│   │   ├── schools.json          # School buildings + footprints
│   │   ├── public-housing.json   # IH social + economic housing estates and footprints
│   │   ├── parishes.json         # 7 civil parishes + the Cotai reclamation zone (OSM boundaries, DSEC census)
│   │   ├── toilets.json          # IAM public toilets
│   │   ├── religion.json         # Temples, churches, mosque, Tou Tei shrines (OSM + IC heritage API + Macau Memory)
│   │   ├── old-maps.json         # Georeferenced historical maps: titles, bounds, control points, attribution
│   │   ├── old-maps/             # The rubbersheeted plates (north-up WebP with alpha), built by scripts/build-old-maps.mjs
│   │   ├── car-parks.json        # DSAT public car parks
│   │   ├── waste.json            # IAM + DSPA sites, eco stations, treatment facilities (incl. 5 WWTPs)
│   │   ├── dspa-stats.json       # DSPA monthly stats: incinerator, hazardous station, landfill, 5 WWTPs
│   │   ├── water-facilities.json # Macao Water supply facilities + footprints
│   │   ├── water-distribution.json # Macau-only road network for the water layer
│   │   ├── power-facilities.json # CEM power station, incinerator, HV substations + schematic grid
│   │   ├── power-distribution.json # Macau-only road network for the power layer
│   │   └── grand-prix.json       # Guia Circuit: OSM racing line + official corner names
│   ├── favicon.svg
│   ├── icons.svg
│   ├── og-image.png
│   ├── sitemap.xml
│   └── robots.txt
├── data/
│   ├── scripts/
│   │   ├── extract_lrt_osm.py
│   │   ├── extract_bus_data.py
│   │   ├── fetch_bus_data.py
│   │   ├── fetch_bridge_geometry.py
│   │   ├── fetch_flights.py      # AviationStack flight data sync (MFM)
│   │   ├── fetch_ferry_schedules.py # TurboJET + CotaiJet monthly scraper
│   │   ├── fetch_road_works.py   # DSAT road-works notice sync
│   │   ├── fetch_schools.py      # DSEDJ school list + OSM footprints (manual)
│   │   ├── fetch_public_housing.py # IH social + economic housing lists + OSM footprints (manual)
│   │   ├── fetch_parishes.py     # OSM parish boundaries + DSEC census figures (manual)
│   │   ├── fetch_water_facilities.py # Macao Water's 22 facilities + OSM footprints (twice a year)
│   │   ├── macao_water.py        # reads Macao Water's site: the year's statistics, the raw-water facts, the plant names, zh/en/pt
│   │   ├── fetch_water_distribution.py # Macau-only road canvas, oriented from the water sources (manual)
│   │   ├── fetch_power_facilities.py # CEM substations + OSM footprints + schematic grid (twice a year)
│   │   ├── cem_operation.py      # reads CEM's operation page: the year's figures + the substation names, zh and en
│   │   ├── fetch_power_distribution.py # the same road canvas, oriented from the substations (manual)
│   │   ├── fetch_grand_prix.py   # Guia Circuit from OSM + the organiser's corner names (manual)
│   │   ├── road_network.py       # Shared Macau-only road canvas (clip, simplify, flow field)
│   │   ├── osm_footprints.py     # Shared Overpass + basemap-tile footprint helpers
│   │   ├── fetch_toilets.py      # IAM public-toilet sync
│   │   ├── fetch_religion.py     # Places of worship: five categories (manual)
│   │   ├── fetch_car_parks.py    # DSAT public car-park sync
│   │   ├── fetch_waste.py        # IAM + DSPA waste & recycling sync
│   │   ├── fetch_dspa_stats.py   # monthly via update-dspa-stats.yml
│   │   ├── osrm_route.py
│   │   └── patch_bus_bridges.py
│   ├── bus_reference/
│   └── main.py
├── functions/
│   └── api/lrt/[stype].ts    # Pages Function — bounded vehicle state endpoint
├── plugins/
│   └── lrt-dev-api.ts        # Dev-only stand-in for the Function above
├── .github/workflows/
│   ├── deploy.yml                  # Cloudflare Pages CI/CD
│   ├── service-status.yml          # Upstream service availability check
│   ├── update-flights.yml          # Daily flight data update
│   ├── update-ferry-schedules.yml  # Monthly ferry data update
│   ├── update-road-works.yml       # Daily road-works notice update
│   ├── update-toilets.yml          # Monthly public-toilet update
│   ├── update-car-parks.yml        # Daily car-park update
│   ├── update-waste.yml            # Monthly waste & recycling update
│   └── update-dspa-stats.yml       # Monthly DSPA statistics update
└── index.html
```

</details>

## Performance Notes

Simulating 300–400 moving vehicles at 30 Hz while MapLibre re-draws 3D extrusions every frame puts real pressure on the main thread. A few optimizations worth calling out:

<details>
<summary><strong>Bus traffic runs in a dedicated worker</strong></summary>

Both the 3D map and the 2D fallback calculate bus following, junction reservations and swept-body checks in a module worker. Accelerated playback uses aligned batches, with route traces transferred back for interpolation between replies. Visible models use detailed lane samples and an additional presentation collision check. There is at most one request in flight: clock updates coalesce instead of building a queue of obsolete frames. Each job advances at most eight simulated seconds, retaining queues and reservations while catching up. If the worker persistently falls behind during accelerated playback, the selected speed decreases to the next available rate; the controls and clock reflect that rate. Seeks and layer changes reject stale replies; pausing freezes the latest checked position, including while the camera moves. If workers are unavailable, the traffic engine runs synchronously.

Only bus routes and stops are sent to the worker. Route objects retain stable identities across visibility changes, and unchanged data is not copied on each tick. Traffic near the camera and tracked vehicle retains 0.5-second physics steps, with a surrounding approach buffer. Distant map markers follow schedule positions until they enter that buffer; existing queues remain selected by their physical positions. This bounds detailed work by the viewed area rather than the whole fleet. See [`asyncBusFrame.ts`](src/engines/asyncBusFrame.ts) and [`busWorkerRuntime.ts`](src/engines/busWorkerRuntime.ts).

</details>

<details>
<summary><strong>The clock is an external store, not App state</strong></summary>

The simulation clock ticks ~10 times a second. It used to publish the time as React state on the hook that `App` owns, so every tick re-rendered `App` and its whole tree — the layer panel with its hundreds of rows included — to move a seconds digit. In the dev build that was 30–40 ms of React work ten times a second.

Now `useSimulationClock` publishes the time through a tiny store (`subscribeTime` / `getTimeMs`) and components pick their own resolution with `useSyncExternalStore`: `useClockTime` re-renders on every tick and is used only by the clock face and the scrubber; `useClockMinute` snapshots the simulated minute, so `App` and the info panels — which decide by service windows, the day's flights and minute-level ETAs — re-render once per simulated minute (once a second at 60×). Per-frame consumers (the engine, the 3D layers) never rendered off the clock at all; they read `timeRef`. See [`useSimulationClock.ts`](src/hooks/useSimulationClock.ts).

</details>

<details>
<summary><strong>Polyline progress lookup — <code>cumKm</code> + binary search</strong></summary>

The simulation asks the same question once per vehicle per tick: *given a route and a progress ∈ [0, 1], where on the polyline is the vehicle, and which way is it facing?*

The original implementation used Turf's [`along`](https://turfjs.org/docs/api/along) twice per vehicle (once for position, once for a 1-metre-ahead lookahead to derive bearing). `along` walks the coordinate array from index 0 and sums haversine distances until it reaches the target km — **O(n) haversines per call**. At ~400 vehicles × 2 calls × 20 Hz × 100-point routes, that worked out to roughly **12 000 full-route scans per second**, all on the main thread.

Key observation: each route's geometry is immutable, so the per-segment work only needs to happen once. On first touch we cache:

- `cumKm[i]` — cumulative kilometres from `coords[0]` to `coords[i]` (`Float64Array`)
- `segBearing[i]` — heading of segment `coords[i] → coords[i+1]` (`Float64Array`)

Per-call cost then collapses to a binary search on `cumKm` (≈ 8 comparisons for a 150-point route), a linear interpolation between two lat/lng pairs, and a table lookup for bearing. No trig in the hot loop, and no second `along` call since the segment index already tells us the heading.

We deliberately don't cache a per-line "last index" hint: multiple vehicles share the same polyline at different progress values, so a shared hint would thrash. `O(log n)` is cheap enough that per-vehicle state isn't worth it. See [`simulationEngine.ts`](src/engines/simulationEngine.ts) (`getLineCache` / `interpolateOnLine`).

</details>

<details>
<summary><strong>One bus-routes source instead of 92</strong></summary>

MapLibre GeoJSON sources are **tiled in a web worker**: the worker clips each source's features to tile boundaries, tessellates lines into triangle strips, and ships vertex buffers back to the main thread. Originally each of the 92 bus routes was its own `addSource` + `addLayer`, meaning every zoom level change forced 92 separate `postMessage` round-trips and 92 independent tile-index rebuilds.

Consolidating into a single `bus-routes` source (one tile index, one round-trip per reindex) drastically cut worker chatter during zoom. Per-route dimming — previously `setPaintProperty('bus-route-${id}', 'line-opacity', …)` against 92 layers — became `setFeatureState({ source: 'bus-routes', id }, { inService })` on one layer, with opacity driven by a `['case', ['==', ['feature-state', 'inService'], false], DIM, FULL]` paint expression. `setFeatureState` doesn't recompile paint; `setPaintProperty` does.

</details>

<details>
<summary><strong>Two-tier animation throttle</strong></summary>

The bus, LRT, aircraft and ferry models use shared instanced meshes. CPU instance arrays and GPU buffers are reused for subsequent poses; buffer storage is reallocated only when a batch grows or its WebGL context is rebuilt. Unchanged visible bus snapshots skip both mesh and picking-source uploads, including camera moves that leave the visible fleet unchanged.

The animate loop samples surface positions and requests available bus-worker updates every 33 ms. GeoJSON `setData` still re-tiles each source's in-view tiles and uploads their buffers, so the 3D picking sources and the 2D marker source share one upload cadence: 33 ms on desktop, 100 ms on phones, and 160 ms whenever the map is actively moving (`movestart` / `moveend` set a `mapBusy` flag). The 2D marker source used to be written every animation frame, 60 re-tilings a second of a source that only changes at the sim tick; on an iPhone X that was 450 tile reloads a second and a lost WebGL context.

</details>

<details>
<summary><strong>Fewer tiles per <code>setData</code></strong></summary>

Once the cadence was fixed, that iPhone X still re-tiled ~450 tiles a second at zoom 16, and the `?debug=1` heartbeat — which names the busiest sources — showed why: a pitched phone view holds ~20 z16 tiles per GeoJSON source, and every `setData` reloads all of them, so the cost is *tiles × sources × cadence*. Three changes attack the tile count rather than the cadence:

- **Vehicle sources are tiled to z15** (`VEHICLE_SOURCE_MAXZOOM` in [`VehicleLayer.ts`](src/layers/VehicleLayer.ts)): a zoom-16 view is a handful of z15 tiles instead of ~20 z16 ones, 4× fewer again per level above, at a coordinate quantisation of ~0.14 m — half a pixel at zoom 18.
- **The Grand Prix car, wake and speed label move by diff.** They are written whole once when they appear and then updated with `GeoJSONSource.updateData`, which reloads only the tiles the changed feature touches (one or two) instead of every tile in view. Stable feature ids make that possible: the car's twelve boxes are ids 0–11.
- **MapLibre 6's `zoomLevelsToOverscale` is switched off** (`undefined`, the v5 behaviour). Its default of 4 slices a vector source's z14 tiles into sub-tiles down to z18 instead of scaling the one parent tile; at zoom 16 / pitch 45 that was 44 tile loads instead of 8 and 2.3× the live GPU buffers for the same view.

Measured on the same phone at the same view: 457 → 110 tile reloads a second, 60 fps, no shader failures in that run. Later device tests still lost context on pure basemaps at DPR 1; these load reductions are not a demonstrated fix for persistent context loss (see the recovery investigation above). See [`MapView.tsx`](src/components/MapView.tsx) (`HEAVY_TICK_MS_PHONE`, `writeGrandPrixWake`, `zoomLevelsToOverscale`) and [`RaceCar3DLayer.ts`](src/layers/RaceCar3DLayer.ts) (`setPose`).

</details>

<details>
<summary><strong>Decouple zoom display from React re-renders</strong></summary>

The zoom indicator in the HUD used to be a `useState`, so every `map.on('zoom', …)` event caused `<MapView>` to re-render — which is a *huge* component with map refs, ETA panels, and layer toggles. Now zoom lives in an external store read via [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore), and only a tiny `<ZoomText>` leaf subscribes. The rest of `<MapView>` stays stable during pinch/scroll zoom.

</details>

## Acknowledgements

<details>
<summary><strong>Inspiration</strong></summary>

- [Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d) — Original inspiration for the concept
- [Mini Taiwan](https://mini-taiwan-learning-project.itsmigu.com/) — Sister project inspiration

</details>

<details>
<summary><strong>Data sources</strong></summary>

- [OpenStreetMap](https://www.openstreetmap.org/) — LRT track geometry, bus routes, and stop locations
- [MLM 澳門輕軌股份有限公司](https://www.mlm.com.mo/) — Official per-station LRT timetables, hand-transcribed for the Taipa / Seac Pai Van / Hengqin lines
- [MoTransport Info](https://motransportinfo.com/zh/search) — Curated Macau bus stop reference data
- [AviationStack](https://aviationstack.com/) — MFM flight schedule data (arrivals + departures)
- [TurboJET](https://www2.turbojet.com.hk/) — Ferry timetable (Hong Kong, HKIA, Shenzhen Airport, Shekou routes)
- [CotaiJet](https://www.cotaiwaterjet.com/) — Ferry timetable (Hong Kong ↔ Macau Taipa route)

</details>

<details>
<summary><strong>Libraries, tiles, and fonts</strong></summary>

- [MapLibre GL JS](https://maplibre.org/) — Open-source map rendering
- [CARTO](https://carto.com/) — Basemap tiles (Dark Matter / Positron)
- [OpenFreeMap](https://openfreemap.org/) — 3D building tiles
- [OSRM](http://project-osrm.org/) — Road routing engine
- [Turf.js](https://turfjs.org/) — Geospatial analysis
- [Google Fonts](https://fonts.google.com/specimen/Orbitron) — Orbitron, JetBrains Mono, Noto Sans HK

</details>

## License

[MIT](./LICENSE)
