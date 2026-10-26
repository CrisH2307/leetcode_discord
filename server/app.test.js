import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from './app.js';

let server;
let port;
let calls;

function fakePresence() {
  return {
    set: async (activity) => calls.push(['set', activity]),
    clear: async () => calls.push(['clear']),
    status: () => 'fake',
  };
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : null }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function start(options = {}) {
  server = createApp({ presence: fakePresence(), assets: { largeImageKey: 'leetcode' }, ...options });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
}

const payload = () => ({
  details: '1. Two Sum',
  state: 'Medium',
  startedAt: Date.now() - 60_000,
  url: 'https://leetcode.com/problems/two-sum/',
});

beforeEach(() => {
  calls = [];
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

test('health reports backend status', async () => {
  await start();
  const res = await request('GET', '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, discord: 'fake', active: false, lastUpdate: null });
});

test('valid presence becomes a Discord activity with the expected layout', async () => {
  await start();
  const body = payload();
  const res = await request('POST', '/presence', body);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  const [kind, activity] = calls[0];
  assert.equal(kind, 'set');
  assert.equal(activity.details, '1. Two Sum');
  assert.equal(activity.state, 'Medium');
  assert.equal(activity.startTimestamp, body.startedAt);
  assert.equal(activity.largeImageKey, 'leetcode');
  assert.equal(activity.buttons, undefined);
});

test('button is only added when enabled', async () => {
  await start({ assets: { largeImageKey: 'leetcode', showButton: true } });
  await request('POST', '/presence', payload());
  assert.deepEqual(calls[0][1].buttons, [{ label: 'Open problem', url: 'https://leetcode.com/problems/two-sum/' }]);
});

test('identical heartbeats do not resend the activity', async () => {
  await start();
  const body = payload();
  await request('POST', '/presence', body);
  await request('POST', '/presence', body);
  assert.equal(calls.length, 1);
});

test('changed problem sends a new activity', async () => {
  await start();
  await request('POST', '/presence', payload());
  await request('POST', '/presence', { ...payload(), details: '2. Add Two Numbers' });
  assert.equal(calls.length, 2);
});

test('invalid payloads are rejected', async () => {
  await start();
  for (const bad of [null, {}, { details: 'x', startedAt: Date.now() }, { details: '1. Two Sum', startedAt: 5 }, { details: '1. Two Sum', startedAt: Date.now(), state: 'a' }]) {
    const res = await request('POST', '/presence', bad);
    assert.equal(res.status, 400);
  }
  assert.equal(calls.length, 0);
});

test('non-leetcode button urls are dropped', async () => {
  await start({ assets: { showButton: true } });
  await request('POST', '/presence', { ...payload(), url: 'https://evil.example/problems/two-sum/' });
  assert.equal(calls[0][1].buttons, undefined);
});

test('requests from web pages are rejected', async () => {
  await start();
  const res = await request('POST', '/presence', payload(), { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('Firefox extension origins are accepted and get CORS headers', async () => {
  await start();
  const origin = 'moz-extension://11111111-2222-3333-4444-555555555555';
  const res = await request('POST', '/presence', payload(), { origin });
  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], origin);
  assert.equal(calls.length, 1);
});

test('CORS preflight works for extensions and is refused for web pages', async () => {
  await start();
  const ok = await request('OPTIONS', '/presence', undefined, {
    origin: 'moz-extension://abc',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
  });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers['access-control-allow-origin'], 'moz-extension://abc');
  const bad = await request('OPTIONS', '/presence', undefined, { origin: 'https://evil.example' });
  assert.equal(bad.status, 403);
});

test('extension origins are accepted', async () => {
  await start();
  const res = await request('GET', '/health', undefined, { origin: 'chrome-extension://abcdef' });
  assert.equal(res.status, 200);
});

test('unexpected Host header is rejected (DNS rebinding guard)', async () => {
  await start();
  const res = await request('GET', '/health', undefined, { host: 'evil.example' });
  assert.equal(res.status, 403);
});

test('clear removes the activity', async () => {
  await start();
  await request('POST', '/presence', payload());
  await request('POST', '/clear');
  assert.deepEqual(calls.at(-1), ['clear']);
});

test('presence is cleared when heartbeats stop', async () => {
  await start({ ttlMs: 60 });
  await request('POST', '/presence', payload());
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(calls.at(-1), ['clear']);
});

test('oversized body is rejected', async () => {
  await start();
  const res = await request('POST', '/presence', { ...payload(), junk: 'x'.repeat(10_000) }).catch((err) => ({ status: 'error', err }));
  assert.notEqual(res.status, 200);
  assert.equal(calls.length, 0);
});
