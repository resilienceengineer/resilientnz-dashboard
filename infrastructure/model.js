/* Illustrative screening model. Currency: constant NZ$ millions; year 0 capex,
   uniform year-end operating costs and benefits; no residual value or escalation. */
const InfrastructureModel = (() => {
  const defaults = { units: 1, years: 30, discount: 4, budget: 20 };
  function annuity(years, rate) {
    return rate === 0 ? years : -Math.expm1(-years * Math.log1p(rate)) / rate;
  }
  function evaluate(pathways, scenario, weights) {
    const { units, years, discount, budget } = scenario;
    if (![units, years, discount, budget].every(Number.isFinite) || units <= 0 ||
        years < 1 || discount < 0 || budget < 0) throw new Error("Invalid scenario inputs");
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    if (!(total > 0) || Object.values(weights).some(v => !Number.isFinite(v) || v < 0))
      throw new Error("Priority weights must be non-negative with a positive total");
    const factor = annuity(years, discount / 100);
    return pathways.map(p => {
      const capital = p.capex * units;
      const maintenancePV = p.annualMaintenance * units * factor;
      const costPV = capital + maintenancePV;
      const benefitPV = Object.fromEntries(Object.entries(p.annualBenefits)
        .map(([k, v]) => [k, v * units * factor]));
      const benefits = Object.values(benefitPV).reduce((a, b) => a + b, 0);
      const bcr = benefits / costPV;
      const adj = { ...p.scores, economic: 100 * bcr / (1 + bcr) };
      const score = Object.keys(weights).reduce((sum, k) => sum + adj[k] * weights[k] / total, 0);
      // Physical tonnes are not discounted or monetised. Other sectors have no
      // carbon inventory yet, so use null rather than implying zero emissions.
      const carbon = p.carbon ? {
        upfront: p.carbon.upfront * units,
        maintenanceAnnual: p.carbon.maintenanceAnnual * units,
        avoidedAnnual: p.carbon.avoidedAnnual * units,
        maintenance: p.carbon.maintenanceAnnual * units * years,
        avoided: p.carbon.avoidedAnnual * units * years
      } : null;
      if (carbon) {
        carbon.gross = carbon.upfront + carbon.maintenance;
        carbon.net = carbon.gross - carbon.avoided;
      }
      return { ...p, capital, maintenancePV, costPV, benefitPV, benefits, bcr,
        npv: benefits - costPV, adj, carbon, score: +score.toFixed(1), affordable: capital <= budget + 1e-9 };
    }).sort((a, b) => b.score - a.score || b.npv - a.npv || a.id.localeCompare(b.id));
  }
  return { defaults, annuity, evaluate };
})();
if (typeof module !== "undefined") module.exports = InfrastructureModel;
