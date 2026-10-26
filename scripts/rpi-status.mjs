// Prints checkbox progress for the RPI docs so a session (or CI) can see where the project stands.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planFile = path.join(root, 'docs', 'rpi', 'plan.md');

if (!existsSync(planFile)) {
  console.error('docs/rpi/plan.md not found');
  process.exit(1);
}

const lines = readFileSync(planFile, 'utf8').split(/\r?\n/);
let section = 'Plan';
const sections = new Map();

for (const line of lines) {
  const heading = line.match(/^##\s+(.*)$/);
  if (heading) {
    section = heading[1].trim();
    continue;
  }
  const item = line.match(/^- \[( |x)\]\s+(.*)$/i);
  if (!item) continue;
  const entry = sections.get(section) ?? { done: 0, open: [] };
  if (item[1].toLowerCase() === 'x') entry.done += 1;
  else entry.open.push(item[2]);
  sections.set(section, entry);
}

let done = 0;
let total = 0;
for (const [name, { done: d, open }] of sections) {
  const t = d + open.length;
  done += d;
  total += t;
  console.log(`${name}: ${d}/${t}`);
  for (const o of open) console.log(`  [ ] ${o}`);
}
console.log(`\nTotal: ${done}/${total}`);
