import { useEffect, useMemo, useState } from 'react';
import { useAiConfigStore } from '../../stores/useAiConfigStore';
import { useProjectStore } from '../../stores/useProjectStore';
import type { AiConfigSettings } from '../../types/electron';
import {
  AI_PROVIDER_FIELD_GROUPS,
  getMissingYouTubeUploadFieldNames,
  normalizeYouTubeUploadSettings,
} from '../../lib/aiConfigFields';

interface YouTubeCredentialModalProps {
  isOpen: boolean;
  isConnecting?: boolean;
  onClose: () => void;
  onConnect?: () => Promise<void>;
}

const YOUTUBE_FIELD_GROUP = AI_PROVIDER_FIELD_GROUPS.find((group) => group.id === 'youtube');

export function YouTubeCredentialModal({
  isOpen,
  isConnecting = false,
  onClose,
  onConnect,
}: YouTubeCredentialModalProps) {
  const {
    settings,
    isLoading,
    isSaving,
    load: loadAiConfig,
    save: saveAiConfig,
  } = useAiConfigStore();
  const setNotification = useProjectStore((state) => state.setNotification);
  const [draftSettings, setDraftSettings] = useState<AiConfigSettings>(settings);
  const [hasDraftChanges, setHasDraftChanges] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setHasDraftChanges(false);
      return;
    }
    void loadAiConfig();
  }, [isOpen, loadAiConfig]);

  useEffect(() => {
    if (!isOpen || hasDraftChanges || isLoading) return;
    setDraftSettings(settings);
  }, [hasDraftChanges, isLoading, isOpen, settings]);

  const normalizedDraft = useMemo(
    () => normalizeYouTubeUploadSettings(draftSettings),
    [draftSettings],
  );
  const missingUploadFields = useMemo(
    () => getMissingYouTubeUploadFieldNames(normalizedDraft),
    [normalizedDraft],
  );
  const canConnect = missingUploadFields.length === 0;

  if (!isOpen || !YOUTUBE_FIELD_GROUP) return null;

  const handleFieldChange = (field: keyof AiConfigSettings, value: string) => {
    setHasDraftChanges(true);
    setDraftSettings((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const saveDraft = async (): Promise<boolean> => {
    const result = await saveAiConfig(normalizedDraft);
    setNotification({
      type: result.success ? 'success' : 'error',
      message: result.success
        ? 'Creator / Upload credentials saved'
        : result.error || 'Failed to save YouTube credentials',
    });
    if (result.success) {
      setHasDraftChanges(false);
    }
    return result.success;
  };

  const handleSave = async () => {
    const success = await saveDraft();
    if (success) {
      onClose();
    }
  };

  const handleSaveAndConnect = async () => {
    const success = await saveDraft();
    if (!success || !onConnect) return;
    onClose();
    await onConnect();
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="youtube-credential-modal-title"
        className="w-[92%] max-w-3xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0d1118]/96 shadow-[0_32px_120px_rgba(0,0,0,0.52)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_42%),linear-gradient(180deg,_rgba(255,255,255,0.03),_rgba(255,255,255,0.01))] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/14 text-red-300 ring-1 ring-red-500/20">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </div>
              <div>
                <div className="mb-2 inline-flex rounded-full border border-sky-300/15 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-200/90">
                  Creator / Upload
                </div>
                <h2
                  id="youtube-credential-modal-title"
                  className="text-xl font-semibold tracking-tight text-white"
                >
                  Fill your YouTube credentials before connecting
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Optional YouTube analysis and upload credentials. The API key is used only for
                  creator analysis. Upload uses the OAuth client ID and client secret below.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-500 transition hover:bg-white/5 hover:text-white"
              aria-label="Close YouTube credential dialog"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            {YOUTUBE_FIELD_GROUP.fields.map((field) => (
              <div key={field.key}>
                <label
                  htmlFor={`youtube-credential-${field.key}`}
                  className="mb-2 block text-sm font-medium text-slate-200"
                >
                  {field.envName}{' '}
                  {field.optional ? <span className="text-slate-500">(optional)</span> : null}
                </label>
                <input
                  id={`youtube-credential-${field.key}`}
                  type={field.secret ? 'password' : 'text'}
                  value={draftSettings[field.key]}
                  onChange={(event) => handleFieldChange(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  className="w-full rounded-2xl border border-white/8 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">{field.helperText}</p>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
              <p className="text-sm font-semibold text-white">
                {canConnect
                  ? 'Upload credentials are ready'
                  : 'Upload credentials are still missing'}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Save this once, then QuickCut can open the Google OAuth window and connect your
                YouTube account directly from the editor.
              </p>
              {!canConnect ? (
                <p className="mt-4 text-xs leading-5 text-amber-200">
                  Still needed for upload: {missingUploadFields.join(', ')}
                </p>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-white/8 bg-black/25 p-5">
              <p className="text-sm font-semibold text-white">How QuickCut uses these</p>
              <ul className="mt-3 space-y-3 text-sm text-slate-300">
                <li>`YOUTUBE_API_KEY` is used only for creator/channel analysis.</li>
                <li>OAuth Client ID + Secret are used only to connect and upload.</li>
                <li>If redirect URI is blank, QuickCut uses `http://localhost` automatically.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/8 bg-black/20 px-6 py-4">
          <p className="text-xs text-slate-500">
            `.env` values still take priority when present. Saved values work as QuickCut fallback.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={isLoading || isSaving || isConnecting}
              className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => void handleSaveAndConnect()}
              disabled={isLoading || isSaving || isConnecting || !canConnect}
              className="rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isConnecting ? 'Connecting...' : 'Save and Connect YouTube'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
