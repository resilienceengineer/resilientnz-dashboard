# Infrastructure Pathways Explorer

A separate infrastructure prototype of Resilient Aotearoa NZ, using realistic example quantities and financial assumptions alongside existing network mapping. Roads use the original OpenStreetMap overlay; the populated utility demo focuses on Auckland with public Watercare and Transpower geometry. The website's main entry opens this edition. The original dashboard is preserved at `../original.html` with its original application files in the parent folder.

Open `index.html` directly, or run `node infrastructure/serve.cjs` from the project root and visit <http://127.0.0.1:8017/infrastructure/>. Keep this folder inside the project: it reuses the parent's styles, hazard snapshots and data bundle. Internet is needed for the map library, basemap, terrain, fonts, address search and live GeoNet feeds.

## Scope and inspection findings

The original is a standalone HTML/CSS/JavaScript app using MapLibre, OpenStreetMap and bundled official hazard snapshots. It offers residential, strategic-building and generic infrastructure pathways. Its costs, BCRs, resilience gains and MCDA scores are fixed demo values with illustrative city adjustments. The infrastructure overlay contains major roads, rail and bridges; it has no water or electricity inventory. The exposure readout is disabled in the original.

This edition offers six road/highway pathways and four alternatives each for water/wastewater and power infrastructure. Residential, school, hospital, strategic-building and rail investment options are excluded. City map navigation, hazards, Auckland sea-level scenarios, priority weights, a local scripted guide and printable briefings are retained. A selected sector persists while navigating. The original 3D building overlay is excluded.

## Road resilience pathways

The road section compares flood-resilient drainage and pavement; slope stabilisation and rockfall protection; bridge strengthening and scour protection; detour resilience and emergency access; raising flood-prone road sections; and coastal realignment. Each has explicit illustrative treatment quantities for priority sites along a 10 km corridor, three decision steps, a review trigger, residual risks and tradeoffs. A detour or realignment package states the length of the additional or replacement section separately.

These packages address different hazards and are not equivalent complete protections. They can be compared as corridor strategies; combinations require a separately appraised package rather than adding benefits mechanically. The financial model prices the stated delivered package at year 0. Subsequent trigger-led expansions are not priced, and the decision steps do not impose a timed cash-flow schedule.

Treatment categories are informed by [NZTA's Crown Resilience Programme examples](https://www.nzta.govt.nz/partners/planning-and-investment/crown-resilience-programme) and the transport adaptation options in [Tiro Rangi](https://www.nzta.govt.nz/assets/resources/tiro-rangi-our-climate-adaptation-plan-2022-2024/tiro-rangi-our-climate-adaptation-plan-20222024.pdf). Those references support intervention types only. All quantities, costs, benefits, carbon inputs, scores and assumed effectiveness in this app are invented for illustration, not taken from those publications.

## Illustrative road carbon

Each road card shows appraisal-period net carbon in tonnes of CO₂ equivalent; expand it for construction/material emissions, additional annual maintenance emissions and annual avoided detour/repair emissions. All components scale with packages. Physical tonnes are **not discounted**:

`net carbon = construction + years × additional annual maintenance − years × avoided annual detour/repair emissions`

A negative result means an assumed reduction relative to no investment; a positive result means an assumed increase. The inventory covers the stated delivered package only. Routine traffic, induced demand, end-of-life emissions, sequestration and future trigger-led works are excluded. This is an illustrative appraisal-period comparison, not a complete lifecycle assessment or verified carbon credit. Carbon is not monetised in B/C, and changing its displayed inventory does not recalculate the illustrative environmental score. Road monetised environmental benefits represent runoff/ecosystem benefits and exclude carbon valuation.

[NZTA infrastructure carbon research](https://www.nzta.govt.nz/resources/research/reports/720) provides the context for separating construction, maintenance and use emissions; it is not the source of the invented numbers here. Other sectors have no carbon inventory and are not treated as zero-emission.

## Calculations and assumptions

`pathways.js` defines illustrative engineering packages, upfront capital, annual maintenance, four independently valued annual benefit categories, three non-economic scores and assumed disruption reductions. All money is constant NZ$ millions. No values are validated engineering estimates.

The common scenario controls scale packages, appraisal years, real discount rate and the total capital budget. Each package represents a fixed scope stated below the sector selector. Scope and inputs should be replaced for the project being assessed. A no-investment baseline has zero incremental cost and benefit; benefit assumptions represent avoided damage and disruption relative to that baseline.

- Present-value factor: `(1 - (1 + r)^(-n)) / r`; at zero discount it is `n`.
- Lifecycle cost: scaled capital + present value of annual maintenance.
- Benefit PV: present value of avoided repairs, service continuity, environmental and community benefits.
- BCR: benefit PV / lifecycle cost. NPV: benefit PV − lifecycle cost.
- Economic score: `100 * BCR / (1 + BCR)`; BCR 1 gives score 50.
- Overall score: weighted mean of economic, service-resilience, environmental and community/equity scores, normalised to 100. The budget flags affordability; it does not filter or rerank alternatives.

Capital is paid at year 0. Maintenance and benefits are uniform at each year end. There are no replacement cycles, residual values, escalation, later adaptation phases or learning effects. Appraisal life must match the intervention; engineering scores and disruption reductions remain illustrative when financial assumptions change. Linear package scaling assumes no economies of scale.

Location, hazard toggles and sea-level scenarios only change map context. They do not change assumed damages, costs, benefits or scores: that requires asset inventories, event likelihoods, fragility and service-outage modelling. Arbitrary city score nudges have been removed. Monetary benefit categories need independent valuation to prevent double counting. MCDA is a preference index whose dimensions can overlap.

The shortlist permits one alternative per sector. It retains the chosen location as context and updates all selections with the common scenario and current weights. It sums capital for budget comparison only; it does not sum sector benefits, optimise networks, or model cascading failures and dependencies. Selections and imported networks are session-local. The printed briefing records the current scenario, rankings, benefit assumptions and shortlist.

## Map inventories

Roads and highways use the existing OpenStreetMap transportation layer, including main roads and road bridges. The invented road corridors, labelled sample sites and schematic utility loops have been removed.

The Auckland water sample uses [Watercare's public GIS](https://www.watercare.co.nz/builders-and-developers/tools-fees-and-resources/gis-maps): operating water mains at least 300 mm and wastewater mains at least 450 mm, plus pumps, reservoirs and treatment facilities. Watercare Services Limited data are licensed CC BY 4.0, as stated on that source page. Facility polygons are represented by small centre-point markers; pipe geometry is clipped and rounded for the prototype. The sample contains 7,238 water-main sections, 4,629 wastewater-main sections and 504 facility features.

The Auckland power sample uses [Transpower's public transmission mapping](https://www.transpower.co.nz/our-work/industry/our-grid/maps-and-gis-data): 32 transmission-line features and 20 sites. Voltage shown in popups is the source design voltage. This is transmission context, not a complete local distribution grid. It is not supplemented with invented feeders, batteries or generators.

Utility overlays use thin desaturated lines, small site markers and labels only at close zoom; detailed pump markers appear as the user zooms in. Other cities retain map/hazard exploration and the prototype decision model, but do not contain fabricated utility networks. **Explore Auckland demo** opens the populated utility context; **Frame network** fits the selected mapping. Selecting the Auckland power sample automatically frames the transmission extent so the broader network is visible. Links from mapped assets to pathways demonstrate the workflow and do not calibrate financial results.

`network_data.js` bundles both snapshots for direct `file://` use. The GeoJSON exports and dated source/processing manifest are in `data/auckland-water.geojson`, `data/auckland-power.geojson` and `data/network-sources.json`. Refresh with `node infrastructure/fetch_network_data.cjs --refresh` when desired; a normal run can reuse download caches. All acquisition endpoints are public, with no credentials.

Optionally expand **Use research mapping** and import a `.geojson` or `.json` FeatureCollection for the selected sector to replace the default mapping. Coordinates must be WGS84 longitude/latitude. Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon are supported. Optional `name` and `asset_type` properties appear in map popups; other properties are discarded. Imports are local to the browser session, with limits of 25 MB and 20,000 features. **Restore default mapping** removes the import. Importing does not change model inputs or compute exposure.

## Development and checks

`model.js` contains the independent discounted-cost and ranking model. Run `node infrastructure/model.test.cjs` for calculation and input-validation checks.

`build-variant.cjs` reconstructs `app.js`, `data.js` and `index.html` from the parent app, the original page template at `../original.html` and the `*.part.js` modules. It assigns content-based versions to local script and stylesheet URLs. Edit those modules and rebuild with `node infrastructure/build-variant.cjs`; edit `pathways.js`, `model.js` and this folder's CSS directly. No package installation or build tooling is required to run the dashboard.
