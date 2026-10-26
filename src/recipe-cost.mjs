import { readFile } from 'node:fs/promises';
import { EvidenceError } from './reconcile.mjs';

export const RECIPE_SCOPE = Object.freeze({ restaurant_id: 'demo-101', business_date: '2026-10-23', currency: 'USD' });
const CLASSIFICATION = 'SYNTHETIC_COMPETITION_FIXTURE';
const PRICE_BASIS = 'SELECTED_INVOICE_LINE_BEFORE_TAX_FREIGHT_CREDITS_DISCOUNTS';
const FAMILIES = ['prices', 'ingredient_map', 'recipe', 'menu'];
const SCOPE_KEYS = ['restaurant_id', 'business_date', 'currency'];
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const UNITS = Object.freeze({ g: ['g', 1n], kg: ['g', 1000n], ml: ['ml', 1n], l: ['ml', 1000n], each: ['each', 1n] });
const fail = (code, message, details = []) => { throw new EvidenceError(code, message, details); };
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
const whole = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const gcd = (a, b) => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a; };
function rational(n, d = 1n) {
  if (d <= 0n) fail('RECIPE_MATH_INVALID', 'A positive cost denominator is required');
  const divisor = gcd(n, d) || 1n;
  return { n: n / divisor, d: d / divisor };
}
const add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const ratioJSON = value => ({ numerator: value.n.toString(), denominator: value.d.toString() });
function safe(value) {
  if (value < -MAX_SAFE || value > MAX_SAFE) fail('RECIPE_OVERFLOW', 'The modeled amount exceeds the supported safe integer output range');
  return Number(value);
}
function rounded(value) {
  const negative = value.n < 0n, absolute = negative ? -value.n : value.n;
  const amount = (2n * absolute + value.d) / (2n * value.d);
  return safe(negative ? -amount : amount);
}
function normalized(quantity, unit) {
  if (!whole(quantity, 1)) fail('RECIPE_QUANTITY_INVALID', 'Quantities must be positive safe integers in the declared unit');
  if (!Object.hasOwn(UNITS, unit)) fail('RECIPE_UNIT_UNSUPPORTED', 'Only g, kg, ml, l and each have supported exact conversions');
  return { quantity: BigInt(quantity) * UNITS[unit][1], unit: UNITS[unit][0], original_quantity: quantity, original_unit: unit };
}
function assertRecord(row, scope, seen, family) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || !text(row.id)) fail('RECIPE_RECORD_INVALID', 'A uniquely identified ' + family + ' source record is required');
  if (seen.has(row.id)) fail('RECIPE_DUPLICATE_SOURCE', 'Source IDs must be globally unique', [row.id]);
  seen.add(row.id);
  if (row.classification !== CLASSIFICATION) fail('RECIPE_CLASSIFICATION', 'This workflow accepts labeled fictional competition records only', [row.id]);
  const mismatches = SCOPE_KEYS.filter(key => row[key] !== scope[key]);
  if (mismatches.length) fail('RECIPE_SCOPE_MISMATCH', 'Do not combine records from different restaurants, comparison dates or currencies', [row.id, ...mismatches]);
}
function priceBasis(row, mapping, missing) {
  if (!text(row.invoice_id) || !text(row.invoice_line_id) || !date(row.invoice_date)) fail('RECIPE_INVOICE_PROVENANCE', 'Each purchase price requires its original invoice ID, line ID and invoice date', [row.id]);
  if (row.invoice_date > row.business_date) fail('RECIPE_INVOICE_DATE', 'A future invoice cannot establish the selected comparison price', [row.id]);
  if (!text(row.vendor_id) || !text(row.vendor_sku) || row.vendor_id !== mapping.vendor_id || row.vendor_sku !== mapping.vendor_sku) fail('RECIPE_VENDOR_SKU_MISMATCH', 'The approved ingredient mapping must match the exact vendor and vendor SKU', [row.id, mapping.id]);
  if (row.price_basis !== PRICE_BASIS) {
    missing.push({ code: 'PURCHASE_PRICE_BASIS_REQUIRED', source_id: row.id, request: 'Declare the selected invoice line price basis and treatment of tax, freight, credits and discounts.' });
    return null;
  }
  if (!whole(row.purchase_cost_cents)) fail('RECIPE_PRICE_INVALID', 'Purchase price must be nonnegative safe integer cents', [row.id]);
  if (row.pack_quantity === null || row.pack_quantity === undefined || row.pack_unit === null || row.pack_unit === undefined || row.pack_unit === '') {
    missing.push({ code: 'PURCHASE_PACK_REQUIRED', source_id: row.id, request: 'Provide explicit purchase pack contents and unit for this invoice line.' });
    return null;
  }
  return normalized(row.pack_quantity, row.pack_unit);
}
const limitations = Object.freeze([
  'Fictional competition records only. These are not customer results.',
  'This is modeled ingredient cost divided by the tax-exclusive menu price, not actual COGS, prime cost or profit.',
  'Selected invoice line prices exclude tax, freight, credits and discounts. No allocation of those amounts is modeled.',
  'Food-only contribution excludes labor, overhead, payment fees, packaging and other operating costs.',
  'Approved SKU mappings, recipe portions and usable yields are supplied assumptions, not physical yield verification or proof of savings.',
  'This second workflow is deterministic. Model and sponsor execution for the recipe path are unverified.'
]);
const integration = Object.freeze({ mode: 'DETERMINISTIC_SYNTHETIC_RECIPE_WORKFLOW', model_verified: false, sponsor_integration_verified: false });

export function analyzeRecipeCost(records, scope = RECIPE_SCOPE) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).length !== SCOPE_KEYS.length || !SCOPE_KEYS.every(key => Object.hasOwn(scope, key) && text(scope[key])) || !date(scope.business_date) || !/^[A-Z]{3}$/.test(scope.currency)) fail('RECIPE_SCOPE_INVALID', 'Exactly a restaurant, ISO comparison date and three-letter currency are required');
  if (!records || typeof records !== 'object' || Array.isArray(records)) fail('RECIPE_RECORD_INVALID', 'Four explicit source families are required');
  const seen = new Set(), evidence = [], missing = [], trace = [];
  for (const family of FAMILIES) {
    const document = records[family];
    if (document === null || document === undefined) {
      missing.push({ code: 'SOURCE_FAMILY_REQUIRED', family, request: 'Provide the scoped ' + family + ' source.' });
      continue;
    }
    assertRecord(document, scope, seen, family);
    evidence.push({ id: document.id, family, classification: document.classification, ...scope });
    if (family !== 'menu') {
      if (!Array.isArray(document.records)) fail('RECIPE_RECORD_INVALID', family + ' must contain explicit records', [document.id]);
      for (const row of document.records) {
        assertRecord(row, scope, seen, family);
        evidence.push({ id: row.id, family, classification: row.classification, ...scope });
      }
    }
  }
  trace.push({ stage: 'source_scope_and_identifiers', status: 'validated', source_ids: evidence.map(row => row.id) });
  const held = () => ({ status: 'needs_evidence', scope: { ...scope }, metrics: null, line_bridge: [], evidence, missing_evidence: missing,
    trace: [...trace, { stage: 'coverage', status: 'held', request_codes: [...new Set(missing.map(item => item.code))] }], limitations: [...limitations], integration: { ...integration }, rounding: null });
  if (missing.length) return held();
  const { prices, ingredient_map: mapping, recipe, menu } = records;
  if (!text(recipe.recipe_id) || !text(recipe.version) || !whole(recipe.portions, 1) || recipe.records.length === 0) fail('RECIPE_VERSION_INVALID', 'A versioned recipe with positive portions and explicit ingredients is required');
  if (mapping.recipe_id !== recipe.recipe_id || mapping.recipe_version !== recipe.version || menu.recipe_id !== recipe.recipe_id || menu.recipe_version !== recipe.version) fail('RECIPE_VERSION_MISMATCH', 'Mapping and menu price must refer to the exact recipe version');
  if (mapping.approval_status !== 'approved' || !text(mapping.version)) missing.push({ code: 'APPROVED_MAPPING_REQUIRED', source_id: mapping.id, request: 'Provide an approved versioned ingredient-to-vendor-SKU map.' });
  if (!whole(menu.price_cents, 1) || menu.price_excludes_tax !== true) missing.push({ code: 'MENU_PRICE_REQUIRED', source_id: menu.id, request: 'Provide a positive safe integer menu price in cents, explicitly excluding tax.' });
  const priceRows = new Map();
  for (const row of prices.records) {
    if (!text(row.sku_id) || !['baseline', 'current'].includes(row.period)) fail('RECIPE_PRICE_IDENTITY', 'Each price must identify an exact SKU and baseline/current period', [row.id]);
    const key = row.sku_id + '\0' + row.period;
    if (priceRows.has(key)) fail('RECIPE_DUPLICATE_SKU_PRICE', 'Only one selected invoice price is allowed for each SKU and period', [row.id]);
    priceRows.set(key, row);
  }
  const mapRows = new Map();
  for (const row of mapping.records) {
    if (!text(row.ingredient_id) || !text(row.sku_id) || !text(row.vendor_id) || !text(row.vendor_sku)) fail('RECIPE_MAPPING_INVALID', 'An exact ingredient, SKU, vendor and vendor SKU are required', [row.id]);
    if (mapRows.has(row.ingredient_id)) fail('RECIPE_DUPLICATE_INGREDIENT_MAP', 'An ingredient cannot have multiple selected SKU mappings', [row.id]);
    mapRows.set(row.ingredient_id, row);
  }
  const ingredientIds = new Set(), prepared = [];
  for (const line of recipe.records) {
    if (!text(line.ingredient_id) || ingredientIds.has(line.ingredient_id)) fail('RECIPE_DUPLICATE_INGREDIENT', 'Each recipe ingredient must appear exactly once with its approved quantity', [line.id]);
    ingredientIds.add(line.ingredient_id);
    const selected = mapRows.get(line.ingredient_id);
    if (!selected) { missing.push({ code: 'INGREDIENT_MAPPING_REQUIRED', ingredient_id: line.ingredient_id, request: 'Provide an approved exact SKU mapping for this ingredient. No substitution was made.' }); continue; }
    const baseline = priceRows.get(selected.sku_id + '\0baseline'), current = priceRows.get(selected.sku_id + '\0current');
    if (!baseline || !current) { missing.push({ code: 'INGREDIENT_PRICE_REQUIRED', ingredient_id: line.ingredient_id, sku_id: selected.sku_id, request: 'Provide both selected invoice prices and purchase pack bases for this exact SKU.' }); continue; }
    if (!whole(selected.yield_basis_points, 1) || selected.yield_basis_points > 10000) {
      missing.push({ code: 'USABLE_YIELD_REQUIRED', ingredient_id: line.ingredient_id, source_id: selected.id, request: 'Provide the approved usable yield as 1 to 10000 basis points. Zero, missing or invalid yield cannot produce a cost.' });
    }
    const needed = normalized(line.usable_quantity, line.usable_unit);
    const before = priceBasis(baseline, selected, missing), after = priceBasis(current, selected, missing);
    if (baseline.invoice_date > current.invoice_date) fail('RECIPE_INVOICE_DATE_ORDER', 'The selected current invoice price cannot predate the baseline invoice price', [baseline.id, current.id]);
    if ((before && before.unit !== needed.unit) || (after && after.unit !== needed.unit)) fail('RECIPE_UNIT_BASIS_MISMATCH', 'Mass, volume and each cannot be interchanged without a supported explicit conversion; no density or substitution was inferred', [line.id, baseline.id, current.id]);
    if (before && after && whole(selected.yield_basis_points, 1) && selected.yield_basis_points <= 10000) prepared.push({ line, selected, baseline, current, needed, before, after });
  }
  for (const ingredientId of mapRows.keys()) if (!ingredientIds.has(ingredientId)) fail('RECIPE_INGREDIENT_MISMATCH', 'The approved map contains an ingredient outside this recipe version', [ingredientId]);
  trace.push({ stage: 'approved_mapping_and_purchase_basis', status: missing.length ? 'needs_evidence' : 'validated', recipe_id: recipe.recipe_id, recipe_version: recipe.version,
    mapping_version: mapping.version, explicit_conversions: ['kg -> g: 1000', 'l -> ml: 1000'], substitutions: false, inferred_density: false });
  if (missing.length) return held();
  let totalBaseline = rational(0n), totalCurrent = rational(0n);
  const line_bridge = prepared.map(({ line, selected, baseline, current, needed, before, after }) => {
    const beforeCost = rational(BigInt(baseline.purchase_cost_cents) * needed.quantity * 10000n, before.quantity * BigInt(selected.yield_basis_points));
    const afterCost = rational(BigInt(current.purchase_cost_cents) * needed.quantity * 10000n, after.quantity * BigInt(selected.yield_basis_points));
    totalBaseline = add(totalBaseline, beforeCost); totalCurrent = add(totalCurrent, afterCost);
    const baselineCents = rounded(beforeCost), currentCents = rounded(afterCost);
    const baselinePortionCents = rounded(rational(beforeCost.n, beforeCost.d * BigInt(recipe.portions)));
    const currentPortionCents = rounded(rational(afterCost.n, afterCost.d * BigInt(recipe.portions)));
    const pack = (row, basis) => ({ purchase_cost_cents: row.purchase_cost_cents, pack_quantity: row.pack_quantity, pack_unit: row.pack_unit,
      normalized_quantity: basis.quantity.toString(), normalized_unit: basis.unit, price_per_base_unit_cents_exact: ratioJSON(rational(BigInt(row.purchase_cost_cents), basis.quantity)),
      invoice_id: row.invoice_id, invoice_line_id: row.invoice_line_id, invoice_date: row.invoice_date, comparison_business_date: row.business_date, vendor_id: row.vendor_id, vendor_sku: row.vendor_sku, price_basis: row.price_basis });
    return { ingredient_id: line.ingredient_id, sku_id: selected.sku_id, usable_quantity: line.usable_quantity, usable_unit: line.usable_unit,
      yield_basis_points: selected.yield_basis_points, baseline_line_cost_cents: baselineCents, current_line_cost_cents: currentCents,
      delta_cents: safe(BigInt(currentCents) - BigInt(baselineCents)), baseline_unrounded_cents: ratioJSON(beforeCost), current_unrounded_cents: ratioJSON(afterCost),
      baseline_portion_cost_cents: baselinePortionCents, current_portion_cost_cents: currentPortionCents,
      portion_delta_cents: safe(BigInt(currentPortionCents) - BigInt(baselinePortionCents)),
      baseline_purchase_basis: pack(baseline, before), current_purchase_basis: pack(current, after),
      purchase_pack_changed: before.quantity !== after.quantity || before.unit !== after.unit,
      same_case_price_changed_contents: baseline.purchase_cost_cents === current.purchase_cost_cents && before.quantity !== after.quantity,
      source_ids: [prices.id, baseline.id, current.id, mapping.id, selected.id, recipe.id, line.id] };
  });
  const baselineRecipe = rounded(totalBaseline), currentRecipe = rounded(totalCurrent);
  const beforePortion = rational(totalBaseline.n, totalBaseline.d * BigInt(recipe.portions)), afterPortion = rational(totalCurrent.n, totalCurrent.d * BigInt(recipe.portions));
  const baselinePortion = rounded(beforePortion), currentPortion = rounded(afterPortion);
  const percent = value => rounded(rational(value.n * 10000n, value.d * BigInt(menu.price_cents))) / 100;
  const delta = safe(BigInt(currentRecipe) - BigInt(baselineRecipe));
  const sum = key => line_bridge.reduce((amount, line) => amount + BigInt(line[key]), 0n);
  const rounding = { method: 'Aggregate exact rational ingredient costs before rounding recipe and portion amounts half away from zero to integer cents.',
    percentages: 'Modeled food-cost percentages use unrounded per-portion cost and round to 0.01 percentage point.',
    contribution: 'Displayed food-only contribution equals menu cents minus the displayed rounded portion cost; it is not profit.',
    baseline_line_rounding_adjustment_cents: safe(BigInt(baselineRecipe) - sum('baseline_line_cost_cents')),
    current_line_rounding_adjustment_cents: safe(BigInt(currentRecipe) - sum('current_line_cost_cents')),
    delta_bridge_rounding_adjustment_cents: safe(BigInt(delta) - sum('delta_cents')),
    baseline_portion_line_rounding_adjustment_cents: safe(BigInt(baselinePortion) - sum('baseline_portion_cost_cents')),
    current_portion_line_rounding_adjustment_cents: safe(BigInt(currentPortion) - sum('current_portion_cost_cents')),
    portion_delta_bridge_rounding_adjustment_cents: safe(BigInt(currentPortion) - BigInt(baselinePortion) - sum('portion_delta_cents')),
    baseline_recipe_unrounded_cents: ratioJSON(totalBaseline), current_recipe_unrounded_cents: ratioJSON(totalCurrent), delta_unrounded_cents: ratioJSON(subtract(totalCurrent, totalBaseline)) };
  const metrics = { portions: recipe.portions, baseline_recipe_cost_cents: baselineRecipe, current_recipe_cost_cents: currentRecipe, recipe_cost_delta_cents: delta,
    baseline_portion_cost_cents: baselinePortion, current_portion_cost_cents: currentPortion, portion_cost_delta_cents: safe(BigInt(currentPortion) - BigInt(baselinePortion)),
    baseline_food_cost_percent: percent(beforePortion), current_food_cost_percent: percent(afterPortion), menu_price_cents: menu.price_cents,
    baseline_gross_food_contribution_cents: safe(BigInt(menu.price_cents) - BigInt(baselinePortion)), current_gross_food_contribution_cents: safe(BigInt(menu.price_cents) - BigInt(currentPortion)) };
  trace.push({ stage: 'exact_rational_costing', status: 'reconciled', recipe_id: recipe.recipe_id, recipe_version: recipe.version, portions: recipe.portions,
    formula: 'invoice_line_cents * usable_recipe_quantity / (explicit_pack_quantity * usable_yield)', source_ids: evidence.map(row => row.id), rounded_after_aggregation: true });
  return { status: 'reconciled', scope: { ...scope }, recipe_id: recipe.recipe_id, recipe_version: recipe.version, metrics, line_bridge, rounding, evidence,
    missing_evidence: [], trace, limitations: [...limitations], integration: { ...integration } };
}

export async function getRecipeFixture(scenario = 'complete') {
  if (!['complete', 'missing-yield', 'pack-change', 'wrong-location', 'missing-ingredient'].includes(scenario)) fail('RECIPE_SCENARIO_UNSUPPORTED', 'Choose an explicit supported fictional recipe scenario');
  const documents = await Promise.all(FAMILIES.map(async family => [family, JSON.parse(await readFile(new URL('../seed/recipe-cost/' + family + '.json', import.meta.url), 'utf8'))]));
  const records = Object.fromEntries(documents);
  if (scenario === 'missing-yield') records.ingredient_map.records.find(row => row.ingredient_id === 'ingredient-chicken').yield_basis_points = null;
  if (scenario === 'pack-change') Object.assign(records.prices.records.find(row => row.sku_id === 'sku-chicken' && row.period === 'current'), { purchase_cost_cents: 6000, pack_quantity: 8000 });
  if (scenario === 'wrong-location') records.prices.records.find(row => row.period === 'current').restaurant_id = 'demo-other-location';
  if (scenario === 'missing-ingredient') records.prices.records = records.prices.records.filter(row => !(row.sku_id === 'sku-cheese' && row.period === 'current'));
  return records;
}
