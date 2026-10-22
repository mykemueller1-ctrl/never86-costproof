import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBase, Nightshift } from '../src/nightshift.mjs';
test('Nightshift URL normalization never duplicates v1 or retains connect tokens', () => {
  for (const url of ['127.0.0.1:8088', 'http://127.0.0.1:8088/v1', 'http://127.0.0.1:8088/v1/chat/completions', 'http://127.0.0.1:8088/healthz', 'http://127.0.0.1:8088/connect#k=SECRET']) assert.equal(normalizeBase(url), 'http://127.0.0.1:8088/v1');
  assert.throws(() => normalizeBase('https://remote.example/v1'), /loopback/);
});
test('wrong authorization is reported as unauthorized, never offline', async () => {
  const client = new Nightshift({ token: 'deliberately-wrong', fetcher: async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer deliberately-wrong');
    assert.equal(options.headers['meterless-app'], 'never86-costproof');
    return new Response('{}', { status: 403 });
  } });
  assert.equal((await client.discover()).status, 'unauthorized');
});
test('discovery retains new meterless routing IDs but requires real model discovery', async () => {
  const client = new Nightshift({ token: 'test-only', fetcher: async () => new Response(JSON.stringify({ data: [{ id: 'meterless/new-route' }, { id: 'other/model' }] })) });
  assert.deepEqual((await client.discover()).models, ['meterless/new-route']);
  const noModels = new Nightshift({ token: 'test-only', fetcher: async () => new Response('{}') });
  assert.equal((await noModels.discover()).status, 'offline');
});
test('text requests use the user scope and return model text as structured data', async () => {
  const client = new Nightshift({ token: 'test-only', fetcher: async (_url, options) => {
    assert.equal(options.headers['meterless-scope'], 'user');
    assert.equal(typeof JSON.parse(options.body).messages[1].content, 'string');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], model: 'test-model' }));
  } });
  assert.equal((await client.json('critic', 'Review', {})).value.ok, true);
});
