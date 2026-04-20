# Mini Map Macau 🚈🚌✈️🛥️

> **[mini-map-macau.app](https://mini-map-macau.app/)**

[![Live site](https://img.shields.io/website?url=https%3A%2F%2Fmini-map-macau.app&label=live&up_message=online&down_message=offline)](https://mini-map-macau.app/)
[![Latest release](https://img.shields.io/github/v/tag/asdfghj1237890/mini-macau?label=release&sort=semver)](https://github.com/asdfghj1237890/mini-macau/tags)
[![Deploy](https://img.shields.io/github/actions/workflow/status/asdfghj1237890/mini-macau/deploy.yml?label=deploy&branch=master)](https://github.com/asdfghj1237890/mini-macau/actions/workflows/deploy.yml)
[![Flights sync](https://img.shields.io/github/actions/workflow/status/asdfghj1237890/mini-macau/update-flights.yml?label=flights%20sync)](https://github.com/asdfghj1237890/mini-macau/actions/workflows/update-flights.yml)
[![Ferries sync](https://img.shields.io/github/actions/workflow/status/asdfghj1237890/mini-macau/update-ferry-schedules.yml?label=ferries%20sync)](https://github.com/asdfghj1237890/mini-macau/actions/workflows/update-ferry-schedules.yml)
[![License](https://img.shields.io/github/license/asdfghj1237890/mini-macau)](./LICENSE)
[![Made with React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-5-396CB2?logo=maplibre&logoColor=white)](https://maplibre.org/)

Real-time 3D visualization of Macau's public transit, ferry, and aviation system, inspired by [Mini Tokyo 3D](https://minitokyo3d.com) and [Mini Taiwan](https://mini-taiwan-learning-project.itsmigu.com/).

Visualizes the **Macau Light Rapid Transit (LRT)**, **bus network**, **HK–Macau ferry routes**, and **MFM airport flights** on an interactive 3D map with simulated vehicle movements along actual routes, synchronized to real-world timetables.

![og-image](https://mini-map-macau.app/og-image.png)

## Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Data Pipeline](#data-pipeline)
- [Data Sources](#data-sources)
- [Project Structure](#project-structure)
- [Performance Notes](#performance-notes)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Features

- **3D LRT vehicles** — 3 lines, 15 stations, real track geometry and elevated viaducts
- **3D Bus fleet** — 92 routes, road-snapped via OSRM, with accurate cross-harbour bridge geometry
- **3D Aircraft** — 176 real MFM flights (87 dep + 89 arr) with detailed airplane models, apron stands, and taxi paths
- **3D Ferries** — 6 HK/Shenzhen ↔ Macau sea routes (TurboJET + CotaiJet) with jetfoil-shaped hull, red belly belt, and multi-deck cabin
- **Real-time simulation** — Timetable-driven playback with ETAs, service status, and trilingual labels (EN / 繁中 / PT)
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
- **Automated ferry data** — GitHub Actions workflow scrapes TurboJET and CotaiJet timetables monthly and commits updated schedules if changed
- **Time controls** — Play, pause (spacebar), speed up (1×–60×), jump to current time, or pick any date/time with the DateTimePicker; Esc toggles the sidebar menu
- **Vehicle tracking** — Click a vehicle to follow it with smooth camera animation; freely zoom/pan while tracking
- **Route visibility** — Toggle individual bus routes by group (Peninsula, Cross-Harbour, Taipa/Cotai, Night, Special); auto-mode shows only routes currently in service
- **3D/2D toggle** — Switch between perspective and top-down views
- **Dark/Light mode** — Two map styles (CARTO Dark Matter / Positron)
- **Trilingual UI** — English / 繁體中文 / Português — flight destinations, station names, and all labels switch with the language
- **Cyberpunk-styled menu** — Hamburger menu with Orbitron-font title and gradient branding
- **Responsive mobile UI** — Hamburger menu for map controls, compact legend buttons (LRT/Bus), optimized touch layout with safe-area support
- **Lazy loading** — Code-split panels (VehicleInfoPanel, StationInfoPanel, FlightInfoPanel) for fast initial load
- **Automated flight data** — GitHub Actions workflow scrapes the official Macau Airport timetable daily and optionally cross-verifies against AviationStack API

</details>

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 6, Vite 8 |
| 3D Map | MapLibre GL JS, custom WebGL fill-extrusion layers |
| Geo utilities | Turf.js (nearest-point-on-line) + custom precomputed-polyline cache |
| Styling | Tailwind CSS v4 |
| Fonts | Orbitron, JetBrains Mono, Noto Sans HK (Google Fonts) |
| Data pipeline | Python 3.13+, uv, OpenStreetMap Overpass API, OSRM |
| Flight data | [Macau Airport](https://www.macau-airport.com/) timetable (web scraper) + AviationStack API (cross-verification) |
| Ferry data | [TurboJET](https://www2.turbojet.com.hk/) + [CotaiJet](https://www.cotaiwaterjet.com/) timetables (monthly web scraper) |
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

## Data Pipeline

Transit data is pre-generated and included in `public/data/`.

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
6. Output JSON files to `data/output/`

Then copy the output to `public/data/`.

</details>

<details>
<summary><strong>Flight data scraper</strong></summary>

Flight schedules are scraped from the official [Macau International Airport](https://www.macau-airport.com/) timetable (both English and Chinese pages) and stored as a static JSON file:

```bash
cd data

# Scrape today's flights (no API key needed)
uv run python scripts/fetch_flights.py

# Scrape a specific date
uv run python scripts/fetch_flights.py 2026-04-19

# Optional: cross-verify against AviationStack API
AVIATIONSTACK_API_KEY=your_key uv run python scripts/fetch_flights.py
```

The scraper:
- Fetches both EN and ZH timetable pages to build localized destination names
- Filters by the target date's active schedule range and day-of-week
- Deduplicates overlapping schedule periods
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
- **Bus routes & stops** — OpenStreetMap + [motransportinfo.com](https://www.motransportinfo.com) curated stop data
- **Road-snapped routes** — [OSRM](http://project-osrm.org/) with custom bridge approach geometry
- **Timetables** — Based on published service frequencies
- **Flight schedules** — [Macau International Airport](https://www.macau-airport.com/) official timetable (EN + ZH), with optional [AviationStack](https://aviationstack.com/) cross-verification
- **Ferry schedules** — [TurboJET](https://www2.turbojet.com.hk/zh-tw/%E6%B5%B7-%E8%88%B9/) + [CotaiJet](https://m.cotaiwaterjet.com/hk/ferry-schedule/hongkong-macau-taipa.html) official monthly timetables

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
│   │   ├── LineLegend.tsx        # LRT/Bus/Flight legend (desktop + mobile)
│   │   ├── VehicleInfoPanel.tsx  # Vehicle detail + ETA
│   │   ├── StationInfoPanel.tsx  # Station detail + next arrivals
│   │   ├── FlightInfoPanel.tsx   # Flight detail panel
│   │   └── FerryInfoPanel.tsx    # Ferry detail panel
│   ├── engines/
│   │   └── simulationEngine.ts   # Timetable-driven vehicle + flight position computation
│   ├── hooks/
│   │   ├── useSimulationClock.ts # RAF-based clock with speed/pause
│   │   └── useTransitData.ts     # JSON data loader
│   ├── layers/
│   │   ├── Bus3DLayer.ts         # 3D bus model (fill-extrusion)
│   │   ├── LRT3DLayer.ts         # 3D LRT model (fill-extrusion)
│   │   ├── Flight3DLayer.ts      # 3D airplane model (fill-extrusion)
│   │   ├── Ferry3DLayer.ts       # 3D jetfoil model (fill-extrusion, 8 layers)
│   │   └── VehicleLayer.ts       # 2D vehicle circles + labels
│   ├── App.tsx                   # Root layout + state management
│   ├── main.tsx                  # React entry point with I18nProvider
│   ├── routeGroups.ts            # Bus route grouping logic
│   ├── i18n.tsx                  # Internationalization (EN / 繁中 / PT)
│   ├── types.ts                  # TypeScript interfaces
│   └── index.css                 # Tailwind + MapLibre control overrides
├── public/
│   ├── data/
│   │   ├── lrt-lines.json
│   │   ├── stations.json
│   │   ├── trips.json
│   │   ├── bus-routes.json
│   │   ├── bus-stops.json
│   │   ├── flights.json          # MFM flight schedules (with localized names)
│   │   └── ferry-schedules.json  # TurboJET + CotaiJet monthly timetables
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
│   │   ├── fetch_flights.py      # MFM timetable scraper + AviationStack cross-verifier
│   │   ├── fetch_ferry_schedules.py # TurboJET + CotaiJet monthly scraper
│   │   ├── osrm_route.py
│   │   ├── patch_bus_bridges.py
│   │   └── generate_timetable.py
│   ├── bus_reference/
│   ├── output/
│   └── main.py
├── .github/workflows/
│   ├── deploy.yml                  # Cloudflare Pages CI/CD
│   ├── docker-release.yml          # Docker image release on new tag
│   ├── service-status.yml          # Upstream service availability check
│   ├── update-flights.yml          # Daily flight data update
│   └── update-ferry-schedules.yml  # Monthly ferry data update
└── index.html
```

</details>

## Performance Notes

Simulating 300–400 moving vehicles at 20 Hz while MapLibre re-draws 3D extrusions every frame puts real pressure on the main thread. A few optimizations worth calling out:

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

Moving 300+ buses as 3D fill-extrusion polygons is heavy (each bus is 8 quads × lat/lng math). Moving them as 2D circles is almost free (just a `setData` on a Point FeatureCollection).

The animate loop splits them: simulation + 2D circle updates run every 50 ms unconditionally, while 3D polygon rebuilds throttle to 160 ms whenever the map is actively moving (`movestart` / `moveend` set a `mapBusy` flag). During zoom gestures the 2D layer keeps vehicles visibly moving at full cadence while the expensive 3D rebuild backs off, leaving MapLibre's own render pipeline more time to finish zoom frames.

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
- [MoTransport Info](https://motransportinfo.com/zh/search) — Curated Macau bus stop reference data
- [DSAT 巴士資訊](https://bis.dsat.gov.mo/macauweb/index.html?language=zh-tw&fromDzzp=false) — Official Macau bus realtime feed (live bus positions in RT mode)
- [Macau International Airport](https://www.macau-airport.com/) — Flight timetable (EN + ZH)
- [AviationStack](https://aviationstack.com/) — Flight data cross-verification
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
