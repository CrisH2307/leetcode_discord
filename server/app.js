import http from 'node:http';

const MAX_BODY = 4096;
const PROBLEM_URL = /^https:\/\/leetcode\.com\/problems\/[a-z0-9-]+\/?$/;
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\//;

function clip(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, 128);
  return text.length >= 2 ? text : null;
}

/** Validates the extension payload. Returns a clean object or null. */
export function parsePresence(body) {
  if (!body || typeof body !== 'object') return null;
  const details = clip(body.details);
  const startedAt = Number(body.startedAt);
  if (!details) return null;
  if (!Number.isFinite(startedAt) || startedAt < 1e12 || startedAt > Date.now() + 60_000) return null;

  const parsed = { details, startedAt: Math.floor(startedAt) };
  if (body.state !== undefined) {
    const state = clip(body.state);
    if (!state) return null;
    parsed.state = state;
  }
  if (typeof body.url === 'string' && PROBLEM_URL.test(body.url)) parsed.url = body.url;
  return parsed;
}

function toActivity(p, assets) {
  const activity = { details: p.details, startTimestamp: p.startedAt, instance: false };
  if (p.state) activity.state = p.state;
  if (assets.largeImageKey) {
    activity.largeImageKey = assets.largeImageKey;
    activity.largeImageText = assets.largeImageText || 'LeetCode';
  }
  if (assets.showButton && p.url) activity.buttons = [{ label: 'Open problem', url: p.url }];
  return activity;
}

/**
 * HTTP API used by the browser extension. Only accepts requests addressed to
 * localhost and, if an Origin is sent, only from browser extensions.
 */
export function createApp({ presence, ttlMs = 90_000, assets = {}, log = () => {} }) {
  let active = false;
  let lastSeen = 0;
  let lastKey = '';
  let lastUpdate = null;

  async function clear() {
    if (!active) return;
    active = false;
    lastKey = '';
    log('Presence cleared');
    await presence.clear();
  }

  const sweep = setInterval(() => {
    if (active && Date.now() - lastSeen > ttlMs) {
      log('No heartbeat, clearing presence');
      clear();
    }
  }, Math.min(10_000, Math.max(10, Math.floor(ttlMs / 2))));
  sweep.unref();

  function send(res, status, payload) {
    const text = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new Error('too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
        } catch {
          reject(new Error('bad json'));
        }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const hostOk = req.headers.host === `127.0.0.1:${port}` || req.headers.host === `localhost:${port}`;
    const origin = req.headers.origin;
    const originOk = origin === undefined || EXTENSION_ORIGIN.test(origin);
    if (!hostOk || !originOk) {
      log(`Rejected ${req.method} ${req.url} (host=${req.headers.host}, origin=${origin ?? 'none'})`);
      return send(res, 403, { error: 'forbidden' });
    }

    // Browser extensions (Chrome, Firefox, Safari) may need CORS headers when host permission
    // for localhost has not been granted. Only extension origins ever get here.
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const { pathname } = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && pathname === '/health') {
      return send(res, 200, { ok: true, discord: presence.status(), active, lastUpdate });
    }

    if (req.method === 'POST' && pathname === '/clear') {
      await clear();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/presence') {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        log(`Rejected presence: ${err.message}`);
        return send(res, 400, { error: err.message });
      }
      const parsed = parsePresence(body);
      if (!parsed) {
        log(`Rejected presence: invalid payload ${JSON.stringify(body)?.slice(0, 200)}`);
        return send(res, 400, { error: 'invalid presence' });
      }

      lastSeen = Date.now();
      const key = JSON.stringify(parsed);
      if (!active || key !== lastKey) {
        active = true;
        lastKey = key;
        lastUpdate = new Date().toISOString();
        log(`Presence: ${parsed.details}${parsed.state ? ` | ${parsed.state}` : ''}`);
        await presence.set(toActivity(parsed, assets));
      }
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'not found' });
  });

  server.on('close', () => clearInterval(sweep));
  return server;
}
