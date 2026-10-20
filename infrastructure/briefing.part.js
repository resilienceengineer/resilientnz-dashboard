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
