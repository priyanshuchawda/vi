export function shouldDisableDevChromiumSandbox(input: {
  platform: string;
  packaged: boolean;
  chromeSandboxStat: { uid: number; mode: number } | null;
}): boolean;
