import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Zetaris, ZetarisError, ZETARIS_COLUMNS } from './zetaris.mjs';
import { SCOPE } from './reconcile.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FAMILIES = Object.freeze(Object.keys(ZETARIS_COLUMNS));
const MAX_PROOF_BYTES = 65536;
const fail = (code, message) => { throw new ZetarisError(code, message); };

function localPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\0\r\n]/.test(value))
    fail('ZETARIS_MAPPING_UNVERIFIED', 'Configure a local JSON mapping proof file');
  const portable = value.replace(/\\/g, '/');
  // No URLs, UNC shares, Windows device paths, alternate data streams or
  // drive-relative paths. Proofs may be native absolute or project-relative.
  const driveAbsolute = /^[A-Za-z]:\//.test(portable);
  if (portable.startsWith('//') || (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(portable) && !driveAbsolute) ||
      portable.slice(driveAbsolute ? 2 : 0).includes(':') || path.extname(value).toLowerCase() !== '.json')
    fail('ZETARIS_MAPPING_UNVERIFIED', 'Mapping proof must be a local JSON file, not a URL or network path');
  return path.resolve(ROOT, value);
}
async function loadMappingProof(file) {
  const candidate = localPath(file);
  let bytes;
  try {
    const resolved = await realpath(candidate);
    localPath(resolved); // Also reject a symlink resolving to a network/device path.
    const details = await stat(resolved);
    if (!details.isFile() || details.size > MAX_PROOF_BYTES) throw new Error('Invalid proof file');
    bytes = await readFile(resolved);
    if (bytes.length > MAX_PROOF_BYTES) throw new Error('Invalid proof file');
  } catch { fail('ZETARIS_MAPPING_UNVERIFIED', 'The local mapping proof file is unavailable or invalid'); }
  let proof;
  try { proof = JSON.parse(bytes.toString('utf8')); }
  catch { fail('ZETARIS_MAPPING_UNVERIFIED', 'The local mapping proof is not valid JSON'); }
  if (!proof || typeof proof !== 'object' || Array.isArray(proof) || proof.verified !== true ||
      typeof proof.evidence_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(proof.evidence_id) ||
      !FAMILIES.every(family => typeof proof.tables?.[family] === 'string' &&
        Array.isArray(proof.columns?.[family]) && JSON.stringify(proof.columns[family]) === JSON.stringify(ZETARIS_COLUMNS[family])))
    fail('ZETARIS_MAPPING_UNVERIFIED', 'A reviewed proof with matching tables and exact projected columns is required');
  return proof;
}
function checkedOrder(order) {
  if (!Array.isArray(order) || order.length !== FAMILIES.length || new Set(order).size !== FAMILIES.length || order.some(family => !FAMILIES.includes(family)))
    fail('ZETARIS_QUERY_NOT_ALLOWED', 'Use each supported evidence family once');
  return [...order];
}

// Reads process configuration and ONE explicitly selected local mapping file.
// It does not load .env, discover private files, create keys or contact Zetaris.
export async function createConfiguredZetaris({ env = process.env, fetcher } = {}) {
  if (!env || typeof env !== 'object') fail('ZETARIS_CONFIG', 'Invalid Zetaris process configuration');
  if (typeof env.ZETARIS_API_KEY !== 'string' || !env.ZETARIS_API_KEY.trim() ||
      typeof env.ZETARIS_ORG_ID !== 'string' || !/^[1-9]\d{0,14}$/.test(env.ZETARIS_ORG_ID))
    fail('ZETARIS_CONFIG_MISSING', 'Configure the user-created API key and actual numeric organization ID');
  const proof = await loadMappingProof(env.ZETARIS_MAPPING_PROOF_PATH);
  const tables = Object.fromEntries(FAMILIES.map(family => [family, env['ZETARIS_TABLE_' + family.toUpperCase()] || proof.tables[family]]));
  if (FAMILIES.some(family => tables[family] !== proof.tables[family]))
    fail('ZETARIS_MAPPING_UNVERIFIED', 'Configured table identifiers do not match the reviewed mapping proof');
  const client = new Zetaris({ base: env.ZETARIS_BASE_URL || 'http://localhost:8888/api/v1.0',
    token: env.ZETARIS_API_KEY, orgId: env.ZETARIS_ORG_ID, tables, mappingProof: proof,
    ...(fetcher === undefined ? {} : { fetcher }) });
  if (!client.mappingVerified) fail('ZETARIS_MAPPING_UNVERIFIED', 'The adapter did not accept the mapping proof');
  return client;
}
function checkClient(client) {
  if (!(client instanceof Zetaris)) fail('ZETARIS_CONFIG', 'Use the checked Zetaris adapter as the source client');
  if (!client.mappingVerified) fail('ZETARIS_MAPPING_UNVERIFIED', 'The source adapter requires a reviewed mapping proof');
  return client;
}

// Live source collection is separate from fixture scenarios. There is no
// scenario selection, synthetic mutation, fixture import, or fallback here.
export async function readZetaris(order = FAMILIES, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['client', 'env', 'scope'].includes(key)))
    fail('ZETARIS_CONFIG', 'Live source options accept client, environment and scope only; fixture fault injection is separate');
  const plan = checkedOrder(order);
  const client = checkClient(options.client || await createConfiguredZetaris({ env: options.env || process.env }));
  const out = await client.readSources(options.scope || SCOPE, plan);
  return { ...out, source_mode: 'zetaris', synthetic: true, fixture_fault_injection: false };
}

// A local configuration check only: deliberately no network probe, discovery
// or cached health claim. A run's returned receipts establish query verification.
export async function getZetarisStatus({ client, env = process.env } = {}) {
  try {
    const configured = checkClient(client || await createConfiguredZetaris({ env }));
    return { provider: 'Zetaris REST', status: 'configured_unverified', configured: true,
      mapping_proof_present: true, mapping_evidence_id: configured.mappingEvidenceId,
      query_verified: false, verified: false,
      message: 'Local configuration and reviewed mapping are present; a real scoped query is still required.' };
  } catch (error) {
    const mapping = error.code === 'ZETARIS_MAPPING_UNVERIFIED';
    const missing = error.code === 'ZETARIS_CONFIG_MISSING';
    return { provider: 'Zetaris REST', status: mapping ? 'mapping_unverified' : missing ? 'not_configured' : 'configuration_error',
      configured: false, mapping_proof_present: false, query_verified: false, verified: false,
      error: mapping ? 'ZETARIS_MAPPING_UNVERIFIED' : missing ? 'ZETARIS_CONFIG_MISSING' : 'ZETARIS_CONFIG',
      message: mapping ? 'A reviewed local source mapping proof is required.' : missing ? 'Local API credentials and organization ID are not configured.' : 'Local Zetaris settings require review.' };
  }
}
