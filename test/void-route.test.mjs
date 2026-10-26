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
    const timer = setTimeout(() => reject(new Error('Void preview server did not start')), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Void preview server exited before readiness')); });
    child.stdout.on('data', data => { if (String(data).includes('CostProof local synthetic preview')) { clearTimeout(timer); resolve(); } });
  });
});
after(() => child?.kill());
const post = (body, origin = base) => fetch(base + '/api/void-proof', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

test('Void Hunter and receipt assets are served with the existing browser guards', async () => {
  for (const path of ['/void', '/void.js', '/void.css', '/evidence.js']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  }
});
test('Void HTTP receipt carries original source records and never labels preview as live integration', async () => {
  const response = await post({ scenario: 'complete', sourceMode: 'fixture' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'reconciled');
  assert.ok(result.employee_metrics.length > 0);
  assert.deepEqual(Object.keys(result.source_records).sort(), ['adjustments', 'coverage', 'employees', 'original_orders', 'workflow_events']);
  assert.equal(result.integration.zetaris, false);
  assert.equal(result.integration.nightshift_text, false);
  assert.ok(result.run_id && result.created_at_utc);
});
test('Void endpoint holds incomplete period and missing chain, and refuses the wrong restaurant', async () => {
  for (const scenario of ['incomplete-period', 'missing-kitchen-link']) {
    const response = await post({ scenario, sourceMode: 'fixture' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'needs_evidence');
    assert.ok(result.missing_evidence.length > 0);
  }
  const response = await post({ scenario: 'wrong-location', sourceMode: 'fixture' });
  assert.equal(response.status, 400);
});
test('Void endpoint rejects live modes, arbitrary source payloads and unknown fixture paths', async () => {
  for (const body of [
    { scenario: 'complete', sourceMode: 'zetaris' },
    { scenario: 'complete', sourceMode: 'fixture', records: {} },
    { scenario: '../../.env', sourceMode: 'fixture' }
  ]) assert.equal((await post(body)).status, 400);
});
test('Void endpoint refuses foreign origins and non-JSON calls', async () => {
  assert.equal((await post({ scenario: 'complete', sourceMode: 'fixture' }, 'http://example.com')).status, 403);
  const response = await fetch(base + '/api/void-proof', { method: 'POST', headers: { Origin: base, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(response.status, 403);
});
