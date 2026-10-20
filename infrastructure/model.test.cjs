const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('./model.js');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname + '/pathways.js', 'utf8') + '\nthis.pathways = PATHWAYS; this.weights = DEFAULT_WEIGHTS;', context);
const pathway = { id: 'reference', capex: 10, annualMaintenance: 1,
  annualBenefits: { repairs: 1, continuity: 1, environmental: 1, community: 1 },
  scores: { technical: 70, environmental: 80, social: 90 } };
const scenario = { units: 1, years: 10, discount: 0, budget: 10 };
const [zero] = Model.evaluate([pathway], scenario, context.weights);
assert.equal(zero.capital, 10);
assert.equal(zero.costPV, 20);
assert.equal(zero.benefits, 40);
assert.equal(zero.bcr, 2);
assert.equal(zero.npv, 20);
assert.equal(zero.affordable, true);
assert.equal(zero.score, 75);
assert.equal(zero.carbon, null);
const [discounted] = Model.evaluate([pathway], { ...scenario, discount: 5 }, context.weights);
assert.ok(Math.abs(discounted.costPV - 17.721734929184818) < 1e-10);
assert.ok(Math.abs(discounted.benefits - 30.88693971673927) < 1e-10);
const [doubled] = Model.evaluate([pathway], { ...scenario, units: 2 }, context.weights);
assert.equal(doubled.costPV, zero.costPV * 2);
assert.equal(doubled.benefits, zero.benefits * 2);
assert.equal(doubled.bcr, zero.bcr);
assert.equal(doubled.score, zero.score);
assert.equal(doubled.affordable, false);
assert.equal(Model.annuity(30, 0), 30);
assert.ok(Math.abs(Model.annuity(30, 1e-10) - 30) < 1e-6);
assert.throws(() => Model.evaluate([pathway], { ...scenario, discount: -1 }, context.weights));
assert.throws(() => Model.evaluate([pathway], { ...scenario, units: NaN }, context.weights));
assert.throws(() => Model.evaluate([pathway], scenario, { economic: 0, technical: 0, social: 0, environmental: 0 }));
const ids = new Set();
for (const [sector, alternatives] of Object.entries(context.pathways)) {
  assert.equal(alternatives.length, sector === 'Roads and highways' ? 6 : 4);
  const results = Model.evaluate(alternatives, Model.defaults, context.weights);
  for (const p of results) {
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    assert.ok(p.capital > 0 && p.costPV >= p.capital && p.bcr > 0);
    assert.ok(p.score >= 0 && p.score <= 100, sector);
    assert.ok(Math.abs(Object.values(p.benefitPV).reduce((a, b) => a + b, 0) - p.benefits) < 1e-9);
    if (sector === 'Roads and highways') {
      assert.equal(p.sequence.length, 3);
      assert.ok(p.scope && p.trigger);
      assert.ok(p.carbon.upfront > 0);
      assert.equal(p.carbon.net, p.carbon.gross - p.carbon.avoided);
    } else assert.equal(p.carbon, null);
  }
  assert.ok(results.every((p, i) => i === 0 || p.score <= results[i - 1].score));
}
const road = context.pathways['Roads and highways'].find(p => p.id === 'road-drainage');
const [carbon30] = Model.evaluate([road], Model.defaults, context.weights);
assert.equal(carbon30.carbon.upfront, 1200);
assert.equal(carbon30.carbon.maintenance, 540);
assert.equal(carbon30.carbon.gross, 1740);
assert.equal(carbon30.carbon.avoided, 2400);
assert.equal(carbon30.carbon.net, -660);
const [carbon2] = Model.evaluate([road], { ...Model.defaults, units: 2 }, context.weights);
assert.equal(carbon2.carbon.net, -1320);
const [carbon10] = Model.evaluate([road], { ...Model.defaults, years: 10 }, context.weights);
assert.equal(carbon10.carbon.net, 580);
const [carbonZeroDiscount] = Model.evaluate([road], { ...Model.defaults, discount: 0 }, context.weights);
assert.deepEqual(carbonZeroDiscount.carbon, carbon30.carbon);
const [changedCarbon] = Model.evaluate([{ ...road, carbon: { ...road.carbon, avoidedAnnual: 1000 } }], Model.defaults, context.weights);
assert.equal(changedCarbon.score, carbon30.score);
assert.equal(changedCarbon.bcr, carbon30.bcr);
assert.equal(changedCarbon.npv, carbon30.npv);
// Test real GeoJSON validation against malformed coordinates and supported geometries.
const source = fs.readFileSync(__dirname + '/network.part.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function validateNetworkGeoJSON'), source.indexOf('$("#networkFile")')) + '\nthis.validate = validateNetworkGeoJSON;', context);
const feature = geometry => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: { name: '<script>test</script>' } }] });
assert.equal(context.validate(feature({ type: 'Point', coordinates: [174.7, -36.8] })).features.length, 1);
assert.equal(context.validate(feature({ type: 'LineString', coordinates: [[174, -36], [175, -37]] })).features.length, 1);
assert.equal(context.validate(feature({ type: 'Polygon', coordinates: [[[174, -36], [175, -36], [175, -37], [174, -36]]] })).features.length, 1);
assert.throws(() => context.validate(feature({ type: 'Point', coordinates: [1740000, 5600000] })));
assert.throws(() => context.validate(feature({ type: 'LineString', coordinates: [[174, -36]] })));
assert.throws(() => context.validate(feature({ type: 'Point', coordinates: ['174', -36] })));
assert.throws(() => context.validate({ type: 'FeatureCollection', features: [] }));
console.log('Passed: cash flows, budgets, rankings, 14 pathways, road scopes / steps, carbon boundaries / scaling and GeoJSON validation.');
