import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadAwsEnv } from './env-loader.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL('../../', import.meta.url).pathname);
const { remainingArgs } = loadAwsEnv(repoRoot);

function readEnv(name, fallback = '') {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function normalizePrefix(value) {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function resolveReleasePrefix() {
  const explicitPrefix = normalizePrefix(readEnv('AWS_RELEASE_S3_PREFIX', ''));
  if (explicitPrefix) {
    return explicitPrefix;
  }

  const landingPrefix = normalizePrefix(readEnv('AWS_LANDING_S3_PREFIX', ''));
  return landingPrefix ? `${landingPrefix}/releases` : 'releases';
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    platform: 'linux',
    sourceDir: readEnv('AWS_RELEASE_SOURCE_DIR', 'D:/vi-release'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dryrun') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--platform') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('`--platform` requires a value.');
      }
      parsed.platform = value;
      index += 1;
      continue;
    }

    if (arg === '--source-dir') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('`--source-dir` requires a value.');
      }
      parsed.sourceDir = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
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

function getPlatformConfig(platform) {
  if (platform === 'linux') {
    return {
      metadata: ['latest-linux.yml'],
      binaries: ['.AppImage', '.deb', '.blockmap'],
    };
  }

  throw new Error(`Unsupported release platform: ${platform}`);
}

function matchesAsset(name, config) {
  return (
    config.metadata.includes(name) || config.binaries.some((extension) => name.endsWith(extension))
  );
}

function isMetadataFile(name, config) {
  return config.metadata.includes(name);
}

const { dryRun, platform, sourceDir } = parseArgs(remainingArgs);
const region = readEnv('AWS_REGION', 'eu-central-1');
const releasePrefix = resolveReleasePrefix();
const landingBucket = await resolveLandingBucket();
const releaseBucket = readEnv('AWS_RELEASE_BUCKET', landingBucket);
const sourcePath = path.resolve(repoRoot, sourceDir);
const platformConfig = getPlatformConfig(platform);
const destinationPrefix = `${releasePrefix}/${platform}`;
const linuxReleaseBaseUrl = `https://${releaseBucket}.s3.${region}.amazonaws.com/${destinationPrefix}`;

await fs.access(sourcePath);
await execFileAsync(
  'aws',
  ['s3api', 'head-bucket', '--bucket', releaseBucket, '--region', region],
  { cwd: repoRoot },
);

const sourceEntries = await fs.readdir(sourcePath, { withFileTypes: true });
const filesToUpload = sourceEntries
  .filter((entry) => entry.isFile() && matchesAsset(entry.name, platformConfig))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

if (filesToUpload.length === 0) {
  throw new Error(`No release assets found for ${platform} in ${sourcePath}`);
}

for (const fileName of filesToUpload) {
  const localPath = path.join(sourcePath, fileName);
  const remoteUrl = `s3://${releaseBucket}/${destinationPrefix}/${fileName}`;
  const args = [
    's3',
    'cp',
    localPath,
    remoteUrl,
    '--region',
    region,
    '--cache-control',
    isMetadataFile(fileName, platformConfig)
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=31536000, immutable',
  ];

  if (isMetadataFile(fileName, platformConfig)) {
    args.push('--content-type', 'text/yaml');
  }

  if (dryRun) {
    args.push('--dryrun');
  }

  await runAws(args);
}

console.log(
  JSON.stringify(
    {
      bucket: releaseBucket,
      region,
      platform,
      sourceDir: sourcePath,
      releasePrefix,
      destinationPrefix,
      linuxReleaseBaseUrl,
      dryRun,
      files: filesToUpload.map((fileName) => ({
        fileName,
        publicUrl: `${linuxReleaseBaseUrl}/${fileName}`,
      })),
    },
    null,
    2,
  ),
);
