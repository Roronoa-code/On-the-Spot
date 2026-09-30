import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { previewBridge } from '../design/preview-bridge.mjs';

test('browser preview keeps real learning isolated and cannot imply desktop capabilities', async t => {
  const plugin = previewBridge();
  assert.equal(plugin.apply, 'serve');
  let middleware;
  const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404).end(); }));
  plugin.configureServer({ httpServer: server, middlewares: { use: handler => { middleware = handler; } } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const script = await fetch(`${origin}/__ots_preview/bridge.js`).then(response => response.text());
  const secret = script.match(/'X-OTS-Preview': "([a-f0-9]+)"/)?.[1];
  assert.ok(secret);
  const first = randomUUID(), second = randomUUID();
  const request = async (sessionId, action, payload = {}) => {
    const response = await fetch(`${origin}/__ots_preview/${action ? 'command' : 'state'}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-OTS-Preview': secret },
      body: JSON.stringify({ sessionId, action, payload }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const initial = await request(first);
  assert.equal(initial.preview, true);
  assert.equal(initial.learning.profile, null);
  assert.equal(initial.voice.available, false);
  await request(first, 'learn:profile', { name: 'Preview tester', interests: 'Words', goal: 'Recall', language: 'English' });
  assert.equal((await request(first)).learning.profile.name, 'Preview tester');
  assert.equal((await request(second)).learning.profile, null);
  const started = await request(first, 'learn:start', { mode: 'short' });
  assert.equal(started.learning.session.count, 4);
  assert.equal('terms' in started.learning.session.exercise, false);
  const ids = { sessionId: started.learning.session.id, exerciseId: started.learning.session.exercise.id };
  const answered = await request(first, 'learn:answer', { ...ids, answer: 'A rough answer helps plan shopping.' });
  assert.equal(answered.learning.session.result.score, 1);
  assert.equal(answered.learning.attempts.length, 1);
  const reloaded = await request(first);
  assert.equal(reloaded.learning.session.result.id, answered.learning.session.result.id);
  const connection = await request(first, 'signIn');
  assert.equal(connection.signedIn, false);
  assert.deepEqual(connection.evidence, []);
  assert.match(connection.message, /desktop app/);
  assert.equal((await request(first, 'voice:consent')).voice.consent, false);
  const exported = await request(first, 'learn:export');
  assert.equal(JSON.parse(exported.previewExport).attempts.length, 1);
  assert.equal((await request(first, 'learn:delete')).learning.profile, null);
});

test('preview transport rejects cross-origin, untrusted and invalid requests', async t => {
  let middleware;
  const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404).end(); }));
  previewBridge().configureServer({ httpServer: server, middlewares: { use: handler => { middleware = handler; } } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/__ots_preview/state`;
  const script = await fetch(`${origin}/__ots_preview/bridge.js`).then(response => response.text());
  const secret = script.match(/'X-OTS-Preview': "([a-f0-9]+)"/)?.[1];
  const body = JSON.stringify({ sessionId: randomUUID() });
  assert.equal((await fetch(url, { method: 'POST', body })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', body, headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json', 'X-OTS-Preview': secret } })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', body: '{', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-OTS-Preview': secret } })).status, 400);
  assert.equal((await fetch(`${origin}/__ots_preview/command`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-OTS-Preview': secret }, body: JSON.stringify({ sessionId: randomUUID(), action: 'learn:profile', payload: { name: 'Test', interests: '', goal: '', language: '', extra: true } }) })).status, 400);
});
