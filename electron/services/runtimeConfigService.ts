import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const GENERATED_RUNTIME_CONFIG_RELATIVE_PATH = path.join(
  'resources',
  'generated',
  'runtime-config.json',
);
export const PACKAGED_RUNTIME_CONFIG_RELATIVE_PATH = path.join('runtime', 'runtime-config.json');

export const runtimeConfigSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  aws: z
    .object({
      region: z.string().trim().min(1).optional(),
      backendMode: z.enum(['direct', 'apigw']).optional(),
      backendUrl: z.string().url().optional(),
      backendAuthToken: z.string().trim().min(1).optional(),
    })
    .default({}),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function resolveGeneratedRuntimeConfigPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_RUNTIME_CONFIG_RELATIVE_PATH);
}

export function resolvePackagedRuntimeConfigPath(resourcesPath: string): string {
  return path.join(resourcesPath, PACKAGED_RUNTIME_CONFIG_RELATIVE_PATH);
}

export function loadRuntimeConfig(
  filePath: string,
  fileSystem: Pick<typeof fs, 'existsSync' | 'readFileSync'> = fs,
): RuntimeConfig | null {
  if (!fileSystem.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fileSystem.readFileSync(filePath, 'utf8');
    return runtimeConfigSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function applyRuntimeConfigEnvFallback(
  env: NodeJS.ProcessEnv,
  runtimeConfig: RuntimeConfig | null,
): void {
  if (!runtimeConfig) {
    return;
  }

  const { aws } = runtimeConfig;

  if (!env.AWS_REGION?.trim() && aws.region) {
    env.AWS_REGION = aws.region;
  }

  if (!env.AWS_BACKEND_MODE?.trim() && aws.backendMode) {
    env.AWS_BACKEND_MODE = aws.backendMode;
  }

  if (!env.AWS_BACKEND_URL?.trim() && aws.backendUrl) {
    env.AWS_BACKEND_URL = aws.backendUrl;
  }

  if (!env.AWS_BACKEND_AUTH_TOKEN?.trim() && aws.backendAuthToken) {
    env.AWS_BACKEND_AUTH_TOKEN = aws.backendAuthToken;
  }
}

export function validateRuntimeConfig(runtimeConfig: RuntimeConfig): string[] {
  const errors: string[] = [];

  if (!runtimeConfig.aws.backendMode) {
    errors.push('aws.backendMode is required');
  }

  if (!runtimeConfig.aws.region) {
    errors.push('aws.region is required');
  }

  if (runtimeConfig.aws.backendMode === 'apigw') {
    if (!runtimeConfig.aws.backendUrl) {
      errors.push('aws.backendUrl is required when aws.backendMode=apigw');
    }
  }

  return errors;
}
