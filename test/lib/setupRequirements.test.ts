import { describe, expect, it } from 'vitest';
import { requiresInitialSetup } from '../../src/lib/setupRequirements';

describe('requiresInitialSetup', () => {
  it('requires setup when the profile is missing', () => {
    expect(requiresInitialSetup(null, { bedrockReady: true, usingSavedSettings: true })).toBe(true);
  });

  it('requires setup when the user name is missing', () => {
    expect(
      requiresInitialSetup(
        {
          userId: 'user-1',
          userName: '   ',
        },
        { bedrockReady: true, usingSavedSettings: true },
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
        { bedrockReady: false, usingSavedSettings: false },
      ),
    ).toBe(true);
  });

  it('requires setup when credentials only come from env fallback', () => {
    expect(
      requiresInitialSetup(
        {
          userId: 'user-1',
          userName: 'Priyanshu',
        },
        { bedrockReady: true, usingSavedSettings: false },
      ),
    ).toBe(true);
  });

  it('does not require setup when profile and bedrock are both ready', () => {
    expect(
      requiresInitialSetup(
        {
          userId: 'user-1',
          userName: 'Priyanshu',
        },
        { bedrockReady: true, usingSavedSettings: true },
      ),
    ).toBe(false);
  });
});
