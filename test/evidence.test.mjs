import test from 'node:test';
import assert from 'node:assert/strict';
import { readFixture } from '../src/sources.mjs';
import { reconcile, SCOPE } from '../src/reconcile.mjs';
test('independent shift totals produce the exact $600 bridge', async () => {
  const { records } = await readFixture();
  const r = reconcile(records);
  assert.equal(r.metrics.gap_cents, 60000);
  assert.equal(r.metrics.actual_labor_percent, 33);
  assert.equal(r.metrics.variance_percentage_points, 5);
  assert.deepEqual(r.bridge.map(x => x.cents), [0, 42000, 18000]);
  assert.equal(records.labor.actual_hours * records.labor.hourly_rate_cents, r.metrics.actual_labor_cents);
});
test('hours without wages stop every dollar conclusion', async () => {
  const { records } = await readFixture('missing-wages');
  const r = reconcile(records);
  assert.equal(r.status, 'needs_evidence'); assert.equal(r.metrics, null); assert.equal(r.bridge, null);
  assert.match(r.request, /same restaurant and shift/);
});
test('a mismatch in any join key refuses the calculation', async () => {
  for (const key of ['restaurant_id', 'shift_id', 'business_date', 'currency']) {
    const { records } = await readFixture(); records.labor[key] = 'wrong';
    assert.throws(() => reconcile(records), e => e.code === 'SCOPE_MISMATCH' && e.details.includes(key));
  }
});
test('zero sales never becomes Infinity or a false zero labor percentage', async () => {
  const { records } = await readFixture('zero-sales');
  const r = reconcile(records); assert.equal(r.metrics.actual_labor_percent, null);
  assert.equal(r.metrics.variance_percentage_points, null); assert.equal(r.metrics.gap_cents, 396000);
  assert.equal(r.bridge.reduce((sum, row) => sum + row.cents, 0), 396000);
});
test('a preexisting plan variance remains in the bridge and rounding is in cents', async () => {
  const { records } = await readFixture(); records.labor.planned_labor_cents = 380001;
  records.sales.actual_net_sales_cents = 1200001;
  const r = reconcile(records); assert.equal(r.bridge[0].cents, 2001);
  assert.equal(r.metrics.target_labor_cents, 336000);
  assert.equal(r.bridge.reduce((sum, row) => sum + row.cents, 0), r.metrics.gap_cents);
  records.labor.actual_labor_cents = NaN; assert.throws(() => reconcile(records), /Invalid/);
});
