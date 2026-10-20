/* ============================================================
   Resilient NZ v3 — map choreography + decision model UI
   ============================================================ */

const state = {
  city: null,                       // null = NZ overview
  asset: "Roads and highways",                      // null = nothing selected → pathways hidden
  weights: { ...DEFAULT_WEIGHTS },
  activeLayers: new Set(),
  orbiting: false
};

function resetAssetSelection() { /* Keep the chosen network when navigating. */ }

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
  setMarkersVisible(!state.city);
  createAssetOverlays();
  syncAssetOverlays();

  // Cinematic intro: Pacific globe → NZ
  setTimeout(() => {
    if (state.city !== null) return;
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
  setMarkersVisible(false);
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
  resetAssetSelection();  // retain the selected infrastructure sector

  map.once("moveend", () => {
    if (state.city !== name) return;
    if (!state.asset) startOrbit();
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
  ["asset-infra-roads", "asset-infra-bridges", "network-lines", "network-dashed", "network-points", "network-detail-points", "network-areas", "network-labels"].forEach(id => {
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
      const local = await fetch(`../data/${key}.geojson`);
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

  if (state.asset) {
    const info = SECTOR_INFO[state.asset];
    const items = [];
    const inventory = currentNetwork();
    if (inventory.mode === "imported") items.push(item(info.color, "Imported network", escapeHTML(inventory.name), true));
    else if (inventory.mode === "osm") items.push(item(theme().roads, "Main roads / highways", "OpenStreetMap", true), item("#a56f61", "Road bridges", null, true));
    else if (inventory.mode === "published") {
      const source = '<a href="' + inventory.sourceURL + '" target="_blank" rel="noopener">' + inventory.sourceLabel + '</a>';
      if (state.asset === "Water and wastewater") items.push(item("#587f8d", "Water mains", source + " · CC BY 4.0", true), item("#7e8575", "Wastewater mains", null, true), item("#66877f", "Facilities"));
      if (state.asset === "Power infrastructure") items.push(item("#86778c", "Transmission lines", source, true), item("#86778c", "Substations"));
    }
    if (items.length) rows.push(row("Infrastructure", items));
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

/* ---------------- infrastructure network overlays ---------------- */
const networkInventories = new Map();
let networkMapReady = false;
let networkAssetPopup = null;
let lastNetworkContext = "";
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function currentNetwork() {
  const imported = networkInventories.get(state.asset);
  const empty = { type: "FeatureCollection", features: [] };
  if (imported) return { ...imported, mode: "imported", illustrative: false, sourceLabel: "Imported network" };
  if (state.asset === "Roads and highways") return { name: "OpenStreetMap roads and bridges", mode: "osm", data: empty,
    sourceLabel: "OpenStreetMap", sourceURL: "https://www.openstreetmap.org/copyright", illustrative: false };
  const water = state.asset === "Water and wastewater";
  const sourceLabel = water ? "Watercare" : "Transpower";
  const sourceURL = water ? "https://www.watercare.co.nz/builders-and-developers/tools-fees-and-resources/gis-maps"
    : "https://www.transpower.co.nz/our-work/industry/our-grid/maps-and-gis-data";
  const data = state.city === "Auckland" && typeof NETWORK_DATA !== "undefined" ? NETWORK_DATA.Auckland[state.asset] : null;
  return { name: `${sourceLabel} · Auckland network sample`, mode: data ? "published" : "unavailable",
    data: data || empty, sourceLabel, sourceURL, illustrative: false };
}
function networkColor(fallback) {
  return ["match", ["get", "asset_type"],
    ["water main", "water pump station", "water treatment plant"], "#587f8d",
    ["wastewater main", "wastewater pump station", "wastewater treatment plant"], "#7e8575",
    "reservoir", "#66877f",
    ["transmission line", "transmission cable", "substation"], "#86778c", fallback];
}
function createAssetOverlays() {
  map.addLayer({
    id: "asset-infra-roads", type: "line", source: "openmaptiles", "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
    layout: { visibility: "none", "line-cap": "round" },
    paint: { "line-color": theme().roads,
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 10, 2.5, 14, 5], "line-opacity": 0.85 }
  });
  map.addLayer({
    id: "asset-infra-bridges", type: "line", source: "openmaptiles", "source-layer": "transportation",
    filter: ["all", ["==", ["get", "brunnel"], "bridge"],
      ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary"]]]],
    layout: { visibility: "none" },
    paint: { "line-color": "#a56f61", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 14, 5], "line-opacity": 0.85 }
  });
  map.addSource("infrastructure-network", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const dashedKinds = ["transmission cable"];
  const pumpKinds = ["water pump station", "wastewater pump station"];
  const beforeLabels = map.getStyle().layers.find(layer => layer.type === "symbol")?.id;
  for (const config of [
    { id: "network-areas", type: "fill", filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#587f8d", "fill-opacity": 0.10, "fill-outline-color": "#91a6aa" } },
    { id: "network-lines", type: "line", filter: ["all", ["==", ["geometry-type"], "LineString"], ["!", ["in", ["get", "asset_type"], ["literal", dashedKinds]]]],
      paint: { "line-color": "#587f8d", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 11, 1.05, 14, 1.7, 17, 2.4], "line-opacity": 0.72 } },
    { id: "network-dashed", type: "line", filter: ["all", ["==", ["geometry-type"], "LineString"], ["in", ["get", "asset_type"], ["literal", dashedKinds]]],
      paint: { "line-color": "#86778c", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 11, 1.1, 14, 1.8, 17, 2.5], "line-dasharray": [3, 2], "line-opacity": 0.72 } },
    { id: "network-points", type: "circle", filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["in", ["get", "asset_type"], ["literal", pumpKinds]]]],
      paint: { "circle-color": "#587f8d", "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 12, 2.4, 16, 3.6], "circle-opacity": 0.85, "circle-stroke-color": "#ffffff", "circle-stroke-width": 0.8 } },
    { id: "network-detail-points", type: "circle", minzoom: 13, filter: ["all", ["==", ["geometry-type"], "Point"], ["in", ["get", "asset_type"], ["literal", pumpKinds]]],
      paint: { "circle-color": "#587f8d", "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 1.8, 16, 2.7], "circle-opacity": 0.8, "circle-stroke-color": "#ffffff", "circle-stroke-width": 0.6 } }
  ]) {
    map.addLayer({ ...config, source: "infrastructure-network", layout: { visibility: "none" } }, beforeLabels);
    map.on("click", config.id, e => {
      const p = e.features?.[0]?.properties || {};
      networkAssetPopup?.remove();
      const hasPathway = PATHWAYS[state.asset].some(pathway => pathway.id === p.pathway);
      const detail = p.diameter_mm ? `${p.diameter_mm} mm · ` : p.voltage ? `Design ${escapeHTML(p.voltage)} kV · ` : "";
      const popup = new maplibregl.Popup({ maxWidth: "270px" }).setLngLat(e.lngLat)
        .setHTML(`<b>${escapeHTML(p.name || "Infrastructure asset")}</b><br>${escapeHTML(p.asset_type || state.asset)}<br><small>${detail}${escapeHTML(p.source || currentNetwork().sourceLabel)}</small>${hasPathway ? '<button class="asset-pathway-link" type="button">Explore related pathway →</button>' : ''}`).addTo(map);
      networkAssetPopup = popup;
      popup.getElement().querySelector(".asset-pathway-link")?.addEventListener("click", () => {
        const card = [...document.querySelectorAll(".card")].find(el => el.dataset.name === p.pathway);
        if (card) {
          card.querySelector("details").open = true;
          card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        popup.remove();
      });
    });
    map.on("mouseenter", config.id, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", config.id, () => { map.getCanvas().style.cursor = ""; });
  }
  map.addLayer({ id: "network-labels", type: "symbol", source: "infrastructure-network", minzoom: 15,
    filter: ["all", ["==", ["geometry-type"], "Point"], ["in", ["get", "asset_type"], ["literal", ["substation", "reservoir", "water treatment plant", "wastewater treatment plant"]]]],
    layout: { visibility: "none", "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"],
      "text-size": 9, "text-max-width": 12, "text-offset": [0, 1], "text-anchor": "top" },
    paint: { "text-color": "#58666e", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }
  });
  networkMapReady = true;
}
function updateNetworkStatus() {
  const info = SECTOR_INFO[state.asset];
  if (!info) return;
  $("#sectorScope").textContent = info.scope;
  const inventory = currentNetwork();
  const sites = inventory.data.features.filter(f => f.geometry.type === "Point").length;
  const links = inventory.data.features.filter(f => f.geometry.type.includes("LineString")).length;
  $("#networkStatus").textContent = inventory.mode === "osm" ? "OpenStreetMap main roads, highways and bridges."
    : inventory.mode === "published" ? `${inventory.sourceLabel} · ${links.toLocaleString()} selected ${state.asset === 'Power infrastructure' ? 'transmission sections' : 'pipe sections'} and ${sites} facility sites. Auckland demo.`
    : inventory.mode === "unavailable" ? "The populated utility demo is available in Auckland."
    : `${inventory.name}: ${inventory.data.features.length.toLocaleString()} imported features.`;
  $("#clearNetwork").hidden = inventory.mode !== "imported";
  $("#fitNetwork").disabled = !networkMapReady || (inventory.mode === "osm" && !state.city);
  $("#fitNetwork").textContent = !networkMapReady ? "Loading asset map…" : inventory.mode === "unavailable" ? "Explore Auckland demo" : "Frame network";
  $("#mappingBadge").textContent = inventory.mode === "osm" ? "OpenStreetMap roads" : inventory.mode === "published" ? `${inventory.sourceLabel} · Auckland sample` : inventory.mode === "unavailable" ? "Auckland utility demo" : "Imported network";
}
function syncAssetOverlays() {
  if (!networkMapReady) return;
  networkAssetPopup?.remove();
  const roads = state.asset === "Roads and highways";
  const inventory = currentNetwork();
  map.setLayoutProperty("asset-infra-roads", "visibility", roads && inventory.mode === "osm" ? "visible" : "none");
  map.setLayoutProperty("asset-infra-bridges", "visibility", roads && inventory.mode === "osm" ? "visible" : "none");
  map.getSource("infrastructure-network").setData(inventory.data);
  const color = SECTOR_INFO[state.asset].color;
  const visible = inventory.data.features.length > 0;
  for (const [id, property] of [["network-areas", "fill-color"], ["network-lines", "line-color"], ["network-dashed", "line-color"], ["network-points", "circle-color"], ["network-detail-points", "circle-color"]]) {
    map.setPaintProperty(id, property, networkColor(color));
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
  map.setLayoutProperty("network-labels", "visibility", visible ? "visible" : "none");
  updateNetworkStatus();
  updateTerrainMode();
  updateLegendBar();
  const context = `${state.city}|${state.asset}|${inventory.mode}`;
  const showTransmissionExtent = context !== lastNetworkContext && inventory.mode === "published" && state.asset === "Power infrastructure";
  lastNetworkContext = context;
  if (showTransmissionExtent) requestAnimationFrame(frameNetwork);
}
function frameNetwork() {
  if (!networkMapReady) return;
  const inventory = currentNetwork();
  if (inventory.mode === "unavailable") { goToCity("Auckland"); return; }
  const features = inventory.data.features;
  const boxes = inventory.mode === "osm" && state.city ? [CITIES[state.city].bbox] : features.map(featureBBox);
  if (!boxes.length) return;
  const bounds = [[Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1]))],
    [Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))]];
  const narrow = window.innerWidth <= 720;
  const padding = narrow ? 25 : { top: 90, bottom: 100, left: 120, right: 120 };
  stopOrbit();
  map.fitBounds(bounds, { padding, maxZoom: 13.2, pitch: 0, bearing: 0, duration: 1400 });
}
$("#fitNetwork").addEventListener("click", frameNetwork);
function validateNetworkGeoJSON(input) {
  if (input?.type !== "FeatureCollection" || !Array.isArray(input.features) || !input.features.length)
    throw new Error("Choose a GeoJSON FeatureCollection with at least one feature.");
  if (input.features.length > 20000) throw new Error("Use at most 20,000 features per import.");
  const position = p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) &&
    p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90;
  const line = p => Array.isArray(p) && p.length >= 2 && p.every(position);
  const ring = p => line(p) && p.length >= 4 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1];
  const polygon = p => Array.isArray(p) && p.length > 0 && p.every(ring);
  const validators = { Point: position, MultiPoint: p => Array.isArray(p) && p.length > 0 && p.every(position),
    LineString: line, MultiLineString: p => Array.isArray(p) && p.length > 0 && p.every(line),
    Polygon: polygon, MultiPolygon: p => Array.isArray(p) && p.length > 0 && p.every(polygon) };
  const features = input.features.map((f, i) => {
    const g = f?.geometry;
    if (f?.type !== "Feature" || !g || !validators[g.type]?.(g.coordinates))
      throw new Error(`Feature ${i + 1} has unsupported geometry or invalid WGS84 coordinates.`);
    return { type: "Feature", geometry: { type: g.type, coordinates: g.coordinates },
      properties: { name: String(f.properties?.name || "").slice(0, 200),
        asset_type: String(f.properties?.asset_type || "").slice(0, 100) } };
  });
  return { type: "FeatureCollection", features };
}
$("#networkFile").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const sector = state.asset;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error("Choose a GeoJSON file smaller than 25 MB.");
    const data = validateNetworkGeoJSON(JSON.parse(await file.text()));
    networkInventories.set(sector, { name: file.name, data });
    updateNetworkStatus();
    syncAssetOverlays();
    toast(`Loaded ${data.features.length} features for ${sector}. Investment assumptions are unchanged.`);
  } catch (error) { toast(error.message); }
  e.target.value = "";
});
$("#clearNetwork").addEventListener("click", () => {
  networkInventories.delete(state.asset);
  updateNetworkStatus();
  syncAssetOverlays();
});


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
   Geometry helpers for the address context lookup.
   No network exposure or outage result is inferred from these intersections. */

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
  // A spatial intersection is not a service-outage or network-risk model.
  const el = $("#exposureStats");
  if (el) el.hidden = true;
}

/* ---------------- decision model ---------------- */

function normalisedWeights() {
  const total = Object.values(state.weights).reduce((a, b) => a + b, 0);
  const out = {};
  Object.entries(state.weights).forEach(([k, v]) => out[k] = v / total);
  return out;
}

state.scenario = { ...InfrastructureModel.defaults };
const shortlisted = new Map(); // At most one alternative per sector.
const money = value => `${value < 0 ? '−' : ''}$${Math.abs(value).toFixed(2)}m`;
const tonnes = (value, signed = false) => `${value < 0 ? '−' : signed && value > 0 ? '+' : ''}${Math.abs(value).toLocaleString('en-NZ', { maximumFractionDigits: 0 })} t CO₂e`;
function benefitLabels(asset = state.asset) {
  return asset === "Roads and highways" ? {
    repairs: "Avoided road repair costs", continuity: "Avoided detour & delay costs",
    environmental: "Runoff & ecosystem benefits", community: "Community & emergency access"
  } : BENEFIT_LABELS;
}
function carbonDetail(p) {
  if (!p.carbon) return "<p>Carbon inventory not assessed for this pathway.</p>";
  const c = p.carbon;
  return `<table class="benefit-table carbon-table"><caption>Illustrative carbon · ${state.scenario.years}-year appraisal</caption>
    <tbody><tr><th>Construction / materials</th><td>${tonnes(c.upfront)}</td></tr>
    <tr><th>Additional maintenance</th><td>${tonnes(c.maintenance)} (${tonnes(c.maintenanceAnnual)}/yr)</td></tr>
    <tr><th>Gross works emissions</th><td>${tonnes(c.gross)}</td></tr>
    <tr><th>Avoided detour / repair emissions</th><td>${tonnes(c.avoided)} (${tonnes(c.avoidedAnnual)}/yr)</td></tr>
    <tr><th>Net change vs no investment</th><td><b>${tonnes(c.net, true)}</b></td></tr></tbody></table>
    <p class="hazard-note">Negative net values mean an assumed reduction. Physical tonnes are not discounted, monetised in B/C, or used to recalculate the illustrative environmental score. Routine traffic, induced demand, end of life and sequestration are excluded.</p>`;
}
function computeResults(asset = state.asset) {
  return InfrastructureModel.evaluate(PATHWAYS[asset] || [], state.scenario, state.weights);
}
function displayedWeights() {
  const entries = Object.entries(normalisedWeights()).map(([key, value]) => ({ key, value: value * 100 }));
  const out = Object.fromEntries(entries.map(({ key, value }) => [key, Math.floor(value)]));
  let remaining = 100 - Object.values(out).reduce((a, b) => a + b, 0);
  entries.sort((a, b) => (b.value % 1) - (a.value % 1));
  for (let i = 0; i < remaining; i++) out[entries[i].key]++;
  return out;
}
function updateWeightLabels() {
  const weights = displayedWeights();
  document.querySelectorAll(".slider-row").forEach(row => {
    row.querySelector("b").textContent = `${weights[row.dataset.w]}%`;
    const input = row.querySelector("input");
    input.setAttribute("aria-label", row.querySelector("span").textContent);
    input.setAttribute("aria-valuetext", `${weights[row.dataset.w]} percent of total priority`);
  });
}
function buildCards(results) {
  const wrap = $("#pathwayCards");
  wrap.innerHTML = results.map(p => `
    <article class="card" data-name="${p.id}">
      <div class="card-rank-row"><span class="rank-badge"></span><h4>${p.name}</h4><span class="card-score" title="Weighted preference score / 100">0</span></div>
      <div class="score-track"><div class="score-fill"></div></div>
      <p class="pathway-hazard">${p.hazard}</p><p class="card-desc">${p.description}</p>
      <div class="meta"></div>
      <div class="carbon-summary"></div>
      <details class="pathway-details"><summary>${p.scope ? "Pathway, benefits &amp; carbon" : "Benefits &amp; assumptions"}</summary>
        <div class="benefit-detail"></div>
        <p class="tradeoff">${p.tradeoff}</p>
        <div class="radar"></div>
      </details>
      <button class="select-pathway" type="button" data-id="${p.id}" aria-pressed="false">Add to shortlist</button>
    </article>`).join("");
  wrap.querySelectorAll(".select-pathway").forEach(button => button.addEventListener("click", () => {
    const current = shortlisted.get(state.asset);
    if (current?.id === button.dataset.id) shortlisted.delete(state.asset);
    else shortlisted.set(state.asset, { id: button.dataset.id, city: state.city });
    renderResults();
  }));
}
function renderResults() {
  const panel = $("#resultsPanel");
  panel.hidden = !state.asset;
  if (!state.asset) return;
  const results = computeResults();
  $("#resultsContext").textContent = `${state.city ?? "Aotearoa NZ"} · ${state.asset}`;
  $(".model-notice").textContent = state.asset === "Roads and highways"
    ? "6 road pathways · prototype costs, B/C, carbon & scores"
    : "Prototype estimates · NZ$ · expand a pathway for assumptions";
  const wrap = $("#pathwayCards");
  const sameSet = wrap.children.length === results.length &&
    results.every(p => [...wrap.children].some(el => el.dataset.name === p.id));
  if (!sameSet) buildCards(results);
  const elements = new Map([...wrap.children].map(el => [el.dataset.name, el]));
  results.forEach((p, i) => {
    const el = elements.get(p.id);
    if (wrap.children[i] !== el) wrap.insertBefore(el, wrap.children[i] || null);
    el.classList.toggle("top", i === 0);
    el.querySelector(".rank-badge").textContent = i + 1;
    el.querySelector(".score-fill").style.width = `${p.score}%`;
    tweenScore(el.querySelector(".card-score"), p.score);
    el.querySelector(".meta").innerHTML = `<span>CAPITAL <b>${money(p.capital)}</b></span><span>LIFECYCLE <b>${money(p.costPV)}</b></span><span>B/C <b>${p.bcr.toFixed(2)}</b></span>`;
    el.querySelector(".carbon-summary").innerHTML = p.carbon ? `<span>NET CARBON · ${state.scenario.years} YEARS</span><b>${tonnes(p.carbon.net, true)}</b>` : "";
    el.querySelector(".carbon-summary").classList.toggle("carbon-increase", p.carbon?.net > 0);
    el.querySelector(".benefit-detail").innerHTML = `
      ${p.scope ? `<p class="costed-scope"><b>Costed scope per package:</b> ${p.scope}</p>` : ""}
      ${p.sequence ? `<div class="road-sequence"><b>Pathway steps</b><ol>${p.sequence.map(step => `<li>${step}</li>`).join("")}</ol><p><b>Review trigger:</b> ${p.trigger}</p></div>` : ""}
      <p class="disruption"><b>${p.disruptionReduction}%</b> assumed reduction in ${p.scope ? "road-closure" : "service"} disruption</p>
      <table class="benefit-table"><caption>Benefit assumptions · NZ$m</caption><thead><tr><th>Benefit</th><th>Annual</th><th>Present value</th></tr></thead><tbody>
        ${Object.entries(benefitLabels()).map(([k, label]) => `<tr><th>${label}</th><td>${money(p.annualBenefits[k] * state.scenario.units)}</td><td>${money(p.benefitPV[k])}</td></tr>`).join("")}
      </tbody></table>
      <p class="detail-totals">Total benefits <b>${money(p.benefits)}</b> · NPV <b>${money(p.npv)}</b><br>Maintenance ${money(p.annualMaintenance * state.scenario.units)}/year; present value ${money(p.maintenancePV)}.</p>
      <p class="hazard-note">${state.scenario.units} × ${SECTOR_INFO[state.asset].unit}; ${state.scenario.years} years at ${state.scenario.discount}% real discount. Benefits are incremental to no investment; values and disruption reductions are illustrative. ${p.scope ? "The costed package is paid at year 0; any later trigger-led changes need separate costing. Road environmental benefit values exclude carbon valuation." : ""}</p>
      ${p.carbon ? carbonDetail(p) : ""}`;
    el.querySelector(".radar").innerHTML = radarSVG(p.adj);
    const selected = shortlisted.get(state.asset)?.id === p.id;
    const button = el.querySelector(".select-pathway");
    button.setAttribute("aria-pressed", String(selected));
    button.textContent = selected ? "✓ Shortlisted · remove" : "Add to shortlist";
  });
  renderShortlist();
}
function shortlistResults() {
  return [...shortlisted].map(([asset, selection]) => ({ asset, city: selection.city,
    pathway: computeResults(asset).find(p => p.id === selection.id) }));
}
function renderShortlist() {
  const items = shortlistResults();
  const total = items.reduce((sum, x) => sum + x.pathway.capital, 0);
  const within = total <= state.scenario.budget + 1e-9;
  $("#shortlistPanel").innerHTML = `<div class="shortlist-heading"><b>Investment shortlist</b><span>${items.length} / 3 networks</span></div>
    ${items.length ? `<ul>${items.map(({ asset, pathway, city }) => `<li><span><b>${pathway.name}</b><small>${asset} · ${city ?? "Aotearoa NZ"}</small></span><button type="button" data-remove="${escapeHTML(asset)}" aria-label="Remove ${escapeHTML(pathway.name)}">×</button></li>`).join("")}</ul>
      <p class="shortlist-total ${within ? "" : "over-budget"}">Capital ${money(total)} / ${money(state.scenario.budget)} <b>${within ? "within budget" : `${money(total - state.scenario.budget)} over budget`}</b></p>`
      : `<p>Choose one alternative per network to compare an indicative capital programme.</p>`}
    <small>One alternative per sector. Shared assumptions update all selections. Dependencies and overlapping benefits require separate assessment.</small>`;
  $("#shortlistPanel").querySelectorAll("[data-remove]").forEach(button => button.addEventListener("click", () => {
    shortlisted.delete(button.dataset.remove);
    renderResults();
  }));
}
const scenarioInputs = { units: $("#scenarioUnits"), years: $("#scenarioYears"), discount: $("#scenarioDiscount"), budget: $("#scenarioBudget") };
Object.values(scenarioInputs).forEach(input => input.addEventListener("input", () => {
  const valid = Object.values(scenarioInputs).every(el => el.value !== "" && el.checkValidity());
  $("#scenarioError").hidden = valid;
  if (!valid) {
    $("#scenarioError").textContent = "Enter valid values within the stated ranges. Results retain the last valid assumptions.";
    return;
  }
  state.scenario = Object.fromEntries(Object.entries(scenarioInputs).map(([k, el]) => [k, el.valueAsNumber]));
  renderResults();
}));


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
    stopOrbit();
    updateNetworkStatus();
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
    updateWeightLabels();
    document.querySelectorAll(".preset-chip").forEach(b => b.classList.remove("active"));
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
        : `<b>No intersection found in the checked snapshots.</b><br>` +
          `<span style="font-size:11px">Coverage is partial; this does not establish safety or network service continuity${city ? " for " + city : ""}.</span>`)
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
        `<button class="search-result" data-i="${i}">${escapeHTML(r.display_name)}</button>`).join("");
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
  const results = computeResults();
  const active = HAZARD_LAYERS.filter(l => state.activeLayers.has(l.id) && layerAvailableHere(l));
  const w = displayedWeights(), s = state.scenario, selections = shortlistResults();
  const totalCapital = selections.reduce((sum, item) => sum + item.pathway.capital, 0);
  const body = `
    <h1>Infrastructure resilience — decision briefing</h1>
    <p class="b-sub">${state.city ?? "Aotearoa NZ"} · ${state.asset} · Generated ${new Date().toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "long", year: "numeric" })}</p>
    <h2>Screening assumptions</h2>
    <p>${s.units} package(s) · ${s.years}-year horizon · ${s.discount}% real discount · Capital budget ${money(s.budget)}. All monetary values are constant NZ$ millions.</p>
    <p>${SECTOR_INFO[state.asset].scope}</p>
    <p>Priorities: Economic ${w.economic}% · Service resilience ${w.technical}% · Environmental ${w.environmental}% · Community &amp; equity ${w.social}% (rounded display).</p>
    <p>Year 0 capital plus discounted annual maintenance; year-end benefits in years 1–${s.years}. BCR = discounted benefits / lifecycle costs; NPV = discounted benefits − lifecycle costs. Economic score = 100 × BCR / (1 + BCR). Other scores and disruption reductions are illustrative assumptions.</p>
    ${shot ? `<h2>Current map view</h2><img src="${shot}" class="brief-map" alt="Current infrastructure and hazard map">` : ""}
    <h2>Asset mapping context</h2>
    <p>${escapeHTML($("#networkStatus").textContent)}</p>
    <p>${currentNetwork().mode === 'osm' ? 'Road alignments and bridge highlights come from the OpenStreetMap basemap.' : currentNetwork().mode === 'published' ? `Auckland network context is drawn from <a href="${currentNetwork().sourceURL}">${currentNetwork().sourceLabel}</a>. The display is a selected sample; the power sample covers transmission infrastructure. Watercare data are licensed CC BY 4.0. Facility footprints are represented as small point markers.` : currentNetwork().mode === 'imported' ? 'An imported inventory replaces the default network context for this sector.' : 'The populated utility demo is available in Auckland.'}</p>
    <p>Sea-level map scenario: +${state.slr} m${state.city === "Auckland" ? " (Auckland only)" : " (no scenario layer available here)"}. Hazard layers and imported inventories do not calibrate investment results.</p>
    ${active.length ? `<table><tr><th>Displayed hazard</th><th>Source</th></tr>${active.map(l => `<tr><td>${l.label}</td><td>${l.attribution}</td></tr>`).join("")}</table>` : '<p>No hazard overlays displayed.</p>'}
    <h2>Ranked alternatives — ${state.asset}</h2>
    <table><tr><th>#</th><th>Pathway</th><th>Score /100</th><th>Capital</th><th>Lifecycle cost</th><th>Benefits PV</th><th>B/C</th><th>NPV</th>${results.some(p => p.carbon) ? '<th>Net carbon</th>' : ''}</tr>
      ${results.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.score}</td><td>${money(p.capital)}</td><td>${money(p.costPV)}</td><td>${money(p.benefits)}</td><td>${p.bcr.toFixed(2)}</td><td>${money(p.npv)}</td>${p.carbon ? `<td>${tonnes(p.carbon.net, true)}</td>` : ''}</tr>`).join("")}</table>
    <h2>Benefit assumptions and tradeoffs</h2>
    ${results.map(p => `<h3>${p.name}</h3>${p.scope ? `<p><b>Costed scope per package:</b> ${p.scope}</p><ol>${p.sequence.map(step => `<li>${step}</li>`).join('')}</ol><p><b>Review trigger:</b> ${p.trigger}</p>` : ''}<p>${p.tradeoff}</p><p>${p.disruptionReduction}% assumed reduction in disruption. Annual maintenance ${money(p.annualMaintenance * s.units)}.</p><table><tr><th>Benefit</th><th>Annual</th><th>Present value</th></tr>${Object.entries(benefitLabels()).map(([k, label]) => `<tr><td>${label}</td><td>${money(p.annualBenefits[k] * s.units)}</td><td>${money(p.benefitPV[k])}</td></tr>`).join("")}</table>${p.carbon ? carbonDetail(p) : ''}`).join("")}
    ${state.asset === 'Roads and highways' ? '<p>All road treatment quantities, costs, benefit values, carbon inventories, disruption reductions and scores are illustrative. Pathway steps describe a decision sequence; the financial calculation costs the stated delivered package at year 0. Later trigger-led investments are excluded. Monetised environmental benefits exclude carbon valuation.</p>' : ''}
    <h2>Investment shortlist</h2>
    ${selections.length ? `<table><tr><th>Network / context</th><th>Selected alternative</th><th>Capital</th></tr>${selections.map(({ asset, pathway, city }) => `<tr><td>${asset} · ${city ?? "Aotearoa NZ"}</td><td>${pathway.name}</td><td>${money(pathway.capital)}</td></tr>`).join("")}</table><p>Total capital ${money(totalCapital)} / budget ${money(s.budget)} — ${totalCapital <= s.budget + 1e-9 ? 'within budget' : 'over budget'}.</p>` : '<p>No pathways shortlisted.</p>'}
    <h2>Network dependencies</h2><p>${SECTOR_INFO[state.asset].dependency}</p>
    <p class="b-note">Illustrative screening only. Each sector compares alternative packages with no investment. Inputs need owner validation and project-specific useful lives. No residual values, replacement cycles, escalation or later adaptation stages are included. Avoid double counting across benefit categories and sectors. The shortlist is not a network optimisation; dependencies and cascading failures are unmodelled. OpenStreetMap is partial inventory context. Hazard sources: Auckland Council, GWRC, CCC, DCC, GNS Science and GeoNet.</p>`;
  $("#briefingReport").innerHTML = `<div class="b-toolbar"><button id="printReport">Print / Save as PDF</button><button id="closeReport">Close</button></div>${body}`;
  $("#printReport").addEventListener("click", () => window.print());
  $("#closeReport").addEventListener("click", () => $("#briefingReport").classList.remove("open"));
}


$("#briefBtn").addEventListener("click", async () => {
  await buildBriefing();
  $("#briefingReport").classList.add("open");
});

/* ---------------- infrastructure tour ---------------- */
let tourActive = false;
let tourRun = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function startTour() {
  tourActive = true;
  const run = ++tourRun;
  $("#tourBtn").classList.add("running");
  $("#tourBtn").textContent = "■ Stop";
  try {
    if (state.city !== "Auckland") goToCity("Auckland");
    await sleep(4600);
    for (const asset of ASSET_SYSTEMS) {
      if (!tourActive || run !== tourRun) return;
      document.querySelectorAll("#assetSeg .seg").forEach(b => {
        if (b.dataset.asset === asset) b.click();
      });
      toast(SECTOR_INFO[asset].scope);
      await sleep(4000);
    }
  } finally { if (run === tourRun) stopTour(); }
}
function stopTour() {
  tourActive = false;
  tourRun++;
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
    updateWeightLabels();
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
  "Explain the investment assumptions",
  "Compare road carbon emissions",
  "Explain the pathway steps and triggers"
];

let chatStarted = false;

function chatContextLabel() {
  return `${state.city ?? "Aotearoa NZ"}${state.asset ? " · " + state.asset : ""}`;
}

function scoreTopFor(city, asset) {
  // City is context only: there is no validated regional cost / fragility model.
  return computeResults(asset)[0];
}
function chatAnswer(q) {
  const lower = q.toLowerCase();
  if (lower.includes("mapping") || lower.includes("asset map") || lower.includes("network map")) {
    const network = currentNetwork();
    if (network.mode === 'osm') return 'Roads and highway bridges are highlighted from OpenStreetMap. The road resilience pathways retain prototype cost and benefit assumptions.';
    if (network.mode === 'unavailable') return 'The populated utility demo is in Auckland. Use “Explore Auckland demo” to see Watercare mains and facilities or Transpower transmission lines and substations.';
    if (network.mode === 'published') return `${network.sourceLabel} supplies the published geometry for this Auckland network sample. Use “Frame network” to view its extent. The Watercare sample selects larger operating mains; the Transpower sample shows transmission infrastructure rather than a complete local distribution grid. Cost and benefit values remain prototype assumptions.`;
    return 'An imported inventory is displayed. Use “Restore default mapping” to return to the published network context.';
  }
  if (lower.includes("carbon") || lower.includes("emission")) {
    const p = computeResults()[0];
    if (!p.carbon) return "Illustrative carbon inventories are currently provided for the six road pathways. Select Roads & highways to compare them.";
    if (lower.includes("compare")) return `Illustrative net carbon over ${state.scenario.years} years, for ${state.scenario.units} package(s):\n` +
      computeResults().map(item => `• ${item.name}: ${tonnes(item.carbon.net, true)}`).join('\n') +
      "\n\nNet = construction + additional maintenance − avoided detour / repair emissions. Negative means an assumed reduction versus no investment. These tonnes are separate from B/C and the environmental score; inputs are illustrative.";
    return `${p.name}: construction ${tonnes(p.carbon.upfront)}, maintenance ${tonnes(p.carbon.maintenance)}, avoided detour / repair emissions ${tonnes(p.carbon.avoided)} over ${state.scenario.years} years. Net change is ${tonnes(p.carbon.net, true)} versus no investment.\n\nAll carbon inputs are illustrative. Tonnes are not discounted, monetised in B/C, or used to recalculate the environmental score. Routine traffic, induced demand and end-of-life emissions are excluded.`;
  }
  if (state.asset === "Roads and highways" && (lower.includes("stage") || lower.includes("trigger") || lower.includes("tailor"))) {
    const p = computeResults()[0];
    return `${p.name}\n\n${p.sequence.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\nReview trigger: ${p.trigger}\n\nCosted scope: ${p.scope}\n\nThe stated package is costed at year 0. Later trigger-led investments require separate appraisal. These are illustrative decision sequences.`;
  }
  if (lower.includes("hazard") || lower.includes("layer")) {
    const active = HAZARD_LAYERS.filter(l => state.activeLayers.has(l.id) && layerAvailableHere(l));
    return active.length ? `Displayed for ${state.city ?? "Aotearoa NZ"}:\n` + active.map(l => `• ${l.label} — ${l.attribution}`).join("\n") +
      "\n\nThese overlays provide context and do not change the illustrative investment model."
      : "No hazard layers are switched on. Select a city to explore its available local hazard data.";
  }
  if (lower.includes("assumption") || lower.includes("cost") || lower.includes("benefit") || lower.includes("budget")) {
    const s = state.scenario, p = computeResults()[0];
    return `Current screening: ${s.units} package(s), ${s.years} years, ${s.discount}% real discount, ${money(s.budget)} capital budget.\n\n` +
      `${p.name}: capital ${money(p.capital)}, lifecycle cost ${money(p.costPV)}, discounted benefits ${money(p.benefits)}, BCR ${p.bcr.toFixed(2)}, NPV ${money(p.npv)}.\n\n` +
      "Annual benefits include avoided damage, service continuity, environment and community. All inputs are illustrative. Expand a pathway for its assumptions. Location and map layers do not calibrate these values.";
  }
  if (lower.includes("rank") || lower.includes("calculat") || lower.includes("score") || lower.includes("how") || lower.includes("mcda")) {
    const w = displayedWeights();
    return `The score is a weighted average: economic ${w.economic}%, service resilience ${w.technical}%, environmental ${w.environmental}%, community & equity ${w.social}%.\n\nEconomic score = 100 × BCR / (1 + BCR); other dimension scores are illustrative. Capital budget flags affordability and does not change ranking. Hazard maps do not change the scores. The shortlist allows one alternative per sector and needs a separate dependency assessment.`;
  }
  if (lower.includes("compare") || lower.includes("cities")) return "Cities provide map and hazard context. The current model uses the same uncalibrated assumptions in each city, so rankings do not vary by city. Use owner data and network outage modelling for regional comparisons.";
  if (lower.includes("top") || lower.includes("best") || lower.includes("pathway")) {
    const p = computeResults()[0];
    return `For ${chatContextLabel()}, the highest weighted score is “${p.name}” (${p.score}/100), with BCR ${p.bcr.toFixed(2)}.\n\nThis is an illustrative preference ranking, not a validated investment recommendation. ${SECTOR_INFO[state.asset].dependency}`;
  }
  return "I am a local scripted guide. Ask about the top pathway, displayed hazards, ranking or investment assumptions. Network map imports support points, lines and polygons in WGS84; they do not alter investment assumptions.";
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
    roads: "#d38a12",
    radarStroke: "#0a54a0", radarFill: "rgba(10,84,160,.22)",
    label: "Massey palette (navy · blue · gold)"
  },
  branz: {
    roads: "#e2342b",
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
    if (map.getLayer("asset-infra-roads"))
      map.setPaintProperty("asset-infra-roads", "line-color", t.roads);
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

updateNetworkStatus();
updateWeightLabels();
refreshHazardToggles();
applyTheme(themeName);   // restores the saved brand theme and renders results
