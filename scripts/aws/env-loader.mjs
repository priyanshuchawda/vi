import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

export function parseAwsScriptArgs(argv = []) {
  let envFile = process.env.AWS_ENV_FILE?.trim() || '';
  const remainingArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('`--env-file` requires a relative or absolute file path.');
      }
      envFile = value;
      index += 1;
      continue;
    }

    remainingArgs.push(arg);
  }

  return {
    envFile,
    remainingArgs,
  };
}

export function resolveAwsEnvPath(repoRoot, envFile = '') {
  return path.resolve(repoRoot, envFile || '.env');
}

export function loadAwsEnv(repoRoot, argv = process.argv.slice(2)) {
  const { envFile, remainingArgs } = parseAwsScriptArgs(argv);
  const envPath = resolveAwsEnvPath(repoRoot, envFile);
  const explicitEnvFile = Boolean(envFile);

  if (fs.existsSync(envPath)) {
    loadEnv({ path: envPath });
  } else if (explicitEnvFile) {
    throw new Error(`AWS env file not found: ${envPath}`);
  }

  return {
    envPath,
    explicitEnvFile,
    remainingArgs,
  };
}
