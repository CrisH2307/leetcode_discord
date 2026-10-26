import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { LABEL, isProtectedLocation, renderPlist } from '../scripts/service.mjs';
import { variantManifest } from '../scripts/pack.mjs';

const HOME = '/Users/someone';

test('folders macOS protects from background processes are detected', () => {
  for (const dir of ['Downloads/leetcode-rpc', 'Desktop/x', 'Documents/a/b', 'Library/Mobile Documents/com~apple~CloudDocs/x', 'Downloads']) {
    assert.equal(isProtectedLocation(path.join(HOME, dir), HOME), true, dir);
  }
  for (const dir of ['leetcode-rpc', 'Developer/leetcode-rpc', 'DownloadsExtra/x']) {
    assert.equal(isProtectedLocation(path.join(HOME, dir), HOME), false, dir);
  }
  assert.equal(isProtectedLocation('/opt/leetcode-rpc', HOME), false);
});

test('plist runs the server with the given node, at login, and restarts it', () => {
  const plist = renderPlist({ node: '/opt/node/bin/node', serverDir: '/Users/someone/leetcode-rpc/server', logFile: '/Users/someone/Library/Logs/leetcode-rpc.log' });
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<string>\/opt\/node\/bin\/node<\/string>\s*<string>\/Users\/someone\/leetcode-rpc\/server\/index\.js<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/someone\/Library\/Logs\/leetcode-rpc\.log<\/string>/);
});

test('plist escapes special characters in paths', () => {
  const plist = renderPlist({ node: '/n/node', serverDir: '/Users/a&b/<x>/server', logFile: '/tmp/log' });
  assert.ok(plist.includes('/Users/a&amp;b/&lt;x&gt;/server/index.js'));
  assert.ok(!plist.includes('a&b'));
});

const base = {
  manifest_version: 3,
  name: 'x',
  version: '1.0.0',
  background: { service_worker: 'background.js', scripts: ['background.js'] },
  browser_specific_settings: { gecko: { id: 'x@y' } },
};

test('Firefox variant keeps only background.scripts and the gecko id', () => {
  const m = variantManifest(base, 'firefox');
  assert.deepEqual(m.background, { scripts: ['background.js'] });
  assert.equal(m.browser_specific_settings.gecko.id, 'x@y');
});

test('Chromium variant keeps only the service worker and drops gecko settings', () => {
  const m = variantManifest(base, 'chromium');
  assert.deepEqual(m.background, { service_worker: 'background.js' });
  assert.equal(m.browser_specific_settings, undefined);
});

test('variants do not modify the source manifest', () => {
  variantManifest(base, 'firefox');
  assert.deepEqual(Object.keys(base.background).sort(), ['scripts', 'service_worker']);
});
