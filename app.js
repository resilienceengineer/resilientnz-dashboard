/* ============================================================
   Resilient NZ v3 — map choreography + decision model UI
   ============================================================ */

const state = {
  city: null,                       // null = NZ overview
  asset: null,                      // null = nothing selected → pathways hidden
  weights: { ...DEFAULT_WEIGHTS },
  activeLayers: new Set(),
  orbiting: false
};

function resetAssetSelection() {
  state.asset = null;
  document.querySelectorAll("#assetSeg .seg").forEach(s => s.classList.remove("active"));
}

const $ = (sel) => document.querySelector(sel);

/* ---------------- map ---------------- */

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: INTRO_VIEW.center,
  zoom: INTRO_VIEW.zoom,
  pitch: INTRO_VIEW.pitch,
  bearing: INTRO_VIEW.bearing,
  maxTileCacheSize: 3000,
  preserveDrawingBuffer: true,   // lets the Print briefing capture the map canvas
  // basemap attribution lives in the page footer credits instead
  attributionControl: false
});

map.on("load", () => {
  try { map.setProjection({ type: "globe" }); } catch (e) { /* flat fallback */ }

  // Light sky + fog so the horizon at high pitch isn't the dark page
  // background (fixes edge flicker while orbiting).
  try {
    map.setSky({
      "sky-color": "#cfe0ea",
      "horizon-color": "#eef2f0",
      "fog-color": "#f2f5f3",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "fog-ground-blend": 0.85,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 1, 8, 0]
    });
  } catch (e) { /* older style spec — cosmetic only */ }

  map.addSource("terrain-dem", {
    type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 12,   // >12 has noisy coastal pixels → spiky artifacts when draped
    attribution: "Terrain: Mapzen/AWS"
  });

  hideBasemapCityLabels();
  addCityMarkers();
  createAssetOverlays();
  syncAssetOverlays();

  // 3D buildings from the OSM tiles — appear from z13 as you zoom into a
  // CBD. Not terrain-draped, so no flicker interaction.
  try {
    const firstSymbol = map.getStyle().layers.find(l => l.type === "symbol");
    map.addLayer({
      id: "buildings-3d", type: "fill-extrusion",
      source: "openmaptiles", "source-layer": "building", minzoom: 13,
      paint: {
        "fill-extrusion-color": "#dfe4ea",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.85
      }
    }, firstSymbol?.id);
  } catch (e) { /* cosmetic */ }


  // Cinematic intro: Pacific globe → NZ
  setTimeout(() => {
    map.flyTo({ ...NZ_VIEW, duration: 5200, curve: 1.25, essential: true });
  }, 700);

  // Once the intro settles: warm the city tile caches + prefetch national layers
  map.once("idle", () => {
    prewarmCityTiles();
    prefetchLayers();
  });
});

/* Suppress the basemap's own labels for our four cities — the pulsing
   markers + chips replace them (otherwise the dot sits on the name). */
function hideBasemapCityLabels() {
  const names = [...Object.keys(CITIES), ...HIDDEN_PLACE_NAMES];
  // Expression-form filter — this style's filters are expressions, so the
  // exclusion must be too (legacy "!in" syntax throws and gets ignored).
  const excl = ["!", ["in", ["get", "name"], ["literal", names]]];
  map.getStyle().layers.forEach(l => {
    if (l.type !== "symbol" || l["source-layer"] !== "place") return;
    try {
      const f = map.getFilter(l.id);
      map.setFilter(l.id, f ? ["all", f, excl] : excl);
    } catch (e) { /* leave layer untouched */ }
  });
}

/* ---------------- city markers ---------------- */

const cityMarkers = [];

function addCityMarkers() {
  Object.entries(CITIES).forEach(([name, c]) => {
    const el = document.createElement("button");
    el.className = "city-marker";
    el.innerHTML = `<span class="ring"></span><span class="core"></span><span class="mlabel">${name}</span>`;
    el.addEventListener("click", (e) => { e.stopPropagation(); goToCity(name); });
    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat(c.center)
      .addTo(map);
    cityMarkers.push(marker);
  });
}

function setMarkersVisible(visible) {
  cityMarkers.forEach(m => m.getElement().classList.toggle("hidden", !visible));
}

map.on("zoom", () => {
  const hideLabels = map.getZoom() > 8.5;
  cityMarkers.forEach(m => m.getElement().classList.toggle("nolabel", hideLabels));
});

/* ---------------- tile prewarm (kills the mid-flight download wait) ------- */

function prewarmCityTiles() {
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-2200px;top:0;width:720px;height:520px;pointer-events:none;";
  document.body.appendChild(holder);

  const names = Object.keys(CITIES);
  let i = 0;
  const first = CITIES[names[0]];

  const warm = new maplibregl.Map({
    container: holder,
    style: "https://tiles.openfreemap.org/styles/positron",
    center: first.center,
    zoom: first.zoom,
    pitch: 0,
    interactive: false,
    attributionControl: false
  });

  warm.on("idle", () => {
    i++;
    if (i >= names.length) {
      warm.remove();
      holder.remove();
      return;
    }
    warm.jumpTo({ center: CITIES[names[i]].center, zoom: CITIES[names[i]].zoom });
  });
}

/* ---------------- orbit (slow cinematic rotation in city mode) ---------------- */

let orbitFrame = null;

function startOrbit() {
  stopOrbit();
  state.orbiting = true;
  const tick = () => {
    if (!state.orbiting) return;
    map.setBearing(map.getBearing() + 0.018);
    orbitFrame = requestAnimationFrame(tick);
  };
  orbitFrame = requestAnimationFrame(tick);
}

function stopOrbit() {
  state.orbiting = false;
  if (orbitFrame) cancelAnimationFrame(orbitFrame);
  orbitFrame = null;
}

["mousedown", "wheel", "touchstart"].forEach(ev =>
  map.getCanvas().addEventListener(ev, stopOrbit, { passive: true })
);

/* ---------------- fly choreography ---------------- */

function goToCity(name) {
  if (state.city === name) return;
  state.city = name;
  stopOrbit();
  const c = CITIES[name];

  document.querySelectorAll("#cityChips .chip").forEach(ch =>
    ch.classList.toggle("active", ch.dataset.city === name));

  $("#contextRibbon").hidden = true;

  // Terrain decision happens BEFORE the flight (invisible switch at overview
  // zoom): 3D only when the city will arrive with no data layers on show.
  updateTerrainMode();

  map.flyTo({
    center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing,
    duration: 4400, curve: 1.5, essential: true
  });

  hideContextVisuals();   // visuals return once the zoom-in has finished
  resetAssetSelection();  // each zoom-in starts with no asset selected

  map.once("moveend", () => {
    if (state.city !== name) return;
    startOrbit();
    showContext(name);
    syncHazardLayerVisibility();
    syncAssetOverlays();
    // fresh city → back to present-day sea level, stats for what's visible
    const cfg = slrConfigHere();
    if (cfg && state.activeLayers.has(cfg.layerId)) applySlr(0);
    else { state.slr = 0; updateSlrControl(); }
    updateExposureStats();
  });

  refreshHazardToggles();
  renderResults();
}

function goToNZ() {
  if (state.city === null) return;
  state.city = null;
  stopOrbit();
  hideContextVisuals();   // city visuals vanish immediately on the way out
  resetAssetSelection();
  // terrain switches off at arrival (pitch 0 → visually a no-op, no pop)
  map.once("moveend", () => {
    if (state.city !== null) return;
    try { map.setTerrain(null); } catch (e) {}
    syncHazardLayerVisibility();   // national layers return at the overview
    syncAssetOverlays();
  });

  document.querySelectorAll("#cityChips .chip").forEach(ch =>
    ch.classList.toggle("active", ch.dataset.city === ""));

  $("#contextRibbon").hidden = true;
  setMarkersVisible(true);

  map.flyTo({ ...NZ_VIEW, duration: 3600, curve: 1.35, essential: true });

  refreshHazardToggles();
  renderResults();
}

function showContext(name) {
  const c = CITIES[name];
  state.cbdMode = false;
  setCbdButton();
  $("#contextCity").textContent = name;
  $("#contextBlurb").textContent = c.blurb;
  $("#contextExposure").textContent = `${c.exposure} exposure`;
  const ribbon = $("#contextRibbon");
  ribbon.hidden = false;
  ribbon.style.animation = "none";
  void ribbon.offsetWidth;              // restart entrance animation
  ribbon.style.animation = "";
}

/* ---------------- hazard layers ---------------- */

const loadedLayers = new Map();    // layer.id -> { sourceId, layerIds, cacheKey }
const prefetchCache = new Map();   // layer.id -> geojson

function layerAvailableHere(layer) {
  // national layers (cities: null) only at the NZ overview; local layers only
  // in their own city
  return layer.cities === null
    ? state.city === null
    : (state.city !== null && layer.cities.includes(state.city));
}

/* Every active hazard layer is visible only in its own context: national
   layers at the NZ overview, city layers in their own city. */
function syncHazardLayerVisibility() {
  HAZARD_LAYERS.filter(l => state.activeLayers.has(l.id))
    .forEach(l => setLayerVisible(l, layerAvailableHere(l)));
  updateTerrainMode();
}

/* 3D terrain is a flight/sightseeing effect only: MapLibre's terrain drape
   re-tiles draped GeoJSON every frame while the camera moves, which reads
   as heavy mid-screen flicker. The moment any data layer is on show, the
   view flattens into a stable analysis mode; terrain returns when the map
   is clear again. */
function anyDataOnShow() {
  if (state.city === null) return false;
  if (state.asset !== null) return true;
  return HAZARD_LAYERS.some(l => state.activeLayers.has(l.id) && layerAvailableHere(l));
}

function updateTerrainMode() {
  const wantTerrain = state.city !== null && !anyDataOnShow();
  const hasTerrain = !!map.getTerrain();
  try {
    if (wantTerrain && !hasTerrain) map.setTerrain({ source: "terrain-dem", exaggeration: 1.15 });
    if (!wantTerrain && hasTerrain) map.setTerrain(null);
  } catch (e) { /* cosmetic */ }
}

/* Hide all contextual visuals (asset overlays + hazard layers + legend)
   for the duration of a camera flight — they reappear on arrival. */
function hideContextVisuals() {
  ["asset-residential", "asset-infra-roads", "asset-infra-rail",
   "asset-infra-bridges", "asset-strategic"].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  });
  HAZARD_LAYERS.filter(l => state.activeLayers.has(l.id))
    .forEach(l => setLayerVisible(l, false));
  $("#legendBar").hidden = true;
}

function cacheKeyFor(layer) {
  return layer.bboxQuery ? `${layer.id}:${state.city ?? "nz"}` : layer.id;
}

function buildLayerUrl(layer) {
  if (!layer.bboxQuery) return layer.url;
  // NEVER use map.getBounds() here: at 55-60° pitch it spans most of the
  // country (and can cross the antimeridian). Use the city's metro bbox
  // (or the layer's own tighter bbox, e.g. CBD-only overland flow paths).
  const city = state.city ? CITIES[state.city] : null;
  const geometry = (layer.cbdBbox ?? city?.bbox ?? [166, -47.5, 179, -34]).join(",");
  return `${layer.url}&geometry=${geometry}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`;
}

async function fetchLayerData(layer) {
  // local snapshots first — live feeds always hit the network
  if (!layer.live) {
    const key = cacheKeyFor(layer).replace(":", "__");
    // 1. bundled data (works from file://, no server needed)
    if (typeof LOCAL_DATA !== "undefined" && LOCAL_DATA[key]) return LOCAL_DATA[key];
    // 2. snapshot file over http
    try {
      const local = await fetch(`data/${key}.geojson`);
      if (local.ok) return await local.json();
    } catch (e) { /* fall through to the live service */ }
  }

  const url = buildLayerUrl(layer);

  if (!layer.paginate && !layer.bboxQuery) {
    const res = await fetch(url, { headers: layer.fetchHeaders || {} });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  const features = [];
  for (let page = 0; page < 8; page++) {
    const res = await fetch(`${url}&resultOffset=${page * 2000}`, { headers: layer.fetchHeaders || {} });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gj = await res.json();
    features.push(...(gj.features || []));
    if (!gj.features || gj.features.length < 2000) break;
  }
  return { type: "FeatureCollection", features };
}

async function prefetchLayers() {
  for (const layer of HAZARD_LAYERS) {
    if (!layer.prefetch || prefetchCache.has(layer.id)) continue;
    try {
      prefetchCache.set(layer.id, await fetchLayerData(layer));
    } catch (e) { /* silent — will fetch again on toggle */ }
  }
}

function refreshHazardToggles() {
  const wrap = $("#hazardToggles");
  wrap.innerHTML = "";
  const visible = HAZARD_LAYERS.filter(layerAvailableHere);

  visible.forEach(layer => {
    const btn = document.createElement("button");
    btn.className = "hazard-toggle" + (state.activeLayers.has(layer.id) ? " on" : "");
    btn.style.color = layer.color;
    btn.innerHTML = `
      <span class="swatch" style="background:${layer.color}"></span>
      <span class="htitle" style="color:var(--ink)">${layer.label}</span>
      <span class="state">${state.activeLayers.has(layer.id) ? "ON" : "OFF"}</span>`;
    btn.addEventListener("click", () => toggleLayer(layer, btn));
    wrap.appendChild(btn);
  });

  const note = document.createElement("p");
  note.className = "hazard-note";
  note.textContent = state.city
    ? "Layers from official open GIS services (source shown below the map)."
    : "National layers shown — select a city for local flood, coastal and liquefaction layers.";
  wrap.appendChild(note);

  updateTerrainMode();
  updateLegendBar();
  updateSlrControl();
  updateExposureStats();
}

/* Bottom legend bar: current asset overlay colours + every active hazard
   layer with its colour swatch and data source. */
function updateLegendBar() {
  const el = $("#legendBar");
  if (!el) return;

  const item = (color, label, src, line) =>
    `<span class="legend-item"><span class="legend-swatch${line ? " line" : ""}" ` +
    `style="background:${color}"></span>${label}` +
    (src ? `<span class="legend-src">· ${src}</span>` : "") + `</span>`;

  const row = (title, items) =>
    `<div class="legend-row"><span class="legend-title">${title}</span>` +
    `<span class="legend-items">${items.join("")}</span></div>`;

  const rows = [];

  if (state.city !== null && state.asset) {   // overlays only in city views with an asset chosen
    let items;
    if (state.asset === "Residential") {
      items = [item(theme().residential, "Residential land")];
    } else if (state.asset === "Strategic buildings") {
      items = Object.entries(STRATEGIC_COLORS).map(([k, c]) => item(c, k));
    } else {
      items = [item(theme().roads, "Main roads", null, true),
               item(theme().rail, "Rail", null, true),
               item("#d7263d", "Bridges", null, true)];
    }
    rows.push(row("Assets · OpenStreetMap", items));
  }

  const activeHazards = HAZARD_LAYERS
    .filter(l => state.activeLayers.has(l.id) && layerAvailableHere(l));
  if (activeHazards.length) {
    rows.push(row("Hazards", activeHazards.map(l =>
      item(l.color, l.label, l.attribution, l.geometry === "line"))));
  }

  el.innerHTML = rows.join("");
  el.hidden = rows.length === 0;
}

async function toggleLayer(layer, btn) {
  if (state.activeLayers.has(layer.id)) {
    state.activeLayers.delete(layer.id);
    setLayerVisible(layer, false);
    refreshHazardToggles();
    return;
  }

  const key = cacheKeyFor(layer);
  const entry = loadedLayers.get(layer.id);

  if (entry && entry.cacheKey === key) {
    state.activeLayers.add(layer.id);
    setLayerVisible(layer, true);
    refreshHazardToggles();
    return;
  }

  btn.classList.add("loading");
  btn.querySelector(".state").textContent = "LOADING";

  try {
    const geojson = prefetchCache.get(layer.id) ?? await fetchLayerData(layer);
    prefetchCache.delete(layer.id);
    state.activeLayers.add(layer.id);

    if (entry) {                         // same layer, new bbox → swap data in place
      map.getSource(entry.sourceId).setData(geojson);
      entry.cacheKey = key;
      entry.data = geojson;
      setLayerVisible(layer, true);
    } else {
      addHazardToMap(layer, geojson, key);
    }
    // layers with a limited footprint fly the camera to where their data is
    if (layer.flyTo && map.getZoom() < layer.flyTo.zoom - 1) {
      stopOrbit();
      map.flyTo({ ...layer.flyTo, pitch: map.getPitch(), duration: 2600, essential: true });
    }
  } catch (err) {
    toast(`Could not load ${layer.label} (${err.message})`);
  }
  refreshHazardToggles();
}

/* Insert hazard fills below the basemap water layer: polygons that extend
   over the sea (e.g. tsunami "beach & marine" red zones) then only show on
   land, and water/labels stay legible. */
function waterBeforeId() {
  const layers = map.getStyle().layers;
  const w = layers.find(l => l.id === "water") ||
            layers.find(l => l.type === "fill" && (l["source-layer"] || "") === "water");
  return w ? w.id : undefined;
}

/* Tint a popup with a faded version of its item's colour. */
function fadeColor(hex, strength = 0.16) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(255 - (255 - c) * strength);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

function tintPopup(popup, color) {
  const el = popup.getElement();
  if (!el) return;
  const fade = fadeColor(color);
  const content = el.querySelector(".maplibregl-popup-content");
  if (content) {
    content.style.background = fade;
    content.style.borderLeft = `4px solid ${color}`;
  }
  const tip = el.querySelector(".maplibregl-popup-tip");
  if (tip) {
    tip.style.borderTopColor = fade;
    tip.style.borderBottomColor = fade;
  }
}

function addHazardToMap(layer, geojson, cacheKey) {
  const sourceId = `src-${layer.id}`;
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: "geojson", data: geojson });
  }

  // idempotent: a concurrent toggle may already have added the layers
  if (map.getLayer(`lyr-${layer.id}-fill`) || map.getLayer(`lyr-${layer.id}-line`) ||
      map.getLayer(`lyr-${layer.id}-circle`)) {
    const existing = loadedLayers.get(layer.id);
    if (existing) { existing.cacheKey = cacheKey; existing.data = geojson; }
    map.getSource(sourceId).setData(geojson);
    setLayerVisible(layer, true);
    return;
  }

  const layerIds = [];
  const geom = layer.geometry || "fill";

  if (geom === "fill") {
    const fillId = `lyr-${layer.id}-fill`;
    const before = waterBeforeId();
    map.addLayer({
      id: fillId, type: "fill", source: sourceId,
      ...(layer.filter ? { filter: layer.filter } : {}),
      paint: {
        "fill-color": layer.fillColorExpr ?? layer.color,
        "fill-opacity": 0,
        "fill-opacity-transition": { duration: 900 }
      }
    }, before);
    map.addLayer({
      id: `lyr-${layer.id}-line`, type: "line", source: sourceId,
      ...(layer.filter ? { filter: layer.filter } : {}),
      paint: {
        "line-color": layer.fillColorExpr ?? layer.color,
        "line-width": 1, "line-opacity": 0.7
      }
    }, before);
    layerIds.push(fillId, `lyr-${layer.id}-line`);
    requestAnimationFrame(() =>
      map.setPaintProperty(fillId, "fill-opacity", layer.fillOpacity ?? 0.4));

    if (layer.popupHTML) {
      map.on("click", fillId, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = new maplibregl.Popup({ closeButton: false, maxWidth: "260px" })
          .setLngLat(e.lngLat)
          .setHTML(layer.popupHTML(f.properties))
          .addTo(map);
        tintPopup(p, layer.color);
      });
    }
  }

  if (geom === "line") {
    map.addLayer({
      id: `lyr-${layer.id}-line`, type: "line", source: sourceId,
      paint: {
        "line-color": layer.color,
        "line-width": layer.lineWidth ?? 2,
        "line-opacity": 0,
        "line-opacity-transition": { duration: 900 }
      }
    });
    layerIds.push(`lyr-${layer.id}-line`);
    requestAnimationFrame(() =>
      map.setPaintProperty(`lyr-${layer.id}-line`, "line-opacity", 0.9));
  }

  if (geom === "circle") {
    const circleId = `lyr-${layer.id}-circle`;
    map.addLayer({
      id: circleId, type: "circle", source: sourceId,
      paint: {
        "circle-color": layer.color,
        "circle-radius": layer.radiusExpr ?? [
          "interpolate", ["linear"], ["coalesce", ["get", "magnitude"], 3],
          2, 3, 4, 6, 6, 14, 8, 26
        ],
        "circle-opacity": 0.55,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1,
        "circle-opacity-transition": { duration: 900 }
      }
    });
    layerIds.push(circleId);

    if (layer.popupHTML) {
      map.on("click", circleId, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = new maplibregl.Popup({ closeButton: false, maxWidth: "260px" })
          .setLngLat(e.lngLat)
          .setHTML(layer.popupHTML(f.properties))
          .addTo(map);
        tintPopup(p, layer.color);
      });
      map.on("mouseenter", circleId, () => map.getCanvas().style.cursor = "pointer");
      map.on("mouseleave", circleId, () => map.getCanvas().style.cursor = "");
    }
  }

  loadedLayers.set(layer.id, { sourceId, layerIds, cacheKey, data: geojson });
}

function setLayerVisible(layer, visible) {
  const entry = loadedLayers.get(layer.id);
  if (!entry) return;
  entry.layerIds.forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  });
}

/* ---------------- asset-system map overlays ----------------
   Residential + Infrastructure come straight from the basemap's own OSM
   vector tiles; Strategic buildings load from the local OSM snapshot
   (fetch_strategic_buildings.py). */

const STRATEGIC_COLORS = {
  "Hospital": "#d7263d",
  "Government": "#0a54a0",
  "Council": "#12a5a5",
  "Civil Defence": "#ffb321"
};

function createAssetOverlays() {
  // above the basemap's land fills but below roads and labels — the
  // before-water slot used for hazard fills leaves this overlay occluded
  const firstLine = map.getStyle().layers
    .find(l => l.type === "line" || l.type === "symbol");

  map.addLayer({
    id: "asset-residential", type: "fill",
    source: "openmaptiles", "source-layer": "landuse",
    filter: ["==", ["get", "class"], "residential"],
    layout: { visibility: "none" },
    // opaque light tint: semi-transparent fills shimmer badly while the
    // camera orbits over terrain
    paint: { "fill-color": theme().residential, "fill-opacity": 1 }
  }, firstLine?.id);

  map.addLayer({
    id: "asset-infra-roads", type: "line",
    source: "openmaptiles", "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
    layout: { visibility: "none", "line-cap": "round" },
    paint: {
      "line-color": theme().roads,
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 10, 2.5, 14, 5],
      "line-opacity": 0.9
    }
  });

  map.addLayer({
    id: "asset-infra-rail", type: "line",
    source: "openmaptiles", "source-layer": "transportation",
    filter: ["==", ["get", "class"], "rail"],
    layout: { visibility: "none" },
    paint: { "line-color": theme().rail, "line-width": 1.6, "line-dasharray": [2, 2] }
  });

  map.addLayer({
    id: "asset-infra-bridges", type: "line",
    source: "openmaptiles", "source-layer": "transportation",
    filter: ["all",
      ["==", ["get", "brunnel"], "bridge"],
      ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "rail"]]]],
    layout: { visibility: "none" },
    paint: {
      "line-color": "#d7263d",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 6],
      "line-opacity": 0.95
    }
  });
}

let strategicLoaded = false;

/* Draw a classic teardrop location pin (white inner dot) as ImageData. */
function makePinImage(color) {
  const c = document.createElement("canvas");
  c.width = 96; c.height = 128;                  // 2x for crisp retina icons
  const ctx = c.getContext("2d");
  ctx.scale(2, 2);
  ctx.beginPath();
  ctx.moveTo(24, 58);                            // tip
  ctx.quadraticCurveTo(8, 34, 8, 22);            // left flank
  ctx.arc(24, 22, 16, Math.PI, 0);               // head
  ctx.quadraticCurveTo(40, 34, 24, 58);          // right flank
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(24, 22, 6.5, 0, Math.PI * 2);          // inner dot
  ctx.fillStyle = "#fff";
  ctx.fill();
  return ctx.getImageData(0, 0, 96, 128);
}

function pinId(category) {
  return "pin-" + category.toLowerCase().replace(/\s+/g, "");
}

async function ensureStrategicLayer() {
  if (strategicLoaded) return true;
  try {
    let gj;
    if (typeof LOCAL_DATA !== "undefined" && LOCAL_DATA["strategic-buildings"]) {
      gj = LOCAL_DATA["strategic-buildings"];
    } else {
      const r = await fetch("data/strategic-buildings.geojson");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      gj = await r.json();
    }

    Object.entries(STRATEGIC_COLORS).forEach(([category, color]) => {
      if (!map.hasImage(pinId(category))) {
        map.addImage(pinId(category), makePinImage(color), { pixelRatio: 2 });
      }
    });

    map.addSource("src-strategic", { type: "geojson", data: gj });
    map.addLayer({
      id: "asset-strategic", type: "symbol", source: "src-strategic",
      layout: {
        visibility: "none",
        "icon-image": ["match", ["get", "category"],
          "Hospital", pinId("Hospital"),
          "Council", pinId("Council"),
          "Civil Defence", pinId("Civil Defence"),
          pinId("Government")],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.27, 12, 0.39, 14, 0.52],
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true
      }
    });
    map.on("click", "asset-strategic", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = new maplibregl.Popup({ closeButton: false, maxWidth: "260px" })
        .setLngLat(e.lngLat)
        .setHTML(`<b>${f.properties.name}</b><br>${f.properties.category}`)
        .addTo(map);
      tintPopup(p, STRATEGIC_COLORS[f.properties.category] ?? STRATEGIC_COLORS["Government"]);
    });
    map.on("mouseenter", "asset-strategic", () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", "asset-strategic", () => map.getCanvas().style.cursor = "");
    strategicLoaded = true;
    return true;
  } catch (e) {
    toast("Strategic buildings dataset not available yet");
    return false;
  }
}

async function syncAssetOverlays() {
  const a = state.asset;
  const inCity = state.city !== null;   // overlays only in a zoomed city view
  const vis = (id, on) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  vis("asset-residential", inCity && a === "Residential");
  ["asset-infra-roads", "asset-infra-rail", "asset-infra-bridges"]
    .forEach(id => vis(id, inCity && a === "Infrastructure"));
  if (inCity && a === "Strategic buildings") {
    if (await ensureStrategicLayer()) vis("asset-strategic", true);
  } else {
    vis("asset-strategic", false);
  }
  updateTerrainMode();
  updateLegendBar();
}

/* ---------------- sea-level-rise scenarios ---------------- */

state.slr = 0;

function slrConfigHere() {
  return state.city ? SLR_CONFIG[state.city] : null;
}

function updateSlrControl() {
  const cfg = slrConfigHere();
  const show = !!cfg && state.activeLayers.has(cfg.layerId);
  $("#slrControl").hidden = !show;
}

async function applySlr(value) {
  state.slr = value;
  document.querySelectorAll("#slrChips .slr-chip").forEach(ch =>
    ch.classList.toggle("active", +ch.dataset.slr === value));

  const cfg = slrConfigHere();
  if (!cfg || !state.activeLayers.has(cfg.layerId)) return;
  const entry = loadedLayers.get(cfg.layerId);
  if (!entry) return;
  const layer = HAZARD_LAYERS.find(l => l.id === cfg.layerId);

  // swap the source to the matching council dataset with a dip-fade
  const key = cfg.dataKeys[value];
  const data = (typeof LOCAL_DATA !== "undefined" && LOCAL_DATA[key]) || null;
  if (!data) { toast("SLR dataset missing — rebuild the data bundle"); return; }
  const fillId = `lyr-${cfg.layerId}-fill`;
  if (map.getLayer(fillId)) map.setPaintProperty(fillId, "fill-opacity", 0.08);
  setTimeout(() => {
    map.getSource(entry.sourceId).setData(data);
    entry.data = data;
    if (map.getLayer(fillId)) map.setPaintProperty(fillId, "fill-opacity", layer.fillOpacity ?? 0.4);
    updateExposureStats();
  }, 300);
}

document.querySelectorAll("#slrChips .slr-chip").forEach(chip =>
  chip.addEventListener("click", () => applySlr(+chip.dataset.slr)));

/* ---------------- exposure statistics ----------------
   Client-side point-in-polygon of the strategic buildings against every
   visible hazard fill — "N hospitals inside the flood plain". */

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function geomContains(geom, x, y) {
  const polys = geom.type === "Polygon" ? [geom.coordinates]
    : geom.type === "MultiPolygon" ? geom.coordinates : [];
  for (const rings of polys) {
    if (!rings.length || !ringContains(rings[0], x, y)) continue;
    let inHole = false;
    for (let h = 1; h < rings.length; h++) {
      if (ringContains(rings[h], x, y)) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

function featureBBox(f) {
  if (f._bbox) return f._bbox;
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const scan = (coords) => {
    if (typeof coords[0] === "number") {
      minX = Math.min(minX, coords[0]); maxX = Math.max(maxX, coords[0]);
      minY = Math.min(minY, coords[1]); maxY = Math.max(maxY, coords[1]);
    } else coords.forEach(scan);
  };
  scan(f.geometry.coordinates);
  return f._bbox = [minX, minY, maxX, maxY];
}

function visibleHazardPolygons() {
  const feats = [];
  loadedLayers.forEach((entry, id) => {
    const layer = HAZARD_LAYERS.find(l => l.id === id);
    if (!layer || (layer.geometry || "fill") !== "fill") return;
    if (!state.activeLayers.has(id) || !layerAvailableHere(layer)) return;
    if (entry.data?.features) feats.push(...entry.data.features);
  });
  return feats;
}

function updateExposureStats() {
  const el = $("#exposureStats");
  if (!el) return;
  // Exposure readout parked at Rino's request (2026-08-17) — delete the two
  // lines below to bring it back in the ribbon and the Print briefing.
  el.hidden = true;
  return;
  if (!state.city || typeof LOCAL_DATA === "undefined") { el.hidden = true; return; }

  const buildings = (LOCAL_DATA["strategic-buildings"]?.features ?? [])
    .filter(f => f.properties.city === state.city);
  const polys = visibleHazardPolygons();
  if (!buildings.length || !polys.length) { el.hidden = true; return; }

  const counts = {};
  buildings.forEach(b => {
    const [x, y] = b.geometry.coordinates;
    const hit = polys.some(f => {
      const bb = featureBBox(f);
      return x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && geomContains(f.geometry, x, y);
    });
    if (hit) counts[b.properties.category] = (counts[b.properties.category] || 0) + 1;
  });

  const labels = {
    "Hospital": ["hospital", "hospitals"],
    "Government": ["government building", "government buildings"],
    "Council": ["council building", "council buildings"],
    "Civil Defence": ["civil defence facility", "civil defence facilities"]
  };
  const parts = Object.entries(counts).map(([k, n]) =>
    `<b>${n}</b> ${labels[k]?.[n > 1 ? 1 : 0] ?? k.toLowerCase()}`);
  if (!parts.length) {
    el.innerHTML = `No strategic buildings inside the displayed hazard extents.`;
  } else {
    el.innerHTML = `⚠ Inside displayed hazard extents: ${parts.join(" · ")}`;
  }
  el.hidden = false;
}

/* ---------------- decision model ---------------- */

function normalisedWeights() {
  const total = Object.values(state.weights).reduce((a, b) => a + b, 0);
  const out = {};
  Object.entries(state.weights).forEach(([k, v]) => out[k] = v / total);
  return out;
}

function computeResults() {
  const w = normalisedWeights();
  const mods = state.city ? CITY_MODIFIERS[state.city] : null;

  return PATHWAYS[state.asset].map(p => {
    const s = { ...p.scores };
    if (mods) {
      const theme = PATHWAY_THEME[p.name];
      const delta = mods[theme] ?? 0;
      s.technical = Math.min(100, Math.max(0, s.technical + delta));
      s.economic = Math.min(100, Math.max(0, s.economic + Math.round(delta / 2)));
    }
    const score =
      s.economic * w.economic + s.technical * w.technical +
      s.environmental * w.environmental + s.social * w.social;
    return { ...p, adj: s, score: +score.toFixed(1) };
  }).sort((a, b) => b.score - a.score);
}

/* Persistent cards that morph in place: the card DOM is built once, then
   every update (city, asset, sliders) swaps text instantly while bars slide
   and scores tween FROM THEIR CURRENT VALUE. Nothing ever resets to zero,
   so rapid clicking stays calm. */

/* Cards are keyed to their pathway. Static content is written once; updates
   only tween scores/bars in place, and rank changes SLIDE the actual cards
   past each other (FLIP) — no text teleporting between different-height
   cards, no vertical jumping. */
function buildCards(results) {
  const wrap = $("#pathwayCards");
  const isRebuild = wrap.children.length > 0;   // asset switch → calm, no entrance
  wrap.innerHTML = results.map(p => `
    <article class="card" data-name="${p.name}">
      <div class="card-rank-row">
        <span class="rank-badge"></span>
        <h4>${p.name}</h4>
        <span class="card-score">0</span>
      </div>
      <div class="score-track"><div class="score-fill"></div></div>
      <p class="card-desc">${p.description}</p>
      <div class="meta">
        <span>COST <b>$${p.cost.toFixed(1)}m</b></span>
        <span>BCR <b>${p.bcr.toFixed(1)}</b></span>
        <span>GAIN <b>+${p.gain}%</b></span>
      </div>
      <div class="tradeoff">${p.tradeoff}</div>
      <div class="radar"></div>
    </article>`).join("");

  wrap.querySelectorAll(".card").forEach(card => {
    if (isRebuild) card.style.animation = "none";
    else card.addEventListener("animationend", () => { card.style.animation = "none"; }, { once: true });
    card.addEventListener("click", () => card.classList.toggle("expanded"));
  });
}

function renderResults() {
  const panel = $("#resultsPanel");
  if (!state.asset) {               // nothing selected → no pathway panel
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const results = computeResults();
  $("#resultsContext").textContent = `${state.city ?? "Aotearoa NZ"} · ${state.asset}`;

  const wrap = $("#pathwayCards");
  const names = new Set([...wrap.children].map(el => el.dataset.name));
  const sameSet = wrap.children.length === results.length && results.every(p => names.has(p.name));
  if (!sameSet) buildCards(results);

  const byName = new Map([...wrap.children].map(el => [el.dataset.name, el]));
  const before = new Map([...byName].map(([k, el]) => [k, el.getBoundingClientRect().top]));
  const orderChanged = results.some((p, i) => wrap.children[i]?.dataset.name !== p.name);

  if (orderChanged) {
    results.forEach(p => wrap.appendChild(byName.get(p.name)));
    if (sameSet) {
      // FLIP: put cards visually back where they were, then release
      results.forEach(p => {
        const el = byName.get(p.name);
        const d = before.get(p.name) - el.getBoundingClientRect().top;
        if (d) { el.style.transition = "none"; el.style.transform = `translateY(${d}px)`; }
      });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        results.forEach(p => {
          const el = byName.get(p.name);
          el.style.transition = "";
          el.style.transform = "";
        });
      }));
    }
  }

  results.forEach((p, i) => {
    const el = byName.get(p.name);
    el.classList.toggle("top", i === 0);
    el.querySelector(".rank-badge").textContent = i + 1;
    el.querySelector(".radar").innerHTML = radarSVG(p.adj ?? p.scores);
    el.querySelector(".score-fill").style.width = `${p.score}%`;
    tweenScore(el.querySelector(".card-score"), p.score);
  });
}

/* Four-axis radar (economic / technical / environmental / socio-cultural). */
function radarSVG(s) {
  const cx = 82, cy = 60, r = 42;   // wide margins so edge labels never crop
  const axes = [
    { k: "economic", label: "Econ", ang: -Math.PI / 2 },
    { k: "technical", label: "Tech", ang: 0 },
    { k: "social", label: "Soc", ang: Math.PI / 2 },
    { k: "environmental", label: "Env", ang: Math.PI }
  ];
  const pt = (ang, frac) => [cx + Math.cos(ang) * r * frac, cy + Math.sin(ang) * r * frac];
  const poly = axes.map(a => pt(a.ang, (s[a.k] ?? 0) / 100).map(v => v.toFixed(1)).join(",")).join(" ");
  const grid = [0.33, 0.66, 1].map(f =>
    `<polygon points="${axes.map(a => pt(a.ang, f).map(v => v.toFixed(1)).join(",")).join(" ")}"
      fill="none" stroke="#c9d6e4" stroke-width="1"/>`).join("");
  const spokes = axes.map(a => {
    const [x, y] = pt(a.ang, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#c9d6e4" stroke-width="1"/>`;
  }).join("");
  const labels = axes.map(a => {
    const [x, y] = pt(a.ang, 1.22);
    return `<text x="${x}" y="${y + 3}" text-anchor="middle" font-size="9"
      font-weight="700" fill="#627b98">${a.label} ${Math.round(s[a.k] ?? 0)}</text>`;
  }).join("");
  return `<svg width="164" height="120" viewBox="0 0 164 120" role="img" aria-label="Dimension scores">
    ${grid}${spokes}
    <polygon points="${poly}" fill="${theme().radarFill}" stroke="${theme().radarStroke}" stroke-width="2"/>
    ${labels}</svg>`;
}

function tweenScore(el, target) {
  const from = parseFloat(el.textContent) || 0;
  if (el._tween) cancelAnimationFrame(el._tween);
  if (Math.abs(from - target) < 0.05) { el.textContent = target.toFixed(1); return; }
  const t0 = performance.now(), dur = 450;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = (from + (target - from) * eased).toFixed(1);
    if (k < 1) el._tween = requestAnimationFrame(step);
  };
  el._tween = requestAnimationFrame(step);
}

/* ---------------- UI wiring ---------------- */

document.querySelectorAll("#cityChips .chip").forEach(chip =>
  chip.addEventListener("click", () =>
    chip.dataset.city ? goToCity(chip.dataset.city) : goToNZ()));

$("#backToNZ").addEventListener("click", goToNZ);

/* 3D city view: OSM buildings only exist in tiles from z13, so this dives
   from the metro view to street level (and back) in one click. */
state.cbdMode = false;

function setCbdButton() {
  $("#cbdBtn").textContent = state.cbdMode ? "↩ Metro view" : "⬢ 3D city view";
}

$("#cbdBtn").addEventListener("click", () => {
  if (!state.city) return;
  const c = CITIES[state.city];
  stopOrbit();
  state.cbdMode = !state.cbdMode;
  setCbdButton();
  if (state.cbdMode) {
    map.flyTo({
      center: c.cbd ?? c.center, zoom: 15.6, pitch: 60,
      bearing: (c.bearing ?? 0) - 10, duration: 3200, essential: true
    });
    map.once("moveend", () => { if (state.cbdMode) startOrbit(); });
  } else {
    map.flyTo({
      center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing,
      duration: 3000, essential: true
    });
    map.once("moveend", () => { if (state.city && !state.cbdMode) startOrbit(); });
  }
});

document.querySelectorAll("#assetSeg .seg").forEach(seg =>
  seg.addEventListener("click", () => {
    document.querySelectorAll("#assetSeg .seg").forEach(s => s.classList.remove("active"));
    seg.classList.add("active");
    state.asset = seg.dataset.asset;
    syncAssetOverlays();
    renderResults();
  }));

$("#prioritiesToggle").addEventListener("click", () => {
  const body = $("#prioritiesBody");
  const open = body.hidden;
  body.hidden = !open;
  $("#prioritiesToggle").classList.toggle("open", open);
  $("#prioritiesToggle").setAttribute("aria-expanded", String(open));
});

document.querySelectorAll(".slider-row").forEach(row => {
  const key = row.dataset.w;
  const input = row.querySelector("input");
  const label = row.querySelector("b");
  input.addEventListener("input", () => {
    state.weights[key] = +input.value;
    label.textContent = `${input.value}%`;
    renderResults();
  });
});

/* ---------------- address search (OSM Nominatim) ---------------- */

let searchMarker = null;
let searchTimer = null;

async function searchAddress(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=nz&limit=5&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { "Accept-Language": "en-NZ" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

function cityContaining(lon, lat) {
  return Object.entries(CITIES).find(([, c]) =>
    lon >= c.bbox[0] && lon <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3])?.[0] ?? null;
}

/* Which locally snapshotted hazard extents contain this point? */
function hazardsAtPoint(lon, lat, city) {
  if (typeof LOCAL_DATA === "undefined") return [];
  const hits = [];
  HAZARD_LAYERS.forEach(l => {
    if ((l.geometry || "fill") !== "fill") return;
    if (l.cities && (!city || !l.cities.includes(city))) return;
    const key = (l.bboxQuery ? `${l.id}__${city}` : l.id);
    const d = LOCAL_DATA[key];
    if (!d?.features) return;
    const inside = d.features.some(f => {
      const bb = featureBBox(f);
      return lon >= bb[0] && lon <= bb[2] && lat >= bb[1] && lat <= bb[3] &&
             geomContains(f.geometry, lon, lat);
    });
    if (inside) hits.push(l.label);
  });
  return hits;
}

function selectSearchResult(res) {
  $("#searchResults").hidden = true;
  $("#searchInput").value = res.display_name.split(",").slice(0, 2).join(",");
  const lon = +res.lon, lat = +res.lat;

  const city = cityContaining(lon, lat);
  if (city && state.city !== city) {
    state.city = city;
    document.querySelectorAll("#cityChips .chip").forEach(ch =>
      ch.classList.toggle("active", ch.dataset.city === city));
    refreshHazardToggles();
    showContext(city);
  }

  if (searchMarker) searchMarker.remove();
  const el = document.createElement("div");
  el.className = "city-marker nolabel";
  el.innerHTML = `<span class="ring"></span><span class="core" style="background:#d7263d"></span>`;
  searchMarker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat([lon, lat]).addTo(map);

  stopOrbit();
  map.flyTo({ center: [lon, lat], zoom: 15.5, pitch: 45, bearing: 0, duration: 3200, essential: true });

  const hits = hazardsAtPoint(lon, lat, city);
  map.once("moveend", () => {
    new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
      .setLngLat([lon, lat])
      .setHTML(hits.length
        ? `<b>⚠ Inside mapped hazard extents:</b><br>${hits.join("<br>")}`
        : `<b>✓ Not inside any locally mapped flood or coastal extent.</b><br>` +
          `<span style="font-size:11px">Checked against the bundled council datasets${city ? " for " + city : ""}.</span>`)
      .addTo(map);
  });
}

$("#searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 4) { $("#searchResults").hidden = true; return; }
  searchTimer = setTimeout(async () => {
    try {
      const results = await searchAddress(q);
      const wrap = $("#searchResults");
      wrap.innerHTML = results.map((r, i) =>
        `<button class="search-result" data-i="${i}">${r.display_name}</button>`).join("");
      wrap.hidden = results.length === 0;
      wrap.querySelectorAll(".search-result").forEach(btn =>
        btn.addEventListener("click", () => selectSearchResult(results[+btn.dataset.i])));
    } catch (err) { toast(`Address search unavailable (${err.message})`); }
  }, 450);
});

/* ---------------- printable briefing ---------------- */

function captureMap() {
  return new Promise(res => {
    map.once("render", () => {
      try { res(map.getCanvas().toDataURL("image/jpeg", 0.85)); }
      catch (e) { res(null); }
    });
    map.triggerRepaint();
  });
}

async function buildBriefing() {
  const shot = await captureMap();
  const results = state.asset ? computeResults() : [];
  const active = HAZARD_LAYERS.filter(l => state.activeLayers.has(l.id) && layerAvailableHere(l));
  const w = state.weights;
  const exposure = $("#exposureStats");
  const body = `
    <h1>Resilient Aotearoa NZ — decision briefing</h1>
    <p class="b-sub">Context: <b>${state.city ?? "Aotearoa NZ"}${state.asset ? " · " + state.asset : ""}</b>
      &nbsp;·&nbsp; Sea-level rise scenario: +${state.slr} m
      &nbsp;·&nbsp; Generated ${new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}</p>

    ${shot ? `<h2>Current map view</h2>
      <img src="${shot}" style="width:100%;border:1px solid #bbb;border-radius:4px" alt="Map view">` : ""}

    <h2>Displayed hazard layers</h2>
    ${active.length ? `<table><tr><th>Layer</th><th>Source</th></tr>
      ${active.map(l => `<tr><td>${l.label}</td><td>${l.attribution}</td></tr>`).join("")}</table>`
      : "<p>No hazard layers displayed.</p>"}

    ${exposure && !exposure.hidden ? `<h2>Strategic asset exposure</h2><p>${exposure.textContent}</p>` : ""}

    ${results.length ? `<h2>Ranked resilience pathways (weighted MCDA)</h2>
      <table><tr><th>#</th><th>Pathway</th><th>Score</th><th>Cost</th><th>BCR</th><th>Gain</th></tr>
      ${results.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.score}</td>
        <td>$${p.cost.toFixed(1)}m</td><td>${p.bcr.toFixed(1)}</td><td>+${p.gain}%</td></tr>`).join("")}</table>
      <p>Priority weights — Economic ${w.economic}% · Technical ${w.technical}% ·
         Environmental ${w.environmental}% · Socio-cultural ${w.social}%</p>` : ""}

    <p class="b-note">Demo decision values — pathway scores, costs and benefit-cost ratios are illustrative
    placeholders pending validated research data. Hazard extents are from official open government GIS
    services (Auckland Council, GWRC, CCC, DCC, GNS Science, GeoNet). Basemap © OpenStreetMap contributors.</p>`;

  $("#briefingReport").innerHTML = `
    <div class="b-toolbar">
      <button onclick="window.print()">⎙ Print / Save as PDF</button>
      <button onclick="document.getElementById('briefingReport').classList.remove('open')">× Close</button>
    </div>${body}`;
}

$("#briefBtn").addEventListener("click", async () => {
  await buildBriefing();
  $("#briefingReport").classList.add("open");
});

/* ---------------- auto-tour ---------------- */

let tourActive = false;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const nextMoveEnd = () => new Promise(res => map.once("moveend", res));

/* Auckland showcase: flood plains → coastal inundation with the SLR
   sequence → strategic buildings → 3D city dive with overland flow paths. */
async function startTour() {
  tourActive = true;
  $("#tourBtn").classList.add("running");
  $("#tourBtn").textContent = "■ Stop";

  const mk = () => { const b = document.createElement("button"); b.innerHTML = '<span class="state"></span>'; return b; };
  const L = id => HAZARD_LAYERS.find(l => l.id === id);
  const on = async id => { if (!state.activeLayers.has(id)) await toggleLayer(L(id), mk()); };
  const off = async id => { if (state.activeLayers.has(id)) await toggleLayer(L(id), mk()); };
  const alive = () => tourActive;

  // The tour presses REAL panel controls, glowing each one first so the
  // audience can follow what is being clicked.
  async function tourClick(el, dwell = 1000) {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    el.classList.add("tour-highlight");
    await sleep(dwell);
    el.click();
    await sleep(400);
    el.classList.remove("tour-highlight");
  }
  const hazardBtn = (id) => {
    const label = L(id)?.label;
    return [...document.querySelectorAll("#hazardToggles .hazard-toggle")]
      .find(b => b.querySelector(".htitle")?.textContent === label);
  };
  const onUI = async (id) => {
    if (!state.activeLayers.has(id)) {
      const b = hazardBtn(id);
      if (b) await tourClick(b); else await on(id);
    }
  };
  const offUI = async (id) => {
    if (state.activeLayers.has(id)) {
      const b = hazardBtn(id);
      if (b) await tourClick(b); else await off(id);
    }
  };
  const pickAssetUI = (a) => tourClick(document.querySelector(`#assetSeg .seg[data-asset="${a}"]`));
  const slrChipUI = (v) => tourClick(document.querySelector(`#slrChips .slr-chip[data-slr="${v}"]`));
  let tourPopup = null;

  try {
    // Act 1 — arrive in Tāmaki Makaurau
    if (state.city !== "Auckland") { goToCity("Auckland"); await nextMoveEnd(); }
    if (!alive()) return;

    // Act 2 — the 1% AEP flood plains first, on their own…
    await onUI("flood-plains");
    await sleep(4000);
    if (!alive()) return;

    // …then the residential land they threaten (one reveal at a time)
    await pickAssetUI("Residential");
    await sleep(4000);
    if (!alive()) return;

    // Act 3 — coastal inundation, then the sea rises.
    // Close-up on the North Shore (Shoal Bay / Barry's Point / Esmonde flats):
    // low-lying shoreline where each scenario's growth is clearly legible.
    await offUI("flood-plains");            // clear the stage for the SLR story
    await onUI("coastal-inundation");
    await sleep(1200);
    if (!alive()) return;
    stopOrbit();
    map.flyTo({ center: [174.772, -36.803], zoom: 13.4, pitch: 45, bearing: 0,
                duration: 3000, essential: true });
    await nextMoveEnd();
    if (!alive()) return;
    for (const v of [0.5, 1, 2]) {
      await sleep(2100);
      if (!alive()) return;
      await slrChipUI(v);
    }
    await sleep(2800);
    if (!alive()) return;
    await slrChipUI(0);
    const cA = CITIES["Auckland"];
    map.flyTo({ center: cA.center, zoom: cA.zoom, pitch: cA.pitch, bearing: cA.bearing,
                duration: 2800, essential: true });
    await nextMoveEnd();
    if (!alive()) return;
    await offUI("coastal-inundation");
    if (!alive()) return;

    // Act 4 — infrastructure: main roads, rail and bridges
    await pickAssetUI("Infrastructure");
    await sleep(4000);
    if (!alive()) return;

    // Act 5 — strategic buildings, then visit a hospital up close
    await pickAssetUI("Strategic buildings");
    await sleep(3500);
    if (!alive()) return;

    const hospital = (typeof LOCAL_DATA !== "undefined" &&
      LOCAL_DATA["strategic-buildings"]?.features
        .find(f => f.properties.city === "Auckland" &&
                   f.properties.category === "Hospital" &&
                   /city hospital/i.test(f.properties.name)))
      || LOCAL_DATA?.["strategic-buildings"]?.features
        .find(f => f.properties.city === "Auckland" && f.properties.category === "Hospital");

    if (hospital && alive()) {
      stopOrbit();
      map.flyTo({ center: hospital.geometry.coordinates, zoom: 16, pitch: 55,
                  bearing: -20, duration: 3500, essential: true });
      await nextMoveEnd();
      if (!alive()) return;
      tourPopup = new maplibregl.Popup({ closeButton: false, maxWidth: "260px" })
        .setLngLat(hospital.geometry.coordinates)
        .setHTML(`<b>${hospital.properties.name}</b><br>${hospital.properties.category} · strategic asset`)
        .addTo(map);
      tintPopup(tourPopup, STRATEGIC_COLORS["Hospital"]);
      await sleep(4500);
      tourPopup.remove(); tourPopup = null;
      if (!alive()) return;
      const c = CITIES["Auckland"];
      map.flyTo({ center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing,
                  duration: 3000, essential: true });
      await nextMoveEnd();
      if (!alive()) return;
    }

    // Act 6 — the decision model: radar chart, then shifting priorities
    // (with the Decision Priorities panel scrolled into view so the
    // audience sees the weights move as the ranking reshuffles)
    $("#prioritiesBlock").scrollIntoView({ behavior: "smooth", block: "end" });
    const topCard = document.querySelector(".card");
    if (topCard && !topCard.classList.contains("expanded")) await tourClick(topCard, 800);
    await sleep(3000);
    if (!alive()) return;
    for (const preset of ["Community", "Investor"]) {
      await tourClick(document.querySelector(`.preset-chip[data-p="${preset}"]`));
      await sleep(2800);
      if (!alive()) return;
    }
    await tourClick(document.querySelector(`.preset-chip[data-p="Balanced"]`));
    await sleep(1200);
    if (topCard) topCard.classList.remove("expanded");
    $("#controlPanel").scrollTo({ top: 0, behavior: "smooth" });
    if (!alive()) return;

    // Act 7 — ask the AI assistant
    await tourClick($("#chatFab"));
    await sleep(900);
    if (!alive()) return;
    chatAsk("What is the top pathway here?");
    await sleep(5500);
    if (!alive()) return;
    $("#chatClose").click();
    await sleep(600);

    // Act 8 — the printable briefing
    await tourClick($("#briefBtn"));
    await sleep(6000);
    if (!alive()) return;
    $("#briefingReport").classList.remove("open");
    await sleep(500);

    // Finale — clean up and pull back to Aotearoa
    resetAssetSelection();
    syncAssetOverlays();
    renderResults();
    goToNZ();
  } finally {
    if (tourPopup) tourPopup.remove();
    $("#chatPanel").hidden = true;
    $("#briefingReport").classList.remove("open");
    stopTour();
  }
}

function stopTour() {
  tourActive = false;
  $("#tourBtn").classList.remove("running");
  $("#tourBtn").textContent = "▶ Tour";
}

$("#tourBtn").addEventListener("click", () => tourActive ? stopTour() : startTour());
["mousedown", "wheel", "touchstart"].forEach(ev =>
  map.getCanvas().addEventListener(ev, () => { if (tourActive) stopTour(); }, { passive: true }));

/* ---------------- weight presets ---------------- */

$("#presetChips").innerHTML = Object.keys(WEIGHT_PRESETS).map(k =>
  `<button class="preset-chip" data-p="${k}">${k}</button>`).join("");

document.querySelectorAll(".preset-chip").forEach(chip =>
  chip.addEventListener("click", () => {
    document.querySelectorAll(".preset-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    const preset = WEIGHT_PRESETS[chip.dataset.p];
    Object.entries(preset).forEach(([k, v]) => {
      state.weights[k] = v;
      const row = document.querySelector(`.slider-row[data-w="${k}"]`);
      row.querySelector("input").value = v;
      row.querySelector("b").textContent = `${v}%`;
    });
    renderResults();
  }));

/* ---------------- live earthquake pulse ---------------- */

(function quakePulse() {
  const tick = (t) => {
    const id = "lyr-recent-quakes-circle";
    if (map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none") {
      const k = 0.5 + 0.5 * Math.sin(t / 400);
      try {
        map.setPaintProperty(id, "circle-stroke-width", 1 + 4 * k);
        map.setPaintProperty(id, "circle-stroke-opacity", 0.9 - 0.6 * k);
      } catch (e) { /* mid-style-change */ }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();

/* ---------------- AI assistant (scripted demo) ----------------
   Visual mockup only: answers are generated locally from the app's
   current state — no model behind it yet. */

const chatEls = {
  fab: $("#chatFab"), panel: $("#chatPanel"), msgs: $("#chatMessages"),
  chips: $("#chatChips"), form: $("#chatForm"), input: $("#chatInput")
};

const CHAT_SUGGESTIONS = [
  "What is the top pathway here?",
  "Which hazards are shown?",
  "How is the ranking calculated?",
  "Compare the cities"
];

let chatStarted = false;

function chatContextLabel() {
  return `${state.city ?? "Aotearoa NZ"}${state.asset ? " · " + state.asset : ""}`;
}

function scoreTopFor(city, asset) {
  const w = normalisedWeights();
  const mods = city ? CITY_MODIFIERS[city] : null;
  return PATHWAYS[asset].map(p => {
    const s = { ...p.scores };
    if (mods) {
      const delta = mods[PATHWAY_THEME[p.name]] ?? 0;
      s.technical = Math.min(100, Math.max(0, s.technical + delta));
      s.economic = Math.min(100, Math.max(0, s.economic + Math.round(delta / 2)));
    }
    const score = s.economic * w.economic + s.technical * w.technical +
                  s.environmental * w.environmental + s.social * w.social;
    return { name: p.name, score: +score.toFixed(1) };
  }).sort((a, b) => b.score - a.score)[0];
}

function chatAnswer(q) {
  const asset = state.asset ?? "Residential";
  const lower = q.toLowerCase();

  if (lower.includes("top") || lower.includes("best") || lower.includes("pathway")) {
    const top = scoreTopFor(state.city, asset);
    return `For ${chatContextLabel() || "the current context"}, the highest-ranked pathway is ` +
      `“${top.name}” with a decision score of ${top.score}/100 under your current priority ` +
      `weights.\n\n(Demo values — the full version will use the validated research model.)`;
  }

  if (lower.includes("hazard") || lower.includes("layer") || lower.includes("flood") ||
      lower.includes("earthquake") || lower.includes("coastal")) {
    const active = HAZARD_LAYERS.filter(l => state.activeLayers.has(l.id) && layerAvailableHere(l));
    const avail = HAZARD_LAYERS.filter(layerAvailableHere);
    if (active.length) {
      return `Currently displayed for ${state.city ?? "Aotearoa NZ"}:\n` +
        active.map(l => `• ${l.label} — ${l.attribution}`).join("\n");
    }
    return `No hazard layers are switched on right now. Available for ` +
      `${state.city ?? "the national view"}:\n` +
      avail.map(l => `• ${l.label} — ${l.attribution}`).join("\n");
  }

  if (lower.includes("rank") || lower.includes("calculat") || lower.includes("score") ||
      lower.includes("how") || lower.includes("mcda")) {
    const w = state.weights;
    return `Pathways are ranked with a weighted multi-criteria (MCDA) score across four ` +
      `dimensions using your Step 04 priorities:\n` +
      `• Economic ${w.economic}%\n• Technical ${w.technical}%\n` +
      `• Environmental ${w.environmental}%\n• Socio-cultural ${w.social}%\n\n` +
      `Each pathway scores 0–100 per dimension (demo values for now), adjusted for the ` +
      `selected city's hazard profile.`;
  }

  if (lower.includes("compare") || lower.includes("cities")) {
    return `Top ${asset.toLowerCase()} pathway by city (current weights):\n` +
      Object.keys(CITIES).map(c => {
        const t = scoreTopFor(c, asset);
        return `• ${c}: ${t.name} (${t.score})`;
      }).join("\n");
  }

  return `I'm a visual demo for now — in the full version I'll be connected to the ` +
    `ResilientNZ decision model and data services. Try one of the suggestions below!`;
}

function chatAddMessage(text, who) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  chatEls.msgs.appendChild(div);
  chatEls.msgs.scrollTop = chatEls.msgs.scrollHeight;
  return div;
}

function chatAsk(q) {
  chatAddMessage(q, "user");
  const typing = chatAddMessage("typing…", "bot");
  typing.classList.add("typing");
  setTimeout(() => {
    typing.classList.remove("typing");
    const answer = chatAnswer(q);
    // type-out effect: reveal a few characters per frame
    let i = 0;
    const step = () => {
      i = Math.min(answer.length, i + 3);
      typing.textContent = answer.slice(0, i);
      chatEls.msgs.scrollTop = chatEls.msgs.scrollHeight;
      if (i < answer.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, 650);
}

function chatOpen() {
  chatEls.panel.hidden = false;
  if (!chatStarted) {
    chatStarted = true;
    setTimeout(() => chatAddMessage(
      `Kia ora! I'm the Resilient Aotearoa NZ assistant. How can I assist you today?\n` +
      `I can explain the pathways, hazard layers and rankings you see on the map.`, "bot"), 250);
    chatEls.chips.innerHTML = CHAT_SUGGESTIONS.map(s =>
      `<button type="button" class="chat-chip">${s}</button>`).join("");
    chatEls.chips.querySelectorAll(".chat-chip").forEach(chip =>
      chip.addEventListener("click", () => chatAsk(chip.textContent)));
  }
  chatEls.input.focus();
}

chatEls.fab.addEventListener("click", () =>
  chatEls.panel.hidden ? chatOpen() : (chatEls.panel.hidden = true));
$("#chatClose").addEventListener("click", () => chatEls.panel.hidden = true);

chatEls.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = chatEls.input.value.trim();
  if (!q) return;
  chatEls.input.value = "";
  chatAsk(q);
});

/* ---------------- brand theme (Ctrl+Alt+B) ----------------
   Massey (navy/blue/gold) vs BRANZ (red/black/white, per the BRANZ logo).
   CSS variables switch via body.theme-branz; the values below cover the
   colours that live outside CSS: map paint layers, legend swatches and
   the radar SVG. */

const THEMES = {
  massey: {
    residential: "#f5d98f", roads: "#ffb321", rail: "#06254c",
    radarStroke: "#0a54a0", radarFill: "rgba(10,84,160,.22)",
    label: "Massey palette (navy · blue · gold)"
  },
  branz: {
    residential: "#f6d9d5", roads: "#e2342b", rail: "#1d1d1b",
    radarStroke: "#e2342b", radarFill: "rgba(226,52,43,.18)",
    label: "BRANZ palette (red · black · white)"
  }
};

let themeName = "massey";
try { themeName = localStorage.getItem("ranz-theme") || "massey"; } catch {}
if (!THEMES[themeName]) themeName = "massey";

function theme() { return THEMES[themeName]; }

function applyTheme(name, opts = {}) {
  themeName = THEMES[name] ? name : "massey";
  try { localStorage.setItem("ranz-theme", themeName); } catch {}
  document.body.classList.toggle("theme-branz", themeName === "branz");

  const t = theme();
  if (typeof map !== "undefined" && map.getLayer) {
    if (map.getLayer("asset-residential"))
      map.setPaintProperty("asset-residential", "fill-color", t.residential);
    if (map.getLayer("asset-infra-roads"))
      map.setPaintProperty("asset-infra-roads", "line-color", t.roads);
    if (map.getLayer("asset-infra-rail"))
      map.setPaintProperty("asset-infra-rail", "line-color", t.rail);
  }

  renderResults();      // radar stroke/fill
  updateLegendBar();    // swatches

  if (opts.announce) toast(t.label + " — Ctrl+Alt+B to switch");
}

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === "KeyB") {
    e.preventDefault();
    applyTheme(themeName === "branz" ? "massey" : "branz", { announce: true });
  }
});

/* ---------------- toast ---------------- */

let toastTimer = null;

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
}

/* ---------------- boot ---------------- */

refreshHazardToggles();
applyTheme(themeName);   // restores the saved brand theme and renders results
