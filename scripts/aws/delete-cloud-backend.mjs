import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL('../../', import.meta.url).pathname);

const region = process.env.AWS_REGION?.trim() || 'eu-central-1';
const stackName = process.env.AWS_CLOUDBACKEND_STACK_NAME?.trim() || 'quickcut-cloud-backend-dev';

await execFileAsync(
  'aws',
  ['cloudformation', 'delete-stack', '--region', region, '--stack-name', stackName],
  { cwd: repoRoot, stdio: 'inherit' },
);

await execFileAsync(
  'aws',
  ['cloudformation', 'wait', 'stack-delete-complete', '--region', region, '--stack-name', stackName],
  { cwd: repoRoot, stdio: 'inherit' },
);
