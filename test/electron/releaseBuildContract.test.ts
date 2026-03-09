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

  it('packages production desktop artifacts for Windows and Ubuntu-compatible Linux', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
    ) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      build?: {
        artifactName?: string;
        asar?: boolean;
        asarUnpack?: string[];
        files?: string[];
        win?: {
          target?: Array<{ target?: string; arch?: string[] }>;
          extraResources?: Array<{ from?: string; to?: string }>;
        };
        linux?: {
          target?: Array<{ target?: string; arch?: string[] }>;
          executableName?: string;
          extraResources?: Array<{ from?: string; to?: string }>;
        };
        nsis?: {
          oneClick?: boolean;
          allowToChangeInstallationDirectory?: boolean;
          createDesktopShortcut?: boolean;
        };
      };
    };

    const distWinScript = packageJson.scripts?.['dist:win'] || '';
    const distLinuxScript = packageJson.scripts?.['dist:linux'] || '';
    const distCheckAssetsScript = packageJson.scripts?.['dist:check:assets'] || '';
    const artifactName = packageJson.build?.artifactName;
    const asar = packageJson.build?.asar;
    const asarUnpack = packageJson.build?.asarUnpack || [];
    const winTargets = packageJson.build?.win?.target || [];
    const linuxTargets = packageJson.build?.linux?.target || [];
    const files = packageJson.build?.files || [];
    const winExtraResources = packageJson.build?.win?.extraResources || [];
    const linuxExtraResources = packageJson.build?.linux?.extraResources || [];
    const nsis = packageJson.build?.nsis;

    expect(packageJson.dependencies?.['electron-updater']).toBeTruthy();
    expect(packageJson.devDependencies?.['electron-updater']).toBeUndefined();
    expect(distCheckAssetsScript).toBe('node scripts/build/check-release-assets.mjs');
    expect(distWinScript).toContain('npm run dist:check:assets -- win');
    expect(distWinScript).toContain('--win nsis --x64 --publish never');
    expect(distLinuxScript).toContain('npm run dist:check:assets -- linux');
    expect(distLinuxScript).toContain('--linux AppImage deb --x64 --publish never');
    expect(artifactName).toBe('${productName}-${version}-${os}-${arch}.${ext}');
    expect(asar).toBe(true);
    expect(asarUnpack).toEqual(
      expect.arrayContaining(['**/*.node', 'node_modules/koffi/**/*', 'node_modules/vosk-koffi/**/*']),
    );
    expect(winTargets).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(linuxTargets).toEqual([
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ]);
    expect(packageJson.build?.linux?.executableName).toBe('quickcut');
    expect(nsis).toMatchObject({
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
    });
    expect(files).toEqual(expect.arrayContaining(['dist-electron/**/*', 'dist/**/*']));
    expect(winExtraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'resources/ffmpeg-win', to: 'resources/ffmpeg-win' }),
        expect.objectContaining({ from: 'resources/README.md', to: 'resources/README.md' }),
      ]),
    );
    expect(linuxExtraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'resources/ffmpeg-linux', to: 'resources/ffmpeg-linux' }),
        expect.objectContaining({ from: 'resources/README.md', to: 'resources/README.md' }),
      ]),
    );
  });
});
