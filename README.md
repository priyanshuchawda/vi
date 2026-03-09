You have this respo means you are contributing remember so you must read
contributing.md

# QuickCut

QuickCut is an AI-enabled desktop video editor built with Electron, React,
TypeScript, and FFmpeg.

It combines a local-first editing engine (timeline, subtitles, transcription,
export) with an AI assistant that can reason about project state, generate safe
execution plans, and run supported editing tools.

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
- Optional: `AWS_S3_BUCKET`
- Optional: `AWS_LANDING_BUCKET` (used by the landing-page deploy script)
- Optional: `AWS_LANDING_S3_PREFIX` (deploy landing files under a bucket prefix)
- Optional: `AWS_BACKEND_MODE` (`direct` by default, `apigw` for the future API
  Gateway path)
- Optional: `AWS_BACKEND_URL` (required only when `AWS_BACKEND_MODE=apigw`)
- Optional: `AWS_BACKEND_AUTH_TOKEN` (recommended when `AWS_BACKEND_MODE=apigw`)
- Optional: `BEDROCK_MODEL_ID` (defaults to `amazon.nova-lite-v1:0`)
- Optional onboarding/creator analysis keys if used
- Optional YouTube upload OAuth settings:
  - `YOUTUBE_OAUTH_CLIENT_ID`
  - `YOUTUBE_OAUTH_CLIENT_SECRET`
  - `YOUTUBE_OAUTH_REDIRECT_URI`
  - or `YOUTUBE_OAUTH_CREDENTIALS_PATH` for an external Google OAuth JSON file

Packaged app users can also configure AI keys inside
`Settings -> AI Credentials`. When `.env` is absent, those saved AWS settings
act as the fallback for both Bedrock and the app's direct AWS storage flows, so
production installs do not require editing `.env`.

For cleaner AWS environment separation, the repo also includes:

- `.env.aws.dev.example`
- `.env.aws.prod.example`

All AWS helper scripts support either `AWS_ENV_FILE=.env.aws.dev ...` or
`--env-file .env.aws.prod`.

## Run

```bash
npm run dev
```

This starts both renderer and Electron.

## Mermaid Diagrams

Render Mermaid diagrams with the local compiler:

```bash
npm run mermaid:render -- -i docs/diagram.mmd -o docs/diagram.png
npm run mermaid:render -- -i docs/diagram.mmd -o docs/diagram.jpg
```

Native Mermaid CLI outputs (`.svg`, `.png`, `.pdf`) are supported directly, and
the project wrapper also supports `.jpg` / `.jpeg` by rasterizing the generated
SVG through the local Chrome install.

Current creator-system diagrams live in:

- [docs/creator-architecture.md](./docs/creator-architecture.md)

If Chrome sandboxing is unavailable on Linux, the Mermaid renderer also accepts
the included fallback Puppeteer config:

```bash
npm run mermaid:render -- -p .mermaid-tools/puppeteer-no-sandbox.json -i docs/diagram.mmd -o docs/diagram.png
```

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

Expected production artifacts:

- Windows: NSIS installer `.exe`
- Ubuntu/Linux: `.AppImage` and `.deb`

## AWS Deploy Helpers

Deploy the static landing site to the configured S3 bucket:

```bash
npm run aws:deploy:landing
```

Preview the S3 sync operations without uploading:

```bash
npm run aws:deploy:landing:dryrun
```

Verify the current AWS baseline after a backend or landing deploy:

```bash
npm run aws:verify:baseline
```

Audit the current AWS account/resource state:

```bash
npm run aws:check:account
AWS_ENV_FILE=.env.aws.prod npm run aws:check:account
```

The landing deploy script reads:

- `AWS_REGION`
- `AWS_LANDING_BUCKET`
- Optional: `AWS_LANDING_S3_PREFIX`
- Optional: `AWS_LANDING_DIR` (defaults to `landing`)

The AWS baseline verification script checks:

- CloudFormation stack status and outputs
- required API Gateway routes
- alarm presence
- API Gateway and Lambda log retention
- a live profile-read API smoke request
- the landing website endpoint

For the deploy/rollback sequence, see `docs/aws-deploy-runbook.md`. For
production hygiene and dev/prod separation guidance, see
`docs/aws-production-hygiene.md`.

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

## Format

```bash
npm run format
npm run format:check
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
  - `Hygiene` (architecture boundaries + lint debt guard)
  - `Test`
  - `Build`
- `License Compliance` verifies `ThirdPartyNotices.json` stays in sync with
  `package-lock.json`.
- `Release Desktop` runs on version tags (`v*`) and produces Linux desktop
  artifacts.

## Release and Updates

- `electron-updater` is integrated for packaged app update
  checks/download/install flow.
- Release/publish and signing environment contract is documented in:
  [docs/release-and-updates.md](./docs/release-and-updates.md)

## Performance Budget

- Startup and interaction performance budgets are documented in:
  [docs/performance-budget.md](./docs/performance-budget.md)

## Observability

- Error tracking, structured logging, and privacy telemetry boundaries are
  documented in:
  [docs/observability-and-telemetry.md](./docs/observability-and-telemetry.md)

## Storage Strategy

- Storage decision matrix and future SQLite migration notes are documented in:
  [docs/storage-strategy.md](./docs/storage-strategy.md)

## Electron Security

- Residual Electron security checklist and enforced controls are documented in:
  [docs/electron-security-checklist.md](./docs/electron-security-checklist.md)
- Architecture dependency boundaries and cycle rules are documented in:
  [docs/architecture-boundaries.md](./docs/architecture-boundaries.md)

## Testing Hardening

- Runtime risk-area test mapping and optional E2E smoke path are documented in:
  [docs/testing-hardening.md](./docs/testing-hardening.md)

## Notes on Tests

Some integration tests depend on local test media files and may fail if those
assets are not present in your environment. Unit tests run independently.

## Recent Architecture Additions

- Canonical AI project snapshot contract (`src/lib/aiProjectSnapshot.ts`)
- Tool capability matrix contract (`src/lib/toolCapabilityMatrix.ts`)
- Plan validation gate and execution policy controls in tool executor
- Step-by-step plan metadata surfaced in chat UI

## Contributing

Reading and following [CONTRIBUTING.md](./CONTRIBUTING.md) is mandatory for
every PR.

Community and support documents:

- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SUPPORT.md](./SUPPORT.md)

1. Create a branch from `main`
2. Follow `CONTRIBUTING.md` rules (tests required for every change, checks must
   pass)
3. Open a PR with validation notes (`build`, `test`, `lint`, and relevant extra
   checks)
4. Merge via GitHub when approved

## License

MIT. See [LICENSE](./LICENSE).
