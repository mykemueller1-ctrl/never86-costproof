const voidById = id => document.getElementById(id);
const voidMoney = value => Number.isSafeInteger(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value / 100) : 'Unavailable';
const voidCount = value => Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat('en-US').format(value) : 'Unknown';
const voidRate = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) + '%' : 'Unavailable';
const voidSet = (id, value) => { voidById(id).textContent = value; };
const voidNode = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
let currentVoidResult = null;
let voidRequestSequence = 0;

function clearVoidResult() {
  currentVoidResult = null;
  voidById('void-result').hidden = true;
  voidById('void-source-receipt').open = false;
  voidSet('void-trace', '');
  voidSet('void-source-content', 'Choose a source stamp to inspect the current result.');
  voidSet('void-source-title', 'Inspect a source record');
  for (const id of ['void-cashier-table', 'void-actor-table', 'void-timeline', 'void-facts', 'void-next-source', 'void-limitations']) voidById(id).replaceChildren();
}

function sourceRecordsFor(result, ids) {
  const found = new Map();
  const selected = new Set(ids);
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 5) return;
    if (typeof value.id === 'string' && selected.has(value.id)) found.set(value.id, value);
    if (Array.isArray(value)) { for (const row of value) visit(row, depth + 1); }
    else for (const item of Object.values(value)) if (item && typeof item === 'object') visit(item, depth + 1);
  };
  visit(result.source_records || result.records || {});
  return [...found.values()];
}

function voidSourceStamp(result, title, ids, context) {
  const sourceIds = [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && id))];
  if (!sourceIds.length) return voidNode('span', 'Source reference missing', 'quiet');
  const stamp = voidNode('button', 'SYNTHETIC · Inspect sources ↗', 'source-stamp');
  stamp.type = 'button';
  stamp.setAttribute('aria-label', title + ': inspect the synthetic source records');
  stamp.addEventListener('click', () => {
    if (currentVoidResult !== result) return;
    voidSet('void-source-title', title + ' · source receipt');
    const records = sourceRecordsFor(result, sourceIds);
    voidSet('void-source-content', JSON.stringify({ title, classification: 'SYNTHETIC_COMPETITION_FIXTURE', scope: result.scope, period: result.period, source_ids: sourceIds, records, context, record_content_available: records.length > 0 }, null, 2));
    voidById('void-source-receipt').open = true;
    voidById('void-source-title').focus({ preventScroll: true });
    voidById('void-source-receipt').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  return stamp;
}

function voidPerson(row) {
  const person = voidNode('span', row.display_name || 'Name not recorded');
  person.append(voidNode('small', row.employee_id || 'Employee identifier not recorded'));
  return person;
}

function voidTable(targetId, headers, rows) {
  const table = voidNode('table', undefined, 'void-table');
  const thead = document.createElement('thead');
  const heading = document.createElement('tr');
  for (const label of headers) { const cell = voidNode('th', label); cell.scope = 'col'; heading.append(cell); }
  thead.append(heading);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of row) {
      const cell = document.createElement('td');
      if (value instanceof Node) cell.append(value);
      else { cell.textContent = value; cell.className = 'number'; }
      tr.append(cell);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  voidById(targetId).replaceChildren(table);
}

function safeVoidSum(rows, key) {
  if (!rows.every(row => Number.isSafeInteger(row[key]) && row[key] >= 0)) return null;
  const total = rows.reduce((sum, row) => sum + row[key], 0);
  return Number.isSafeInteger(total) ? total : null;
}

function displayVoidResult(result) {
  if (!result || !['reconciled', 'needs_evidence'].includes(result.status) || !result.scope || !result.period || !Array.isArray(result.employee_metrics) || !Array.isArray(result.void_actor_metrics) || !result.workflow || !Array.isArray(result.workflow.stages) || result.integration?.mode !== 'DETERMINISTIC_SYNTHETIC_VOID_WORKFLOW') throw new Error('The response did not contain the expected synthetic void evidence. No result is displayed.');
  currentVoidResult = result;
  const period = result.period;
  const covered = period.denominator_complete === true;
  const employeeRows = result.employee_metrics;
  const actorRows = result.void_actor_metrics;
  const showMetrics = covered && employeeRows.length > 0;
  const workflow = result.workflow;
  const linked = workflow.status === 'linked' && workflow.continuity_verified === true;
  const missing = Array.isArray(result.missing_evidence) ? result.missing_evidence : [];
  voidSet('void-restaurant', result.scope.restaurant_id || 'Fictional restaurant records');
  voidSet('void-period-label', period.label || 'Declared period');
  voidSet('void-proof-state', 'SYNTHETIC · ' + (covered ? 'Period complete' : 'Period incomplete'));
  voidSet('void-headline', showMetrics ? 'Recorded amounts are attributed to each original cashier. Review the event sequence separately.' : 'The original order denominator is incomplete. Dollar rankings and rates are held.');
  voidSet('void-amount', showMetrics ? voidMoney(safeVoidSum(employeeRows, 'void_amount_cents')) : 'Held');
  voidSet('void-amount-label', showMetrics ? 'recorded void amount across original cashiers' : 'Complete period evidence required');
  voidSet('void-order-count', covered ? voidCount(period.observed_original_order_count) : 'Held');
  voidSet('void-voided-count', showMetrics ? voidCount(safeVoidSum(employeeRows, 'voided_order_count')) : 'Held');
  voidSet('void-event-count', showMetrics ? voidCount(safeVoidSum(employeeRows, 'void_event_count')) : 'Held');
  voidSet('void-coverage-state', covered ? 'Complete for this declared period' : 'Incomplete · Rates and ranking held');
  voidSet('void-period-range', (period.label ? period.label + ' · ' : '') + [period.period_start, period.period_end].filter(Boolean).join(' → '));
  voidSet('void-coverage-count', voidCount(period.observed_original_order_count) + ' / ' + voidCount(period.expected_original_order_count));
  voidSet('void-continuity', linked ? 'Linked sequence supported' : 'Unknown · A required event or link is missing');
  voidById('void-cashier-held').hidden = showMetrics;
  voidSet('void-cashier-held', covered ? 'No cashier metrics were returned. No amount or rate is inferred.' : 'Provide the complete original order set and period coverage before comparing cashier counts, amounts or rates.');
  if (showMetrics) voidTable('void-cashier-table', ['Original cashier', 'Original orders', 'Orders with voids', 'Void events', 'Recorded amount', 'Voided order rate', 'Evidence'], employeeRows.map(row => [voidPerson(row), voidCount(row.cashier_original_order_count), voidCount(row.voided_order_count), voidCount(row.void_event_count), voidMoney(row.void_amount_cents), voidRate(row.void_order_rate_percent), voidSourceStamp(result, (row.display_name || row.employee_id) + ' · original order attribution', row.source_ids, row)]));
  voidById('void-actor-held').hidden = covered && actorRows.length > 0;
  voidSet('void-actor-held', covered ? 'No separate void actor metrics were returned.' : 'Actor comparisons are held until the declared period is complete.');
  if (covered && actorRows.length) voidTable('void-actor-table', ['Void initiator', 'Void events', 'Recorded amount', 'Approver identifiers recorded', 'Evidence'], actorRows.map(row => [voidPerson(row), voidCount(row.void_event_count), voidMoney(row.void_amount_cents), Array.isArray(row.approver_ids) && row.approver_ids.length ? row.approver_ids.join(', ') : 'Unknown', voidSourceStamp(result, (row.display_name || row.employee_id) + ' · void event attribution', row.source_ids, row)]));
  voidSet('void-workflow-state', linked ? 'Linked source events' : 'Continuity unknown');
  voidSet('void-chain-label', ['Order: ' + (workflow.original_order_id || 'Unknown'), 'Modifier: ' + (workflow.modifier_id || 'Unknown'), 'Chain: ' + (workflow.chain_id || 'Unknown')].join(' · '));
  for (const stage of workflow.stages) {
    const observed = stage.observed === true;
    const item = voidNode('li', undefined, observed ? 'observed' : 'unknown');
    item.append(voidNode('h3', stage.label || stage.stage || 'Event'));
    item.append(voidNode('p', observed ? 'Recorded · ' + (stage.occurred_at || 'Time not recorded') : 'Unknown · No matching linked event'));
    if (observed) item.append(voidNode('p', 'Actor: ' + (stage.actor_display_name || stage.actor_employee_id || 'Not recorded')));
    if (stage.parent_event_id) item.append(voidNode('p', 'Parent event: ' + stage.parent_event_id));
    if (stage.source_id) item.append(voidSourceStamp(result, stage.label || stage.stage || 'Timeline event', [stage.source_id], stage));
    voidById('void-timeline').append(item);
  }
  voidById('void-missing').hidden = missing.length === 0 && linked;
  voidSet('void-missing', missing.length ? missing.map(row => row.request || row.code || 'Provide the missing matching event.').join(' ') : linked ? '' : 'The linked event chain is incomplete. The missing event stays unknown.');
  for (const fact of Array.isArray(result.facts) ? result.facts : []) {
    const card = voidNode('article', undefined, 'void-fact');
    card.append(voidNode('h3', fact.title || 'Recorded fact'), voidNode('p', typeof fact.value === 'object' ? JSON.stringify(fact.value) : String(fact.value ?? 'Unknown')), voidSourceStamp(result, fact.title || 'Recorded fact', fact.source_ids, fact));
    voidById('void-facts').append(card);
  }
  const candidates = Array.isArray(result.ranked_review_candidates) ? result.ranked_review_candidates : [];
  const next = covered ? candidates[0] : null;
  voidSet('void-next', next?.title || (!covered ? 'Complete the original order evidence before comparing people.' : !linked ? 'Get the missing kitchen event and verify its order link.' : 'Review the linked order and its recorded approval.'));
  voidSet('void-next-reason', next?.reason || missing[0]?.request || 'Check the original order, modifier, event timestamps and recorded approval before making a decision.');
  if (next?.source_ids?.length) voidById('void-next-source').append(voidSourceStamp(result, 'Proposed review evidence', next.source_ids, next));
  for (const text of Array.isArray(result.limitations) ? result.limitations : []) voidById('void-limitations').append(voidNode('li', text));
  voidSet('void-trace', JSON.stringify(result, null, 2));
  voidById('void-result').hidden = false;
}

async function runVoid(event) {
  event?.preventDefault();
  const requestId = ++voidRequestSequence;
  clearVoidResult();
  voidById('void-error').hidden = true;
  voidById('void-loading').hidden = false;
  voidById('void-run').disabled = true;
  voidById('void-scenario').disabled = true;
  try {
    const response = await fetch('/api/void-proof', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: voidById('void-scenario').value, sourceMode: 'fixture' }) });
    const result = await response.json();
    if (requestId !== voidRequestSequence) return;
    if (!response.ok) throw new Error(result.message || result.error || 'The void evidence check did not complete.');
    displayVoidResult(result);
    if (event) voidById('void-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (requestId !== voidRequestSequence) return;
    clearVoidResult();
    voidSet('void-error', error.message || 'The evidence check did not complete. No result is retained.');
    voidById('void-error').hidden = false;
  } finally {
    if (requestId === voidRequestSequence) {
      voidById('void-loading').hidden = true;
      voidById('void-run').disabled = false;
      voidById('void-scenario').disabled = false;
    }
  }
}

voidById('void-form').addEventListener('submit', runVoid);
voidById('void-scenario').addEventListener('change', () => {
  ++voidRequestSequence;
  clearVoidResult();
  voidById('void-error').hidden = true;
  voidById('void-loading').hidden = true;
  voidSet('void-restaurant', 'Fictional restaurant records');
  voidSet('void-period-label', 'Run the selected declared period');
});
runVoid();
