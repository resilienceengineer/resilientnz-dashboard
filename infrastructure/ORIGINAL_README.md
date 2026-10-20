# Resilient NZ v3 — Pathways Explorer

Map-first rebuild of the Resilient NZ dashboard: a full-bleed OpenStreetMap basemap with
cinematic camera flights between the national overview and city decision contexts, live
government hazard GIS overlays, and a compact MCDA pathway-ranking panel.

## Run

**No server needed:** just double-click `index.html`. All hazard/strategic data is
embedded in `data_bundle.js` (regenerate with `python build_data_bundle.py` after
refreshing snapshots).

Or serve it if you prefer:

```bash
python -m http.server 8017
```

Then open http://localhost:8017/resilientnz_v3/

Internet access is still required for the basemap, terrain tiles, fonts and the
two live GeoNet feeds (earthquakes, volcano alerts).

## Stack

- **MapLibre GL JS v5** — WebGL map with globe projection, 3D terrain, pitch + bearing animation.
- **OpenFreeMap `positron` style** — free OpenStreetMap vector tiles, no API key.
- **AWS Terrain Tiles (Mapzen terrarium)** — free 3D elevation, no API key.
- **Open hazard GIS services** — streamed as GeoJSON, endpoints configured in `data.js`
  (`HAZARD_LAYERS`). See the main analysis for the verified endpoint list.

## Choreography

- Intro: globe view over the Pacific → 5 s flight to Aotearoa.
- City chips / pulsing map markers → 4.4 s fly-to with 55–60° pitch and a set bearing,
  then a slow cinematic orbit (interrupted by any user input).
- "Back to NZ" → camera returns to the flat national overview.
- Hazard layers fade in over ~1 s when toggled; loaded layers are cached.

## Known rendering note: terrain vs data layers

MapLibre GL **v5** has a terrain render-to-texture cache flaw ([maplibre-gl-js
#7363](https://github.com/maplibre/maplibre-gl-js/issues/7363)) that makes
draped GeoJSON layers flicker while the camera moves — worst at 55–60° pitch.
It is fixed only in **v6.0.0+** ([PR #7549](https://github.com/maplibre/maplibre-gl-js/pull/7549)).

This app therefore treats 3D terrain as a *flight/sightseeing* effect: the view
flattens automatically whenever any hazard or asset layer is shown
(`updateTerrainMode()` in app.js). To have terrain and layers together
flicker-free, migrate to `maplibre-gl@6.3.0` — note v6 is ESM-only, which
breaks the double-click `file://` mode unless the library is vendored as a
locally built classic-script bundle.

## Data status

All pathway scores, costs, BCRs and resilience gains in `data.js` are **illustrative demo
values** — replace `PATHWAYS`, `CITY_MODIFIERS` and `DEFAULT_WEIGHTS` with validated research
data. Hazard layer endpoints marked `url: null` are awaiting a verified service URL.
