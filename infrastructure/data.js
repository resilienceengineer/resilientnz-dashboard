/* ============================================================
   Resilient NZ v3 — data layer
   Everything the UI renders comes from this file so validated
   research data can be dropped in without touching app.js.
   ============================================================ */

const NZ_VIEW = {
  center: [172.8, -41.1],
  zoom: 4.85,
  pitch: 0,
  bearing: 0
};

const INTRO_VIEW = {
  center: [155, -15],   // far out over the Pacific for the globe intro
  zoom: 1.4,
  pitch: 0,
  bearing: 0
};

const CITIES = {
  "Auckland": {
    center: [174.7645, -36.8509],
    zoom: 11.4,
    pitch: 57,
    bearing: -16,
    bbox: [174.55, -37.05, 175.00, -36.70],   // metro extent for hazard queries
    cbd: [174.7655, -36.8465],                // 3D city view target
    exposure: "High",
    blurb: "Flood plains, overland flow paths and coastal inundation shape network investment priorities across Tāmaki Makaurau."
  },
  "Wellington": {
    center: [174.7772, -41.2889],
    zoom: 12.0,
    pitch: 60,
    bearing: 24,
    bbox: [174.60, -41.40, 175.00, -41.10],
    exposure: "Very high",
    blurb: "Active faults, steep slopes and coastal exposure make Te Whanganui-a-Tara a multi-hazard decision context."
  },
  "Christchurch": {
    center: [172.6362, -43.5321],
    zoom: 11.6,
    pitch: 55,
    bearing: -10,
    bbox: [172.45, -43.65, 172.80, -43.40],
    exposure: "Moderate",
    blurb: "Liquefaction-prone land and flood management areas drive pathway choices in Ōtautahi."
  },
  "Dunedin": {
    center: [170.5028, -45.8788],
    zoom: 12.2,
    pitch: 58,
    bearing: 20,
    bbox: [170.35, -45.95, 170.75, -45.75],
    exposure: "Moderate",
    blurb: "Low-lying South Dunedin and harbour-edge suburbs face compounding flood and groundwater hazards."
  },
  "Napier": {
    center: [176.9120, -39.4928],
    zoom: 12.3,
    pitch: 57,
    bearing: -12,
    bbox: [176.78, -39.60, 177.00, -39.42],
    exposure: "High",
    blurb: "Ahuriri Napier combines earthquake, tsunami and coastal flooding exposure on reclaimed and low-lying land."
  }
};

/* Basemap place names to suppress beyond the selectable cities. */
const HIDDEN_PLACE_NAMES = ["Hamilton"];

/* ------------------------------------------------------------
   Hazard GIS layers — every endpoint below was fetch-verified
   (keyless + CORS-enabled) against the live government service.
   `cities`: null = available everywhere; otherwise listed cities.
   `bboxQuery`: fetch only the current map view (big datasets).
   `paginate`: follow resultOffset pages until complete.
   ------------------------------------------------------------ */
const HAZARD_LAYERS = [
  {
    id: "flood-plains",
    label: "Flood plains (1% AEP)",
    hazard: "flood",
    cities: ["Auckland"],
    color: "#2f7fd4",
    fillOpacity: 0.42,
    // 2m generalization — 10m collapses Auckland's small urban flood polygons
    url: "https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/Flood_Plains/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID&f=geojson&resultRecordCount=2000&maxAllowableOffset=0.00002",
    bboxQuery: true,
    attribution: "Auckland Council Open Data",
    note: "Modelled 1-in-100-year floodplain extents (12,630 polygons region-wide, streamed for the visible area)."
  },
  {
    id: "coastal-inundation",
    label: "Coastal inundation 1% AEP",
    hazard: "coastal",
    cities: ["Auckland"],
    color: "#12a5a5",
    fillOpacity: 0.40,
    // 5m generalization max — coarser collapses the inner rings (islands).
    // Shape__Area filter drops the giant whole-gulf sea-surface polygons that
    // otherwise paint entire islands (largest legit shore strip << 100 km²).
    url: "https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/Coastal_Inundation_1_AEP/FeatureServer/0/query?where=Shape__Area%20%3C%20100000000&outFields=OBJECTID,SeaLevelRiseScenario&f=geojson&resultRecordCount=2000&maxAllowableOffset=0.00005",
    bboxQuery: true,
    attribution: "Auckland Council Open Data",
    note: "Storm-tide inundation extent at present-day sea level."
  },
  {
    id: "flood-prone",
    label: "Flood-prone areas",
    hazard: "flood",
    cities: ["Auckland"],
    color: "#e07a3a",   // burnt orange — must read differently from flood plains blue
    fillOpacity: 0.45,
    url: "https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/Flood_Prone_Areas/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID&f=geojson&resultRecordCount=2000&maxAllowableOffset=0.00002",
    bboxQuery: true,
    attribution: "Auckland Council Open Data",
    note: "Depressions that can pond in a 1% AEP event."
  },
  {
    id: "flood-sensitive",
    label: "Flood-sensitive areas",
    hazard: "flood",
    cities: ["Auckland"],
    color: "#8456c9",   // violet — distinct from flood blue and coastal teal
    fillOpacity: 0.40,
    url: "https://services1.arcgis.com/n4yPwebTjJCmXB6W/arcgis/rest/services/Flood_Sensitive_Areas/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID&f=geojson&resultRecordCount=2000&maxAllowableOffset=0.00002",
    bboxQuery: true,
    attribution: "Auckland Council Open Data",
    note: "Buffer within 0.5 m of the predicted 1% AEP flood level."
  },
  /* Overland flow paths — parked at Rino's request (2026-08-17). CBD-only
     polylines from Auckland Council Overland_Flow_Paths FeatureServer;
     restore with a bbox query + flyTo if wanted again. */
  {
    id: "wellington-flood",
    label: "Flood hazard (1% AEP)",
    hazard: "flood",
    cities: ["Wellington"],
    color: "#2f7fd4",
    fillOpacity: 0.42,
    url: "https://mapping.gw.govt.nz/arcgis/rest/services/GW/Flood_Hazards_Areas/MapServer/3/query?where=1%3D1&outFields=*&f=geojson&geometryPrecision=5&maxAllowableOffset=5",
    attribution: "Greater Wellington Regional Council",
    note: "Regional 1% AEP river flood extents (12 modelled rivers)."
  },
  {
    id: "chch-liquefaction",
    label: "Liquefaction vulnerability",
    hazard: "earthquake",
    cities: ["Christchurch"],
    color: "#a05cc4",
    fillOpacity: 0.40,
    url: "https://gis.ccc.govt.nz/server/rest/services/OpenData/LandCharacteristic/FeatureServer/36/query?where=1%3D1&outFields=*&f=geojson&geometryPrecision=5",
    attribution: "Christchurch City Council",
    note: "Liquefaction vulnerability categories (600 polygons)."
  },
  {
    id: "napier-coastal-flood",
    label: "Extreme coastal flood 1% AEP",
    hazard: "coastal",
    cities: ["Napier"],
    color: "#12a5a5",
    fillOpacity: 0.40,
    url: "https://services2.arcgis.com/7JQlcKNp5LMGHstx/arcgis/rest/services/CoastalFlooding_layer1/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=2000&maxAllowableOffset=0.00005",
    bboxQuery: true,
    attribution: "MfE / NIWA",
    note: "National extreme sea-level flooding, 1% AEP with +10 cm sea-level rise."
  },
  {
    id: "dunedin-coastal",
    label: "Coastal hazard (storm surge)",
    hazard: "coastal",
    cities: ["Dunedin"],
    color: "#12a5a5",
    fillOpacity: 0.40,
    url: "https://services6.arcgis.com/ALxeDxaeNjQo1Mf0/arcgis/rest/services/General_Coastal_Hazard_Dunedin_City/FeatureServer/16/query?where=1%3D1&outFields=*&f=geojson",
    attribution: "Dunedin City Council / ORC",
    note: "Land below 1-in-100-year storm surge level (South Dunedin, Harbourside)."
  },
  {
    id: "dunedin-flood",
    label: "Urban stream flood hazard",
    hazard: "flood",
    cities: ["Dunedin"],
    color: "#2f7fd4",
    fillOpacity: 0.42,
    url: "https://services6.arcgis.com/ALxeDxaeNjQo1Mf0/arcgis/rest/services/Flood_Hazard_Dunedin_Urban_Streams_2GP/FeatureServer/5/query?where=1%3D1&outFields=*&f=geojson",
    attribution: "Dunedin City Council",
    note: "Water of Leith, Lindsay Creek and Kaikorai floodplains."
  },
  /* Tsunami evacuation zones — parked for now at Rino's request (2026-08-16).
     Verified working NEMA endpoint + class styling; re-add by restoring this entry:
     id "tsunami-zones", url
     https://services5.arcgis.com/cJn6oR1QqErYBL5d/arcgis/rest/services/Aotearoa_Tsunami_Evac_Zones/FeatureServer/117/query
     with where=Zones IN ('Red','Orange','Yellow'), paginate, match-colour by Zones. */
  {
    id: "active-faults",
    label: "Active faults",
    hazard: "earthquake",
    cities: null,
    color: "#d4442f",
    lineWidth: 2,
    geometry: "line",
    url: "https://gis.gns.cri.nz/server/rest/services/Active_Faults/NZActiveFaults250K/MapServer/0/query?where=1%3D1&outFields=name&outSR=4326&f=geojson&resultRecordCount=2000",
    paginate: true,
    prefetch: true,
    attribution: "GNS Science Active Faults Database",
    note: "10,281 mapped active fault traces (1:250k national database)."
  },
  {
    id: "recent-quakes",
    label: "Recent earthquakes (live)",
    hazard: "earthquake",
    cities: null,
    color: "#ffb321",
    geometry: "circle",
    url: "https://api.geonet.org.nz/quake?MMI=3",
    fetchHeaders: { "Accept": "application/vnd.geo+json;version=2" },
    prefetch: true,
    live: true,
    attribution: "GeoNet",
    note: "Live GeoNet feed — earthquakes of MMI 3+ in the last year.",
    popupHTML: (p) => `<b>M ${p.magnitude?.toFixed(1) ?? "?"}</b> — ${p.locality ?? ""}<br>` +
      (p.time ? new Date(p.time).toLocaleDateString("en-NZ") : "")
  },
  {
    id: "volcano-alerts",
    label: "Volcano alerts (live)",
    hazard: "volcanic",
    cities: null,
    color: "#8e44ad",
    geometry: "circle",
    radiusExpr: ["interpolate", ["linear"], ["coalesce", ["get", "level"], 0],
      0, 6, 1, 9, 2, 13, 3, 17, 5, 26],
    url: "https://api.geonet.org.nz/volcano/val",
    fetchHeaders: { "Accept": "application/vnd.geo+json;version=2" },
    prefetch: true,
    live: true,
    attribution: "GeoNet",
    note: "Live GeoNet volcanic alert levels for all monitored NZ volcanoes and fields.",
    popupHTML: (p) => `<b>${p.volcanoTitle ?? "Volcano"}</b><br>Alert level ${p.level ?? 0}<br>` +
      `<span style="font-size:11px">${p.acc ?? ""}</span>`
  }
];

/* ------------------------------------------------------------
   Sea-level-rise scenarios — Auckland only: swaps between the
   council's separate SLR datasets.
   ------------------------------------------------------------ */
const SLR_STOPS = [0, 0.5, 1, 2];

const SLR_CONFIG = {
  "Auckland": {
    layerId: "coastal-inundation",
    dataKeys: {
      0: "coastal-inundation__Auckland",
      0.5: "coastal-slr05__Auckland",
      1: "coastal-slr1__Auckland",
      2: "coastal-slr2__Auckland"
    }
  }
};

/* One-click stakeholder weighting profiles. */
const WEIGHT_PRESETS = {
  "Council": { economic: 35, technical: 35, environmental: 15, social: 15 },
  "Community": { economic: 20, technical: 20, environmental: 25, social: 35 },
  "Investor": { economic: 45, technical: 25, environmental: 15, social: 15 },
  "Balanced": { economic: 25, technical: 25, environmental: 25, social: 25 }
};

/* Headline hazard layer shown for each stop of the auto-tour. */
const TOUR_LAYERS = {
  "Auckland": "flood-plains",
  "Wellington": "wellington-flood",
  "Christchurch": "chch-liquefaction",
  "Dunedin": "dunedin-coastal",
  "Napier": "napier-coastal-flood"
};
