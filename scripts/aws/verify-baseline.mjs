import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { config as loadEnv } from 'dotenv';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL('../../', import.meta.url).pathname);
loadEnv({ path: path.join(repoRoot, '.env') });

const REQUIRED_ROUTES = [
  'POST /auth/installations/register',
  'GET /profiles/{userId}',
  'PUT /profiles/{userId}',
  'GET /analysis/channels/{channelId}',
  'PUT /analysis/channels/{channelId}',
  'GET /analysis/users/{userId}/link',
  'PUT /analysis/users/{userId}/link',
  'GET /ai-context/{proxy+}',
  'PUT /ai-context/{proxy+}',
  'GET /memory/{proxy+}',
  'PUT /memory/{proxy+}',
  'DELETE /memory/{proxy+}',
  'GET /videos/users/{userId}',
  'POST /videos/uploads/presign',
];

function readEnv(name, fallback = '') {
  const value = process.env[name]?.trim();
  return value || fallback;
}

async function runAwsJson(args) {
  const { stdout } = await execFileAsync('aws', [...args, '--output', 'json'], {
    cwd: repoRoot,
  });
  return JSON.parse(stdout);
}

async function runAwsText(args) {
  const { stdout } = await execFileAsync('aws', args, { cwd: repoRoot });
  return stdout.trim();
}

async function resolveLandingBucket() {
  const configured = readEnv('AWS_LANDING_BUCKET', '');
  if (configured) {
    return configured;
  }

  const accountId = await runAwsText([
    'sts',
    'get-caller-identity',
    '--query',
    'Account',
    '--output',
    'text',
  ]);

  if (!accountId) {
    throw new Error('Unable to resolve AWS account ID for landing bucket fallback.');
  }

  return `quickcut-landing-${accountId}`;
}

function requireStackOutput(outputs, key) {
  const value = outputs.find((output) => output.OutputKey === key)?.OutputValue;
  if (!value) {
    throw new Error(`Missing required CloudFormation output: ${key}`);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

const region = readEnv('AWS_REGION', 'eu-central-1');
const stackName = readEnv('AWS_CLOUDBACKEND_STACK_NAME', 'quickcut-cloud-backend-dev');
const apiLogRetentionDays = Number(readEnv('AWS_CLOUDBACKEND_API_ACCESS_LOG_RETENTION_DAYS', '14'));
const lambdaLogRetentionDays = Number(readEnv('AWS_CLOUDBACKEND_LAMBDA_LOG_RETENTION_DAYS', '14'));
const landingPrefix = readEnv('AWS_LANDING_S3_PREFIX', '').replace(/^\/+|\/+$/g, '');
const backendAuthToken = readEnv('AWS_BACKEND_AUTH_TOKEN', '');

const stack = await runAwsJson([
  'cloudformation',
  'describe-stacks',
  '--region',
  region,
  '--stack-name',
  stackName,
  '--query',
  'Stacks[0]',
]);

assert(
  stack.StackStatus === 'CREATE_COMPLETE' || stack.StackStatus === 'UPDATE_COMPLETE',
  `Unexpected stack status for ${stackName}: ${stack.StackStatus}`,
);

const outputs = stack.Outputs ?? [];
const apiId = requireStackOutput(outputs, 'ApiId');
const apiUrl = requireStackOutput(outputs, 'ApiUrl');
const functionName = requireStackOutput(outputs, 'FunctionName');
const apiAccessLogGroupName =
  outputs.find((output) => output.OutputKey === 'ApiAccessLogGroupName')?.OutputValue ||
  `/aws/apigateway/${functionName}`;

const routesResponse = await runAwsJson([
  'apigatewayv2',
  'get-routes',
  '--region',
  region,
  '--api-id',
  apiId,
]);

const routeKeys = new Set((routesResponse.Items ?? []).map((route) => route.RouteKey));
const missingRoutes = REQUIRED_ROUTES.filter((routeKey) => !routeKeys.has(routeKey));
assert(missingRoutes.length === 0, `Missing API routes: ${missingRoutes.join(', ')}`);

const alarmPrefix = `${functionName}`;
const alarmsResponse = await runAwsJson([
  'cloudwatch',
  'describe-alarms',
  '--region',
  region,
  '--alarm-name-prefix',
  alarmPrefix,
  '--query',
  'MetricAlarms[].AlarmName',
]);

const alarmNames = new Set(alarmsResponse);
const requiredAlarmNames = [
  `${functionName}-lambda-errors`,
  `${functionName}-lambda-throttles`,
  `${functionName}-5xx`,
];
const missingAlarms = requiredAlarmNames.filter((name) => !alarmNames.has(name));
assert(missingAlarms.length === 0, `Missing CloudWatch alarms: ${missingAlarms.join(', ')}`);

const logGroupsResponse = await runAwsJson([
  'logs',
  'describe-log-groups',
  '--region',
  region,
  '--log-group-name-prefix',
  '/aws/',
  '--query',
  'logGroups[].{name:logGroupName,retention:retentionInDays}',
]);

const apiLogGroup = logGroupsResponse.find((group) => group.name === apiAccessLogGroupName);
assert(
  apiLogGroup?.retention === apiLogRetentionDays,
  `Expected API access log retention ${apiLogRetentionDays} days for ${apiAccessLogGroupName}.`,
);

const lambdaLogGroupName = `/aws/lambda/${functionName}`;
const lambdaLogGroup = logGroupsResponse.find((group) => group.name === lambdaLogGroupName);
assert(
  lambdaLogGroup?.retention === lambdaLogRetentionDays,
  `Expected Lambda log retention ${lambdaLogRetentionDays} days for ${lambdaLogGroupName}.`,
);

const registrationResponse = await fetchJson(
  `${apiUrl.replace(/\/+$/, '')}/auth/installations/register`,
  {
    method: 'POST',
  },
);
assert(
  registrationResponse.ok &&
    registrationResponse.body &&
    typeof registrationResponse.body === 'object' &&
    typeof registrationResponse.body.installationId === 'string' &&
    typeof registrationResponse.body.installationSecret === 'string',
  `Installation registration smoke request failed with status ${registrationResponse.status}.`,
);

const apiSmokeHeaders =
  backendAuthToken &&
  (!registrationResponse.body || typeof registrationResponse.body !== 'object')
    ? { authorization: `Bearer ${backendAuthToken}` }
    : {
        'x-quickcut-installation-id': registrationResponse.body.installationId,
        'x-quickcut-installation-secret': registrationResponse.body.installationSecret,
      };
const apiSmoke = await fetchJson(`${apiUrl.replace(/\/+$/, '')}/profiles/quickcut-smoke-check`, {
  headers: apiSmokeHeaders,
});
assert(apiSmoke.ok, `API smoke request failed with status ${apiSmoke.status}.`);

const landingBucket = await resolveLandingBucket();
const landingWebsiteUrl = `http://${landingBucket}.s3-website.${region}.amazonaws.com${
  landingPrefix ? `/${landingPrefix}` : ''
}`;
const landingResponse = await fetch(landingWebsiteUrl, {
  method: 'HEAD',
  redirect: 'manual',
});
assert(
  landingResponse.status >= 200 && landingResponse.status < 400,
  `Landing website smoke check failed with status ${landingResponse.status}.`,
);

console.log(
  JSON.stringify(
    {
      stackName,
      stackStatus: stack.StackStatus,
      apiId,
      apiUrl,
      functionName,
      requiredRoutesChecked: REQUIRED_ROUTES.length,
      alarmsChecked: requiredAlarmNames,
      apiAccessLogGroupName,
      lambdaLogGroupName,
      registrationStatus: registrationResponse.status,
      apiSmokeStatus: apiSmoke.status,
      landingWebsiteUrl,
      landingStatus: landingResponse.status,
    },
    null,
    2,
  ),
);
