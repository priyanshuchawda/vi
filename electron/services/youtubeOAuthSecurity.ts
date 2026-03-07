import { randomBytes } from 'node:crypto';

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredTokenEnvelope {
  version: 1;
  encrypted: boolean;
  data: string;
}

export function createOAuthState(): string {
  return randomBytes(16).toString('hex');
}

function normalizeUrlForRedirectComparison(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const port =
      parsed.port ||
      (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '');
    return `${parsed.protocol}//${parsed.hostname}${port ? `:${port}` : ''}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export function isExpectedOAuthRedirect(rawUrl: string, expectedRedirectUri: string): boolean {
  const normalizedActual = normalizeUrlForRedirectComparison(rawUrl);
  const normalizedExpected = normalizeUrlForRedirectComparison(expectedRedirectUri);
  return normalizedActual !== null && normalizedActual === normalizedExpected;
}

export function extractValidatedAuthCode(
  rawUrl: string,
  expectedRedirectUri: string,
  expectedState: string,
): string {
  if (!isExpectedOAuthRedirect(rawUrl, expectedRedirectUri)) {
    throw new Error('Unexpected OAuth redirect URI');
  }

  const parsed = new URL(rawUrl);
  const returnedState = parsed.searchParams.get('state');
  if (!returnedState || returnedState !== expectedState) {
    throw new Error('Invalid OAuth state');
  }

  const code = parsed.searchParams.get('code');
  if (!code) {
    throw new Error('Missing OAuth authorization code');
  }

  return code;
}

export function serializeStoredOAuthTokens(
  tokens: Record<string, unknown>,
  safeStorageLike: SafeStorageLike,
): string {
  const raw = JSON.stringify(tokens);
  if (safeStorageLike.isEncryptionAvailable()) {
    const envelope: StoredTokenEnvelope = {
      version: 1,
      encrypted: true,
      data: safeStorageLike.encryptString(raw).toString('base64'),
    };
    return JSON.stringify(envelope);
  }

  const envelope: StoredTokenEnvelope = {
    version: 1,
    encrypted: false,
    data: raw,
  };
  return JSON.stringify(envelope);
}

export function parseStoredOAuthTokens(
  raw: string,
  safeStorageLike: SafeStorageLike,
): Record<string, unknown> {
  const parsed = JSON.parse(raw) as StoredTokenEnvelope | Record<string, unknown>;

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
        throw new Error('Stored OAuth token is encrypted but safeStorage is unavailable');
      }
      return JSON.parse(
        safeStorageLike.decryptString(Buffer.from(parsed.data, 'base64')),
      ) as Record<string, unknown>;
    }

    return JSON.parse(parsed.data) as Record<string, unknown>;
  }

  return parsed as Record<string, unknown>;
}
