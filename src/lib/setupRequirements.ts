import type { AiConfigStatus } from '../types/electron';
import type { UserProfile } from '../stores/useProfileStore';

export function requiresInitialSetup(
  profile: Pick<UserProfile, 'userId' | 'userName'> | null,
  aiStatus: Pick<AiConfigStatus, 'bedrockReady' | 'usingSavedSettings'> | null,
): boolean {
  const hasProfile = Boolean(profile?.userId && profile.userName?.trim());
  const hasSavedAiSetup = Boolean(aiStatus?.bedrockReady && aiStatus.usingSavedSettings);
  return !hasProfile || !hasSavedAiSetup;
}
