// @vitest-environment node

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { InstallationIdentityService } from '../../electron/services/installationIdentityService.js';

const cleanupDirs: string[] = [];

async function createTempUserDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'quickcut-installation-id-'));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('InstallationIdentityService', () => {
  it('creates and persists a stable installation id', async () => {
    const userDataDir = await createTempUserDataDir();
    const service = new InstallationIdentityService(userDataDir);

    const installationId = service.getInstallationId();

    expect(installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(service.getInstallationId()).toBe(installationId);

    const stored = JSON.parse(
      await readFile(path.join(userDataDir, 'installation-identity.json'), 'utf8'),
    ) as {
      installationId: string;
      version: number;
    };
    expect(stored.version).toBe(1);
    expect(stored.installationId).toBe(installationId);
  });

  it('reuses an existing stored installation id', async () => {
    const userDataDir = await createTempUserDataDir();
    const filePath = path.join(userDataDir, 'installation-identity.json');
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        installationId: 'existing-installation-id',
        createdAt: 1,
      }),
      'utf8',
    );

    const service = new InstallationIdentityService(userDataDir);

    expect(service.getInstallationId()).toBe('existing-installation-id');
  });
});
