export interface RetryClassification {
  retryable: boolean;
  reason: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return String(error ?? '');
}

export function classifyTransientError(error: unknown): RetryClassification {
  const message = extractErrorMessage(error).toLowerCase();

  const retryablePatterns = [
    /\b429\b/,
    /throttl/,
    /too many requests/,
    /\b5\d\d\b/,
    /service unavailable/,
    /timeout/,
    /timed out/,
    /network/,
    /econnreset/,
    /socket hang up/,
    /fetch failed/,
  ];

  const retryable = retryablePatterns.some((pattern) => pattern.test(message));
  if (!retryable) {
    return {
      retryable: false,
      reason: 'Non-transient error',
    };
  }

  if (
    message.includes('429') ||
    message.includes('throttl') ||
    message.includes('too many requests')
  ) {
    return { retryable: true, reason: 'Rate limited (429)' };
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return { retryable: true, reason: 'Request timeout' };
  }
  if (message.includes('network') || message.includes('econnreset') || message.includes('socket')) {
    return { retryable: true, reason: 'Network failure' };
  }
  if (/\b5\d\d\b/.test(message) || message.includes('service unavailable')) {
    return { retryable: true, reason: 'Server unavailable (5xx)' };
  }

  return { retryable: true, reason: 'Transient runtime error' };
}

export function getRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, attempt);
  return Math.min(15000, 1500 * 2 ** (safeAttempt - 1));
}
