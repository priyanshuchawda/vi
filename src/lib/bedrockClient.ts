/**
 * Shared Bedrock Runtime Client — Singleton
 *
 * Used by all AI services (chat, planning, memory, captioning).
 * Model: Amazon Nova Lite v1 ($0.06/1M input, $0.24/1M output)
 */

import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

const region = import.meta.env.VITE_AWS_REGION || "us-east-1";
const accessKeyId = import.meta.env.VITE_AWS_ACCESS_KEY_ID || "";
const secretAccessKey = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || "";
const sessionToken = import.meta.env.VITE_AWS_SESSION_TOKEN || undefined;

const credentials: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
} = {
  accessKeyId,
  secretAccessKey,
};

// Only include sessionToken if provided (STS temporary credentials)
if (sessionToken) {
  credentials.sessionToken = sessionToken;
}

export const bedrockClient = new BedrockRuntimeClient({
  region,
  credentials,
});

export const MODEL_ID =
  import.meta.env.VITE_BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0";

/** Check if Bedrock client is properly configured */
export function isBedrockConfigured(): boolean {
  return !!(accessKeyId && secretAccessKey);
}
