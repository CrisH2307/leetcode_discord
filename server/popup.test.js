// Runs the real popup.js with a tiny DOM stub. Checks the diagnostics a user needs when the card
// does not show: loaded version, host access (Firefox does not grant it at install) and server state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'popup.js'),
  'utf8',
);

function element(tag) {
  return {
    tag,
    children: [],
    textContent: '',
    checked: false,
    listeners: {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  };
}

const flatten = (node) =>
  typeof node === 'string' ? node : [node.textContent, ...node.children.map(flatten)].join('');

async function open({ granted, health = { discord: 'connected', lastUpdate: null }, statusRecord }) {
  const ids = {};
  const document = {
    getElementById: (id) => (ids[id] ??= element(id)),
    createElement: element,
  };
  let requested = null;
  let isGranted = granted;
  const chrome = {
    runtime: { getManifest: () => ({ version: '9.9.9' }) },
    permissions: {
      contains: async () => isGranted,
      request: async (query) => {
        requested = query;
        isGranted = true;
        return true;
      },
    },
    storage: {
      sync: { get: async (d) => d, set: async () => {} },
      local: { get: async () => (statusRecord ? { status: statusRecord } : {}) },
    },
  };
  const fetch = async () => ({ json: async () => health });
  vm.runInContext(source, vm.createContext({ chrome, document, fetch, console, Date }));
  await new Promise((r) => setTimeout(r, 20));
  const rows = ids.status.children;
  return {
    text: rows.map(flatten),
    button: rows.find((r) => r.tag === 'button'),
    requested: () => requested,
    rerender: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return ids.status.children.map(flatten);
    },
  };
}

test('popup shows the loaded extension version', async () => {
  const popup = await open({ granted: true });
  assert.ok(popup.text.includes('Version: 9.9.9'));
});

test('popup reports granted access and shows no button', async () => {
  const popup = await open({ granted: true });
  assert.ok(popup.text.includes('Site access: granted'));
  assert.equal(popup.button, undefined);
});

test('missing access is flagged and the button requests both origins', async () => {
  const popup = await open({ granted: false });
  assert.ok(popup.text.some((t) => t.startsWith('Site access: NOT granted')));
  assert.ok(popup.button, 'expected a Grant access button');
  await popup.button.listeners.click();
  assert.deepEqual([...popup.requested().origins], ['https://leetcode.com/*', 'http://127.0.0.1:47391/*']);
  const after = await popup.rerender();
  assert.ok(after.includes('Site access: granted'));
});

test('popup still shows server and extension state', async () => {
  const popup = await open({ granted: true, statusRecord: { ok: true, detail: 'presence', at: Date.now() } });
  assert.ok(popup.text.includes('Server: running'));
  assert.ok(popup.text.some((t) => t.startsWith('Last extension update: ok at')));
});
