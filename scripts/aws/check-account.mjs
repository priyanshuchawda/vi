import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadAwsEnv } from './env-loader.mjs';
import { getAuditTargets, getManualResourceOwnershipNotes } from './account-audit-lib.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL('../../', import.meta.url).pathname);
const { envPath } = loadAwsEnv(repoRoot);
const targets = getAuditTargets(process.env);
const reportPath = path.join(repoRoot, 'test-results', 'aws-account-audit-last-run.json');

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runAwsJson(args) {
  const { stdout } = await execFileAsync('aws', [...args, '--output', 'json'], { cwd: repoRoot });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

async function runAwsText(args) {
  const { stdout } = await execFileAsync('aws', args, { cwd: repoRoot });
  return stdout.trim();
}

async function tryAwsJson(args) {
  try {
    return { ok: true, data: await runAwsJson(args) };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  }
}

async function tryAwsText(args) {
  try {
    return { ok: true, data: await runAwsText(args) };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  }
}

function classifyAccess(errorMessage) {
  if (!errorMessage) return 'unknown';
  if (errorMessage.includes('AccessDenied')) return 'access_denied';
  if (errorMessage.includes('does not exist')) return 'missing';
  if (errorMessage.includes('Not Found')) return 'missing';
  if (errorMessage.includes('Forbidden')) return 'forbidden';
  return 'error';
}

async function resolveLandingBucket(accountId) {
  return targets.landingBucketName || `quickcut-landing-${accountId}`;
}

async function failAuthCheck(error) {
  const message = getErrorMessage(error);
  const authReport = {
    checkedAt: new Date().toISOString(),
    envPath,
    region: targets.region,
    status: 'error',
    errorCode: message.includes('ExpiredToken') ? 'expired_token' : 'aws_auth_error',
    error: message,
    action: 'Refresh AWS credentials, then rerun `npm run aws:check:account`.',
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(authReport, null, 2)}\n`, 'utf8');
  console.error(JSON.stringify(authReport, null, 2));
  process.exit(1);
}

let accountId;
try {
  accountId = await runAwsText([
    'sts',
    'get-caller-identity',
    '--query',
    'Account',
    '--output',
    'text',
  ]);
} catch (error) {
  await failAuthCheck(error);
}

const landingBucketName = await resolveLandingBucket(accountId);

const stacksResult = await tryAwsJson([
  'cloudformation',
  'describe-stacks',
  '--region',
  targets.region,
  '--query',
  'Stacks[].{name:StackName,status:StackStatus}',
]);

const stackStates = new Map((stacksResult.ok ? stacksResult.data ?? [] : []).map((stack) => [stack.name, stack.status]));

async function inspectBucket(bucketName) {
  const result = await tryAwsText([
    's3api',
    'head-bucket',
    '--bucket',
    bucketName,
    '--region',
    targets.region,
  ]);

  return result.ok
    ? { name: bucketName, exists: true }
    : {
        name: bucketName,
        exists: false,
        reason: classifyAccess(result.error),
        error: result.error,
      };
}

async function inspectTable(tableName) {
  const result = await tryAwsJson([
    'dynamodb',
    'describe-table',
    '--region',
    targets.region,
    '--table-name',
    tableName,
    '--query',
    'Table.{name:TableName,status:TableStatus,billing:BillingModeSummary.BillingMode}',
  ]);

  return result.ok
    ? {
        name: result.data?.name ?? tableName,
        exists: true,
        status: result.data?.status ?? 'UNKNOWN',
        billingMode: result.data?.billing ?? 'PROVISIONED_OR_UNKNOWN',
      }
    : {
        name: tableName,
        exists: false,
        reason: classifyAccess(result.error),
        error: result.error,
      };
}

const budgetsResult = await tryAwsJson([
  'budgets',
  'describe-budgets',
  '--account-id',
  accountId,
  '--max-results',
  '20',
  '--query',
  'Budgets[].{name:BudgetName,type:BudgetType,limit:BudgetLimit.Amount,unit:BudgetLimit.Unit}',
]);

const anomalyMonitorsResult = await tryAwsJson([
  'ce',
  'get-anomaly-monitors',
  '--region',
  'us-east-1',
  '--query',
  'AnomalyMonitors[].{name:MonitorName,type:MonitorType,lastUpdated:LastUpdatedDate}',
]);

const report = {
  checkedAt: new Date().toISOString(),
  envPath,
  accountId,
  region: targets.region,
  stackTargets: {
    current: targets.currentStackName,
    dev: targets.devStackName,
    prod: targets.prodStackName,
  },
  stackStates: {
    current: stackStates.get(targets.currentStackName) || 'missing',
    dev: stackStates.get(targets.devStackName) || 'missing',
    prod: stackStates.get(targets.prodStackName) || 'missing',
  },
  buckets: {
    storage: targets.storageBucketName ? await inspectBucket(targets.storageBucketName) : null,
    landing: await inspectBucket(landingBucketName),
  },
  tables: {
    profiles: await inspectTable(targets.tables.profiles),
    analysis: await inspectTable(targets.tables.analysis),
    userLinks: await inspectTable(targets.tables.userLinks),
    installations: await inspectTable(targets.tables.installations),
  },
  budgets: budgetsResult.ok
    ? {
        access: 'ok',
        count: budgetsResult.data?.length ?? 0,
        items: budgetsResult.data ?? [],
      }
    : {
        access: classifyAccess(budgetsResult.error),
        error: budgetsResult.error,
      },
  anomalyMonitors: anomalyMonitorsResult.ok
    ? {
        access: 'ok',
        count: anomalyMonitorsResult.data?.length ?? 0,
        items: anomalyMonitorsResult.data ?? [],
      }
    : {
        access: classifyAccess(anomalyMonitorsResult.error),
        error: anomalyMonitorsResult.error,
      },
  ownership: getManualResourceOwnershipNotes({
    ...targets,
    landingBucketName,
  }),
  recommendations: [],
};

if (report.stackStates.prod === 'missing') {
  report.recommendations.push(
    `No separate prod backend stack found in ${targets.region}; keep using ${targets.devStackName} for dev only and provision distinct prod resource names before a prod rollout.`,
  );
}

if (report.budgets.access === 'ok' && report.budgets.count === 0) {
  report.recommendations.push(
    'No AWS Budgets were found for this account; add at least one monthly cost budget before calling the account production-ready.',
  );
}

if (report.anomalyMonitors.access === 'access_denied') {
  report.recommendations.push(
    'Cost Anomaly Detection APIs are blocked by org policy in this account; request org/admin enablement or document the exception as an external dependency.',
  );
}

if (report.tables.installations.exists && report.tables.installations.billingMode !== 'PAY_PER_REQUEST') {
  report.recommendations.push(
    `Installations table ${targets.tables.installations} is not on PAY_PER_REQUEST; that is higher cost than the intended baseline.`,
  );
}

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(report, null, 2));
