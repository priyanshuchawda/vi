import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export async function uploadFileToPresignedUrl(
  localPath: string,
  uploadUrl: string,
  headers: Record<string, string> = {},
  onProgress?: (percent: number) => void,
): Promise<void> {
  const { size } = await stat(localPath);
  const targetUrl = new URL(uploadUrl);
  const requestImpl = targetUrl.protocol === 'http:' ? httpRequest : httpsRequest;

  await new Promise<void>((resolve, reject) => {
    const request = requestImpl(
      targetUrl,
      {
        method: 'PUT',
        headers: {
          ...headers,
          'content-length': String(size),
        },
      },
      (response) => {
        const responseChunks: Buffer[] = [];
        response.on('data', (chunk) => {
          responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode >= 200 && statusCode < 300) {
            resolve();
            return;
          }
          const body = Buffer.concat(responseChunks).toString('utf8').trim();
          reject(new Error(`Presigned upload failed (${statusCode})${body ? `: ${body}` : ''}`));
        });
      },
    );

    request.on('error', reject);

    const stream = createReadStream(localPath);
    let uploadedBytes = 0;

    stream.on('data', (chunk) => {
      uploadedBytes += chunk.length;
      onProgress?.(Math.max(1, Math.min(100, Math.round((uploadedBytes / size) * 100))));
    });

    stream.on('error', reject);
    stream.pipe(request);
  });
}
