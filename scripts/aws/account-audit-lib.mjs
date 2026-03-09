export function readEnv(env, name, fallback = '') {
  const value = env[name]?.trim();
  return value || fallback;
}

export function buildStackName(projectName, environmentName) {
  return `${projectName}-cloud-backend-${environmentName}`;
}

export function getAuditTargets(env = process.env) {
  const projectName = readEnv(env, 'AWS_CLOUDBACKEND_PROJECT_NAME', 'quickcut');
  const devEnvironmentName = readEnv(env, 'AWS_CLOUDBACKEND_DEV_ENVIRONMENT', 'dev');
  const prodEnvironmentName = readEnv(env, 'AWS_CLOUDBACKEND_PROD_ENVIRONMENT', 'prod');

  return {
    projectName,
    region: readEnv(env, 'AWS_REGION', 'eu-central-1'),
    currentStackName: readEnv(
      env,
      'AWS_CLOUDBACKEND_STACK_NAME',
      buildStackName(projectName, devEnvironmentName),
    ),
    devStackName: readEnv(
      env,
      'AWS_CLOUDBACKEND_DEV_STACK_NAME',
      buildStackName(projectName, devEnvironmentName),
    ),
    prodStackName: readEnv(
      env,
      'AWS_CLOUDBACKEND_PROD_STACK_NAME',
      buildStackName(projectName, prodEnvironmentName),
    ),
    storageBucketName: readEnv(env, 'AWS_S3_BUCKET', ''),
    landingBucketName: readEnv(env, 'AWS_LANDING_BUCKET', ''),
    tables: {
      profiles: readEnv(env, 'AWS_DYNAMODB_PROFILES_TABLE', 'quickcut-user-profiles'),
      analysis: readEnv(env, 'AWS_DYNAMODB_ANALYSIS_TABLE', 'quickcut-channel-analysis'),
      userLinks: readEnv(env, 'AWS_DYNAMODB_USER_LINKS_TABLE', 'quickcut-user-links'),
      installations: readEnv(
        env,
        'AWS_DYNAMODB_INSTALLATIONS_TABLE',
        'quickcut-client-installations',
      ),
    },
  };
}

export function getManualResourceOwnershipNotes(targets) {
  return {
    iacManagedNow: [
      `${targets.currentStackName} CloudFormation stack`,
      'HTTP API Gateway routes and integration',
      'Lambda function, IAM role, log retention, and alarms',
      `DynamoDB installations table (${targets.tables.installations})`,
    ],
    externalOrManualToday: [
      `Primary storage bucket (${targets.storageBucketName || 'AWS_S3_BUCKET not configured in env'})`,
      `Profiles table (${targets.tables.profiles})`,
      `Channel analysis table (${targets.tables.analysis})`,
      `User links table (${targets.tables.userLinks})`,
      `${targets.landingBucketName || 'Landing bucket resolved from account'} S3 website bucket/config`,
      'AWS Budgets / Cost Anomaly Detection account settings',
    ],
  };
}
