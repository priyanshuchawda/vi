function inferNovaProfilePrefix(region: string): 'us' | 'eu' | 'apac' {
  const normalized = region.toLowerCase();
  if (normalized.startsWith('eu-')) return 'eu';
  if (normalized.startsWith('ap-')) return 'apac';
  return 'us';
}

const defaultNovaInferenceProfile = `${inferNovaProfilePrefix(
  import.meta.env.VITE_AWS_REGION || 'us-east-1',
)}.amazon.nova-lite-v1:0`;

export const MODEL_ID =
  import.meta.env.VITE_BEDROCK_INFERENCE_PROFILE_ID ||
  import.meta.env.VITE_BEDROCK_MODEL_ID ||
  defaultNovaInferenceProfile;

export interface BedrockConverseResponse {
  output?: {
    message?: {
      role?: string;
      content?: Array<{
        text?: string;
        toolUse?: unknown;
        toolResult?: unknown;
        [key: string]: unknown;
      }>;
    };
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  stopReason?: string;
  [key: string]: unknown;
}

export function isBedrockConfigured(): boolean {
  return Boolean(window?.electronAPI?.bedrockConverse);
}

export async function converseBedrock(
  input: Record<string, unknown>,
): Promise<BedrockConverseResponse> {
  if (!window?.electronAPI?.bedrockConverse) {
    throw new Error('Bedrock IPC is unavailable');
  }

  return window.electronAPI.bedrockConverse(input) as Promise<BedrockConverseResponse>;
}
