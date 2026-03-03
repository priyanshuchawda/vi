export const MODEL_ID = import.meta.env.VITE_BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';

export function isBedrockConfigured(): boolean {
  return Boolean(window?.electronAPI?.bedrockConverse);
}

export async function converseBedrock(input: Record<string, unknown>): Promise<any> {
  if (!window?.electronAPI?.bedrockConverse) {
    throw new Error('Bedrock IPC is unavailable');
  }

  return window.electronAPI.bedrockConverse(input);
}
