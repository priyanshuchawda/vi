import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const requestedPlatforms = process.argv.slice(2);
const platforms = requestedPlatforms.length > 0 ? requestedPlatforms : ['linux'];
const runtimeConfigPath = path.join(repoRoot, 'resources', 'generated', 'runtime-config.json');

const requiredFilesByPlatform = {
  mac: [
    'resources/ffmpeg-mac/ffmpeg',
    'resources/ffmpeg-mac/ffprobe',
    'public/logo.png',
    'resources/generated/runtime-config.json',
  ],
  win: [
    'resources/ffmpeg-win/ffmpeg.exe',
    'resources/ffmpeg-win/ffprobe.exe',
    'public/logo.png',
    'resources/generated/runtime-config.json',
  ],
  linux: [
    'resources/ffmpeg-linux/ffmpeg',
    'resources/ffmpeg-linux/ffprobe',
    'public/logo.png',
    'resources/generated/runtime-config.json',
  ],
};

const validPlatforms = new Set(Object.keys(requiredFilesByPlatform));
const missingByPlatform = [];

for (const platform of platforms) {
  if (!validPlatforms.has(platform)) {
    console.error(
      `[release-assets] Unsupported platform "${platform}". Expected one of: ${Array.from(validPlatforms).join(', ')}`,
    );
    process.exit(1);
  }

  const requiredFiles = requiredFilesByPlatform[platform];
  const missingFiles = requiredFiles.filter((relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    return !fs.existsSync(absolutePath);
  });

  if (missingFiles.length > 0) {
    missingByPlatform.push({ platform, missingFiles });
  }
}

if (missingByPlatform.length > 0) {
  console.error('[release-assets] Missing required production assets:');
  for (const entry of missingByPlatform) {
    console.error(`- ${entry.platform}:`);
    for (const missingFile of entry.missingFiles) {
      console.error(`  - ${missingFile}`);
    }
  }
  process.exit(1);
}

let runtimeConfig;
try {
  runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
} catch (error) {
  console.error('[release-assets] Failed to parse resources/generated/runtime-config.json');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const runtimeConfigErrors = [];
if (runtimeConfig?.version !== 1) {
  runtimeConfigErrors.push('version must equal 1');
}

if (typeof runtimeConfig?.generatedAt !== 'string' || !runtimeConfig.generatedAt.trim()) {
  runtimeConfigErrors.push('generatedAt must be a non-empty ISO timestamp');
}

const aws = runtimeConfig?.aws ?? {};
if (aws.backendMode !== 'direct' && aws.backendMode !== 'apigw') {
  runtimeConfigErrors.push('aws.backendMode must be "direct" or "apigw"');
}
if (typeof aws.region !== 'string' || !aws.region.trim()) {
  runtimeConfigErrors.push('aws.region is required');
}

if (aws.backendMode === 'apigw') {
  if (typeof aws.backendUrl !== 'string' || !/^https?:\/\//.test(aws.backendUrl)) {
    runtimeConfigErrors.push('aws.backendUrl must be a valid URL when aws.backendMode=apigw');
  }
}

if (runtimeConfigErrors.length > 0) {
  console.error('[release-assets] Invalid runtime-config.json:');
  for (const error of runtimeConfigErrors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`[release-assets] OK for ${platforms.join(', ')}`);
