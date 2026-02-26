# Brief about the Idea:
- QuickCut is a local desktop editor for creators: import → cut → caption → export.
- FFmpeg pipeline does the heavy work: thumbnails, waveforms, fast export (stream-copy when possible).
- AI layer turns footage into searchable/editable data: transcripts, scenes, tags, highlights, reframes, thumbnails.
- Everything is project-scoped and persistent: edits + analysis memory + caches.

# 1. How is this different from existing ideas?
- Local-first by default: files stay on disk; no account required.
- Edit three ways: timeline (time), transcript (text), assistant (intent).
- AI is not “advice-only”: it can execute edits via function-calling tools.
- Speed focus: caching + smart export path reduces iteration time.

# 2. How does it solve the problem?
- Cuts editing time on long footage by letting you search, jump, and delete by words/scenes.
- Repurposes content for platforms: auto-reframe + highlight clips + subtitles.
- Reduces export mistakes: platform-based export recommendations + warnings.
- Keeps AI predictable: structured outputs, persistent context, and visible cost controls.

# 3. USP of the proposed solution
- Search footage like a document: query scenes/tags/transcripts and jump straight to the moment.
- Repurpose in one pass: reframe → highlights → captions → export.
- Assistant that changes the project, not just the chat: tool execution + undo/redo.
- Costs are controlled: caching + quotas/warnings + real-time usage tracking.

# List of features offered by the solution
- Editing core: multi-track timeline, split/trim/merge, move, copy/paste, undo/redo.
- Media handling: import video/audio/images/SRT, metadata read, thumbnails + waveforms (cached).
- Text overlays: typography, color, outline/background, positioning, duration.
- Subtitles: Vosk + Gemini transcription, edit-by-text, import/export SRT, burn-in styling.
- Translation: transcript/subtitle translation → multilingual SRT.
- Search: natural-language media search across analysis memory (scenes/tags/transcripts) → add/jump.
- Smart export: MP4/MOV/AVI/WebM, resolution presets, progress, export recommendations per platform.
- Creator onboarding: YouTube channel analysis → editing style + growth suggestions.
- Smart editing AI: highlight detection, auto-reframe (9:16/1:1/4:5), scene detection, B-roll suggestions.
- Quality AI: color grading suggestions, audio enhancement, music suggestions.
- AI system: pipeline stages + background jobs + feature discovery UI.
- Reliability: persistent analysis cache + enhanced caching strategy.
- Project management: `.quickcut` save/load, autosave, unsaved-changes protection.

# Process flow diagram or Use-case diagram
1. Import media → metadata + thumbnails + waveforms (cache)
2. Background analysis → transcript + scenes + tags → stored in project memory
3. Edit:
   - Timeline edits (split/trim/move/merge)
   - Transcript edits (jump/delete by words)
   - AI actions (reframe/highlights/B-roll/scene ops) executed via tools
4. Prepare for platform → export recommendations + subtitle/translation options
5. Export → stream-copy when possible; re-encode only when required

# Wireframes/Mock diagrams of the proposed solution (optional)
- Left panel: Media / Project / Text / Settings (import + search)
- Center: Preview player
- Right panel: Transcript + Subtitles + Edit-by-text + AI Chat
- Bottom: Timeline (tracks, clip edits, waveforms)
- Top: Toolbar (import, transcribe, search, reframe, highlights, thumbnail, export)

# Architecture diagram of the proposed solution:
- Renderer (React/Vite): UI + Zustand stores (timeline, project, chat, onboarding, memory)
- Preload: typed `electronAPI` bridge for secure IPC
- Main (Electron):
  - IPC handlers (import/export/transcribe/analyze/search)
  - File dialogs + project persistence
  - Media pipeline (FFmpeg processor)
  - Transcription (Vosk)
  - Channel analysis service (YouTube + Gemini)
  - Memory + analysis markdown persistence
- AI platform:
  - ToolExecutor + video-editing tools (apply edits)
  - AI Pipeline stages (analyze → search → suggest → apply)
  - Background job queue (long-running work)
  - Persistent analysis cache + preview caches
  - Cost tracker + quotas/warnings

# Technologies to be used:
- Electron, React, TypeScript, Vite
- Zustand (state), Zod (schemas/validation), TailwindCSS (UI)
- FFmpeg + fluent-ffmpeg (media processing)
- Vosk (vosk-koffi) for offline speech-to-text
- Gemini SDK (`@google/genai`) + YouTube Data API (creator analysis)
- Vitest (tests)

# Add as per the requirements for the hackathon:
- Privacy: editing/export is local; AI features are user-configured (keys/models).
- Cross-platform: Windows/macOS/Linux builds via electron-builder.
- Demo path: import → search → transcript cut → highlights/reframe → subtitles → export.
- Quality gates: unit + integration tests; performance targets for search/export.

# Estimated implementation cost (optional):
- Local editing/export: $0 infrastructure.
- Optional AI: pay-per-use; guarded by caching + quotas + warnings + usage meter.
- Typical target: low cents per video for analysis and recommendations (varies by model and media length).

