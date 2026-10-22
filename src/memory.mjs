import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHMEM } from '../sponsor-starter/src/engine.ts';
const defaultRoot = fileURLToPath(new URL('../.costproof/memory/', import.meta.url));
function scopeKey(scope) {
  const tuple = ['restaurant_id', 'shift_id', 'business_date', 'currency'].map(k => scope[k]);
  if (tuple.some(v => typeof v !== 'string' || !v)) throw new Error('A complete memory scope is required');
  return createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
}
export async function openMemory(scope, root = defaultRoot) {
  const persistDir = path.join(root, scopeKey(scope));
  await mkdir(persistDir, { recursive: true });
  const { HMEM } = await loadHMEM();
  return new HMEM({ persistDir });
}
export async function rememberCorrection(scope, note, root) {
  if (note.classification !== 'UNVERIFIED_MANAGER_REPORT' || typeof note.text !== 'string' || !note.text.trim() || note.text.length > 2000) throw new Error('A labeled manager report is required');
  for (const key of ['restaurant_id', 'shift_id', 'business_date', 'currency']) if (note[key] !== scope[key]) throw new Error('Correction scope does not match the investigation');
  if (note.applies_only_to_shift_id !== scope.shift_id || typeof note.id !== 'string') throw new Error('Correction provenance is incomplete');
  const memory = await openMemory(scope, root);
  const prior = memory.store.all().find(m => m.source === 'manager-report:' + note.id);
  if (prior) {
    const saved = JSON.parse(prior.content);
    if (saved.text !== note.text) throw new Error('This source ID already has different text; use a new source ID for a revision');
    return { id: prior.id, created: false, classification: note.classification, scope };
  }
  const record = memory.add({
    content: JSON.stringify({ ...note, scope, reviewed_for_scope_at: new Date().toISOString(), payroll_overridden: false }),
    source: 'manager-report:' + note.id, type: 'factual', confidence: 0.5,
    tags: ['manager_report', 'training', 'labor', scope.restaurant_id, scope.shift_id],
    provenance: { origin: 'user_correction', learnedAt: Date.now(), label: 'User reviewed scope; statement remains unverified', refs: [note.id] }
  });
  return { id: record.id, created: true, classification: note.classification, scope };
}
export async function recallCorrections(scope, question, root) {
  const memory = await openMemory(scope, root);
  const result = memory.query(question, { threshold: 0, topN: 20 });
  return result.memories.map(({ memory: row, relevance }) => {
    const note = JSON.parse(row.content);
    if (['restaurant_id', 'shift_id', 'business_date', 'currency'].some(k => note.scope?.[k] !== scope[k])) throw new Error('Stored correction scope mismatch');
    return { memory_id: row.id, relevance, note, audit: memory.ledger.history(row.id) };
  });
}
