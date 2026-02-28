/**
 * AWS Bedrock Rate Limiter
 *
 * Bedrock on-demand inference has much higher limits than AI free tier:
 *   - Default: ~100+ RPM (region-dependent, adjustable via quotas)
 *   - No strict RPD limit (pay-per-use)
 *
 * We keep the rate limiter to:
 *   1. Prevent accidental bursts that could trigger throttling
 *   2. Track request counts for monitoring
 *   3. Handle ThrottlingException retries gracefully
 *
 * Limits are set conservatively for safety.
 */

const STORAGE_KEY_RPM = "qc_rpm_timestamps";
const STORAGE_KEY_RPD = "qc_rpd_date_count";

const RPM_LIMIT = 60; // Conservative — Bedrock supports much higher
const RPD_LIMIT = 10_000; // Soft limit for cost awareness
const WINDOW_MS = 60_000;

// In-memory mirror
let _timestamps: number[] = [];
let _initialized = false;

function loadTimestamps(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RPM);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

function saveTimestamps(ts: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_RPM, JSON.stringify(ts));
  } catch {
    localStorage.removeItem(STORAGE_KEY_RPM);
  }
}

function pruneOld(now: number): number[] {
  const cutoff = now - WINDOW_MS;
  _timestamps = _timestamps.filter((t) => t > cutoff);
  return _timestamps;
}

function init(): void {
  if (_initialized) return;
  _timestamps = loadTimestamps();
  _initialized = true;
}

/** How many requests have been made in the last 60 seconds */
export function getRequestsInWindow(): number {
  init();
  const now = Date.now();
  pruneOld(now);
  return _timestamps.length;
}

/** Milliseconds until the oldest request in the window drops out */
export function msUntilSlotFree(): number {
  init();
  const now = Date.now();
  pruneOld(now);
  if (_timestamps.length < RPM_LIMIT) return 0;
  const oldest = _timestamps[0];
  return Math.max(0, oldest + WINDOW_MS - now + 50);
}

/** Record a request (call this right before/after making an API call) */
export function recordRequest(): void {
  init();
  const now = Date.now();
  pruneOld(now);
  _timestamps.push(now);
  saveTimestamps(_timestamps);
  incrementDailyCount();
}

/**
 * Wait until a request slot is available, then record the request.
 * Call this before EVERY Bedrock API call.
 */
export async function waitForSlot(
  onWaiting?: (msRemaining: number) => void,
): Promise<void> {
  init();
  let waitMs = msUntilSlotFree();

  while (waitMs > 0) {
    onWaiting?.(waitMs);
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 1000)));
    waitMs = msUntilSlotFree();
  }

  recordRequest();
}

// ── Daily RPD tracking ─────────────────────────────────────────────────────

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function getDailyRecord(): { date: string; count: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RPD);
    if (!raw) return { date: getTodayKey(), count: 0 };
    const parsed = JSON.parse(raw) as { date: string; count: number };
    if (parsed.date !== getTodayKey()) return { date: getTodayKey(), count: 0 };
    return parsed;
  } catch {
    return { date: getTodayKey(), count: 0 };
  }
}

function incrementDailyCount(): void {
  const record = getDailyRecord();
  record.count += 1;
  try {
    localStorage.setItem(STORAGE_KEY_RPD, JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

/** Full usage stats — for display in the UI */
export interface RateLimitStats {
  requestsInLastMinute: number;
  requestsToday: number;
  rpmLimit: number;
  rpdLimit: number;
  rpmUsedPercent: number;
  rpdUsedPercent: number;
  msUntilNextSlot: number;
  isThrottled: boolean;
}

export function getStats(): RateLimitStats {
  init();
  const now = Date.now();
  pruneOld(now);
  const daily = getDailyRecord();
  const inWindow = _timestamps.length;
  const msNext = msUntilSlotFree();

  return {
    requestsInLastMinute: inWindow,
    requestsToday: daily.count,
    rpmLimit: RPM_LIMIT,
    rpdLimit: RPD_LIMIT,
    rpmUsedPercent: Math.round((inWindow / RPM_LIMIT) * 100),
    rpdUsedPercent: Math.round((daily.count / RPD_LIMIT) * 100),
    msUntilNextSlot: msNext,
    isThrottled: msNext > 0,
  };
}

/** Reset all tracking data */
export function resetRateLimitData(): void {
  _timestamps = [];
  _initialized = false;
  localStorage.removeItem(STORAGE_KEY_RPM);
  localStorage.removeItem(STORAGE_KEY_RPD);
}

/**
 * Parse retry delay from a Bedrock ThrottlingException.
 * Returns milliseconds to wait, or 5000 as fallback.
 */
export function parseThrottlingRetryMs(error: unknown): number {
  try {
    const msg = (error as Record<string, unknown>)?.message ?? "";
    // Bedrock may include "Retry after X seconds" in the error
    const match = String(msg).match(
      /retry\s+(?:after\s+)?(\d+(?:\.\d+)?)\s*s/i,
    );
    if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500;
  } catch {
    /* ignore */
  }
  return 5_000; // Default 5s for Bedrock (much shorter than AI's 60s)
}

/**
 * Run an async API call, automatically retrying once on throttling.
 * Resets the RPM window so we don't immediately hit it again.
 */
export async function withRetryOn429<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const errorName = (err as Record<string, unknown>)?.name ?? "";
    const errorMessage = String(
      (err as Record<string, unknown>)?.message ?? "",
    );

    const isThrottled =
      String(errorName) === "ThrottlingException" ||
      errorMessage.includes("ThrottlingException") ||
      errorMessage.includes("Too Many Requests") ||
      errorMessage.includes("Rate exceeded");

    if (!isThrottled) throw err;

    const waitMs = parseThrottlingRetryMs(err);
    console.warn(
      ` Bedrock throttled — waiting ${Math.round(waitMs / 1000)}s before retry...`,
    );
    _timestamps = [];
    saveTimestamps(_timestamps);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return await fn();
  }
}
