import { describe, expect, it } from 'vitest';
import { requiresInitialSetup } from '../../src/lib/setupRequirements';

describe('requiresInitialSetup', () => {
  it('requires setup when the profile is missing', () => {
    expect(
      requiresInitialSetup(null, {
        aiReady: true,
        usingSavedSettings: true,
        usingEnvFallback: false,
      }),
    ).toBe(true);
  });

  it('requires setup when the user name is missing', () => {
    expect(
      requiresInitialSetup(
        {
          userId: 'user-1',
          userName: '   ',
        },
        { aiReady: true, usingSavedSettings: true, usingEnvFallback: false },
      ),
    ).toBe(true);
  });

  it('requires setup when no AI provider is ready', () => {
    expect(
      requiresInitialSetup(
        {
          userId: 'user-1',
          userName: 'Priyanshu',
        },
        { aiReady: false, usingSavedSettings: false, usingEnvFallback: false },
      ),
    ).toBe(true);
  });

  it('does not require setup when ready credentials come from env', () => {
    expect(
      requiresInitialSetup(
        {
          userId: 'user-1',
          userName: 'Priyanshu',
        },
        { aiReady: true, usingSavedSettings: false, usingEnvFallback: true },
      ),
    ).toBe(false);
  });

  it('does not require setup when profile and AI provider are both ready', () => {
    expect(
      requiresInitialSetup(
        {
          userId: 'user-1',
          userName: 'Priyanshu',
        },
        { aiReady: true, usingSavedSettings: true, usingEnvFallback: false },
      ),
    ).toBe(false);
  });
});
