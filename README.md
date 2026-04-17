# Mini Macau 🚈

> **[mini-map-macau.app](https://mini-map-macau.app/)**

Real-time 3D visualization of Macau's public transit system, inspired by [Mini Tokyo 3D](https://minitokyo3d.com) and [Mini Taiwan](https://minitaiwan.net).

Visualizes the **Macau Light Rapid Transit (LRT)** and **bus network** on an interactive 3D map with simulated vehicle movements along actual routes, synchronized to real-world timetables.

## Features

- **3D LRT vehicles** — All 3 lines (Taipa, Seac Pai Van, Hengqin) rendered as 3D models with real track geometry from OpenStreetMap
- **3D Bus fleet** — 400+ buses across 27+ routes with road-snapped paths via OSRM, including accurate bridge geometry (Macau-Taipa Bridge)
- **Real-time simulation** — Vehicles move along routes based on timetables and service frequencies
- **ETA & vehicle info** — Click any vehicle or station to see live ETAs, next arrivals, route details, and service status
- **Time controls** — Play, pause, speed up (1x–60x), jump to current time, or pick any date/time with the DateTimePicker
- **Vehicle tracking** — Click a vehicle to follow it with smooth camera animation; freely zoom/pan while tracking
- **Route visibility** — Toggle individual route visibility with auto-mode to show only nearby routes
- **Interactive map** — Click vehicles/stations for details, with smooth flyTo animations
- **3D/2D toggle** — Switch between perspective and top-down views
- **Dark/Light mode** — Two map styles
- **Bilingual UI** — English / 繁體中文
- **Lazy loading** — Code-split for fast initial load

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 8 |
| 3D Map | MapLibre GL JS, custom WebGL layers |
| Geo utilities | Turf.js (along, length, nearest-point-on-line) |
| Styling | Tailwind CSS v4 |
| Data pipeline | Python 3.13+, OpenStreetMap Overpass API, OSRM |
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
3. Snap bus routes to roads via OSRM with custom bridge geometry handling
4. Generate timetables based on published service frequencies
5. Output JSON files to `data/output/`

Then copy the output to `public/data/`.

## Data Sources

- **LRT tracks & stations** — [OpenStreetMap](https://www.openstreetmap.org/) (railway=light_rail relations)
- **Bus routes & stops** — OpenStreetMap + [motransportinfo.com](https://www.motransportinfo.com) curated stop data
- **Road-snapped routes** — [OSRM](http://project-osrm.org/) with custom bridge approach geometry
- **Timetables** — Based on published service frequencies

## Project Structure

```
mini-macau/
├── src/
│   ├── components/     # React UI (MapView, ControlPanel, VehicleInfoPanel, etc.)
│   ├── engines/        # Simulation engine (timetable-driven vehicle movement)
│   ├── hooks/          # React hooks (simulation clock, data loading)
│   ├── layers/         # Custom 3D WebGL layers (LRT3DLayer, Bus3DLayer, VehicleLayer)
│   ├── i18n.tsx        # Internationalization (EN / 繁中)
│   └── types.ts        # TypeScript interfaces
├── public/data/        # Pre-generated transit data (JSON)
├── data/
│   ├── scripts/        # Python data extraction pipeline
│   ├── bus_reference/  # Bus stop reference data
│   └── raw/            # Raw OSM extracts
├── .github/workflows/  # CI/CD (Cloudflare Pages deploy)
└── index.html
```

## Acknowledgements

- [Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d) — Original inspiration
- [MapLibre GL JS](https://maplibre.org/) — Open-source map rendering
- [OpenStreetMap](https://www.openstreetmap.org/) — Transit data
- [CARTO](https://carto.com/) — Basemap tiles
- [OSRM](http://project-osrm.org/) — Road routing engine
- [Turf.js](https://turfjs.org/) — Geospatial analysis

## License

[MIT](./LICENSE)
