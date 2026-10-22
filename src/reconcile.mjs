export const SCOPE = Object.freeze({
    restaurant_id: 'demo-101', shift_id: 'demo-101-2026-10-23-dinner',
    business_date: '2026-10-23', currency: 'USD'
  });
  export class EvidenceError extends Error {
    code; details;
    constructor(code, message, details = []) { super(message); this.code = code; this.details = details; }
  }
  const fields = ['restaurant_id', 'shift_id', 'business_date', 'currency'];
  function cents(value, field) {
    if (!Number.isSafeInteger(value) || value < 0) throw new EvidenceError('INVALID_MONEY', 'Invalid ' + field);
    return value;
  }
  function target(sales, bps) {
    const result = (BigInt(sales) * BigInt(bps) + 5000n) / 10000n;
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new EvidenceError('INVALID_MONEY', 'Target exceeds safe integer range');
    return Number(result);
  }
  export function validateRecord(record, scope, family) {
    if (!record || typeof record.id !== 'string' || !record.id) throw new EvidenceError('MISSING_SOURCE', 'Missing ' + family + ' source row');
    const mismatches = fields.filter(key => record[key] !== scope[key]);
    if (mismatches.length) throw new EvidenceError('SCOPE_MISMATCH', 'Do not join records from different shifts, restaurants, dates or currencies', mismatches);
    if (record.classification !== 'SYNTHETIC_COMPETITION_FIXTURE') throw new EvidenceError('SOURCE_CLASSIFICATION', 'This competition application accepts labeled synthetic records only');
    return record;
  }
  export function reconcile(records, scope = SCOPE) {
    const sales = validateRecord(records.sales, scope, 'sales');
    const labor = validateRecord(records.labor, scope, 'labor');
    const policy = validateRecord(records.policy, scope, 'policy');
    const evidence = [sales, labor, policy].map(row => ({ id: row.id, classification: row.classification, ...Object.fromEntries(fields.map(key => [key, row[key]])) }));
    const missing = ['planned_labor_cents', 'actual_labor_cents'].filter(key => labor[key] === null || labor[key] === undefined);
    if (missing.length) return {
      status: 'needs_evidence', scope, evidence, missing,
      headline: 'Wage records are missing. Dollar conclusions are stopped.',
      request: 'Provide wage/payroll dollars for this same restaurant and shift.',
      metrics: null, bridge: null, limitations: ['Hours alone do not establish payroll dollars or savings.']
    };
    const plannedSales = cents(sales.planned_net_sales_cents, 'planned sales');
    const actualSales = cents(sales.actual_net_sales_cents, 'actual sales');
    const plannedLabor = cents(labor.planned_labor_cents, 'planned labor');
    const actualLabor = cents(labor.actual_labor_cents, 'actual labor');
    const bps = policy.labor_target_basis_points;
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new EvidenceError('INVALID_TARGET', 'Labor target must be between 0 and 100 percent');
    const plannedTarget = target(plannedSales, bps);
    const actualTarget = target(actualSales, bps);
    const baseline = plannedLabor - plannedTarget;
    const salesEffect = plannedTarget - actualTarget;
    const laborEffect = actualLabor - plannedLabor;
    const gap = actualLabor - actualTarget;
    if (baseline + salesEffect + laborEffect !== gap) throw new EvidenceError('BRIDGE_ERROR', 'Dollar bridge did not reconcile');
    const ratio = actualSales === 0 ? null : actualLabor / actualSales * 100;
    return {
      status: 'reconciled', scope, evidence,
      headline: 'The labor gap is reconciled. Its cause still needs evidence.',
      metrics: { actual_sales_cents: actualSales, actual_labor_cents: actualLabor, target_labor_cents: actualTarget, target_percent: bps / 100, actual_labor_percent: ratio, variance_percentage_points: ratio === null ? null : ratio - bps / 100, gap_cents: gap },
      bridge: [
        { label: 'Planned labor variance', cents: baseline, source_ids: [sales.id, labor.id, policy.id] },
      { label: 'Sales plan change: target denominator effect', cents: salesEffect, source_ids: [sales.id, policy.id] },
      { label: 'Change in labor dollars from plan', cents: laborEffect, source_ids: [labor.id] }
      ],
      limitations: [
        'Synthetic competition scenario. These are not customer results.',
        'The bridge is accounting reconciliation, not causal attribution or recovered savings.',
        'Straight time wage scope excludes taxes, benefits, tips and overtime.',
        ...(actualSales === 0 ? ['Labor percentage is unavailable because net sales are zero.'] : [])
      ]
    };
  }
  
