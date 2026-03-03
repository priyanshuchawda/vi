import * as Sentry from '@sentry/browser';
import { log } from './logger';

let initialized = false;
let trackingEnabled = false;

function isTrackingEnabledByEnv(): boolean {
  return import.meta.env.VITE_ENABLE_ERROR_TRACKING === '1';
}

export function initRendererObservability(): void {
  if (initialized) return;
  initialized = true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  trackingEnabled = isTrackingEnabledByEnv() && Boolean(dsn);

  if (trackingEnabled && dsn) {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_VERSION || 'dev',
      tracesSampleRate: 0,
    });
    log('info', 'Renderer error tracking enabled');
  } else {
    log('info', 'Renderer error tracking disabled');
  }

  window.addEventListener('error', (event) => {
    captureRendererException(event.error ?? new Error(event.message), {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureRendererException(
      event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
      {
        kind: 'unhandledrejection',
      },
    );
  });
}

export function captureRendererException(error: unknown, context?: Record<string, unknown>): void {
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
