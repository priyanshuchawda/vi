import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import {
  createRuntimeConfigFromEnv,
  validateRuntimeConfigForBuild,
} from './runtime-config-builder.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const envPath = path.join(repoRoot, '.env');
const outputPath = path.join(repoRoot, 'resources', 'generated', 'runtime-config.json');

loadEnv({ path: envPath });
const runtimeConfig = createRuntimeConfigFromEnv(process.env);
const validationErrors = validateRuntimeConfigForBuild(runtimeConfig);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      outputPath,
      backendMode: runtimeConfig.aws.backendMode,
      hasBackendUrl: Boolean(runtimeConfig.aws.backendUrl),
      hasBackendAuthToken: Boolean(runtimeConfig.aws.backendAuthToken),
      warnings: validationErrors,
    },
    null,
    2,
  ),
);
