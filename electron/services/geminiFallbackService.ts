import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
  type Tool,
} from '@google/genai';
import type { AiConfigSettings } from './aiConfigService.js';

export const DEFAULT_GEMINI_MODEL_ID = 'gemini-2.5-flash-lite';

type BedrockContentBlock = Record<string, unknown>;

export interface BedrockConverseMessage {
  role: 'user' | 'assistant';
  content: BedrockContentBlock[];
}

export interface BedrockConverseInput {
  modelId?: string;
  messages?: BedrockConverseMessage[];
  system?: Array<{ text?: string }>;
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  };
  toolConfig?: {
    tools?: Array<{
      toolSpec?: {
        name?: string;
        description?: string;
        inputSchema?: { json?: unknown };
      };
    }>;
  };
}

export interface BedrockConverseResponse {
  output?: Record<string, unknown>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  stopReason?: string;
  [key: string]: unknown;
}

interface ProviderFallbackOptions {
  commandInput: BedrockConverseInput;
  settings: Pick<
    AiConfigSettings,
    'awsAccessKeyId' | 'awsSecretAccessKey' | 'geminiApiKey' | 'geminiModelId'
  >;
  sendBedrock: () => Promise<BedrockConverseResponse>;
  sendGemini?: (
    commandInput: BedrockConverseInput,
    settings: Pick<AiConfigSettings, 'geminiApiKey' | 'geminiModelId'>,
  ) => Promise<BedrockConverseResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function getGeminiModelId(settings: Pick<AiConfigSettings, 'geminiModelId'>): string {
  return settings.geminiModelId.trim() || DEFAULT_GEMINI_MODEL_ID;
}

function bytesToBase64(bytes: unknown): string {
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes).toString('base64');
  }
  if (ArrayBuffer.isView(bytes)) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  if (bytes instanceof ArrayBuffer) {
    return Buffer.from(bytes).toString('base64');
  }
  if (Array.isArray(bytes) && bytes.every((value) => typeof value === 'number')) {
    return Buffer.from(bytes).toString('base64');
  }
  throw new Error('Gemini fallback received unsupported inline media bytes.');
}

function formatToMimeType(kind: string, format: string): string {
  const normalizedKind = kind.toLowerCase();
  const normalizedFormat = format.toLowerCase();
  const key = `${normalizedKind}:${normalizedFormat}`;
  const map: Record<string, string> = {
    'image:jpg': 'image/jpeg',
    'image:jpeg': 'image/jpeg',
    'image:png': 'image/png',
    'image:webp': 'image/webp',
    'image:heic': 'image/heic',
    'image:heif': 'image/heif',
    'video:mp4': 'video/mp4',
    'video:mov': 'video/quicktime',
    'video:webm': 'video/webm',
    'video:mkv': 'video/x-matroska',
    'video:avi': 'video/x-msvideo',
    'audio:mp3': 'audio/mpeg',
    'audio:wav': 'audio/wav',
    'audio:aac': 'audio/aac',
    'audio:ogg': 'audio/ogg',
    'audio:flac': 'audio/flac',
    'document:pdf': 'application/pdf',
  };

  return map[key] || `${normalizedKind}/${normalizedFormat}`;
}

function extractInlineMediaPart(
  kind: 'image' | 'video' | 'audio' | 'document',
  value: unknown,
): Part {
  const media = asRecord(value);
  const format = String(media.format ?? '').trim();
  const source = asRecord(media.source);
  const bytes = source.bytes;

  if (!format || bytes === undefined) {
    throw new Error(`Gemini fallback could not map ${kind} content to inline data.`);
  }

  return {
    inlineData: {
      mimeType: formatToMimeType(kind, format),
      data: bytesToBase64(bytes),
    },
  };
}

function extractToolResultPayload(content: unknown): Record<string, unknown> {
  if (!Array.isArray(content)) {
    return {};
  }

  const mapped = content
    .map((entry) => {
      const part = asRecord(entry);
      if ('json' in part) {
        const jsonValue = part.json;
        return isRecord(jsonValue) ? jsonValue : { output: jsonValue };
      }
      if (typeof part.text === 'string') {
        return { output: part.text };
      }
      return null;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  if (mapped.length === 0) return {};
  if (mapped.length === 1) return mapped[0];
  return { output: mapped };
}

function buildToolUseNameIndex(messages: BedrockConverseMessage[]): Map<string, string> {
  const toolUseNameById = new Map<string, string>();

  for (const message of messages) {
    for (const block of message.content || []) {
      const toolUse = asRecord(block.toolUse);
      const toolUseId = String(toolUse.toolUseId ?? '').trim();
      const toolName = String(toolUse.name ?? '').trim();
      if (toolUseId && toolName) {
        toolUseNameById.set(toolUseId, toolName);
      }
    }
  }

  return toolUseNameById;
}

function bedrockBlockToGeminiPart(
  block: BedrockContentBlock,
  toolUseNameById: Map<string, string>,
): Part | null {
  if (typeof block.text === 'string') {
    return { text: block.text };
  }

  if (block.image) {
    return extractInlineMediaPart('image', block.image);
  }
  if (block.video) {
    return extractInlineMediaPart('video', block.video);
  }
  if (block.audio) {
    return extractInlineMediaPart('audio', block.audio);
  }
  if (block.document) {
    return extractInlineMediaPart('document', block.document);
  }

  if (block.toolUse) {
    const toolUse = asRecord(block.toolUse);
    const toolUseId = String(toolUse.toolUseId ?? '').trim();
    const toolName = String(toolUse.name ?? '').trim();

    if (!toolName) {
      throw new Error('Gemini fallback received a tool call without a tool name.');
    }

    return {
      functionCall: {
        id: toolUseId || undefined,
        name: toolName,
        args: asRecord(toolUse.input),
      },
    };
  }

  if (block.toolResult) {
    const toolResult = asRecord(block.toolResult);
    const toolUseId = String(toolResult.toolUseId ?? '').trim();
    const toolName = toolUseNameById.get(toolUseId);

    if (!toolUseId || !toolName) {
      throw new Error(
        'Gemini fallback could not resolve the tool name for a Bedrock tool result block.',
      );
    }

    return {
      functionResponse: {
        id: toolUseId,
        name: toolName,
        response: extractToolResultPayload(toolResult.content),
      },
    };
  }

  return null;
}

export function buildGeminiGenerateContentRequest(
  input: BedrockConverseInput,
  settings: Pick<AiConfigSettings, 'geminiModelId'>,
): GenerateContentParameters {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const toolUseNameById = buildToolUseNameIndex(messages);

  const contents: Content[] = [];
  for (const message of messages) {
    const parts: Part[] = [];
    for (const block of message.content || []) {
      const part = bedrockBlockToGeminiPart(block, toolUseNameById);
      if (part) {
        parts.push(part);
      }
    }

    if (parts.length === 0) continue;

    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }

  const systemInstruction = (input.system || [])
    .map((entry) => (typeof entry?.text === 'string' ? entry.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n');

  const functionDeclarations: FunctionDeclaration[] = [];
  for (const tool of input.toolConfig?.tools || []) {
    const toolSpec = tool.toolSpec;
    if (!toolSpec?.name) continue;
    functionDeclarations.push({
      name: toolSpec.name,
      description: toolSpec.description,
      parametersJsonSchema: toolSpec.inputSchema?.json ?? {
        type: 'object',
        properties: {},
      },
    });
  }

  const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

  return {
    model: getGeminiModelId(settings),
    contents,
    config: {
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(typeof input.inferenceConfig?.temperature === 'number'
        ? { temperature: input.inferenceConfig.temperature }
        : {}),
      ...(typeof input.inferenceConfig?.topP === 'number'
        ? { topP: input.inferenceConfig.topP }
        : {}),
      ...(typeof input.inferenceConfig?.maxTokens === 'number'
        ? { maxOutputTokens: input.inferenceConfig.maxTokens }
        : {}),
      ...(Array.isArray(input.inferenceConfig?.stopSequences) &&
      input.inferenceConfig.stopSequences.length > 0
        ? { stopSequences: input.inferenceConfig.stopSequences }
        : {}),
      ...(tools.length > 0
        ? {
            tools,
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingConfigMode.AUTO,
              },
            },
          }
        : {}),
    },
  };
}

function mapGeminiStopReason(response: GenerateContentResponse): string {
  const firstCandidate = response.candidates?.[0];
  const parts = firstCandidate?.content?.parts || [];
  if (parts.some((part) => Boolean(part.functionCall?.name))) {
    return 'tool_use';
  }
  if (firstCandidate?.finishReason === 'MAX_TOKENS') {
    return 'max_tokens';
  }
  return 'end_turn';
}

export function translateGeminiResponseToBedrock(
  response: GenerateContentResponse,
): BedrockConverseResponse {
  const firstCandidate = response.candidates?.[0];
  const parts = firstCandidate?.content?.parts || [];

  const content: Array<Record<string, unknown>> = [];
  for (const [index, part] of parts.entries()) {
    if (typeof part.text === 'string' && part.text.length > 0) {
      content.push({ text: part.text });
      continue;
    }

    if (part.functionCall?.name) {
      const toolUseId = part.functionCall.id || `gemini-tool-${index + 1}`;
      content.push({
        toolUse: {
          toolUseId,
          name: part.functionCall.name,
          input: asRecord(part.functionCall.args),
        },
      });
    }
  }

  return {
    output: {
      message: {
        role: 'assistant',
        content,
      },
    },
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
      totalTokens: response.usageMetadata?.totalTokenCount,
    },
    stopReason: mapGeminiStopReason(response),
    provider: 'gemini',
    modelVersion: response.modelVersion,
  };
}

export function shouldFallbackToGemini(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  return [
    'bedrock gateway unavailable',
    'missing aws credentials',
    'aws credentials expired',
    'expiredtoken',
    'security token included in the request is expired',
    'bedrock endpoint unreachable',
    'socket hang up',
    'eai_again',
    'econnrefused',
    'enotfound',
    'econnreset',
    'timeout',
    'timed out',
    'service unavailable',
    'too many requests',
    'throttl',
    'rate exceeded',
    'access denied',
    'accessdeniedexception',
    'not authorized to invoke model',
    'invalid security token',
  ].some((token) => message.includes(token));
}

export async function sendGeminiConverse(
  input: BedrockConverseInput,
  settings: Pick<AiConfigSettings, 'geminiApiKey' | 'geminiModelId'>,
): Promise<BedrockConverseResponse> {
  const apiKey = settings.geminiApiKey.trim();
  if (!apiKey) {
    throw new Error('Gemini fallback is unavailable: missing GEMINI_API_KEY.');
  }

  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent(
    buildGeminiGenerateContentRequest(input, settings),
  );

  return translateGeminiResponseToBedrock(response);
}

export async function converseWithProviderFallback({
  commandInput,
  settings,
  sendBedrock,
  sendGemini = sendGeminiConverse,
}: ProviderFallbackOptions): Promise<{
  provider: 'bedrock' | 'gemini';
  response: BedrockConverseResponse;
}> {
  const bedrockReady = Boolean(
    settings.awsAccessKeyId.trim() && settings.awsSecretAccessKey.trim(),
  );
  const geminiReady = Boolean(settings.geminiApiKey.trim());

  if (!bedrockReady) {
    if (!geminiReady) {
      return {
        provider: 'bedrock',
        response: await sendBedrock(),
      };
    }

    return {
      provider: 'gemini',
      response: await sendGemini(commandInput, settings),
    };
  }

  try {
    return {
      provider: 'bedrock',
      response: await sendBedrock(),
    };
  } catch (error) {
    if (!geminiReady || !shouldFallbackToGemini(error)) {
      throw error;
    }

    return {
      provider: 'gemini',
      response: await sendGemini(commandInput, settings),
    };
  }
}
