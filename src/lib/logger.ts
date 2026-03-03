export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'apiKey', 'accessKey'];
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const isSensitive = SENSITIVE_KEYS.some((sensitive) =>
        key.toLowerCase().includes(sensitive.toLowerCase()),
      );
      out[key] = isSensitive ? '[REDACTED]' : redactValue(item);
    }
    return out;
  }
  return value;
}

function resolveMinLevel(): LogLevel {
  const configured = (import.meta.env.VITE_LOG_LEVEL || 'info') as LogLevel;
  if (configured in LEVEL_ORDER) {
    return configured;
  }
  return 'info';
}

const minLevel = resolveMinLevel();

export function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

export function log(level: LogLevel, message: string, context?: LogContext): void {
  if (!shouldLog(level)) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    context: context ? redactValue(context) : undefined,
  };

  const line = `[Renderer][${payload.level.toUpperCase()}] ${payload.message}`;
  if (level === 'error') {
    console.error(line, payload.context ?? '');
    return;
  }
  if (level === 'warn') {
    console.warn(line, payload.context ?? '');
    return;
  }
  if (level === 'debug') {
    console.debug(line, payload.context ?? '');
    return;
  }
  console.info(line, payload.context ?? '');
}
