// Service worker. The content script cannot call localhost directly (page CORS applies to it),
// so every request to the local server goes through here.
const SERVER = 'http://127.0.0.1:47391';
const DEFAULTS = { enabled: true, hideTitle: false, showTopics: true };
const LAST_MAX_AGE_MS = 120_000;

// Topics go on the second line next to the difficulty ("Hard · Heap/PQ, Segment Tree").
// Discord cuts long lines with "...", so the topic list is built within a character budget
// instead of listing every tag a problem has.
const MAX_TOPICS = 3;
const TOPICS_BUDGET = 30; // characters for the topic names, "Hard · " not included
const SEPARATOR = ' · ';

// Core technique or data structure tags. When a problem has several tags, these are shown first.
const PRIORITY_TOPICS = [
  'Heap (Priority Queue)', 'Segment Tree', 'Trie', 'Union Find', 'Monotonic Stack', 'Monotonic Queue',
  'Dynamic Programming', 'Backtracking', 'Sliding Window', 'Two Pointers', 'Binary Search',
  'Topological Sort', 'Graph', 'Greedy',
];

// Long LeetCode tag names -> short forms. Add your own here.
const SHORT_TOPIC = {
  'Heap (Priority Queue)': 'Heap/PQ',
  'Dynamic Programming': 'DP',
  'Divide and Conquer': 'Divide & Conquer',
  'Binary Indexed Tree': 'BIT',
  'Binary Search Tree': 'BST',
  'Depth-First Search': 'DFS',
  'Breadth-First Search': 'BFS',
  'Doubly-Linked List': 'Linked List',
  'Bit Manipulation': 'Bit Manip',
  'Topological Sort': 'Topo Sort',
  'Monotonic Stack': 'Mono Stack',
  'Monotonic Queue': 'Mono Queue',
};

// Tags that describe almost every problem. They only fill the line when nothing more specific exists.
const GENERIC_TOPICS = new Set([
  'Array', 'String', 'Math', 'Matrix', 'Simulation', 'Enumeration', 'Counting', 'Sorting',
]);

function pickTopics(topics) {
  if (!Array.isArray(topics)) return [];
  const core = PRIORITY_TOPICS.filter((t) => topics.includes(t));
  const specific = topics.filter((t) => !core.includes(t) && !GENERIC_TOPICS.has(t));
  const generic = topics.filter((t) => GENERIC_TOPICS.has(t));
  const ranked = [...core, ...specific, ...generic].map((t) => SHORT_TOPIC[t] ?? t);

  const picked = [];
  let length = 0;
  for (const name of ranked) {
    if (picked.length === MAX_TOPICS) break;
    const next = length + (picked.length ? 2 : 0) + name.length; // ", " between names
    if (picked.length > 0 && next > TOPICS_BUDGET) continue; // try a shorter one further down
    picked.push(name);
    length = next;
  }
  return picked;
}

function composeState(msg, settings) {
  const topics = settings.showTopics ? pickTopics(msg.topics) : [];
  if (!topics.length) return msg.difficulty;
  return `${msg.difficulty}${SEPARATOR}${topics.join(', ')}`;
}

// storage.session is missing in some Chromium-based browsers; fall back to local storage.
const scratch = chrome.storage.session ?? chrome.storage.local;

async function post(path, body) {
  const res = await fetch(SERVER + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`server answered ${res.status}`);
}

// The popup shows this so a silent failure is visible.
async function recordStatus(ok, detail = '') {
  try {
    await chrome.storage.local.set({ status: { ok, detail: String(detail), at: Date.now() } });
  } catch {
    // status is best effort
  }
}

function compose(msg, settings) {
  const payload = {
    details: settings.hideTitle ? 'Solving a problem' : `${msg.number}. ${msg.title}`,
    state: composeState(msg, settings),
    startedAt: msg.startedAt,
  };
  if (!settings.hideTitle) payload.url = msg.url;
  return payload;
}

async function publish(msg) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.enabled) return post('/clear');
  return post('/presence', compose(msg, settings));
}

async function handle(msg) {
  try {
    if (msg.type === 'clear') {
      await scratch.remove('last');
      await post('/clear');
    } else if (msg.type === 'presence') {
      await scratch.set({ last: { msg, at: Date.now() } });
      await publish(msg);
    } else {
      return;
    }
    await recordStatus(true, msg.type);
  } catch (err) {
    console.warn('[leetcode-rpc] could not reach the local server:', err.message);
    await recordStatus(false, err.message);
    throw err;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

// Apply popup changes right away instead of waiting for the next heartbeat.
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== 'sync') return;
  const { last } = await scratch.get('last');
  try {
    if (last && Date.now() - last.at < LAST_MAX_AGE_MS) await publish(last.msg);
    else await post('/clear');
  } catch {
    // server not running; the next heartbeat will retry
  }
});
