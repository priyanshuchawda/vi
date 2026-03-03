import { MODEL_ID } from './bedrockGateway';

export type RoutingIntent = 'chat' | 'plan' | 'tool_followup' | 'compression';

export interface RouteModelInput {
  intent: RoutingIntent;
  message?: string;
  hasAttachments?: boolean;
  degraded?: boolean;
}

export interface RouteModelDecision {
  modelId: string;
  reason: string;
}

const CHEAP_MODEL_ID = import.meta.env.VITE_BEDROCK_MODEL_ID_CHEAP || MODEL_ID;
const STRONG_MODEL_ID = import.meta.env.VITE_BEDROCK_MODEL_ID_STRONG || MODEL_ID;

const COMPLEX_PLAN_PATTERN =
  /\b(rebuild|multi-?step|complex|full timeline|across tracks|sequence|synchronize|batch)\b/i;

export function routeBedrockModel(input: RouteModelInput): RouteModelDecision {
  if (input.degraded) {
    return {
      modelId: CHEAP_MODEL_ID,
      reason: 'degraded_budget',
    };
  }

  if (input.intent === 'compression') {
    return {
      modelId: CHEAP_MODEL_ID,
      reason: 'compression_utility',
    };
  }

  if (input.intent === 'plan') {
    if (COMPLEX_PLAN_PATTERN.test(input.message || '')) {
      return {
        modelId: STRONG_MODEL_ID,
        reason: 'complex_plan',
      };
    }
    return {
      modelId: MODEL_ID,
      reason: 'standard_plan',
    };
  }

  if (input.intent === 'chat' && !input.hasAttachments) {
    return {
      modelId: CHEAP_MODEL_ID,
      reason: 'cheap_chat',
    };
  }

  if (input.intent === 'tool_followup') {
    return {
      modelId: MODEL_ID,
      reason: 'tool_followup',
    };
  }

  return {
    modelId: MODEL_ID,
    reason: 'default',
  };
}
