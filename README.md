# Mini Map Macau 🚈🚌✈️

> **[mini-map-macau.app](https://mini-map-macau.app/)**

Real-time 3D visualization of Macau's public transit and aviation system, inspired by [Mini Tokyo 3D](https://minitokyo3d.com) and [Mini Taiwan](https://minitaiwan.net).

Visualizes the **Macau Light Rapid Transit (LRT)**, **bus network**, and **MFM airport flights** on an interactive 3D map with simulated vehicle movements along actual routes, synchronized to real-world timetables.

![og-image](https://mini-map-macau.app/og-image.png)

## Features

- **3D LRT vehicles** — All 3 lines (Taipa, Seac Pai Van, Hengqin) with 15 stations, rendered as 3D models with real track geometry and elevated viaducts
- **3D Bus fleet** — 92 routes with road-snapped paths via OSRM, including accurate bridge geometry (Macau–Taipa bridges)
- **3D Aircraft** — 101 real MFM airport flights (53 departures + 48 arrivals) with detailed airplane models (fuselage, swept wings, vertical tail in airline colors, engine nacelles, window rows, cockpit windshield); aircraft park at 12 apron stands before departure and taxi along waypoint paths before takeoff
- **Real-time simulation** — Vehicles move along routes based on timetables, service frequencies, and schedule types (Mon–Thu / Friday / Sat–Sun)
- **ETA & vehicle info** — Click any vehicle or station to see live ETAs, next arrivals, route details, and service status
- **Flight info** — Click any aircraft to see flight number, airline, destination/origin, scheduled time, and aircraft type
- **Time controls** — Play, pause, speed up (1×–60×), jump to current time, or pick any date/time with the DateTimePicker
- **Vehicle tracking** — Click a vehicle to follow it with smooth camera animation; freely zoom/pan while tracking
- **Route visibility** — Toggle individual bus routes by group (Peninsula, Cross-Harbour, Taipa/Cotai, Night, Special); auto-mode shows only routes currently in service
- **3D/2D toggle** — Switch between perspective and top-down views
- **Dark/Light mode** — Two map styles (CARTO Dark Matter / Positron)
- **Trilingual UI** — English / 繁體中文 / Português
- **Cyberpunk-styled menu** — Hamburger menu with Orbitron-font title and gradient branding
- **Responsive mobile UI** — Hamburger menu for map controls, compact legend buttons (LRT/Bus), optimized touch layout with safe-area support
- **Lazy loading** — Code-split panels (RouteSelector, VehicleInfoPanel, StationInfoPanel, FlightInfoPanel) for fast initial load
- **Automated flight data** — GitHub Actions workflow fetches daily MFM flight schedules from AviationStack API

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 6, Vite 8 |
| 3D Map | MapLibre GL JS, custom WebGL fill-extrusion layers |
| Geo utilities | Turf.js (along, length, nearest-point-on-line) |
| Styling | Tailwind CSS v4 |
| Fonts | Orbitron, JetBrains Mono, Noto Sans HK (Google Fonts) |
| Data pipeline | Python 3.13+, uv, OpenStreetMap Overpass API, OSRM |
| Flight data | AviationStack API (daily automated fetch) |
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

Transit data is pre-generated and included in `public/data/`. To regenerate:

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

### Flight Data

Flight schedules are fetched from the [AviationStack API](https://aviationstack.com/) and stored as a static JSON file:

```bash
cd data

# Requires AVIATIONSTACK_API_KEY environment variable
AVIATIONSTACK_API_KEY=your_key uv run python scripts/fetch_flights.py
```

This is also automated via GitHub Actions (`.github/workflows/update-flights.yml`), which runs daily at 06:00 Macau time (UTC+8) and commits updated flight data if changed.

## Data Sources

- **LRT tracks & stations** — [OpenStreetMap](https://www.openstreetmap.org/) (railway=light_rail relations)
- **Bus routes & stops** — OpenStreetMap + [motransportinfo.com](https://www.motransportinfo.com) curated stop data
- **Road-snapped routes** — [OSRM](http://project-osrm.org/) with custom bridge approach geometry
- **Timetables** — Based on published service frequencies
- **Flight schedules** — [AviationStack API](https://aviationstack.com/) (MFM departures & arrivals)

## Project Structure

```
mini-macau/
├── src/
│   ├── components/
│   │   ├── MapView.tsx           # Main map + hamburger menu
│   │   ├── ControlPanel.tsx      # Playback speed controls
│   │   ├── TimeDisplay.tsx       # Clock + DateTimePicker trigger
│   │   ├── DateTimePicker.tsx    # Date/time selection overlay
│   │   ├── LineLegend.tsx        # LRT/Bus/Flight legend (desktop + mobile)
│   │   ├── RouteSelector.tsx     # Bus route group toggles
│   │   ├── VehicleInfoPanel.tsx  # Vehicle detail + ETA
│   │   ├── StationInfoPanel.tsx  # Station detail + next arrivals
│   │   └── FlightInfoPanel.tsx   # Flight detail panel
│   ├── engines/
│   │   └── simulationEngine.ts   # Timetable-driven vehicle + flight position computation
│   ├── hooks/
│   │   ├── useSimulationClock.ts # RAF-based clock with speed/pause
│   │   └── useTransitData.ts     # JSON data loader
│   ├── layers/
│   │   ├── Bus3DLayer.ts         # 3D bus model (fill-extrusion)
│   │   ├── LRT3DLayer.ts         # 3D LRT model (fill-extrusion)
│   │   ├── Flight3DLayer.ts      # 3D airplane model (fill-extrusion)
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
│   │   └── flights.json          # MFM flight schedules
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
│   │   ├── fetch_flights.py      # AviationStack flight data fetcher
│   │   ├── osrm_route.py
│   │   ├── patch_bus_bridges.py
│   │   └── generate_timetable.py
│   ├── bus_reference/
│   ├── output/
│   └── main.py
├── .github/workflows/
│   ├── deploy.yml                # Cloudflare Pages CI/CD
│   └── update-flights.yml        # Daily flight data update
└── index.html
```

## Acknowledgements

- [Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d) — Original inspiration
- [Mini Taiwan](https://minitaiwan.net) — Sister project inspiration
- [MapLibre GL JS](https://maplibre.org/) — Open-source map rendering
- [OpenStreetMap](https://www.openstreetmap.org/) — Transit data
- [CARTO](https://carto.com/) — Basemap tiles (Dark Matter / Positron)
- [OSRM](http://project-osrm.org/) — Road routing engine
- [Turf.js](https://turfjs.org/) — Geospatial analysis
- [OpenFreeMap](https://openfreemap.org/) — 3D building tiles
- [AviationStack](https://aviationstack.com/) — Flight schedule data
- [Google Fonts](https://fonts.google.com/specimen/Orbitron) — Orbitron, JetBrains Mono, Noto Sans HK

## License

[MIT](./LICENSE)
