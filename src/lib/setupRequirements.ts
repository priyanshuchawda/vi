import type { AiConfigStatus } from '../types/electron';
import type { UserProfile } from '../stores/useProfileStore';

export function requiresInitialSetup(
  profile: Pick<UserProfile, 'userId' | 'userName'> | null,
  aiStatus: Pick<AiConfigStatus, 'bedrockReady' | 'usingSavedSettings' | 'usingEnvFallback'> | null,
): boolean {
  const hasProfile = Boolean(profile?.userId && profile.userName?.trim());
  const hasAvailableAiSetup = Boolean(
    aiStatus?.bedrockReady && (aiStatus.usingSavedSettings || aiStatus.usingEnvFallback),
  );
  return !hasProfile || !hasAvailableAiSetup;
}
