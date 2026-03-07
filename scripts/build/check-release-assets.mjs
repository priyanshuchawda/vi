import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const requestedPlatforms = process.argv.slice(2);
const platforms = requestedPlatforms.length > 0 ? requestedPlatforms : ['linux'];

const requiredFilesByPlatform = {
  mac: ['resources/ffmpeg-mac/ffmpeg', 'resources/ffmpeg-mac/ffprobe', 'public/logo.png'],
  win: [
    'resources/ffmpeg-win/ffmpeg.exe',
    'resources/ffmpeg-win/ffprobe.exe',
    'public/logo.png',
  ],
  linux: ['resources/ffmpeg-linux/ffmpeg', 'resources/ffmpeg-linux/ffprobe', 'public/logo.png'],
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

console.log(`[release-assets] OK for ${platforms.join(', ')}`);
