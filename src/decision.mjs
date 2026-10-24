import { isDeepStrictEqual } from 'node:util';

const scopeKeys = ['restaurant_id', 'shift_id', 'business_date', 'currency'];
const bridgeKeys = ['bridge.planned_variance_cents', 'bridge.sales_denominator_effect_cents', 'bridge.labor_change_cents'];
export const metricKeys = [
  'metrics.actual_sales_cents', 'metrics.actual_labor_cents', 'metrics.target_labor_cents',
  'metrics.target_percent', 'metrics.actual_labor_percent', 'metrics.variance_percentage_points', 'metrics.gap_cents', ...bridgeKeys
];
const limitationText = Object.freeze({
  synthetic_competition: 'Synthetic competition scenario. These are not customer results.',
  accounting_not_cause_or_savings: 'The bridge is accounting reconciliation, not causal attribution or recovered savings.',
  straight_time_scope: 'Straight time wage scope excludes taxes, benefits, tips and overtime.',
  zero_sales_percentage_unavailable: 'Labor percentage is unavailable because net sales are zero.'
});
const nextCheckText = Object.freeze({
  verify_shift_approval_and_time_records: 'Compare the recorded wage dollars with shift approval and time records before changing staffing. The cause remains unverified.',
  compare_sales_plan_with_recorded_sales: 'Compare the sales plan with the scoped net sales record. The denominator effect is accounting reconciliation, not a proven cause.',
  verify_manager_report: 'Verify the remembered manager report against approval and time records. The report and cause remain unverified. Payroll is unchanged.'
});
const strictObject = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sameSet = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && expected.every(item => actual.includes(item));
function limitationIds(result) {
  if (!Array.isArray(result?.limitations)) return null;
  const ids = ['synthetic_competition', 'accounting_not_cause_or_savings', 'straight_time_scope',
    ...(result.metrics?.actual_sales_cents === 0 ? ['zero_sales_percentage_unavailable'] : [])];
  return isDeepStrictEqual(result.limitations, ids.map(id => limitationText[id])) ? ids : null;
}
function eligibleReports(corrections, scope) {
  return corrections.map(correction => correction?.note).filter(note => note && note.classification === 'UNVERIFIED_MANAGER_REPORT' &&
    note.payroll_overridden === false && typeof note.id === 'string' && note.id.trim() && typeof note.text === 'string' && note.text.trim() &&
    note.applies_only_to_shift_id === scope.shift_id && scopeKeys.every(key => note[key] === scope[key] && note.scope?.[key] === scope[key]));
}
export function metricCatalog(result, records) {
  const { sales, labor, policy } = records, all = [sales.id, labor.id, policy.id], catalog = {};
  const add = (key, value, unit, source_ids) => { catalog[key] = { key, value, unit, source_ids, scope: result.scope, available: typeof value === 'number' && Number.isFinite(value) }; };
  for (const [name, unit, ids] of [
    ['actual_sales_cents', 'USD_cents', [sales.id]], ['actual_labor_cents', 'USD_cents', [labor.id]],
    ['target_labor_cents', 'USD_cents', [sales.id, policy.id]], ['target_percent', 'percent', [policy.id]],
    ['actual_labor_percent', 'percent', [sales.id, labor.id]], ['variance_percentage_points', 'percentage_points', all], ['gap_cents', 'USD_cents', all]
  ]) add('metrics.' + name, result.metrics[name], unit, ids);
  for (const [i, key] of bridgeKeys.entries()) add(key, result.bridge[i].cents, 'USD_cents', result.bridge[i].source_ids);
  return catalog;
}
export function decisionOptions(result, corrections = []) {
  const ids = limitationIds(result) || [];
  const reports = eligibleReports(corrections, result.scope);
  return {
    required_limitations: Object.fromEntries(ids.map(id => [id, limitationText[id]])),
    claim_kinds: {
      metric_observation: 'Select one available metric_key. Code binds its exact value, unit, scope and source records.',
      accounting_bridge: 'Select one component_key from the bridge. Code binds metrics.gap_cents plus that component, never a cause.'
    },
    next_check_options: Object.fromEntries(Object.entries(nextCheckText).filter(([kind]) => kind !== 'verify_manager_report' || reports.length).map(([kind, text]) => [kind, { text, report_ids: kind === 'verify_manager_report' ? reports.map(note => note.id) : [] }]))
  };
}
export function decisionContract(result, corrections = []) {
  const options = decisionOptions(result, corrections), ids = Object.keys(options.required_limitations);
  const availableKeys = metricKeys.filter(key => {
    const value = key.startsWith('metrics.') ? result.metrics[key.slice(8)] : result.bridge[bridgeKeys.indexOf(key)]?.cents;
    return typeof value === 'number' && Number.isFinite(value);
  });
  return { name: 'costproof_investigation', maxTokens: 1024, schema: strictObject({
    claims: { type: 'array', minItems: 1, maxItems: 1, items: { oneOf: [
      strictObject({ kind: { type: 'string', enum: ['metric_observation'] }, metric_key: { type: 'string', enum: availableKeys } }),
      strictObject({ kind: { type: 'string', enum: ['accounting_bridge'] }, component_key: { type: 'string', enum: bridgeKeys } })
    ] } },
    limitation_ids: { type: 'array', minItems: ids.length, maxItems: ids.length, items: { type: 'string', enum: ids } },
    next_check: strictObject({
      kind: { type: 'string', enum: Object.keys(options.next_check_options) },
      report_ids: { type: 'array', minItems: 0, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200 } }
    })
  }) };
}
export function validateNumericClaims(candidate, catalog) {
  const issues = [];
  let validAccountingRefs = 0;
  const issue = (code, claim_index, key) => issues.push({ code, claim_index, ...(key ? { key } : {}) });
  if (!Array.isArray(candidate?.claims)) return { valid: false, issues: [{ code: 'CLAIMS_REQUIRED' }] };
  candidate.claims.forEach((claim, i) => {
    if (!Array.isArray(claim?.metric_refs) || claim.metric_refs.length > 2) { issue('METRIC_REFS_REQUIRED', i); return; }
    const seen = new Set();
    for (const ref of claim.metric_refs) {
      const key = ref?.key;
      if (!ref || typeof key !== 'string' || !Object.hasOwn(catalog, key)) { issue('UNKNOWN_METRIC', i); continue; }
      const beforeReference = issues.length, expected = catalog[key];
      if (!exactKeys(ref, ['key', 'value', 'unit', 'scope'])) issue('METRIC_REFERENCE_SCHEMA', i, key);
      if (seen.has(key)) { issue('DUPLICATE_METRIC', i, key); continue; }
      seen.add(key);
      if (!expected.available) issue('METRIC_UNAVAILABLE', i, key);
      if (typeof ref.value !== 'number' || !Number.isFinite(ref.value) || !Object.is(ref.value, expected.value)) issue('METRIC_VALUE_MISMATCH', i, key);
      if (ref.unit !== expected.unit) issue('METRIC_UNIT_MISMATCH', i, key);
      if (!exactKeys(ref.scope, scopeKeys) || scopeKeys.some(k => ref.scope[k] !== expected.scope[k])) issue('METRIC_SCOPE_MISMATCH', i, key);
      if (!Array.isArray(claim.source_ids) || expected.source_ids.some(id => !claim.source_ids.includes(id))) issue('METRIC_SOURCE_COVERAGE', i, key);
      if (issues.length === beforeReference) validAccountingRefs++;
    }
  });
  if (validAccountingRefs === 0) issue('ACCOUNTING_METRIC_REQUIRED', 'claims');
  return { valid: issues.length === 0, issues };
}
const money = cents => { const absolute = BigInt(Math.abs(cents)); return '$' + (absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0'); };
const signedMoney = cents => (cents > 0 ? '+' : cents < 0 ? '-' : '') + money(cents);
const decimal = number => String(number);
function metricSentence(ref) {
  const value = ref.value;
  switch (ref.key) {
    case 'metrics.gap_cents': return value === 0 ? 'Straight time wage cost matched the target ($0.00 gap).' : 'Straight time wage cost was ' + money(value) + (value > 0 ? ' above' : ' below') + ' target.';
    case 'metrics.actual_sales_cents': return 'Recorded net sales: ' + money(value) + '.';
    case 'metrics.actual_labor_cents': return 'Recorded straight time wage cost: ' + money(value) + '.';
    case 'metrics.target_labor_cents': return 'Policy target for straight time wage cost: ' + money(value) + '.';
    case 'metrics.target_percent': return 'Policy target for straight time wage cost as a share of net sales: ' + decimal(value) + '%.';
    case 'metrics.actual_labor_percent': return 'Recorded straight time wage cost as a share of net sales: ' + decimal(value) + '%.';
    case 'metrics.variance_percentage_points': return value === 0 ? 'Straight time wage share matched the policy target (0 percentage points).' : 'Straight time wage share was ' + decimal(Math.abs(value)) + ' percentage points ' + (value > 0 ? 'above' : 'below') + ' the policy target.';
    default: return 'Signed accounting bridge component: ' + ({
      'bridge.planned_variance_cents': 'planned straight time wage variance',
      'bridge.sales_denominator_effect_cents': 'sales plan target denominator effect',
      'bridge.labor_change_cents': 'change in straight time wage dollars from plan'
    })[ref.key] + ': ' + signedMoney(value) + '.';
  }
}
// Model output selects stable fact IDs only. Values, units, source IDs and scope
// are bound from the actual catalog, never copied or repaired from model text.
export function evaluateDecision(candidate, result, records, corrections = []) {
  const catalog = metricCatalog(result, records), issues = [], resolvedClaims = [];
  const issue = code => issues.push({ code });
  const allowed = new Set(result.evidence.map(row => row.id));
  const claims = Array.isArray(candidate?.claims) ? candidate.claims : [];
  if (!exactKeys(candidate, ['claims', 'limitation_ids', 'next_check']) || claims.length !== 1) issue('DECISION_SCHEMA');
  for (const claim of claims) {
    let keys = [];
    if (claim?.kind === 'metric_observation') {
      if (!exactKeys(claim, ['kind', 'metric_key'])) { issue('CLAIM_SCHEMA'); continue; }
      if (typeof claim.metric_key !== 'string' || !Object.hasOwn(catalog, claim.metric_key)) issue('UNKNOWN_METRIC');
      else keys = [claim.metric_key];
    } else if (claim?.kind === 'accounting_bridge') {
      if (!exactKeys(claim, ['kind', 'component_key'])) { issue('CLAIM_SCHEMA'); continue; }
      if (typeof claim.component_key !== 'string' || !bridgeKeys.includes(claim.component_key)) issue('CLAIM_METRIC_BINDING');
      else keys = ['metrics.gap_cents', claim.component_key];
    } else issue('UNKNOWN_CLAIM_KIND');
    if (keys.length) resolvedClaims.push({ kind: claim.kind, source_ids: [...new Set(keys.flatMap(key => catalog[key].source_ids))],
      metric_refs: keys.map(key => ({ key, value: catalog[key].value, unit: catalog[key].unit, scope: { ...catalog[key].scope } })) });
  }
  const numeric = validateNumericClaims({ claims: resolvedClaims }, catalog);
  const citationsValid = resolvedClaims.length === 1 && resolvedClaims.every(claim => claim.source_ids.length > 0 &&
    claim.source_ids.every(id => allowed.has(id)) && sameSet(claim.source_ids, [...new Set(claim.metric_refs.flatMap(ref => catalog[ref.key].source_ids))]));
  if (!citationsValid) issue('CLAIM_SOURCE_BINDING');
  const required = limitationIds(result);
  const limitationsValid = required !== null && sameSet(candidate?.limitation_ids, required);
  if (!limitationsValid) issue('LIMITATIONS_REQUIRED');
  const check = candidate?.next_check, reports = eligibleReports(corrections, result.scope);
  let nextCheckValid = exactKeys(check, ['kind', 'report_ids']) && typeof check.kind === 'string' && Object.hasOwn(nextCheckText, check.kind) && Array.isArray(check.report_ids) &&
    check.report_ids.length <= 20 && new Set(check.report_ids).size === check.report_ids.length && check.report_ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200);
  if (nextCheckValid) nextCheckValid = check.kind === 'verify_manager_report'
    ? check.report_ids.length > 0 && check.report_ids.every(id => reports.some(note => note.id === id))
    : check.report_ids.length === 0;
  if (!nextCheckValid) issue('NEXT_CHECK_CONTEXT_INVALID');
  const valid = issues.length === 0 && numeric.valid;
  const analysis = valid ? {
    claims: resolvedClaims.map(claim => ({ kind: claim.kind, source_ids: [...claim.source_ids], metric_refs: structuredClone(claim.metric_refs),
      text: (claim.kind === 'accounting_bridge' ? ['metrics.gap_cents', ...bridgeKeys].flatMap(key => claim.metric_refs.filter(ref => ref.key === key)) : claim.metric_refs).map(metricSentence).join(' ') + ' The cause remains unverified.' })),
    next_check: nextCheckText[check.kind], next_check_kind: check.kind, next_check_report_ids: [...check.report_ids],
    limitation_ids: [...required], limitations: [...result.limitations], rendering: 'code_from_validated_model_selection', reference_binding: 'code_from_validated_catalog'
  } : null;
  return { valid, issues, numeric_validation: numeric, citations_valid: citationsValid, limitation_ids_valid: limitationsValid, next_check_valid: nextCheckValid,
    resolved_claims: resolvedClaims, reference_binding: 'code_from_validated_catalog', analysis };
}
export function sameRenderedAnalysis(actual, expected) { return expected !== null && isDeepStrictEqual(actual, expected); }
