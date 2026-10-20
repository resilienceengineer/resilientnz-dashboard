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
