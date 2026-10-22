import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { investigate } from '../src/investigate.mjs';
import { rememberCorrection } from '../src/memory.mjs';
import { SCOPE } from '../src/reconcile.mjs';
const salesId = JSON.parse(await readFile(new URL('../seed/sources/sales.json', import.meta.url))).records[0].id;
function stubModel(json) {
  return { model: 'meterless/test-stub', discover: async () => ({ status: 'online', verified: true, models: ['meterless/test-stub'] }), json };
}
test('deterministic preview never claims sponsor query or model integration', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-preview-'));
  const result = await investigate({}, { memoryRoot });
  assert.equal(result.metrics.gap_cents, 60000); assert.equal(result.integration.zetaris, false);
  assert.equal(result.integration.nightshift_text, false); assert.equal(result.integration.competition_ready, false);
});
test('agent orchestration retries a rejected explanation then escalates; stub is not sponsor evidence', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-agent-'));
  const calls = [];
  const model = { model: 'meterless/test-stub', discover: async () => ({ status: 'online', verified: true, models: ['meterless/test-stub'] }), json: async (role, instruction, packet) => {
    calls.push(role);
    if (instruction.startsWith('Plan')) return { value: { source_order: ['labor', 'sales', 'policy'], reason: 'Question about labor' } };
    if (role === 'evidence_critic') return { value: { accepted: false, issues: ['Unsupported cause'], missing_evidence: ['approval record'] } };
    return { value: { claims: [{ text: 'Unsupported cause', source_ids: ['invented'], metric_refs: [] }], next_check: 'Verify approval.' } };
  } };
  const result = await investigate({ liveModel: true }, { model, memoryRoot });
  assert.equal(result.analysis, null); assert.match(result.mode, /Escalated/);
  assert.deepEqual(calls, ['investigator', 'investigator', 'evidence_critic', 'investigator', 'evidence_critic']);
  assert.equal(result.integration.competition_ready, false);
  assert.equal(result.evidence_review.status, 'rejected');
  assert.equal(result.evidence_requests[0].record, 'approval record');
  assert.equal(result.evidence_requests[0].scope.shift_id, SCOPE.shift_id);
  assert.ok(result.trace.some(row => row.stage === 'request_missing_evidence' && row.tools_exhausted === true));
});
test('a critique rejection changes the second explanation request and only a clean review accepts it', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-retry-'));
  let explanations = 0;
  const model = stubModel(async (role, instruction, packet) => {
    if (instruction.startsWith('Plan')) return { value: { source_order: ['policy', 'sales', 'labor'] } };
    if (role === 'investigator') {
      explanations++;
      if (explanations === 2) {
        assert.equal(packet.critic_feedback.evidence_requests[0].record, 'Manager approval');
        assert.equal(packet.critic_feedback.evidence_requests[0].status, 'not_available_in_current_sources');
        assert.equal(packet.source_records.manager_approval, undefined);
      }
      return { value: { claims: [{ text: explanations === 1 ? 'The sales record proves training approval.' : 'The sales record reports synthetic sales; training approval remains unavailable.', source_ids: [salesId], metric_refs: [] }], next_check: 'Ask for the shift approval record.' } };
    }
    return { value: explanations === 1 ? { accepted: false, issues: ['The sales record cannot establish training approval.'], missing_evidence: ['Manager approval'] } : { accepted: true, issues: [], missing_evidence: [] } };
  });
  const result = await investigate({ liveModel: true }, { model, memoryRoot });
  assert.equal(explanations, 2);
  assert.ok(result.analysis);
  assert.equal(result.evidence_review.status, 'accepted_by_model_critic');
  assert.equal(result.evidence_review.semantic_support, 'model_reviewed_not_independent_verification');
  assert.deepEqual(result.evidence_requests, []);
  assert.deepEqual(result.trace.filter(row => row.role === 'source').map(row => row.source_id.split('-')[0]), ['policy', 'sales', 'labor']);
  assert.equal(result.proposed_action.status, 'unsent proposal');
  assert.equal(result.integration.competition_ready, false);
});
test('an approving critic cannot bypass a missing or invented citation', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-citations-'));
  for (const claim of [{ text: 'The gap has an unsupported source.', source_ids: ['invented'], metric_refs: [] }, { text: '   ', source_ids: [salesId], metric_refs: [] }]) {
    const model = stubModel(async (role, instruction) => ({ value: instruction.startsWith('Plan') ? { source_order: ['sales', 'labor', 'policy'] } : role === 'evidence_critic' ? { accepted: true, issues: [], missing_evidence: [] } : { claims: [claim], next_check: 'Check approval.' } }));
    const result = await investigate({ liveModel: true }, { model, memoryRoot });
    assert.equal(result.analysis, null);
    assert.equal(result.evidence_review.citations_valid, false);
    assert.match(result.mode, /Escalated/);
  }
});
test('missing wages produce a scoped evidence request and no model dollar explanation', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-missing-'));
  let plans = 0;
  const model = stubModel(async (_role, instruction) => {
    assert.ok(instruction.startsWith('Plan'), 'Only a source plan may run when payroll dollars are absent');
    plans++;
    return { value: { source_order: ['labor', 'policy', 'sales'] } };
  });
  const result = await investigate({ liveModel: true, scenario: 'missing-wages' }, { model, memoryRoot });
  assert.equal(plans, 1);
  assert.equal(result.metrics, null);
  assert.equal(result.analysis, null);
  assert.equal(result.integration.nightshift_text, true, 'The source planning text returned even though the dollar conclusion is held');
  assert.equal(result.evidence_review.status, 'blocked_by_missing_records');
  assert.match(result.evidence_requests[0].record, /wage\/payroll/);
});
test('a Nightshift text failure cannot become an accepted conclusion', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-failure-'));
  const model = stubModel(async (_role, instruction) => {
    if (instruction.startsWith('Plan')) return { value: { source_order: ['sales', 'labor', 'policy'] } };
    throw Object.assign(new Error('Runtime authorization expired'), { code: 'MODEL_UNAUTHORIZED' });
  });
  await assert.rejects(investigate({ liveModel: true }, { model, memoryRoot }), error => error.code === 'MODEL_UNAUTHORIZED');
});
test('a malformed approving critic response is held for review instead of accepted', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-malformed-'));
  const model = stubModel(async (role, instruction) => ({ value: instruction.startsWith('Plan') ? { source_order: ['sales', 'labor', 'policy'] } : role === 'evidence_critic' ? { accepted: true, issues: [], missing_evidence: 'none' } : { claims: [{ text: 'The synthetic sales record is available.', source_ids: [salesId], metric_refs: [] }], next_check: 'Check approval.' } }));
  const result = await investigate({ liveModel: true }, { model, memoryRoot });
  assert.equal(result.analysis, null);
  assert.equal(result.evidence_review.critic_response_valid, false);
  assert.match(result.evidence_requests[0].record, /valid evidence critic response/);
});
test('recalled manager report remains unverified input and never replaces payroll', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-provenance-'));
  const note = JSON.parse(await readFile(new URL('../seed/sources/manager_correction.json', import.meta.url))).records[0];
  await rememberCorrection(SCOPE, note, memoryRoot);
  const model = stubModel(async (role, instruction, packet) => {
    if (instruction.startsWith('Plan')) return { value: { source_order: ['labor', 'sales', 'policy'] } };
    assert.equal(packet.manager_reports[0].classification, 'UNVERIFIED_MANAGER_REPORT');
    assert.equal(packet.manager_reports[0].payroll_overridden, false);
    assert.equal(packet.manager_reports[0].scope.shift_id, SCOPE.shift_id);
    assert.equal(packet.source_records.labor.actual_labor_cents, 396000);
    assert.equal(packet.deterministic_result.metrics.gap_cents, 60000);
    return { value: role === 'evidence_critic' ? { accepted: true, issues: [], missing_evidence: [] } : { claims: [{ text: 'The manager reports training; the statement remains unverified.', source_ids: [note.id], metric_refs: [] }], next_check: 'Verify training against the approval record.' } };
  });
  const result = await investigate({ liveModel: true }, { model, memoryRoot });
  assert.ok(result.analysis);
  assert.equal(result.metrics.actual_labor_cents, 396000);
  assert.equal(result.corrections[0].note.classification, 'UNVERIFIED_MANAGER_REPORT');
});
function metricReference(fact, changes = {}) {
  return { key: fact.key, value: fact.value, unit: fact.unit, scope: { ...fact.scope }, ...changes };
}
function numericStub(candidate) {
  return stubModel(async (role, instruction, packet) => ({ value: instruction.startsWith('Plan') ? { source_order: ['labor', 'sales', 'policy'] } : role === 'evidence_critic' ? { accepted: true, issues: [], missing_evidence: [] } : candidate(packet) }));
}
test('a wrong gap with valid source citations cannot pass an approving model critic', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-numeric-gap-'));
  const model = numericStub(packet => {
    const gap = packet.metric_catalog['metrics.gap_cents'];
    assert.equal(gap.value, 60000);
    return { claims: [{ text: 'The labor gap is reconciled.', source_ids: gap.source_ids, metric_refs: [metricReference(gap, { value: 90000 })] }], next_check: 'Verify approval.' };
  });
  const result = await investigate({ liveModel: true }, { model, memoryRoot });
  assert.equal(result.analysis, null);
  assert.equal(result.evidence_review.citations_valid, true);
  assert.equal(result.evidence_review.numeric_claims_valid, false);
  assert.ok(result.evidence_review.numeric_issues.some(issue => issue.code === 'METRIC_VALUE_MISMATCH'));
  assert.equal(result.metrics.gap_cents, 60000);
  assert.match(result.mode, /Escalated/);
});
test('exact structured gap and bridge values pass with their complete source coverage', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-numeric-valid-'));
  const model = numericStub(packet => {
    const facts = ['metrics.gap_cents', 'bridge.sales_denominator_effect_cents', 'bridge.labor_change_cents'].map(key => packet.metric_catalog[key]);
    return { claims: facts.map(fact => ({ text: 'This component follows the deterministic reconciliation.', source_ids: fact.source_ids, metric_refs: [metricReference(fact)] })), next_check: 'Check approval and time records.' };
  });
  const result = await investigate({ liveModel: true }, { model, memoryRoot });
  assert.equal(result.evidence_review.numeric_claims_valid, true);
  assert.deepEqual(result.analysis.claims.map(claim => claim.metric_refs[0].value), [60000, 42000, 18000]);
  assert.equal(result.integration.competition_ready, false);
});
test('metric units, scope, keys and source coverage are validated outside the critic', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-numeric-scope-'));
  for (const [expectedCode, mutate] of [
    ['METRIC_UNIT_MISMATCH', (fact) => metricReference(fact, { unit: 'USD_dollars' })],
    ['METRIC_SCOPE_MISMATCH', (fact) => metricReference(fact, { scope: { ...SCOPE, restaurant_id: 'other-location' } })],
    ['UNKNOWN_METRIC', (fact) => metricReference(fact, { key: 'metrics.recovered_savings_cents' })],
    ['METRIC_SOURCE_COVERAGE', (fact) => metricReference(fact)]
  ]) {
    const model = numericStub(packet => {
      const fact = packet.metric_catalog['metrics.gap_cents'];
      return { claims: [{ text: 'The gap is reconciled.', source_ids: expectedCode === 'METRIC_SOURCE_COVERAGE' ? [salesId] : fact.source_ids, metric_refs: [mutate(fact)] }], next_check: 'Verify approval.' };
    });
    const result = await investigate({ liveModel: true }, { model, memoryRoot });
    assert.equal(result.analysis, null, expectedCode);
    assert.ok(result.evidence_review.numeric_issues.some(issue => issue.code === expectedCode), expectedCode);
  }
});
test('unstructured quantities cannot override correct references or omit the required numeric schema', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-numeric-prose-'));
  for (const [text, omitRefs, expectedCode] of [
    ['The gap is $900.', false, 'QUANTITY_MUST_USE_METRIC_REF'],
    ['The gap is nine hundred dollars.', false, 'QUANTITY_MUST_USE_METRIC_REF'],
    ['The gap is reconciled.', true, 'METRIC_REFS_REQUIRED']
  ]) {
    const model = numericStub(packet => {
      const fact = packet.metric_catalog['metrics.gap_cents'];
      return { claims: [{ text, source_ids: fact.source_ids, ...(!omitRefs ? { metric_refs: [metricReference(fact)] } : {}) }], next_check: 'Verify approval.' };
    });
    const result = await investigate({ liveModel: true }, { model, memoryRoot });
    assert.equal(result.analysis, null);
    assert.ok(result.evidence_review.numeric_issues.some(issue => issue.code === expectedCode));
  }
});
test('zero sales cannot acquire an invented labor percentage through a model reference', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-numeric-zero-'));
  const model = numericStub(packet => {
    const fact = packet.metric_catalog['metrics.actual_labor_percent'];
    assert.equal(fact.available, false);
    return { claims: [{ text: 'The labor percentage is available.', source_ids: fact.source_ids, metric_refs: [metricReference(fact, { value: 0 })] }], next_check: 'Review the sales record.' };
  });
  const result = await investigate({ liveModel: true, scenario: 'zero-sales' }, { model, memoryRoot });
  assert.equal(result.metrics.actual_labor_percent, null);
  assert.equal(result.analysis, null);
  assert.ok(result.evidence_review.numeric_issues.some(issue => issue.code === 'METRIC_UNAVAILABLE'));
});
