/**
 * Publish Store
 *
 * Coordinates the AI-assisted publish flow between ChatPanel and PublishPanel.
 * When the AI detects publish intent, it generates metadata and stores it here.
 * The RightPanel listens for `pendingMeta` and auto-navigates to the Publish tab.
 * PublishPanel consumes `pendingMeta` to pre-fill the form fields.
 */

import { create } from 'zustand';

export interface PublishMeta {
  title: string;
  description: string;
  tags: string;
  privacyStatus: 'public' | 'private' | 'unlisted';
}

interface PublishStore {
  /** AI-generated metadata waiting to be consumed by PublishPanel */
  pendingMeta: PublishMeta | null;
  /** True while Bedrock is generating the metadata */
  isGeneratingMeta: boolean;
  /** Signal to App.tsx to switch sidebar to RightPanel publish tab */
  isPublishPanelRequested: boolean;

  requestPublish: (meta: PublishMeta) => void;
  setIsGeneratingMeta: (generating: boolean) => void;
  clearPublishRequest: () => void;
  clearPendingMeta: () => void;
}

export const usePublishStore = create<PublishStore>()((set) => ({
  pendingMeta: null,
  isGeneratingMeta: false,
  isPublishPanelRequested: false,

  requestPublish: (meta) =>
    set({ pendingMeta: meta, isPublishPanelRequested: true, isGeneratingMeta: false }),

  setIsGeneratingMeta: (generating) => set({ isGeneratingMeta: generating }),

  /** Called by App.tsx once it has handled the navigation */
  clearPublishRequest: () => set({ isPublishPanelRequested: false }),

  /** Called by PublishPanel after it reads and applies the meta */
  clearPendingMeta: () => set({ pendingMeta: null }),
}));
