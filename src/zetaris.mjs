import { randomUUID } from 'node:crypto';
import { validateRecord } from './reconcile.mjs';

// Request contract: official zetaris/getting-started scripts/zetaris_sql.py,
// RestChannel.run(), checked 2026-10-22. It documents data as positional rows,
// not a stable response column-metadata schema. Explicit projection order is
// therefore a candidate mapping until a real DESCRIBE/query/source comparison
// is recorded. This module never creates objects, keys, or credentials.
export const ZETARIS_REQUEST_REFERENCE = 'https://github.com/zetaris/getting-started/blob/main/scripts/zetaris_sql.py';
export const ZETARIS_UI_REFERENCE = 'research/zetaris-live-probe-2026-10-23/2026-10-23T20-52-52-395Z-f536009e/receipt.private.json';
const COMMON = ['id', 'classification', 'currency', 'restaurant_id', 'shift_id', 'business_date'];
export const ZETARIS_COLUMNS = Object.freeze({
  sales: Object.freeze([...COMMON, 'planned_net_sales_cents', 'actual_net_sales_cents']),
  labor: Object.freeze([...COMMON, 'planned_hours', 'actual_hours', 'hourly_rate_cents', 'planned_labor_cents', 'actual_labor_cents', 'wage_scope']),
  policy: Object.freeze([...COMMON, 'labor_target_basis_points', 'target_scope'])
});
const FAMILIES = Object.freeze(Object.keys(ZETARIS_COLUMNS));
const SCOPE_FIELDS = ['restaurant_id', 'shift_id', 'business_date', 'currency'];
const MONEY_FIELDS = new Set(['planned_net_sales_cents', 'actual_net_sales_cents', 'hourly_rate_cents', 'planned_labor_cents', 'actual_labor_cents']);
const NULLABLE_FIELDS = new Set(['hourly_rate_cents', 'planned_labor_cents', 'actual_labor_cents', 'wage_scope']);
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class ZetarisError extends Error {
  constructor(code, message, receipt = null) {
    super(message); this.name = 'ZetarisError'; this.code = code; this.receipt = receipt;
  }
}
function fail(code, message, receipt) { throw new ZetarisError(code, message, receipt); }
function familyName(family) {
  if (!FAMILIES.includes(family)) fail('ZETARIS_QUERY_NOT_ALLOWED', 'Unsupported evidence source family');
  return family;
}
function qualifiedName(table) {
  if (typeof table !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(table))
    fail('ZETARIS_CONFIG', 'Use an explicitly configured source.table identifier');
  return table;
}
function scopeCopy(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) fail('ZETARIS_SCOPE', 'An explicit evidence scope is required');
  const result = Object.fromEntries(SCOPE_FIELDS.map(key => [key, scope[key]]));
  for (const key of ['restaurant_id', 'shift_id']) {
    if (typeof result[key] !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(result[key]))
      fail('ZETARIS_SCOPE', 'Invalid ' + key);
  }
  if (typeof result.business_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.business_date) ||
      Number.isNaN(Date.parse(result.business_date)) || new Date(result.business_date).toISOString().slice(0, 10) !== result.business_date)
    fail('ZETARIS_SCOPE', 'Invalid business date');
  if (typeof result.currency !== 'string' || !/^[A-Z]{3}$/.test(result.currency)) fail('ZETARIS_SCOPE', 'Invalid currency');
  return Object.freeze(result);
}
export function normalizeZetarisBase(input = 'http://localhost:8888/api/v1.0') {
  let url;
  try { url = new URL(input); } catch { fail('ZETARIS_CONFIG', 'Invalid Zetaris REST base URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !['/api/v1.0', '/api/v1.0/'].includes(url.pathname))
    fail('ZETARIS_CONFIG', 'This local build requires a loopback REST base ending in /api/v1.0');
  return url.href.replace(/\/$/, '');
}
export function normalizeZetarisUiBase(input = 'http://127.0.0.1:3000') {
  let url;
  try { url = new URL(input); } catch { fail('ZETARIS_CONFIG', 'Invalid Zetaris UI origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['', '/'].includes(url.pathname))
    fail('ZETARIS_CONFIG', 'UI proxy mode requires a plain loopback UI origin');
  return url.origin;
}
function numericOrg(value) {
  return ((typeof value === 'number' && Number.isSafeInteger(value)) || typeof value === 'string') && /^[1-9]\d{0,14}$/.test(String(value)) ? String(value) : null;
}
async function boundedDocument(response, receipt, auth = false) {
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > (auth ? 65536 : MAX_RESPONSE_BYTES)) throw new Error();
    return JSON.parse(text);
  } catch { receipt.status = 'schema_failure'; fail('ZETARIS_SCHEMA', auth ? 'Zetaris login returned invalid or oversized JSON' : 'Zetaris returned invalid or oversized JSON', receipt); }
}
function uiRows(document, columns, pageLimit, receipt) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || !Array.isArray(document.records) ||
      document.success === false || document.error || document.pageNumber !== 1 || document.pageLimit !== pageLimit ||
      document.totalPages !== 1 || !Number.isSafeInteger(document.totalCount) || document.totalCount < 0 ||
      document.totalCount !== document.records.length || document.totalCount > pageLimit)
    fail('ZETARIS_SCHEMA', 'UI proxy result must be a complete verified single page', receipt);
  return document.records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== columns.length ||
        columns.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !columns.includes(key)))
      fail('ZETARIS_SCHEMA', 'UI proxy columns do not match the explicit projection', receipt);
    return columns.map(key => record[key]);
  });
}
export function buildScopedQuery(family, scope, tables) {
  familyName(family);
  const table = qualifiedName(tables?.[family]);
  const checked = scopeCopy(scope);
  // Values are constrained above; no arbitrary SQL, identifiers or model text.
  const where = SCOPE_FIELDS.map(key => key + " = '" + checked[key] + "'").join(' AND ');
  return 'SELECT ' + ZETARIS_COLUMNS[family].join(', ') + ' FROM ' + table + ' WHERE ' + where + ' LIMIT 2';
}
function exactInteger(value, field, receipt) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) fail('ZETARIS_SCHEMA', 'Invalid integer field ' + field, receipt);
    return value;
  }
  // REST values can be strings and decimals can use exponent form. Convert
  // integer money exactly, rather than allowing Number() to round a fraction.
  if (typeof value !== 'string' || value.length > 80) fail('ZETARIS_SCHEMA', 'Invalid integer field ' + field, receipt);
  const match = /^\+?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,2}))?$/.exec(value);
  if (!match) fail('ZETARIS_SCHEMA', 'Invalid integer field ' + field, receipt);
  const fraction = match[2] || '';
  const scale = Number(match[3] || 0) - fraction.length;
  if (Math.abs(scale) > 40) fail('ZETARIS_SCHEMA', 'Integer field exponent out of range: ' + field, receipt);
  let result = BigInt(match[1] + fraction);
  if (scale >= 0) result *= 10n ** BigInt(scale);
  else {
    const divisor = 10n ** BigInt(-scale);
    if (result % divisor !== 0n) fail('ZETARIS_SCHEMA', 'Fractional integer field ' + field, receipt);
    result /= divisor;
  }
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('ZETARIS_SCHEMA', 'Unsafe integer field ' + field, receipt);
  return Number(result);
}
export function mapZetarisEvidence(family, rows, scope, receipt = null) {
  familyName(family);
  const checked = scopeCopy(scope);
  if (!Array.isArray(rows)) fail('ZETARIS_SCHEMA', 'Zetaris data must contain positional row arrays', receipt);
  if (rows.length === 0) fail('ZETARIS_MISSING_EVIDENCE', 'No ' + family + ' record matches the requested scope', receipt);
  if (rows.length !== 1) fail('ZETARIS_SCHEMA', 'Expected exactly one scoped ' + family + ' record; found ambiguity', receipt);
  const columns = ZETARIS_COLUMNS[family];
  if (!Array.isArray(rows[0]) || rows[0].length !== columns.length) fail('ZETARIS_SCHEMA', 'Positional columns do not match the explicit ' + family + ' projection', receipt);
  const record = {};
  for (let index = 0; index < columns.length; index++) {
    const field = columns[index], value = rows[0][index];
    if (value === null && NULLABLE_FIELDS.has(field)) { record[field] = null; continue; }
    if (MONEY_FIELDS.has(field) || field === 'labor_target_basis_points') {
      record[field] = exactInteger(value, field, receipt);
      if (field === 'labor_target_basis_points' && record[field] > 10000) fail('ZETARIS_SCHEMA', 'Labor target exceeds 100 percent', receipt);
    } else if (['planned_hours', 'actual_hours'].includes(field)) {
      if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !/^\d+(?:\.\d+)?(?:[eE][+-]?\d{1,2})?$/.test(String(value)))
        fail('ZETARIS_SCHEMA', 'Invalid hours field ' + field, receipt);
      const hours = Number(value);
      if (!Number.isFinite(hours) || hours < 0 || hours > 1000000) fail('ZETARIS_SCHEMA', 'Invalid hours field ' + field, receipt);
      record[field] = hours;
    } else {
      if (typeof value !== 'string' || !value || value.length > 2048) fail('ZETARIS_SCHEMA', 'Invalid text field ' + field, receipt);
      record[field] = value;
    }
  }
  try { validateRecord(record, checked, family); }
  catch (error) { fail(error.code === 'SCOPE_MISMATCH' ? 'ZETARIS_SCOPE_MISMATCH' : 'ZETARIS_SCHEMA', error.message, receipt); }
  return record;
}
function validMappingProof(proof, tables) {
  return proof?.verified === true && typeof proof.evidence_id === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(proof.evidence_id) &&
    FAMILIES.every(family => proof.tables?.[family] === tables[family] && Array.isArray(proof.columns?.[family]) &&
      JSON.stringify(proof.columns[family]) === JSON.stringify(ZETARIS_COLUMNS[family]));
}

export class Zetaris {
  #token; #fetcher; #networkTransport; #username; #password; #session = null;
  constructor({ base = process.env.ZETARIS_REST_URL, token = process.env.ZETARIS_API_KEY,
    orgId = process.env.ZETARIS_ORG_ID, apiTransport = 'direct_rest', username, password,
    tables = {}, mappingProof = null, fetcher = globalThis.fetch, timeoutMs = 30000 } = {}) {
    if (!['direct_rest', 'ui_proxy'].includes(apiTransport)) fail('ZETARIS_CONFIG', 'Choose an explicit supported Zetaris transport');
    this.apiTransport = apiTransport;
    this.base = apiTransport === 'direct_rest' ? normalizeZetarisBase(base) : normalizeZetarisUiBase(base);
    const configuredOrg = apiTransport === 'ui_proxy' && (orgId === null || orgId === '') ? undefined : orgId;
    if (configuredOrg !== undefined && !numericOrg(configuredOrg)) fail('ZETARIS_CONFIG', 'Use the actual positive numeric organization ID');
    if (apiTransport === 'direct_rest' && token !== undefined && (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token))) fail('ZETARIS_CONFIG', 'Invalid local Zetaris key configuration');
    if (typeof fetcher !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) fail('ZETARIS_CONFIG', 'Invalid request transport or timeout');
    if (apiTransport === 'ui_proxy' && ([username, password].some(value => typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\r\n\0]/.test(value)))) fail('ZETARIS_CONFIG', 'Configure ordinary UI login credentials privately');
    this.orgId = configuredOrg === undefined ? null : String(configuredOrg);
    this.tables = Object.freeze(Object.fromEntries(FAMILIES.filter(family => tables[family] !== undefined).map(family => [family, qualifiedName(tables[family])])));
    this.mappingVerified = Boolean(validMappingProof(mappingProof, this.tables));
    this.mappingEvidenceId = this.mappingVerified ? mappingProof.evidence_id : null;
    this.timeoutMs = timeoutMs;
    this.#token = apiTransport === 'direct_rest' ? token : undefined;
    this.#username = username; this.#password = password;
    this.#fetcher = fetcher; this.#networkTransport = fetcher === globalThis.fetch;
    Object.freeze(this);
  }
  async #authorize(receipt) {
    if (this.apiTransport === 'direct_rest') {
      if (!this.#token || !this.orgId) fail('ZETARIS_UNAUTHORIZED', 'Configure the user-created local API key and actual organization ID before querying');
      return { token: this.#token, orgId: this.orgId };
    }
    if (this.#session) { receipt.auth = { ...this.#session.receipt, reused: true }; return this.#session; }
    const auth = { mode: 'ordinary_login', endpoint: this.base + '/api/auth/login', request_id: randomUUID(),
      requested_at_utc: new Date().toISOString(), http_status: null, token_persisted: false, reused: false };
    receipt.auth = auth;
    let response;
    try {
      response = await this.#fetcher(auth.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': auth.request_id },
        body: JSON.stringify({ username: this.#username, password: this.#password }) });
    } catch (error) { receipt.status = 'offline'; fail(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'ZETARIS_TIMEOUT' : 'ZETARIS_OFFLINE', 'Zetaris login did not complete', receipt); }
    auth.http_status = response.status;
    if ([401, 403].includes(response.status)) { receipt.status = 'unauthorized'; fail('ZETARIS_UNAUTHORIZED', 'Zetaris ordinary login was rejected', receipt); }
    if (response.status >= 500 || [408, 429].includes(response.status)) { receipt.status = 'offline'; fail('ZETARIS_OFFLINE', 'Zetaris login service is unavailable', receipt); }
    if (!response.ok || response.redirected) { receipt.status = 'unauthorized'; fail('ZETARIS_UNAUTHORIZED', 'Zetaris ordinary login was not accepted at the configured origin', receipt); }
    const login = await boundedDocument(response, receipt, true);
    const orgId = numericOrg(login?.orgId), token = login?.idToken;
    if (!login || typeof login !== 'object' || Array.isArray(login) || login.error || login.success === false || !orgId ||
        typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
        (this.orgId !== null && this.orgId !== orgId)) {
      receipt.status = 'schema_failure'; fail('ZETARIS_SCHEMA', 'Zetaris login requires a valid session token and matching numeric organization ID', receipt);
    }
    auth.org_id = orgId; auth.completed_at_utc = new Date().toISOString();
    this.#session = { token, orgId, receipt: { ...auth } }; // Process memory only; refreshToken is never retained.
    return this.#session;
  }
  async execute(action) {
    // This API accepts named operations only. It never accepts caller SQL.
    if (!action || typeof action !== 'object' || Array.isArray(action) || 'sql' in action)
      fail('ZETARIS_QUERY_NOT_ALLOWED', 'Only named read-only operations are allowed');
    let sql, scope = null;
    if (this.apiTransport === 'ui_proxy' && !['probe', 'evidence'].includes(action.kind)) fail('ZETARIS_QUERY_NOT_ALLOWED', 'UI proxy metadata projections require separate live verification');
    if (action.kind === 'probe') sql = this.apiTransport === 'ui_proxy' ? 'SELECT 1 AS costproof_probe' : 'SELECT 1';
    else if (action.kind === 'list_databases') sql = 'SHOW LIGHTNING DATABASES';
    else if (action.kind === 'describe') sql = 'DESCRIBE DATASOURCE TABLE ' + qualifiedName(this.tables[familyName(action.family)]);
    else if (action.kind === 'evidence') { scope = scopeCopy(action.scope); sql = buildScopedQuery(action.family, scope, this.tables); }
    else fail('ZETARIS_QUERY_NOT_ALLOWED', 'Unsupported read-only operation');
    const queryId = randomUUID(), requestId = randomUUID();
    const receipt = { tool: 'zetaris_rest_sql', endpoint: this.base + (this.apiTransport === 'direct_rest' ? '/sql-editor/sqls/run' : '/api/proxy/query/sql/start'), api_transport: this.apiTransport,
      query_id: queryId, request_id: requestId, sql, scope, family: action.family || null,
      requested_at_utc: new Date().toISOString(), status: 'pending', http_status: null,
      transport: this.#networkTransport ? 'network' : 'injected_test_transport', transport_verified: false,
      mapping_verified: this.mappingVerified, mapping_evidence_id: this.mappingEvidenceId,
      integration_verified: false, row_count: null };
    const started = performance.now();
    try {
      const authorization = await this.#authorize(receipt);
      if (this.apiTransport === 'ui_proxy') { receipt.org_id = authorization.orgId; receipt.query_id_source = 'client_correlation_only'; }
      const limit = this.apiTransport === 'ui_proxy' ? 5 : action.kind === 'evidence' ? 2 : 100;
      let response;
      try {
        response = await this.#fetcher(receipt.endpoint, { method: 'POST', redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { Authorization: 'Bearer ' + authorization.token, 'X-Org-ID': authorization.orgId, 'X-Request-ID': requestId, 'Content-Type': 'application/json' },
          body: JSON.stringify(this.apiTransport === 'ui_proxy' ? { select: sql, pageLimit: limit } : { queryId, sql, source: 'SqlEditor', limit }) });
      } catch (error) {
        receipt.status = 'offline';
        fail(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'ZETARIS_TIMEOUT' : 'ZETARIS_OFFLINE', 'Zetaris request did not complete; no fixture fallback was used', receipt);
      }
      receipt.http_status = response.status;
      if ([401, 403].includes(response.status)) { this.#session = null; receipt.status = 'unauthorized'; fail('ZETARIS_UNAUTHORIZED', 'Zetaris authorization was rejected', receipt); }
      if (response.status >= 500 || [408, 429].includes(response.status)) { receipt.status = 'offline'; fail('ZETARIS_OFFLINE', 'Zetaris service is unavailable or rate limited', receipt); }
      if (!response.ok || response.redirected) { receipt.status = 'schema_failure'; fail('ZETARIS_REQUEST_REJECTED', 'Zetaris rejected the documented read request; verify the running API and configuration', receipt); }
      const document = await boundedDocument(response, receipt);
      if (this.apiTransport === 'ui_proxy') {
        let rows;
        try { rows = uiRows(document, action.kind === 'evidence' ? ZETARIS_COLUMNS[action.family] : ['costproof_probe'], limit, receipt); }
        catch (error) { receipt.status = 'schema_failure'; throw error; }
        receipt.pagination = { page_number: document.pageNumber, page_limit: document.pageLimit, total_count: document.totalCount, total_pages: document.totalPages };
        receipt.row_count = rows.length; receipt.transport_verified = this.#networkTransport; receipt.status = 'received';
        return { rows, receipt };
      }
      if (!document || typeof document !== 'object' || Array.isArray(document) || !Array.isArray(document.data) ||
          document.data.some(row => !Array.isArray(row)) || document.data.length > 100 || document.success === false || document.error) {
        receipt.status = 'schema_failure'; fail('ZETARIS_SCHEMA', 'Unexpected Zetaris positional-row response; inspect the running API schema', receipt);
      }
      receipt.row_count = document.data.length;
      receipt.transport_verified = this.#networkTransport;
      receipt.status = 'received';
      return { rows: document.data, receipt };
    } finally { receipt.duration_ms = Math.round(performance.now() - started); }
  }
  async readFamily(family, scope) {
    const out = await this.execute({ kind: 'evidence', family, scope });
    let record;
    try { record = mapZetarisEvidence(family, out.rows, scope, out.receipt); }
    catch (error) {
      out.receipt.status = error.code === 'ZETARIS_MISSING_EVIDENCE' ? 'needs_evidence' : 'schema_failure';
      throw error;
    }
    out.receipt.status = this.mappingVerified ? 'validated' : 'mapping_unverified';
    out.receipt.integration_verified = out.receipt.transport_verified && this.mappingVerified;
    out.receipt.source_id = record.id;
    return { record, receipt: out.receipt };
  }
  async readSources(scope, order = FAMILIES) {
    if (!this.mappingVerified) fail('ZETARIS_MAPPING_UNVERIFIED', 'Record real source/table/column verification before enabling the application provider');
    if (!Array.isArray(order) || order.length !== FAMILIES.length || new Set(order).size !== FAMILIES.length || order.some(family => !FAMILIES.includes(family)))
      fail('ZETARIS_QUERY_NOT_ALLOWED', 'Invalid source collection plan');
    const records = {}, trace = [];
    for (const family of order) {
      const out = await this.readFamily(family, scope);
      records[family] = out.record;
      trace.push({ role: 'source', ...out.receipt });
    }
    return { records, trace, provider: this.apiTransport === 'ui_proxy' ? 'Zetaris UI proxy' : 'Zetaris REST', zetaris_verified: trace.every(receipt => receipt.integration_verified) };
  }
}
