import { reconcile, SCOPE } from './reconcile.mjs';
import { readFixture, readZetaris } from './sources.mjs';
import { recallCorrections } from './memory.mjs';
import { Nightshift } from './nightshift.mjs';
import { metricCatalog, decisionContract, decisionOptions, evaluateDecision } from './decision.mjs';
const boundedText = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const strictObject = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const planContract = { name: 'costproof_plan', maxTokens: 128, schema: strictObject({
  source_order: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', enum: ['sales', 'labor', 'policy'] } }
}) };
const criticContract = { name: 'costproof_evidence_review', maxTokens: 512, schema: strictObject({
  accepted: { type: 'boolean' },
  issues: { type: 'array', minItems: 0, maxItems: 12, items: boundedText(1000) },
  missing_evidence: { type: 'array', minItems: 0, maxItems: 12, items: boundedText(1000) }
}) };
function validReview(value) {
  return value && Object.keys(value).length === 3 && ['accepted', 'issues', 'missing_evidence'].every(key => Object.hasOwn(value, key)) && typeof value.accepted === 'boolean' &&
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
    const plan = await model.json('investigator', 'Plan read only evidence collection. Return an object with only source_order, an array containing sales, labor and policy exactly once each. All families are required; choose their order based on the question. No causal explanation or other tools.', { question, scope: SCOPE, corrections: corrections.map(c => c.note), available_sources: order }, planContract);
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
    proposed_action: { owner: 'Restaurant manager', status: 'unsent proposal', text: result.status === 'needs_evidence' ? result.request : corrections.length ? 'Verify the remembered manager report against approval and time records; compare the sales forecast before changing staffing.' : 'Compare the recorded wage dollars with shift approval and time records, then check the sales forecast.' }
  };
  if (answer.evidence_requests.length) trace.push({ role: 'investigator', stage: 'request_missing_evidence', requests: answer.evidence_requests, conclusion_held: true });
  if (!liveModel || result.status !== 'reconciled') {
    answer.mode = liveModel ? 'Dollar conclusion held for missing evidence' : sourceMode === 'fixture' ? 'Deterministic synthetic preview' : 'Deterministic check over Zetaris sources';
    return answer;
  }
  const catalog = metricCatalog(result, sources.records);
  const options = decisionOptions(result, corrections), investigationContract = decisionContract(result, corrections);
  answer.metric_catalog = catalog;
  // Source rows stay intact. Repeated derived values and scopes are sent once;
  // the full internal catalog above still governs every accepted reference.
  const bridgeKeys = ['planned_variance_cents', 'sales_denominator_effect_cents', 'labor_change_cents'];
  const packet = { question, scope: SCOPE,
    deterministic_result: { status: result.status, headline: result.headline, limitations: result.limitations,
      bridge: result.bridge.map((row, i) => ({ label: row.label, metric_key: 'bridge.' + bridgeKeys[i] })) },
    metric_catalog: Object.fromEntries(Object.entries(catalog).map(([key, { value, unit, source_ids, available }]) => [key, { value, unit, source_ids, available }])),
    source_records: sources.records, manager_reports: corrections.map(c => c.note), decision_options: options };
  const rejectInvalidModelOutput = (error, role, stage, attempt) => {
    if (!['MODEL_INVALID_JSON', 'MODEL_OUTPUT_TRUNCATED', 'MODEL_SCHEMA_INVALID'].includes(error.code)) throw error;
    trace.push({ role, stage, attempt, error: error.code, ...(error.receipt || {}), accepted: false });
    if (error.receipt?.model_text_returned) answer.integration.nightshift_text = true;
    answer.evidence_requests = evidenceRequests(['A complete valid ' + role + ' response is required before accepting the explanation.'], 'model_output_validation');
    answer.evidence_review = { status: 'rejected', semantic_support: 'not_accepted', attempts: attempt, model_error: error.code };
    return { model_error: error.code, instruction: 'The preceding model output was invalid or truncated. Return a short complete JSON object matching the requested schema; do not invent evidence.' };
  };
  let feedback = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let investigation;
    try {
      investigation = await model.json('investigator', [
        'Select a supported accounting fact and relevant next record check. Return exactly claims, limitation_ids and next_check; never write narrative text.',
        'claims contains exactly one selector: {kind: metric_observation, metric_key: an available metric_catalog key} OR {kind: accounting_bridge, component_key: one bridge key}. Choose a fact relevant to the question using decision_options.claim_kinds. A bridge selector automatically includes the gap plus that component.',
        'Never output values, units, scope, source_ids or metric_refs. Code binds all exact quantities and evidence from the validated catalog after your selection. Do not copy records, invent measurements, causes or savings, or return extra fields.',
        'limitation_ids must contain every key from decision_options.required_limitations exactly once, no extras. Code will display all bound limitations and fixed wording; you are choosing typed facts, not authoring a narrative.',
        'next_check has exactly kind and report_ids. Choose a kind from decision_options.next_check_options. verify_manager_report requires existing eligible report IDs; other kinds require an empty report_ids array. Manager statements remain unverified, never replace payroll and do not establish a training topic or cause. No staffing changes or completed actions.'
      ].join(' '), { ...packet, critic_feedback: feedback }, investigationContract);
    } catch (error) {
      feedback = rejectInvalidModelOutput(error, 'investigator', 'explanation', attempt);
      continue;
    }
    trace.push({ role: 'investigator', stage: 'explanation', attempt, ...investigation });
    const decision = evaluateDecision(investigation.value, result, sources.records, corrections);
    const structurallyValid = decision.citations_valid;
    trace.push({ role: 'fact_binding', stage: 'catalog_resolution', attempt, binding: decision.reference_binding, claims: decision.resolved_claims,
      selection_valid: decision.valid, note: 'These values, units, scope and sources are code-bound catalog facts, not generated or repaired model quantities.' });
    trace.push({ role: 'citation_guard', stage: 'source_id_validation', attempt, valid: structurallyValid, semantic_support: 'requires_evidence_critic', note: 'An allowed source ID proves a reference exists; it does not prove the claim follows from that source.' });
    const numericValidation = decision.numeric_validation;
    trace.push({ role: 'numeric_guard', stage: 'deterministic_metric_validation', attempt, ...numericValidation, scope: SCOPE, note: 'Code-bound quantities, units, scope and source coverage are checked by the exact numeric guard. Selection relevance still requires the evidence critic.' });
    trace.push({ role: 'decision_guard', stage: 'typed_decision_validation', attempt, valid: decision.valid, issues: decision.issues,
      limitation_ids_valid: decision.limitation_ids_valid, next_check_valid: decision.next_check_valid,
      rendering: decision.analysis?.rendering || null, note: 'Raw model selection is unchanged in its trace. Only validated closed selections can reach canonical code-rendered text.' });
    let review;
    try {
      review = await model.json('evidence_critic', [
        'Review the raw fact-ID model_decision and canonical code-bound candidate against the question, exact records and metric_catalog. References, values, units, scope and source IDs are resolved by code, not generated by the model. The model selects facts/checks; code renders fixed wording.',
        'Reject if decision_validation or numeric_validation is invalid, the candidate is null, selections are irrelevant, sources fail to support a selected metric, a required limitation is missing, or the next check is not eligible for this context. An approving review cannot override code guards.',
        'The candidate must preserve every deterministic limitation: synthetic data, accounting rather than cause or recovered savings, and straight time wage exclusions. Manager report references must remain unverified and must not replace payroll. Do not infer a topic such as training from an arbitrary report.',
        'A supported accounting observation does not require causal proof when cause remains unverified. A proposed future record check is not a claim that its cause is proven. Do not approve staffing cuts, paid/completed actions or missing records as facts.',
        'Return exactly accepted (boolean), issues (array of specific defects), and missing_evidence (array of concrete records required to support a claimed conclusion). Empty arrays mean no defects or missing support for the claims actually made; a proposed future cause check is not itself a causal claim. Accept only if every claim and limitation is supported. Keep the review short.'
      ].join(' '), { ...packet, model_decision: investigation.value, candidate: decision.analysis,
        decision_validation: { valid: decision.valid, issues: decision.issues, limitation_ids_valid: decision.limitation_ids_valid, next_check_valid: decision.next_check_valid }, numeric_validation: numericValidation }, criticContract);
    } catch (error) {
      feedback = rejectInvalidModelOutput(error, 'evidence_critic', 'review', attempt);
      continue;
    }
    trace.push({ role: 'evidence_critic', stage: 'review', attempt, ...review });
    answer.integration.nightshift_text = true;
    const reviewValid = validReview(review.value);
    if (decision.valid && reviewValid && review.value.accepted === true && review.value.issues.length === 0 && review.value.missing_evidence.length === 0) {
      answer.analysis = decision.analysis;
      answer.mode = 'Nightshift investigation with evidence critique';
      answer.evidence_requests = [];
      answer.evidence_review = { status: 'accepted_by_model_critic', semantic_support: 'model_reviewed_not_independent_verification', numeric_claims_valid: true,
        typed_decision_valid: true, references_bound: true, limitations_bound: true, attempts: attempt };
      answer.proposed_action.text = decision.analysis.next_check;
      return answer;
    }
    answer.evidence_requests = evidenceRequests(reviewValid ? review.value.missing_evidence : ['A valid evidence critic response is required before accepting the explanation.'], 'evidence_critic');
    answer.evidence_review = { status: 'rejected', semantic_support: 'not_accepted', attempts: attempt, critic_response_valid: reviewValid, citations_valid: structurallyValid, numeric_claims_valid: numericValidation.valid, numeric_issues: numericValidation.issues,
      typed_decision_valid: decision.valid, decision_issues: decision.issues, limitations_bound: decision.limitation_ids_valid, next_check_valid: decision.next_check_valid };
    if (answer.evidence_requests.length) trace.push({ role: 'investigator', stage: 'request_missing_evidence', attempt, requests: answer.evidence_requests, tools_exhausted: true, note: 'All three available source families were read. No missing external record was fetched or invented.' });
    feedback = { structural_citations_valid: structurallyValid, numeric_validation: numericValidation, decision_validation: { valid: decision.valid, issues: decision.issues }, critic_response_valid: reviewValid, review: review.value, evidence_requests: answer.evidence_requests, instruction: 'Revise only the typed selections to supported available metrics and eligible checks, with all limitation IDs. A requested record has not been fetched. No freeform narrative is permitted.' };
  }
  answer.mode = 'Escalated after two investigation attempts';
  answer.model_escalation = 'The model explanation was not accepted. Review validation failures and any evidence critique in the run trace before drawing a conclusion.';
  return answer;
}
