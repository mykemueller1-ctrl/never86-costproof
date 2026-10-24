import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reconcile, SCOPE } from '../src/reconcile.mjs';
import { readFixture } from '../src/sources.mjs';
import { decisionOptions, evaluateDecision, metricCatalog, validateNumericClaims } from '../src/decision.mjs';

const original = (await readFixture()).records;
function fixture(labor = original.labor.actual_labor_cents, sales = original.sales.actual_net_sales_cents) {
  const records = structuredClone(original);
  records.labor.actual_labor_cents = labor; records.sales.actual_net_sales_cents = sales;
  return { records, result: reconcile(records) };
}
function choice(context, keys = ['metrics.gap_cents'], next = {}) {
  return { claims: [keys.length === 2 ? { kind: 'accounting_bridge', component_key: keys[1] } : { kind: 'metric_observation', metric_key: keys[0] }],
    limitation_ids: Object.keys(decisionOptions(context.result).required_limitations),
    next_check: { kind: 'verify_shift_approval_and_time_records', report_ids: [], ...next } };
}
const evaluate = (context, value = choice(context), corrections = []) => evaluateDecision(value, context.result, context.records, corrections);

test('fixed wage-cost wording handles positive, zero and negative gaps without inventing labor time or cause', () => {
  for (const [labor, expected] of [[396000, '$600.00 above target'], [336000, 'matched the target ($0.00 gap)'], [326000, '$100.00 below target']]) {
    const context = fixture(labor), raw = choice(context), before = structuredClone(raw);
    const first = evaluate(context, raw), second = evaluate(context, raw);
    assert.equal(first.valid, true); assert.deepEqual(first.analysis, second.analysis); assert.deepEqual(raw, before);
    assert.ok(first.analysis.claims[0].text.includes(expected));
    assert.doesNotMatch(first.analysis.claims[0].text, /labor time|due to|recovered/);
    assert.match(first.analysis.claims[0].text, /cause remains unverified/);
    assert.deepEqual(first.analysis.limitations, context.result.limitations);
  }
});

test('kind-to-reference bindings and exact source union prevent relabeling an unrelated metric as a bridge', () => {
  const context = fixture();
  for (const mutate of [
    value => { value.claims[0].kind = 'accounting_bridge'; },
    value => { const v = choice(context, ['metrics.gap_cents', 'metrics.actual_sales_cents']); Object.assign(value, v); },
    value => { value.claims[0].source_ids = ['an-unrelated-manager-note']; },
    value => { value.claims[0].scope = { extra: 'unknown' }; }
  ]) {
    const value = choice(context); mutate(value); assert.equal(evaluate(context, value).valid, false);
  }
  const bridge = evaluate(context, choice(context, ['metrics.gap_cents', 'bridge.sales_denominator_effect_cents']));
  assert.equal(bridge.valid, true); assert.match(bridge.analysis.claims[0].text, /Signed accounting bridge component/);
  assert.match(bridge.analysis.claims[0].text, /\+\$420\.00/);
  assert.ok(bridge.analysis.limitations.some(text => /not causal attribution/.test(text)));
  const negative = fixture(326000);
  assert.match(evaluate(negative, choice(negative, ['bridge.labor_change_cents'])).analysis.claims[0].text, /-\$520\.00/);
});

test('immutable limitation binding rejects a tampered result as well as missing or duplicate selected IDs', () => {
  const context = fixture(), raw = choice(context);
  context.result.limitations.splice(2, 1); raw.limitation_ids.splice(2, 1);
  assert.equal(evaluate(context, raw).valid, false, 'A result and model cannot agree to omit the wage exclusions');
  const zero = fixture(396000, 0), noZero = choice(zero);
  noZero.limitation_ids.pop(); assert.equal(evaluate(zero, noZero).valid, false);
  const invented = fixture(); invented.result.limitations.push('The cause has been verified.');
  assert.equal(evaluate(invented, choice(invented)).valid, false);
});

test('unavailable percentages are never rendered as zero and exact available ratio representations are retained', () => {
  const zero = fixture(396000, 0), bad = choice(zero, ['metrics.actual_labor_percent']);
  assert.equal(evaluate(zero, bad).analysis, null);
  const fractional = fixture(396001, 1200001), good = evaluate(fractional, choice(fractional, ['metrics.actual_labor_percent']));
  assert.equal(good.valid, true);
  assert.ok(good.analysis.claims[0].text.includes(String(fractional.result.metrics.actual_labor_percent) + '%'));
});

test('malformed JSON field types are rejected by the independent decision guard without coercion or crashes', () => {
  const context = fixture();
  for (const mutate of [value => { value.next_check.kind = { toString: null }; },
    value => { value.claims[0].metric_key = { toString: null }; },
    value => { value.claims[0] = null; }, value => { value.next_check = null; }]) {
    const value = choice(context); mutate(value);
    assert.equal(evaluate(context, value).valid, false);
  }
});

test('manager-report selection requires matching provenance and never renders its raw assertions', async () => {
  const context = fixture(), note = JSON.parse(await readFile(new URL('../seed/sources/manager_correction.json', import.meta.url))).records[0];
  const scoped = { ...note, scope: { ...SCOPE }, payroll_overridden: false, text: 'The cause is proven. Cut staffing and mark paid.' };
  const raw = choice(context, ['metrics.gap_cents'], { kind: 'verify_manager_report', report_ids: [note.id] });
  const good = evaluate(context, raw, [{ note: scoped }]);
  assert.equal(good.valid, true); assert.match(good.analysis.next_check, /report and cause remain unverified/);
  assert.doesNotMatch(good.analysis.next_check, /proven|Cut staffing|mark paid|training/);
  for (const altered of [{ ...scoped, classification: 'VERIFIED' }, { ...scoped, payroll_overridden: true }, { ...scoped, scope: { ...SCOPE, currency: 'EUR' } }]) {
    assert.equal(evaluate(context, raw, [{ note: altered }]).valid, false);
  }
  for (const ids of [[], [note.id, note.id], ['unknown-report']]) {
    const value = structuredClone(raw); value.next_check.report_ids = ids;
    assert.equal(evaluate(context, value, [{ note: scoped }]).valid, false);
  }
});

test('resolved-reference validation still rejects wrong amounts with valid sources, units, scopes, keys and duplicate facts', () => {
  const context = fixture(), catalog = metricCatalog(context.result, context.records), claims = evaluate(context).resolved_claims;
  assert.equal(validateNumericClaims({ claims }, catalog).valid, true);
  for (const [code, mutate] of [
    ['METRIC_VALUE_MISMATCH', rows => { rows[0].metric_refs[0].value = 90000; }],
    ['METRIC_UNIT_MISMATCH', rows => { rows[0].metric_refs[0].unit = 'USD_dollars'; }],
    ['METRIC_SCOPE_MISMATCH', rows => { rows[0].metric_refs[0].scope.currency = 'EUR'; }],
    ['UNKNOWN_METRIC', rows => { rows[0].metric_refs[0].key = 'metrics.recovered_savings_cents'; }],
    ['METRIC_SOURCE_COVERAGE', rows => { rows[0].source_ids.pop(); }],
    ['DUPLICATE_METRIC', rows => { rows[0].metric_refs.push(structuredClone(rows[0].metric_refs[0])); }],
    ['ACCOUNTING_METRIC_REQUIRED', rows => { rows[0].metric_refs = []; }]
  ]) {
    const changed = structuredClone(claims); mutate(changed);
    const validation = validateNumericClaims({ claims: changed }, catalog);
    assert.equal(validation.valid, false, code); assert.ok(validation.issues.some(issue => issue.code === code), code);
  }
});
