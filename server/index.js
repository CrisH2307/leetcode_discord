import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createPresence } from './discord.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnv(path.join(here, '.env'));

const log = (message) => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);

const port = Number(process.env.PORT ?? 47391);
const clientId = process.env.DISCORD_CLIENT_ID ?? '';
const dryRun = process.env.DRY_RUN === '1' || !clientId;

if (!clientId) {
  log('DISCORD_CLIENT_ID is not set, running in dry-run mode (nothing is sent to Discord)');
}

const presence = createPresence({ clientId, dryRun, log });
const app = createApp({
  presence,
  ttlMs: Number(process.env.TTL_MS ?? 90_000),
  log,
  assets: {
    largeImageKey: process.env.LARGE_IMAGE_KEY ?? 'leetcode',
    largeImageText: process.env.LARGE_IMAGE_TEXT ?? 'LeetCode',
    showButton: process.env.SHOW_BUTTON === '1',
  },
});

app.listen(port, '127.0.0.1', () => {
  log(`Listening on http://127.0.0.1:${port}${dryRun ? ' (dry-run)' : ''}`);
  presence.connect();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await presence.clear();
    process.exit(0);
  });
}
