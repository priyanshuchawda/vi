import { handleCloudBackendApiRequest } from '../../electron/services/cloudBackendApi.js';

interface ApiGatewayV2Event {
  rawPath?: string;
  rawQueryString?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
}

interface ApiGatewayV2Result {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

export async function handler(event: ApiGatewayV2Event): Promise<ApiGatewayV2Result> {
  const method = event.requestContext?.http?.method ?? 'GET';
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const body =
    event.isBase64Encoded && event.body
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;

  return handleCloudBackendApiRequest({
    method,
    path: `${event.rawPath ?? '/'}${query}`,
    body,
    headers: event.headers,
  });
}
