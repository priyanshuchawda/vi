import path from 'node:path';

const JPEG_EXTENSIONS = new Set(['.jpg', '.jpeg']);
const DIRECT_EXTENSIONS = new Set(['.svg', '.png', '.pdf']);
const OUTPUT_NAMES = ['-o', '--output'];
const INPUT_NAMES = ['-i', '--input'];
const OUTPUT_FORMAT_NAMES = ['-e', '--outputFormat'];
const PUPPETEER_CONFIG_NAMES = ['-p', '--puppeteerConfigFile'];

export function readOptionValue(args, names) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    for (const name of names) {
      if (arg === name) {
        return args[index + 1] ?? null;
      }

      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
    }
  }

  return null;
}

export function hasOption(args, names) {
  return readOptionValue(args, names) !== null;
}

export function upsertOptionValue(args, shortName, longName, value) {
  const nextArgs = [...args];

  for (let index = 0; index < nextArgs.length; index += 1) {
    const arg = nextArgs[index];

    if (arg === shortName || arg === longName) {
      nextArgs[index + 1] = value;
      return nextArgs;
    }

    if (arg.startsWith(`${shortName}=`) || arg.startsWith(`${longName}=`)) {
      nextArgs[index] = `${longName}=${value}`;
      return nextArgs;
    }
  }

  nextArgs.push(shortName, value);
  return nextArgs;
}

export function getMermaidOutputFormat(outputPath) {
  const extension = path.extname(outputPath).toLowerCase();

  if (JPEG_EXTENSIONS.has(extension)) {
    return 'jpeg';
  }

  if (DIRECT_EXTENSIONS.has(extension)) {
    return extension.slice(1);
  }

  throw new Error(
    `Unsupported Mermaid output extension "${extension || '(none)'}". Use .svg, .png, .pdf, .jpg, or .jpeg.`,
  );
}

export { INPUT_NAMES, OUTPUT_FORMAT_NAMES, OUTPUT_NAMES, PUPPETEER_CONFIG_NAMES };
