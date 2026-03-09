// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_BACKEND_INSTALLATION_ID_HEADER,
  CLOUD_BACKEND_INSTALLATION_SECRET_HEADER,
  createFileBackedInstallationCredentialStore,
  createInstallationHeadersProvider,
  parseStoredInstallationCredentials,
  serializeStoredInstallationCredentials,
} from '../../electron/services/cloudBackendInstallationAuth.js';

const encryptionStub = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf-8'),
  decryptString: (value: Buffer) => value.toString('utf-8').replace(/^enc:/, ''),
};

const plaintextStub = {
  isEncryptionAvailable: () => false,
  encryptString: (value: string) => Buffer.from(value, 'utf-8'),
  decryptString: (value: Buffer) => value.toString('utf-8'),
};

describe('cloudBackendInstallationAuth', () => {
  it('serializes encrypted installation credentials when safe storage is available', () => {
    const serialized = serializeStoredInstallationCredentials(
      {
        installationId: 'install-1',
        installationSecret: 'secret-1',
        createdAt: 1,
      },
      encryptionStub,
    );

    expect(parseStoredInstallationCredentials(serialized, encryptionStub)).toEqual({
      installationId: 'install-1',
      installationSecret: 'secret-1',
      createdAt: 1,
    });
  });

  it('supports plaintext installation credential envelopes when safe storage is unavailable', () => {
    const serialized = serializeStoredInstallationCredentials(
      {
        installationId: 'install-1',
        installationSecret: 'secret-1',
        createdAt: 1,
      },
      plaintextStub,
    );

    expect(parseStoredInstallationCredentials(serialized, plaintextStub)).toEqual({
      installationId: 'install-1',
      installationSecret: 'secret-1',
      createdAt: 1,
    });
  });

  it('persists installation credentials through the file-backed store', async () => {
    let rawFile = '';
    const fsStub = {
      existsSync: vi.fn(() => Boolean(rawFile)),
      readFileSync: vi.fn(() => rawFile),
      writeFileSync: vi.fn((_filePath: string, data: string) => {
        rawFile = data;
      }),
      unlinkSync: vi.fn(() => {
        rawFile = '';
      }),
    };

    const store = createFileBackedInstallationCredentialStore(
      '/tmp/cloud-backend-installation.json',
      plaintextStub,
      fsStub,
    );

    await store.save({
      installationId: 'install-1',
      installationSecret: 'secret-1',
      createdAt: 1,
    });

    await expect(store.load()).resolves.toEqual({
      installationId: 'install-1',
      installationSecret: 'secret-1',
      createdAt: 1,
    });
  });

  it('registers once and reuses cached installation headers on later requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          installationId: 'install-1',
          installationSecret: 'secret-1',
          createdAt: 1,
        }),
    });

    const provider = createInstallationHeadersProvider(undefined, fetchMock);

    await expect(
      provider.getHeaders('https://example.execute-api.eu-central-1.amazonaws.com'),
    ).resolves.toEqual({
      [CLOUD_BACKEND_INSTALLATION_ID_HEADER]: 'install-1',
      [CLOUD_BACKEND_INSTALLATION_SECRET_HEADER]: 'secret-1',
    });

    await expect(
      provider.getHeaders('https://example.execute-api.eu-central-1.amazonaws.com'),
    ).resolves.toEqual({
      [CLOUD_BACKEND_INSTALLATION_ID_HEADER]: 'install-1',
      [CLOUD_BACKEND_INSTALLATION_SECRET_HEADER]: 'secret-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
