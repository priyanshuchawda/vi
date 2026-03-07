import { describe, expect, it } from 'vitest';
import {
  getDefaultYouTubeOAuthCredentialsPath,
  getYouTubeOAuthCredentialsFromEnv,
  loadYouTubeOAuthCredentials,
} from '../../electron/services/youtubeOAuthConfig';

describe('youtube OAuth config', () => {
  it('builds credentials from env when all required values are set', () => {
    const credentials = getYouTubeOAuthCredentialsFromEnv({
      YOUTUBE_OAUTH_CLIENT_ID: 'client-id',
      YOUTUBE_OAUTH_CLIENT_SECRET: 'client-secret',
      YOUTUBE_OAUTH_REDIRECT_URI: 'http://localhost:3000/callback',
    });

    expect(credentials).toEqual({
      installed: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        redirect_uris: ['http://localhost:3000/callback'],
      },
    });
  });

  it('rejects partial env configuration', () => {
    expect(() =>
      getYouTubeOAuthCredentialsFromEnv({
        YOUTUBE_OAUTH_CLIENT_ID: 'client-id',
      }),
    ).toThrow('Incomplete YouTube OAuth environment configuration');
  });

  it('loads credentials from a custom configured path when env vars are absent', () => {
    const filePath = '/tmp/youtube-oauth.json';
    const credentials = loadYouTubeOAuthCredentials(
      {
        YOUTUBE_OAUTH_CREDENTIALS_PATH: filePath,
      },
      {
        existsSync: (candidate) => candidate === filePath,
        readFileSync: () =>
          JSON.stringify({
            installed: {
              client_id: 'file-client-id',
              client_secret: 'file-client-secret',
              redirect_uris: ['http://localhost:3000/callback'],
            },
          }),
      },
    );

    expect(credentials.installed.client_id).toBe('file-client-id');
  });

  it('falls back to the legacy credentials file path when no explicit config is set', () => {
    const cwd = '/workspace/app';
    const defaultPath = getDefaultYouTubeOAuthCredentialsPath(cwd);
    const credentials = loadYouTubeOAuthCredentials(
      {},
      {
        existsSync: (candidate) => candidate === defaultPath,
        readFileSync: () =>
          JSON.stringify({
            installed: {
              client_id: 'legacy-client-id',
              client_secret: 'legacy-client-secret',
              redirect_uris: ['http://localhost:3000/callback'],
            },
          }),
      },
      cwd,
    );

    expect(credentials.installed.client_id).toBe('legacy-client-id');
  });

  it('throws a clear error when no env vars or credentials file are available', () => {
    expect(() =>
      loadYouTubeOAuthCredentials(
        {},
        {
          existsSync: () => false,
          readFileSync: () => '',
        },
        '/workspace/app',
      ),
    ).toThrow('YouTube OAuth credentials not found');
  });
});
