import path from 'node:path';

export const CLOUD_BACKEND_INSTALLATION_ID_HEADER = 'x-quickcut-installation-id';
export const CLOUD_BACKEND_INSTALLATION_SECRET_HEADER = 'x-quickcut-installation-secret';

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface FileSystemLike {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: BufferEncoding): string;
  writeFileSync(
    filePath: string,
    data: string,
    options?: { encoding?: BufferEncoding; mode?: number },
  ): void;
  unlinkSync?(filePath: string): void;
}

interface StoredCredentialEnvelope {
  version: 1;
  encrypted: boolean;
  data: string;
}

interface InstallationRegistrationPayload extends Partial<CloudBackendInstallationCredentials> {
  error?: string;
}

export interface CloudBackendInstallationCredentials {
  installationId: string;
  installationSecret: string;
  createdAt: number;
}

export interface CloudBackendInstallationCredentialStore {
  load(): Promise<CloudBackendInstallationCredentials | null>;
  save(credentials: CloudBackendInstallationCredentials): Promise<void>;
  clear(): Promise<void>;
}

export interface CloudBackendAuthHeadersProvider {
  getHeaders(baseUrl: string): Promise<Record<string, string>>;
  clearCachedCredentials(): Promise<void>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function serializeStoredInstallationCredentials(
  credentials: CloudBackendInstallationCredentials,
  safeStorageLike: SafeStorageLike,
): string {
  const raw = JSON.stringify(credentials);
  if (safeStorageLike.isEncryptionAvailable()) {
    const envelope: StoredCredentialEnvelope = {
      version: 1,
      encrypted: true,
      data: safeStorageLike.encryptString(raw).toString('base64'),
    };
    return JSON.stringify(envelope);
  }

  const envelope: StoredCredentialEnvelope = {
    version: 1,
    encrypted: false,
    data: raw,
  };
  return JSON.stringify(envelope);
}

export function parseStoredInstallationCredentials(
  raw: string,
  safeStorageLike: SafeStorageLike,
): CloudBackendInstallationCredentials {
  const parsed = JSON.parse(raw) as StoredCredentialEnvelope | Record<string, unknown>;

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    parsed.version === 1 &&
    'encrypted' in parsed &&
    'data' in parsed &&
    typeof parsed.data === 'string'
  ) {
    if (parsed.encrypted) {
      if (!safeStorageLike.isEncryptionAvailable()) {
        throw new Error(
          'Stored installation credentials are encrypted but safeStorage is unavailable',
        );
      }
      return JSON.parse(
        safeStorageLike.decryptString(Buffer.from(parsed.data, 'base64')),
      ) as CloudBackendInstallationCredentials;
    }

    return JSON.parse(parsed.data) as CloudBackendInstallationCredentials;
  }

  return parsed as unknown as CloudBackendInstallationCredentials;
}

export function createMemoryInstallationCredentialStore(
  initialCredentials: CloudBackendInstallationCredentials | null = null,
): CloudBackendInstallationCredentialStore {
  let currentCredentials = initialCredentials;

  return {
    async load() {
      return currentCredentials;
    },
    async save(credentials) {
      currentCredentials = credentials;
    },
    async clear() {
      currentCredentials = null;
    },
  };
}

export function createFileBackedInstallationCredentialStore(
  filePath: string,
  safeStorageLike: SafeStorageLike,
  fsLike: FileSystemLike,
): CloudBackendInstallationCredentialStore {
  const normalizedPath = path.resolve(filePath);

  return {
    async load() {
      if (!fsLike.existsSync(normalizedPath)) {
        return null;
      }

      const raw = fsLike.readFileSync(normalizedPath, 'utf-8');
      return parseStoredInstallationCredentials(raw, safeStorageLike);
    },
    async save(credentials) {
      const serialized = serializeStoredInstallationCredentials(credentials, safeStorageLike);
      fsLike.writeFileSync(normalizedPath, serialized, { encoding: 'utf-8', mode: 0o600 });
    },
    async clear() {
      if (fsLike.existsSync(normalizedPath) && fsLike.unlinkSync) {
        fsLike.unlinkSync(normalizedPath);
      }
    },
  };
}

async function registerInstallation(
  baseUrl: string,
  fetchLike: FetchLike,
): Promise<CloudBackendInstallationCredentials> {
  const normalizedBaseUrl = `${baseUrl.replace(/\/+$/, '')}/`;
  const response = await fetchLike(new URL('auth/installations/register', normalizedBaseUrl), {
    method: 'POST',
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as InstallationRegistrationPayload) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && typeof payload['error'] === 'string'
        ? payload['error']
        : `Registration failed with status ${response.status}`;
    throw new Error(message);
  }

  if (
    !payload ||
    typeof payload.installationId !== 'string' ||
    typeof payload.installationSecret !== 'string'
  ) {
    throw new Error('Installation registration returned an invalid payload.');
  }

  return {
    installationId: payload.installationId,
    installationSecret: payload.installationSecret,
    createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : Date.now(),
  };
}

export function createInstallationHeadersProvider(
  credentialStore: CloudBackendInstallationCredentialStore = createMemoryInstallationCredentialStore(),
  fetchLike: FetchLike = (input, init) => globalThis.fetch(input, init),
): CloudBackendAuthHeadersProvider {
  let cachedCredentials: CloudBackendInstallationCredentials | null = null;
  let inFlightRegistration: Promise<CloudBackendInstallationCredentials> | null = null;

  async function loadOrRegister(baseUrl: string): Promise<CloudBackendInstallationCredentials> {
    if (cachedCredentials) {
      return cachedCredentials;
    }

    const storedCredentials = await credentialStore.load();
    if (storedCredentials) {
      cachedCredentials = storedCredentials;
      return storedCredentials;
    }

    if (!inFlightRegistration) {
      inFlightRegistration = registerInstallation(baseUrl, fetchLike)
        .then(async (credentials) => {
          await credentialStore.save(credentials);
          cachedCredentials = credentials;
          return credentials;
        })
        .finally(() => {
          inFlightRegistration = null;
        });
    }

    return inFlightRegistration;
  }

  return {
    async getHeaders(baseUrl: string) {
      const credentials = await loadOrRegister(baseUrl);
      return {
        [CLOUD_BACKEND_INSTALLATION_ID_HEADER]: credentials.installationId,
        [CLOUD_BACKEND_INSTALLATION_SECRET_HEADER]: credentials.installationSecret,
      };
    },
    async clearCachedCredentials() {
      cachedCredentials = null;
      inFlightRegistration = null;
      await credentialStore.clear();
    },
  };
}
