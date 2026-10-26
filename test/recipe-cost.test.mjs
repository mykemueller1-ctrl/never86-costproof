import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRecipeCost, getRecipeFixture, RECIPE_SCOPE } from '../src/recipe-cost.mjs';
import { EvidenceError } from '../src/reconcile.mjs';

const byIngredient = (result, name) => result.line_bridge.find(row => row.ingredient_id === 'ingredient-' + name);
const code = expected => error => error instanceof EvidenceError && error.code === expected;

test('four explicit fictional source families reconcile $1.96 to $2.40 and keep invoice dates distinct', async () => {
  const records = await getRecipeFixture();
  const result = analyzeRecipeCost(records);
  assert.equal(result.status, 'reconciled');
  assert.deepEqual(result.metrics, { portions: 1, baseline_recipe_cost_cents: 196, current_recipe_cost_cents: 240, recipe_cost_delta_cents: 44,
    baseline_portion_cost_cents: 196, current_portion_cost_cents: 240, portion_cost_delta_cents: 44,
    baseline_food_cost_percent: 19.6, current_food_cost_percent: 24, menu_price_cents: 1000,
    baseline_gross_food_contribution_cents: 804, current_gross_food_contribution_cents: 760 });
  assert.deepEqual(result.line_bridge.map(row => [row.ingredient_id, row.baseline_line_cost_cents, row.current_line_cost_cents, row.delta_cents]), [
    ['ingredient-chicken', 120, 150, 30], ['ingredient-cheese', 24, 30, 6], ['ingredient-tortilla', 40, 48, 8], ['ingredient-sauce', 12, 12, 0]
  ]);
  const chicken = byIngredient(result, 'chicken');
  assert.equal(chicken.baseline_purchase_basis.invoice_date, '2026-10-16');
  assert.equal(chicken.current_purchase_basis.invoice_date, '2026-10-23');
  assert.equal(chicken.baseline_purchase_basis.comparison_business_date, '2026-10-23');
  assert.ok(chicken.source_ids.includes('price-chicken-baseline'));
  assert.ok(chicken.source_ids.includes('mapping-chicken-v1'));
  assert.equal(new Set(result.evidence.map(row => row.id)).size, result.evidence.length);
  assert.equal(result.rounding.delta_bridge_rounding_adjustment_cents, 0);
  assert.equal(result.integration.model_verified, false);
  assert.equal(result.integration.sponsor_integration_verified, false);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('yield converts edible recipe quantity back to its actual purchase basis', async () => {
  const records = await getRecipeFixture();
  records.ingredient_map.records[0].yield_basis_points = 10000;
  const result = analyzeRecipeCost(records), chicken = byIngredient(result, 'chicken');
  assert.equal(chicken.baseline_line_cost_cents, 90);
  assert.equal(chicken.current_line_cost_cents, 113);
  assert.deepEqual(chicken.current_unrounded_cents, { numerator: '225', denominator: '2' });
});

test('missing, zero and invalid yields hold the full financial answer instead of assuming 100%', async () => {
  for (const value of [null, undefined, 0, -1, 10001, 12.5, '7500']) {
    const records = await getRecipeFixture();
    records.ingredient_map.records[0].yield_basis_points = value;
    const result = analyzeRecipeCost(records);
    assert.equal(result.status, 'needs_evidence');
    assert.equal(result.metrics, null);
    assert.deepEqual(result.line_bridge, []);
    assert.ok(result.missing_evidence.some(row => row.code === 'USABLE_YIELD_REQUIRED'));
  }
});

test('unchanged case price with fewer contents is normalized, not mistaken for unchanged unit cost', async () => {
  const result = analyzeRecipeCost(await getRecipeFixture('pack-change')), chicken = byIngredient(result, 'chicken');
  assert.equal(result.status, 'reconciled');
  assert.equal(chicken.baseline_purchase_basis.purchase_cost_cents, 6000);
  assert.equal(chicken.current_purchase_basis.purchase_cost_cents, 6000);
  assert.equal(chicken.baseline_purchase_basis.normalized_quantity, '10000');
  assert.equal(chicken.current_purchase_basis.normalized_quantity, '8000');
  assert.equal(chicken.same_case_price_changed_contents, true);
  assert.equal(chicken.purchase_pack_changed, true);
  assert.equal(chicken.baseline_line_cost_cents, 120);
  assert.equal(chicken.current_line_cost_cents, 150);
  assert.deepEqual(chicken.current_purchase_basis.price_per_base_unit_cents_exact, { numerator: '3', denominator: '4' });
});

test('unknown purchase pack contents hold the answer', async () => {
  for (const missingKey of ['pack_quantity', 'pack_unit']) {
    const records = await getRecipeFixture();
    delete records.prices.records[1][missingKey];
    const result = analyzeRecipeCost(records);
    assert.equal(result.status, 'needs_evidence'); assert.equal(result.metrics, null);
    assert.ok(result.missing_evidence.some(row => row.code === 'PURCHASE_PACK_REQUIRED'));
  }
});

test('a missing ingredient price cannot produce a partial whole-recipe answer', async () => {
  const result = analyzeRecipeCost(await getRecipeFixture('missing-ingredient'));
  assert.equal(result.status, 'needs_evidence'); assert.equal(result.metrics, null);
  assert.ok(result.missing_evidence.some(row => row.ingredient_id === 'ingredient-cheese' && row.code === 'INGREDIENT_PRICE_REQUIRED'));
  const missingFamily = await getRecipeFixture(); delete missingFamily.menu;
  assert.equal(analyzeRecipeCost(missingFamily).status, 'needs_evidence');
});

test('exact kg/g and l/ml conversions preserve cost, while mass/volume/each mismatches refuse', async () => {
  const records = await getRecipeFixture();
  for (const row of records.prices.records) {
    if (row.sku_id === 'sku-chicken') { row.pack_quantity = 10; row.pack_unit = 'kg'; }
    if (row.sku_id === 'sku-sauce') { row.pack_quantity = 3; row.pack_unit = 'l'; }
  }
  assert.equal(analyzeRecipeCost(records).metrics.current_portion_cost_cents, 240);
  for (const unsupported of ['ml', 'each']) {
    const bad = await getRecipeFixture(); bad.prices.records[1].pack_unit = unsupported;
    assert.throws(() => analyzeRecipeCost(bad), code('RECIPE_UNIT_BASIS_MISMATCH'));
  }
  const unknown = await getRecipeFixture(); unknown.prices.records[1].pack_unit = 'case';
  assert.throws(() => analyzeRecipeCost(unknown), code('RECIPE_UNIT_UNSUPPORTED'));
});

test('restaurant, comparison date and currency scope mismatches are refusals', async () => {
  for (const [field, value] of [['restaurant_id', 'other'], ['business_date', '2026-10-24'], ['currency', 'EUR']]) {
    const records = await getRecipeFixture(); records.prices.records[1][field] = value;
    assert.throws(() => analyzeRecipeCost(records), code('RECIPE_SCOPE_MISMATCH'));
  }
  const wrongLocation = await getRecipeFixture('wrong-location');
  assert.throws(() => analyzeRecipeCost(wrongLocation), code('RECIPE_SCOPE_MISMATCH'));
  const clean = await getRecipeFixture();
  assert.throws(() => analyzeRecipeCost(clean, { ...RECIPE_SCOPE, id: 'injected-evidence-id' }), code('RECIPE_SCOPE_INVALID'));
});

test('vendor SKU mismatches cannot silently substitute the approved ingredient', async () => {
  const records = await getRecipeFixture(); records.prices.records[1].vendor_sku = 'SYN-SUBSTITUTE';
  assert.throws(() => analyzeRecipeCost(records), code('RECIPE_VENDOR_SKU_MISMATCH'));
  const missing = await getRecipeFixture(); missing.ingredient_map.records[0].sku_id = 'sku-near-match';
  assert.equal(analyzeRecipeCost(missing).status, 'needs_evidence');
});

test('duplicate source IDs, duplicate selected prices and duplicate ingredient mappings are refused', async () => {
  const ids = await getRecipeFixture(); ids.prices.records[1].id = ids.prices.records[0].id;
  assert.throws(() => analyzeRecipeCost(ids), code('RECIPE_DUPLICATE_SOURCE'));
  const prices = await getRecipeFixture(); prices.prices.records.push({ ...prices.prices.records[0], id: 'duplicate-selected-price' });
  assert.throws(() => analyzeRecipeCost(prices), code('RECIPE_DUPLICATE_SKU_PRICE'));
  const map = await getRecipeFixture(); map.ingredient_map.records.push({ ...map.ingredient_map.records[0], id: 'duplicate-selected-map' });
  assert.throws(() => analyzeRecipeCost(map), code('RECIPE_DUPLICATE_INGREDIENT_MAP'));
  const bom = await getRecipeFixture(); bom.recipe.records.push({ ...bom.recipe.records[0], id: 'duplicate-bom-line' });
  assert.throws(() => analyzeRecipeCost(bom), code('RECIPE_DUPLICATE_INGREDIENT'));
});

test('recipe version mismatch and ingredients outside the approved recipe are refused', async () => {
  const version = await getRecipeFixture(); version.menu.recipe_version = 'recipe-v2';
  assert.throws(() => analyzeRecipeCost(version), code('RECIPE_VERSION_MISMATCH'));
  const extra = await getRecipeFixture(); extra.ingredient_map.records[0].ingredient_id = 'ingredient-unapproved';
  assert.throws(() => analyzeRecipeCost(extra), code('RECIPE_INGREDIENT_MISMATCH'));
  const unapproved = await getRecipeFixture(); unapproved.ingredient_map.approval_status = 'draft';
  assert.equal(analyzeRecipeCost(unapproved).status, 'needs_evidence');
});

test('recipe totals aggregate exact fractions before rounding and disclose a tiny line-bridge adjustment', async () => {
  const records = await getRecipeFixture();
  records.recipe.records = records.recipe.records.slice(0, 3);
  records.ingredient_map.records = records.ingredient_map.records.slice(0, 3);
  records.prices.records = records.prices.records.filter(row => row.sku_id !== 'sku-sauce');
  for (const line of records.recipe.records) { line.usable_quantity = 1; line.usable_unit = 'g'; }
  for (const row of records.ingredient_map.records) row.yield_basis_points = 10000;
  for (const row of records.prices.records) { row.pack_quantity = 5; row.pack_unit = 'g'; row.purchase_cost_cents = row.period === 'baseline' ? 2 : 3; }
  const result = analyzeRecipeCost(records);
  assert.equal(result.metrics.baseline_recipe_cost_cents, 1);
  assert.equal(result.metrics.current_recipe_cost_cents, 2);
  assert.equal(result.metrics.recipe_cost_delta_cents, 1);
  assert.equal(result.rounding.baseline_line_rounding_adjustment_cents, 1);
  assert.equal(result.rounding.current_line_rounding_adjustment_cents, -1);
  assert.equal(result.rounding.delta_bridge_rounding_adjustment_cents, -2);
  assert.deepEqual(result.rounding.baseline_recipe_unrounded_cents, { numerator: '6', denominator: '5' });
  assert.deepEqual(result.rounding.current_recipe_unrounded_cents, { numerator: '9', denominator: '5' });
  assert.equal(result.line_bridge.reduce((sum, row) => sum + row.delta_cents, 0) + result.rounding.delta_bridge_rounding_adjustment_cents, result.metrics.recipe_cost_delta_cents);
});

test('multi-portion recipes keep whole-batch and per-serving bridge amounts distinct', async () => {
  const records = await getRecipeFixture(); records.recipe.portions = 4;
  const result = analyzeRecipeCost(records), chicken = byIngredient(result, 'chicken');
  assert.equal(result.metrics.current_recipe_cost_cents, 240);
  assert.equal(result.metrics.current_portion_cost_cents, 60);
  assert.equal(result.metrics.portion_cost_delta_cents, 11);
  assert.equal(chicken.delta_cents, 30);
  assert.equal(chicken.portion_delta_cents, 8);
  assert.equal(result.rounding.portion_delta_bridge_rounding_adjustment_cents, -1);
  assert.equal(result.metrics.current_food_cost_percent, 6);
});

test('zero, absent, noninteger and tax-inclusive menu prices hold percentages and contribution', async () => {
  for (const price of [0, -1, null, undefined, 10.5, '1000', Number.MAX_SAFE_INTEGER + 1]) {
    const records = await getRecipeFixture(); records.menu.price_cents = price;
    const result = analyzeRecipeCost(records);
    assert.equal(result.status, 'needs_evidence'); assert.equal(result.metrics, null);
    assert.ok(result.missing_evidence.some(row => row.code === 'MENU_PRICE_REQUIRED'));
  }
  const tax = await getRecipeFixture(); tax.menu.price_excludes_tax = false;
  assert.equal(analyzeRecipeCost(tax).status, 'needs_evidence');
});

test('purchase cost rejects unsafe or negative cents and BigInt calculations refuse unsafe final output', async () => {
  for (const price of [-1, 10.2, Number.MAX_SAFE_INTEGER + 1]) {
    const records = await getRecipeFixture(); records.prices.records[1].purchase_cost_cents = price;
    assert.throws(() => analyzeRecipeCost(records), code('RECIPE_PRICE_INVALID'));
  }
  const huge = await getRecipeFixture();
  huge.prices.records[1].purchase_cost_cents = Number.MAX_SAFE_INTEGER;
  huge.prices.records[1].pack_quantity = 1;
  huge.recipe.records[0].usable_quantity = Number.MAX_SAFE_INTEGER;
  assert.throws(() => analyzeRecipeCost(huge), code('RECIPE_OVERFLOW'));
});

test('invoice line provenance, date and explicit price exclusions are required', async () => {
  for (const field of ['invoice_id', 'invoice_line_id', 'invoice_date']) {
    const records = await getRecipeFixture(); delete records.prices.records[1][field];
    assert.throws(() => analyzeRecipeCost(records), code('RECIPE_INVOICE_PROVENANCE'));
  }
  const future = await getRecipeFixture(); future.prices.records[1].invoice_date = '2026-10-24';
  assert.throws(() => analyzeRecipeCost(future), code('RECIPE_INVOICE_DATE'));
  const impossible = await getRecipeFixture(); impossible.prices.records[1].invoice_date = '2026-02-30';
  assert.throws(() => analyzeRecipeCost(impossible), code('RECIPE_INVOICE_PROVENANCE'));
  const reversed = await getRecipeFixture(); reversed.prices.records[1].invoice_date = '2026-10-15';
  assert.throws(() => analyzeRecipeCost(reversed), code('RECIPE_INVOICE_DATE_ORDER'));
  const basis = await getRecipeFixture(); delete basis.prices.records[1].price_basis;
  assert.equal(analyzeRecipeCost(basis).status, 'needs_evidence');
});

test('zero-cost invoice lines are valid, negative food-only contribution is allowed and costs are not profit', async () => {
  const records = await getRecipeFixture(); for (const row of records.prices.records) row.purchase_cost_cents = 0;
  const zero = analyzeRecipeCost(records);
  assert.equal(zero.metrics.current_portion_cost_cents, 0);
  assert.equal(zero.metrics.current_food_cost_percent, 0);
  assert.equal(zero.metrics.current_gross_food_contribution_cents, 1000);
  const lowMenu = await getRecipeFixture(); lowMenu.menu.price_cents = 100;
  const loss = analyzeRecipeCost(lowMenu);
  assert.equal(loss.metrics.current_food_cost_percent, 240);
  assert.equal(loss.metrics.current_gross_food_contribution_cents, -140);
  assert.ok(loss.limitations.some(value => value.includes('not actual COGS, prime cost or profit')));
});

test('fixture reads are independent and only named scenarios are permitted', async () => {
  const before = await getRecipeFixture(), next = await getRecipeFixture();
  before.prices.records[0].purchase_cost_cents = 1;
  assert.equal(next.prices.records[0].purchase_cost_cents, 6000);
  await assert.rejects(getRecipeFixture('invented-scenario'), code('RECIPE_SCENARIO_UNSUPPORTED'));
  assert.deepEqual(analyzeRecipeCost(next).scope, RECIPE_SCOPE);
});
