import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { investigate } from './investigate.mjs';
import { Nightshift } from './nightshift.mjs';
import { SCOPE } from './reconcile.mjs';
import { rememberCorrection, recallCorrections } from './memory.mjs';
import { getZetarisStatus } from './sources.mjs';
try { process.loadEnvFile(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const root = fileURLToPath(new URL('../', import.meta.url));
const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('CostProof must listen on loopback');
const port = Number(process.env.PORT || 4317);
const publicFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function input(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 12000) throw new Error('Request too large'); }
  return text ? JSON.parse(text) : {};
}
let busy = false;
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  const allowedHosts = new Set(['127.0.0.1:' + port, 'localhost:' + port, '[::1]:' + port]);
  if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'Unexpected host' });
  const url = new URL(req.url, 'http://127.0.0.1:' + port);
  try {
    if (req.method === 'GET' && publicFiles.has(url.pathname)) {
      const [file, type] = publicFiles.get(url.pathname);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return res.end(await readFile(path.join(root, 'public', file)));
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, {
      project: 'Never86 CostProof', scope: SCOPE, synthetic: true,
      hmem: 'Application integration available; stores reviewed reports locally',
      nightshift: await new Nightshift().discover(), zetaris: await getZetarisStatus(),
      competition_ready: false, build_window_open: true
    });
    if (req.method === 'GET' && url.pathname === '/api/memory') return send(res, 200, await recallCorrections(SCOPE, 'labor training manager correction'));
    if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
    // Prevent cross origin browser requests to this local stateful app.
    if (!allowedHosts.has(new URL(req.headers.origin || 'http://invalid').host) || req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res, 403, { error: 'Same origin JSON required' });
    if (busy) return send(res, 409, { error: 'Another investigation is running' });
    const body = await input(req);
    if (url.pathname === '/api/corrections') {
      const document = JSON.parse(await readFile(path.join(root, 'seed/sources/manager_correction.json'), 'utf8'));
      if (body.reviewed_for_scope !== true) return send(res, 400, { error: 'Review the report and scope first' });
      return send(res, 200, await rememberCorrection(SCOPE, document.records[0]));
    }
    if (url.pathname === '/api/investigate') {
      if (busy) return send(res, 409, { error: 'Another investigation is running' });
      busy = true;
      try {
        const result = await investigate(body);
        result.run_id = randomUUID();
        result.created_at_utc = new Date().toISOString();
        await mkdir(path.join(root, '.costproof/runs'), { recursive: true });
        await writeFile(path.join(root, '.costproof/runs', result.run_id + '.json'), JSON.stringify(result, null, 2));
        return send(res, 200, result);
      } finally { busy = false; }
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 400, { error: error.code || 'REQUEST_FAILED', message: error.message, details: error.details || [] });
  }
});
server.listen(port, host, () => console.log('CostProof local synthetic preview: http://' + host + ':' + port));
