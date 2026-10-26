import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

let child, base;
before(async () => {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  base = 'http://127.0.0.1:' + port;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  for (const key of Object.keys(env)) if (/^(METERLESS|ZETARIS|NIGHTSHIFT)_/.test(key)) delete env[key];
  child = spawn(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('../src/server.mjs', import.meta.url))], { cwd: tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Recipe contract server did not start')), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Recipe contract server exited before readiness')); });
    child.stdout.on('data', data => { if (String(data).includes('CostProof local synthetic preview')) { clearTimeout(timer); resolve(); } });
  });
});
after(() => child?.kill());
const post = (body, origin = base) => fetch(base + '/api/recipe-cost', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

test('recipe UI and static assets are served through the existing guarded server', async () => {
  for (const path of ['/recipe', '/recipe.js', '/recipe.css']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  }
  const labor = await fetch(base + '/');
  assert.match(await labor.text(), /SKU &amp; recipe cost/);
});
test('recipe HTTP path returns the actual 44-cent fixture calculation with source records', async () => {
  const response = await post({ scenario: 'complete', sourceMode: 'fixture' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'reconciled');
  assert.equal(result.metrics.baseline_portion_cost_cents, 196);
  assert.equal(result.metrics.current_portion_cost_cents, 240);
  assert.equal(result.metrics.portion_cost_delta_cents, 44);
  assert.deepEqual(Object.keys(result.source_records).sort(), ['ingredient_map', 'menu', 'prices', 'recipe']);
  assert.equal(result.integration.zetaris, false);
  assert.equal(result.integration.nightshift_text, false);
});
test('recipe endpoint holds missing yield and refuses restaurant mismatch', async () => {
  const missing = await post({ scenario: 'missing-yield', sourceMode: 'fixture' });
  const held = await missing.json();
  assert.equal(missing.status, 200);
  assert.equal(held.status, 'needs_evidence');
  assert.equal(held.metrics, null);
  const wrong = await post({ scenario: 'wrong-location', sourceMode: 'fixture' });
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, 'RECIPE_SCOPE_MISMATCH');
});
test('recipe endpoint refuses live modes, arbitrary records and traversal-like scenario names', async () => {
  for (const body of [
    { scenario: 'complete', sourceMode: 'zetaris' },
    { scenario: 'complete', sourceMode: 'fixture', records: {} },
    { scenario: '../../.env', sourceMode: 'fixture' }
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    assert.equal('metrics' in await response.json(), false);
  }
});
test('recipe endpoint preserves same-origin and JSON-only request guards', async () => {
  const foreign = await post({ scenario: 'complete', sourceMode: 'fixture' }, 'http://example.com');
  assert.equal(foreign.status, 403);
  const nonJson = await fetch(base + '/api/recipe-cost', { method: 'POST', headers: { Origin: base, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(nonJson.status, 403);
});
