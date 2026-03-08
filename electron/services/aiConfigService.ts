import fs from 'fs';
import path from 'path';
import { parse as parseDotenv } from 'dotenv';
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
  youtubeOAuthClientId: string;
  youtubeOAuthClientSecret: string;
  youtubeOAuthRedirectUri: string;
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

interface AiConfigServiceOptions {
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
}

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
  if (modelId.startsWith('arn:aws:bedrock:')) return modelId;

  // Re-prefix any cross-region Nova inference profile so a wrong-region prefix
  // from the renderer (e.g. us.amazon.nova-lite-v1:0 sent to eu-central-1)
  // gets corrected to the right prefix for awsRegion.
  const crossRegionNovaMatch = modelId.match(
    /^(?:us|eu|apac)\.(amazon\.nova-(?:micro|lite|pro|2-lite)-v1:0)$/,
  );
  if (crossRegionNovaMatch) {
    const profilePrefix = inferNovaProfilePrefix(awsRegion);
    return `${profilePrefix}.${crossRegionNovaMatch[1]}`;
  }

  // Bare model ID with no prefix — add the regional prefix for Nova models.
  const novaMatch = modelId.match(/^amazon\.(nova-(?:micro|lite|pro|2-lite)-v1:0)$/);
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
    youtubeOAuthClientId: '',
    youtubeOAuthClientSecret: '',
    youtubeOAuthRedirectUri: '',
  };
}

function blankSettings(): AiConfigSettings {
  return {
    youtubeApiKey: '',
    awsRegion: '',
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    awsSessionToken: '',
    bedrockInferenceProfileId: '',
    bedrockModelId: '',
    youtubeOAuthClientId: '',
    youtubeOAuthClientSecret: '',
    youtubeOAuthRedirectUri: '',
  };
}

function hasMeaningfulSettings(settings: AiConfigSettings): boolean {
  return (
    settings.youtubeApiKey.length > 0 ||
    settings.awsAccessKeyId.length > 0 ||
    settings.awsSecretAccessKey.length > 0 ||
    settings.awsSessionToken.length > 0 ||
    settings.bedrockInferenceProfileId.length > 0 ||
    settings.awsRegion !== DEFAULT_REGION ||
    settings.bedrockModelId !== DEFAULT_MODEL_ID
  );
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
    youtubeOAuthClientId: String(
      raw?.youtubeOAuthClientId ?? fallback.youtubeOAuthClientId ?? '',
    ).trim(),
    youtubeOAuthClientSecret: String(
      raw?.youtubeOAuthClientSecret ?? fallback.youtubeOAuthClientSecret ?? '',
    ).trim(),
    youtubeOAuthRedirectUri: String(
      raw?.youtubeOAuthRedirectUri ?? fallback.youtubeOAuthRedirectUri ?? '',
    ).trim(),
  };
}

function normalizeEnvSettings(raw: Partial<AiConfigSettings> | undefined): AiConfigSettings {
  return {
    youtubeApiKey: String(raw?.youtubeApiKey ?? '').trim(),
    awsRegion: String(raw?.awsRegion ?? '').trim(),
    awsAccessKeyId: String(raw?.awsAccessKeyId ?? '').trim(),
    awsSecretAccessKey: String(raw?.awsSecretAccessKey ?? '').trim(),
    awsSessionToken: String(raw?.awsSessionToken ?? '').trim(),
    bedrockInferenceProfileId: String(raw?.bedrockInferenceProfileId ?? '').trim(),
    bedrockModelId: String(raw?.bedrockModelId ?? '').trim(),
    youtubeOAuthClientId: String(raw?.youtubeOAuthClientId ?? '').trim(),
    youtubeOAuthClientSecret: String(raw?.youtubeOAuthClientSecret ?? '').trim(),
    youtubeOAuthRedirectUri: String(raw?.youtubeOAuthRedirectUri ?? '').trim(),
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
  private envSettings: AiConfigSettings;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly envFilePath: string;
  private settingsFingerprint = '';

  constructor(userDataPath: string, options: AiConfigServiceOptions = {}) {
    this.filePath = path.join(userDataPath, SETTINGS_FILE_NAME);
    this.baseEnv = options.env ?? process.env;
    this.envFilePath = options.envFilePath ?? path.join(process.cwd(), '.env');
    this.envSettings = blankSettings();
    this.savedSettings = emptySettings();
    this.effectiveSettings = emptySettings();
    this.syncSettings();
  }

  private loadEnvSettings(): AiConfigSettings {
    let fileEnv: Record<string, string> = {};

    try {
      if (fs.existsSync(this.envFilePath)) {
        fileEnv = parseDotenv(fs.readFileSync(this.envFilePath, 'utf8'));
      }
    } catch {
      fileEnv = {};
    }

    return normalizeEnvSettings({
      youtubeApiKey: fileEnv.YOUTUBE_API_KEY ?? this.baseEnv.YOUTUBE_API_KEY,
      awsRegion: fileEnv.AWS_REGION ?? this.baseEnv.AWS_REGION,
      awsAccessKeyId: fileEnv.AWS_ACCESS_KEY_ID ?? this.baseEnv.AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: fileEnv.AWS_SECRET_ACCESS_KEY ?? this.baseEnv.AWS_SECRET_ACCESS_KEY,
      awsSessionToken: fileEnv.AWS_SESSION_TOKEN ?? this.baseEnv.AWS_SESSION_TOKEN,
      bedrockInferenceProfileId:
        fileEnv.BEDROCK_INFERENCE_PROFILE_ID ?? this.baseEnv.BEDROCK_INFERENCE_PROFILE_ID,
      bedrockModelId: fileEnv.BEDROCK_MODEL_ID ?? this.baseEnv.BEDROCK_MODEL_ID,
      youtubeOAuthClientId: fileEnv.YOUTUBE_OAUTH_CLIENT_ID ?? this.baseEnv.YOUTUBE_OAUTH_CLIENT_ID,
      youtubeOAuthClientSecret:
        fileEnv.YOUTUBE_OAUTH_CLIENT_SECRET ?? this.baseEnv.YOUTUBE_OAUTH_CLIENT_SECRET,
      youtubeOAuthRedirectUri:
        fileEnv.YOUTUBE_OAUTH_REDIRECT_URI ?? this.baseEnv.YOUTUBE_OAUTH_REDIRECT_URI,
    });
  }

  private syncSettings(): void {
    const nextEnvSettings = this.loadEnvSettings();
    const nextSavedSettings = normalizeSettings(
      readJsonFile<Partial<AiConfigSettings>>(this.filePath) || undefined,
      emptySettings(),
    );
    const nextEffectiveSettings = this.buildEffectiveSettings(nextSavedSettings, nextEnvSettings);
    const nextFingerprint = JSON.stringify({
      env: nextEnvSettings,
      saved: nextSavedSettings,
      effective: nextEffectiveSettings,
    });

    if (nextFingerprint === this.settingsFingerprint) {
      return;
    }

    this.settingsFingerprint = nextFingerprint;
    this.envSettings = nextEnvSettings;
    this.savedSettings = nextSavedSettings;
    this.effectiveSettings = nextEffectiveSettings;
    this.rebuildClients();
  }

  private buildEffectiveSettings(
    savedSettings: AiConfigSettings = this.savedSettings,
    envSettings: AiConfigSettings = this.envSettings,
  ): AiConfigSettings {
    return {
      youtubeApiKey: envSettings.youtubeApiKey || savedSettings.youtubeApiKey,
      awsRegion: envSettings.awsRegion || savedSettings.awsRegion || DEFAULT_REGION,
      awsAccessKeyId: envSettings.awsAccessKeyId || savedSettings.awsAccessKeyId,
      awsSecretAccessKey: envSettings.awsSecretAccessKey || savedSettings.awsSecretAccessKey,
      awsSessionToken: envSettings.awsSessionToken || savedSettings.awsSessionToken,
      bedrockInferenceProfileId:
        envSettings.bedrockInferenceProfileId || savedSettings.bedrockInferenceProfileId,
      bedrockModelId: envSettings.bedrockModelId || savedSettings.bedrockModelId,
      youtubeOAuthClientId: envSettings.youtubeOAuthClientId || savedSettings.youtubeOAuthClientId,
      youtubeOAuthClientSecret:
        envSettings.youtubeOAuthClientSecret || savedSettings.youtubeOAuthClientSecret,
      youtubeOAuthRedirectUri:
        envSettings.youtubeOAuthRedirectUri || savedSettings.youtubeOAuthRedirectUri,
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
    this.syncSettings();
    return { ...this.effectiveSettings };
  }

  getSavedSettings(): AiConfigSettings {
    this.syncSettings();
    return { ...this.savedSettings };
  }

  applyAwsSdkEnvFallback(targetEnv: NodeJS.ProcessEnv = process.env): void {
    this.syncSettings();
    const hasSavedAwsConfig =
      this.savedSettings.awsRegion !== DEFAULT_REGION ||
      Boolean(
        this.savedSettings.awsAccessKeyId ||
        this.savedSettings.awsSecretAccessKey ||
        this.savedSettings.awsSessionToken,
      );
    const savedAwsRegion = hasSavedAwsConfig ? this.savedSettings.awsRegion : '';

    const syncKey = (envKey: keyof NodeJS.ProcessEnv, effectiveValue: string, envValue: string) => {
      if (envValue) {
        targetEnv[envKey] = envValue;
        return;
      }

      if (effectiveValue) {
        targetEnv[envKey] = effectiveValue;
        return;
      }

      delete targetEnv[envKey];
    };

    syncKey('AWS_REGION', savedAwsRegion, this.envSettings.awsRegion);
    syncKey(
      'AWS_ACCESS_KEY_ID',
      this.effectiveSettings.awsAccessKeyId,
      this.envSettings.awsAccessKeyId,
    );
    syncKey(
      'AWS_SECRET_ACCESS_KEY',
      this.effectiveSettings.awsSecretAccessKey,
      this.envSettings.awsSecretAccessKey,
    );
    if (this.envSettings.awsSessionToken) {
      targetEnv.AWS_SESSION_TOKEN = this.envSettings.awsSessionToken;
    } else if (this.envSettings.awsAccessKeyId || this.envSettings.awsSecretAccessKey) {
      delete targetEnv.AWS_SESSION_TOKEN;
    } else if (this.effectiveSettings.awsSessionToken) {
      targetEnv.AWS_SESSION_TOKEN = this.effectiveSettings.awsSessionToken;
    } else {
      delete targetEnv.AWS_SESSION_TOKEN;
    }
  }

  getStatus(): AiConfigStatus {
    this.syncSettings();
    const usingEnvFallback = hasMeaningfulSettings(this.envSettings);
    const usingSavedSettings = !usingEnvFallback && hasMeaningfulSettings(this.savedSettings);
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
      usingEnvFallback,
      missingBedrockFields: bedrockMissing,
      missingYouTubeFields: youtubeMissing,
    };
  }

  saveSettings(nextSettings: AiConfigSettings): void {
    this.savedSettings = normalizeSettings(nextSettings, emptySettings());
    writeJsonFile(this.filePath, this.savedSettings);
    this.settingsFingerprint = '';
    this.syncSettings();
  }

  getAnalysisService(): ChannelAnalysisService | null {
    this.syncSettings();
    return this.analysisService;
  }

  getBedrockClient(): BedrockRuntimeClient | null {
    this.syncSettings();
    return this.bedrockClient;
  }
}
