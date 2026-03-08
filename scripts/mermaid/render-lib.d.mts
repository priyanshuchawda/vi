export function readOptionValue(args: string[], names: string[]): string | null;

export function upsertOptionValue(
  args: string[],
  shortName: string,
  longName: string,
  value: string,
): string[];

export function getMermaidOutputFormat(outputPath: string): 'svg' | 'png' | 'pdf' | 'jpeg';
