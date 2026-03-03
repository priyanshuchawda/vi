import path from 'path';
import { config as loadEnv } from 'dotenv';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';

loadEnv({ path: path.resolve(process.cwd(), '.env') });

function inferNovaProfilePrefix(region) {
  const normalized = String(region || '').toLowerCase();
  if (normalized.startsWith('eu-')) return 'eu';
  if (normalized.startsWith('ap-')) return 'apac';
  return 'us';
}

function normalizeBedrockModelIdentifier(modelId, awsRegion, explicitInferenceProfileId) {
  const trimmedExplicit = String(explicitInferenceProfileId || '').trim();
  if (trimmedExplicit) return trimmedExplicit;
  if (!modelId) return modelId;
  if (modelId.startsWith('arn:aws:bedrock:') || /^(us|eu|apac)\./.test(modelId)) return modelId;
  const novaMatch = modelId.match(/^amazon\.(nova-(micro|lite|pro)-v1:0)$/);
  if (novaMatch) return `${inferNovaProfilePrefix(awsRegion)}.amazon.${novaMatch[1]}`;
  return modelId;
}

function endpointProbe(region) {
  const hostname = `bedrock-runtime.${region}.amazonaws.com`;
  return new Promise((resolve) => {
    const req = https.request(
      {
        method: 'GET',
        host: hostname,
        path: '/',
        timeout: 5000,
      },
      (res) => {
        resolve({ ok: true, hostname, statusCode: res.statusCode || 0 });
        res.resume();
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (error) => {
      resolve({
        ok: false,
        hostname,
        code: error?.code || 'UNKNOWN',
        message: error?.message || 'Unknown network error',
      });
    });
    req.end();
  });
}

async function main() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
  const sessionToken = process.env.AWS_SESSION_TOKEN || '';
  const rawModelId = process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';
  const inferenceProfile = process.env.BEDROCK_INFERENCE_PROFILE_ID || '';
  const modelId = normalizeBedrockModelIdentifier(rawModelId, region, inferenceProfile);

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY in .env');
  }

  const probe = await endpointProbe(region);
  console.log('[probe]', probe);
  console.log('[config]', {
    region,
    modelId,
    hasInferenceProfile: Boolean(inferenceProfile),
    hasSessionToken: Boolean(sessionToken),
  });

  const client = new BedrockRuntimeClient({
    region,
    maxAttempts: 4,
    retryMode: 'adaptive',
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5000,
      requestTimeout: 30000,
      socketTimeout: 30000,
    }),
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  });

  const started = Date.now();
  const response = await client.send(
    new ConverseCommand({
      modelId,
      messages: [
        {
          role: 'user',
          content: [{ text: 'Reply with exactly: bedrock-ok' }],
        },
      ],
      inferenceConfig: {
        maxTokens: 16,
        temperature: 0,
      },
    }),
  );

  const tookMs = Date.now() - started;
  const text = (response.output?.message?.content || [])
    .map((part) => part?.text || '')
    .join(' ')
    .trim();

  console.log('[result]', {
    tookMs,
    output: text,
    usage: response.usage || null,
  });
}

main().catch((error) => {
  console.error('[bedrock-test-failed]', {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    code: error?.code || null,
    stackTop: String(error?.stack || '').split('\n').slice(0, 4).join('\n'),
  });
  process.exit(1);
});
