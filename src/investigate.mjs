import { reconcile, SCOPE } from './reconcile.mjs';
import { readFixture, readZetaris } from './sources.mjs';
import { recallCorrections } from './memory.mjs';
import { Nightshift } from './nightshift.mjs';
function candidateIsCited(value, allowed) {
  return Array.isArray(value?.claims) && value.claims.length > 0 && value.claims.length <= 8 &&
    value.claims.every(c => c && typeof c.text === 'string' && c.text.trim().length > 0 && c.text.length <= 800 && Array.isArray(c.source_ids) && c.source_ids.length > 0 && new Set(c.source_ids).size === c.source_ids.length && c.source_ids.every(id => allowed.has(id))) &&
    typeof value.next_check === 'string' && value.next_check.trim().length > 0 && value.next_check.length <= 1000;
}
const scopeKeys = ['restaurant_id', 'shift_id', 'business_date', 'currency'];
// Quantities belong in typed references, never in generated prose. The prose
// critic still reviews semantic support and attempts to imply quantities/causes.
const quantityInProse = /\p{Number}|[$€£¥%]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|half|quarter|twice|double|triple)\b/iu;
function metricCatalog(result, records) {
  const { sales, labor, policy } = records;
  const all = [sales.id, labor.id, policy.id];
  const catalog = {};
  const add = (key, value, unit, source_ids) => { catalog[key] = { key, value, unit, source_ids, scope: result.scope, available: typeof value === 'number' && Number.isFinite(value) }; };
  for (const [name, unit, ids] of [
    ['actual_sales_cents', 'USD_cents', [sales.id]],
    ['actual_labor_cents', 'USD_cents', [labor.id]],
    ['target_labor_cents', 'USD_cents', [sales.id, policy.id]],
    ['target_percent', 'percent', [policy.id]],
    ['actual_labor_percent', 'percent', [sales.id, labor.id]],
    ['variance_percentage_points', 'percentage_points', all],
    ['gap_cents', 'USD_cents', all]
  ]) add('metrics.' + name, result.metrics[name], unit, ids);
  for (const [i, name] of ['planned_variance_cents', 'sales_denominator_effect_cents', 'labor_change_cents'].entries()) {
    add('bridge.' + name, result.bridge[i].cents, 'USD_cents', result.bridge[i].source_ids);
  }
  return catalog;
}
function validateNumericClaims(candidate, catalog) {
  const issues = [];
  if (!Array.isArray(candidate?.claims)) return { valid: false, issues: [{ code: 'CLAIMS_REQUIRED' }] };
  const issue = (code, claim_index, key) => issues.push({ code, claim_index, ...(key ? { key } : {}) });
  if (typeof candidate.next_check === 'string' && quantityInProse.test(candidate.next_check)) issue('QUANTITY_MUST_USE_METRIC_REF', 'next_check');
  candidate.claims.forEach((claim, i) => {
    if (typeof claim?.text === 'string' && quantityInProse.test(claim.text)) issue('QUANTITY_MUST_USE_METRIC_REF', i);
    if (!Array.isArray(claim?.metric_refs) || claim.metric_refs.length > 8) { issue('METRIC_REFS_REQUIRED', i); return; }
    const seen = new Set();
    for (const ref of claim.metric_refs) {
      const key = ref?.key;
      if (!ref || typeof key !== 'string' || !Object.hasOwn(catalog, key)) { issue('UNKNOWN_METRIC', i); continue; }
      if (Object.keys(ref).length !== 4 || Object.keys(ref).some(k => !['key', 'value', 'unit', 'scope'].includes(k))) issue('METRIC_REFERENCE_SCHEMA', i, key);
      if (seen.has(key)) { issue('DUPLICATE_METRIC', i, key); continue; }
      seen.add(key);
      const expected = catalog[key];
      if (!expected.available) issue('METRIC_UNAVAILABLE', i, key);
      if (typeof ref.value !== 'number' || !Number.isFinite(ref.value) || !Object.is(ref.value, expected.value)) issue('METRIC_VALUE_MISMATCH', i, key);
      if (ref.unit !== expected.unit) issue('METRIC_UNIT_MISMATCH', i, key);
      if (!ref.scope || Object.keys(ref.scope).length !== scopeKeys.length || scopeKeys.some(k => ref.scope[k] !== expected.scope[k])) issue('METRIC_SCOPE_MISMATCH', i, key);
      if (!Array.isArray(claim.source_ids) || expected.source_ids.some(id => !claim.source_ids.includes(id))) issue('METRIC_SOURCE_COVERAGE', i, key);
    }
  });
  return { valid: issues.length === 0, issues };
}
function validReview(value) {
  return value && typeof value.accepted === 'boolean' &&
    ['issues', 'missing_evidence'].every(key => Array.isArray(value[key]) && value[key].length <= 12 && value[key].every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 1000));
}
function evidenceRequests(items, origin) {
  return [...new Set(items)].map(record => ({ record, scope: SCOPE, origin, status: 'not_available_in_current_sources' }));
}
function assertCorrectionProvenance(corrections) {
  for (const { note } of corrections) {
    if (!note || note.classification !== 'UNVERIFIED_MANAGER_REPORT' || note.payroll_overridden !== false ||
        typeof note.id !== 'string' || !note.id.trim() || typeof note.text !== 'string' || !note.text.trim() ||
        note.applies_only_to_shift_id !== SCOPE.shift_id ||
        ['restaurant_id', 'shift_id', 'business_date', 'currency'].some(key => note[key] !== SCOPE[key] || note.scope?.[key] !== SCOPE[key])) {
      throw Object.assign(new Error('A recalled manager report has incomplete provenance; it cannot enter the investigation.'), { code: 'MEMORY_PROVENANCE_INVALID' });
    }
  }
}
export async function investigate({ question = 'Why did dinner labor finish above target?', scenario = 'complete', liveModel = false, sourceMode = 'fixture' } = {}, { model = new Nightshift(), memoryRoot, sourceClient } = {}) {
  if (typeof question !== 'string' || question.trim().length < 5 || question.length > 1500) throw new Error('Enter a question between 5 and 1500 characters');
  if (typeof liveModel !== 'boolean' || !['fixture', 'zetaris'].includes(sourceMode)) throw new Error('Choose a supported source and investigation mode');
  if (sourceMode === 'zetaris' && scenario !== 'complete') throw new Error('Fixture fault scenarios cannot alter registered Zetaris records');
  const trace = [];
  const corrections = await recallCorrections(SCOPE, question, memoryRoot);
  assertCorrectionProvenance(corrections);
  trace.push({ role: 'memory', tool: 'Meterless H-MEM', recalled: corrections.length, scope: SCOPE, verified: true });
  let order = ['sales', 'labor', 'policy'];
  let discovery = { status: 'not_requested', verified: false };
  let modelTextReturned = false;
  if (liveModel) {
    discovery = await model.discover();
    if (discovery.status !== 'online') throw Object.assign(new Error(discovery.status === 'unauthorized' ? 'Paste a valid Nightshift runtime token in local configuration.' : 'Nightshift is offline. Start the local runtime before using model mode.'), { code: 'NIGHTSHIFT_' + discovery.status.toUpperCase() });
    if (!discovery.models.includes(model.model)) throw new Error('Configured Nightshift route was not discovered');
    const plan = await model.json('investigator', 'Plan read only evidence collection. Return {"source_order":["sales","labor","policy"],"reason":"..."}. All three families are needed, but choose their order based on the question. No other tools exist.', { question, scope: SCOPE, corrections: corrections.map(c => c.note), available_sources: order });
    modelTextReturned = true;
    order = plan.value.source_order;
    if (!Array.isArray(order) || order.length !== 3 || new Set(order).size !== 3 || order.some(f => !['sales', 'labor', 'policy'].includes(f))) throw new Error('The model proposed an unsupported source plan');
    trace.push({ role: 'investigator', stage: 'plan', ...plan });
  }
  const sources = sourceMode === 'fixture' ? await readFixture(scenario, order) : await readZetaris(order, { ...(sourceClient ? { client: sourceClient } : {}), scope: SCOPE });
  trace.push(...sources.trace);
  const result = reconcile(sources.records, SCOPE);
  trace.push({ role: 'calculator', stage: 'scope_and_cents', status: result.status, evidence_ids: result.evidence.map(r => r.id), verified: true });
  const answer = { ...result, question, corrections, trace, source_records: sources.records, source_provider: sources.provider, source_mode: sourceMode,
    integration: { hmem: true, zetaris: sources.zetaris_verified === true, nightshift_discovery: discovery.verified, nightshift_text: modelTextReturned, competition_ready: false },
    analysis: null,
    evidence_requests: result.status === 'needs_evidence' ? evidenceRequests([result.request], 'deterministic_coverage_check') : [],
    evidence_review: { status: result.status === 'needs_evidence' ? 'blocked_by_missing_records' : 'not_requested', semantic_support: 'not_reviewed' },
    proposed_action: { owner: 'Restaurant manager', status: 'unsent proposal', text: result.status === 'needs_evidence' ? result.request : corrections.length ? 'Verify the manager training report against approval and time records; compare the sales forecast before changing staffing.' : 'Compare the recorded labor hours with shift approval and time records, then check the sales forecast.' }
  };
  if (answer.evidence_requests.length) trace.push({ role: 'investigator', stage: 'request_missing_evidence', requests: answer.evidence_requests, conclusion_held: true });
  if (!liveModel || result.status !== 'reconciled') {
    answer.mode = liveModel ? 'Dollar conclusion held for missing evidence' : sourceMode === 'fixture' ? 'Deterministic synthetic preview' : 'Deterministic check over Zetaris sources';
    return answer;
  }
  const allowed = new Set([...result.evidence.map(r => r.id), ...corrections.map(c => c.note.id)]);
  const catalog = metricCatalog(result, sources.records);
  answer.metric_catalog = catalog;
  const packet = { question, scope: SCOPE, deterministic_result: result, metric_catalog: catalog, source_records: sources.records, manager_reports: corrections.map(c => c.note) };
  const example = catalog['metrics.gap_cents'];
  const responseShape = { claims: [{ text: 'The gap follows the deterministic reconciliation.', source_ids: example.source_ids, metric_refs: [{ key: example.key, value: example.value, unit: example.unit, scope: example.scope }] }], next_check: 'Review the approval and time records.' };
  let feedback = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const investigation = await model.json('investigator', 'Explain the records without assigning an unsupported cause. Return a JSON object with this schema, choosing relevant supported claims: ' + JSON.stringify(responseShape) + '. Every claim requires metric_refs, empty for a qualitative claim. Copy numeric references only from available metric_catalog entries with exact key, value, unit and complete scope. Each reference contains exactly key, value, unit and scope. Cite every source listed for each referenced metric. Put all quantities in metric_refs; no digits, number words, money symbols or percent signs in text or next_check. Use only supplied source IDs. Manager reports remain unverified and cannot define numeric metrics. The deterministic dollar bridge is authoritative. Do not recommend a staffing cut or claim savings.', { ...packet, critic_feedback: feedback });
    trace.push({ role: 'investigator', stage: 'explanation', attempt, ...investigation });
    const structurallyValid = candidateIsCited(investigation.value, allowed);
    trace.push({ role: 'citation_guard', stage: 'source_id_validation', attempt, valid: structurallyValid, semantic_support: 'requires_evidence_critic', note: 'An allowed source ID proves a reference exists; it does not prove the claim follows from that source.' });
    const numericValidation = validateNumericClaims(investigation.value, catalog);
    trace.push({ role: 'numeric_guard', stage: 'deterministic_metric_validation', attempt, ...numericValidation, scope: SCOPE, note: 'Exact structured quantities and their source coverage are checked in code. Causal and qualitative support still require the evidence critic.' });
    const review = await model.json('evidence_critic', 'Review the investigator against the exact supplied records and math. Reject unsupported numerical claims, causal claims, uncited claims, savings or treating a manager report as verified. Numeric facts must use the exact metric catalog; quantity-bearing prose is invalid. Review the semantic connection between the prose, metric references and cited records even if the deterministic guard passed. Return {"accepted":true or false,"issues":["..."],"missing_evidence":["..."]}. Accept only when every claim is supported and all limitations are preserved.', { ...packet, candidate: investigation.value, numeric_validation: numericValidation });
    trace.push({ role: 'evidence_critic', stage: 'review', attempt, ...review });
    answer.integration.nightshift_text = true;
    const reviewValid = validReview(review.value);
    if (structurallyValid && numericValidation.valid && reviewValid && review.value.accepted === true && review.value.issues.length === 0 && review.value.missing_evidence.length === 0) {
      answer.analysis = investigation.value;
      answer.mode = 'Nightshift investigation with evidence critique';
      answer.evidence_requests = [];
      answer.evidence_review = { status: 'accepted_by_model_critic', semantic_support: 'model_reviewed_not_independent_verification', numeric_claims_valid: true, attempts: attempt };
      answer.proposed_action.text = investigation.value.next_check;
      return answer;
    }
    answer.evidence_requests = evidenceRequests(reviewValid ? review.value.missing_evidence : ['A valid evidence critic response is required before accepting the explanation.'], 'evidence_critic');
    answer.evidence_review = { status: 'rejected', semantic_support: 'not_accepted', attempts: attempt, critic_response_valid: reviewValid, citations_valid: structurallyValid, numeric_claims_valid: numericValidation.valid, numeric_issues: numericValidation.issues };
    if (answer.evidence_requests.length) trace.push({ role: 'investigator', stage: 'request_missing_evidence', attempt, requests: answer.evidence_requests, tools_exhausted: true, note: 'All three available source families were read. No missing external record was fetched or invented.' });
    feedback = { structural_citations_valid: structurallyValid, numeric_validation: numericValidation, critic_response_valid: reviewValid, review: review.value, evidence_requests: answer.evidence_requests, instruction: 'Revise to supported conclusions from available records and exact metric references, or preserve the evidence request. A requested record has not been fetched.' };
  }
  answer.mode = 'Escalated after two investigation attempts';
  answer.model_escalation = 'The evidence critic did not approve the explanation. Review the source records; no model conclusion was accepted.';
  return answer;
}
