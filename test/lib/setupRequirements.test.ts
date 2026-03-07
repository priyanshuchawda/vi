import { describe, expect, it } from 'vitest';
import { requiresInitialSetup } from '../../src/lib/setupRequirements';

describe('requiresInitialSetup', () => {
  it('requires setup when the profile is missing', () => {
    expect(
      requiresInitialSetup(null, {
        bedrockReady: true,
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
        { bedrockReady: true, usingSavedSettings: true, usingEnvFallback: false },
      ),
    ).toBe(true);
  });

  it('requires setup when bedrock credentials are not ready', () => {
    expect(
      requiresInitialSetup(
        {
          userId: 'user-1',
          userName: 'Priyanshu',
        },
        { bedrockReady: false, usingSavedSettings: false, usingEnvFallback: false },
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
        { bedrockReady: true, usingSavedSettings: false, usingEnvFallback: true },
      ),
    ).toBe(false);
  });

  it('does not require setup when profile and bedrock are both ready', () => {
    expect(
      requiresInitialSetup(
        {
          userId: 'user-1',
          userName: 'Priyanshu',
        },
        { bedrockReady: true, usingSavedSettings: true, usingEnvFallback: false },
      ),
    ).toBe(false);
  });
});
