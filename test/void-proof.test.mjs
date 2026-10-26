import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVoidProof, getVoidFixture, VOID_SCOPE } from '../src/void-proof.mjs';
import { EvidenceError } from '../src/reconcile.mjs';

const code = expected => error => error instanceof EvidenceError && error.code === expected;
const person = (result, employeeId) => result.employee_metrics.find(row => row.employee_id === employeeId);

test('complete week uses distinct original-order denominator, deduplicated void economic amounts and separate refunds', async () => {
  const result = analyzeVoidProof(await getVoidFixture());
  assert.equal(result.status, 'reconciled');
  assert.equal(result.period.period_start, '2026-09-21');
  assert.equal(result.period.period_end, '2026-09-27');
  assert.equal(result.period.denominator_complete, true);
  assert.deepEqual(result.summary, { original_order_count: 6, voided_order_count: 3, void_event_count: 4, void_amount_cents: 1700, void_order_rate_percent: 50, refund_event_count: 1, refund_amount_cents: 300 });
  const ava = person(result, 'employee-ava');
  assert.equal(ava.cashier_original_order_count, 3);
  assert.equal(ava.voided_order_count, 2);
  assert.equal(ava.void_event_count, 3);
  assert.equal(ava.void_amount_cents, 1500);
  assert.equal(ava.void_order_rate_percent, 66.67);
  assert.ok(ava.source_ids.includes('source-order-003'));
  assert.ok(ava.source_ids.includes('source-adjustment-002'));
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(result.integration.model_verified, false);
  assert.equal(result.integration.sponsor_integration_verified, false);
});

test('complete month selects its own closed original-order cohort and does not reuse weekly denominator', async () => {
  const result = analyzeVoidProof(await getVoidFixture('monthly'));
  assert.equal(result.period.kind, 'month');
  assert.equal(result.period.observed_original_order_count, 8);
  assert.equal(result.summary.void_amount_cents, 3200);
  assert.equal(result.summary.void_event_count, 5);
  assert.equal(person(result, 'employee-ava').void_order_rate_percent, 75);
  assert.equal(person(result, 'employee-charlie').void_order_rate_percent, 25);
});

test('original cashier, void initiator and recorded approver remain separate identities', async () => {
  const result = analyzeVoidProof(await getVoidFixture());
  assert.equal(person(result, 'employee-ben'), undefined);
  assert.equal(result.void_actor_metrics.length, 1);
  assert.equal(result.void_actor_metrics[0].employee_id, 'employee-ben');
  assert.equal(result.void_actor_metrics[0].void_event_count, 4);
  assert.equal(result.void_actor_metrics[0].void_amount_cents, 1700);
  assert.equal(result.void_actor_metrics[0].void_order_rate_percent, null);
  assert.deepEqual(result.void_actor_metrics[0].approver_ids, ['employee-ben']);
  const unknownApproval = await getVoidFixture(); unknownApproval.adjustments.records[0].recorded_approver_employee_id = null;
  assert.equal(analyzeVoidProof(unknownApproval).void_actor_metrics[0].missing_recorded_approver_count, 1);
});

test('incomplete period or count mismatch holds totals, rates and people rankings', async () => {
  const partial = analyzeVoidProof(await getVoidFixture('incomplete-period'));
  assert.equal(partial.status, 'needs_evidence');
  assert.equal(partial.proof_status, 'PERIOD_INCOMPLETE_RATES_HELD');
  assert.equal(partial.summary, null);
  assert.deepEqual(partial.employee_metrics, []);
  assert.deepEqual(partial.void_actor_metrics, []);
  assert.ok(partial.ranked_review_candidates.every(row => !row.employee_id));
  for (const key of ['complete_original_orders', 'complete_adjustments']) {
    const records = await getVoidFixture(); records.coverage.records[0][key] = false;
    assert.equal(analyzeVoidProof(records).summary, null);
  }
  for (const key of ['expected_original_order_count', 'expected_adjustment_count']) {
    const records = await getVoidFixture(); records.coverage.records[0][key] = 99;
    assert.equal(analyzeVoidProof(records).period.denominator_complete, false);
  }
});

test('a wrong denominator definition or non-original-order extract cannot manufacture a rate', async () => {
  const wrongDefinition = await getVoidFixture(); wrongDefinition.coverage.records[0].original_order_denominator_definition = 'ALL_POS_ROWS';
  assert.equal(analyzeVoidProof(wrongDefinition).summary, null);
  const wrongExtract = await getVoidFixture(); wrongExtract.original_orders.extract_role = 'ADJUSTMENT_ROWS';
  assert.equal(analyzeVoidProof(wrongExtract).summary, null);
  const refundAsOrder = await getVoidFixture(); refundAsOrder.original_orders.records[0].record_type = 'refund';
  assert.throws(() => analyzeVoidProof(refundAsOrder), code('VOID_ORIGINAL_ORDER_INVALID'));
});

test('complete modifier chain links all four source observations without a cause or fault claim', async () => {
  const result = analyzeVoidProof(await getVoidFixture());
  assert.equal(result.workflow.status, 'linked');
  assert.equal(result.workflow.continuity_verified, true);
  assert.equal(result.workflow.stages.length, 4);
  assert.equal(result.workflow.stages[1].actor_employee_id, null);
  assert.equal(result.workflow.stages[1].actor_display_name, 'Synthetic POS');
  assert.equal(result.workflow.stages[2].parent_event_id, result.workflow.stages[1].source_id);
  assert.equal(result.workflow.cause_or_employee_fault_established, false);
});

test('missing kitchen acknowledgment or handoff means unknown continuity, not a failed employee', async () => {
  const missing = analyzeVoidProof(await getVoidFixture('missing-kitchen-link'));
  assert.equal(missing.status, 'needs_evidence');
  assert.equal(missing.proof_status, 'PERIOD_COMPLETE_WORKFLOW_CONTINUITY_UNKNOWN');
  assert.equal(missing.period.denominator_complete, true);
  assert.equal(missing.summary.void_amount_cents, 1700);
  assert.equal(missing.workflow.continuity_verified, false);
  assert.equal(missing.workflow.stages[2].observed, false);
  assert.equal(missing.workflow.stages[3].observed, true);
  assert.equal(missing.workflow.cause_or_employee_fault_established, false);
  const handoff = await getVoidFixture(); handoff.workflow_events.records = handoff.workflow_events.records.filter(row => row.stage !== 'handoff');
  assert.equal(analyzeVoidProof(handoff).workflow.status, 'unknown');
});

test('wrong location, source period or currency is refused before arithmetic', async () => {
  for (const [field, value] of [['restaurant_id', 'other'], ['period_end', '2026-10-01'], ['currency', 'EUR']]) {
    const records = await getVoidFixture(); records.adjustments.records[0][field] = value;
    assert.throws(() => analyzeVoidProof(records), code('VOID_SCOPE_MISMATCH'));
  }
  const wrong = await getVoidFixture('wrong-location');
  assert.throws(() => analyzeVoidProof(wrong), code('VOID_SCOPE_MISMATCH'));
  const dateOutside = await getVoidFixture(); dateOutside.original_orders.records[0].business_date = '2026-10-01';
  assert.throws(() => analyzeVoidProof(dateOutside), code('VOID_PERIOD_MISMATCH'));
  const clean = await getVoidFixture();
  assert.throws(() => analyzeVoidProof(clean, { ...VOID_SCOPE, id: 'override-source-id' }), code('VOID_SCOPE_INVALID'));
});

test('duplicate source IDs, repeated original orders and repeated economic void/refund references are refused', async () => {
  const duplicateId = await getVoidFixture(); duplicateId.adjustments.records[1].id = duplicateId.adjustments.records[0].id;
  assert.throws(() => analyzeVoidProof(duplicateId), code('VOID_DUPLICATE_SOURCE'));
  const duplicateOrder = await getVoidFixture(); duplicateOrder.original_orders.records.push({ ...duplicateOrder.original_orders.records[0], id: 'another-source-same-order' });
  assert.throws(() => analyzeVoidProof(duplicateOrder), code('VOID_DUPLICATE_ORDER'));
  const duplicateEconomic = await getVoidFixture(); duplicateEconomic.adjustments.records[4].economic_adjustment_id = duplicateEconomic.adjustments.records[0].economic_adjustment_id;
  assert.throws(() => analyzeVoidProof(duplicateEconomic), code('VOID_DOUBLE_COUNT'));
});

test('a linked refund reversal and amounts exceeding the original order require separate reconciliation', async () => {
  const reversal = await getVoidFixture();
  reversal.adjustments.records[1].kind = 'refund';
  reversal.adjustments.records[1].related_adjustment_id = reversal.adjustments.records[0].id;
  assert.throws(() => analyzeVoidProof(reversal), code('VOID_REFUND_LINK_CONFLICT'));
  const exceeded = await getVoidFixture(); exceeded.adjustments.records[0].amount_cents = 2000;
  assert.throws(() => analyzeVoidProof(exceeded), code('VOID_DOUBLE_COUNT'));
});

test('unknown original orders, ambiguous actors and conflicting cashier attribution are refused', async () => {
  const unknownOrder = await getVoidFixture(); unknownOrder.adjustments.records[0].original_order_id = 'order-not-in-source';
  assert.throws(() => analyzeVoidProof(unknownOrder), code('VOID_ADJUSTMENT_INVALID'));
  const unknownActor = await getVoidFixture(); unknownActor.adjustments.records[0].actor_employee_id = null;
  assert.throws(() => analyzeVoidProof(unknownActor), code('VOID_ATTRIBUTION_AMBIGUOUS'));
  const cashier = await getVoidFixture(); cashier.original_orders.records[0].cashier_employee_id = 'employee-ben';
  assert.throws(() => analyzeVoidProof(cashier), code('VOID_ATTRIBUTION_AMBIGUOUS'));
  const conflict = await getVoidFixture(); conflict.adjustments.records[0].original_cashier_employee_id = 'employee-charlie';
  assert.throws(() => analyzeVoidProof(conflict), code('VOID_ATTRIBUTION_AMBIGUOUS'));
  const duplicateIdentity = await getVoidFixture(); duplicateIdentity.employees.records.push({ ...duplicateIdentity.employees.records[0], id: 'second-identity-source' });
  assert.throws(() => analyzeVoidProof(duplicateIdentity), code('VOID_ATTRIBUTION_AMBIGUOUS'));
});

test('same display names do not merge different source employee IDs', async () => {
  const records = await getVoidFixture(); records.employees.records[1].display_name = records.employees.records[0].display_name;
  const result = analyzeVoidProof(records);
  assert.equal(result.employee_metrics.length, 2);
  assert.notEqual(result.employee_metrics[0].employee_id, result.employee_metrics[1].employee_id);
  assert.notEqual(result.employee_metrics[0].void_amount_cents, result.employee_metrics[1].void_amount_cents);
});

test('wrong event parents, order IDs, modifier IDs or duplicate stages refuse invented continuity', async () => {
  for (const [key, value] of [['parent_event_id', 'event-modifier-request'], ['original_order_id', 'order-002'], ['modifier_id', 'another-modifier']]) {
    const records = await getVoidFixture(); records.workflow_events.records[2][key] = value;
    assert.throws(() => analyzeVoidProof(records), code('VOID_WORKFLOW_LINK_INVALID'));
  }
  const repeated = await getVoidFixture(); repeated.workflow_events.records.push({ ...repeated.workflow_events.records[2], id: 'second-kitchen-event' });
  assert.throws(() => analyzeVoidProof(repeated), code('VOID_WORKFLOW_LINK_INVALID'));
});

test('invalid chronology and impossible calendar timestamps are refused', async () => {
  const reversed = await getVoidFixture(); reversed.workflow_events.records[2].occurred_at = '2026-09-22T10:01:30Z';
  assert.throws(() => analyzeVoidProof(reversed), code('VOID_CHRONOLOGY_INVALID'));
  const early = await getVoidFixture(); early.adjustments.records[0].occurred_at = '2026-09-22T09:00:00Z';
  assert.throws(() => analyzeVoidProof(early), code('VOID_CHRONOLOGY_INVALID'));
  const impossible = await getVoidFixture(); impossible.workflow_events.records[2].occurred_at = '2026-09-31T10:03:00Z';
  assert.throws(() => analyzeVoidProof(impossible), code('VOID_CHRONOLOGY_INVALID'));
  const badOriginal = await getVoidFixture(); badOriginal.original_orders.records[0].created_at = '2026-02-30T10:00:00Z';
  assert.throws(() => analyzeVoidProof(badOriginal), code('VOID_ORIGINAL_ORDER_INVALID'));
});

test('orders, refunds and workflow observations cannot occur after the explicit UTC source export', async () => {
  const futureChain = await getVoidFixture();
  for (const row of futureChain.workflow_events.records) row.occurred_at = row.occurred_at.replace('2026-09-22', '2026-10-10');
  assert.throws(() => analyzeVoidProof(futureChain), code('VOID_AFTER_EXPORT'));
  const futureRefund = await getVoidFixture(); futureRefund.adjustments.records[4].occurred_at = '2026-10-10T10:05:00Z';
  assert.throws(() => analyzeVoidProof(futureRefund), code('VOID_AFTER_EXPORT'));
  const futureOrder = await getVoidFixture(); futureOrder.original_orders.records[7].created_at = '2026-10-10T10:00:00Z';
  assert.throws(() => analyzeVoidProof(futureOrder), code('VOID_AFTER_EXPORT'));
  const missingAsOf = await getVoidFixture(); delete missingAsOf.coverage.export_as_of_utc;
  assert.throws(() => analyzeVoidProof(missingAsOf), code('VOID_EXPORT_ASOF_REQUIRED'));
  const explicit = analyzeVoidProof(await getVoidFixture());
  assert.equal(explicit.period.export_as_of_utc, '2026-10-01T12:00:00Z');
});

test('partial weeks, incomplete months, open periods and cross-period numerator cohorts are refused', async () => {
  const shortWeek = await getVoidFixture(); shortWeek.coverage.records[0].end_date = '2026-09-26';
  assert.throws(() => analyzeVoidProof(shortWeek), code('VOID_PERIOD_INVALID'));
  const shortMonth = await getVoidFixture(); shortMonth.coverage.records[1].end_date = '2026-09-29';
  assert.throws(() => analyzeVoidProof(shortMonth), code('VOID_PERIOD_INVALID'));
  const open = await getVoidFixture(); open.coverage.export_as_of_date = '2026-09-27';
  assert.throws(() => analyzeVoidProof(open), code('VOID_INCOMPLETE_PERIOD'));
  const earlierOrder = await getVoidFixture(); earlierOrder.adjustments.records[5].business_date = '2026-09-22'; earlierOrder.adjustments.records[5].occurred_at = '2026-09-22T10:09:00Z';
  assert.throws(() => analyzeVoidProof(earlierOrder), code('VOID_PERIOD_COHORT_MISMATCH'));
});

test('integer cents, cumulative amounts and safe output range cannot overflow silently', async () => {
  for (const value of [-1, 10.5, Number.MAX_SAFE_INTEGER + 1]) {
    const records = await getVoidFixture(); records.adjustments.records[0].amount_cents = value;
    assert.throws(() => analyzeVoidProof(records), code('VOID_ADJUSTMENT_INVALID'));
  }
  const huge = await getVoidFixture();
  huge.original_orders.records[0].original_order_amount_cents = Number.MAX_SAFE_INTEGER;
  huge.original_orders.records[1].original_order_amount_cents = Number.MAX_SAFE_INTEGER;
  huge.adjustments.records[0].amount_cents = Number.MAX_SAFE_INTEGER;
  huge.adjustments.records[1].amount_cents = 0;
  huge.adjustments.records[2].amount_cents = Number.MAX_SAFE_INTEGER;
  assert.throws(() => analyzeVoidProof(huge), code('VOID_OVERFLOW'));
});

test('deterministic review candidates carry exact source references and no accusation', async () => {
  const result = analyzeVoidProof(await getVoidFixture());
  assert.equal(result.ranked_review_candidates[0].employee_id, 'employee-ava');
  const available = new Set(result.evidence.map(row => row.id));
  for (const candidate of result.ranked_review_candidates) {
    assert.equal(candidate.human_review_required, true);
    assert.ok(candidate.source_ids.every(id => available.has(id)));
    assert.match(candidate.reason, /does not establish cause or employee fault/);
  }
  assert.ok(result.limitations.some(value => value.includes('not proof of theft, financial loss, employee fault')));
});

test('fixture reads are isolated and only explicit scenarios are supported', async () => {
  const first = await getVoidFixture(), second = await getVoidFixture(); first.adjustments.records[0].amount_cents = 1;
  assert.equal(second.adjustments.records[0].amount_cents, 200);
  await assert.rejects(getVoidFixture('invented'), code('VOID_SCENARIO_UNSUPPORTED'));
});
