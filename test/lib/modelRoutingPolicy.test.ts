import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getRecentlySuccessfulModels,
  getRoutingModelPreference,
  recordRoutingModelOutcome,
  routeBedrockModel,
  setRoutingModelPreference,
} from '../../src/lib/modelRoutingPolicy';

describe('modelRoutingPolicy', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes cheap model for simple chat without attachments', () => {
    const decision = routeBedrockModel({
      intent: 'chat',
      message: 'what is a jump cut?',
      hasAttachments: false,
    });
    expect(decision.reason).toBe('cheap_chat');
  });

  it('routes strong model for complex planning prompts', () => {
    const decision = routeBedrockModel({
      intent: 'plan',
      message: 'rebuild full timeline across tracks with multi-step sequence',
    });
    expect(decision.reason).toBe('complex_plan');
  });

  it('forces cheap model during degraded mode', () => {
    const decision = routeBedrockModel({
      intent: 'plan',
      message: 'complex sequence',
      degraded: true,
    });
    expect(decision.reason).toBe('degraded_budget');
  });

  it('persists and applies user model preference', () => {
    setRoutingModelPreference('chat', 'custom.model.v1');

    const stored = getRoutingModelPreference('chat');
    const decision = routeBedrockModel({ intent: 'chat', hasAttachments: false });

    expect(stored).toBe('custom.model.v1');
    expect(decision.modelId).toBe('custom.model.v1');
    expect(decision.reason).toBe('user_preference:chat');
  });

  it('deprioritizes preferred model when it is in failure cooldown', () => {
    setRoutingModelPreference('chat', 'custom.failing.model');
    recordRoutingModelOutcome('custom.failing.model', 'failure');

    const decision = routeBedrockModel({ intent: 'chat', hasAttachments: false });

    expect(decision.modelId).not.toBe('custom.failing.model');
    expect(decision.reason).not.toBe('user_preference:chat');
  });

  it('tracks recently successful models in recency order', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValue(2_000);

    recordRoutingModelOutcome('model.A', 'success');
    recordRoutingModelOutcome('model.B', 'success');

    const recent = getRecentlySuccessfulModels(2);
    expect(recent).toEqual(['model.B', 'model.A']);
  });
});
