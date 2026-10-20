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
