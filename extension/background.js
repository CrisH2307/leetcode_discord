// Service worker. The content script cannot call localhost directly (page CORS applies to it),
// so every request to the local server goes through here.
const SERVER = 'http://127.0.0.1:47391';
const DEFAULTS = { enabled: true, hideTitle: false };
const LAST_MAX_AGE_MS = 120_000;

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
    state: msg.difficulty,
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
