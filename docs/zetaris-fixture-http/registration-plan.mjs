import { pathToFileURL } from 'node:url';
import { ZETARIS_COLUMNS } from '../../src/zetaris.mjs';

// Prints a plan only. No network, SQL execution, tokens or .env loading.
export function registrationPlan(sourceBase) {
  let url;
  try { url = new URL(sourceBase); } catch { throw new Error('Provide a source origin whose reachability has been checked from Zetaris'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !/^[A-Za-z0-9.:[\]-]+$/.test(url.hostname)) throw new Error('Source base must be an HTTP origin without credentials, paths, queries or fragments');
  const statements = ['CREATE SCHEMASTORE CONTAINER costproof'];
  const verification = [];
  for (const family of ['sales', 'labor', 'policy']) {
    const database = 'CP101_' + family.toUpperCase();
    statements.push('CREATE LIGHTNING DATABASE ' + database + ' DESCRIBE BY "CostProof synthetic ' + family + '"');
    statements.push('CREATE LIGHTNING REST TABLE source_rows FROM ' + database + ' REQUEST (\n' +
      '  endpoint "' + url.origin + '/' + family + '.json",\n' +
      '  method "get",\n  response_type "json",\n  http_encoding "URLENCODED"\n) HEADER () BODY ()');
    const projection = ZETARIS_COLUMNS[family].map(column => '  evidence_row.' + column + ' AS ' + column).join(',\n');
    statements.push('CREATE SCHEMASTORE VIEW ' + family + ' WITH CONTAINER costproof AS\nSELECT\n' + projection +
      '\nFROM ' + database.toLowerCase() + '.source_rows\nLATERAL VIEW explode(records) AS evidence_row');
    verification.push('DESCRIBE DATASOURCE TABLE costproof.' + family);
    verification.push('SELECT ' + ZETARIS_COLUMNS[family].join(', ') + ' FROM costproof.' + family + ' LIMIT 2');
    verification.push('SELECT COUNT(*) FROM costproof.' + family);
  }
  return { state: 'UNEXECUTED_PLAN', source_base: url.origin,
    tables: { sales: 'costproof.sales', labor: 'costproof.labor', policy: 'costproof.policy' }, statements, verification };
}
export function formatRegistrationPlan(plan) {
  return '-- UNEXECUTED PLAN. Verify source reachability and inspect existing objects first.\n' +
    '-- Based on the official Zetaris PokéAPI REST/SchemaStore recipe.\n' +
    '-- Run one statement per call. Do not replace existing objects blindly.\n\n' +
    plan.statements.map(statement => statement + ';').join('\n\n') +
    '\n\n-- Read-only verification. Compare with the independent JSON sources.\n\n' +
    plan.verification.map(statement => statement + ';').join('\n\n') + '\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node registration-plan.mjs http://<verified-source-host>:4318');
  process.stdout.write(formatRegistrationPlan(registrationPlan(process.argv[2])));
}
