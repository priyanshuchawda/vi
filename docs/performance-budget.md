# Performance Budget and Measurement Notes

This document defines practical runtime budgets for QuickCut and how we verify
them after performance-related changes.

## Startup Budgets

- Renderer initial JS payload should favor fast interactivity:
  - Keep default entry path focused on editor shell and preview/timeline core.
  - Lazy-load heavy secondary panels (chat, right tools panel, file panel
    internals).
- Target baseline for local development on modern laptop:
  - App shell interactive under 2s after Electron window creation.
  - Side panel open latency under 150ms after first open.

## Interaction Budgets

- Panel toggle actions should not block UI thread with synchronous work.
- Background/idle preloading is allowed when onboarding is complete and UI is
  idle.

## Current Hardening in Place

- `src/App.tsx` lazy-loads heavy UI surfaces:
  - `ChatPanel`
  - `RightPanel`
  - `FilePanel`
  - `OnboardingWizard`
- Idle prefetch warms panel chunks after onboarding completion.

## How to Measure

1. Build production bundle:

```bash
npm run build
```

2. Run desktop app and record timeline in Chrome DevTools Performance (renderer
   process).
3. Capture and compare:

- Time to interactive shell render
- First open latency of chat panel
- First open latency of right tools panel

4. Regressions above budget should block merge until mitigated or accepted with
   rationale.
