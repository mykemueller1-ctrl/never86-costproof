import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Zetaris, ZETARIS_COLUMNS, normalizeZetarisBase, buildScopedQuery, mapZetarisEvidence } from '../src/zetaris.mjs';
import { SCOPE, reconcile } from '../src/reconcile.mjs';

// All HTTP responses in this file are injected stubs. Passing these tests is
// not evidence that Zetaris is running, registered, authenticated or integrated.
const tables = { sales: 'costproof.sales', labor: 'costproof.labor', policy: 'costproof.policy' };
const proof = { verified: true, evidence_id: 'test-stub-mapping-only', tables, columns: ZETARIS_COLUMNS };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function rowFor(family, filename = family) {
  const fixture = JSON.parse(await readFile(new URL('../seed/sources/' + filename + '.json', import.meta.url), 'utf8')).records[0];
  return ZETARIS_COLUMNS[family].map(column => fixture[column] ?? null);
}
const client = (fetcher, extra = {}) => new Zetaris({ token: 'test-stub-secret', orgId: '1', tables, fetcher, ...extra });

test('Zetaris stub request contract uses fresh IDs, strict reads and redacted receipts', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ data: [[1]] }));
  });
  const first = await api.execute({ kind: 'probe' });
  const second = await api.execute({ kind: 'list_databases' });
  assert.equal(calls[0].url, 'http://localhost:8888/api/v1.0/sql-editor/sqls/run');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-stub-secret');
  assert.equal(calls[0].options.headers['X-Org-ID'], '1');
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['limit', 'queryId', 'source', 'sql']);
  assert.equal(calls[0].body.source, 'SqlEditor');
  assert.equal(calls[0].body.sql, 'SELECT 1');
  assert.match(first.receipt.request_id, uuidPattern); assert.match(first.receipt.query_id, uuidPattern);
  assert.notEqual(first.receipt.request_id, first.receipt.query_id);
  assert.notEqual(first.receipt.request_id, second.receipt.request_id);
  assert.notEqual(first.receipt.query_id, second.receipt.query_id);
  assert.equal(first.receipt.transport_verified, false);
  assert.equal(first.receipt.integration_verified, false);
  assert.equal(first.receipt.transport, 'injected_test_transport');
  assert.equal(JSON.stringify(first).includes('test-stub-secret'), false);
  assert.equal(JSON.stringify(api).includes('test-stub-secret'), false);
});

test('Zetaris rejects arbitrary SQL, injection and remote credential destinations before transport', async () => {
  let calls = 0;
  const api = client(async () => { calls++; throw new Error('must not call'); });
  for (const action of ['DROP TABLE costproof.sales', { kind: 'probe', sql: 'DELETE' }, { kind: 'write' }, { kind: 'evidence', family: 'unknown', scope: SCOPE }])
    await assert.rejects(api.execute(action), error => error.code === 'ZETARIS_QUERY_NOT_ALLOWED');
  await assert.rejects(api.execute({ kind: 'evidence', family: 'sales', scope: { ...SCOPE, restaurant_id: "x' OR 1=1 --" } }), error => error.code === 'ZETARIS_SCOPE');
  assert.throws(() => buildScopedQuery('sales', SCOPE, { sales: 'costproof.sales;DROP TABLE x' }), error => error.code === 'ZETARIS_CONFIG');
  for (const base of ['https://remote.example/api/v1.0', 'http://u:secret@localhost:8888/api/v1.0', 'http://localhost:8889/api/v1.0?key=secret', 'http://localhost:8888/redoc/index.html'])
    assert.throws(() => normalizeZetarisBase(base), error => error.code === 'ZETARIS_CONFIG');
  assert.equal(calls, 0);
});

test('Zetaris source mapping is explicit, exact and still unverified under stub transport', async () => {
  const api = client(async (_url, options) => {
    const { sql, limit } = JSON.parse(options.body);
    assert.equal(limit, 2); assert.match(sql, /business_date = '2026-10-23'/); assert.match(sql, /LIMIT 2$/);
    const family = Object.keys(tables).find(key => sql.includes(' FROM ' + tables[key] + ' WHERE '));
    return new Response(JSON.stringify({ data: [(await rowFor(family)).map(value => typeof value === 'number' ? String(value) : value)] }));
  }, { mappingProof: proof });
  const out = await api.readSources(SCOPE, ['labor', 'sales', 'policy']);
  assert.equal(reconcile(out.records).metrics.gap_cents, 60000);
  assert.deepEqual(out.trace.map(receipt => receipt.family), ['labor', 'sales', 'policy']);
  assert.equal(out.trace[0].mapping_verified, true);
  assert.equal(out.trace[0].mapping_evidence_id, 'test-stub-mapping-only');
  assert.equal(out.trace[0].integration_verified, false);
  assert.equal(out.zetaris_verified, false);
  assert.equal(new Set(out.trace.map(receipt => receipt.query_id)).size, 3);
});

test('Zetaris candidate mapping cannot enable the application without a matching verification proof', async () => {
  const api = client(async () => new Response(JSON.stringify({ data: [await rowFor('sales')] })));
  const candidate = await api.readFamily('sales', SCOPE);
  assert.equal(candidate.receipt.status, 'mapping_unverified');
  assert.equal(candidate.receipt.integration_verified, false);
  await assert.rejects(api.readSources(SCOPE), error => error.code === 'ZETARIS_MAPPING_UNVERIFIED');
  const badProof = client(async () => { throw new Error('must not call'); }, { mappingProof: { ...proof, tables: { ...tables, sales: 'other.sales' } } });
  assert.equal(badProof.mappingVerified, false);
});

test('Zetaris positional rows reject missing/duplicate/misaligned and mismatched evidence', async () => {
  const row = await rowFor('sales');
  for (const rows of [[{ id: 'object rows are undocumented' }], [[...row, 'extra']], [row, row]])
    assert.throws(() => mapZetarisEvidence('sales', rows, SCOPE), error => error.code === 'ZETARIS_SCHEMA');
  assert.throws(() => mapZetarisEvidence('sales', [], SCOPE), error => error.code === 'ZETARIS_MISSING_EVIDENCE');
  const mismatched = [...row]; mismatched[ZETARIS_COLUMNS.sales.indexOf('restaurant_id')] = 'other-store';
  assert.throws(() => mapZetarisEvidence('sales', [mismatched], SCOPE), error => error.code === 'ZETARIS_SCOPE_MISMATCH');
  const real = [...row]; real[ZETARIS_COLUMNS.sales.indexOf('classification')] = 'CUSTOMER_DATA';
  assert.throws(() => mapZetarisEvidence('sales', [real], SCOPE), error => error.code === 'ZETARIS_SCHEMA');
});

test('Zetaris REST string/exponent money conversion is exact and missing wages stay missing', async () => {
  const row = await rowFor('sales'), index = ZETARIS_COLUMNS.sales.indexOf('actual_net_sales_cents');
  const exponent = [...row]; exponent[index] = '1.2e6';
  assert.equal(mapZetarisEvidence('sales', [exponent], SCOPE).actual_net_sales_cents, 1200000);
  for (const value of ['1200000.01', '9007199254740991.1', '9007199254740992', '-1', 'NaN', '1e99']) {
    const bad = [...row]; bad[index] = value;
    assert.throws(() => mapZetarisEvidence('sales', [bad], SCOPE), error => error.code === 'ZETARIS_SCHEMA');
  }
  const sales = mapZetarisEvidence('sales', [row], SCOPE);
  const labor = mapZetarisEvidence('labor', [await rowFor('labor', 'labor_missing_wages')], SCOPE);
  const policy = mapZetarisEvidence('policy', [await rowFor('policy')], SCOPE);
  assert.equal(labor.actual_labor_cents, null);
  assert.equal(reconcile({ sales, labor, policy }).status, 'needs_evidence');
});

test('Zetaris stub failures distinguish authorization, offline, timeout and schema without server text', async () => {
  for (const status of [401, 403, 500, 429, 400]) {
    const api = client(async () => new Response('test-stub-secret malicious diagnostic', { status }));
    await assert.rejects(api.execute({ kind: 'probe' }), error => {
      assert.equal(JSON.stringify(error).includes('test-stub-secret'), false);
      assert.equal(error.receipt.http_status, status);
      return error.code === ([401, 403].includes(status) ? 'ZETARIS_UNAUTHORIZED' : status === 400 ? 'ZETARIS_REQUEST_REJECTED' : 'ZETARIS_OFFLINE');
    });
  }
  await assert.rejects(client(async () => { throw new Error('test-stub-secret'); }).execute({ kind: 'probe' }), error => error.code === 'ZETARIS_OFFLINE' && !JSON.stringify(error).includes('test-stub-secret'));
  await assert.rejects(client(async () => { throw new DOMException('stub timeout', 'TimeoutError'); }).execute({ kind: 'probe' }), error => error.code === 'ZETARIS_TIMEOUT');
  for (const document of [{ rows: [[1]] }, { data: [{ value: 1 }] }, { data: [[1]], error: 'upstream failure' }])
    await assert.rejects(client(async () => new Response(JSON.stringify(document))).execute({ kind: 'probe' }), error => error.code === 'ZETARIS_SCHEMA');
  await assert.rejects(client(async () => new Response('not json')).execute({ kind: 'probe' }), error => error.code === 'ZETARIS_SCHEMA');
  assert.throws(() => new Zetaris({ token: '', orgId: '1', tables, fetcher: async () => {} }), error => error.code === 'ZETARIS_CONFIG');
});
