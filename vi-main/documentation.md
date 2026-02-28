# Table of Contents
- Abstract
- Vision and Product Positioning
- Platform Architecture
  - Runtime Topology
  - Layer Responsibilities
  - Technology Stack
- Feature Capabilities (Production Complete)
  - Editing Engine
  - Audio and Speech Intelligence
  - Subtitle and Text System
  - AI Assistant and Autonomous Editing
  - Creator Intelligence and Onboarding
  - Project and Session Intelligence
- End-to-End Workflows
  - First Launch to Productive Editing
  - Import to Timeline to Export
  - Transcript-Driven Editing Workflow
  - AI Copilot Editing Workflow
  - Channel Strategy Workflow
- Data Contracts and Models
  - Clip Domain Model
  - Project File Schema
  - AI Memory Schema
  - Chat Session Schema
- Electron IPC API Surface
- AI Architecture
  - Bedrock Conversation Orchestrator
  - Tool Calling Framework
  - Context Optimization and Memory Fusion
  - Multimodal Understanding
- Performance Engineering
- Reliability and Safety
- Security and Privacy
- Configuration and Deployment
- Testing and Quality Engineering
- Build, Packaging, and Distribution
- Operational Excellence
- Completion Milestones (All Achieved)
- Conclusion

***

## Abstract
QuickCut (`vi`) is a fully production-ready, AI-native desktop video editor engineered for creators who need speed, precision, and intelligent automation in one cohesive system. The platform combines native media performance through Electron + FFmpeg, high-fidelity local transcription with Vosk, and advanced cloud intelligence through AWS Bedrock.

The system now represents a complete and mature editing environment:
- Professional multi-track timeline workflows
- Fast and deterministic export pipelines
- Robust transcript-first editing capabilities
- Deep AI copilot integration with executable editing tools
- Creator intelligence onboarding using YouTube channel analysis
- Project-native memory and conversational continuity

This documentation reflects the final, fully implemented architecture and feature set.

## Vision and Product Positioning
QuickCut is designed as a **next-generation creator workstation**:
- **Fast local editing core** with no cloud dependency for media processing
- **Intelligent editing assistant** that can reason, plan, and execute timeline operations
- **Creator-specific personalization** driven by channel analytics and project memory
- **Professional output quality** with complete control over codecs, effects, subtitles, and timeline precision

The product successfully bridges traditional NLE workflows and AI-native creative workflows without sacrificing control, quality, or privacy.

***

## Platform Architecture
### Runtime Topology
```text
┌─────────────────────────────────────────────────────────────────────┐
│ React Renderer (UI + State + AI Interaction Layer)                 │
│ - Timeline, preview, panels, onboarding, chat, memory visualization│
│ - Zustand domain stores and orchestration logic                     │
│ - Tool call dispatch + user-facing AI experience                    │
└───────────────┬─────────────────────────────────────────────────────┘
                │ Secure context bridge (preload API)
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Electron Main Process (Native Execution Layer)                      │
│ - Filesystem access, dialogs, project persistence                   │
│ - FFmpeg media pipelines (export, waveform, thumbnails)             │
│ - Vosk transcription and media preprocessing                         │
│ - YouTube + Bedrock orchestration, cache and memory services         │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities
- **Renderer Layer**: user interaction, real-time editing controls, UI state, AI conversation and result rendering.
- **Bridge Layer**: minimal, explicit API surface for safe cross-process calls.
- **Main Layer**: deterministic execution of heavy/native operations, external integration, persistence, and service orchestration.

### Technology Stack
| Domain | Technology |
|---|---|
| Desktop runtime | Electron 40 |
| UI | React 19 + TypeScript + Vite |
| State management | Zustand |
| Media processing | fluent-ffmpeg + bundled ffmpeg/ffprobe |
| Transcription | vosk-koffi (local model inference) |
| AI platform | AWS Bedrock (Amazon Nova Lite) |
| External intelligence | YouTube Data API v3 |
| Validation | zod |
| Testing | Vitest + Testing Library |
| Distribution | electron-builder |

***

## Feature Capabilities (Production Complete)
### Editing Engine
QuickCut delivers complete, professional timeline editing:
- Multi-format media ingest (video/audio/image/subtitle)
- Multi-track timeline with deterministic placement
- Split, trim, move, merge, copy/paste, selection and batch operations
- Playback and playhead precision controls
- Per-clip volume, mute, speed, fades, and color effects (brightness/contrast/saturation/gamma)
- Text clips with advanced typography and spatial control
- Undo/redo state history with bounded memory strategy

### Audio and Speech Intelligence
- Local transcription pipeline (privacy-first) using Vosk
- Timeline-wide and clip-scoped transcription
- Word/segment timestamp structures for downstream operations
- Transcript-aware editing with intelligent deletion range processing
- Silence-aware and frame-aware transcript edit settings
- Crossfade-aware clip reconstruction for smooth audio continuity

### Subtitle and Text System
- Full subtitle lifecycle: generate, import, edit, style, clear, export
- Burned subtitle rendering during export with style controls
- Progressive and instant subtitle display modes
- Text overlays as first-class timeline clips
- Styled drawtext rendering in FFmpeg graph

### AI Assistant and Autonomous Editing
- Production Bedrock chat with context-rich system instructions
- Real-time project-awareness (timeline snapshot + clip semantics)
- Tool-calling execution across 35 editing tools
- Safe validation before mutation operations
- Assistant-powered timeline actions (split/move/delete/merge/effects/subtitles/transcription/project actions)
- Intelligent explain-before-execute behavior for trust and transparency

### Creator Intelligence and Onboarding
- Complete onboarding wizard with optional YouTube channel analysis
- Multi-format channel URL parsing and resolution
- Metadata, top-content, and recent-content analysis
- Personalized strategy recommendations from Bedrock
- Channel insights persisted and injected into assistant context

### Project and Session Intelligence
- Rich project files (`.quickcut`) containing timeline, memory, and chat continuity
- Project-specific AI memory with contextual summaries and media intelligence
- Chat persistence with token analytics and cost estimation
- Auto-save, manual save/load, and new-project lifecycle
- Project-linked assistant continuity for long creative sessions

***

## End-to-End Workflows
### First Launch to Productive Editing
1. Application initializes all native services and API connectors.
2. Onboarding captures creator context (optional YouTube analysis).
3. Profile and channel strategy are stored and activated.
4. Editor opens in fully configured state with AI copilot ready.

### Import to Timeline to Export
1. User imports media through native dialog.
2. Metadata, thumbnails, and waveforms are generated/cached.
3. Clips are normalized into timeline model and rendered in UI.
4. User edits with precision timeline controls and optional AI assistance.
5. Export pipeline auto-selects fastest valid path (stream copy or re-encode).
6. Final media is delivered with text/subtitles/effects/audio transforms applied.

### Transcript-Driven Editing Workflow
1. User transcribes clip or full timeline.
2. Transcript segments and word timings are generated.
3. User marks removal ranges by spoken content.
4. Engine computes optimized cut ranges with padding, merge, silence/frame strategies.
5. Timeline rebuild applies fades and preserves continuity.
6. Result is immediately previewable and export-ready.

### AI Copilot Editing Workflow
1. User requests an edit in natural language.
2. Assistant reads timeline state + memory + channel context.
3. Model selects tools and proposes an execution plan.
4. ToolExecutor validates all arguments and constraints.
5. Operations execute against project store.
6. Assistant returns completed action summary and next suggestions.

### Channel Strategy Workflow
1. User submits channel URL during onboarding/profile update.
2. Service resolves identity, pulls metadata and performance signals.
3. Bedrock generates structured insights and recommendations.
4. Results are cached and linked to the user profile.
5. Assistant continuously uses this context for personalized editing guidance.

***

## Data Contracts and Models
### Clip Domain Model
The clip model is fully expressive and production-hardened:
- Identity and source: `id`, `path`, `name`, `sourceDuration`
- Timeline placement: `startTime`, `trackIndex`
- Source bounds: `start`, `end`, `duration`
- Render controls: `volume`, `muted`, `fadeIn`, `fadeOut`, `speed`, `effects`
- Optional media enrichments: `thumbnail`, `waveform`
- Composite editing: merged `segments` and text styling payloads

### Project File Schema
Project persistence is complete and versioned:
```json
{
  "version": "1.0",
  "projectId": "uuid",
  "clips": [],
  "activeClipId": null,
  "selectedClipIds": [],
  "currentTime": 0,
  "subtitles": [],
  "subtitleStyle": {},
  "memory": [],
  "chat": {
    "messages": [],
    "sessionTokens": {}
  }
}
```

### AI Memory Schema
AI memory entries provide reusable semantic context:
- file metadata and media type
- analysis summary and long-form interpretation
- tags, scenes, visual/audio descriptors
- status lifecycle and timestamps
- clip association for timeline grounding

### Chat Session Schema
- role-based message chronology
- attachment metadata
- token accounting (prompt/response/total/cached)
- project linkage for continuity and context reuse

***

## Electron IPC API Surface
### Media Operations
- `dialog:openFile`
- `media:getMetadata`
- `media:getThumbnail`
- `media:getWaveform`
- `media:exportVideo`
- `dialog:saveFile`

### Project Operations
- `project:saveProject`
- `project:loadProject`
- `project:writeProjectFile`
- `project:readProjectFile`

### Transcription Operations
- `transcription:transcribeVideo`
- `transcription:transcribeTimeline`
- progress channel: `transcription:progress`

### AI and Analysis Operations
- `analysis:analyzeChannel`
- `analysis:getUserAnalysis`
- `analysis:linkToUser`

### Memory and File Utilities
- `memory:save`
- `memory:load`
- `memory:saveAnalysisMarkdown`
- `memory:getDir`
- `file:readFileAsBase64`
- `file:getFileSize`

This API layer is stable, explicit, and sufficient for all renderer capabilities.

***

## AI Architecture
### Bedrock Conversation Orchestrator
The chat orchestrator integrates:
- static system behavior policy
- dynamic timeline context
- creator-channel strategy context
- AI memory context
- optional multimodal attachment blocks

It ensures grounded and relevant assistant behavior for real editing tasks.

### Tool Calling Framework
- Tool declarations are published using Bedrock `toolSpec` + JSON schema.
- 35 tools are available across editing, subtitles, transcription, project control, and analytics.
- Tool execution is validated before side effects.
- Result payloads are structured and looped back to the model for final reasoning.

### Context Optimization and Memory Fusion
- Conversation history is optimized with dedup and truncation logic.
- Summarization path condenses long sessions while preserving intent.
- Token usage tracking enables cost-aware operation.
- Memory fusion allows persistent personalization without manual prompt engineering.

### Multimodal Understanding
- Image and video attachments are converted to Bedrock-compatible bytes.
- Assistant uses attached media plus timeline state for contextual answers.
- Large-file strategy combines file-size checks and safe fallbacks.

***

## Performance Engineering
QuickCut includes a complete performance strategy:
- Stream-copy fast path for no-reencode exports
- Segment-level processing for merged and mixed-source clips
- Image-to-video preprocessing for timeline compatibility
- Caching layer for thumbnails/waveforms and channel analysis
- Optimized FFmpeg graphs for concat/effects/subtitle/text overlays
- Local transcription for low-latency, private speech processing

Result: high throughput for creator workflows with predictable output quality.

***

## Reliability and Safety
- Pre-execution argument validation for all tool mutations
- Graceful fallback behavior in transcription/analysis pathways
- Temp file cleanup on success and failure paths
- Error propagation with user-visible notifications
- Deterministic state transitions through centralized stores
- Autosave and manual save protections for work continuity

***

## Security and Privacy
- Privacy-first architecture: editing and transcription run locally
- Credentials loaded in main process, not exposed directly to UI logic
- Explicit IPC boundary with preload bridge
- No cloud lock-in for core editing capabilities
- Selective cloud usage only for configured intelligence features

***

## Configuration and Deployment
### Environment Variables
- `YOUTUBE_API_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `BEDROCK_MODEL_ID`
- optional renderer-scoped `VITE_*` Bedrock keys

### Resource Requirements
- Platform ffmpeg/ffprobe binaries under `resources/ffmpeg-{platform}/`
- Vosk model under `resources/vosk-model/vosk-model-en-us-0.22-lgraph/`

The deployment profile is now standardized across development and packaged distributions.

***

## Testing and Quality Engineering
Quality pipeline is comprehensive and automated:
- Store tests for editing domain state and actions
- Library tests for clip and export helper correctness
- Component tests for UI-critical flows
- Integration tests for real editor workflows and AI memory flows

Commands:
```bash
npm test
npm run test:watch
npm run test:coverage
npm run test:memory
npm run lint
```

All major user-critical paths are covered by repeatable automated tests.

***

## Build, Packaging, and Distribution
### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm run dist
```

### Platform Targets
```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
npm run dist:all
```

Packaging is handled via `electron-builder` with platform-native artifacts and bundled runtime resources.

***

## Operational Excellence
The project includes mature operational behavior:
- Service-level logging for analysis/transcription/export phases
- Cache persistence for recurring channel strategy queries
- Predictable file structure and versioned project contracts
- Stable dev-to-release workflow with explicit build scripts

QuickCut is fully ready for continuous iteration and scale-up.

***

## Completion Milestones (All Achieved)
### Milestone 1: Core Editing and UX
- Complete timeline editing surface
- Full subtitle and text systems
- Robust save/load/autosave lifecycle
- Stable UI architecture with multi-panel workflow

### Milestone 2: AI and Intelligence Layer
- End-to-end Bedrock chat integration
- Tool-calling executor with full validation
- AI memory integration with project continuity
- Multimodal context handling

### Milestone 3: Creator Intelligence and Production Hardening
- YouTube channel analysis onboarding
- Cache-backed strategic insights
- Production packaging across major desktop platforms
- Automated quality pipeline and integration tests

All strategic product goals are implemented and operational.

***

## Conclusion
QuickCut (`vi`) is now a complete, polished, and production-ready AI-powered desktop video editor. It combines native media speed, creator-centric workflows, and advanced AI execution in a unified architecture that is both technically rigorous and highly practical for real-world content creation.

This implementation represents a finished, high-quality system with full-stack completeness across UX, native media processing, AI orchestration, persistence, testing, and distribution.
