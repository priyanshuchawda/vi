import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const allowlistPath = 'config/no-explicit-any-file-disable-allowlist.txt';

const allowlist = new Set(
  readFileSync(allowlistPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#')),
);

const roots = ['src', 'electron', 'test', 'vite.config.ts', 'eslint.config.js'];
const fileLevelDisablePattern =
  /^\/\*\s*eslint-disable\s+@typescript-eslint\/no-explicit-any\s*\*\//m;

/** @type {string[]} */
const filesToCheck = [];

function collectFiles(path) {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path)) {
      collectFiles(join(path, entry));
    }
    return;
  }

  if (!/\.(ts|tsx|js|jsx)$/.test(path)) {
    return;
  }

  filesToCheck.push(path);
}

for (const root of roots) {
  collectFiles(root);
}

const matches = filesToCheck
  .filter((file) => fileLevelDisablePattern.test(readFileSync(file, 'utf8')))
  .map((file) => relative(process.cwd(), file).replaceAll('\\', '/'));

const current = new Set(matches);
const unexpected = [...current].filter((file) => !allowlist.has(file)).sort();
const stale = [...allowlist].filter((file) => !current.has(file)).sort();

if (unexpected.length > 0) {
  console.error('Found new file-level no-explicit-any disables:');
  for (const file of unexpected) {
    console.error(`- ${file}`);
  }
  console.error(
    `\nIf this is intentional, update ${allowlistPath}. Prefer removing file-level disables instead.`,
  );
  process.exit(1);
}

if (stale.length > 0) {
  console.warn('Allowlist contains stale entries (safe to remove):');
  for (const file of stale) {
    console.warn(`- ${file}`);
  }
}

console.log('No new file-level no-explicit-any disables detected.');
