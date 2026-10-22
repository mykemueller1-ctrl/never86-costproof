import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { investigate } from './investigate.mjs';
import { getZetarisStatus } from './zetaris-source.mjs';
import { SCOPE } from './reconcile.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const families = ['sales', 'labor', 'policy'];

// A live receipt requires the actual application path and transport evidence.
// Passing this check does not establish the rest of the competition submission.
export function assessLiveResult(result) {
  const failures = [];
  const require = (condition, code) => { if (!condition) failures.push(code); };
  require(result?.status === 'reconciled', 'RECONCILIATION_REQUIRED');
  require(result?.source_mode === 'zetaris' && result?.source_provider === 'Zetaris REST', 'ZETARIS_SOURCE_REQUIRED');
  for (const field of ['hmem', 'zetaris', 'nightshift_discovery', 'nightshift_text']) {
    require(result?.integration?.[field] === true, field.toUpperCase() + '_NOT_VERIFIED');
  }
  require(Object.entries(SCOPE).every(([key, value]) => result?.scope?.[key] === value), 'SCOPE_MISMATCH');
  require(result?.metrics?.gap_cents === 60000, 'CANONICAL_FIXTURE_GAP_MISMATCH');
  require(result?.evidence_review?.status === 'accepted_by_model_critic' &&
    result?.evidence_review?.numeric_claims_valid === true &&
    Array.isArray(result?.analysis?.claims) && result.analysis.claims.length > 0,
  'ACCEPTED_EXPLANATION_REQUIRED');
  const trace = Array.isArray(result?.trace) ? result.trace : [];
  const reads = trace.filter(row => row.role === 'source');
  require(reads.length === families.length && families.every(family =>
    reads.some(row => row.family === family && row.tool === 'zetaris_rest_sql' &&
      row.transport === 'network' && row.transport_verified === true &&
      row.mapping_verified === true && row.integration_verified === true &&
      row.status === 'validated' && row.row_count === 1 &&
      row.source_id === result?.source_records?.[family]?.id)), 'NETWORK_SOURCE_RECEIPTS_REQUIRED');
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
  const receipt = {
    schema_version: 'costproof.live-receipt.v1', created_at_utc: created,
    classification: 'LIVE_SPONSOR_RUN_OVER_SYNTHETIC_RECORDS',
    scope: SCOPE, status: 'blocked', passed: false,
    configuration_presence: Object.fromEntries(['METERLESS_RUNTIME_TOKEN', 'ZETARIS_API_KEY', 'ZETARIS_ORG_ID', 'ZETARIS_MAPPING_PROOF_PATH'].map(key => [key, Boolean(process.env[key]?.trim())])),
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
