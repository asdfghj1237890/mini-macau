# Mini Macau 🚈

Real-time 3D visualization of Macau's public transit system, inspired by [Mini Tokyo 3D](https://minitokyo3d.com) and [Mini Taiwan](https://minitaiwan.net).

Visualizes the **Macau Light Rapid Transit (LRT)** and **bus network** on an interactive map with simulated vehicle movements along actual routes.

## Features

- **LRT visualization** — All 3 lines (Taipa, Seac Pai Van, Hengqin) with real track geometry from OpenStreetMap
- **Bus network** — 27+ major routes with road-snapped paths via OSRM
- **Real-time simulation** — Vehicles move along routes based on timetables and service frequencies
- **Time controls** — Play, pause, speed up (1x–60x), and jump to current time
- **Interactive map** — Click vehicles/stations for details, next arrivals, and route info
- **3D/2D toggle** — Switch between perspective and top-down views
- **Dark/Light mode** — Two map styles
- **Bilingual UI** — English / 繁體中文

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Map | MapLibre GL JS |
| Styling | Tailwind CSS v4 |
| Data pipeline | Python 3.13+, OpenStreetMap Overpass API, OSRM |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) or npm
- [uv](https://docs.astral.sh/uv/) (for data pipeline only)

### Install & Run

```bash
# Install dependencies
npm install

# Start dev server
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
2. Extract bus routes and stops, snap to roads via OSRM
3. Generate synthetic timetables
4. Output JSON files to `data/output/`

Then copy the output to `public/data/`.

## Data Sources

- **LRT tracks & stations** — [OpenStreetMap](https://www.openstreetmap.org/) (railway=light_rail relations)
- **Bus routes & stops** — OpenStreetMap + curated stop data
- **Road-snapped routes** — [OSRM](http://project-osrm.org/) (Open Source Routing Machine)
- **Timetables** — Synthetic, based on published service frequencies

## Project Structure

```
mini-macau/
├── src/
│   ├── components/     # React UI components
│   ├── engines/        # Simulation logic
│   ├── hooks/          # React hooks (clock, data loading)
│   ├── layers/         # MapLibre layer management
│   ├── i18n.tsx        # Internationalization (EN/中文)
│   └── types.ts        # TypeScript interfaces
├── public/data/        # Pre-generated transit data (JSON)
├── data/
│   └── scripts/        # Python data extraction pipeline
└── index.html
```

## Acknowledgements

- [Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d) — Original inspiration
- [MapLibre GL JS](https://maplibre.org/) — Open-source map rendering
- [OpenStreetMap](https://www.openstreetmap.org/) — Transit data
- [CARTO](https://carto.com/) — Basemap tiles

## License

[MIT](./LICENSE)
