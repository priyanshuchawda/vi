import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

describe('preload build contract', () => {
  it('ships the compiled TypeScript preload as the single runtime preload', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
    ) as {
      scripts?: Record<string, string>;
    };
    const mainSource = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf-8');

    expect(packageJson.scripts?.['build:electron']).toBe('tsc -p tsconfig.electron.json');
    expect(mainSource).toContain("preload: path.join(__dirname, 'preload.js')");
    expect(fs.existsSync(path.join(repoRoot, 'electron/preload.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'electron/preload.cjs'))).toBe(false);
  });
});
