/**
 * Token Usage Tracker for AWS Bedrock (Amazon Nova Lite v1)
 *
 * Records token counts from response.usage after each API response.
 * Persists daily + session totals in localStorage.
 *
 * Bedrock response.usage format:
 *   { inputTokens, outputTokens, totalTokens }
 *
 * No cached tokens — Bedrock doesn't have a context caching equivalent.
 */

const STORAGE_KEY_DAILY = "qc_token_daily";

export interface TokenUsageRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
}

export interface DailyTokenRecord extends TokenUsageRecord {
  date: string;
}

// In-memory session accumulator (reset on page reload)
let _session: TokenUsageRecord = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  requests: 0,
};

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function loadDailyRecord(): DailyTokenRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DAILY);
    if (!raw)
      return {
        date: getTodayKey(),
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requests: 0,
      };
    const parsed = JSON.parse(raw) as DailyTokenRecord;
    if (parsed.date !== getTodayKey()) {
      return {
        date: getTodayKey(),
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requests: 0,
      };
    }
    return parsed;
  } catch {
    return {
      date: getTodayKey(),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
    };
  }
}

function saveDailyRecord(record: DailyTokenRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY_DAILY, JSON.stringify(record));
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Record token usage from a Bedrock API response.
 * Call this after every successful Bedrock response.
 *
 * Accepts either Bedrock format (inputTokens/outputTokens) or
 * the mapped format (promptTokenCount/candidatesTokenCount) for
 * backward compatibility with callers.
 */
export function recordUsage(metadata: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): void {
  const input = metadata.inputTokens ?? metadata.promptTokenCount ?? 0;
  const output = metadata.outputTokens ?? metadata.candidatesTokenCount ?? 0;
  const total =
    metadata.totalTokens ?? metadata.totalTokenCount ?? input + output;

  // Update session totals
  _session.inputTokens += input;
  _session.outputTokens += output;
  _session.totalTokens += total;
  _session.requests += 1;

  // Update daily totals
  const daily = loadDailyRecord();
  daily.inputTokens += input;
  daily.outputTokens += output;
  daily.totalTokens += total;
  daily.requests += 1;
  saveDailyRecord(daily);

  console.log(` Token usage: ${input} in, ${output} out (total: ${total})`);
}

/** Get this session's cumulative token usage (since page load) */
export function getSessionStats(): TokenUsageRecord {
  return { ..._session };
}

/** Get today's cumulative token usage (persisted across reloads) */
export function getDailyStats(): DailyTokenRecord {
  return loadDailyRecord();
}

/** Reset session totals (does NOT reset daily) */
export function resetSession(): void {
  _session = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
}

/**
 * Get the cumulative prompt tokens in the current session.
 * Used by contextManager to decide when to condense history.
 */
export function getSessionPromptTokens(): number {
  return _session.inputTokens;
}

/**
 * Get a cost summary based on Amazon Nova Lite pricing.
 */
export function getCostSummary(): {
  inputCost: string;
  outputCost: string;
  totalCost: string;
} {
  const daily = loadDailyRecord();
  const inputCost = (daily.inputTokens / 1_000_000) * 0.06;
  const outputCost = (daily.outputTokens / 1_000_000) * 0.24;
  const totalCost = inputCost + outputCost;

  return {
    inputCost: `$${inputCost.toFixed(4)}`,
    outputCost: `$${outputCost.toFixed(4)}`,
    totalCost: `$${totalCost.toFixed(4)}`,
  };
}

/** Format token count for display */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}
