import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const allowlistPath = 'config/no-explicit-any-file-disable-allowlist.txt';

const allowlist = new Set(
  readFileSync(allowlistPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#')),
);

let matches = [];
try {
  const output = execSync(
    'rg -n "^/\\*\\s*eslint-disable\\s+@typescript-eslint/no-explicit-any\\s*\\*/" src electron test vite.config.ts eslint.config.js --no-heading',
    { encoding: 'utf8' },
  );
  matches = output
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(':')[0].trim());
} catch (error) {
  if (error.status === 1) {
    matches = [];
  } else {
    throw error;
  }
}

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
