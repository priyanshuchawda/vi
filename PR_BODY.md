## Overview
Complete migration from Google Gemini to AWS Bedrock (Amazon Nova Lite) with comprehensive premium UI/UX redesign.

## Major Changes

### AWS Bedrock Migration
- ✅ Migrate AI backend from Google Gemini to AWS Bedrock (Amazon Nova Lite)
- ✅ Convert all tool declarations to Bedrock Converse API format (`toolSpec`/`inputSchema`)
- ✅ Rename `useGeminiMemoryStore` to `useAiMemoryStore` (provider-agnostic)
- ✅ Update cost calculator for Bedrock pricing ($0.06/M input, $0.24/M output)
- ✅ Update all UI text to be AI provider-agnostic

### Premium UI/UX Redesign
- ✅ Add **IconSidebar** component (64px icon-only left navigation)
- ✅ Add **ContentPanel** component (slide-out panel for tab content)
- ✅ Add **AISidebar** component (permanent right-side AI copilot)
- ✅ Implement modern dark theme with controlled accent usage
- ✅ Add comprehensive UI_REDESIGN_SUMMARY.md documentation

### AI Contract System
- ✅ Add `aiProjectSnapshot.ts` for grounded timeline/media state snapshots
- ✅ Add `toolCapabilityMatrix.ts` for tool safety metadata and constraints
- ✅ Add comprehensive test suites (`aiContracts`, `intentClassifier`, `toolExecutorPolicy`)

### Core Improvements
- ✅ Add speed and effects properties to Clip interface
- ✅ Implement resizable chat panel with width persistence
- ✅ Remove YouTube upload dependencies
- ✅ Fix all Gemini references to generic AI references
- ✅ Remove large FFmpeg binaries from repository (moved to .gitignore)

## Features Preserved
✅ Video editing (split/merge/delete/copy/paste/undo/redo)
✅ Transcription and subtitles
✅ Audio mixing and volume control
✅ Speed control and visual effects
✅ AI memory and analysis
✅ Project save/load
✅ Export with format/resolution settings

## Files Changed
- **63 files changed**: 7,253 insertions(+), 4,282 deletions(-)
- **New components**: AISidebar.tsx, ContentPanel.tsx, IconSidebar.tsx
- **New libraries**: aiProjectSnapshot.ts, toolCapabilityMatrix.ts
- **New tests**: aiContracts.test.ts, intentClassifier.test.ts, toolExecutorPolicy.test.ts

## Testing
All existing functionality has been preserved and tested. The migration maintains backward compatibility with existing projects.
