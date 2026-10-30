// Runs the presence server in the background and starts it at login, using a macOS LaunchAgent.
//
//   node scripts/service.mjs install     write the agent, start it now, start it at every login
//   node scripts/service.mjs uninstall   stop it and remove the agent
//   node scripts/service.mjs status      is it loaded, is the server answering, last log lines
//   node scripts/service.mjs print       show the generated plist without installing
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LABEL = 'com.leetcode-rpc.server';
export const HEALTH_URL = 'http://127.0.0.1:47391/health';

// macOS blocks background processes from reading these without Full Disk Access.
const PROTECTED = ['Downloads', 'Desktop', 'Documents', path.join('Library', 'Mobile Documents')];

export function isProtectedLocation(dir, home = os.homedir()) {
  const rel = path.relative(home, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return PROTECTED.some((p) => rel === p || rel.startsWith(p + path.sep));
}

const escapeXml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderPlist({ node, serverDir, logFile }) {
  const entry = path.join(serverDir, 'index.js');
  const searchPath = [path.dirname(node), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(node)}</string>
    <string>${escapeXml(entry)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(serverDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(searchPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logFile)}</string>
</dict>
</plist>
`;
}

function paths() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return {
    root,
    serverDir: path.join(root, 'server'),
    plistFile: path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`),
    logFile: path.join(os.homedir(), 'Library', 'Logs', 'leetcode-rpc.log'),
    domain: `gui/${process.getuid()}`,
  };
}

function launchctl(args) {
  try {
    return { ok: true, out: execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() };
  }
}

async function probe() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
    return await res.json();
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireMac() {
  if (process.platform !== 'darwin') fail('The background service uses launchd, so it only works on macOS.');
}

async function install(force) {
  requireMac();
  const p = paths();

  if (isProtectedLocation(p.root) && !force) {
    fail(
      `This project is in a folder macOS protects from background processes:\n  ${p.root}\n\n` +
        `Move it first, then run the install again:\n` +
        `  mv "${p.root}" "$HOME/leetcode-rpc"\n` +
        `  cd "$HOME/leetcode-rpc" && npm run service:install\n\n` +
        `(--force skips this check, but the service will probably fail with "Operation not permitted".)`,
    );
  }
  if (!existsSync(path.join(p.serverDir, 'node_modules'))) fail('Dependencies are missing. Run: npm run setup');

  const envFile = path.join(p.serverDir, '.env');
  const envText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  if (!/^\s*DISCORD_CLIENT_ID\s*=\s*\S+/m.test(envText)) {
    console.warn('Warning: server/.env has no DISCORD_CLIENT_ID, so the service will run in dry-run mode.');
  }

  const loaded = launchctl(['print', `${p.domain}/${LABEL}`]).ok;
  if (!loaded && (await probe())) {
    fail('A server is already answering on port 47391 (probably `npm start` in a terminal). Stop it with Ctrl+C, then run this again.');
  }

  mkdirSync(path.dirname(p.plistFile), { recursive: true });
  mkdirSync(path.dirname(p.logFile), { recursive: true });
  writeFileSync(p.plistFile, renderPlist({ node: process.execPath, serverDir: p.serverDir, logFile: p.logFile }));

  launchctl(['bootout', `${p.domain}/${LABEL}`]); // fine if it was not loaded
  // bootout returns before launchd has finished unloading. Bootstrapping straight away can fail
  // with "Input/output error" and leave nothing running, so wait for the old job to be gone first.
  for (let i = 0; i < 40 && launchctl(['print', `${p.domain}/${LABEL}`]).ok; i += 1) await sleep(250);
  let boot = launchctl(['bootstrap', p.domain, p.plistFile]);
  for (let attempt = 0; attempt < 5 && !boot.ok; attempt += 1) {
    await sleep(1000);
    boot = launchctl(['bootstrap', p.domain, p.plistFile]);
  }
  if (!boot.ok) fail(`launchctl could not load the service:\n${boot.out}`);
  launchctl(['kickstart', '-k', `${p.domain}/${LABEL}`]);

  await sleep(1500);
  const health = await probe();
  console.log(`Installed ${p.plistFile}`);
  console.log(`Logs: ${p.logFile}`);
  console.log(
    health
      ? `Server is running (Discord: ${health.discord}). It will start automatically at every login.`
      : 'The service is loaded but the server is not answering yet. Run: npm run service:status',
  );
}

function uninstall() {
  requireMac();
  const p = paths();
  launchctl(['bootout', `${p.domain}/${LABEL}`]);
  if (existsSync(p.plistFile)) unlinkSync(p.plistFile);
  console.log('Service stopped and removed. Run `npm start` if you want to run the server by hand again.');
}

async function status() {
  requireMac();
  const p = paths();
  const info = launchctl(['print', `${p.domain}/${LABEL}`]);
  if (!info.ok) console.log('Service: not installed (npm run service:install)');
  else {
    const lines = info.out.split('\n').filter((l) => /^\s*(state|pid|last exit code|runs) =/.test(l));
    console.log(`Service: installed\n${lines.map((l) => `  ${l.trim()}`).join('\n')}`);
  }
  const health = await probe();
  console.log(
    health
      ? `Server: answering (Discord: ${health.discord}, last presence: ${health.lastUpdate ?? 'none yet'})`
      : 'Server: not answering on 127.0.0.1:47391',
  );
  if (existsSync(p.logFile)) {
    const tail = readFileSync(p.logFile, 'utf8').trimEnd().split('\n').slice(-8);
    console.log(`\nLast log lines (${p.logFile}):\n${tail.join('\n')}`);
  }
}

const command = process.argv[2];
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const force = process.argv.includes('--force');
  if (command === 'install') await install(force);
  else if (command === 'uninstall') uninstall();
  else if (command === 'status') await status();
  else if (command === 'print') {
    const p = paths();
    process.stdout.write(renderPlist({ node: process.execPath, serverDir: p.serverDir, logFile: p.logFile }));
  } else fail('Usage: node scripts/service.mjs <install|uninstall|status|print> [--force]');
}
