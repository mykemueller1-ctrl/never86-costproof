import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { investigate } from '../src/investigate.mjs';
import { rememberCorrection } from '../src/memory.mjs';
import { SCOPE } from '../src/reconcile.mjs';
import { readFixture } from '../src/sources.mjs';

const root = () => mkdtemp(path.join(tmpdir(), 'costproof-typed-stub-'));
const approve = { accepted: true, issues: [], missing_evidence: [] };
function selection(packet, keys = ['metrics.gap_cents'], next = {}) {
  return { claims: [keys.length === 2 ? { kind: 'accounting_bridge', component_key: keys[1] } : { kind: 'metric_observation', metric_key: keys[0] }],
    limitation_ids: Object.keys(packet.decision_options.required_limitations), next_check: { kind: 'verify_shift_approval_and_time_records', report_ids: [], ...next } };
}
// Injected model decisions only, never actual sponsor inference.
function stub(explain = packet => selection(packet), review = () => approve, plan = () => ['sales', 'labor', 'policy']) {
  return { model: 'meterless/test-stub', discover: async () => ({ status: 'online', verified: true, models: ['meterless/test-stub'] }),
    json: async (role, instruction, packet) => ({ route: 'meterless/test-stub', model_text_returned: true,
      value: instruction.startsWith('Plan') ? { source_order: plan(packet) } : role === 'evidence_critic' ? await review(packet) : await explain(packet) }) };
}
test('deterministic preview does not claim a source query or model integration', async () => {
  const r = await investigate({}, { memoryRoot: await root() });
  assert.equal(r.metrics.gap_cents, 60000); assert.equal(r.integration.zetaris, false);
  assert.equal(r.integration.nightshift_text, false); assert.equal(r.integration.competition_ready, false);
});
test('critic feedback changes the second typed choice without fabricating the requested record', async () => {
  let attempts = 0;
  const model = stub(packet => {
    if (++attempts === 2) {
      assert.equal(packet.critic_feedback.evidence_requests[0].record, 'Manager approval');
      assert.equal(packet.critic_feedback.evidence_requests[0].status, 'not_available_in_current_sources');
      assert.equal(packet.source_records.manager_approval, undefined);
    }
    return selection(packet, attempts === 1 ? ['metrics.target_percent'] : ['metrics.gap_cents', 'bridge.sales_denominator_effect_cents']);
  }, () => attempts === 1 ? { accepted: false, issues: ['Select the relevant gap.'], missing_evidence: ['Manager approval'] } : approve,
  () => ['policy', 'sales', 'labor']);
  const r = await investigate({ liveModel: true }, { model, memoryRoot: await root() });
  assert.equal(attempts, 2); assert.equal(r.evidence_review.attempts, 2); assert.equal(r.evidence_review.typed_decision_valid, true);
  assert.equal(r.analysis.rendering, 'code_from_validated_model_selection');
  assert.deepEqual(r.trace.filter(x => x.role === 'source').map(x => x.source_id.split('-')[0]), ['policy', 'sales', 'labor']);
  assert.deepEqual(r.evidence_requests, []); assert.equal(r.proposed_action.status, 'unsent proposal');
  assert.equal(r.proposed_action.text, r.analysis.next_check);
});
test('two rejected reviews escalate with scoped unresolved evidence', async () => {
  const r = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(undefined,
    () => ({ accepted: false, issues: ['Approval unavailable.'], missing_evidence: ['approval record'] })) });
  assert.equal(r.analysis, null); assert.equal(r.evidence_review.attempts, 2); assert.match(r.mode, /Escalated/);
  assert.equal(r.evidence_requests[0].record, 'approval record'); assert.equal(r.evidence_requests[0].scope.shift_id, SCOPE.shift_id);
  assert.ok(r.trace.some(x => x.stage === 'request_missing_evidence' && x.tools_exhausted === true));
});
test('missing wages allow only the plan stage and retain an explicit dollar hold', async () => {
  let plans = 0;
  const model = stub(() => { throw Error('No explanation'); }, () => { throw Error('No critic'); }, () => { plans++; return ['labor', 'policy', 'sales']; });
  const r = await investigate({ liveModel: true, scenario: 'missing-wages' }, { model, memoryRoot: await root() });
  assert.equal(plans, 1); assert.equal(r.metrics, null); assert.equal(r.analysis, null);
  assert.equal(r.integration.nightshift_text, true); assert.equal(r.evidence_review.status, 'blocked_by_missing_records');
  assert.match(r.evidence_requests[0].record, /wage\/payroll/);
});
test('runtime authorization errors propagate without fallback', async () => {
  await assert.rejects(investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(() => {
    throw Object.assign(Error('expired'), { code: 'MODEL_UNAUTHORIZED' });
  }) }), e => e.code === 'MODEL_UNAUTHORIZED');
});
test('code renders exact bridge quantities and preserves the original raw choice', async () => {
  let raw;
  const r = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(packet => {
    raw = selection(packet, ['metrics.gap_cents', 'bridge.labor_change_cents']); return structuredClone(raw);
  }, packet => {
    assert.deepEqual(packet.model_decision, raw); assert.match(packet.candidate.claims[0].text, /\$600\.00 above target/);
    assert.match(packet.candidate.claims[0].text, /\+\$180\.00/); assert.deepEqual(packet.candidate.limitations, packet.deterministic_result.limitations); return approve;
  }) });
  assert.deepEqual(r.trace.find(x => x.stage === 'explanation').value, raw); assert.equal(raw.claims[0].text, undefined);
  assert.notDeepEqual(r.analysis, raw); assert.deepEqual(r.analysis.limitations, r.limitations);
  assert.match(r.analysis.claims[0].text, /cause remains unverified/); assert.equal(r.evidence_review.numeric_claims_valid, true);
});
test('an approving critic cannot admit freeform time/causal prose or unsupported action kinds', async () => {
  for (const mutate of [
    v => { v.claims[0].text = 'Labor time was above target due to additional labor costs.'; },
    v => { v.next_check = 'Cut staff tomorrow; the report proves the cause.'; },
    v => { v.claims[0].kind = 'verified_training_cause'; }, v => { v.next_check.kind = 'mark_paid'; }, v => { v.claims[0].metric_refs = []; }
  ]) {
    let critics = 0;
    const r = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(packet => {
      const v = selection(packet); mutate(v); return v;
    }, () => { critics++; return approve; }) });
    assert.equal(critics, 2); assert.equal(r.analysis, null); assert.equal(r.evidence_review.typed_decision_valid, false); assert.match(r.mode, /Escalated/);
  }
});
test('generated numeric, unit, scope and source payloads are refused rather than copied or repaired', async () => {
  for (const mutate of [
    v => { v.claims[0].value = 90000; }, v => { v.claims[0].unit = 'USD_dollars'; },
    v => { v.claims[0].scope = { restaurant_id: 'other' }; }, v => { v.claims[0].metric_refs = [{ key: 'metrics.gap_cents', value: 90000 }]; },
    v => { v.claims[0].source_ids = ['invented']; }
  ]) {
    const r = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(packet => { const v = selection(packet); mutate(v); return v; }) });
    assert.equal(r.analysis, null); assert.equal(r.metrics.gap_cents, 60000);
    assert.ok(r.evidence_review.decision_issues.some(x => x.code === 'CLAIM_SCHEMA'));
    assert.ok(r.trace.filter(x => x.role === 'fact_binding').every(x => x.claims.length === 0));
  }
});
test('missing, duplicate and unknown limitation IDs cannot pass an approving critic', async () => {
  for (const mutate of [ids => ids.slice(1), ids => [ids[0], ids[0], ids[2]], ids => [...ids.slice(0, -1), 'cause_proven']]) {
    const r = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(packet => {
      const v = selection(packet); v.limitation_ids = mutate(v.limitation_ids); return v;
    }) });
    assert.equal(r.analysis, null); assert.equal(r.evidence_review.limitations_bound, false);
    assert.ok(r.evidence_review.decision_issues.some(x => x.code === 'LIMITATIONS_REQUIRED'));
  }
});
test('remembered report checks require a scoped unverified report and never change payroll or infer its topic', async () => {
  const memoryRoot = await root(), note = JSON.parse(await readFile(new URL('../seed/sources/manager_correction.json', import.meta.url))).records[0];
  await rememberCorrection(SCOPE, note, memoryRoot);
  const r = await investigate({ liveModel: true }, { memoryRoot, model: stub(packet => {
    assert.equal(packet.manager_reports[0].classification, 'UNVERIFIED_MANAGER_REPORT'); assert.equal(packet.manager_reports[0].payroll_overridden, false);
    assert.equal(packet.source_records.labor.actual_labor_cents, 396000);
    return selection(packet, ['metrics.gap_cents'], { kind: 'verify_manager_report', report_ids: [note.id] });
  }) });
  assert.ok(r.analysis); assert.equal(r.metrics.actual_labor_cents, 396000); assert.deepEqual(r.analysis.next_check_report_ids, [note.id]);
  assert.match(r.analysis.next_check, /report and cause remain unverified/); assert.doesNotMatch(r.analysis.next_check, /training/);
  const absent = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(packet => selection(packet, ['metrics.gap_cents'], { kind: 'verify_manager_report', report_ids: [note.id] })) });
  assert.equal(absent.analysis, null); assert.equal(absent.evidence_review.next_check_valid, false);
});
test('zero sales binds its extra limitation and cannot acquire an invented ratio', async () => {
  const r = await investigate({ liveModel: true, scenario: 'zero-sales' }, { memoryRoot: await root(), model: stub() });
  assert.ok(r.analysis); assert.ok(r.analysis.limitation_ids.includes('zero_sales_percentage_unavailable'));
  assert.deepEqual(r.analysis.limitations, r.limitations);
  const bad = await investigate({ liveModel: true, scenario: 'zero-sales' }, { memoryRoot: await root(), model: stub(packet => {
    assert.equal(packet.metric_catalog['metrics.actual_labor_percent'].available, false);
    return selection(packet, ['metrics.actual_labor_percent']);
  }) });
  assert.equal(bad.analysis, null); assert.ok(bad.evidence_review.numeric_issues.some(x => x.code === 'METRIC_UNAVAILABLE'));
});
test('compact evidence packet retains actual source rows and every exact internal guard fact', async () => {
  const original = await readFixture(); let packet;
  const r = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(v => { packet = v; return selection(v); }) });
  assert.deepEqual(packet.source_records, original.records); assert.deepEqual(packet.scope, SCOPE); assert.equal(packet.deterministic_result.metrics, undefined);
  for (const [key, fact] of Object.entries(r.metric_catalog)) {
    assert.deepEqual(packet.metric_catalog[key], { value: fact.value, unit: fact.unit, source_ids: fact.source_ids, available: fact.available }); assert.deepEqual(fact.scope, SCOPE);
  }
  assert.deepEqual(packet.deterministic_result.bridge.map(row => packet.metric_catalog[row.metric_key].value), [0, 42000, 18000]);
});
test('invalid JSON retries through the model and never implies an uncalled critic rejection', async () => {
  let explanations = 0, critics = 0;
  const r = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(packet => {
    if (++explanations === 1) throw Object.assign(Error('bad JSON'), { code: 'MODEL_INVALID_JSON', receipt: { request_id: 'bad-json', model_text_returned: true } });
    assert.equal(packet.critic_feedback.model_error, 'MODEL_INVALID_JSON'); return selection(packet);
  }, () => { critics++; return approve; }) });
  assert.equal(explanations, 2); assert.equal(critics, 1); assert.equal(r.trace.find(x => x.request_id === 'bad-json').accepted, false); assert.ok(r.analysis);
  const none = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(() => {
    throw Object.assign(Error('bad JSON despite stop'), { code: 'MODEL_INVALID_JSON', receipt: { finish_reason: 'stop', model_text_returned: true } });
  }, () => { throw Error('No critic'); }) });
  assert.equal(none.analysis, null); assert.match(none.model_escalation, /model explanation was not accepted/); assert.doesNotMatch(none.model_escalation, /critic did not approve/);
});
test('malformed, negative, defective or truncated critic output cannot accept valid typed choices', async () => {
  for (const review of [() => ({ accepted: true, issues: [], missing_evidence: 'none' }), () => ({ accepted: false, issues: [], missing_evidence: [] }),
    () => ({ accepted: true, issues: ['irrelevant'], missing_evidence: [] }), () => ({ accepted: true, issues: [], missing_evidence: ['approval'] }),
    () => { throw Object.assign(Error('truncated'), { code: 'MODEL_OUTPUT_TRUNCATED', receipt: { finish_reason: 'length', model_text_returned: true } }); }]) {
    const r = await investigate({ liveModel: true }, { memoryRoot: await root(), model: stub(undefined, review) });
    assert.equal(r.analysis, null); assert.match(r.mode, /Escalated/); assert.equal(r.evidence_review.attempts, 2);
  }
});
