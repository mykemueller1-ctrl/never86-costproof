import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mapZetarisEvidence, ZETARIS_COLUMNS } from '../../src/zetaris.mjs';
import { SCOPE } from '../../src/reconcile.mjs';

// An isolated source for Zetaris, not an alternative to a Zetaris query.
// It serves the existing synthetic envelopes; no directory or credential file
// can be selected by an HTTP request. No vendor configuration is changed.
export async function loadSyntheticPayloads() {
  const payloads = new Map();
  for (const family of ['sales', 'labor', 'policy']) {
    const file = new URL('../../seed/sources/' + family + '.json', import.meta.url);
    const bytes = await readFile(file);
    const envelope = JSON.parse(bytes.toString('utf8'));
    if (envelope.source_family !== family || envelope.not_a_customer_result !== true || envelope.records?.length !== 1)
      throw new Error('Invalid canonical synthetic envelope: ' + family);
    const row = ZETARIS_COLUMNS[family].map(column => envelope.records[0][column] ?? null);
    mapZetarisEvidence(family, [row], SCOPE);
    payloads.set('/' + family + '.json', { bytes, family,
      sha256: createHash('sha256').update(bytes).digest('hex'), source_id: envelope.records[0].id });
  }
  return payloads;
}
export function parseOptions(argv) {
  const options = { host: '127.0.0.1', port: 4318 };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (flag === '--host' && value !== undefined) options.host = value;
    else if (flag === '--port' && value !== undefined && /^\d{1,5}$/.test(value)) options.port = Number(value);
    else throw new Error('Usage: node server.mjs [--host 127.0.0.1] [--port 4318]');
  }
  if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(options.host) || !Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
    throw new Error('Unsupported source listener address or port');
  return options;
}
export async function startFixtureServer({ host = '127.0.0.1', port = 4318, log = () => {} } = {}) {
  parseOptions(['--host', host, '--port', String(port)]);
  const payloads = await loadSyntheticPayloads();
  const manifest = {
    classification: 'SYNTHETIC_COMPETITION_FIXTURE', not_a_customer_result: true,
    zetaris_registration_verified: false,
    endpoints: [...payloads].map(([path, item]) => ({ path, source_family: item.family, source_id: item.source_id, bytes: item.bytes.length, sha256: item.sha256 }))
  };
  const server = http.createServer((request, response) => {
    const send = (status, bytes, extra = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': bytes.length, ...extra });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    };
    const json = (status, value, extra) => send(status, Buffer.from(JSON.stringify(value)), extra);
    if (!['GET', 'HEAD'].includes(request.method)) { json(405, { error: 'Read only source' }, { Allow: 'GET, HEAD' }); return; }
    // Match the raw target exactly: traversal, encoded filenames, extra paths
    // and query strings do not become filesystem reads or alternate scenarios.
    const item = payloads.get(request.url);
    if (item) {
      send(200, item.bytes, { ETag: '"' + item.sha256 + '"' });
      log({ event: 'synthetic_source_read', family: item.family, sha256: item.sha256, method: request.method, status: 200 });
    } else if (request.url === '/manifest.json') json(200, manifest);
    else if (request.url === '/healthz') json(200, { status: 'ready', source: 'local synthetic fixture HTTP', zetaris_registration_verified: false });
    else json(404, { error: 'Unknown source endpoint' });
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 20;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address();
  const advertisedHost = address.address.includes(':') ? '[' + address.address + ']' : address.address;
  return { server, manifest, url: 'http://' + advertisedHost + ':' + address.port, host: address.address, port: address.port };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseOptions(process.argv.slice(2));
  const running = await startFixtureServer({ ...options, log: item => process.stdout.write(JSON.stringify(item) + '\n') });
  process.stdout.write(JSON.stringify({ event: 'synthetic_source_started', ...options, port: running.port,
    source: 'synthetic fixtures only', zetaris_registration_verified: false }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { running.server.close(); running.server.closeAllConnections(); });
}
