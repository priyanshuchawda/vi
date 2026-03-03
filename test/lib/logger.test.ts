import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, shouldLog } from '../../src/lib/logger';

describe('renderer logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts sensitive fields in log context', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    log('error', 'failure', {
      accessKey: 'abc123',
      nested: { token: 'secret-token', safe: 'ok' },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, payload] = spy.mock.calls[0];
    expect(payload).toEqual({
      accessKey: '[REDACTED]',
      nested: { token: '[REDACTED]', safe: 'ok' },
    });
  });

  it('does not emit debug logs by default', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    log('debug', 'hidden');
    expect(spy).not.toHaveBeenCalled();
    expect(shouldLog('debug')).toBe(false);
  });
});
