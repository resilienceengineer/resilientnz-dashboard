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
