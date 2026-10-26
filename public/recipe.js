const byId = id => document.getElementById(id);
const money = value => value === null || value === undefined ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value / 100);
const signedMoney = value => value > 0 ? '+' + money(value) : money(value);
const set = (id, value) => { byId(id).textContent = value; };
function node(tag, text, className) { const item = document.createElement(tag); item.textContent = text; if (className) item.className = className; return item; }
const ingredientName = id => id.replace(/^ingredient-/, '').replace(/[-_]/g, ' ').replace(/^./, value => value.toUpperCase());
const purchaseLabel = basis => money(basis.purchase_cost_cents) + ' / ' + new Intl.NumberFormat('en-US').format(basis.pack_quantity) + ' ' + basis.pack_unit;
function missingRequest(item) {
  if (typeof item === 'string') return item;
  const ingredient = item.ingredient_id ? ingredientName(item.ingredient_id) + ': ' : '';
  const requests = {
    USABLE_YIELD_REQUIRED: 'confirm the approved usable yield, greater than 0% and up to 100%.',
    INGREDIENT_PRICE_REQUIRED: 'provide both invoice prices and their purchase pack contents for the matched SKU.',
    INGREDIENT_MAPPING_REQUIRED: 'confirm the exact ingredient and vendor SKU match. No substitution was made.',
    PURCHASE_PACK_REQUIRED: 'provide the purchase pack contents and unit for the selected invoice line.',
    PURCHASE_PRICE_BASIS_REQUIRED: 'confirm the invoice price and how tax, freight, credits and discounts are treated.',
    APPROVED_MAPPING_REQUIRED: 'review and approve the ingredient and vendor SKU matches for this recipe version.',
    MENU_PRICE_REQUIRED: 'provide a positive menu price that excludes tax.',
    SOURCE_FAMILY_REQUIRED: 'provide the matching ' + (item.family || 'source') + ' records.'
  };
  return ingredient + (requests[item.code] || item.request || 'provide the matching source record.');
}
function display(result) {
  const held = result.status !== 'reconciled';
  const metrics = result.metrics;
  byId('recipe-result').hidden = false;
  set('recipe-headline', held ? 'A required recipe or purchase record is missing. The cost answer is held.' : 'The ingredient cost changed. Inspect the source before changing the plate.');
  set('recipe-delta', held ? 'Held' : signedMoney(metrics.portion_cost_delta_cents));
  set('recipe-delta-label', held ? 'Required evidence is missing' : 'modeled change per serving');
  set('recipe-baseline', money(metrics?.baseline_portion_cost_cents));
  set('recipe-current', money(metrics?.current_portion_cost_cents));
  set('recipe-menu', money(metrics?.menu_price_cents));
  set('recipe-line-total', held ? 'Unavailable' : signedMoney(metrics.portion_cost_delta_cents));
  set('recipe-cost-percent', held ? 'Unavailable' : metrics.baseline_food_cost_percent.toFixed(2) + '% → ' + metrics.current_food_cost_percent.toFixed(2) + '%');
  set('recipe-contribution', held ? 'Unavailable' : money(metrics.baseline_gross_food_contribution_cents) + ' → ' + money(metrics.current_gross_food_contribution_cents));
  byId('recipe-lines').replaceChildren();
  for (const line of result.line_bridge || []) {
    const detail = node('details', '', 'recipe-line');
    const summary = node('summary', '');
    summary.append(node('span', ingredientName(line.ingredient_id)), node('strong', signedMoney(line.portion_delta_cents)));
    const receipt = node('details', '', 'recipe-receipt');
    receipt.append(node('summary', 'Inspect source receipt and calculation'), node('pre', JSON.stringify(line, null, 2)));
    detail.append(summary,
      node('p', 'Purchase pack: ' + purchaseLabel(line.baseline_purchase_basis) + ' → ' + purchaseLabel(line.current_purchase_basis), 'quiet'),
      node('p', 'Usable yield: ' + (line.yield_basis_points / 100).toFixed(2) + '% · Recipe quantity: ' + line.usable_quantity + ' ' + line.usable_unit + ' across ' + metrics.portions + ' serving(s)', 'quiet'),
      receipt);
    byId('recipe-lines').append(detail);
  }
  const adjustment = result.rounding?.portion_delta_bridge_rounding_adjustment_cents || 0;
  if (adjustment) byId('recipe-lines').append(node('p', 'Cent rounding reconciliation: ' + signedMoney(adjustment), 'quiet'));
  const missing = result.missing_evidence || [];
  byId('recipe-missing').hidden = !held;
  set('recipe-missing', held ? missing.map(missingRequest).join(' ') : '');
  set('recipe-next', held ? 'Get the matching recipe, SKU and yield records before quoting a cost.' : 'Verify the changed SKU prices, pack sizes and recipe yield before changing the menu.');
  set('recipe-required', held ? 'Every ingredient needs a scoped price, approved SKU match, usable quantity and explicit yield.' : 'Compare the selected invoice lines with the approved recipe version. Confirm that purchase packs and usable quantities match.');
  byId('recipe-limitations').replaceChildren(...(result.limitations || []).map(text => node('li', text)));
  set('recipe-trace', JSON.stringify(result, null, 2));
}
async function run(event) {
  event?.preventDefault();
  byId('recipe-result').hidden = true; byId('recipe-error').hidden = true; byId('recipe-loading').hidden = false;
  byId('recipe-run').disabled = true; byId('recipe-scenario').disabled = true;
  try {
    const response = await fetch('/api/recipe-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: byId('recipe-scenario').value, sourceMode: 'fixture' }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || 'The recipe evidence check did not complete.');
    display(result);
    if (event) byId('recipe-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { set('recipe-error', error.message); byId('recipe-error').hidden = false; }
  finally { byId('recipe-loading').hidden = true; byId('recipe-run').disabled = false; byId('recipe-scenario').disabled = false; }
}
byId('recipe-form').addEventListener('submit', run);
byId('recipe-scenario').addEventListener('change', () => { byId('recipe-result').hidden = true; byId('recipe-error').hidden = true; set('recipe-trace', ''); });
run();
