import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { investigate } from './investigate.mjs';
import { getZetarisStatus } from './zetaris-source.mjs';
import { reconcile, SCOPE } from './reconcile.mjs';
import { evaluateDecision, sameRenderedAnalysis } from './decision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const families = ['sales', 'labor', 'policy'];

// A live receipt requires the actual application path and transport evidence.
// Passing this check does not establish the rest of the competition submission.
export function assessLiveResult(result) {
  const failures = [];
  const require = (condition, code) => { if (!condition) failures.push(code); };
  const transports = { 'Zetaris REST': 'direct_rest', 'Zetaris UI proxy': 'ui_proxy' };
  const sourceTransport = typeof result?.source_provider === 'string' && Object.hasOwn(transports, result.source_provider) ? transports[result.source_provider] : null;
  require(result?.status === 'reconciled', 'RECONCILIATION_REQUIRED');
  require(result?.source_mode === 'zetaris' && ['direct_rest', 'ui_proxy'].includes(sourceTransport), 'ZETARIS_SOURCE_REQUIRED');
  for (const field of ['hmem', 'zetaris', 'nightshift_discovery', 'nightshift_text']) {
    require(result?.integration?.[field] === true, field.toUpperCase() + '_NOT_VERIFIED');
  }
  require(Object.entries(SCOPE).every(([key, value]) => result?.scope?.[key] === value), 'SCOPE_MISMATCH');
  require(result?.metrics?.gap_cents === 60000, 'CANONICAL_FIXTURE_GAP_MISMATCH');
  require(result?.evidence_review?.status === 'accepted_by_model_critic' &&
    result?.evidence_review?.numeric_claims_valid === true &&
    Array.isArray(result?.analysis?.claims) && result.analysis.claims.length > 0,
  'ACCEPTED_EXPLANATION_REQUIRED');
  const rawTrace = Array.isArray(result?.trace) ? result.trace : [];
  require(Array.isArray(result?.trace) && rawTrace.every(row => row && typeof row === 'object' && !Array.isArray(row)), 'MODEL_TRACE_SHAPE_REQUIRED');
  const trace = rawTrace.filter(row => row && typeof row === 'object' && !Array.isArray(row));
  const acceptedAttempt = result?.evidence_review?.attempts;
  const selections = trace.filter(row => row.role === 'investigator' && row.stage === 'explanation' && row.attempt === acceptedAttempt && row.value);
  const guards = trace.filter(row => row.role === 'decision_guard' && row.stage === 'typed_decision_validation' && row.attempt === acceptedAttempt);
  const bindings = trace.filter(row => row.role === 'fact_binding' && row.stage === 'catalog_resolution' && row.attempt === acceptedAttempt);
  const critics = trace.filter(row => row.role === 'evidence_critic' && row.stage === 'review' && row.attempt === acceptedAttempt && row.value);
  let decisionBound = false;
  try {
    const computed = reconcile(result?.source_records, SCOPE);
    const evaluated = evaluateDecision(selections[0]?.value, computed, result.source_records, result.corrections || []);
    decisionBound = Number.isInteger(acceptedAttempt) && acceptedAttempt >= 1 && acceptedAttempt <= 2 && selections.length === 1 &&
      typeof selections[0].route === 'string' && selections[0].route.startsWith('meterless/') &&
      result.evidence_review.typed_decision_valid === true && result.evidence_review.references_bound === true && result.evidence_review.limitations_bound === true &&
      guards.length === 1 && guards[0].valid === true && guards[0].limitation_ids_valid === true && guards[0].next_check_valid === true &&
      bindings.length === 1 && bindings[0].binding === 'code_from_validated_catalog' && bindings[0].selection_valid === true &&
      isDeepStrictEqual(bindings[0].claims, evaluated.resolved_claims) &&
      evaluated.valid && sameRenderedAnalysis(result.analysis, evaluated.analysis) &&
      isDeepStrictEqual(result.metrics, computed.metrics) && isDeepStrictEqual(result.bridge, computed.bridge) &&
      result.headline === computed.headline && isDeepStrictEqual(result.evidence, computed.evidence) &&
      Array.isArray(result.limitations) && result.limitations.length === computed.limitations.length && result.limitations.every((text, index) => text === computed.limitations[index]);
  } catch { /* An incomplete or legacy result cannot establish the typed binding. */ }
  require(decisionBound, 'TYPED_DECISION_RENDERING_REQUIRED');
  require(critics.length === 1 && typeof critics[0].route === 'string' && critics[0].route.startsWith('meterless/') && critics[0].value.accepted === true &&
    Object.keys(critics[0].value).length === 3 &&
    Array.isArray(critics[0].value.issues) && critics[0].value.issues.length === 0 &&
    Array.isArray(critics[0].value.missing_evidence) && critics[0].value.missing_evidence.length === 0,
  'ACCEPTED_CRITIC_TRACE_REQUIRED');
  const reads = trace.filter(row => row.role === 'source');
  require(reads.length === families.length && families.every(family => {
    const rows = reads.filter(row => row.family === family);
    const row = rows[0];
    return rows.length === 1 && row.tool === 'zetaris_rest_sql' && row.api_transport === sourceTransport &&
      row.http_status === 200 &&
      row.transport === 'network' && row.transport_verified === true &&
      row.mapping_verified === true && row.integration_verified === true &&
      row.status === 'validated' && row.row_count === 1 &&
      typeof row.source_id === 'string' && row.source_id === result?.source_records?.[family]?.id &&
      Object.entries(SCOPE).every(([key, value]) => row.scope?.[key] === value);
  }), 'NETWORK_SOURCE_RECEIPTS_REQUIRED');
  for (const [role, stage] of [['investigator', 'plan'], ['investigator', 'explanation'], ['evidence_critic', 'review']]) {
    require(trace.some(row => row.role === role && row.stage === stage && row.value &&
      typeof row.route === 'string' && row.route.startsWith('meterless/')), 'MODEL_TRACE_' + stage.toUpperCase() + '_REQUIRED');
  }
  return { passed: failures.length === 0, failures };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    'output-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' }
  } });
  if (values.help) {
    process.stdout.write('node --experimental-transform-types src/live-run.mjs [--output-dir PATH]\nRuns real Zetaris + Nightshift only. Requires configured local services. No fixture fallback.\n');
    return;
  }
  try { process.loadEnvFile(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const created = new Date().toISOString();
  const outputDir = values['output-dir'] ? path.resolve(values['output-dir']) :
    path.join(root, '.costproof/live', created.replace(/[:.]/g, '-'));
  await mkdir(outputDir, { recursive: true });
  const uiProxy = process.env.ZETARIS_TRANSPORT === 'ui_proxy';
  const sourceTransport = process.env.ZETARIS_TRANSPORT || 'direct_rest';
  const receipt = {
    schema_version: 'costproof.live-receipt.v1', created_at_utc: created,
    classification: 'LIVE_SPONSOR_RUN_OVER_SYNTHETIC_RECORDS',
    scope: SCOPE, status: 'blocked', passed: false,
    zetaris_transport: ['direct_rest', 'ui_proxy'].includes(sourceTransport) ? sourceTransport : 'unrecognized',
    configuration_presence: Object.fromEntries(['METERLESS_RUNTIME_TOKEN', 'ZETARIS_MAPPING_PROOF_PATH',
      ...(uiProxy ? ['ZETARIS_UI_BASE_URL', 'ZETARIS_UI_AUTH_ENV_PATH'] : ['ZETARIS_API_KEY', 'ZETARIS_ORG_ID'])].map(key => [key, Boolean(process.env[key]?.trim())])),
    configuration_note: uiProxy
      ? 'UI proxy credentials come from the explicitly selected private bundle environment file; login supplies the actual organization ID and the session token stays in memory.'
      : 'Direct REST requires the configured API key and numeric organization ID.',
    fixture_fallback_used: false, competition_submission_complete: false,
    claim_boundary: 'This receipt assesses a live sponsor run only. It does not verify browser UX, Cursor activity, the recording, final submission or customer outcomes.'
  };
  let timer;
  try {
    const sourceStatus = await getZetarisStatus();
    if (!sourceStatus.configured) throw Object.assign(new Error('Source configuration required'), { code: sourceStatus.error });
    if (!receipt.configuration_presence.METERLESS_RUNTIME_TOKEN) throw Object.assign(new Error('Model configuration required'), { code: 'NIGHTSHIFT_TOKEN_REQUIRED' });
    const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-live-memory-'));
    // This command runs in its own process. A hard limit stops hung external calls.
    timer = setTimeout(() => {
      process.stderr.write('{"status":"blocked","error":"LIVE_RUN_DEADLINE","receipt_complete":false}\n');
      process.exit(1);
    }, 240000);
    const result = await investigate({ question: 'Why did dinner labor finish above target?', scenario: 'complete', liveModel: true, sourceMode: 'zetaris' }, { memoryRoot });
    const assessment = assessLiveResult(result);
    Object.assign(receipt, assessment, { status: assessment.passed ? 'passed' : 'blocked',
      integration: result.integration, evidence_review: result.evidence_review,
      gap_cents: result.metrics?.gap_cents ?? null, trace_file: 'live.trace.json' });
    await writeFile(path.join(outputDir, 'live.trace.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    // Raw provider errors may contain data. Persist only bounded error codes.
    receipt.error = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'LIVE_RUN_FAILED';
  } finally { clearTimeout(timer); }
  await writeFile(path.join(outputDir, 'live.receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify(receipt) + '\n');
  process.stderr.write('Live receipt saved in ' + path.relative(process.cwd(), outputDir) + '\n');
  if (!receipt.passed) process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('{"status":"blocked","error":"LIVE_RECEIPT_WRITE_FAILED"}\n'); process.exitCode = 1; });
}
