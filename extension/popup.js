const SERVER = 'http://127.0.0.1:47391';
const DEFAULTS = { enabled: true, hideTitle: false, showTopics: true };

const enabled = document.getElementById('enabled');
const hideTitle = document.getElementById('hideTitle');
const showTopics = document.getElementById('showTopics');
const status = document.getElementById('status');

function line(label, value) {
  const row = document.createElement('div');
  row.append(`${label}: `);
  const strong = document.createElement('b');
  strong.textContent = value;
  row.append(strong);
  return row;
}

// Firefox (Manifest V3) does not grant host permissions at install. Without them the content
// script is never injected into leetcode.com, so nothing ever reaches the server.
const ORIGINS = ['https://leetcode.com/*', 'http://127.0.0.1:47391/*'];

async function hasAccess() {
  try {
    return await chrome.permissions.contains({ origins: ORIGINS });
  } catch {
    return true; // API missing: assume the browser granted them at install
  }
}

function grantButton() {
  const button = document.createElement('button');
  button.textContent = 'Grant access';
  button.addEventListener('click', async () => {
    try {
      await chrome.permissions.request({ origins: ORIGINS });
    } catch (err) {
      console.warn('[leetcode-rpc] permission request failed:', err?.message ?? err);
    }
    await render();
  });
  return button;
}

async function render() {
  const rows = [];

  rows.push(line('Version', chrome.runtime.getManifest().version));
  const granted = await hasAccess();
  rows.push(line('Site access', granted ? 'granted' : 'NOT granted, the extension cannot see LeetCode'));
  if (!granted) rows.push(grantButton());

  try {
    const res = await fetch(`${SERVER}/health`);
    const health = await res.json();
    rows.push(line('Server', 'running'));
    rows.push(line('Discord', health.discord === 'dry-run' ? 'dry-run (nothing sent)' : health.discord));
    rows.push(line('Server got a presence', health.lastUpdate ? new Date(health.lastUpdate).toLocaleTimeString() : 'never'));
  } catch {
    rows.push(line('Server', 'not running (npm start in server/)'));
  }

  const { status: last } = await chrome.storage.local.get('status');
  if (!last) {
    rows.push(line('Extension', 'no update yet, open a problem page and refresh it'));
  } else {
    const when = new Date(last.at).toLocaleTimeString();
    rows.push(line('Last extension update', last.ok ? `ok at ${when}` : `failed at ${when}: ${last.detail}`));
  }

  status.replaceChildren(...rows);
}

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  enabled.checked = settings.enabled;
  hideTitle.checked = settings.hideTitle;
  showTopics.checked = settings.showTopics;
  showTopics.addEventListener('change', () => chrome.storage.sync.set({ showTopics: showTopics.checked }));
  enabled.addEventListener('change', () => chrome.storage.sync.set({ enabled: enabled.checked }));
  hideTitle.addEventListener('change', () => chrome.storage.sync.set({ hideTitle: hideTitle.checked }));
  await render();
}

init();
