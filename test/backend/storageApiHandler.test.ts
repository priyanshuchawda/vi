// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import * as cloudBackendApiModule from '../../electron/services/cloudBackendApi.js';
import { handler } from '../../backend/lambda/storageApiHandler.js';

describe('storageApiHandler Lambda entrypoint', () => {
  it('maps API Gateway v2 events into the shared backend handler request shape', async () => {
    const apiSpy = vi
      .spyOn(cloudBackendApiModule, 'handleCloudBackendApiRequest')
      .mockResolvedValue({
        statusCode: 204,
        headers: {},
        body: '',
      });

    const result = await handler({
      rawPath: '/memory/projects%2Falpha%2Fmemory.json',
      rawQueryString: '',
      body: Buffer.from(JSON.stringify({ content: 'hello' }), 'utf8').toString('base64'),
      isBase64Encoded: true,
      headers: {
        authorization: 'Bearer test-token',
      },
      requestContext: {
        http: {
          method: 'PUT',
        },
      },
    });

    expect(result.statusCode).toBe(204);
    expect(apiSpy).toHaveBeenCalledWith({
      method: 'PUT',
      path: '/memory/projects%2Falpha%2Fmemory.json',
      body: JSON.stringify({ content: 'hello' }),
      headers: {
        authorization: 'Bearer test-token',
      },
    });
  });
});
