import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config as loadEnv } from 'dotenv';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL('../../', import.meta.url).pathname);
loadEnv({ path: path.join(repoRoot, '.env') });

function readEnv(name, fallback = '') {
  const value = process.env[name]?.trim();
  return value || fallback;
}

async function runAws(args) {
  const { stdout, stderr } = await execFileAsync('aws', args, { cwd: repoRoot });
  if (stderr?.trim()) {
    process.stderr.write(stderr);
  }
  if (stdout?.trim()) {
    process.stdout.write(stdout);
  }
}

async function resolveLandingBucket() {
  const configured = readEnv('AWS_LANDING_BUCKET', '');
  if (configured) {
    return configured;
  }

  const { stdout } = await execFileAsync(
    'aws',
    ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'],
    { cwd: repoRoot },
  );
  const accountId = stdout.trim();
  if (!accountId) {
    throw new Error('Unable to resolve AWS account ID for landing bucket fallback.');
  }
  return `quickcut-landing-${accountId}`;
}

const region = readEnv('AWS_REGION', 'eu-central-1');
const landingDir = path.resolve(repoRoot, readEnv('AWS_LANDING_DIR', 'landing'));
const landingPrefix = readEnv('AWS_LANDING_S3_PREFIX', '').replace(/^\/+|\/+$/g, '');
const landingBucket = await resolveLandingBucket();
const extraArgs = process.argv.slice(2);
const destination = landingPrefix
  ? `s3://${landingBucket}/${landingPrefix}/`
  : `s3://${landingBucket}/`;

await fs.access(landingDir);

await execFileAsync(
  'aws',
  ['s3api', 'head-bucket', '--bucket', landingBucket, '--region', region],
  { cwd: repoRoot },
);

const baseSyncArgs = [
  's3',
  'sync',
  landingDir,
  destination,
  '--region',
  region,
  '--delete',
  ...extraArgs,
];

await runAws([...baseSyncArgs, '--exclude', '*.html', '--exclude', '*.css', '--exclude', '*.js']);

await runAws([
  ...baseSyncArgs,
  '--exclude',
  '*',
  '--include',
  '*.html',
  '--include',
  '*.css',
  '--include',
  '*.js',
  '--cache-control',
  'no-cache, no-store, must-revalidate',
]);

const websiteEndpoint = `http://${landingBucket}.s3-website.${region}.amazonaws.com${
  landingPrefix ? `/${landingPrefix}` : ''
}`;

console.log(
  JSON.stringify(
    {
      bucket: landingBucket,
      region,
      prefix: landingPrefix || null,
      sourceDir: landingDir,
      destination,
      websiteEndpoint,
    },
    null,
    2,
  ),
);
