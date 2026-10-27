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

async function render() {
  const rows = [];

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
