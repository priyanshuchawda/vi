function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\/+$/g, '');

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function resolveLinuxReleaseFeedUrl(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== 'linux') {
    return null;
  }

  return normalizeUrl(env.AWS_LINUX_RELEASE_BASE_URL ?? '');
}
