import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { investigate } from './investigate.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const cases = Object.freeze({
  complete: { apiScenario: 'complete', expected: 'reconciled' },
  'missing-wages': { apiScenario: 'missing-wages', expected: 'held' },
  'mismatched-restaurant': { apiScenario: 'wrong-location', expected: 'refused' }
});
const classification = 'DETERMINISTIC_SYNTHETIC_FIXTURE';
const question = 'Why did dinner labor finish above target?';
function errorRecord(error) {
  return error ? { name: error.name, code: error.code || null, message: error.message, details: error.details || [] } : null;
}
function preventNetwork() {
  throw Object.assign(new Error('Sample replays do not permit network or model calls.'), { code: 'SAMPLE_NETWORK_FORBIDDEN' });
}
const offlineModel = Object.freeze({ discover: preventNetwork, json: preventNetwork });

function validate(name, result, error) {
  if (name === 'mismatched-restaurant') {
    assert.equal(result, null, 'A mismatched restaurant must not return a result');
    assert.equal(error?.code, 'SCOPE_MISMATCH', 'A mismatched restaurant must refuse with SCOPE_MISMATCH');
    assert.ok(error.details?.includes('restaurant_id'), 'The refusal must identify the restaurant join key');
    return;
  }
  assert.equal(error, null, 'This scenario must return an investigation result');
  assert.equal(result.source_provider, 'local synthetic files');
  assert.equal(result.integration.zetaris, false);
  assert.equal(result.integration.nightshift_discovery, false);
  assert.equal(result.integration.nightshift_text, false);
  assert.equal(result.integration.competition_ready, false);
  assert.equal(result.analysis, null, 'A deterministic replay must not return model prose');
  assert.equal(result.corrections.length, 0, 'Sample replays must not load existing manager reports');
  assert.ok(Array.isArray(result.trace) && result.trace.length > 0, 'The actual application trace must be present');
  if (name === 'complete') {
    assert.equal(result.status, 'reconciled');
    assert.equal(result.metrics?.gap_cents, 60000, 'The complete synthetic fixture must reconcile to exactly 60000 cents');
  } else {
    assert.equal(result.status, 'needs_evidence');
    assert.equal(result.metrics, null, 'Missing wages must hold dollar metrics');
    assert.equal(result.bridge, null, 'Missing wages must hold the dollar bridge');
    assert.ok(result.evidence_requests.length > 0, 'Missing wages must request the absent record');
  }
}

async function replay(name, outputDir, memoryRoot) {
  const spec = cases[name];
  const createdAt = new Date().toISOString();
  const request = { question, scenario: spec.apiScenario, liveModel: false, sourceMode: 'fixture' };
  const events = [{ stage: 'invoke_investigate', created_at_utc: createdAt, request }];
  let result = null, apiError = null, contractError = null;
  try {
    result = await investigate(request, { model: offlineModel, memoryRoot: path.join(memoryRoot, name) });
    events.push({ stage: 'investigate_returned', status: result.status });
  } catch (error) {
    apiError = error;
    events.push({ stage: 'investigate_threw', error: errorRecord(error) });
  }
  try { validate(name, result, apiError); } catch (error) { contractError = error; }
  const outcome = apiError ? apiError.code === 'SCOPE_MISMATCH' ? 'refused' : 'error' : result?.status === 'needs_evidence' ? 'held' : result?.status || 'unexpected';
  const receipt = {
    schema_version: 'costproof.sample-receipt.v1', created_at_utc: createdAt,
    classification, scenario: name, api_scenario: spec.apiScenario,
    expected_outcome: spec.expected, outcome, contract_passed: contractError === null,
    gap_cents: result?.metrics?.gap_cents ?? null, currency: result?.scope?.currency ?? null,
    refusal_code: apiError?.code || null,
    model_used: false, live_zetaris_query: false, live_nightshift_call: false,
    memory_input: 'Fresh isolated H-MEM store; no existing manager reports',
    trace_file: name + '.trace.json',
    claim_boundary: 'Dated deterministic fixture replay. No customer result, causal conclusion, savings or live sponsor connection is established.'
  };
  if (contractError) receipt.contract_error = contractError.message;
  const fullTrace = {
    schema_version: 'costproof.sample-trace.v1', created_at_utc: createdAt, classification,
    scenario: name, request, execution_events: events, result,
    error: errorRecord(apiError), contract_error: errorRecord(contractError),
    trace_availability: result ? 'Full returned investigation, including its actual application trace.' : 'The application threw before returning an internal trace. Only the actual invocation and refusal are recorded; no internal steps are invented.'
  };
  await writeFile(path.join(outputDir, name + '.trace.json'), JSON.stringify(fullTrace, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(outputDir, name + '.receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify(receipt) + '\n');
  return receipt;
}

async function main() {
  const { values } = parseArgs({ options: {
    scenario: { type: 'string', default: 'all' },
    'output-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  } });
  if (values.help) {
    process.stdout.write('node --experimental-transform-types src/sample-run.mjs [--scenario all|complete|missing-wages|mismatched-restaurant] [--output-dir PATH]\n');
    return;
  }
  if (values.scenario !== 'all' && !Object.hasOwn(cases, values.scenario)) throw new Error('Choose all, complete, missing-wages or mismatched-restaurant.');
  const createdAt = new Date().toISOString();
  const outputDir = values['output-dir'] ? path.resolve(values['output-dir']) : path.join(projectRoot, '.costproof', 'samples', createdAt.replace(/[:.]/g, '-'));
  await mkdir(outputDir, { recursive: true });
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-sample-memory-'));
  globalThis.fetch = preventNetwork;
  const receipts = [];
  for (const name of values.scenario === 'all' ? Object.keys(cases) : [values.scenario]) receipts.push(await replay(name, outputDir, memoryRoot));
  const index = { schema_version: 'costproof.sample-index.v1', created_at_utc: createdAt, classification, contract_passed: receipts.every(row => row.contract_passed), receipts };
  await writeFile(path.join(outputDir, 'index.json'), JSON.stringify(index, null, 2) + '\n', { flag: 'wx' });
  process.stderr.write('Sample receipts saved in ' + path.relative(process.cwd(), outputDir) + '\n');
  if (!index.contract_passed) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ sample_run_failed: true, error: errorRecord(error) }) + '\n');
  process.exitCode = 1;
});
