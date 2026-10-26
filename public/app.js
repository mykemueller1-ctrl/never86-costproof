const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
const signedMoney = cents => (cents > 0 ? '+' : '') + money(cents);
const percent = value => value === null ? 'Unavailable' : value.toFixed(1) + '%';
const set = (id, value) => { $(id).textContent = value; };
let zetarisConnectionText = null;
let zetarisConfigurationMessage = 'Source queries for the current investigation are unverified.';
let nightshiftConnectionText = null;
let nightshiftConfigurationMessage = 'Model text for the current investigation is unverified.';
function updateZetarisConnection(result) {
  if (nightshiftConnectionText) {
    const calls = (result?.trace || []).filter(row => row.model_text_returned);
    const nano = calls.length >= 3 && calls.every(row => row.winning_provider === 'local-runtime' &&
      row.routed_model === 'local-runtime/nvidia-llama-3-1-nemotron-nano-4b-v1-1-q4-k-m' &&
      typeof row.request_id === 'string' && row.request_id.startsWith('chatcmpl-'));
    const accepted = result?.evidence_review?.status === 'accepted_by_model_critic' &&
      result.analysis?.rendering === 'code_from_validated_model_selection';
    nightshiftConnectionText.textContent = result?.integration?.nightshift_text === true
      ? accepted && nano ? 'Verified for this run · local Nano · evidence selection and critic'
        : 'Model text returned for this run · answer held for validation'
      : nightshiftConfigurationMessage;
  }
  if (!zetarisConnectionText) return;
  const families = ['sales', 'labor', 'policy'];
  const receipts = (result?.trace || []).filter(row => row.role === 'source');
  const verified = $('source-mode').value === 'zetaris' && result?.source_mode === 'zetaris' &&
    result.integration?.zetaris === true && receipts.length === families.length && families.every(family => {
      const rows = receipts.filter(row => row.family === family);
      const row = rows[0];
      return rows.length === 1 && row.tool === 'zetaris_rest_sql' && row.status === 'validated' &&
        row.http_status === 200 && row.transport === 'network' && row.transport_verified === true &&
        row.mapping_verified === true && row.integration_verified === true &&
        ['direct_rest', 'ui_proxy'].includes(row.api_transport) && typeof row.source_id === 'string' &&
        row.source_id === result.source_records?.[family]?.id &&
        ['restaurant_id', 'shift_id', 'business_date', 'currency'].every(key => typeof result.scope?.[key] === 'string' && result.scope[key] && row.scope?.[key] === result.scope[key]);
    });
  zetarisConnectionText.textContent = verified
    ? 'Verified for this run · 3 scoped network queries · synthetic sources'
    : zetarisConfigurationMessage;
}
async function request(url, body) {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || value.error);
  return value;
}
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function clearMetricReceipt(message = 'Choose a source stamp beside a number to inspect the current investigation’s records and calculation.') {
  $('metric-evidence').open = false;
  set('metric-evidence-title', 'Inspect a metric’s source and calculation');
  set('metric-evidence-content', message);
}
function sourceStamp(result, label, sourceIds, calculation, status = 'Math checked') {
  const button = element('button', '', 'source-stamp');
  button.type = 'button';
  button.append(element('span', 'SYNTHETIC', 'stamp-state'), element('span', status + ' ↗'));
  button.setAttribute('aria-label', label + ': synthetic records. ' + status + '. Inspect sources and calculation.');
  button.addEventListener('click', () => {
    set('metric-evidence-title', label + ' · source and calculation');
    set('metric-evidence-content', JSON.stringify({
      metric: label, classification: 'SYNTHETIC_COMPETITION_FIXTURE', check: status,
      calculation, scope: result.scope, source_ids: sourceIds,
      records: Object.values(result.source_records || {}).filter(row => sourceIds.includes(row.id))
    }, null, 2));
    $('metric-evidence').open = true;
    $('metric-evidence-title').focus({ preventScroll: true });
    $('metric-evidence').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  return button;
}
function stampAt(id, result, label, ids, calculation, status) {
  $(id).replaceChildren(sourceStamp(result, label, ids, calculation, status));
}
function readableDate(value) {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC';
}
function reportCard(row, includeText = true) {
  const note = row.note || {};
  const scope = note.scope || note;
  const author = [note.author, note.author_name, note.reported_by].find(value => typeof value === 'string' && value.trim()) || 'Author not recorded';
  const card = element('article', '', 'report-card');
  const heading = element('div', '', 'report-heading');
  heading.append(element('strong', 'Remembered manager report'), element('span', 'UNVERIFIED', 'report-state'));
  card.append(heading);
  if (includeText) card.append(element('p', note.text || 'Report text not recorded', 'report-text'));
  const details = element('dl', '', 'report-details');
  for (const [label, value] of [
    ['Author', author],
    ['Reviewed for scope', readableDate(note.reviewed_for_scope_at)],
    ['Scope', ['restaurant_id', 'business_date', 'shift_id', 'currency'].map(key => scope[key] || 'Not recorded').join(' · ')],
    ['Report source', note.id || 'Source not recorded']
  ]) {
    const field = element('div', ''); field.append(element('dt', label), element('dd', value)); details.append(field);
  }
  card.append(details, element('p', 'Synthetic report. Scope review does not verify the statement or its claimed approval.', 'quiet'));
  return card;
}
async function refreshMemory() {
  const rows = await request('/api/memory');
  set('memory-count', rows.length + ' scoped report' + (rows.length === 1 ? '' : 's') + ' in H-MEM');
  set('memory', JSON.stringify(rows, null, 2));
  $('saved-report-provenance').replaceChildren(...rows.map(row => reportCard(row, false)));
  return rows;
}
function display(result) {
  clearMetricReceipt();
  $('result').hidden = false;
  set('result-mode', result.mode);
  set('headline', result.headline);
  const metrics = result.metrics;
  set('gap', metrics ? signedMoney(metrics.gap_cents) : 'Held');
  set('gap-label', metrics ? (metrics.gap_cents >= 0 ? 'above this shift’s labor target' : 'below this shift’s labor target') : 'Waiting for wage evidence');
  set('actual-percent', metrics ? percent(metrics.actual_labor_percent) : '—');
  set('target-percent', metrics ? percent(metrics.target_percent) : '—');
  set('points', metrics?.variance_percentage_points != null ? (metrics.variance_percentage_points > 0 ? '+' : '') + metrics.variance_percentage_points.toFixed(1) + ' pp' : '—');
  const records = result.source_records || {};
  const ids = Object.fromEntries(Object.entries(records).map(([family, row]) => [family, row.id]));
  const allIds = [ids.sales, ids.labor, ids.policy].filter(Boolean);
  const calculationStatus = metrics ? 'Math checked' : 'Evidence incomplete';
  const gapFormula = 'Actual labor dollars minus the labor target at actual net sales. Target dollars are rounded to cents.';
  stampAt('gap-source', result, 'Labor dollar gap', allIds, gapFormula, calculationStatus);
  stampAt('actual-source', result, 'Actual labor percentage', [ids.labor, ids.sales].filter(Boolean), 'Actual labor dollars divided by actual net sales, multiplied by 100. Unavailable when net sales are zero.', !metrics ? calculationStatus : metrics.actual_labor_percent === null ? 'Zero denominator' : calculationStatus);
  stampAt('target-source', result, 'Labor target', [ids.policy].filter(Boolean), 'Synthetic policy target in basis points divided by 100. This is a scenario input.', 'Policy input');
  stampAt('points-source', result, 'Difference in percentage points', allIds, 'Actual labor percentage minus the synthetic policy target. Unavailable when net sales are zero.', !metrics ? calculationStatus : metrics.variance_percentage_points === null ? 'Zero denominator' : calculationStatus);
  $('missing').hidden = !!metrics;
  set('missing', result.request || '');
  $('bridge-rows').replaceChildren();
  const bridgeCalculations = [
    'Planned labor dollars minus the rounded labor target at planned net sales.',
    'Rounded labor target at planned net sales minus rounded labor target at actual net sales.',
    'Actual labor dollars minus planned labor dollars.'
  ];
  for (const [index, item] of (result.bridge || []).entries()) {
    const row = element('div', '', 'bridge-row');
    const label = element('div', item.label); label.append(element('small', item.source_ids.join(' · ')));
    const value = element('div', '', 'bridge-value');
    value.append(element('strong', signedMoney(item.cents)), sourceStamp(result, item.label, item.source_ids, bridgeCalculations[index] || 'See the full run trace for this accounting bridge component.'));
    row.append(label, value); $('bridge-rows').append(row);
  }
  if (!metrics) $('bridge-rows').append(element('p', 'The dollar bridge is stopped until the wage record is available.', 'quiet'));
  set('bridge-total', metrics ? signedMoney(metrics.gap_cents) : 'Unavailable');
  stampAt('total-source', result, 'Reconciled variance', allIds, 'Planned labor variance plus the sales plan effect plus the change in labor dollars. This sum equals the labor dollar gap.', calculationStatus);
  $('source-cards').replaceChildren();
  for (const row of result.evidence) {
    const card = element('article', '', 'source-card');
    card.append(element('h3', row.id.split('-')[0].toUpperCase()), element('code', row.id), element('p', row.restaurant_id + ' · ' + row.business_date), element('p', 'SYNTHETIC · ' + row.currency));
    const record = Object.values(result.source_records).find(source => source.id === row.id);
    if (record && 'actual_net_sales_cents' in record) card.append(element('p', 'Actual ' + money(record.actual_net_sales_cents) + ' / Plan ' + money(record.planned_net_sales_cents)));
    if (record && 'actual_labor_cents' in record) card.append(element('p', record.actual_labor_cents === null ? 'Wage dollars missing' : 'Actual ' + money(record.actual_labor_cents) + ' / Plan ' + money(record.planned_labor_cents)));
    if (record && 'labor_target_basis_points' in record) card.append(element('p', 'Target ' + percent(record.labor_target_basis_points / 100)));
    $('source-cards').append(card);
  }
  set('trace', JSON.stringify(result, null, 2));
  set('next-action', result.proposed_action.text);
  set('action-status', 'PROPOSED · ' + (result.proposed_action.status || 'Unsent proposal'));
  set('action-role', result.proposed_action.owner || 'Restaurant manager');
  set('action-review', result.status === 'needs_evidence' ? 'After matching wage records are provided. No due date accepted.' : 'Before changing staffing or closing this review. No due date accepted.');
  set('action-proof', result.status === 'needs_evidence' ? 'Wage or payroll dollars for this restaurant, business date and shift.' : 'Shift approval and time records, checked against the sales forecast. Record what the evidence supports before closing the check.');
  const corrections = result.corrections || [];
  $('context-change').hidden = corrections.length === 0;
  set('context-next-check', result.proposed_action.text);
  set('context-explanation', result.status === 'needs_evidence' ? 'The wage record is still required. Remembered context cannot fill missing dollars. The statement remains unverified.' : 'The recalled report is available as scoped context. Labor dollars still come from source records. The statement remains unverified.');
  $('report-provenance').replaceChildren(...corrections.map(row => reportCard(row)));
  $('model-analysis').replaceChildren();
  if (result.analysis?.rendering === 'code_from_validated_model_selection') {
    $('model-analysis').append(element('p', 'Nightshift selected fact identifiers and a proposed check. The app binds the quantities and source records, then renders their wording from validated records.', 'quiet'));
  }
  for (const claim of result.analysis?.claims || []) {
    const p = element('p', claim.text);
    for (const ref of claim.metric_refs || []) {
      const label = ref.key.replace(/^(metrics|bridge)\./, '').replace(/_/g, ' ');
      const value = ref.unit === 'USD_cents' ? money(ref.value) : ref.unit === 'percent' ? percent(ref.value) : ref.value + ' pp';
      p.append(element('code', label + ': ' + value));
    }
    p.append(element('code', claim.source_ids.join(' · '))); $('model-analysis').append(p);
  }
  const boundaries = element('div', '', 'source-boundaries');
  boundaries.append(element('p', 'SCOPE AND LIMITATIONS', 'eyebrow'));
  const limitations = element('ul', '', 'quiet');
  for (const limitation of result.limitations || []) limitations.append(element('li', limitation));
  boundaries.append(limitations); $('model-analysis').append(boundaries);
  $('escalation').hidden = !result.model_escalation; set('escalation', result.model_escalation || '');
}
async function run(event) {
  event?.preventDefault(); $('error').hidden = true; $('loading').hidden = false; $('run').disabled = true;
  for (const id of ['source-mode', 'scenario', 'mode', 'question']) $(id).disabled = true;
  $('result').hidden = true;
  updateZetarisConnection();
  clearMetricReceipt('A new investigation is reading the records. Receipts from earlier runs have been cleared.');
  try {
    const result = await request('/api/investigate', { question: $('question').value, scenario: $('scenario').value, liveModel: $('mode').value === 'nightshift', sourceMode: $('source-mode').value });
    display(result); await refreshMemory(); updateZetarisConnection(result);
    if (event) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { updateZetarisConnection(); $('result').hidden = true; clearMetricReceipt('No metric receipt is available because this investigation did not finish.'); set('error', error.message); $('error').hidden = false; }
  finally {
    $('loading').hidden = true; $('run').disabled = false;
    for (const id of ['source-mode', 'mode', 'question']) $(id).disabled = false;
    $('scenario').disabled = $('source-mode').value === 'zetaris';
  }
}
$('investigation-form').addEventListener('submit', run);
$('source-mode').addEventListener('change', () => {
  const registered = $('source-mode').value === 'zetaris';
  updateZetarisConnection();
  $('result').hidden = true; $('error').hidden = true;
  clearMetricReceipt('Choose Run to read the selected source. Earlier receipts have been cleared.');
  if (registered) $('scenario').value = 'complete';
  $('scenario').disabled = registered;
  set('source-note', registered ? 'Reads registered synthetic sources through Zetaris. Verified source mapping is required. No fixture fallback.' : 'Preview reads labeled local source files. Fault scenarios alter fixtures only. Live sponsor calls remain separately identified.');
});
function invalidateRun() {
  updateZetarisConnection();
  $('result').hidden = true; $('error').hidden = true; set('trace', '');
  clearMetricReceipt('Inputs changed. Run the investigation to inspect a current receipt.');
}
for (const id of ['scenario', 'mode', 'question']) $(id).addEventListener('change', invalidateRun);
$('question').addEventListener('input', invalidateRun);
$('reviewed').addEventListener('change', () => { $('save-note').disabled = !$('reviewed').checked; });
$('save-note').addEventListener('click', async () => {
  $('save-note').disabled = true;
  try {
    const saved = await request('/api/corrections', { reviewed_for_scope: $('reviewed').checked });
    set('save-status', saved.created ? 'Saved with provenance. Payroll is unchanged. Run the investigation again to use it.' : 'This report is already saved. Payroll is unchanged.');
    await refreshMemory();
  } catch (error) { set('save-status', error.message); }
  finally { $('save-note').disabled = !$('reviewed').checked; }
});
async function startup() {
  try {
    const status = await request('/api/status');
    for (const [name, text] of [ ['Meterless H-MEM', status.hmem], ['Nightshift primary provider', status.nightshift.status === 'unauthorized' ? 'Runtime token required · text call unverified' : status.nightshift.status + ' · text call unverified'], ['Zetaris source queries', status.zetaris.message] ]) {
      const card = element('div', '', 'connection');
      const detail = element('span', text);
      if (name === 'Zetaris source queries') { zetarisConnectionText = detail; zetarisConfigurationMessage = text; }
      if (name === 'Nightshift primary provider') { nightshiftConnectionText = detail; nightshiftConfigurationMessage = text; }
      card.append(element('strong', name), detail); $('connections').append(card);
    }
    await refreshMemory(); await run();
  } catch (error) { set('error', error.message); $('error').hidden = false; }
}
startup();
