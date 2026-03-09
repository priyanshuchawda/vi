export function getMermaidOutputFormat(outputPath: string): 'png' | 'svg' | 'pdf' | 'jpeg';

export function readOptionValue(
  args: string[],
  aliases: string[],
): string | undefined;

export function upsertOptionValue(
  args: string[],
  shortAlias: string,
  longAlias: string,
  nextValue: string,
): string[];
