// Runs the real extension scripts (content.js and background.js) against the real HTTP server,
// with the browser APIs stubbed. Covers everything except the browser itself.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const extDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const read = (name) => readFileSync(path.join(extDir, name), 'utf8');

const tags = (...names) => names.map((name) => ({ name }));
const SKYLINE = {
  questionFrontendId: '218',
  title: 'The Skyline Problem',
  difficulty: 'Hard',
  topicTags: tags('Array', 'Divide and Conquer', 'Binary Indexed Tree', 'Segment Tree', 'Line Sweep', 'Heap (Priority Queue)', 'Ordered Set'),
};

let server;
let port;
let calls;
let env;

function fakePresence() {
  return {
    set: async (a) => calls.push(['set', a]),
    clear: async () => calls.push(['clear']),
    status: () => 'fake',
  };
}

// fetch stub that behaves like an extension service worker: real HTTP to the server, extension Origin.
function extensionFetch(url, init = {}) {
  const target = new URL(url.replace(':47391', `:${port}`));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: init.method ?? 'GET',
        headers: { origin: 'chrome-extension://testid', ...(init.headers ?? {}) },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    get: async (keys) => {
      if (typeof keys === 'string') return keys in data ? { [keys]: data[keys] } : {};
      return { ...keys, ...Object.fromEntries(Object.keys(keys).filter((k) => k in data).map((k) => [k, data[k]])) };
    },
    set: async (obj) => Object.assign(data, obj),
    remove: async (key) => delete data[key],
    data,
  };
}

function boot({ pathname, syncSettings = {}, withSessionStorage = true, question = SKYLINE }) {
  const listeners = [];
  const changeListeners = [];
  const sync = makeStorage(syncSettings);
  const chrome = {
    storage: {
      sync,
      local: makeStorage(),
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (msg) => new Promise((resolve) => listeners.forEach((fn) => fn(msg, {}, resolve))),
    },
  };
  if (withSessionStorage) chrome.storage.session = makeStorage();

  vm.runInContext(read('background.js'), vm.createContext({ chrome, fetch: extensionFetch, console }));

  const intervals = [];
  const location = { pathname };
  const store = new Map();
  const content = vm.createContext({
    chrome,
    location,
    console,
    document: { visibilityState: 'visible', addEventListener() {} },
    window: { addEventListener() {} },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    fetch: async (_url, init) => {
      const query = JSON.parse(init.body).query;
      const result = typeof question === 'function' ? question(query) : question;
      return { ok: true, json: async () => ({ data: { question: result } }) };
    },
    setInterval: (fn) => intervals.push(fn),
  });
  vm.runInContext(read('content.js'), content);

  return {
    chrome,
    location,
    tick: () => Promise.all(intervals.map((fn) => fn())),
    changeSettings: async (patch) => {
      Object.assign(sync.data, patch);
      for (const fn of changeListeners) await fn({}, 'sync');
    },
  };
}

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  calls = [];
  server = createApp({ presence: fakePresence(), assets: { largeImageKey: 'leetcode' }, ttlMs: 60_000 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

test('problem page produces the expected Discord activity', async () => {
  boot({ pathname: '/problems/the-skyline-problem/' });
  await settle();
  assert.equal(calls.length, 1);
  const [kind, activity] = calls[0];
  assert.equal(kind, 'set');
  assert.equal(activity.details, '218. The Skyline Problem');
  assert.equal(activity.state, 'Hard \u00b7 Heap/PQ, Segment Tree, BIT');
  assert.ok(Math.abs(activity.startTimestamp - Date.now()) < 5000);
  assert.equal(activity.largeImageKey, 'leetcode');
});

test('works when storage.session is unavailable', async () => {
  boot({ pathname: '/problems/the-skyline-problem/', withSessionStorage: false });
  await settle();
  assert.equal(calls[0]?.[1].details, '218. The Skyline Problem');
});

test('leaving the problem clears the presence', async () => {
  const page = boot({ pathname: '/problems/the-skyline-problem/' });
  await settle();
  page.location.pathname = '/problemset/';
  await page.tick();
  await settle();
  assert.deepEqual(calls.at(-1), ['clear']);
});

test('contest pages are ignored', async () => {
  boot({ pathname: '/contest/weekly-contest-400/problems/two-sum/' });
  await settle();
  assert.equal(calls.length, 0);
});

test('hide title setting is applied', async () => {
  boot({ pathname: '/problems/the-skyline-problem/', syncSettings: { hideTitle: true } });
  await settle();
  assert.equal(calls[0][1].details, 'Solving a problem');
  assert.equal(calls[0][1].state, 'Hard \u00b7 Heap/PQ, Segment Tree, BIT');
});

test('toggling hide title updates the card immediately', async () => {
  const page = boot({ pathname: '/problems/the-skyline-problem/' });
  await settle();
  await page.changeSettings({ hideTitle: true });
  await settle();
  assert.equal(calls.at(-1)[1].details, 'Solving a problem');
});

test('disabling the extension clears the card', async () => {
  const page = boot({ pathname: '/problems/the-skyline-problem/' });
  await settle();
  await page.changeSettings({ enabled: false });
  await settle();
  assert.deepEqual(calls.at(-1), ['clear']);
});

test('popup status records success', async () => {
  const page = boot({ pathname: '/problems/the-skyline-problem/' });
  await settle();
  const { status } = await page.chrome.storage.local.get('status');
  assert.equal(status.ok, true);
});

const stateFor = async (question, syncSettings = {}) => {
  calls.length = 0; // several cards can be checked in one test
  boot({ pathname: '/problems/x/', syncSettings, question });
  await settle();
  return calls[0][1].state;
};
const problem = (difficulty, ...names) => ({ ...SKYLINE, difficulty, topicTags: tags(...names) });

test('core topics come first, then specific ones, generic ones only fill the gap', async () => {
  assert.equal(await stateFor(problem('Medium', 'Array', 'Hash Table', 'Two Pointers')), 'Medium \u00b7 Two Pointers, Hash Table'); // Array would exceed the budget
  assert.equal(await stateFor(problem('Easy', 'Array', 'String')), 'Easy \u00b7 Array, String');
});

test('at most three topics are shown', async () => {
  const state = await stateFor(problem('Hard', 'Trie', 'Graph', 'Greedy', 'Backtracking', 'Binary Search'));
  assert.equal(state.split(' \u00b7 ')[1].split(', ').length, 3);
});

test('long tag names are shortened', async () => {
  assert.equal(await stateFor(problem('Hard', 'Dynamic Programming', 'Depth-First Search')), 'Hard \u00b7 DP, DFS');
});

test('the topic line stays within the character budget, skipping tags that do not fit', async () => {
  const long = 'A Very Long Imaginary Topic Name X';
  const state = await stateFor(problem('Hard', long, 'Trie', 'Hash Table'));
  const topics = state.split(' \u00b7 ')[1];
  assert.ok(topics.length <= 30, `topic line is ${topics.length} chars: ${topics}`);
  assert.equal(topics, 'Trie, Hash Table');
});

test('a first topic that is longer than the budget is still shown alone', async () => {
  const long = 'A Very Long Imaginary Topic Name Which Is Long';
  assert.equal(await stateFor(problem('Hard', long)), `Hard \u00b7 ${long}`);
});

test('problems without tags show only the difficulty', async () => {
  assert.equal(await stateFor(problem('Easy')), 'Easy');
  assert.equal(await stateFor({ questionFrontendId: '1', title: 'Two Sum', difficulty: 'Easy' }), 'Easy');
});

test('show topics can be turned off', async () => {
  assert.equal(await stateFor(SKYLINE, { showTopics: false }), 'Hard');
});

test('toggling show topics updates the card immediately', async () => {
  const page = boot({ pathname: '/problems/x/' });
  await settle();
  await page.changeSettings({ showTopics: false });
  await settle();
  assert.equal(calls.at(-1)[1].state, 'Hard');
  await page.changeSettings({ showTopics: true });
  await settle();
  assert.equal(calls.at(-1)[1].state, 'Hard \u00b7 Heap/PQ, Segment Tree, BIT');
});

test('if LeetCode rejects the topic field the card still works without topics', async () => {
  const rejectTopics = (query) => (query.includes('topicTags') ? null : { ...SKYLINE, topicTags: undefined });
  const state = await stateFor(rejectTopics);
  assert.equal(state, 'Hard');
  assert.equal(calls[0][1].details, '218. The Skyline Problem');
});
