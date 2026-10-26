import { readFile } from 'node:fs/promises';
import { EvidenceError } from './reconcile.mjs';

export const VOID_SCOPE = Object.freeze({ restaurant_id: 'demo-101', period_start: '2026-09-01', period_end: '2026-09-30', currency: 'USD' });
const SCOPE_KEYS = ['restaurant_id', 'period_start', 'period_end', 'currency'];
const FAMILIES = ['coverage', 'employees', 'original_orders', 'adjustments', 'workflow_events'];
const CLASSIFICATION = 'SYNTHETIC_COMPETITION_FIXTURE';
const DENOMINATOR = 'DISTINCT_ORIGINAL_ORDER_IDS_CREATED_IN_PERIOD';
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const STAGES = ['modifier_request', 'pos_dispatch', 'kitchen_acknowledgment', 'handoff'];
const LABELS = { modifier_request: 'Modifier request recorded', pos_dispatch: 'POS dispatch recorded', kitchen_acknowledgment: 'Kitchen acknowledgment recorded', handoff: 'Handoff recorded' };
const fail = (code, message, details = []) => { throw new EvidenceError(code, message, details); };
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
const whole = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const inside = (day, period) => day >= period.start_date && day <= period.end_date;
const safe = value => { if (value < -MAX_SAFE || value > MAX_SAFE) fail('VOID_OVERFLOW', 'The recorded amount exceeds the supported safe integer output range'); return Number(value); };
const sumCents = rows => safe(rows.reduce((sum, row) => sum + BigInt(row.amount_cents), 0n));
const rate = (count, denominator) => denominator ? safe((BigInt(count) * 20000n + BigInt(denominator)) / (2n * BigInt(denominator))) / 100 : null;
const money = (cents, currency) => currency + ' ' + (BigInt(cents) / 100n) + '.' + String(BigInt(cents) % 100n).padStart(2, '0');
const unique = items => [...new Set(items)];
const integration = Object.freeze({ mode: 'DETERMINISTIC_SYNTHETIC_VOID_WORKFLOW', model_verified: false, sponsor_integration_verified: false });
const limitations = Object.freeze([
  'Fictional competition records only. No employee, customer or live POS data is used.',
  'A recorded void amount is not proof of theft, financial loss, employee fault or a recoverable saving.',
  'Cashier attribution follows the original order. The void initiator and recorded approver are separate identities; neither proves responsibility or authorization.',
  'Rates use distinct original orders created in the selected complete period. Refunds are kept separate and are never added to void totals.',
  'Completeness is an explicit fictional source declaration checked against expected and observed counts, not an independent audit of a live POS export.',
  'The modifier event chain records observations only. A missing acknowledgment means unknown continuity, not proof that a kitchen or employee failed.',
  'Review candidates are sorted by recorded void cents, then void-order rate, with source IDs. They are human review prompts, not findings of misconduct or cause.',
  'This workflow is deterministic. Model and sponsor execution for this path are unverified.'
]);

function assertSource(row, scope, ids, family) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || !text(row.id)) fail('VOID_SOURCE_INVALID', 'Each ' + family + ' record needs a unique source ID');
  if (ids.has(row.id)) fail('VOID_DUPLICATE_SOURCE', 'Source IDs must be globally unique', [row.id]);
  ids.add(row.id);
  if (row.classification !== CLASSIFICATION) fail('VOID_CLASSIFICATION', 'Only explicitly fictional competition records are supported', [row.id]);
  const mismatches = SCOPE_KEYS.filter(key => row[key] !== scope[key]);
  if (mismatches.length) fail('VOID_SCOPE_MISMATCH', 'Do not combine records from different locations, source periods or currencies', [row.id, ...mismatches]);
}
function dated(row, scope) {
  if (!date(row.business_date) || row.business_date < scope.period_start || row.business_date > scope.period_end) fail('VOID_PERIOD_MISMATCH', 'The original business date must fall inside the declared source period', [row.id]);
}
function validPeriod(row, scope) {
  if (!date(row.start_date) || !date(row.end_date) || row.end_date < row.start_date || row.start_date < scope.period_start || row.end_date > scope.period_end) fail('VOID_PERIOD_MISMATCH', 'The selected reporting period must fit the source period', [row.id]);
  const start = new Date(row.start_date + 'T00:00:00Z'), end = new Date(row.end_date + 'T00:00:00Z');
  if (row.kind === 'week') {
    if (start.getUTCDay() !== 1 || (end - start) / 86400000 !== 6) fail('VOID_PERIOD_INVALID', 'Weekly rates require an explicit Monday through Sunday period', [row.id]);
  } else if (row.kind === 'month') {
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    if (start.getUTCDate() !== 1 || end.getTime() !== next.getTime() - 86400000) fail('VOID_PERIOD_INVALID', 'Monthly rates require a complete calendar month', [row.id]);
  } else fail('VOID_PERIOD_INVALID', 'Choose an explicit weekly or monthly reporting period', [row.id]);
}
function employeesById(document) {
  const people = new Map();
  for (const row of document.records) {
    if (!text(row.employee_id) || !text(row.display_name) || !Array.isArray(row.roles) || !row.roles.length || row.roles.some(role => !['cashier', 'manager', 'kitchen', 'handoff'].includes(role))) fail('VOID_IDENTITY_INVALID', 'Explicit employee IDs, display names and recorded roles are required', [row.id]);
    if (people.has(row.employee_id)) fail('VOID_ATTRIBUTION_AMBIGUOUS', 'An employee ID cannot resolve to multiple identity records', [row.employee_id]);
    people.set(row.employee_id, row);
  }
  return people;
}
function employee(people, id, source, role = null) {
  const person = text(id) ? people.get(id) : null;
  if (!person || (role && !person.roles.includes(role))) fail('VOID_ATTRIBUTION_AMBIGUOUS', 'The original identity and required recorded role must be explicit; names are not merged or guessed', [source, String(id)]);
  return person;
}
function inspectWorkflow(document, orders, people, scope, exportAsOf) {
  if (!text(document.chain_id) || !text(document.modifier_id) || !orders.has(document.original_order_id)) fail('VOID_WORKFLOW_LINK_INVALID', 'The modifier chain must identify an existing original order and modifier');
  const order = orders.get(document.original_order_id), stages = new Map(), byId = new Map();
  for (const row of document.records) {
    dated(row, scope);
    if (!STAGES.includes(row.stage) || stages.has(row.stage) || row.chain_id !== document.chain_id || row.original_order_id !== document.original_order_id || row.modifier_id !== document.modifier_id || row.business_date !== order.business_date) fail('VOID_WORKFLOW_LINK_INVALID', 'Each event must belong to exactly one stage of this original order and modifier chain', [row.id]);
    if (!stamp(row.occurred_at) || Date.parse(row.occurred_at) < Date.parse(order.created_at)) fail('VOID_CHRONOLOGY_INVALID', 'Workflow events require valid timestamps at or after the original order', [row.id]);
    if (Date.parse(row.occurred_at) > exportAsOf) fail('VOID_AFTER_EXPORT', 'A workflow observation cannot occur after its source export instant', [row.id]);
    let actor;
    if (row.actor_type === 'employee') actor = employee(people, row.actor_employee_id, row.id);
    else if (row.actor_type === 'system' && text(row.actor_system_id) && (row.actor_employee_id === null || row.actor_employee_id === undefined)) actor = { employee_id: null, display_name: row.actor_system_id };
    else fail('VOID_ATTRIBUTION_AMBIGUOUS', 'An event actor must be an explicit employee or system, without conflating those identities', [row.id]);
    stages.set(row.stage, { row, actor }); byId.set(row.id, row);
  }
  let lastTime = null;
  const missing = [];
  for (const [index, stage] of STAGES.entries()) {
    const current = stages.get(stage)?.row;
    if (!current) { missing.push({ code: 'WORKFLOW_EVENT_MISSING', stage, request: 'Provide the original ' + LABELS[stage].toLowerCase() + ' source; continuity is unknown.', source_ids: [document.id, order.id] }); continue; }
    if (lastTime !== null && Date.parse(current.occurred_at) < lastTime) fail('VOID_CHRONOLOGY_INVALID', 'Observed workflow stages cannot run backward in time', [current.id]);
    lastTime = Date.parse(current.occurred_at);
    if (index === 0) {
      if (current.parent_event_id !== null) fail('VOID_WORKFLOW_LINK_INVALID', 'The modifier request must be the root of this event chain', [current.id]);
    } else {
      if (!text(current.parent_event_id)) fail('VOID_WORKFLOW_LINK_INVALID', 'Non-root events require an explicit parent event source ID', [current.id]);
      const expected = stages.get(STAGES[index - 1])?.row;
      if (expected && current.parent_event_id !== expected.id) fail('VOID_WORKFLOW_LINK_INVALID', 'The parent source ID must be the preceding stage in the same modifier chain', [current.id, current.parent_event_id]);
      const presentParent = byId.get(current.parent_event_id);
      if (!expected && presentParent) fail('VOID_WORKFLOW_LINK_INVALID', 'An event cannot skip a present stage or point at the wrong event type', [current.id, current.parent_event_id]);
    }
  }
  return { result: { status: missing.length ? 'unknown' : 'linked', chain_id: document.chain_id, original_order_id: document.original_order_id, modifier_id: document.modifier_id,
    stages: STAGES.map(stage => { const entry = stages.get(stage); return { stage, label: LABELS[stage], observed: Boolean(entry), source_id: entry?.row.id || null,
      occurred_at: entry?.row.occurred_at || null, actor_employee_id: entry?.actor.employee_id || null, actor_display_name: entry?.actor.display_name || null, parent_event_id: entry?.row.parent_event_id || null }; }),
    continuity_verified: missing.length === 0, observed_chronology_validated: true, linkage_scope: 'Source IDs and recorded observation timestamps only; payload delivery and physical execution are not independently verified.', missing_event_types: missing.map(row => row.stage),
    source_ids: [document.id, order.id, ...document.records.map(row => row.id)], cause_or_employee_fault_established: false }, missing };
}

export function analyzeVoidProof(records, scope = VOID_SCOPE) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).length !== SCOPE_KEYS.length || !SCOPE_KEYS.every(key => Object.hasOwn(scope, key) && text(scope[key])) || !date(scope.period_start) || !date(scope.period_end) || scope.period_end < scope.period_start || !/^[A-Z]{3}$/.test(scope.currency)) fail('VOID_SCOPE_INVALID', 'Exactly a location, valid source start/end dates and currency are required');
  if (!records || typeof records !== 'object' || Array.isArray(records)) fail('VOID_SOURCE_INVALID', 'Five explicit source families are required');
  const sourceIds = new Set(), evidence = [];
  for (const family of FAMILIES) {
    const document = records[family];
    assertSource(document, scope, sourceIds, family);
    if (!Array.isArray(document.records)) fail('VOID_SOURCE_INVALID', family + ' requires original source records', [document.id]);
    evidence.push({ id: document.id, family, classification: CLASSIFICATION, ...scope });
    for (const row of document.records) { assertSource(row, scope, sourceIds, family); evidence.push({ id: row.id, family, classification: CLASSIFICATION, ...scope }); }
  }
  if (!stamp(records.coverage.export_as_of_utc) || !records.coverage.export_as_of_utc.endsWith('Z')) fail('VOID_EXPORT_ASOF_REQUIRED', 'The source export requires an explicit UTC as-of timestamp before any observation can be accepted');
  const exportAsOf = Date.parse(records.coverage.export_as_of_utc);
  const people = employeesById(records.employees), orders = new Map(), logicalOrderIds = new Set();
  for (const row of records.original_orders.records) {
    dated(row, scope);
    if (row.record_type !== 'original_order' || !text(row.original_order_id) || !whole(row.original_order_amount_cents) || !stamp(row.created_at)) fail('VOID_ORIGINAL_ORDER_INVALID', 'The denominator must contain identified original orders, not adjustments, with integer cents and timestamps', [row.id]);
    if (Date.parse(row.created_at) > exportAsOf) fail('VOID_AFTER_EXPORT', 'An original-order observation cannot occur after its source export instant', [row.id]);
    if (logicalOrderIds.has(row.original_order_id)) fail('VOID_DUPLICATE_ORDER', 'An original order can appear only once in the denominator', [row.original_order_id]);
    logicalOrderIds.add(row.original_order_id);
    employee(people, row.cashier_employee_id, row.id, 'cashier');
    orders.set(row.original_order_id, row);
  }
  const economicIds = new Set(), adjustmentsById = new Map();
  for (const row of records.adjustments.records) {
    dated(row, scope);
    const original = orders.get(row.original_order_id);
    if (!original || !['void', 'refund'].includes(row.kind) || !text(row.economic_adjustment_id) || !whole(row.amount_cents) || !stamp(row.occurred_at)) fail('VOID_ADJUSTMENT_INVALID', 'Each adjustment needs its original order, economic reference, type, integer amount and timestamp', [row.id]);
    if (Date.parse(row.occurred_at) > exportAsOf) fail('VOID_AFTER_EXPORT', 'A void/refund observation cannot occur after its source export instant', [row.id]);
    if (row.original_cashier_employee_id !== undefined && row.original_cashier_employee_id !== original.cashier_employee_id) fail('VOID_ATTRIBUTION_AMBIGUOUS', 'A conflicting original-cashier identity cannot be resolved from the void initiator', [row.id, original.id]);
    if (economicIds.has(row.economic_adjustment_id)) fail('VOID_DOUBLE_COUNT', 'A void and refund or repeated record cannot count the same economic adjustment twice', [row.economic_adjustment_id]);
    economicIds.add(row.economic_adjustment_id); adjustmentsById.set(row.id, row);
    if (Date.parse(row.occurred_at) < Date.parse(original.created_at) || row.business_date < original.business_date) fail('VOID_CHRONOLOGY_INVALID', 'An adjustment cannot precede its original order', [row.id, original.id]);
    employee(people, row.actor_employee_id, row.id);
    if (row.recorded_approver_employee_id !== null && row.recorded_approver_employee_id !== undefined) employee(people, row.recorded_approver_employee_id, row.id, 'manager');
  }
  for (const row of records.adjustments.records) {
    if (row.related_adjustment_id !== null && row.related_adjustment_id !== undefined) {
      const related = adjustmentsById.get(row.related_adjustment_id);
      if (!related || related.original_order_id !== row.original_order_id || related.kind !== row.kind) fail('VOID_REFUND_LINK_CONFLICT', 'A void/refund reversal or ambiguous related adjustment needs separate reconciliation; it cannot be counted as another positive void', [row.id, String(row.related_adjustment_id)]);
      fail('VOID_DOUBLE_COUNT', 'Related adjustment records require reconciliation before they enter this simple count', [row.id, related.id]);
    }
  }
  for (const [orderId, original] of orders) {
    const adjusted = records.adjustments.records.filter(row => row.original_order_id === orderId);
    if (adjusted.reduce((total, row) => total + BigInt(row.amount_cents), 0n) > BigInt(original.original_order_amount_cents)) fail('VOID_DOUBLE_COUNT', 'Total positive void/refund adjustments cannot exceed the original recorded order amount', [original.id, ...adjusted.map(row => row.id)]);
  }
  const periods = new Map();
  for (const row of records.coverage.records) { validPeriod(row, scope); periods.set(row.id, row); }
  const selected = periods.get(records.coverage.selected_period_id);
  if (!selected) fail('VOID_PERIOD_INVALID', 'Select an explicit coverage period source');
  if (!date(records.coverage.export_as_of_date) || records.coverage.export_as_of_date !== records.coverage.export_as_of_utc.slice(0, 10) || records.coverage.export_as_of_date <= selected.end_date) fail('VOID_INCOMPLETE_PERIOD', 'A selected weekly/monthly period must be closed before the explicit source export date');
  if (!text(selected.label)) fail('VOID_PERIOD_INVALID', 'The reporting period needs a human-readable label');
  const selectedOrders = [...orders.values()].filter(row => inside(row.business_date, selected));
  const selectedAdjustments = records.adjustments.records.filter(row => inside(row.business_date, selected));
  for (const row of selectedAdjustments) if (!inside(orders.get(row.original_order_id).business_date, selected)) fail('VOID_PERIOD_COHORT_MISMATCH', 'A current-period adjustment to an earlier-period original order needs a separately defined cohort denominator', [row.id]);
  const missing = [];
  if (selected.complete_original_orders !== true || selected.original_order_denominator_definition !== DENOMINATOR || !whole(selected.expected_original_order_count) || selected.expected_original_order_count !== selectedOrders.length || records.original_orders.extract_role !== 'ORIGINAL_ORDER_DENOMINATOR') missing.push({ code: 'COMPLETE_ORIGINAL_ORDER_DENOMINATOR_REQUIRED', request: 'Provide the complete distinct original-order extract for this exact period, with matching coverage counts. Employee rates are held.', source_ids: [records.coverage.id, selected.id, records.original_orders.id] });
  if (selected.complete_adjustments !== true || !whole(selected.expected_adjustment_count) || selected.expected_adjustment_count !== selectedAdjustments.length) missing.push({ code: 'COMPLETE_ADJUSTMENT_PERIOD_REQUIRED', request: 'Provide all original void and refund adjustments for this exact closed period. Totals and rankings are held.', source_ids: [selected.id, records.adjustments.id] });
  const periodComplete = missing.length === 0;
  const workflow = inspectWorkflow(records.workflow_events, orders, people, scope, exportAsOf);
  if (!inside(orders.get(records.workflow_events.original_order_id).business_date, selected)) fail('VOID_PERIOD_COHORT_MISMATCH', 'The displayed modifier chain must belong to the selected reporting period');
  missing.push(...workflow.missing);
  const period = { id: selected.id, kind: selected.kind, label: selected.label, period_start: selected.start_date, period_end: selected.end_date,
    denominator_complete: periodComplete, observed_original_order_count: selectedOrders.length, expected_original_order_count: selected.expected_original_order_count,
    observed_adjustment_count: selectedAdjustments.length, expected_adjustment_count: selected.expected_adjustment_count,
    export_as_of_utc: records.coverage.export_as_of_utc,
    original_order_denominator_definition: selected.original_order_denominator_definition, source_ids: [records.coverage.id, selected.id, records.original_orders.id, records.adjustments.id] };
  const voids = selectedAdjustments.filter(row => row.kind === 'void'), refunds = selectedAdjustments.filter(row => row.kind === 'refund');
  const employee_metrics = [], void_actor_metrics = [], candidates = [];
  let summary = null;
  if (periodComplete) {
    const cashiers = unique(selectedOrders.map(row => row.cashier_employee_id)).sort();
    for (const employeeId of cashiers) {
      const person = people.get(employeeId), originals = selectedOrders.filter(row => row.cashier_employee_id === employeeId), ids = new Set(originals.map(row => row.original_order_id));
      const recordedVoids = voids.filter(row => ids.has(row.original_order_id)), voidedOrders = new Set(recordedVoids.map(row => row.original_order_id));
      const metric = { employee_id: employeeId, display_name: person.display_name, attribution_role: 'original_order_cashier', cashier_original_order_count: originals.length,
        voided_order_count: voidedOrders.size, void_event_count: recordedVoids.length, void_amount_cents: sumCents(recordedVoids), void_order_rate_percent: rate(voidedOrders.size, originals.length),
        source_ids: unique([selected.id, person.id, ...originals.map(row => row.id), ...recordedVoids.map(row => row.id)]) };
      employee_metrics.push(metric);
      if (recordedVoids.length) candidates.push({ id: 'review-cashier-' + employeeId, kind: 'cashier_source_review', title: 'Review ' + person.display_name + "'s recorded order cohort",
        reason: metric.void_event_count + ' recorded void events across ' + metric.voided_order_count + ' of ' + metric.cashier_original_order_count + ' complete original orders; ' + money(metric.void_amount_cents, scope.currency) + '. Review original records, initiators and approvals. This does not establish cause or employee fault.',
        source_ids: metric.source_ids, human_review_required: true, employee_id: employeeId, recorded_void_cents: metric.void_amount_cents, void_order_rate_percent: metric.void_order_rate_percent });
    }
    for (const employeeId of unique(voids.map(row => row.actor_employee_id)).sort()) {
      const actorVoids = voids.filter(row => row.actor_employee_id === employeeId), person = people.get(employeeId);
      void_actor_metrics.push({ employee_id: employeeId, display_name: person.display_name, attribution_role: 'recorded_void_initiator', void_event_count: actorVoids.length,
        void_amount_cents: sumCents(actorVoids), approver_ids: unique(actorVoids.map(row => row.recorded_approver_employee_id).filter(Boolean)),
        missing_recorded_approver_count: actorVoids.filter(row => !row.recorded_approver_employee_id).length, void_order_rate_percent: null,
        source_ids: unique([selected.id, person.id, ...actorVoids.map(row => row.id)]) });
    }
    summary = { original_order_count: selectedOrders.length, voided_order_count: new Set(voids.map(row => row.original_order_id)).size, void_event_count: voids.length,
      void_amount_cents: sumCents(voids), void_order_rate_percent: rate(new Set(voids.map(row => row.original_order_id)).size, selectedOrders.length),
      refund_event_count: refunds.length, refund_amount_cents: sumCents(refunds) };
    candidates.sort((a, b) => b.recorded_void_cents - a.recorded_void_cents || b.void_order_rate_percent - a.void_order_rate_percent || a.employee_id.localeCompare(b.employee_id));
  }
  if (!periodComplete) candidates.push({ id: 'review-period-coverage', kind: 'period_coverage', title: 'Complete the original period export before ranking people', reason: 'The selected period is incomplete or its source counts do not match. No employee rates, totals or people ranking were accepted.', source_ids: period.source_ids, human_review_required: true });
  if (workflow.missing.length) candidates.unshift({ id: 'review-modifier-chain', kind: 'workflow_gap', title: 'Request the missing modifier event source', reason: 'Kitchen or handoff continuity is unknown until the missing original event is supplied. The observed records do not identify a cause or fault.', source_ids: workflow.result.source_ids, human_review_required: true });
  const facts = [{ title: 'Explicit reporting period', value: selected.label, source_ids: [selected.id] },
    { title: 'Original-order denominator', value: periodComplete ? selectedOrders.length + ' distinct complete original orders' : 'Incomplete source coverage; rates held', source_ids: period.source_ids },
    { title: 'Refunds kept separate', value: periodComplete ? refunds.length + ' recorded refunds; ' + money(sumCents(refunds), scope.currency) + ' excluded from void totals' : 'Refund and void totals held for complete source coverage', source_ids: [records.adjustments.id, ...refunds.map(row => row.id)] },
    { title: 'Modifier chain continuity', value: workflow.result.continuity_verified ? 'All four source-linked stages are recorded; cause remains unproven' : 'Unknown; a required original event is missing', source_ids: workflow.result.source_ids }];
  return { status: missing.length ? 'needs_evidence' : 'reconciled', proof_status: !periodComplete ? 'PERIOD_INCOMPLETE_RATES_HELD' : workflow.result.continuity_verified ? 'SYNTHETIC_PERIOD_COMPLETE_EVENT_CHAIN_LINKED' : 'PERIOD_COMPLETE_WORKFLOW_CONTINUITY_UNKNOWN',
    scope: { ...scope }, period, summary, employee_metrics, void_actor_metrics, ranked_review_candidates: candidates.map((candidate, index) => ({ rank: index + 1, ...candidate })),
    workflow: workflow.result, facts, evidence, missing_evidence: missing,
    trace: [{ stage: 'source_identity_and_scope', status: 'validated', source_count: evidence.length }, { stage: 'economic_adjustment_reconciliation', status: 'validated', refunds_added_to_voids: false },
      { stage: 'period_coverage', status: periodComplete ? 'complete_in_fictional_source' : 'held', source_ids: period.source_ids }, { stage: 'attribution', status: periodComplete ? 'cashier_initiator_approver_separated' : 'rates_and_rankings_held' },
      { stage: 'workflow_linkage', status: workflow.result.status, cause_established: false, source_ids: workflow.result.source_ids }], limitations: [...limitations], integration: { ...integration } };
}

export async function getVoidFixture(scenario = 'complete') {
  if (!['complete', 'incomplete-period', 'missing-kitchen-link', 'wrong-location', 'monthly'].includes(scenario)) fail('VOID_SCENARIO_UNSUPPORTED', 'Choose an explicit supported fictional void-proof scenario');
  const entries = await Promise.all(FAMILIES.map(async family => [family, JSON.parse(await readFile(new URL('../seed/void-proof/' + family + '.json', import.meta.url), 'utf8'))]));
  const records = Object.fromEntries(entries);
  if (scenario === 'incomplete-period') { records.coverage.records.find(row => row.id === records.coverage.selected_period_id).complete_original_orders = false; records.original_orders.records = records.original_orders.records.filter(row => row.original_order_id !== 'order-006'); }
  if (scenario === 'missing-kitchen-link') records.workflow_events.records = records.workflow_events.records.filter(row => row.stage !== 'kitchen_acknowledgment');
  if (scenario === 'wrong-location') records.adjustments.records[0].restaurant_id = 'demo-other-location';
  if (scenario === 'monthly') records.coverage.selected_period_id = 'period-month-2026-09';
  return records;
}
