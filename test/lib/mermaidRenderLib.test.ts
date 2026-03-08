import { describe, expect, it } from 'vitest';

import {
  getMermaidOutputFormat,
  readOptionValue,
  upsertOptionValue,
} from '../../scripts/mermaid/render-lib.mjs';

describe('mermaid render helpers', () => {
  it('detects direct and jpeg output formats from the output extension', () => {
    expect(getMermaidOutputFormat('/tmp/diagram.png')).toBe('png');
    expect(getMermaidOutputFormat('/tmp/diagram.svg')).toBe('svg');
    expect(getMermaidOutputFormat('/tmp/diagram.pdf')).toBe('pdf');
    expect(getMermaidOutputFormat('/tmp/diagram.jpg')).toBe('jpeg');
    expect(getMermaidOutputFormat('/tmp/diagram.jpeg')).toBe('jpeg');
  });

  it('rejects unsupported Mermaid output extensions', () => {
    expect(() => getMermaidOutputFormat('/tmp/diagram.gif')).toThrow(/Unsupported Mermaid output extension/);
  });

  it('reads and updates CLI options in both split and equals forms', () => {
    expect(readOptionValue(['-o', 'diagram.png'], ['-o', '--output'])).toBe('diagram.png');
    expect(readOptionValue(['--output=diagram.png'], ['-o', '--output'])).toBe('diagram.png');
    expect(upsertOptionValue(['-o', 'diagram.png'], '-o', '--output', 'diagram.jpg')).toEqual([
      '-o',
      'diagram.jpg',
    ]);
    expect(
      upsertOptionValue(['--output=diagram.png'], '-o', '--output', 'diagram.jpg'),
    ).toEqual(['--output=diagram.jpg']);
  });
});
