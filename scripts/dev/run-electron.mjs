import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readChromeSandboxStat, shouldDisableDevChromiumSandbox } from './chrome-sandbox.mjs';

const require = createRequire(import.meta.url);
const electronBinaryPath = require('electron');
const { chromeSandboxPath, chromeSandboxStat } = readChromeSandboxStat(electronBinaryPath);

const electronArgs = [];

if (
  shouldDisableDevChromiumSandbox({
    platform: process.platform,
    packaged: false,
    chromeSandboxStat,
  })
) {
  console.warn(
    '[dev:electron] Launching Electron with --no-sandbox because chrome-sandbox is unavailable or misconfigured:',
    chromeSandboxPath,
  );
  electronArgs.push('--no-sandbox');
}

electronArgs.push('.');

const child = spawn(electronBinaryPath, electronArgs, {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error('[dev:electron] Failed to launch Electron:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[dev:electron] Electron exited with signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});
