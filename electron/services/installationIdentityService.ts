import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

interface StoredInstallationIdentity {
  version: 1;
  installationId: string;
  createdAt: number;
}

interface FileSystemLike {
  existsSync(filePath: string): boolean;
  mkdirSync(dirPath: string, options?: { recursive?: boolean }): void;
  readFileSync(filePath: string, encoding: BufferEncoding): string;
  writeFileSync(filePath: string, data: string, encoding: BufferEncoding): void;
}

function isStoredInstallationIdentity(value: unknown): value is StoredInstallationIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 1 &&
    'installationId' in value &&
    typeof value.installationId === 'string' &&
    value.installationId.trim().length > 0 &&
    'createdAt' in value &&
    typeof value.createdAt === 'number'
  );
}

export class InstallationIdentityService {
  private readonly filePath: string;
  private readonly fsLike: FileSystemLike;
  private cachedIdentity: StoredInstallationIdentity | null = null;

  constructor(userDataPath: string, fsLike: FileSystemLike = fs) {
    this.filePath = path.join(userDataPath, 'installation-identity.json');
    this.fsLike = fsLike;
  }

  getInstallationId(): string {
    if (this.cachedIdentity) {
      return this.cachedIdentity.installationId;
    }

    const existingIdentity = this.readStoredIdentity();
    if (existingIdentity) {
      this.cachedIdentity = existingIdentity;
      return existingIdentity.installationId;
    }

    const createdIdentity: StoredInstallationIdentity = {
      version: 1,
      installationId: randomUUID(),
      createdAt: Date.now(),
    };

    this.persistIdentity(createdIdentity);
    this.cachedIdentity = createdIdentity;
    return createdIdentity.installationId;
  }

  private readStoredIdentity(): StoredInstallationIdentity | null {
    if (!this.fsLike.existsSync(this.filePath)) {
      return null;
    }

    try {
      const raw = this.fsLike.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return isStoredInstallationIdentity(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private persistIdentity(identity: StoredInstallationIdentity): void {
    this.fsLike.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.fsLike.writeFileSync(this.filePath, JSON.stringify(identity, null, 2), 'utf8');
  }
}
