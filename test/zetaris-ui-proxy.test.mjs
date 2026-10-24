import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Zetaris, ZETARIS_COLUMNS, normalizeZetarisUiBase } from '../src/zetaris.mjs';
import { SCOPE, reconcile } from '../src/reconcile.mjs';

// Injected responses only. These tests are not live login, source-registration
// or integration receipts. They model the parent's actual UI-proxy readback.
const tables = { sales: 'costproof.sales', labor: 'costproof.labor', policy: 'costproof.policy' };
const proof = { verified: true, evidence_id: 'test-only-ui-mapping', tables, columns: ZETARIS_COLUMNS };
const secret = { username: 'test-only-user', password: 'test-only-password', idToken: 'testHeader.testPayload.testSignature', refreshToken: 'test-only-refresh' };
const login = (extra = {}) => new Response(JSON.stringify({ idToken: secret.idToken, refreshToken: secret.refreshToken, orgId: 27, ...extra }));
const page = (records, extra = {}) => new Response(JSON.stringify({ records, pageNumber: 1, pageLimit: 5, totalCount: records.length, totalPages: 1, queryToken: 'test-only-query-token', ...extra }));
const client = (fetcher, extra = {}) => new Zetaris({ apiTransport: 'ui_proxy', base: 'http://127.0.0.1:3000', username: secret.username, password: secret.password, orgId: null, tables, mappingProof: proof, fetcher, ...extra });
async function recordFor(family, file = family) {
  return JSON.parse(await readFile(new URL('../seed/sources/' + file + '.json', import.meta.url), 'utf8')).records[0];
}
function noSecrets(value) {
  const json = JSON.stringify(value);
  for (const value of [...Object.values(secret), 'test-only-query-token']) assert.equal(json.includes(value), false);
}

test('UI proxy derives the organization from ordinary login and preserves checked source reads', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body });
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/api/auth/login')) {
      assert.deepEqual(body, { username: secret.username, password: secret.password });
      assert.equal(options.headers.Authorization, undefined);
      return login();
    }
    assert.equal(url, 'http://127.0.0.1:3000/api/proxy/query/sql/start');
    assert.deepEqual(Object.keys(body), ['select', 'pageLimit']);
    assert.equal(body.pageLimit, 5); assert.match(body.select, /LIMIT 2$/);
    assert.match(body.select, /restaurant_id = 'demo-101'/);
    assert.equal(options.headers['X-Org-ID'], '27');
    assert.equal(options.headers.Authorization, 'Bearer ' + secret.idToken);
    const family = Object.keys(tables).find(key => body.select.includes(' FROM ' + tables[key] + ' WHERE '));
    const record = await recordFor(family);
    // Deliberately reverse the wire property order; only the explicit column
    // projection may determine the positional mapping and money semantics.
    return page([Object.fromEntries(ZETARIS_COLUMNS[family].toReversed().map(key => [key, typeof record[key] === 'number' ? String(record[key]) : record[key]]))]);
  });
  const out = await api.readSources(SCOPE, ['labor', 'policy', 'sales']);
  assert.equal(calls.filter(row => row.url.endsWith('/api/auth/login')).length, 1);
  assert.equal(reconcile(out.records).metrics.gap_cents, 60000);
  assert.equal(out.provider, 'Zetaris UI proxy');
  assert.deepEqual(out.trace.map(row => row.family), ['labor', 'policy', 'sales']);
  assert.ok(out.trace.every(row => row.org_id === '27' && row.api_transport === 'ui_proxy' && row.mapping_verified && !row.integration_verified));
  assert.equal(out.trace[0].auth.reused, false); assert.equal(out.trace[1].auth.reused, true);
  assert.equal(out.zetaris_verified, false, 'Injected transport cannot establish live federation');
  assert.equal(new Set(calls.map(row => row.options.headers['X-Request-ID'])).size, 4);
  noSecrets(out); noSecrets(api);
});

test('UI login refuses redirects, rejected credentials, incomplete sessions and organization mismatches', async () => {
  for (const [response, expectedCode, extra] of [
    [new Response('secret server diagnostic', { status: 302, headers: { Location: 'https://remote.example' } }), 'ZETARIS_UNAUTHORIZED'],
    [new Response(secret.password, { status: 401 }), 'ZETARIS_UNAUTHORIZED'],
    [new Response(secret.password, { status: 503 }), 'ZETARIS_OFFLINE'],
    [new Response('not-json ' + secret.password), 'ZETARIS_SCHEMA'],
    [login({ idToken: undefined }), 'ZETARIS_SCHEMA'],
    [login({ orgId: undefined }), 'ZETARIS_SCHEMA'],
    [login({ orgId: 'other-company' }), 'ZETARIS_SCHEMA'],
    [login(), 'ZETARIS_SCHEMA', { orgId: '28' }]
  ]) {
    let requests = 0;
    const api = client(async (url, options) => {
      requests++; assert.ok(url.endsWith('/api/auth/login')); assert.equal(options.redirect, 'error'); return response;
    }, extra);
    await assert.rejects(api.execute({ kind: 'probe' }), error => {
      noSecrets(error); assert.equal(error.receipt.integration_verified, false); return error.code === expectedCode;
    });
    assert.equal(requests, 1, 'A rejected login cannot reach SQL or a fallback transport');
  }
});

test('UI evidence refuses incomplete pagination, projection drift and duplicate scoped rows', async () => {
  const record = await recordFor('sales');
  for (const response of [
    page([record], { pageNumber: 2 }), page([record], { totalPages: 2 }), page([record], { totalPages: undefined }),
    page([record], { totalCount: 2 }), page([record], { pageLimit: 2 }),
    page([{ ...record, extra: 'unexpected projection' }]),
    page([Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'id'))]),
    page([record, record]), new Response(JSON.stringify({ data: [ZETARIS_COLUMNS.sales.map(key => record[key])] }))
  ]) {
    const api = client(async url => url.endsWith('/api/auth/login') ? login() : response);
    await assert.rejects(api.readFamily('sales', SCOPE), error => error.code === 'ZETARIS_SCHEMA' && !error.receipt.integration_verified);
  }
});

test('UI object conversion retains the scope, exact-cent and missing-wage guards', async () => {
  const sales = await recordFor('sales');
  for (const [record, code] of [[{ ...sales, restaurant_id: 'wrong-store' }, 'ZETARIS_SCOPE_MISMATCH'],
    [{ ...sales, actual_net_sales_cents: '1200000.01' }, 'ZETARIS_SCHEMA']]) {
    const api = client(async url => url.endsWith('/api/auth/login') ? login() : page([record]));
    await assert.rejects(api.readFamily('sales', SCOPE), error => error.code === code);
  }
  const api = client(async (url, options) => {
    if (url.endsWith('/api/auth/login')) return login();
    const sql = JSON.parse(options.body).select;
    const family = Object.keys(tables).find(key => sql.includes(' FROM ' + tables[key] + ' WHERE '));
    const record = await recordFor(family, family === 'labor' ? 'labor_missing_wages' : family);
    return page([Object.fromEntries(ZETARIS_COLUMNS[family].map(key => [key, record[key] ?? null]))]);
  });
  const out = await api.readSources(SCOPE);
  assert.equal(out.records.labor.actual_labor_cents, null);
  assert.equal(reconcile(out.records).status, 'needs_evidence');
});

test('UI mode refuses unknown operations, unreviewed mappings and remote destinations before login', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; throw new Error('must not request'); };
  const api = client(fetcher);
  for (const action of [{ kind: 'probe', sql: 'DELETE' }, { kind: 'list_databases' }, { kind: 'describe', family: 'sales' }, { kind: 'write' }])
    await assert.rejects(api.execute(action), error => error.code === 'ZETARIS_QUERY_NOT_ALLOWED');
  await assert.rejects(client(fetcher, { mappingProof: null }).readSources(SCOPE), error => error.code === 'ZETARIS_MAPPING_UNVERIFIED');
  for (const base of ['https://remote.example', 'http://u:secret@localhost:3000', 'http://localhost:3000/api', 'http://localhost:3000?token=secret'])
    assert.throws(() => normalizeZetarisUiBase(base), error => error.code === 'ZETARIS_CONFIG');
  assert.equal(requests, 0);
});

test('a refused UI query never retries login or falls back to direct REST', async () => {
  let logins = 0, queries = 0;
  const api = client(async url => {
    if (url.endsWith('/api/auth/login')) { logins++; return login(); }
    assert.ok(url.endsWith('/api/proxy/query/sql/start')); queries++;
    return new Response(secret.idToken, { status: 403 });
  });
  await assert.rejects(api.execute({ kind: 'probe' }), error => { noSecrets(error); return error.code === 'ZETARIS_UNAUTHORIZED'; });
  assert.equal(logins, 1); assert.equal(queries, 1);
});
