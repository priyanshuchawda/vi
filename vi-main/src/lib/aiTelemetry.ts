const STORAGE_KEY = 'qc_ai_telemetry_v1';

type TelemetryState = {
  planningAttempts: number;
  planCompileFailures: number;
  fallbackCount: number;
  executionAttempts: number;
  executionValidationFailures: number;
  retryAttempts: number;
  assistantResponses: number;
  repeatedResponses: number;
  lastAssistantResponse: string;
  updatedAt: number;
};

const DEFAULT_STATE: TelemetryState = {
  planningAttempts: 0,
  planCompileFailures: 0,
  fallbackCount: 0,
  executionAttempts: 0,
  executionValidationFailures: 0,
  retryAttempts: 0,
  assistantResponses: 0,
  repeatedResponses: 0,
  lastAssistantResponse: '',
  updatedAt: Date.now(),
};

function loadState(): TelemetryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<TelemetryState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state: TelemetryState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, updatedAt: Date.now() }),
    );
  } catch {
    // ignore storage errors
  }
}

function update(mutator: (state: TelemetryState) => void): void {
  const state = loadState();
  mutator(state);
  saveState(state);
}

export function recordPlanningAttempt(metrics: {
  compileFailed?: boolean;
  fallbackUsed?: boolean;
}): void {
  update((state) => {
    state.planningAttempts += 1;
    if (metrics.compileFailed) state.planCompileFailures += 1;
    if (metrics.fallbackUsed) state.fallbackCount += 1;
  });
}

export function recordExecutionAttempt(metrics: {
  validationFailed?: boolean;
}): void {
  update((state) => {
    state.executionAttempts += 1;
    if (metrics.validationFailed) state.executionValidationFailures += 1;
  });
}

export function recordTurnRetry(): void {
  update((state) => {
    state.retryAttempts += 1;
  });
}

export function recordAssistantResponse(text: string): void {
  const normalized = (text || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return;

  update((state) => {
    state.assistantResponses += 1;
    if (state.lastAssistantResponse && state.lastAssistantResponse === normalized) {
      state.repeatedResponses += 1;
    }
    state.lastAssistantResponse = normalized;
  });
}

export function getTelemetryRates(): {
  plan_compile_fail_rate: number;
  fallback_rate: number;
  execution_validation_fail_rate: number;
  repeat_response_rate: number;
  turn_retry_rate: number;
} {
  const state = loadState();

  return {
    plan_compile_fail_rate:
      state.planningAttempts > 0
        ? state.planCompileFailures / state.planningAttempts
        : 0,
    fallback_rate:
      state.planningAttempts > 0
        ? state.fallbackCount / state.planningAttempts
        : 0,
    execution_validation_fail_rate:
      state.executionAttempts > 0
        ? state.executionValidationFailures / state.executionAttempts
        : 0,
    turn_retry_rate:
      state.executionAttempts > 0
        ? state.retryAttempts / state.executionAttempts
        : 0,
    repeat_response_rate:
      state.assistantResponses > 0
        ? state.repeatedResponses / state.assistantResponses
        : 0,
  };
}

export function resetTelemetry(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}
