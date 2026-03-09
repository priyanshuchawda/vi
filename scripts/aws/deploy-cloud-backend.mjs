import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadAwsEnv } from './env-loader.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL('../../', import.meta.url).pathname);
loadAwsEnv(repoRoot);

function readEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

const region = readEnv('AWS_REGION', 'eu-central-1');
const stackName = readEnv('AWS_CLOUDBACKEND_STACK_NAME', 'quickcut-cloud-backend-dev');
const artifactBucket = readEnv('AWS_CLOUDBACKEND_ARTIFACT_BUCKET', readEnv('AWS_S3_BUCKET', ''));
const projectName = readEnv('AWS_CLOUDBACKEND_PROJECT_NAME', 'quickcut');
const environmentName = readEnv('AWS_CLOUDBACKEND_ENVIRONMENT', 'dev');
const storageBucketName = readEnv('AWS_S3_BUCKET', 'quickcut-279158981022-storage');
const profilesTableName = readEnv('AWS_DYNAMODB_PROFILES_TABLE', 'quickcut-user-profiles');
const analysisTableName = readEnv('AWS_DYNAMODB_ANALYSIS_TABLE', 'quickcut-channel-analysis');
const userLinksTableName = readEnv('AWS_DYNAMODB_USER_LINKS_TABLE', 'quickcut-user-links');
const installationsTableName = readEnv(
  'AWS_DYNAMODB_INSTALLATIONS_TABLE',
  'quickcut-client-installations',
);
const backendAuthToken = readEnv('AWS_BACKEND_AUTH_TOKEN', '');
const apiAccessLogRetentionDays = readEnv('AWS_CLOUDBACKEND_API_ACCESS_LOG_RETENTION_DAYS', '14');
const lambdaLogRetentionDays = readEnv('AWS_CLOUDBACKEND_LAMBDA_LOG_RETENTION_DAYS', '14');
const alarmTopicArn = readEnv('AWS_CLOUDBACKEND_ALARM_TOPIC_ARN', '');
const lambdaErrorAlarmThreshold = readEnv('AWS_CLOUDBACKEND_LAMBDA_ERROR_ALARM_THRESHOLD', '1');
const lambdaThrottleAlarmThreshold = readEnv(
  'AWS_CLOUDBACKEND_LAMBDA_THROTTLE_ALARM_THRESHOLD',
  '1',
);
const api5xxAlarmThreshold = readEnv('AWS_CLOUDBACKEND_API_5XX_ALARM_THRESHOLD', '1');

if (!artifactBucket) {
  throw new Error('Set AWS_CLOUDBACKEND_ARTIFACT_BUCKET or AWS_S3_BUCKET before deployment.');
}

await execFileAsync('node', [path.join(repoRoot, 'scripts', 'aws', 'build-cloud-backend.mjs')], {
  cwd: repoRoot,
});

const templatePath = path.join(repoRoot, 'infra', 'cloud-backend.yml');
const packagedTemplatePath = path.join(
  await fs.mkdtemp(path.join(os.tmpdir(), 'quickcut-cloud-backend-')),
  'packaged-cloud-backend.yml',
);

await execFileAsync(
  'aws',
  [
    'cloudformation',
    'package',
    '--region',
    region,
    '--template-file',
    templatePath,
    '--s3-bucket',
    artifactBucket,
    '--s3-prefix',
    `${stackName}/artifacts`,
    '--output-template-file',
    packagedTemplatePath,
  ],
  { cwd: repoRoot },
);

await execFileAsync(
  'aws',
  [
    'cloudformation',
    'deploy',
    '--region',
    region,
    '--template-file',
    packagedTemplatePath,
    '--stack-name',
    stackName,
    '--capabilities',
    'CAPABILITY_IAM',
    '--no-fail-on-empty-changeset',
    '--parameter-overrides',
    `ProjectName=${projectName}`,
    `EnvironmentName=${environmentName}`,
    `StorageBucketName=${storageBucketName}`,
    `ProfilesTableName=${profilesTableName}`,
    `AnalysisTableName=${analysisTableName}`,
    `UserLinksTableName=${userLinksTableName}`,
    `InstallationsTableName=${installationsTableName}`,
    `ApiAccessLogRetentionDays=${apiAccessLogRetentionDays}`,
    `LambdaErrorAlarmThreshold=${lambdaErrorAlarmThreshold}`,
    `LambdaThrottleAlarmThreshold=${lambdaThrottleAlarmThreshold}`,
    `Api5xxAlarmThreshold=${api5xxAlarmThreshold}`,
    ...(alarmTopicArn ? [`AlarmTopicArn=${alarmTopicArn}`] : []),
    ...(backendAuthToken ? [`BackendAuthToken=${backendAuthToken}`] : []),
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);

const { stdout } = await execFileAsync(
  'aws',
  [
    'cloudformation',
    'describe-stacks',
    '--region',
    region,
    '--stack-name',
    stackName,
    '--query',
    'Stacks[0].Outputs',
    '--output',
    'json',
  ],
  { cwd: repoRoot },
);

const outputs = JSON.parse(stdout);
const functionName =
  outputs.find((output) => output.OutputKey === 'FunctionName')?.OutputValue ||
  `${projectName}-${environmentName}-storage-api`;
const lambdaLogGroupName = `/aws/lambda/${functionName}`;

try {
  await execFileAsync(
    'aws',
    ['logs', 'create-log-group', '--region', region, '--log-group-name', lambdaLogGroupName],
    { cwd: repoRoot },
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes('ResourceAlreadyExistsException')) {
    throw error;
  }
}

await execFileAsync(
  'aws',
  [
    'logs',
    'put-retention-policy',
    '--region',
    region,
    '--log-group-name',
    lambdaLogGroupName,
    '--retention-in-days',
    lambdaLogRetentionDays,
  ],
  { cwd: repoRoot },
);

console.log(JSON.stringify(outputs, null, 2));
