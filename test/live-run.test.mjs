import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assessLiveResult } from '../src/live-run.mjs';
import { reconcile, SCOPE } from '../src/reconcile.mjs';
import { readFixture } from '../src/sources.mjs';
import { decisionOptions, evaluateDecision } from '../src/decision.mjs';

const fixtureRecords = (await readFixture()).records;

// Fabricated contract object only. Never recorded as an actual sponsor run.
function contract(transport = 'direct_rest') {
  const source_records = structuredClone(fixtureRecords), computed = reconcile(source_records);
  const raw = { claims: [{ kind: 'metric_observation', metric_key: 'metrics.gap_cents' }],
    limitation_ids: Object.keys(decisionOptions(computed).required_limitations), next_check: { kind: 'verify_shift_approval_and_time_records', report_ids: [] } };
  const decision = evaluateDecision(raw, computed, source_records);
  return { ...computed, source_mode: 'zetaris', source_provider: transport === 'ui_proxy' ? 'Zetaris UI proxy' : 'Zetaris REST', scope: { ...SCOPE }, corrections: [],
    integration: { hmem: true, zetaris: true, nightshift_discovery: true, nightshift_text: true },
    analysis: decision.analysis,
    evidence_review: { status: 'accepted_by_model_critic', numeric_claims_valid: true, typed_decision_valid: true, references_bound: true, limitations_bound: true, attempts: 1 }, source_records,
    trace: [
      ...Object.keys(source_records).map(family => ({ role: 'source', family, tool: 'zetaris_rest_sql', api_transport: transport, http_status: 200, transport: 'network', transport_verified: true, mapping_verified: true, integration_verified: true, status: 'validated', row_count: 1, source_id: source_records[family].id, scope: { ...SCOPE } })),
      { role: 'investigator', stage: 'plan', route: 'meterless/local', value: { source_order: ['sales', 'labor', 'policy'] } },
      { role: 'investigator', stage: 'explanation', attempt: 1, route: 'meterless/local', value: raw },
      { role: 'fact_binding', stage: 'catalog_resolution', attempt: 1, binding: 'code_from_validated_catalog', claims: decision.resolved_claims, selection_valid: true },
      { role: 'decision_guard', stage: 'typed_decision_validation', attempt: 1, valid: true, limitation_ids_valid: true, next_check_valid: true },
      { role: 'evidence_critic', stage: 'review', attempt: 1, route: 'meterless/local', value: { accepted: true, issues: [], missing_evidence: [] } }
    ] };
}

test('live receipt contract requires every sponsor stage, while preserving the claim boundary', () => {
  assert.equal(assessLiveResult(contract()).passed, true);
  for (const key of ['hmem', 'zetaris', 'nightshift_discovery', 'nightshift_text']) {
    const row = contract(); row.integration[key] = false;
    assert.equal(assessLiveResult(row).passed, false, key);
  }
});
test('fixture sources and injected transports cannot pass the live receipt gate', () => {
  const fixture = contract(); fixture.source_mode = 'fixture';
  assert.equal(assessLiveResult(fixture).passed, false);
  const stub = contract(); stub.trace[0].transport = 'injected_test_transport';
  assert.equal(assessLiveResult(stub).passed, false);
});
test('a UI proxy model run requires receipts matching its provider, HTTP response and full scope', () => {
  assert.equal(assessLiveResult(contract('ui_proxy')).passed, true);
  for (const mutate of [r => { r.trace[0].api_transport = 'direct_rest'; },
    r => { r.trace[0].http_status = 403; }, r => { r.trace[0].scope.business_date = 'another-date'; },
    r => { delete r.trace[0].scope.currency; }, r => { r.trace[0].family = 'labor'; }]) {
    const row = contract('ui_proxy'); mutate(row);
    assert.ok(assessLiveResult(row).failures.includes('NETWORK_SOURCE_RECEIPTS_REQUIRED'));
  }
});
test('verified UI proxy source-only reconciliation cannot pass the complete live model gate', () => {
  const row = contract('ui_proxy');
  row.integration.nightshift_discovery = false; row.integration.nightshift_text = false;
  row.analysis = null; row.evidence_review = { status: 'not_requested', semantic_support: 'not_reviewed' };
  row.trace = row.trace.filter(r => r.role === 'source');
  const assessment = assessLiveResult(row);
  assert.equal(assessment.passed, false);
  assert.ok(!assessment.failures.includes('NETWORK_SOURCE_RECEIPTS_REQUIRED'));
  assert.ok(assessment.failures.includes('NIGHTSHIFT_TEXT_NOT_VERIFIED'));
  assert.ok(assessment.failures.includes('ACCEPTED_EXPLANATION_REQUIRED'));
});
test('live receipt rejects missing, duplicate, or mismatched source receipts', () => {
  for (const mutate of [r => r.trace.splice(0, 1), r => r.trace.push(r.trace[0]), r => { r.trace[0].source_id = 'invented'; }]) {
    const row = contract(); mutate(row); assert.equal(assessLiveResult(row).passed, false);
  }
});
test('discovery alone and a rejected critic cannot produce a passing live receipt', () => {
  const noText = contract(); noText.trace = noText.trace.filter(r => r.role === 'source');
  assert.equal(assessLiveResult(noText).passed, false);
  const rejected = contract(); rejected.evidence_review.status = 'rejected';
  assert.equal(assessLiveResult(rejected).passed, false);
});
test('live acceptance remains bound to the canonical synthetic shift and gap', () => {
  const wrongShift = contract(); wrongShift.scope.restaurant_id = 'another-restaurant';
  assert.equal(assessLiveResult(wrongShift).passed, false);
  const wrongGap = contract(); wrongGap.metrics.gap_cents = 59000;
  assert.equal(assessLiveResult(wrongGap).passed, false);
  assert.equal(assessLiveResult(null).passed, false);
});

test('legacy false-green prose and a forged rendering marker cannot pass the typed live gate', () => {
  const legacy = contract();
  legacy.analysis = { claims: [{ text: 'Labor time was above target due to additional labor costs.' }], next_check: 'Verify training.' };
  const original = legacy.trace.find(row => row.stage === 'explanation');
  original.value = structuredClone(legacy.analysis);
  assert.ok(assessLiveResult(legacy).failures.includes('TYPED_DECISION_RENDERING_REQUIRED'));
  for (const mutate of [
    r => { r.analysis.claims[0].text += ' A cause is proven.'; },
    r => { r.analysis.limitations.pop(); },
    r => { r.limitations.pop(); r.analysis.limitations.pop(); },
    r => { r.metrics.actual_sales_cents += 100; },
    r => { r.bridge[1].cents += 100; },
    r => { r.headline = 'The cause is proven.'; },
    r => { r.evidence[0].classification = 'CUSTOMER_RESULT'; },
    r => { r.trace.find(row => row.stage === 'explanation').value.claims[0].kind = 'verified_cause'; },
    r => { r.trace.find(row => row.stage === 'explanation').value.claims[0].value = 90000; },
    r => { r.trace.find(row => row.role === 'fact_binding').claims[0].metric_refs[0].value = 90000; },
    r => { delete r.evidence_review.references_bound; },
    r => { r.trace.find(row => row.role === 'decision_guard').valid = false; }
  ]) {
    const row = contract(); mutate(row);
    assert.ok(assessLiveResult(row).failures.includes('TYPED_DECISION_RENDERING_REQUIRED'));
  }
  const critic = contract(); critic.trace.find(row => row.role === 'evidence_critic').value.accepted = false;
  assert.ok(assessLiveResult(critic).failures.includes('ACCEPTED_CRITIC_TRACE_REQUIRED'));
  for (const role of ['investigator', 'evidence_critic']) {
    const row = contract(), accepted = row.trace.find(item => item.role === role && item.attempt === 1);
    row.trace.push({ ...structuredClone(accepted), attempt: 2 });
    delete accepted.route;
    assert.equal(assessLiveResult(row).passed, false, 'An earlier route cannot stand in for the accepted attempt');
  }
});

test('malformed provider and trace JSON produces a failed assessment without property coercion or crashes', () => {
  for (const row of [{ source_provider: { toString: null }, trace: [] }, { trace: [null] }, { trace: [7] }, { trace: ['model-output'] }]) {
    assert.equal(assessLiveResult(row).passed, false);
  }
});
test('the actual live command writes a blocked receipt without exposing configured secrets', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'costproof-blocked-receipt-'));
  try {
    const canary = 'test-only-secret-must-not-appear';
    const child = spawnSync(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('../src/live-run.mjs', import.meta.url)), '--output-dir', output], {
      env: { ...process.env, METERLESS_RUNTIME_TOKEN: canary, ZETARIS_TRANSPORT: 'direct_rest', ZETARIS_UI_BASE_URL: '', ZETARIS_UI_AUTH_ENV_PATH: '', ZETARIS_API_KEY: '', ZETARIS_ORG_ID: '', ZETARIS_MAPPING_PROOF_PATH: '' },
      encoding: 'utf8', timeout: 10000
    });
    assert.equal(child.status, 1);
    const bytes = await readFile(path.join(output, 'live.receipt.json'), 'utf8');
    const receipt = JSON.parse(bytes);
    assert.equal(receipt.passed, false);
    assert.equal(receipt.status, 'blocked');
    assert.equal(receipt.error, 'ZETARIS_CONFIG_MISSING');
    assert.equal(receipt.fixture_fallback_used, false);
    assert.equal(receipt.competition_submission_complete, false);
    assert.ok(!bytes.includes(canary) && !child.stdout.includes(canary) && !child.stderr.includes(canary));
    const uiOutput = path.join(output, 'ui-proxy');
    const ui = spawnSync(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('../src/live-run.mjs', import.meta.url)), '--output-dir', uiOutput], {
      env: { ...process.env, METERLESS_RUNTIME_TOKEN: canary, ZETARIS_TRANSPORT: 'ui_proxy', ZETARIS_UI_BASE_URL: 'http://127.0.0.1:3000', ZETARIS_UI_AUTH_ENV_PATH: '', ZETARIS_MAPPING_PROOF_PATH: '' },
      encoding: 'utf8', timeout: 10000
    });
    assert.equal(ui.status, 1);
    const uiBytes = await readFile(path.join(uiOutput, 'live.receipt.json'), 'utf8');
    const uiReceipt = JSON.parse(uiBytes);
    assert.equal(uiReceipt.zetaris_transport, 'ui_proxy');
    assert.equal(uiReceipt.error, 'ZETARIS_CONFIG_MISSING');
    assert.equal(uiReceipt.configuration_presence.ZETARIS_UI_BASE_URL, true);
    assert.equal(uiReceipt.configuration_presence.ZETARIS_UI_AUTH_ENV_PATH, false);
    assert.equal(Object.hasOwn(uiReceipt.configuration_presence, 'ZETARIS_API_KEY'), false);
    assert.ok(!uiBytes.includes(canary) && !ui.stdout.includes(canary) && !ui.stderr.includes(canary));
  } finally { await rm(output, { recursive: true, force: true }); }
});
