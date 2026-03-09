import path from 'node:path';

const FORMAT_BY_EXTENSION = new Map([
  ['.png', 'png'],
  ['.svg', 'svg'],
  ['.pdf', 'pdf'],
  ['.jpg', 'jpeg'],
  ['.jpeg', 'jpeg'],
]);

export function getMermaidOutputFormat(outputPath) {
  const extension = path.extname(String(outputPath || '')).toLowerCase();
  const format = FORMAT_BY_EXTENSION.get(extension);

  if (!format) {
    throw new Error(`Unsupported Mermaid output extension: ${extension || '(none)'}`);
  }

  return format;
}

export function readOptionValue(args, aliases) {
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (aliases.includes(current)) {
      return args[index + 1];
    }

    for (const alias of aliases) {
      if (current.startsWith(`${alias}=`)) {
        return current.slice(alias.length + 1);
      }
    }
  }

  return undefined;
}

export function upsertOptionValue(args, shortAlias, longAlias, nextValue) {
  const updated = [...args];

  for (let index = 0; index < updated.length; index += 1) {
    const current = updated[index];
    if (current === shortAlias || current === longAlias) {
      updated[index + 1] = nextValue;
      return updated;
    }

    if (current.startsWith(`${shortAlias}=`)) {
      updated[index] = `${shortAlias}=${nextValue}`;
      return updated;
    }

    if (current.startsWith(`${longAlias}=`)) {
      updated[index] = `${longAlias}=${nextValue}`;
      return updated;
    }
  }

  updated.push(shortAlias, nextValue);
  return updated;
}
