import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Zetaris, ZETARIS_COLUMNS } from '../src/zetaris.mjs';
import { createConfiguredZetaris, readZetaris, getZetarisStatus } from '../src/zetaris-source.mjs';
import { readFixture, requireZetaris, readZetaris as sourceExport } from '../src/sources.mjs';
import { SCOPE, reconcile } from '../src/reconcile.mjs';

// Contract tests only. Every possible Zetaris request uses an injected stub.
// A temporary test mapping file is not real source mapping evidence.
const tables = { sales: 'costproof.sales', labor: 'costproof.labor', policy: 'costproof.policy' };
const proof = { verified: true, evidence_id: 'test-only-reviewed-mapping-stub', tables, columns: ZETARIS_COLUMNS };
const testKey = 'test-only-provider-secret';
async function proofFile(t, document = proof, raw = false) {
  const dir = await mkdtemp(path.join(tmpdir(), 'costproof-zetaris-proof-test-'));
  const file = path.join(dir, 'mapping.json');
  await writeFile(file, raw ? document : JSON.stringify(document));
  t.after(async () => { await unlink(file); await rmdir(dir); });
  return file;
}
const configuredEnv = file => ({ ZETARIS_BASE_URL: 'http://127.0.0.1:8888/api/v1.0', ZETARIS_API_KEY: testKey,
  ZETARIS_ORG_ID: '1', ZETARIS_MAPPING_PROOF_PATH: file });
async function stubRows(_url, options) {
  const sql = JSON.parse(options.body).sql;
  const family = Object.keys(tables).find(key => sql.includes(' FROM ' + tables[key] + ' WHERE '));
  assert.ok(family, 'Only the scoped evidence query is expected');
  const fixture = JSON.parse(await readFile(new URL('../seed/sources/' + family + '.json', import.meta.url), 'utf8')).records[0];
  return new Response(JSON.stringify({ data: [ZETARIS_COLUMNS[family].map(column => fixture[column] ?? null)] }));
}
const stubClient = () => new Zetaris({ base: 'http://127.0.0.1:8888/api/v1.0', token: testKey, orgId: '1', tables, mappingProof: proof, fetcher: stubRows });

test('Zetaris provider loads only the explicitly selected local proof and existing BASE_URL configuration', async t => {
  const file = await proofFile(t);
  const client = await createConfiguredZetaris({ env: configuredEnv(file), fetcher: stubRows });
  assert.equal(client.base, 'http://127.0.0.1:8888/api/v1.0');
  assert.deepEqual(client.tables, tables);
  assert.equal(client.mappingVerified, true);
  const result = await readZetaris(['labor', 'policy', 'sales'], { client });
  assert.equal(reconcile(result.records).metrics.gap_cents, 60000);
  assert.deepEqual(result.trace.map(item => item.family), ['labor', 'policy', 'sales']);
  assert.equal(result.source_mode, 'zetaris'); assert.equal(result.fixture_fault_injection, false);
  assert.equal(result.zetaris_verified, false);
  assert.ok(result.trace.every(item => item.transport === 'injected_test_transport' && !item.integration_verified));
  assert.equal(JSON.stringify(result).includes(testKey), false);
});

test('Zetaris status inspects configuration only and never converts a stub into runtime verification', async t => {
  const file = await proofFile(t);
  const status = await getZetarisStatus({ env: configuredEnv(file) });
  assert.equal(status.status, 'configured_unverified'); assert.equal(status.configured, true);
  assert.equal(status.verified, false); assert.equal(status.query_verified, false);
  assert.equal(status.mapping_evidence_id, proof.evidence_id);
  assert.equal(JSON.stringify(status).includes(testKey), false);
  assert.equal(JSON.stringify(status).includes(file), false);
  assert.equal((await getZetarisStatus({ client: stubClient() })).verified, false);
  const absent = await getZetarisStatus({ env: {} });
  assert.equal(absent.status, 'not_configured'); assert.equal(absent.verified, false);
});

test('Zetaris provider rejects unset, unreviewed and mismatched mapping proof without fixture fallback', async t => {
  await assert.rejects(createConfiguredZetaris({ env: { ZETARIS_API_KEY: testKey, ZETARIS_ORG_ID: '1' }, fetcher: stubRows }), error => error.code === 'ZETARIS_MAPPING_UNVERIFIED');
  const unreviewed = await proofFile(t, { ...proof, verified: false });
  await assert.rejects(createConfiguredZetaris({ env: configuredEnv(unreviewed), fetcher: stubRows }), error => error.code === 'ZETARIS_MAPPING_UNVERIFIED');
  const mismatched = await proofFile(t, { ...proof, columns: { ...ZETARIS_COLUMNS, sales: ['id'] } });
  await assert.rejects(createConfiguredZetaris({ env: configuredEnv(mismatched), fetcher: stubRows }), error => error.code === 'ZETARIS_MAPPING_UNVERIFIED');
  const file = await proofFile(t);
  await assert.rejects(createConfiguredZetaris({ env: { ...configuredEnv(file), ZETARIS_TABLE_SALES: 'other.sales' }, fetcher: stubRows }), error => error.code === 'ZETARIS_MAPPING_UNVERIFIED');
  const unverifiedClient = new Zetaris({ token: testKey, orgId: '1', tables, fetcher: stubRows });
  await assert.rejects(readZetaris(undefined, { client: unverifiedClient }), error => error.code === 'ZETARIS_MAPPING_UNVERIFIED');
});

test('Zetaris proof loading rejects URLs, network paths, invalid JSON and oversized files with safe errors', async t => {
  for (const file of ['https://example.com/mapping.json', 'file:///C:/mapping.json', '\\\\server\\share\\mapping.json', '//server/share/mapping.json', 'C:\\private\\mapping.json:stream', 'mapping.txt']) {
    await assert.rejects(createConfiguredZetaris({ env: configuredEnv(file), fetcher: stubRows }), error => error.code === 'ZETARIS_MAPPING_UNVERIFIED' && !error.message.includes(file));
  }
  for (const text of ['{"secret":"' + testKey, 'x'.repeat(65537)]) {
    const file = await proofFile(t, text, true);
    const status = await getZetarisStatus({ env: configuredEnv(file) });
    assert.equal(status.status, 'mapping_unverified');
    assert.equal(JSON.stringify(status).includes(testKey), false); assert.equal(JSON.stringify(status).includes(file), false);
  }
});

test('live source provider refuses scenario injection and invalid collection plans before requests', async () => {
  const client = stubClient();
  await assert.rejects(readZetaris(undefined, { client, scenario: 'missing-wages' }), error => error.code === 'ZETARIS_CONFIG');
  for (const order of [[], ['sales', 'labor', 'labor'], ['sales', 'labor', 'approval']])
    await assert.rejects(readZetaris(order, { client }), error => error.code === 'ZETARIS_QUERY_NOT_ALLOWED');
  await assert.rejects(readZetaris(undefined, { client: { readSources: async () => readFixture() } }), error => error.code === 'ZETARIS_CONFIG');
});

test('live source error propagates and cannot silently return the deterministic fixture', async () => {
  const client = new Zetaris({ token: testKey, orgId: '1', tables, mappingProof: proof,
    fetcher: async () => new Response('upstream stub unauthorized', { status: 401 }) });
  await assert.rejects(readZetaris(undefined, { client }), error => error.code === 'ZETARIS_UNAUTHORIZED' && error.receipt.integration_verified === false);
  assert.equal(sourceExport, readZetaris);
  assert.equal((await readFixture()).zetaris_verified, false);
  assert.throws(() => requireZetaris(), error => error.code === 'ZETARIS_NOT_VERIFIED');
});
