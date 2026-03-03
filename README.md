You have this respo means you are contributing remember so you must read contributing.md

# QuickCut

QuickCut is an AI-enabled desktop video editor built with Electron, React, TypeScript, and FFmpeg.

It combines a local-first editing engine (timeline, subtitles, transcription, export) with an AI assistant that can reason about project state, generate safe execution plans, and run supported editing tools.

## Core Capabilities

- Multi-track timeline editing (split, trim, move, merge, copy/paste, undo/redo)
- Subtitle and text workflows (create, style, update, clear)
- Local transcription and transcript-based editing
- Export pipeline with format/resolution control
- AI memory context for analyzed media
- AI planning + tool execution with validation and recovery hints

## AI Workflow (Current)

The assistant follows a strict planning model for editing requests:

1. Understand user goal and constraints
2. Build a grounded plan from project snapshot + tool capabilities
3. Validate plan operations before execution
4. Execute with safe policy:
   - Default: strict sequential (step-by-step, stop on failure)
   - Optional: hybrid read-only batching for lightweight inspection calls
5. Return status with categorized errors and recovery guidance

## Tech Stack

- Electron 40
- React 19 + TypeScript + Vite
- Zustand state management
- FFmpeg processing pipeline
- AWS Bedrock (`amazon.nova-lite-v1:0`) for AI chat/planning
- Vosk (`vosk-koffi`) for local speech transcription
- Vitest + Testing Library for tests

## Repository Structure

```text
.
├── electron/                  # Main process, IPC, native services
├── src/
│   ├── components/            # UI (chat, timeline, panels)
│   ├── lib/                   # AI services, planning, tools, utilities
│   ├── stores/                # Zustand stores
│   └── types/                 # Shared types
├── resources/                 # Bundled binaries/assets
├── test/                      # Unit/integration tests
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
git clone https://github.com/priyanshuchawda/vi.git
cd vi
npm install
```

### Environment

Create `.env` from `.env.example` and set required values for AI features:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- Optional: `BEDROCK_MODEL_ID` (defaults to `amazon.nova-lite-v1:0`)
- Optional onboarding/creator analysis keys if used

## Run

```bash
npm run dev
```

This starts both renderer and Electron.

## Build

```bash
npm run build
npm run dist
```

Platform-specific packaging:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
npm run dist:all
```

## Test

```bash
npm run test
npm run test:watch
npm run test:coverage
```

## Lint

```bash
npm run lint
```

## Typecheck

```bash
npm run typecheck
```

## CI/CD

GitHub Actions workflows:

- `CI` runs on PRs and pushes to `main` with separate required checks:
  - `Typecheck`
  - `Lint`
  - `Test`
  - `Build`
- `Release Desktop` runs on version tags (`v*`) and produces Linux desktop artifacts.

## Release and Updates

- `electron-updater` is integrated for packaged app update checks/download/install flow.
- Release/publish and signing environment contract is documented in:
  [docs/release-and-updates.md](./docs/release-and-updates.md)

## Performance Budget

- Startup and interaction performance budgets are documented in:
  [docs/performance-budget.md](./docs/performance-budget.md)

## Observability

- Error tracking, structured logging, and privacy telemetry boundaries are documented in:
  [docs/observability-and-telemetry.md](./docs/observability-and-telemetry.md)

## Notes on Tests

Some integration tests depend on local test media files and may fail if those assets are not present in your environment. Unit tests run independently.

## Recent Architecture Additions

- Canonical AI project snapshot contract (`src/lib/aiProjectSnapshot.ts`)
- Tool capability matrix contract (`src/lib/toolCapabilityMatrix.ts`)
- Plan validation gate and execution policy controls in tool executor
- Step-by-step plan metadata surfaced in chat UI

## Contributing

Reading and following [CONTRIBUTING.md](./CONTRIBUTING.md) is mandatory for every PR.

1. Create a branch from `main`
2. Follow `CONTRIBUTING.md` rules (tests required for every change, checks must pass)
3. Open a PR with validation notes (`build`, `test`, `lint`, and relevant extra checks)
4. Merge via GitHub when approved

## License

See project license file and repository policy.
