import { useEffect, useMemo, useState } from 'react';
import { useAiConfigStore } from '../../stores/useAiConfigStore';
import { useProfileStore } from '../../stores/useProfileStore';
import type { AiConfigSettings, ChannelAnalysisData } from '../../types/electron';
import { AppLogo } from '../ui/AppLogo';
import {
  AI_PROVIDER_FIELD_GROUPS,
  getMissingBedrockFieldNames,
  getMissingGeminiFieldNames,
  isAnyAiProviderConfigured,
} from '../../lib/aiConfigFields';

type OnboardingStep = 'profile' | 'ai' | 'finalizing';

interface OnboardingWizardProps {
  onComplete: (userId: string, analysisData?: ChannelAnalysisData) => void;
  onSkip?: () => void;
}

const blankAiSettings: AiConfigSettings = {
  youtubeApiKey: '',
  awsRegion: 'us-east-1',
  awsAccessKeyId: '',
  awsSecretAccessKey: '',
  awsSessionToken: '',
  bedrockInferenceProfileId: '',
  bedrockModelId: 'amazon.nova-lite-v1:0',
  geminiApiKey: '',
  geminiModelId: 'gemini-2.5-flash-lite',
  youtubeOAuthClientId: '',
  youtubeOAuthClientSecret: '',
  youtubeOAuthRedirectUri: '',
};

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<OnboardingStep>('profile');
  const [stepError, setStepError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [email, setEmail] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [draftAiSettings, setDraftAiSettings] = useState<AiConfigSettings>(blankAiSettings);
  const [hasEditedAiSettings, setHasEditedAiSettings] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const {
    settings: aiSettings,
    status: aiStatus,
    isLoading: isAiConfigLoading,
    isSaving: isAiConfigSaving,
    load: loadAiConfig,
    save: saveAiConfig,
  } = useAiConfigStore();
  const { profile, createProfile, updateProfile, analyzeYouTubeChannel } = useProfileStore();

  useEffect(() => {
    const refreshAiConfig = () => {
      void loadAiConfig();
    };

    refreshAiConfig();
    window.addEventListener('focus', refreshAiConfig);
    document.addEventListener('visibilitychange', refreshAiConfig);

    return () => {
      window.removeEventListener('focus', refreshAiConfig);
      document.removeEventListener('visibilitychange', refreshAiConfig);
    };
  }, [loadAiConfig]);

  useEffect(() => {
    if (!profile) return;
    setUserName(profile.userName || '');
    setEmail(profile.email || '');
    setYoutubeUrl(profile.youtubeChannelUrl || '');
  }, [profile]);

  useEffect(() => {
    if (isAiConfigLoading || hasEditedAiSettings) return;
    setDraftAiSettings(aiSettings);
  }, [aiSettings, hasEditedAiSettings, isAiConfigLoading]);

  const missingBedrockFields = useMemo(
    () => getMissingBedrockFieldNames(draftAiSettings),
    [draftAiSettings],
  );
  const missingGeminiFields = useMemo(
    () => getMissingGeminiFieldNames(draftAiSettings),
    [draftAiSettings],
  );
  const isDraftAiReady = useMemo(
    () => isAnyAiProviderConfigured(draftAiSettings),
    [draftAiSettings],
  );
  const missingProviderSummary = [
    missingBedrockFields.length > 0 ? `Bedrock: ${missingBedrockFields.join(', ')}` : '',
    missingGeminiFields.length > 0 ? `Gemini: ${missingGeminiFields.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const handleAiFieldChange = (field: keyof AiConfigSettings, value: string) => {
    setHasEditedAiSettings(true);
    setDraftAiSettings((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const persistProfileDraft = async () => {
    const userId = profile?.userId || (await window.electronAPI.identity.getInstallationId());
    const trimmedName = userName.trim();
    const trimmedEmail = email.trim();
    const trimmedYouTubeUrl = youtubeUrl.trim();

    if (!profile) {
      createProfile(userId, trimmedName, trimmedEmail || undefined);
      if (trimmedYouTubeUrl) {
        updateProfile({
          youtubeChannelUrl: trimmedYouTubeUrl,
        });
      }
    } else {
      updateProfile({
        userName: trimmedName,
        email: trimmedEmail || undefined,
        youtubeChannelUrl: trimmedYouTubeUrl || undefined,
      });
    }

    return userId;
  };

  const handleProfileContinue = async () => {
    const trimmedName = userName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setStepError('Enter your name to continue.');
      return;
    }

    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setStepError('Enter a valid email address or leave it blank.');
      return;
    }

    await persistProfileDraft();
    setStepError(null);
    setStep('ai');
  };

  const handleAiContinue = async () => {
    setStepError(null);
    const userId = await persistProfileDraft();
    const result = await saveAiConfig(draftAiSettings);

    if (!result.success) {
      setStepError(result.error || 'Failed to save AI credentials.');
      return;
    }

    if (!isDraftAiReady) {
      setStepError(
        `Configure either Bedrock or Gemini before continuing. Missing: ${missingProviderSummary}`,
      );
      return;
    }

    setStep('finalizing');
    setIsFinishing(true);

    let analysisData: ChannelAnalysisData | undefined;
    try {
      if (youtubeUrl.trim()) {
        const analyzed = await analyzeYouTubeChannel(youtubeUrl.trim());
        if (!analyzed) {
          setStepError(
            'Profile and AI setup were saved, but YouTube analysis failed. You can retry later from Profile.',
          );
        } else {
          analysisData = useProfileStore.getState().profile?.channelAnalysis;
        }
      }

      onComplete(userId, analysisData);
    } finally {
      setIsFinishing(false);
    }
  };

  const renderField = (field: (typeof AI_PROVIDER_FIELD_GROUPS)[number]['fields'][number]) => (
    <div
      key={field.key}
      className={field.key === 'youtubeApiKey' || field.key === 'awsRegion' ? 'sm:col-span-2' : ''}
    >
      <label
        htmlFor={`onboarding-${field.key}`}
        className="mb-2 block text-sm font-medium text-slate-200"
      >
        {field.envName} {field.optional ? <span className="text-slate-500">(optional)</span> : null}
      </label>
      <input
        id={`onboarding-${field.key}`}
        type={field.secret ? 'password' : 'text'}
        value={draftAiSettings[field.key]}
        onChange={(event) => handleAiFieldChange(field.key, event.target.value)}
        placeholder={field.placeholder}
        className="w-full rounded-2xl border border-white/8 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
      />
      <p className="mt-2 text-xs leading-5 text-slate-500">{field.helperText}</p>
    </div>
  );

  const renderProfileStep = () => (
    <div className="mx-auto flex max-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-white/8 bg-[#0c1016]/94 shadow-[0_32px_120px_rgba(0,0,0,0.45)] backdrop-blur">
      <div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="overflow-y-auto border-b border-white/6 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_42%),linear-gradient(160deg,_rgba(12,16,22,0.98),_rgba(6,10,15,0.94))] px-8 py-10 lg:border-b-0 lg:border-r lg:px-10">
          <AppLogo
            size={54}
            showWordmark
            showTagline
            iconClassName="rounded-[18px] shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
            wordmarkClassName="text-left"
          />
          <div className="mt-10 space-y-4">
            <div className="inline-flex rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-200/90">
              Step 1 of 2
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-white">
              Fill your profile first
            </h1>
            <p className="max-w-md text-sm leading-7 text-slate-300">
              This is the first screen every new workspace opens with. Add your editor identity now,
              then save the AI credentials the app needs before the agent workflow starts.
            </p>
          </div>

          <div className="mt-10 space-y-4">
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
              <p className="text-sm font-semibold text-white">What happens next</p>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
                  Save your profile basics.
                </div>
                <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
                  Save Bedrock credentials and optionally a Gemini fallback key.
                </div>
                <div className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3">
                  If you add a YouTube URL now, QuickCut analyzes it after AI setup finishes.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto px-8 py-10 lg:px-10">
          <div className="space-y-5">
            <div>
              <label
                htmlFor="onboarding-name"
                className="mb-2 block text-sm font-medium text-slate-200"
              >
                Name
              </label>
              <input
                id="onboarding-name"
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
                placeholder="Enter your name"
                className="w-full rounded-2xl border border-white/8 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
              />
            </div>

            <div>
              <label
                htmlFor="onboarding-email"
                className="mb-2 block text-sm font-medium text-slate-200"
              >
                Email <span className="text-slate-500">(optional)</span>
              </label>
              <input
                id="onboarding-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-2xl border border-white/8 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
              />
            </div>

            <div>
              <label
                htmlFor="onboarding-youtube-url"
                className="mb-2 block text-sm font-medium text-slate-200"
              >
                YouTube Channel URL <span className="text-slate-500">(optional)</span>
              </label>
              <input
                id="onboarding-youtube-url"
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder="https://www.youtube.com/@channel"
                className="w-full rounded-2xl border border-white/8 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Optional for now. Add it only if you want channel analysis right after setup.
              </p>
            </div>
          </div>

          <div className="mt-10 flex items-center justify-between border-t border-white/6 pt-6">
            <div>{stepError ? <p className="text-sm text-rose-300">{stepError}</p> : null}</div>
            <button
              onClick={handleProfileContinue}
              className="rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105"
            >
              Save Profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAiStep = () => (
    <div className="mx-auto flex max-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-white/8 bg-[#0c1016]/94 shadow-[0_32px_120px_rgba(0,0,0,0.45)] backdrop-blur">
      <div className="flex items-start justify-between gap-6 border-b border-white/6 px-8 py-7 lg:px-10">
        <div className="flex items-start gap-4">
          <AppLogo size={46} iconClassName="rounded-2xl shadow-[0_18px_36px_rgba(0,0,0,0.35)]" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300/80">
              Step 2 of 2
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              Save the AI credentials your workflow uses
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              These are the same values your project supports in `.env`. QuickCut keeps Bedrock as
              the primary provider and can use Gemini as fallback when configured.
            </p>
          </div>
        </div>
      </div>

      <div className="grid flex-1 gap-8 overflow-y-auto px-8 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
        <div className="space-y-4">
          {AI_PROVIDER_FIELD_GROUPS.map((group) => (
            <div key={group.id} className="rounded-[24px] border border-white/8 bg-black/25 p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-white">{group.title}</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">{group.description}</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">{group.fields.map(renderField)}</div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="rounded-[24px] border border-white/8 bg-gradient-to-br from-white/6 to-white/[0.02] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">
                  {isDraftAiReady
                    ? 'Saved setup is ready to launch AI'
                    : 'AI provider setup is still missing'}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Onboarding completes once either Bedrock or Gemini is configured inside QuickCut.
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  isDraftAiReady
                    ? 'bg-emerald-400/12 text-emerald-300'
                    : 'bg-amber-400/12 text-amber-200'
                }`}
              >
                {isDraftAiReady ? 'Ready' : 'Setup needed'}
              </span>
            </div>
            {!isDraftAiReady ? (
              <p className="mt-4 text-xs leading-5 text-amber-200">
                Fill either provider: {missingProviderSummary}
              </p>
            ) : null}
          </div>

          <div className="rounded-[24px] border border-white/8 bg-black/25 p-5">
            <h2 className="text-sm font-semibold text-white">Credential source</h2>
            <div className="mt-3 space-y-3 text-sm text-slate-300">
              <p>
                {aiStatus?.usingEnvFallback
                  ? 'QuickCut detected credentials from `.env`. They are active now, and saved in-app values act as fallback.'
                  : aiStatus?.usingSavedSettings
                    ? 'QuickCut already has saved credentials. Updating here will replace them.'
                    : 'No existing AI credentials were detected yet.'}
              </p>
              <p className="text-xs leading-5 text-slate-500">
                `.env` values take priority when present. Saved settings remain fallback for this
                desktop app.
              </p>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-black/25 p-5">
            <h2 className="text-sm font-semibold text-white">What this unlocks</h2>
            <ul className="mt-3 space-y-3 text-sm text-slate-300">
              <li>Agentic AI edit loop in chat</li>
              <li>Script, trim, caption, and timing automation</li>
              <li>Optional creator analysis once a YouTube channel is linked</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/6 bg-[#0c1016]/98 px-8 py-6 lg:px-10">
        <button
          onClick={() => {
            setStepError(null);
            setStep('profile');
          }}
          className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/5"
        >
          Back
        </button>
        <div className="flex items-center gap-4">
          <div>{stepError ? <p className="text-sm text-rose-300">{stepError}</p> : null}</div>
          <button
            onClick={() => void handleAiContinue()}
            disabled={isAiConfigLoading || isAiConfigSaving || isFinishing}
            className="rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAiConfigSaving || isFinishing ? 'Saving setup...' : 'Save AI Setup'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderFinalizingStep = () => (
    <div className="mx-auto w-full max-w-2xl rounded-[28px] border border-white/8 bg-[#0c1016]/92 px-8 py-10 text-center shadow-[0_32px_120px_rgba(0,0,0,0.45)] backdrop-blur">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-400/12 text-sky-300 ring-1 ring-white/8">
        <svg className="h-8 w-8 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            d="M4 4v5h5M20 20v-5h-5M5 14a7 7 0 0111-7l4 2M19 10a7 7 0 01-11 7l-4-2"
          />
        </svg>
      </div>
      <h2 className="mt-6 text-2xl font-semibold text-white">Finishing your workspace</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        QuickCut is saving your AI setup and{' '}
        {youtubeUrl.trim() ? 'analyzing your YouTube channel.' : 'preparing the editor.'}
      </p>
      {stepError ? <p className="mt-5 text-sm text-amber-200">{stepError}</p> : null}
    </div>
  );

  return (
    <div className="min-h-screen overflow-y-auto bg-[#05070b] px-6 py-10 text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-12 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
      </div>

      <div className="relative z-10 flex min-h-[calc(100vh-5rem)] items-start justify-center py-4">
        {step === 'profile' && renderProfileStep()}
        {step === 'ai' && renderAiStep()}
        {step === 'finalizing' && renderFinalizingStep()}
      </div>
    </div>
  );
}
