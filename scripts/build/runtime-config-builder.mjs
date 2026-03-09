export function readEnv(env, name, fallback = '') {
  const value = env[name]?.trim();
  return value || fallback;
}

export function normalizeBackendMode(value) {
  return value.toLowerCase() === 'apigw' ? 'apigw' : 'direct';
}

export function normalizeS3Prefix(value) {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

export function resolveReleasePrefix(env = process.env) {
  const explicitReleasePrefix = normalizeS3Prefix(readEnv(env, 'AWS_RELEASE_S3_PREFIX', ''));
  if (explicitReleasePrefix) {
    return explicitReleasePrefix;
  }

  const landingPrefix = normalizeS3Prefix(readEnv(env, 'AWS_LANDING_S3_PREFIX', ''));
  return landingPrefix ? `${landingPrefix}/releases` : 'releases';
}

export function resolveLinuxReleaseBaseUrl(env = process.env, region = 'eu-central-1') {
  const explicitBaseUrl = readEnv(
    env,
    'AWS_RUNTIME_LINUX_RELEASE_BASE_URL',
    readEnv(env, 'AWS_LINUX_RELEASE_BASE_URL', ''),
  );
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/g, '');
  }

  const releaseBucket = readEnv(env, 'AWS_RELEASE_BUCKET', readEnv(env, 'AWS_LANDING_BUCKET', ''));
  if (!releaseBucket) {
    return '';
  }

  const releasePrefix = resolveReleasePrefix(env);
  return `https://${releaseBucket}.s3.${region}.amazonaws.com/${releasePrefix}/linux`;
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
  const linuxReleaseBaseUrl = resolveLinuxReleaseBaseUrl(env, region);

  return {
    version: 1,
    generatedAt,
    aws: {
      region,
      backendMode,
      ...(backendUrl ? { backendUrl } : {}),
      ...(backendAuthToken ? { backendAuthToken } : {}),
      ...(linuxReleaseBaseUrl ? { linuxReleaseBaseUrl } : {}),
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
