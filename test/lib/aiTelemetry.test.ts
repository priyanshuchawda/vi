import { beforeEach, describe, expect, it } from 'vitest';
import {
  getTelemetryRates,
  recordAssistantResponse,
  recordExecutionAttempt,
  recordPlanningAttempt,
  resetTelemetry,
} from '../../src/lib/aiTelemetry';

describe('aiTelemetry', () => {
  beforeEach(() => {
    resetTelemetry();
  });

  it('tracks planning and execution rates', () => {
    recordPlanningAttempt({ compileFailed: true, fallbackUsed: true });
    recordPlanningAttempt({ compileFailed: false, fallbackUsed: false });
    recordExecutionAttempt({ validationFailed: true });
    recordExecutionAttempt({ validationFailed: false });

    const rates = getTelemetryRates();

    expect(rates.plan_compile_fail_rate).toBeCloseTo(0.5, 5);
    expect(rates.fallback_rate).toBeCloseTo(0.5, 5);
    expect(rates.execution_validation_fail_rate).toBeCloseTo(0.5, 5);
  });

  it('tracks repeated assistant responses', () => {
    recordAssistantResponse('Hello world');
    recordAssistantResponse('Hello world');
    recordAssistantResponse('Different response');

    const rates = getTelemetryRates();

    expect(rates.repeat_response_rate).toBeCloseTo(1 / 3, 5);
  });
});
