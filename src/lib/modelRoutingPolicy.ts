import { MODEL_ID } from './bedrockGateway';
import { getStoredJson, setStoredJson, storageKeys } from './storage';

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

interface ModelHealth {
  lastSuccessAt?: number;
  lastFailureAt?: number;
  cooldownUntil?: number;
  successCount: number;
  failureCount: number;
}

interface ModelRoutingState {
  preferences: Partial<Record<RoutingIntent, string>>;
  modelHealth: Record<string, ModelHealth>;
}

const CHEAP_MODEL_ID = import.meta.env.VITE_BEDROCK_MODEL_ID_CHEAP || MODEL_ID;
const STRONG_MODEL_ID = import.meta.env.VITE_BEDROCK_MODEL_ID_STRONG || MODEL_ID;
const FAILURE_COOLDOWN_MS = 15 * 60 * 1000;

const COMPLEX_PLAN_PATTERN =
  /\b(rebuild|multi-?step|complex|full timeline|across tracks|sequence|synchronize|batch)\b/i;

const DEFAULT_ROUTING_STATE: ModelRoutingState = {
  preferences: {},
  modelHealth: {},
};

function loadRoutingState(): ModelRoutingState {
  const stored = getStoredJson<ModelRoutingState>(storageKeys.modelRoutingState);
  if (!stored) {
    return { ...DEFAULT_ROUTING_STATE };
  }

  return {
    preferences: stored.preferences || {},
    modelHealth: stored.modelHealth || {},
  };
}

function saveRoutingState(state: ModelRoutingState): void {
  setStoredJson(storageKeys.modelRoutingState, state);
}

function getModelHealth(state: ModelRoutingState, modelId: string): ModelHealth {
  return (
    state.modelHealth[modelId] || {
      successCount: 0,
      failureCount: 0,
    }
  );
}

function isModelCoolingDown(state: ModelRoutingState, modelId: string, now: number): boolean {
  const cooldownUntil = getModelHealth(state, modelId).cooldownUntil || 0;
  return cooldownUntil > now;
}

function baseRouteDecision(input: RouteModelInput): RouteModelDecision {
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

function pickFallbackByRecentSuccess(
  state: ModelRoutingState,
  baseModelId: string,
  now: number,
): string | null {
  const candidates = Array.from(new Set([baseModelId, MODEL_ID, STRONG_MODEL_ID, CHEAP_MODEL_ID]));
  const available = candidates.filter((modelId) => !isModelCoolingDown(state, modelId, now));
  if (available.length === 0) {
    return null;
  }

  const ranked = available.sort((a, b) => {
    const healthA = getModelHealth(state, a);
    const healthB = getModelHealth(state, b);
    const scoreA = healthA.lastSuccessAt || 0;
    const scoreB = healthB.lastSuccessAt || 0;
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    return candidates.indexOf(a) - candidates.indexOf(b);
  });

  return ranked[0] || null;
}

export function setRoutingModelPreference(intent: RoutingIntent, modelId: string | null): void {
  const state = loadRoutingState();
  if (!modelId) {
    delete state.preferences[intent];
  } else {
    state.preferences[intent] = modelId;
  }
  saveRoutingState(state);
}

export function getRoutingModelPreference(intent: RoutingIntent): string | null {
  const state = loadRoutingState();
  return state.preferences[intent] || null;
}

export function recordRoutingModelOutcome(modelId: string, outcome: 'success' | 'failure'): void {
  const state = loadRoutingState();
  const health = getModelHealth(state, modelId);
  const now = Date.now();

  if (outcome === 'success') {
    state.modelHealth[modelId] = {
      ...health,
      lastSuccessAt: now,
      successCount: health.successCount + 1,
      cooldownUntil: 0,
    };
  } else {
    const nextFailures = health.failureCount + 1;
    const cooldownMultiplier = Math.min(3, Math.max(1, nextFailures));
    state.modelHealth[modelId] = {
      ...health,
      lastFailureAt: now,
      failureCount: nextFailures,
      cooldownUntil: now + FAILURE_COOLDOWN_MS * cooldownMultiplier,
    };
  }

  saveRoutingState(state);
}

export function getRecentlySuccessfulModels(limit = 3): string[] {
  const state = loadRoutingState();
  return Object.entries(state.modelHealth)
    .filter(([, health]) => Boolean(health.lastSuccessAt))
    .sort((a, b) => (b[1].lastSuccessAt || 0) - (a[1].lastSuccessAt || 0))
    .slice(0, Math.max(1, limit))
    .map(([modelId]) => modelId);
}

export function routeBedrockModel(input: RouteModelInput): RouteModelDecision {
  const baseDecision = baseRouteDecision(input);
  const state = loadRoutingState();
  const now = Date.now();

  const preferredModel = state.preferences[input.intent];
  if (preferredModel && !isModelCoolingDown(state, preferredModel, now)) {
    return {
      modelId: preferredModel,
      reason: `user_preference:${input.intent}`,
    };
  }

  if (!isModelCoolingDown(state, baseDecision.modelId, now)) {
    return baseDecision;
  }

  const fallbackModel = pickFallbackByRecentSuccess(state, baseDecision.modelId, now);
  if (fallbackModel && fallbackModel !== baseDecision.modelId) {
    return {
      modelId: fallbackModel,
      reason: `fallback_recent_success:${baseDecision.reason}`,
    };
  }

  return baseDecision;
}
