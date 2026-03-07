import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

describe('release build contract', () => {
  it('uses checked-in icon assets and keeps the default dev Electron command sandboxed', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
    ) as {
      scripts?: Record<string, string>;
      build?: {
        mac?: { icon?: string };
      };
    };

    const devElectronScript = packageJson.scripts?.['dev:electron'] || '';
    const macIconPath = packageJson.build?.mac?.icon || '';

    expect(devElectronScript).not.toContain('--no-sandbox');
    expect(macIconPath).toBe('public/logo.png');
    expect(fs.existsSync(path.join(repoRoot, macIconPath))).toBe(true);
  });
});
