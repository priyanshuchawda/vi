export function parseAwsScriptArgs(argv?: string[]): {
  envFile: string;
  remainingArgs: string[];
};

export function resolveAwsEnvPath(repoRoot: string, envFile?: string): string;

export function loadAwsEnv(
  repoRoot: string,
  argv?: string[],
): {
  envPath: string;
  explicitEnvFile: boolean;
  remainingArgs: string[];
};
