import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

describe('preload build contract', () => {
  it('ships a bundled preload script as the single runtime preload', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
    ) as {
      scripts?: Record<string, string>;
    };
    const electronTsconfig = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'tsconfig.electron.json'), 'utf-8'),
    ) as {
      exclude?: string[];
    };
    const mainSource = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf-8');

    expect(packageJson.scripts?.['build:electron']).toBe(
      'tsc -p tsconfig.electron.json && node scripts/build/build-electron-preload.mjs',
    );
    expect(packageJson.scripts?.['dev:electron']).toContain(
      'node scripts/build/build-electron-preload.mjs --watch',
    );
    expect(mainSource).toContain("preload: path.join(__dirname, 'preload.js')");
    expect(electronTsconfig.exclude).toContain('electron/preload.ts');
    expect(fs.existsSync(path.join(repoRoot, 'electron/preload.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'scripts/build/build-electron-preload.mjs'))).toBe(
      true,
    );
  });
});
