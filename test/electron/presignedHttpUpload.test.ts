// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { uploadFileToPresignedUrl } from '../../electron/services/presignedHttpUpload.js';

const cleanupDirs: string[] = [];
const cleanupServers = new Set<ReturnType<typeof createServer>>();

async function createFixtureFile(name: string, contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'quickcut-presigned-upload-'));
  cleanupDirs.push(dir);
  const filePath = path.join(dir, name);
  await writeFile(filePath, contents, 'utf8');
  return filePath;
}

async function startServer(
  handler: (request: IncomingMessage, body: Buffer) => void | Promise<void>,
  statusCode = 200,
  responseBody = 'ok',
): Promise<string> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    await handler(request, Buffer.concat(chunks));
    response.writeHead(statusCode);
    response.end(responseBody);
  });

  cleanupServers.add(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address.');
  }
  return `http://127.0.0.1:${address.port}/upload`;
}

afterEach(async () => {
  await Promise.all(
    [...cleanupServers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
  cleanupServers.clear();

  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('uploadFileToPresignedUrl', () => {
  it('uploads the file body with required headers and progress updates', async () => {
    const contents = 'quickcut export payload';
    const filePath = await createFixtureFile('demo.mp4', contents);
    const progressValues: number[] = [];
    let receivedHeaders: IncomingMessage['headers'] | null = null;
    let receivedBody = '';

    const uploadUrl = await startServer((request, body) => {
      receivedHeaders = request.headers;
      receivedBody = body.toString('utf8');
    });

    await expect(
      uploadFileToPresignedUrl(
        filePath,
        uploadUrl,
        {
          'content-type': 'video/mp4',
          'x-amz-meta-origin': 'quickcut-test',
        },
        (progress) => progressValues.push(progress),
      ),
    ).resolves.toBeUndefined();

    expect(receivedBody).toBe(contents);
    expect(receivedHeaders?.['content-type']).toBe('video/mp4');
    expect(receivedHeaders?.['x-amz-meta-origin']).toBe('quickcut-test');
    expect(receivedHeaders?.['content-length']).toBe(String(Buffer.byteLength(contents)));
    expect(progressValues.length).toBeGreaterThan(0);
    expect(progressValues.at(-1)).toBe(100);
  });

  it('rejects with the response body when the presigned target returns a non-2xx status', async () => {
    const filePath = await createFixtureFile('demo.mp4', 'quickcut export payload');
    const uploadUrl = await startServer(() => undefined, 403, 'AccessDenied');

    await expect(uploadFileToPresignedUrl(filePath, uploadUrl)).rejects.toThrow(
      'Presigned upload failed (403): AccessDenied',
    );
  });
});
