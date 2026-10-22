import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export { readZetaris, getZetarisStatus } from './zetaris-source.mjs';
export async function readFixture(scenario = 'complete', order = ['sales', 'labor', 'policy']) {
  if (!['complete', 'missing-wages', 'wrong-location', 'zero-sales'].includes(scenario)) throw new Error('Unknown scenario');
  const records = {};
  const trace = [];
  if (order.length !== 3 || new Set(order).size !== 3 || order.some(f => !['sales', 'labor', 'policy'].includes(f))) throw new Error('Invalid read only source plan');
  for (const family of order) {
    const filename = family === 'labor' && scenario === 'missing-wages' ? 'labor_missing_wages' : family;
    const file = new URL('../seed/sources/' + filename + '.json', import.meta.url);
    const document = JSON.parse(await readFile(file, 'utf8'));
    if (document.records?.length !== 1) throw new Error('Expected one scoped source row');
    records[family] = document.records[0];
    trace.push({ role: 'source', tool: 'local_fixture_read', source_id: records[family].id, file: 'seed/sources/' + filename + '.json', integration_verified: false });
  }
  if (scenario === 'wrong-location') records.labor.restaurant_id = 'demo-other-location';
  if (scenario === 'zero-sales') records.sales.actual_net_sales_cents = 0;
  return { records, trace, provider: 'local synthetic files', zetaris_verified: false };
}
// No guessed Zetaris POST schema or fixture fallback is treated as federation.
export function requireZetaris() {
  const error = new Error('Zetaris is not ready. Complete WSL/Docker startup, validate the running REST schema and register the separate sources before enabling this mode.');
  error.code = 'ZETARIS_NOT_VERIFIED';
  throw error;
}
