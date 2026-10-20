// Reuse the original map and hazard interactions without modifying the original dashboard.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
let data = read('data.js');
data = data.slice(0, data.indexOf('/* ------------------------------------------------------------\n   Decision model')) +
  data.slice(data.indexOf('/* ------------------------------------------------------------\n   Sea-level-rise scenarios'));
data = data.replace('shape retrofit priorities', 'shape network investment priorities');
fs.writeFileSync(path.join(__dirname, 'data.js'), data);
let app = read('app.js');
const replaceSection = (start, end, content) => {
  const a = app.indexOf(start), b = app.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('Missing source section: ' + start);
  app = app.slice(0, a) + content + '\n\n' + app.slice(b);
};
app = app.replace('asset: null,', 'asset: "Roads and highways",');
app = app.replace(/function resetAssetSelection\(\) \{[\s\S]*?\n\}/, 'function resetAssetSelection() { /* Keep the chosen network when navigating. */ }');
app = app.replace('resetAssetSelection();  // each zoom-in starts with no asset selected', 'resetAssetSelection();  // retain the selected infrastructure sector');
app = app.replace('    startOrbit();\n    showContext(name);', '    if (!state.asset) startOrbit();\n    showContext(name);');
app = app.replace('  addCityMarkers();', '  addCityMarkers();\n  setMarkersVisible(!state.city);');
app = app.replace('  state.city = name;\n  stopOrbit();', '  state.city = name;\n  setMarkersVisible(false);\n  stopOrbit();');
app = app.replace('  setTimeout(() => {\n    map.flyTo({ ...NZ_VIEW', '  setTimeout(() => {\n    if (state.city !== null) return;\n    map.flyTo({ ...NZ_VIEW');
app = app.replace('Client-side point-in-polygon of the strategic buildings against every\n   visible hazard fill — "N hospitals inside the flood plain".', 'Geometry helpers for the address context lookup.\n   No network exposure or outage result is inferred from these intersections.');
// City buildings are basemap context, but the investment overlays are infrastructure only.
const buildingStart = app.indexOf('  // 3D buildings from the OSM tiles');
const buildingEnd = app.indexOf('  // Cinematic intro', buildingStart);
app = app.slice(0, buildingStart) + app.slice(buildingEnd);
app = app.replace('["asset-residential", "asset-infra-roads", "asset-infra-rail",\n   "asset-infra-bridges", "asset-strategic"]', '["asset-infra-roads", "asset-infra-bridges", "network-lines", "network-dashed", "network-points", "network-detail-points", "network-areas", "network-labels"]');
const legendStart = app.indexOf('  if (state.city !== null && state.asset) {   // overlays');
const legendEnd = app.indexOf('\n  const activeHazards =', legendStart);
if (legendEnd < 0) throw new Error('Missing legend boundary');
app = app.slice(0, legendStart) + `  if (state.asset) {
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
` + app.slice(legendEnd);
replaceSection('/* ---------------- asset-system map overlays', '/* ---------------- sea-level-rise scenarios', fs.readFileSync(path.join(__dirname, 'network.part.js'), 'utf8'));
replaceSection('function updateExposureStats()', '/* ---------------- decision model', `function updateExposureStats() {
  // A spatial intersection is not a service-outage or network-risk model.
  const el = $("#exposureStats");
  if (el) el.hidden = true;
}`);
replaceSection('function computeResults()', '/* Four-axis radar', fs.readFileSync(path.join(__dirname, 'results.part.js'), 'utf8'));
app = app.replace('    state.asset = seg.dataset.asset;\n    syncAssetOverlays();', '    state.asset = seg.dataset.asset;\n    stopOrbit();\n    updateNetworkStatus();\n    syncAssetOverlays();');
app = app.replace('    label.textContent = `${input.value}%`;\n    renderResults();', '    updateWeightLabels();\n    document.querySelectorAll(".preset-chip").forEach(b => b.classList.remove("active"));\n    renderResults();');
replaceSection('async function buildBriefing()', '$("#briefBtn").addEventListener', fs.readFileSync(path.join(__dirname, 'briefing.part.js'), 'utf8'));
replaceSection('/* ---------------- auto-tour', '/* ---------------- weight presets', `/* ---------------- infrastructure tour ---------------- */
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
  map.getCanvas().addEventListener(ev, () => { if (tourActive) stopTour(); }, { passive: true }));`);
// Presets must display the actual normalised weights.
app = app.replace('    renderResults();\n  }));\n\n/* ---------------- live earthquake pulse', '    updateWeightLabels();\n    renderResults();\n  }));\n\n/* ---------------- live earthquake pulse');
replaceSection('function scoreTopFor(', 'function chatAddMessage(', fs.readFileSync(path.join(__dirname, 'assistant.part.js'), 'utf8'));
app = app.replace('  "Compare the cities"', '  "Explain the investment assumptions"');
app = app.replace('  "Explain the investment assumptions"', '  "Explain the investment assumptions",\n  "Compare road carbon emissions",\n  "Explain the pathway steps and triggers"');
app = app.replace('AI decision support', 'Local decision support');
app = app.replace('residential: "#f5d98f", roads: "#ffb321", rail: "#06254c",', 'roads: "#d38a12",');
app = app.replace('residential: "#f6d9d5", roads: "#e2342b", rail: "#1d1d1b",', 'roads: "#e2342b",');
app = app.replace(/    if \(map.getLayer\("asset-residential"\)\)[\s\S]*?t.residential\);\n/, '');
app = app.replace(/    if \(map.getLayer\("asset-infra-rail"\)\)[\s\S]*?t.rail\);\n/, '');
app = app.replace('refreshHazardToggles();\napplyTheme(themeName);', 'updateNetworkStatus();\nupdateWeightLabels();\nrefreshHazardToggles();\napplyTheme(themeName);');
app = app.replace('fetch(`data/${key}.geojson`)', 'fetch(`../data/${key}.geojson`)');
app = app.replace('>${r.display_name}</button>', '>${escapeHTML(r.display_name)}</button>');
app = app.replace('<b>✓ Not inside any locally mapped flood or coastal extent.</b>', '<b>No intersection found in the checked snapshots.</b>');
app = app.replace('Checked against the bundled council datasets${city ? " for " + city : ""}.', 'Coverage is partial; this does not establish safety or network service continuity${city ? " for " + city : ""}.');
fs.writeFileSync(path.join(__dirname, 'app.js'), app);
let html = read('original.html');
html = html.replace('<title>Resilient Aotearoa NZ — Pathways Explorer</title>', '<title>Resilient Aotearoa NZ — Infrastructure Pathways</title>');
html = html.replace('style.css?v=23', '../style.css?v=23\">\n<link rel="stylesheet" href="style.css?v=1');
html = html.replace('<span class="brand-sub">Pathways Explorer</span>', '<span class="brand-sub">Infrastructure Pathways Explorer</span>');
html = html.replace(/      <button class="seg" data-asset="Residential">[\s\S]*?<\/div>/, ASSET_BUTTONS());
function ASSET_BUTTONS() { return `      <button class="seg active" data-asset="Roads and highways">↗ Roads &amp; highways</button>
      <button class="seg" data-asset="Water and wastewater">≈ Water &amp; wastewater</button>
      <button class="seg" data-asset="Power infrastructure">ϟ Power infrastructure</button>
    </div>
    <p class="sector-scope" id="sectorScope"></p>
    <p class="network-status" id="networkStatus" role="status"></p>
    <button class="fit-network" id="fitNetwork" type="button" disabled>Loading asset map…</button>
    <details class="network-data"><summary>Use research mapping</summary>
      <label class="import-label" for="networkFile">Import network GeoJSON</label>
      <input id="networkFile" type="file" accept=".geojson,.json,application/geo+json,application/json">
      <button class="clear-network" id="clearNetwork" type="button" hidden>Restore default mapping</button>
      <p>Optionally replace the published network context with your research mapping. Imports are local to this session and do not change investment assumptions.</p>
    </details>`; }
html = html.replace('>Economic</span>', '>Economic value</span>').replace('>Technical</span>', '>Service resilience</span>').replace('>Socio-cultural</span>', '>Community &amp; equity</span>');
html = html.replace('Weights are normalised automatically.', 'Weights shown are normalised to 100%. Scores and engineering outcomes are illustrative.');
html = html.replace('  </section>\n</aside>', `  </section>
  <section class="block scenario-block">
    <div class="block-label"><span class="step">05</span> Investment assumptions</div>
    <div class="scenario-grid">
      <label>Packages <input id="scenarioUnits" type="number" min="1" max="100" step="1" value="1"></label>
      <label>Horizon (years) <input id="scenarioYears" type="number" min="1" max="100" step="1" value="30"></label>
      <label>Real discount (%) <input id="scenarioDiscount" type="number" min="0" max="20" step="0.1" value="4"></label>
      <label>Capital budget (NZ$m) <input id="scenarioBudget" type="number" min="0" max="10000" step="0.1" value="20"></label>
    </div>
    <p class="input-error" id="scenarioError" role="alert" hidden></p>
    <p class="hazard-note">Shared across sectors. All money is in constant NZ$ millions. Capital is paid now; annual costs and benefits start in year 1.</p>
    <details class="methodology"><summary>How this screening model works</summary>
      <p>Costs = capital + discounted annual maintenance. Benefits = discounted annual avoided damage, service, environmental and community benefits. BCR = benefits ÷ costs. NPV = benefits − costs.</p>
      <p>Economic score = 100 × BCR ÷ (1 + BCR). Other dimension scores and disruption reductions are illustrative assumptions. The ranking is the weighted average of four dimension scores.</p>
      <p>Each sector compares packages against a no-investment baseline. Road pathways specify treatment quantities, delivery steps and review triggers. Costs cover the stated package at year 0; later trigger-led changes need separate costing. Different pathways address different hazards and residual risks.</p>
      <p>Road carbon = construction + annual additional maintenance × years − annual avoided detour / repair emissions × years, scaled by packages. Values are illustrative tonnes of CO₂ equivalent, with no physical discounting. Carbon is shown separately from B/C and the illustrative environmental score. Routine traffic, induced demand, end of life and sequestration are excluded.</p>
      <p>No escalation, residual value or replacement cycles are included. Horizon should not exceed the intervention's useful life without revised inputs.</p>
      <p>Location, hazard layers and sea-level scenarios provide map context; they do not calibrate costs or rankings. An asset inventory, fragility model and outage analysis are needed for that connection.</p>
      <p>Benefit categories must be independently valued to avoid double counting. MCDA dimensions may overlap; the score is a preference index. Shortlisting across sectors does not model dependencies or shared benefits.</p>
      <p>Road intervention context: <a href="https://www.nzta.govt.nz/partners/planning-and-investment/crown-resilience-programme" target="_blank" rel="noopener">NZTA resilience treatments</a>. Carbon context: <a href="https://www.nzta.govt.nz/resources/research/reports/720" target="_blank" rel="noopener">NZTA infrastructure carbon research</a>. All quantities and numerical values in this demo are invented for illustration.</p>
    </details>
  </section>
</aside>`);
html = html.replace('Aotearoa NZ · Residential', 'Aotearoa NZ · Roads and highways');
html = html.replace('<div class="cards" id="pathwayCards"></div>', `<p class="model-notice">Illustrative screening · NZ$ · expand a pathway for assumptions</p>
  <div class="cards" id="pathwayCards"></div>
  <div class="shortlist glass" id="shortlistPanel" aria-live="polite"></div>`);
html = html.replace('AI decision support · demo', 'Local scripted guide · demo');
html = html.replace('build 38 · Demo decision values', 'Infrastructure edition · Illustrative investment values');
html = html.replace('<div class="vignette" aria-hidden="true"></div>', '<div class="vignette" aria-hidden="true"></div>\n<div class="mapping-badge glass" id="mappingBadge">OpenStreetMap roads</div>');
html = html.replace('<script src="data_bundle.js"></script>', '<script src="../data_bundle.js"></script>');
html = html.replace('<script src="data.js?v=14"></script>', '<script src="data.js?v=1"></script>\n<script src="pathways.js?v=1"></script>\n<script src="network_data.js?v=1"></script>\n<script src="model.js?v=1"></script>');
html = html.replace('<script src="app.js?v=38"></script>', '<script src="app.js?v=1"></script>');
// Refresh cached local scripts and styles when a published asset changes.
html = html.replace(/((?:src|href)=")([^"?]+\.(?:js|css))(?:\?v=[^"\s]*)?"/g, (match, prefix, asset) => {
  if (/^https?:/.test(asset)) return match;
  const file = path.resolve(__dirname, asset);
  const version = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  return `${prefix}${asset}?v=${version}"`;
});
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
