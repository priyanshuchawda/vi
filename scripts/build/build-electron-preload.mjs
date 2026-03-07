import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const watchMode = process.argv.includes('--watch');

const sharedOptions = {
  entryPoints: [path.join(repoRoot, 'electron/preload.ts')],
  outfile: path.join(repoRoot, 'dist-electron/preload.js'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['electron'],
  logLevel: 'info',
  sourcemap: false,
  tsconfig: path.join(repoRoot, 'tsconfig.electron.json'),
};

if (watchMode) {
  const buildContext = await context(sharedOptions);
  await buildContext.watch();
  console.log('[build:electron:preload] watching electron/preload.ts');
  await new Promise(() => {});
} else {
  await build(sharedOptions);
}
