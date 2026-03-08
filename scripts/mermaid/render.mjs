#!/usr/bin/env node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import {
  INPUT_NAMES,
  OUTPUT_FORMAT_NAMES,
  OUTPUT_NAMES,
  PUPPETEER_CONFIG_NAMES,
  getMermaidOutputFormat,
  hasOption,
  readOptionValue,
  upsertOptionValue,
} from './render-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const defaultPuppeteerConfigPath = path.join(repoRoot, '.mermaid-tools', 'puppeteer-config.json');

function usage() {
  console.error(
    'Usage: npm run mermaid:render -- -i <input.mmd> -o <output.svg|png|pdf|jpg|jpeg> [mmdc options...]',
  );
}

function runMmdc(args) {
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  return new Promise((resolve, reject) => {
    const child = spawn(npmExecutable, ['exec', 'mmdc', '--', ...args], {
      cwd: repoRoot,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`mmdc exited with code ${code ?? 'unknown'}`));
    });
  });
}

function buildSvgHtml(svgMarkup) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: white;
      }

      body {
        display: inline-block;
      }

      svg {
        display: block;
      }
    </style>
  </head>
  <body>${svgMarkup}</body>
</html>`;
}

async function renderSvgToJpeg({ svgPath, outputPath, puppeteerConfigPath }) {
  const svgMarkup = await readFile(svgPath, 'utf8');
  const puppeteerConfig = JSON.parse(await readFile(puppeteerConfigPath, 'utf8'));
  const browser = await puppeteer.launch(puppeteerConfig);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
    await page.setContent(buildSvgHtml(svgMarkup), { waitUntil: 'load' });

    const dimensions = await page.evaluate(() => {
      const svg = document.querySelector('svg');

      if (!svg) {
        return null;
      }

      const viewBox = svg.viewBox?.baseVal;
      const rect = svg.getBoundingClientRect();
      const width = Math.ceil(
        viewBox?.width || rect.width || Number(svg.getAttribute('width')) || 1,
      );
      const height = Math.ceil(
        viewBox?.height || rect.height || Number(svg.getAttribute('height')) || 1,
      );
      return {
        width: Math.max(width, 1),
        height: Math.max(height, 1),
      };
    });

    if (!dimensions) {
      throw new Error('Generated Mermaid SVG is missing the root <svg> element.');
    }

    await page.setViewport({
      width: dimensions.width,
      height: dimensions.height,
      deviceScaleFactor: 2,
    });
    await page.setContent(buildSvgHtml(svgMarkup), { waitUntil: 'load' });

    const svgHandle = await page.$('svg');

    if (!svgHandle) {
      throw new Error('Generated Mermaid SVG could not be selected for JPEG rendering.');
    }

    await svgHandle.screenshot({
      path: outputPath,
      type: 'jpeg',
      quality: 100,
      omitBackground: false,
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const inputPath = readOptionValue(rawArgs, INPUT_NAMES);
  const outputPath = readOptionValue(rawArgs, OUTPUT_NAMES);

  if (!inputPath || !outputPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const outputFormat = getMermaidOutputFormat(outputPath);
  const puppeteerConfigPath =
    readOptionValue(rawArgs, PUPPETEER_CONFIG_NAMES) ?? defaultPuppeteerConfigPath;
  const baseArgs = hasOption(rawArgs, PUPPETEER_CONFIG_NAMES)
    ? rawArgs
    : upsertOptionValue(rawArgs, '-p', '--puppeteerConfigFile', puppeteerConfigPath);

  if (outputFormat !== 'jpeg') {
    await runMmdc(baseArgs);
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'quickcut-mermaid-'));
  const tempSvgPath = path.join(tempDir, 'diagram.svg');

  try {
    const svgArgs = upsertOptionValue(baseArgs, '-o', '--output', tempSvgPath);
    const finalSvgArgs = upsertOptionValue(svgArgs, '-e', '--outputFormat', 'svg');
    await runMmdc(finalSvgArgs);
    await renderSvgToJpeg({
      svgPath: tempSvgPath,
      outputPath,
      puppeteerConfigPath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
