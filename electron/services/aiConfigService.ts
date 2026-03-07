import fs from 'fs';
import path from 'path';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { ChannelAnalysisService } from './channelAnalysisService.js';

export interface AiConfigSettings {
  youtubeApiKey: string;
  awsRegion: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsSessionToken: string;
  bedrockInferenceProfileId: string;
  bedrockModelId: string;
}

export interface AiConfigStatus {
  bedrockReady: boolean;
  youtubeReady: boolean;
  usingSavedSettings: boolean;
  usingEnvFallback: boolean;
  missingBedrockFields: string[];
  missingYouTubeFields: string[];
}

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_MODEL_ID = 'amazon.nova-lite-v1:0';
const SETTINGS_FILE_NAME = 'ai-settings.json';

function inferNovaProfilePrefix(region: string): 'us' | 'eu' | 'apac' {
  const normalized = region.toLowerCase();
  if (normalized.startsWith('eu-')) return 'eu';
  if (normalized.startsWith('ap-')) return 'apac';
  return 'us';
}

export function normalizeBedrockModelIdentifier(
  modelId: string,
  awsRegion: string,
  explicitInferenceProfileId?: string,
): string {
  const trimmedExplicit = explicitInferenceProfileId?.trim();
  if (trimmedExplicit) return trimmedExplicit;
  if (!modelId) return modelId;
  if (modelId.startsWith('arn:aws:bedrock:') || /^(us|eu|apac)\./.test(modelId)) {
    return modelId;
  }
  const novaMatch = modelId.match(/^amazon\.(nova-(micro|lite|pro)-v1:0)$/);
  if (novaMatch) {
    const profilePrefix = inferNovaProfilePrefix(awsRegion);
    return `${profilePrefix}.amazon.${novaMatch[1]}`;
  }
  return modelId;
}

function emptySettings(): AiConfigSettings {
  return {
    youtubeApiKey: '',
    awsRegion: DEFAULT_REGION,
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    awsSessionToken: '',
    bedrockInferenceProfileId: '',
    bedrockModelId: DEFAULT_MODEL_ID,
  };
}

function normalizeSettings(
  raw: Partial<AiConfigSettings> | undefined,
  fallback: AiConfigSettings,
): AiConfigSettings {
  return {
    youtubeApiKey: String(raw?.youtubeApiKey ?? fallback.youtubeApiKey ?? '').trim(),
    awsRegion:
      String(raw?.awsRegion ?? fallback.awsRegion ?? DEFAULT_REGION).trim() || DEFAULT_REGION,
    awsAccessKeyId: String(raw?.awsAccessKeyId ?? fallback.awsAccessKeyId ?? '').trim(),
    awsSecretAccessKey: String(raw?.awsSecretAccessKey ?? fallback.awsSecretAccessKey ?? '').trim(),
    awsSessionToken: String(raw?.awsSessionToken ?? fallback.awsSessionToken ?? '').trim(),
    bedrockInferenceProfileId: String(
      raw?.bedrockInferenceProfileId ?? fallback.bedrockInferenceProfileId ?? '',
    ).trim(),
    bedrockModelId:
      String(raw?.bedrockModelId ?? fallback.bedrockModelId ?? DEFAULT_MODEL_ID).trim() ||
      DEFAULT_MODEL_ID,
  };
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export class AiConfigService {
  private savedSettings: AiConfigSettings;
  private effectiveSettings: AiConfigSettings;
  private analysisService: ChannelAnalysisService | null = null;
  private bedrockClient: BedrockRuntimeClient | null = null;
  private readonly filePath: string;
  private readonly envSettings: AiConfigSettings;

  constructor(userDataPath: string, env: NodeJS.ProcessEnv = process.env) {
    this.filePath = path.join(userDataPath, SETTINGS_FILE_NAME);
    this.envSettings = normalizeSettings(
      {
        youtubeApiKey: env.YOUTUBE_API_KEY,
        awsRegion: env.AWS_REGION,
        awsAccessKeyId: env.AWS_ACCESS_KEY_ID,
        awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        awsSessionToken: env.AWS_SESSION_TOKEN,
        bedrockInferenceProfileId: env.BEDROCK_INFERENCE_PROFILE_ID,
        bedrockModelId: env.BEDROCK_MODEL_ID,
      },
      emptySettings(),
    );
    this.savedSettings = normalizeSettings(
      readJsonFile<Partial<AiConfigSettings>>(this.filePath) || undefined,
      emptySettings(),
    );
    this.effectiveSettings = this.buildEffectiveSettings();
    this.rebuildClients();
  }

  private buildEffectiveSettings(): AiConfigSettings {
    return {
      youtubeApiKey: this.savedSettings.youtubeApiKey || this.envSettings.youtubeApiKey,
      awsRegion: this.savedSettings.awsRegion || this.envSettings.awsRegion || DEFAULT_REGION,
      awsAccessKeyId: this.savedSettings.awsAccessKeyId || this.envSettings.awsAccessKeyId,
      awsSecretAccessKey:
        this.savedSettings.awsSecretAccessKey || this.envSettings.awsSecretAccessKey,
      awsSessionToken: this.savedSettings.awsSessionToken || this.envSettings.awsSessionToken,
      bedrockInferenceProfileId:
        this.savedSettings.bedrockInferenceProfileId || this.envSettings.bedrockInferenceProfileId,
      bedrockModelId: this.savedSettings.bedrockModelId || this.envSettings.bedrockModelId,
    };
  }

  private rebuildClients(): void {
    this.analysisService = null;
    this.bedrockClient = null;

    if (
      this.effectiveSettings.youtubeApiKey &&
      this.effectiveSettings.awsAccessKeyId &&
      this.effectiveSettings.awsSecretAccessKey
    ) {
      this.analysisService = new ChannelAnalysisService(
        this.effectiveSettings.youtubeApiKey,
        this.effectiveSettings.awsRegion,
        this.effectiveSettings.awsAccessKeyId,
        this.effectiveSettings.awsSecretAccessKey,
        normalizeBedrockModelIdentifier(
          this.effectiveSettings.bedrockModelId,
          this.effectiveSettings.awsRegion,
          this.effectiveSettings.bedrockInferenceProfileId,
        ),
        this.effectiveSettings.awsSessionToken || undefined,
      );
    }

    if (this.effectiveSettings.awsAccessKeyId && this.effectiveSettings.awsSecretAccessKey) {
      this.bedrockClient = new BedrockRuntimeClient({
        region: this.effectiveSettings.awsRegion,
        maxAttempts: 4,
        retryMode: 'adaptive',
        requestHandler: new NodeHttpHandler({
          connectionTimeout: 5_000,
          requestTimeout: 30_000,
          socketTimeout: 30_000,
        }),
        credentials: {
          accessKeyId: this.effectiveSettings.awsAccessKeyId,
          secretAccessKey: this.effectiveSettings.awsSecretAccessKey,
          ...(this.effectiveSettings.awsSessionToken
            ? { sessionToken: this.effectiveSettings.awsSessionToken }
            : {}),
        },
      });
    }
  }

  getSettings(): AiConfigSettings {
    return { ...this.effectiveSettings };
  }

  getSavedSettings(): AiConfigSettings {
    return { ...this.savedSettings };
  }

  getStatus(): AiConfigStatus {
    const usingSavedSettings = Object.values(this.savedSettings).some(
      (value) => String(value || '').trim().length > 0,
    );
    const bedrockMissing: string[] = [];
    if (!this.effectiveSettings.awsRegion) bedrockMissing.push('AWS Region');
    if (!this.effectiveSettings.awsAccessKeyId) bedrockMissing.push('AWS Access Key ID');
    if (!this.effectiveSettings.awsSecretAccessKey) bedrockMissing.push('AWS Secret Access Key');

    const youtubeMissing: string[] = [];
    if (!this.effectiveSettings.youtubeApiKey) youtubeMissing.push('YouTube API Key');

    return {
      bedrockReady: bedrockMissing.length === 0,
      youtubeReady: youtubeMissing.length === 0,
      usingSavedSettings,
      usingEnvFallback:
        !usingSavedSettings &&
        Boolean(
          this.envSettings.awsAccessKeyId ||
          this.envSettings.awsSecretAccessKey ||
          this.envSettings.youtubeApiKey,
        ),
      missingBedrockFields: bedrockMissing,
      missingYouTubeFields: youtubeMissing,
    };
  }

  saveSettings(nextSettings: AiConfigSettings): void {
    this.savedSettings = normalizeSettings(nextSettings, emptySettings());
    writeJsonFile(this.filePath, this.savedSettings);
    this.effectiveSettings = this.buildEffectiveSettings();
    this.rebuildClients();
  }

  getAnalysisService(): ChannelAnalysisService | null {
    return this.analysisService;
  }

  getBedrockClient(): BedrockRuntimeClient | null {
    return this.bedrockClient;
  }
}
