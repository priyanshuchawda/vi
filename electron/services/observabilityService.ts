import * as Sentry from '@sentry/node';
import { log } from '../utils/logger.js';

let initialized = false;
let trackingEnabled = false;

export function initMainObservability() {
  if (initialized) return;
  initialized = true;

  const enabled = process.env.ENABLE_ERROR_TRACKING === '1';
  const dsn = process.env.SENTRY_DSN;
  trackingEnabled = enabled && Boolean(dsn);

  if (trackingEnabled && dsn) {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.APP_VERSION || 'dev',
      tracesSampleRate: 0,
    });
    log('info', 'Main error tracking enabled');
  } else {
    log('info', 'Main error tracking disabled');
  }
}

export function captureMainException(error: unknown, context?: Record<string, unknown>) {
  const safeError = error instanceof Error ? error : new Error(String(error));
  log('error', safeError.message, context);

  if (!trackingEnabled) return;

  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureException(safeError);
  });
}
