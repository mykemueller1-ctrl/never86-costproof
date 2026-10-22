import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { investigate } from '../src/investigate.mjs';
import { Zetaris, ZETARIS_COLUMNS } from '../src/zetaris.mjs';

// Application wiring checks use an explicit test transport, never a runtime.
const tables = { sales: 'costproof.sales', labor: 'costproof.labor', policy: 'costproof.policy' };
const proof = { verified: true, evidence_id: 'test-only-app-wiring', tables, columns: ZETARIS_COLUMNS };
test('the application uses the selected Zetaris adapter and preserves unverified test receipts', async () => {
  const requests = [];
  const client = new Zetaris({ token: 'test-only', orgId: '1', tables, mappingProof: proof, fetcher: async (_url, options) => {
    const sql = JSON.parse(options.body).sql;
    const family = Object.keys(tables).find(key => sql.includes(' FROM ' + tables[key] + ' WHERE '));
    assert.ok(family); requests.push(family);
    const row = JSON.parse(await readFile(new URL('../seed/sources/' + family + '.json', import.meta.url))).records[0];
    return new Response(JSON.stringify({ data: [ZETARIS_COLUMNS[family].map(key => row[key] ?? null)] }));
  } });
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-source-app-'));
  const result = await investigate({ sourceMode: 'zetaris' }, { sourceClient: client, memoryRoot });
  assert.deepEqual(requests, ['sales', 'labor', 'policy']);
  assert.equal(result.source_provider, 'Zetaris REST');
  assert.equal(result.metrics.gap_cents, 60000);
  assert.equal(result.integration.zetaris, false, 'Injected transport must never establish live sponsor proof');
  assert.ok(result.trace.filter(row => row.role === 'source').every(row => row.transport === 'injected_test_transport'));
  assert.equal(result.trace.some(row => row.tool === 'local_fixture_read'), false);
});
test('registered source mode never substitutes a fixture or applies a fixture fault scenario', async () => {
  const client = new Zetaris({ token: 'test-only', orgId: '1', tables, fetcher: () => { throw new Error('Must not query'); } });
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'costproof-source-refusal-'));
  await assert.rejects(investigate({ sourceMode: 'zetaris' }, { sourceClient: client, memoryRoot }), error => error.code === 'ZETARIS_MAPPING_UNVERIFIED');
  await assert.rejects(investigate({ sourceMode: 'zetaris', scenario: 'missing-wages' }, { sourceClient: client, memoryRoot }), /Fixture fault scenarios/);
});
