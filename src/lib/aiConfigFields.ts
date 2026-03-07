import type { AiConfigSettings } from '../types/electron';

export type AiConfigFieldKey = keyof AiConfigSettings;

export interface AiConfigFieldDefinition {
  key: AiConfigFieldKey;
  envName: string;
  placeholder: string;
  optional?: boolean;
  secret?: boolean;
  helperText: string;
}

export const AI_CONFIG_FIELDS: AiConfigFieldDefinition[] = [
  {
    key: 'awsRegion',
    envName: 'AWS_REGION',
    placeholder: 'us-east-1',
    helperText: 'Bedrock region for the AI editor.',
  },
  {
    key: 'awsAccessKeyId',
    envName: 'AWS_ACCESS_KEY_ID',
    placeholder: 'AKIA...',
    helperText: 'IAM access key used for Bedrock requests.',
  },
  {
    key: 'awsSecretAccessKey',
    envName: 'AWS_SECRET_ACCESS_KEY',
    placeholder: 'Paste your Bedrock secret access key',
    secret: true,
    helperText: 'Secret paired with the access key.',
  },
  {
    key: 'awsSessionToken',
    envName: 'AWS_SESSION_TOKEN',
    placeholder: 'Temporary session token',
    optional: true,
    secret: true,
    helperText: 'Only needed for temporary AWS credentials.',
  },
  {
    key: 'bedrockInferenceProfileId',
    envName: 'BEDROCK_INFERENCE_PROFILE_ID',
    placeholder: 'us.amazon.nova-lite-v1:0',
    optional: true,
    helperText: 'Optional inference profile override for Bedrock.',
  },
  {
    key: 'bedrockModelId',
    envName: 'BEDROCK_MODEL_ID',
    placeholder: 'amazon.nova-lite-v1:0',
    optional: true,
    helperText: 'Optional model override if you are not using the default.',
  },
  {
    key: 'youtubeApiKey',
    envName: 'YOUTUBE_API_KEY',
    placeholder: 'Needed only for creator/channel analysis',
    optional: true,
    secret: true,
    helperText: 'Used only for YouTube analysis features.',
  },
];

const REQUIRED_BEDROCK_FIELDS: AiConfigFieldKey[] = [
  'awsRegion',
  'awsAccessKeyId',
  'awsSecretAccessKey',
];

export function getMissingBedrockFieldNames(settings: AiConfigSettings): string[] {
  return REQUIRED_BEDROCK_FIELDS.flatMap((key) => {
    const value = settings[key];
    const field = AI_CONFIG_FIELDS.find((candidate) => candidate.key === key);
    if (!field || value.trim()) {
      return [];
    }
    return [field.envName];
  });
}
