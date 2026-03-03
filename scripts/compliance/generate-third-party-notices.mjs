import { readFileSync, writeFileSync } from 'node:fs';

const lockfilePath = 'package-lock.json';
const outputPath = 'ThirdPartyNotices.json';

const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
const packages = lockfile.packages ?? {};

const notices = [];

for (const [pathKey, pkg] of Object.entries(packages)) {
  if (!pathKey || !pathKey.startsWith('node_modules/')) {
    continue;
  }

  const lastNodeModules = pathKey.lastIndexOf('node_modules/');
  const packagePath = pathKey.slice(lastNodeModules + 'node_modules/'.length);
  const parts = packagePath.split('/');
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];

  notices.push({
    name,
    version: pkg.version ?? 'UNKNOWN',
    license: pkg.license ?? 'UNKNOWN',
    resolved: pkg.resolved ?? null,
    integrity: pkg.integrity ?? null,
    dev: Boolean(pkg.dev),
  });
}

notices.sort((a, b) => {
  if (a.name !== b.name) return a.name.localeCompare(b.name);
  if (a.version !== b.version) return a.version.localeCompare(b.version);
  if (a.license !== b.license) return a.license.localeCompare(b.license);
  return String(a.dev).localeCompare(String(b.dev));
});

const output = {
  schemaVersion: 1,
  source: lockfilePath,
  packageCount: notices.length,
  notices,
};

writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outputPath} with ${notices.length} entries.`);
