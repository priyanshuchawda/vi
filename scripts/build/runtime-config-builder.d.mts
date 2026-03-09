export type RuntimeConfig = {
  version: number;
  generatedAt: string;
  aws: {
    region: string;
    backendMode: 'direct' | 'apigw';
    backendUrl?: string;
    backendAuthToken?: string;
  };
};

export function readEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback?: string,
): string;

export function normalizeBackendMode(value: string): 'direct' | 'apigw';

export function resolvePackagedBackendMode(
  env: Record<string, string | undefined>,
  runtimeBackendUrl: string,
): 'direct' | 'apigw';

export function createRuntimeConfigFromEnv(
  env?: Record<string, string | undefined>,
  generatedAt?: string,
): RuntimeConfig;

export function validateRuntimeConfigForBuild(runtimeConfig: RuntimeConfig): string[];
