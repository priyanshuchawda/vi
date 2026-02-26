# Brief about the Idea:
- QuickCut is a desktop video editor for fast cuts, trims, subtitles, and exports.
- Media processing runs locally via FFmpeg (thumbnails, waveforms, export).
- AI features are optional: offline transcription (Vosk) + Gemini for chat, analysis, and creator guidance.

# 1. How is this different from existing ideas?
- Local-first editor: no account, no cloud dependency for editing/export.
- Fast export path: stream-copy when possible (avoid re-encode).
- Transcript-based editing: jump and edit using timestamped speech segments.
- Built-in AI assistant that can execute editing actions via function-calling tools.

# 2. How does it solve the problem?
- Reduces time from raw footage to publishable output: import → timeline edit → subtitles → export.
- Makes speech-heavy content editable/searchable using transcription + timestamps.
- Optional onboarding uses YouTube channel analysis to suggest editing style aligned to the creator.

# 3. USP of the proposed solution
- One app: timeline editing + subtitles + edit-by-text + fast export.
- Works without AI; improves with AI when keys/models are configured.
- Project + analysis memory persists per project for reuse.

# List of features offered by the solution
- Timeline: multi-track video/audio, split/trim/merge, move, copy/paste, undo/redo.
- Audio: volume, mute, fades; waveform previews.
- Media import: video/audio/images + SRT; automatic thumbnails.
- Text overlays: font, size, color, alignment, outline/background, duration.
- Subtitles: transcribe, import/export SRT, burn-in styling on export.
- Export: MP4/MOV/AVI/WebM, resolution presets, progress updates.
- AI: chat assistant, tool execution for edits, media analysis memory, YouTube channel analysis.
- Project: save/load `.quickcut`, autosave, unsaved-changes guard.

# Process flow diagram or Use-case diagram
1. Import media → read metadata → generate thumbnails/waveforms (cached)
2. Drag to timeline → edit (split/trim/move/merge, audio controls)
3. Optional: transcribe clip/timeline → review segments → generate/edit subtitles
4. Optional: ask AI → AI calls tools → timeline updates
5. Export → smart stream-copy when possible → output file

# Wireframes/Mock diagrams of the proposed solution (optional)
- Left: File panel (Media / Project / Text / Settings)
- Center: Preview player
- Right: Transcript + Subtitles + Edit-by-text + AI chat
- Bottom: Timeline (tracks + clip controls)
- Top: Toolbar (import, transcribe, text, export)

# Architecture diagram of the proposed solution:
- Renderer (React/Vite): UI + Zustand stores (timeline, projects, chat, onboarding)
- Preload bridge: typed `electronAPI` for IPC calls
- Main (Electron): IPC handlers, file dialogs, FFmpeg processor, transcription, channel analysis, memory persistence
- Processing:
  - FFmpeg: export, thumbnails, waveforms
  - Vosk: offline speech-to-text
  - Gemini: chat + structured responses + memory context (optional API key)

# Technologies to be used:
- Electron, React, TypeScript, Vite
- Zustand, TailwindCSS, Zod
- FFmpeg (bundled) + fluent-ffmpeg
- Vosk (vosk-koffi) for offline transcription
- Google Gemini SDK (`@google/genai`) + YouTube Data API (optional keys)
- Vitest for tests

# Add as per the requirements for the hackathon:
- Privacy: local editing/export; AI requires user-provided API key/model.
- Cross-platform packaging: electron-builder (Windows/macOS/Linux).
- Demo: import → edit → transcribe → subtitles → export + AI-assisted edits.

# Estimated implementation cost (optional):
- Local editing/export: no infra cost.
- Optional APIs (Gemini/YouTube): pay-per-request; gate behind user keys + usage meter.

