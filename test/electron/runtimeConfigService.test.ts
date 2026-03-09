// @vitest-environment node

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyRuntimeConfigEnvFallback,
  loadRuntimeConfig,
  resolveGeneratedRuntimeConfigPath,
  resolvePackagedRuntimeConfigPath,
  validateRuntimeConfig,
} from '../../electron/services/runtimeConfigService.js';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createRuntimeConfigFile(contents: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'quickcut-runtime-config-'));
  cleanupDirs.push(dir);
  const filePath = path.join(dir, 'runtime-config.json');
  await writeFile(filePath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
  return filePath;
}

describe('runtimeConfigService', () => {
  it('loads a generated runtime config and applies env fallbacks without overriding explicit env values', async () => {
    const filePath = await createRuntimeConfigFile({
      version: 1,
      generatedAt: '2026-03-09T11:00:00.000Z',
      aws: {
        region: 'eu-central-1',
        backendMode: 'apigw',
        backendUrl: 'https://example.execute-api.eu-central-1.amazonaws.com',
        backendAuthToken: 'generated-token',
      },
    });

    const runtimeConfig = loadRuntimeConfig(filePath);
    expect(runtimeConfig).not.toBeNull();

    const env: NodeJS.ProcessEnv = {
      AWS_REGION: 'us-east-1',
      AWS_BACKEND_MODE: '',
      AWS_BACKEND_URL: '',
      AWS_BACKEND_AUTH_TOKEN: '',
    };

    applyRuntimeConfigEnvFallback(env, runtimeConfig);

    expect(env.AWS_REGION).toBe('us-east-1');
    expect(env.AWS_BACKEND_MODE).toBe('apigw');
    expect(env.AWS_BACKEND_URL).toBe('https://example.execute-api.eu-central-1.amazonaws.com');
    expect(env.AWS_BACKEND_AUTH_TOKEN).toBe('generated-token');
  });

  it('reports missing API Gateway fields for packaged apigw runtime config', async () => {
    const filePath = await createRuntimeConfigFile({
      version: 1,
      generatedAt: '2026-03-09T11:00:00.000Z',
      aws: {
        region: 'eu-central-1',
        backendMode: 'apigw',
      },
    });

    const runtimeConfig = loadRuntimeConfig(filePath);
    expect(runtimeConfig).not.toBeNull();
    expect(validateRuntimeConfig(runtimeConfig!)).toEqual([
      'aws.backendUrl is required when aws.backendMode=apigw',
    ]);
  });

  it('resolves repo and packaged runtime config paths predictably', () => {
    expect(resolveGeneratedRuntimeConfigPath('/repo')).toBe(
      path.join('/repo', 'resources', 'generated', 'runtime-config.json'),
    );
    expect(resolvePackagedRuntimeConfigPath('/resources')).toBe(
      path.join('/resources', 'runtime', 'runtime-config.json'),
    );
  });
});
