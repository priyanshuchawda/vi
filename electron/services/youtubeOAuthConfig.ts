import fs from 'fs';
import path from 'path';

export interface YouTubeOAuthCredentials {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

type OAuthEnv = Partial<
  Record<
    | 'YOUTUBE_OAUTH_CLIENT_ID'
    | 'YOUTUBE_OAUTH_CLIENT_SECRET'
    | 'YOUTUBE_OAUTH_REDIRECT_URI'
    | 'YOUTUBE_OAUTH_CREDENTIALS_PATH',
    string | undefined
  >
>;

interface CredentialFileAccess {
  existsSync: (filePath: string) => boolean;
  readFileSync: (filePath: string, encoding: BufferEncoding) => string;
}

const LEGACY_CREDENTIALS_FILE =
  'client_secret_235744043692-85hlp2prkgdp0bitbmh46gfbug5vfn2e.apps.googleusercontent.com.json';

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isYouTubeOAuthCredentials(value: unknown): value is YouTubeOAuthCredentials {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const installed = (value as { installed?: unknown }).installed;
  if (typeof installed !== 'object' || installed === null) {
    return false;
  }
  const typedInstalled = installed as {
    client_id?: unknown;
    client_secret?: unknown;
    redirect_uris?: unknown;
  };
  return (
    typeof typedInstalled.client_id === 'string' &&
    typedInstalled.client_id.trim().length > 0 &&
    typeof typedInstalled.client_secret === 'string' &&
    typedInstalled.client_secret.trim().length > 0 &&
    Array.isArray(typedInstalled.redirect_uris) &&
    typedInstalled.redirect_uris.length > 0 &&
    typedInstalled.redirect_uris.every((uri) => typeof uri === 'string' && uri.trim().length > 0)
  );
}

export function getDefaultYouTubeOAuthCredentialsPath(cwd = process.cwd()): string {
  return path.join(cwd, LEGACY_CREDENTIALS_FILE);
}

export function getYouTubeOAuthCredentialsFromEnv(env: OAuthEnv): YouTubeOAuthCredentials | null {
  const clientId = env.YOUTUBE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.YOUTUBE_OAUTH_REDIRECT_URI?.trim();

  const providedCount = [clientId, clientSecret, redirectUri].filter(Boolean).length;
  if (providedCount === 0) {
    return null;
  }

  if (providedCount !== 3 || !clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Incomplete YouTube OAuth environment configuration. Set YOUTUBE_OAUTH_CLIENT_ID, YOUTUBE_OAUTH_CLIENT_SECRET, and YOUTUBE_OAUTH_REDIRECT_URI together.',
    );
  }

  return {
    installed: {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
    },
  };
}

export function loadYouTubeOAuthCredentials(
  env: OAuthEnv = process.env,
  fileAccess: CredentialFileAccess = fs,
  cwd = process.cwd(),
): YouTubeOAuthCredentials {
  const envCredentials = getYouTubeOAuthCredentialsFromEnv(env);
  if (envCredentials) {
    return envCredentials;
  }

  const configuredPath = hasValue(env.YOUTUBE_OAUTH_CREDENTIALS_PATH)
    ? env.YOUTUBE_OAUTH_CREDENTIALS_PATH.trim()
    : getDefaultYouTubeOAuthCredentialsPath(cwd);

  if (!fileAccess.existsSync(configuredPath)) {
    throw new Error(
      `YouTube OAuth credentials not found. Set YOUTUBE_OAUTH_CLIENT_ID, YOUTUBE_OAUTH_CLIENT_SECRET, and YOUTUBE_OAUTH_REDIRECT_URI, or provide YOUTUBE_OAUTH_CREDENTIALS_PATH (looked for ${configuredPath}).`,
    );
  }

  try {
    const content = fileAccess.readFileSync(configuredPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (!isYouTubeOAuthCredentials(parsed)) {
      throw new Error('Invalid credentials JSON shape');
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Could not load YouTube OAuth credentials from ${configuredPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
