import fs from 'node:fs';
import path from 'node:path';

export function shouldDisableDevChromiumSandbox({ platform, packaged, chromeSandboxStat }) {
  if (platform !== 'linux' || packaged) {
    return false;
  }

  if (!chromeSandboxStat) {
    return true;
  }

  const helperHasRequiredOwner = chromeSandboxStat.uid === 0;
  const helperHasRequiredMode = (chromeSandboxStat.mode & 0o4777) === 0o4755;
  return !helperHasRequiredOwner || !helperHasRequiredMode;
}

export function readChromeSandboxStat(electronBinaryPath) {
  const chromeSandboxPath = path.join(path.dirname(electronBinaryPath), 'chrome-sandbox');

  try {
    const stats = fs.statSync(chromeSandboxPath);
    return {
      chromeSandboxPath,
      chromeSandboxStat: {
        uid: stats.uid,
        mode: stats.mode,
      },
    };
  } catch {
    return {
      chromeSandboxPath,
      chromeSandboxStat: null,
    };
  }
}
