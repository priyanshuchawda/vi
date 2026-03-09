export function readEnv(env, name, fallback = '') {
  const value = env[name]?.trim();
  return value || fallback;
}

export function normalizeBackendMode(value) {
  return value.toLowerCase() === 'apigw' ? 'apigw' : 'direct';
}

export function resolvePackagedBackendMode(env, runtimeBackendUrl) {
  const explicitRuntimeMode = readEnv(env, 'AWS_RUNTIME_BACKEND_MODE', '');
  if (explicitRuntimeMode) {
    return normalizeBackendMode(explicitRuntimeMode);
  }

  if (runtimeBackendUrl) {
    return 'apigw';
  }

  return normalizeBackendMode(readEnv(env, 'AWS_BACKEND_MODE', 'direct'));
}

export function createRuntimeConfigFromEnv(
  env = process.env,
  generatedAt = new Date().toISOString(),
) {
  const region = readEnv(env, 'AWS_RUNTIME_REGION', readEnv(env, 'AWS_REGION', 'eu-central-1'));
  const backendUrl = readEnv(env, 'AWS_RUNTIME_BACKEND_URL', readEnv(env, 'AWS_BACKEND_URL', ''));
  const backendAuthToken = readEnv(env, 'AWS_RUNTIME_BACKEND_AUTH_TOKEN', '');
  const backendMode = resolvePackagedBackendMode(env, backendUrl);

  return {
    version: 1,
    generatedAt,
    aws: {
      region,
      backendMode,
      ...(backendUrl ? { backendUrl } : {}),
      ...(backendAuthToken ? { backendAuthToken } : {}),
    },
  };
}

export function validateRuntimeConfigForBuild(runtimeConfig) {
  const validationErrors = [];

  if (!runtimeConfig.aws.backendMode) {
    validationErrors.push('aws.backendMode is required');
  }
  if (!runtimeConfig.aws.region) {
    validationErrors.push('aws.region is required');
  }
  if (runtimeConfig.aws.backendMode === 'apigw' && !runtimeConfig.aws.backendUrl) {
    validationErrors.push('aws.backendUrl is required when aws.backendMode=apigw');
  }

  return validationErrors;
}
