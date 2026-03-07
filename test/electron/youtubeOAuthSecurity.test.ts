import { describe, expect, it } from 'vitest';
import {
  createOAuthState,
  extractValidatedAuthCode,
  isExpectedOAuthRedirect,
  parseStoredOAuthTokens,
  serializeStoredOAuthTokens,
} from '../../electron/services/youtubeOAuthSecurity';

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

describe('youtube OAuth security helpers', () => {
  it('creates high-entropy state values', () => {
    const one = createOAuthState();
    const two = createOAuthState();

    expect(one).toMatch(/^[a-f0-9]{32}$/);
    expect(two).toMatch(/^[a-f0-9]{32}$/);
    expect(one).not.toBe(two);
  });

  it('matches expected redirect URIs by origin and path', () => {
    expect(
      isExpectedOAuthRedirect(
        'http://localhost:3000/callback?code=abc&state=123',
        'http://localhost:3000/callback',
      ),
    ).toBe(true);
    expect(
      isExpectedOAuthRedirect(
        'http://localhost:3000/other?code=abc&state=123',
        'http://localhost:3000/callback',
      ),
    ).toBe(false);
  });

  it('accepts only matching redirect URI and state when extracting auth codes', () => {
    expect(
      extractValidatedAuthCode(
        'http://localhost:3000/callback?code=abc123&state=expected',
        'http://localhost:3000/callback',
        'expected',
      ),
    ).toBe('abc123');

    expect(() =>
      extractValidatedAuthCode(
        'http://localhost:3000/callback?code=abc123&state=wrong',
        'http://localhost:3000/callback',
        'expected',
      ),
    ).toThrow('Invalid OAuth state');
  });

  it('serializes encrypted token envelopes when safe storage is available', () => {
    const serialized = serializeStoredOAuthTokens({ access_token: 'token' }, encryptionStub);
    const parsed = parseStoredOAuthTokens(serialized, encryptionStub);

    expect(parsed.access_token).toBe('token');
  });

  it('supports plaintext envelopes when encryption is unavailable', () => {
    const serialized = serializeStoredOAuthTokens({ refresh_token: 'token' }, plaintextStub);
    const parsed = parseStoredOAuthTokens(serialized, plaintextStub);

    expect(parsed.refresh_token).toBe('token');
  });
});
