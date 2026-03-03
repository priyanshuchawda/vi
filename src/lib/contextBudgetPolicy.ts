export type ContextBudgetIntent = 'chat' | 'plan' | 'edit';

export interface ContextBudgetProfile {
  maxAttachments: number;
  maxRetrievedEntries: number;
  maxScenesPerEntry: number;
  maxSnapshotMediaEntries: number;
}

const CONTEXT_BUDGET_PROFILES: Record<ContextBudgetIntent, ContextBudgetProfile> = {
  chat: {
    maxAttachments: 2,
    maxRetrievedEntries: 4,
    maxScenesPerEntry: 1,
    maxSnapshotMediaEntries: 6,
  },
  plan: {
    maxAttachments: 3,
    maxRetrievedEntries: 6,
    maxScenesPerEntry: 2,
    maxSnapshotMediaEntries: 10,
  },
  edit: {
    maxAttachments: 3,
    maxRetrievedEntries: 5,
    maxScenesPerEntry: 2,
    maxSnapshotMediaEntries: 8,
  },
};

export function getContextBudgetProfile(intent: ContextBudgetIntent): ContextBudgetProfile {
  return CONTEXT_BUDGET_PROFILES[intent];
}

export function capAttachments<T>(
  attachments: T[] | undefined,
  maxAttachments: number,
): {
  selected: T[];
  dropped: number;
} {
  const list = Array.isArray(attachments) ? attachments : [];
  const clampedMax = Math.max(0, maxAttachments);
  if (list.length <= clampedMax) {
    return { selected: list, dropped: 0 };
  }
  return {
    selected: list.slice(0, clampedMax),
    dropped: list.length - clampedMax,
  };
}
