import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL('../../', import.meta.url).pathname);
const buildDir = path.join(repoRoot, '.aws', 'cloud-backend');
const bundlePath = path.join(buildDir, 'storageApiHandler.js');
const zipPath = path.join(buildDir, 'storage-api.zip');

await fs.mkdir(buildDir, { recursive: true });
await fs.rm(bundlePath, { force: true });
await fs.rm(zipPath, { force: true });

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'backend', 'lambda', 'storageApiHandler.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
});

await execFileAsync('zip', ['-j', zipPath, bundlePath], {
  cwd: buildDir,
});

console.log(zipPath);
