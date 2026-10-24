import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { investigate } from '../src/investigate.mjs';
import { Nightshift } from '../src/nightshift.mjs';

// Injected HTTP replies exercise the actual response contract, never live model acceptance.
async function contractRun(mutate = value => value, inspect = () => {}, scenario = 'complete') {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-selector-http-stub-'));
  let critiques = 0, candidate;
  const model = new Nightshift({ token: 'MODEL_STUB_NO_INFERENCE_RECEIPT', model: 'meterless/local', fetcher: async (url, options) => {
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'meterless/local' }] }));
    const body = JSON.parse(options.body), envelope = JSON.parse(body.messages[1].content), packet = envelope.input_data;
    const contract = body.response_format.json_schema;
    let value;
    if (contract.name === 'costproof_plan') value = { source_order: ['sales', 'labor', 'policy'] };
    else if (contract.name === 'costproof_investigation') {
      inspect(contract.schema, packet, envelope.application_instructions.task);
      candidate = mutate({ claims: [{ kind: 'metric_observation', metric_key: 'metrics.gap_cents' }],
        limitation_ids: Object.keys(packet.decision_options.required_limitations), next_check: { kind: 'verify_shift_approval_and_time_records', report_ids: [] } });
      value = candidate;
    } else { assert.equal(contract.name, 'costproof_evidence_review'); critiques++; value = { accepted: true, issues: [], missing_evidence: [] }; }
    return new Response(JSON.stringify({ id: 'MODEL_STUB_NO_INFERENCE_RECEIPT', choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
  } });
  return { result: await investigate({ liveModel: true, scenario }, { model, memoryRoot }), critiques: () => critiques, candidate: () => candidate };
}

test('generation requests only disjoint stable fact selectors and code supplies exact bound references', async () => {
  const run = await contractRun(value => value, (schema, packet, instruction) => {
    const claims = schema.properties.claims;
    assert.equal(claims.minItems, 1); assert.equal(claims.maxItems, 1);
    const [observation, bridge] = claims.items.oneOf;
    assert.deepEqual(observation.required, ['kind', 'metric_key']);
    assert.deepEqual(bridge.required, ['kind', 'component_key']);
    assert.equal(observation.additionalProperties, false); assert.equal(bridge.additionalProperties, false);
    assert.deepEqual(observation.properties.kind.enum, ['metric_observation']);
    assert.deepEqual(bridge.properties.kind.enum, ['accounting_bridge']);
    assert.deepEqual([...observation.properties.metric_key.enum].sort(), Object.keys(packet.metric_catalog).filter(key => packet.metric_catalog[key].available).sort());
    assert.deepEqual(bridge.properties.component_key.enum, ['bridge.planned_variance_cents', 'bridge.sales_denominator_effect_cents', 'bridge.labor_change_cents']);
    assert.match(instruction, /Never output values, units, scope, source_ids or metric_refs/);
    assert.deepEqual(schema.properties.limitation_ids.items.enum, Object.keys(packet.decision_options.required_limitations));
  });
  assert.equal(run.critiques(), 1);
  assert.deepEqual(run.result.trace.find(row => row.stage === 'explanation').value, run.candidate());
  const claim = run.result.analysis.claims[0];
  assert.equal(claim.metric_refs[0].value, 60000);
  assert.deepEqual(claim.source_ids, run.result.metric_catalog['metrics.gap_cents'].source_ids);
  assert.equal(run.result.analysis.reference_binding, 'code_from_validated_catalog');
  assert.equal(run.result.trace.find(row => row.role === 'fact_binding').binding, 'code_from_validated_catalog');
  assert.equal(run.candidate().claims[0].value, undefined);
});

test('old numeric/source payloads, wrong selector branches and unknown fact IDs fail strict schema without repair', async () => {
  for (const mutate of [
    value => { value.claims[0].value = 90000; }, value => { value.claims[0].unit = 'USD_cents'; },
    value => { value.claims[0].scope = {}; }, value => { value.claims[0].source_ids = ['invented']; },
    value => { value.claims[0].metric_refs = [{ key: 'metrics.gap_cents', value: 60000 }]; },
    value => { value.claims[0].text = 'Labor time is higher due to cost.'; },
    value => { value.claims[0] = { kind: 'accounting_bridge', metric_key: 'metrics.gap_cents' }; },
    value => { value.claims[0] = { kind: 'accounting_bridge', component_key: 'metrics.actual_labor_cents' }; },
    value => { value.claims[0].metric_key = 'metrics.recovered_savings_cents'; }
  ]) {
    const run = await contractRun(value => { mutate(value); return value; });
    assert.equal(run.result.analysis, null); assert.equal(run.critiques(), 0);
    assert.equal(run.result.evidence_review.model_error, 'MODEL_SCHEMA_INVALID');
    assert.equal(run.result.trace.filter(row => row.error === 'MODEL_SCHEMA_INVALID').length, 2);
  }
});

test('a bridge component ID resolves the unique gap and selected component without model copies or duplicate slots', async () => {
  const run = await contractRun(value => { value.claims[0] = { kind: 'accounting_bridge', component_key: 'bridge.labor_change_cents' }; return value; });
  assert.equal(run.critiques(), 1);
  assert.deepEqual(run.result.analysis.claims[0].metric_refs.map(ref => [ref.key, ref.value]), [['metrics.gap_cents', 60000], ['bridge.labor_change_cents', 18000]]);
  assert.equal(new Set(run.result.analysis.claims[0].metric_refs.map(ref => ref.key)).size, 2);
  assert.deepEqual(Object.keys(run.candidate().claims[0]), ['kind', 'component_key']);
  const zero = await contractRun(value => { value.claims[0].metric_key = 'metrics.actual_labor_percent'; return value; }, (schema) => {
    const keys = schema.properties.claims.items.oneOf[0].properties.metric_key.enum;
    assert.ok(!keys.includes('metrics.actual_labor_percent'));
    assert.ok(!keys.includes('metrics.variance_percentage_points'));
  }, 'zero-sales');
  assert.equal(zero.result.analysis, null); assert.equal(zero.critiques(), 0);
});
