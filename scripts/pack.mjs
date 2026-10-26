// Builds store-ready zips of the extension, one per browser family, into dist/.
//   Firefox: background.scripts only (Firefox ignores service workers) plus the gecko id.
//   Chromium: background.service_worker only, no Firefox-specific keys.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function variantManifest(manifest, target) {
  const copy = structuredClone(manifest);
  if (target === 'firefox') {
    copy.background = { scripts: manifest.background.scripts };
  } else if (target === 'chromium') {
    copy.background = { service_worker: manifest.background.service_worker };
    delete copy.browser_specific_settings;
  } else {
    throw new Error(`unknown target ${target}`);
  }
  return copy;
}

function pack() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const extDir = path.join(root, 'extension');
  const dist = path.join(root, 'dist');
  const manifest = JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));

  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  for (const target of ['firefox', 'chromium']) {
    const stage = path.join(dist, `.stage-${target}`);
    mkdirSync(stage, { recursive: true });
    for (const name of readdirSync(extDir)) {
      if (name !== 'manifest.json') cpSync(path.join(extDir, name), path.join(stage, name), { recursive: true });
    }
    writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(variantManifest(manifest, target), null, 2) + '\n');

    const zipFile = path.join(dist, `leetcode-rpc-${target}-${manifest.version}.zip`);
    execFileSync('zip', ['-qr', '-X', zipFile, '.'], { cwd: stage });
    rmSync(stage, { recursive: true, force: true });
    console.log(`Built ${path.relative(root, zipFile)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) pack();
