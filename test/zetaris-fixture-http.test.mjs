import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadSyntheticPayloads, parseOptions, startFixtureServer } from '../docs/zetaris-fixture-http/server.mjs';
import { registrationPlan, formatRegistrationPlan } from '../docs/zetaris-fixture-http/registration-plan.mjs';
import { ZETARIS_COLUMNS } from '../src/zetaris.mjs';

// Real HTTP here is only an ephemeral loopback source helper. No Docker or
// Zetaris request occurs, and SQL plans are strings which are never executed.
test('isolated synthetic HTTP endpoints preserve canonical payload bytes and hashes', async t => {
  const logs = [];
  const running = await startFixtureServer({ port: 0, log: item => logs.push(item) });
  t.after(() => new Promise(resolve => { running.server.close(resolve); running.server.closeAllConnections(); }));
  assert.equal(running.host, '127.0.0.1');
  const payloads = await loadSyntheticPayloads();
  for (const [path, item] of payloads) {
    const response = await fetch(running.url + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, item.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    assert.equal(response.headers.get('etag'), '"' + item.sha256 + '"');
    const envelope = JSON.parse(bytes.toString());
    assert.equal(envelope.not_a_customer_result, true);
    assert.equal(envelope.source_family, item.family);
  }
  const manifest = await (await fetch(running.url + '/manifest.json')).json();
  assert.equal(manifest.zetaris_registration_verified, false);
  assert.equal(manifest.endpoints.length, 3);
  assert.equal(logs.length, 3);
  assert.equal(JSON.stringify(logs).includes('Authorization'), false);
});

test('synthetic helper cannot browse files, select other scenarios or accept writes', async t => {
  const running = await startFixtureServer({ port: 0 });
  t.after(() => new Promise(resolve => { running.server.close(resolve); running.server.closeAllConnections(); }));
  for (const path of ['/.env', '/../../.env', '/%2e%2e/%2e%2e/.env', '/labor.json?scenario=missing-wages', '/sales.json/extra', '/%73ales.json', '/']) {
    const response = await fetch(running.url + path);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'Unknown source endpoint');
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await fetch(running.url + '/labor.json', { method, body: method === 'DELETE' ? undefined : 'mutate' });
    assert.equal(response.status, 405);
  }
  const head = await fetch(running.url + '/sales.json', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const health = await (await fetch(running.url + '/healthz')).json();
  assert.equal(health.zetaris_registration_verified, false);
});

test('source listener defaults to loopback and accepts only explicit bounded options', () => {
  assert.deepEqual(parseOptions([]), { host: '127.0.0.1', port: 4318 });
  assert.deepEqual(parseOptions(['--host', '0.0.0.0', '--port', '4318']), { host: '0.0.0.0', port: 4318 });
  for (const args of [['--host', 'remote.example'], ['--port', '99999'], ['--port', '-1'], ['--root', 'C:/'], ['--host']])
    assert.throws(() => parseOptions(args));
});

test('registration plan contains only documented synthetic source statements and explicit projections', () => {
  const plan = registrationPlan('http://host.docker.internal:4318');
  assert.equal(plan.state, 'UNEXECUTED_PLAN');
  assert.equal(plan.statements.length, 10);
  assert.equal(plan.verification.length, 9);
  assert.equal(plan.statements.filter(sql => sql.startsWith('CREATE LIGHTNING REST TABLE')).length, 3);
  assert.equal(plan.statements.filter(sql => sql.startsWith('CREATE SCHEMASTORE VIEW')).length, 3);
  for (const family of ['sales', 'labor', 'policy']) {
    assert.ok(plan.statements.some(sql => sql.includes('endpoint "http://host.docker.internal:4318/' + family + '.json"')));
    const view = plan.statements.find(sql => sql.startsWith('CREATE SCHEMASTORE VIEW ' + family + ' '));
    for (const column of ZETARIS_COLUMNS[family]) assert.ok(view.includes('evidence_row.' + column + ' AS ' + column));
    assert.ok(view.endsWith('LATERAL VIEW explode(records) AS evidence_row'));
  }
  const output = formatRegistrationPlan(plan);
  assert.match(output, /UNEXECUTED PLAN/); assert.match(output, /one statement per call/);
  assert.equal(/\b(?:DROP|GRANT|DELETE|INSERT|UPDATE|OR REPLACE)\b/.test(output), false);
  for (const source of ['file:///C:/', 'http://u:secret@localhost:4318', 'http://host.docker.internal:4318/?secret=x', 'http://host.docker.internal:4318/path'])
    assert.throws(() => registrationPlan(source));
});
