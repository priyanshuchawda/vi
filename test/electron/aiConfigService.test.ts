import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AiConfigService } from '../../electron/services/aiConfigService.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickcut-ai-config-'));
  tempDirs.push(dir);
  return dir;
}

function writeEnvFile(filePath: string, values: Record<string, string>): void {
  const content = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.writeFileSync(filePath, `${content}\n`, 'utf8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('AiConfigService', () => {
  it('reloads .env changes and exposes them as the active settings', () => {
    const tempDir = makeTempDir();
    const envFilePath = path.join(tempDir, '.env');
    const userDataPath = path.join(tempDir, 'user-data');

    writeEnvFile(envFilePath, {
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'env-key-1',
      AWS_SECRET_ACCESS_KEY: 'env-secret-1',
    });

    const service = new AiConfigService(userDataPath, {
      env: {},
      envFilePath,
    });

    expect(service.getSettings().awsAccessKeyId).toBe('env-key-1');
    expect(service.getStatus()).toMatchObject({
      bedrockReady: true,
      usingSavedSettings: false,
      usingEnvFallback: true,
    });

    writeEnvFile(envFilePath, {
      AWS_REGION: 'eu-west-1',
      AWS_ACCESS_KEY_ID: 'env-key-2',
      AWS_SECRET_ACCESS_KEY: 'env-secret-2',
    });

    expect(service.getSettings()).toMatchObject({
      awsRegion: 'eu-west-1',
      awsAccessKeyId: 'env-key-2',
      awsSecretAccessKey: 'env-secret-2',
    });
  });

  it('keeps saved settings as fallback but lets .env take priority', () => {
    const tempDir = makeTempDir();
    const envFilePath = path.join(tempDir, '.env');
    const userDataPath = path.join(tempDir, 'user-data');

    writeEnvFile(envFilePath, {
      AWS_ACCESS_KEY_ID: 'env-key',
      AWS_SECRET_ACCESS_KEY: 'env-secret',
    });

    const service = new AiConfigService(userDataPath, {
      env: {},
      envFilePath,
    });

    service.saveSettings({
      youtubeApiKey: '',
      awsRegion: 'ap-south-1',
      awsAccessKeyId: 'saved-key',
      awsSecretAccessKey: 'saved-secret',
      awsSessionToken: '',
      bedrockInferenceProfileId: '',
      bedrockModelId: 'amazon.nova-lite-v1:0',
      youtubeOAuthClientId: '',
      youtubeOAuthClientSecret: '',
      youtubeOAuthRedirectUri: '',
    });

    expect(service.getSettings()).toMatchObject({
      awsRegion: 'ap-south-1',
      awsAccessKeyId: 'env-key',
      awsSecretAccessKey: 'env-secret',
    });
    expect(service.getSavedSettings()).toMatchObject({
      awsRegion: 'ap-south-1',
      awsAccessKeyId: 'saved-key',
      awsSecretAccessKey: 'saved-secret',
    });
    expect(service.getStatus()).toMatchObject({
      usingSavedSettings: false,
      usingEnvFallback: true,
    });
  });
});
