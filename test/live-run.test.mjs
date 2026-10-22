import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assessLiveResult } from '../src/live-run.mjs';
import { SCOPE } from '../src/reconcile.mjs';

// Fabricated contract object only. Never recorded as an actual sponsor run.
function contract() {
  const source_records = Object.fromEntries(['sales', 'labor', 'policy'].map(f => [f, { id: f + '-contract' }]));
  return { status: 'reconciled', source_mode: 'zetaris', source_provider: 'Zetaris REST', scope: { ...SCOPE },
    integration: { hmem: true, zetaris: true, nightshift_discovery: true, nightshift_text: true },
    metrics: { gap_cents: 60000 }, analysis: { claims: [{ text: 'Contract-only claim' }] },
    evidence_review: { status: 'accepted_by_model_critic', numeric_claims_valid: true }, source_records,
    trace: [
      ...Object.keys(source_records).map(family => ({ role: 'source', family, tool: 'zetaris_rest_sql', transport: 'network', transport_verified: true, mapping_verified: true, integration_verified: true, status: 'validated', row_count: 1, source_id: source_records[family].id })),
      ...[['investigator', 'plan'], ['investigator', 'explanation'], ['evidence_critic', 'review']].map(([role, stage]) => ({ role, stage, route: 'meterless/auto', value: { contract_test: true } }))
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
test('the actual live command writes a blocked receipt without exposing configured secrets', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'costproof-blocked-receipt-'));
  try {
    const canary = 'test-only-secret-must-not-appear';
    const child = spawnSync(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('../src/live-run.mjs', import.meta.url)), '--output-dir', output], {
      env: { ...process.env, METERLESS_RUNTIME_TOKEN: canary, ZETARIS_API_KEY: '', ZETARIS_ORG_ID: '', ZETARIS_MAPPING_PROOF_PATH: '' },
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
  } finally { await rm(output, { recursive: true, force: true }); }
});
