// @vitest-environment node

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadAwsEnv,
  parseAwsScriptArgs,
  resolveAwsEnvPath,
} from '../../scripts/aws/env-loader.mjs';

const cleanupDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('aws env loader', () => {
  it('parses env-file while preserving other arguments', () => {
    vi.stubEnv('AWS_ENV_FILE', '.env.aws.dev');

    expect(parseAwsScriptArgs(['--dryrun', '--env-file', '.env.aws.prod'])).toEqual({
      envFile: '.env.aws.prod',
      remainingArgs: ['--dryrun'],
    });
  });

  it('resolves the default env path when no override is present', () => {
    expect(resolveAwsEnvPath('/repo')).toBe(path.join('/repo', '.env'));
  });

  it('loads an explicit env file and strips it from the remaining arguments', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'quickcut-aws-env-'));
    cleanupDirs.push(repoRoot);
    await writeFile(path.join(repoRoot, '.env.aws.dev'), 'AWS_REGION=us-east-1\n', 'utf8');

    const result = loadAwsEnv(repoRoot, ['--env-file', '.env.aws.dev', '--dryrun']);

    expect(result.remainingArgs).toEqual(['--dryrun']);
    expect(result.explicitEnvFile).toBe(true);
    expect(process.env.AWS_REGION).toBe('us-east-1');
  });

  it('throws when an explicit env file is missing', () => {
    expect(() => loadAwsEnv('/repo', ['--env-file', '.env.aws.prod'])).toThrow(
      'AWS env file not found',
    );
  });
});
