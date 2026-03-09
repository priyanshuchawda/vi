// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  createRuntimeConfigFromEnv,
  resolvePackagedBackendMode,
  validateRuntimeConfigForBuild,
} from '../../scripts/build/runtime-config-builder.mjs';

describe('runtime-config-builder', () => {
  it('prefers apigw for packaged runtime config when a backend URL is present', () => {
    const runtimeConfig = createRuntimeConfigFromEnv({
      AWS_BACKEND_MODE: 'direct',
      AWS_BACKEND_URL: 'https://example.execute-api.eu-central-1.amazonaws.com',
      AWS_REGION: 'eu-central-1',
    });

    expect(runtimeConfig.aws.backendMode).toBe('apigw');
    expect(runtimeConfig.aws.backendUrl).toBe(
      'https://example.execute-api.eu-central-1.amazonaws.com',
    );
  });

  it('honors explicit packaged runtime overrides when provided', () => {
    const runtimeConfig = createRuntimeConfigFromEnv({
      AWS_BACKEND_MODE: 'direct',
      AWS_BACKEND_URL: 'https://example.execute-api.eu-central-1.amazonaws.com',
      AWS_RUNTIME_BACKEND_MODE: 'direct',
      AWS_RUNTIME_REGION: 'us-east-1',
      AWS_RUNTIME_BACKEND_AUTH_TOKEN: 'runtime-token',
    });

    expect(runtimeConfig.aws.backendMode).toBe('direct');
    expect(runtimeConfig.aws.region).toBe('us-east-1');
    expect(runtimeConfig.aws.backendAuthToken).toBe('runtime-token');
  });

  it('does not inherit the shared backend auth token into packaged runtime config by default', () => {
    const runtimeConfig = createRuntimeConfigFromEnv({
      AWS_BACKEND_MODE: 'direct',
      AWS_BACKEND_URL: 'https://example.execute-api.eu-central-1.amazonaws.com',
      AWS_BACKEND_AUTH_TOKEN: 'shared-dev-token',
    });

    expect(runtimeConfig.aws.backendMode).toBe('apigw');
    expect(runtimeConfig.aws.backendAuthToken).toBeUndefined();
  });

  it('validates apigw output requires a backend URL', () => {
    expect(
      validateRuntimeConfigForBuild({
        version: 1,
        generatedAt: '2026-03-09T12:00:00.000Z',
        aws: {
          region: 'eu-central-1',
          backendMode: resolvePackagedBackendMode(
            { AWS_RUNTIME_BACKEND_MODE: 'apigw' },
            '',
          ),
        },
      }),
    ).toEqual(['aws.backendUrl is required when aws.backendMode=apigw']);
  });
});
